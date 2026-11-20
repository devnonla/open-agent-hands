import { DEFAULT_WORKSPACE_ID } from "../../common/db/schema.js";
import { HttpException, NotFoundException } from "../../common/exceptions/http.exception.js";
import { type McpServerHandler, type McpToolDescriptor, textResult } from "../../common/mcp/json-rpc.js";
import { runInWorkspace } from "../../common/workspace/workspace-context.js";
import * as datatables from "../datatables/datatables.service.js";
import type { OrderByItem, WhereFilter } from "../datatables/datatable-where.util.js";
import { startClaimedRun } from "../jobs/jobs-runner.js";
import * as jobs from "../jobs/jobs.service.js";
import * as kv from "../kvstore/kvstore.service.js";
import * as mcpServers from "../my-mcp-servers/my-mcp-servers.service.js";
import * as secrets from "../secrets/secrets.service.js";
import * as sites from "../sites/sites.service.js";
import { buildJsonSchemaFromCode, parseMetaFromCode } from "../tools/common/code-annotations.js";
import * as tools from "../tools/tools.service.js";
import * as workspaces from "../workspaces/workspaces.service.js";
import { CORE_MCP_INSTRUCTIONS, getGuide } from "./core-mcp-guide.js";

type Args = Record<string, unknown>;

type CoreTool = McpToolDescriptor & {
  global?: boolean;
  run: (args: Args) => Promise<unknown>;
};

type Schema = Record<string, unknown>;

const WORKSPACE_PROP: Schema = { type: "string", description: 'Workspace id or name. Defaults to "default".' };

function s(description: string): Schema {
  return { type: "string", description };
}

function input(properties: Record<string, Schema>, required: string[] = [], global = false): object {
  return { type: "object", properties: global ? properties : { workspace: WORKSPACE_PROP, ...properties }, required };
}

function str(args: Args, key: string, required = true): string {
  const value = args[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new Error(`"${key}" is required`);
  return "";
}

function optStr(args: Args, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function strList(args: Args, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

async function resolveWorkspaceId(ref: unknown): Promise<string> {
  const key = typeof ref === "string" ? ref.trim() : "";
  if (!key) return DEFAULT_WORKSPACE_ID;
  const all = await workspaces.listWorkspaces();
  const found = all.find((w) => w.id === key) ?? all.find((w) => w.name.toLowerCase() === key.toLowerCase());
  if (!found) throw new NotFoundException(`Workspace "${key}" not found`);
  return found.id;
}

async function findTool(ref: string) {
  const byId = await tools.getTool(ref);
  if (byId) return byId;
  const list = await tools.listTools({});
  const match = (list.items as { id: string; name: string }[]).find((t) => t.name === ref);
  if (!match) throw new NotFoundException(`Tool "${ref}" not found`);
  const tool = await tools.getTool(match.id);
  if (!tool) throw new NotFoundException(`Tool "${ref}" not found`);
  return tool;
}

async function findMcpServer(ref: string) {
  const list = await mcpServers.listMyMcpServers({});
  const match = (list.items as { id: string; name: string; tools: { id: string }[] }[]).find((m) => m.id === ref || m.name === ref);
  if (!match) throw new NotFoundException(`MCP server "${ref}" not found`);
  return match;
}

async function toolIdsFor(refs: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const ref of refs) ids.push((await findTool(ref)).id);
  return ids;
}

async function findSite(ref: string) {
  const list = await sites.listSites({});
  const match = list.items.find((site) => site.id === ref || site.slug === ref);
  if (!match) throw new NotFoundException(`Site "${ref}" not found`);
  return match;
}

async function findJob(ref: string) {
  const byId = await jobs.getJob(ref);
  if (byId) return byId;
  const list = await jobs.listJobs({});
  const match = (list.items as { id: string; name: string }[]).find((j) => j.name === ref);
  if (!match) throw new NotFoundException(`Job "${ref}" not found`);
  const job = await jobs.getJob(match.id);
  if (!job) throw new NotFoundException(`Job "${ref}" not found`);
  return job;
}

function toolSummary(tool: { id: string; name: string; label: string; description: string; folderId?: string | null }) {
  return { id: tool.id, name: tool.name, label: tool.label, description: tool.description, folderId: tool.folderId ?? null };
}

async function waitForRun(runId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await jobs.getJobRun(runId);
    if (run && run.status !== "running") return jobs.toPublicJobRun(run);
    await Bun.sleep(500);
  }
  const run = await jobs.getJobRun(runId);
  return run ? jobs.toPublicJobRun(run) : null;
}

const CORE_TOOLS: CoreTool[] = [
  {
    name: "get_guide",
    description: "How to write tools, jobs and sites, and the @agenthands/runtime SDK. Read before writing code.",
    inputSchema: input({ topic: { type: "string", enum: ["tools", "jobs", "sites", "runtime", "all"] } }, ["topic"], true),
    global: true,
    run: async (args) => getGuide(str(args, "topic")),
  },
  {
    name: "list_workspaces",
    description: "List all workspaces.",
    inputSchema: input({}, [], true),
    global: true,
    run: async () => workspaces.listWorkspaces(),
  },
  {
    name: "create_workspace",
    description: "Create a workspace.",
    inputSchema: input({ name: s("Workspace name"), description: s("Optional description") }, ["name"], true),
    global: true,
    run: async (args) => workspaces.createWorkspace({ name: args.name, description: args.description }),
  },
  {
    name: "update_workspace",
    description: "Rename a workspace or change its description.",
    inputSchema: input({ workspace_id: s("Workspace id or name"), name: s("New name"), description: s("New description") }, ["workspace_id"], true),
    global: true,
    run: async (args) => workspaces.updateWorkspace(await resolveWorkspaceId(args.workspace_id), { name: args.name, description: args.description }),
  },
  {
    name: "delete_workspace",
    description: "Delete a workspace and everything in it. The default workspace cannot be deleted. Requires confirm=true.",
    inputSchema: input({ workspace_id: s("Workspace id or name"), confirm: { type: "boolean" } }, ["workspace_id", "confirm"], true),
    global: true,
    run: async (args) => {
      if (args.confirm !== true) throw new Error("Set confirm=true to delete the workspace and all its resources");
      await workspaces.deleteWorkspace(await resolveWorkspaceId(args.workspace_id));
      return { ok: true };
    },
  },

  {
    name: "list_tools",
    description: "List tools in a workspace (without code).",
    inputSchema: input({}),
    run: async () => ((await tools.listTools({})).items as Parameters<typeof toolSummary>[0][]).map(toolSummary),
  },
  {
    name: "get_tool",
    description: "Get a tool with its code, by id or name.",
    inputSchema: input({ tool: s("Tool id or name") }, ["tool"]),
    run: async (args) => findTool(str(args, "tool")),
  },
  {
    name: "create_tool",
    description: "Create a tool from code. Name, description and parameters come from the @name/@description/@param header. See get_guide topic=tools.",
    inputSchema: input({ code: s("Full TypeScript module with annotation header and export default async function main(input)"), folder_id: s("Optional tool folder id") }, ["code"]),
    run: async (args) => {
      const code = str(args, "code");
      const meta = parseMetaFromCode(code);
      if (!meta.label || !meta.name) throw new Error("Code must start with // @name <Label>");
      if (!meta.description) throw new Error("Code must include // @description <text>");
      const created = await tools.createTool({ name: meta.name, label: meta.label, description: meta.description, parameters: buildJsonSchemaFromCode(code), codeContent: code, folderId: optStr(args, "folder_id") ?? null });
      return toolSummary(await tools.updateTool(created.id as string, { codeContent: code }));
    },
  },
  {
    name: "update_tool",
    description: "Update a tool's code (annotations re-read).",
    inputSchema: input({ tool: s("Tool id or name"), code: s("New full module") }, ["tool"]),
    run: async (args) => {
      const tool = await findTool(str(args, "tool"));
      const patch: Record<string, unknown> = {};
      if (typeof args.code === "string") patch.codeContent = args.code;
      return toolSummary(await tools.updateTool(tool.id, patch));
    },
  },
  {
    name: "run_tool",
    description: "Run a tool for real in its sandbox (side effects happen). Returns { ok, result } or { ok: false, error, console } with the stack trace. Pass code to test a draft without saving. Type errors are not checked; only runtime and syntax errors surface.",
    inputSchema: input({ tool: s("Tool id or name"), input: { type: "object", description: "Input object for main(input)" }, code: s("Optional draft code to run instead of the saved code") }, ["tool"]),
    run: async (args) => {
      const tool = await findTool(str(args, "tool"));
      return tools.runTool(tool.id, JSON.stringify(args.input && typeof args.input === "object" ? args.input : {}), optStr(args, "code"));
    },
  },
  {
    name: "delete_tool",
    description: "Delete a tool.",
    inputSchema: input({ tool: s("Tool id or name") }, ["tool"]),
    run: async (args) => {
      await tools.deleteTool((await findTool(str(args, "tool"))).id);
      return { ok: true };
    },
  },

  {
    name: "list_mcp_servers",
    description: "List hosted MCP servers in a workspace. Each one exposes a set of tools at /mcp/<id>.",
    inputSchema: input({}),
    run: async () => (await mcpServers.listMyMcpServers({})).items,
  },
  {
    name: "create_mcp_server",
    description: "Create a hosted MCP server exposing the given tools. Returns the endpoint path and its Bearer key (shown once).",
    inputSchema: input({ name: s("Server name"), description: s("Optional description"), tools: { type: "array", items: { type: "string" }, description: "Tool ids or names" } }, ["name"]),
    run: async (args) => {
      const created = await mcpServers.createMyMcpServer({ name: str(args, "name"), description: optStr(args, "description") ?? null, toolIds: await toolIdsFor(strList(args, "tools")) });
      return { ...created, endpoint: `/mcp/${created.id}` };
    },
  },
  {
    name: "update_mcp_server",
    description: "Rename or enable/disable a hosted MCP server. Passing tools REPLACES the whole tool list; use add_tools_to_mcp_server / remove_tools_from_mcp_server to change it incrementally.",
    inputSchema: input({ server: s("Server id or name"), name: s("New name"), active: { type: "boolean" }, tools: { type: "array", items: { type: "string" }, description: "Replaces assigned tools (ids or names)" } }, ["server"]),
    run: async (args) => {
      const server = await findMcpServer(str(args, "server"));
      return mcpServers.updateMyMcpServer(server.id, {
        ...(typeof args.name === "string" ? { name: args.name } : {}),
        ...(typeof args.active === "boolean" ? { isActive: args.active } : {}),
        ...(Array.isArray(args.tools) ? { toolIds: await toolIdsFor(strList(args, "tools")) } : {}),
      });
    },
  },
  {
    name: "add_tools_to_mcp_server",
    description: "Expose more tools on a hosted MCP server, keeping the ones already assigned.",
    inputSchema: input({ server: s("Server id or name"), tools: { type: "array", items: { type: "string" }, description: "Tool ids or names to add" } }, ["server", "tools"]),
    run: async (args) => {
      const server = await findMcpServer(str(args, "server"));
      const ids = new Set(server.tools.map((tool) => tool.id));
      for (const id of await toolIdsFor(strList(args, "tools"))) ids.add(id);
      return mcpServers.updateMyMcpServer(server.id, { toolIds: [...ids] });
    },
  },
  {
    name: "remove_tools_from_mcp_server",
    description: "Stop exposing some tools on a hosted MCP server. The tools themselves are not deleted.",
    inputSchema: input({ server: s("Server id or name"), tools: { type: "array", items: { type: "string" }, description: "Tool ids or names to remove" } }, ["server", "tools"]),
    run: async (args) => {
      const server = await findMcpServer(str(args, "server"));
      const remove = new Set(await toolIdsFor(strList(args, "tools")));
      return mcpServers.updateMyMcpServer(server.id, { toolIds: server.tools.map((tool) => tool.id).filter((id) => !remove.has(id)) });
    },
  },
  {
    name: "delete_mcp_server",
    description: "Delete a hosted MCP server.",
    inputSchema: input({ server: s("Server id or name") }, ["server"]),
    run: async (args) => {
      await mcpServers.deleteMyMcpServer((await findMcpServer(str(args, "server"))).id);
      return { ok: true };
    },
  },

  {
    name: "kv_list",
    description: "List KV entries in a workspace.",
    inputSchema: input({}),
    run: async () => ((await kv.listKvEntries({})).items as { key: string; value: string; description: string | null }[]).map(({ key, value, description }) => ({ key, value, description })),
  },
  {
    name: "kv_get",
    description: "Get a KV value.",
    inputSchema: input({ key: s("Key like BASE_URL") }, ["key"]),
    run: async (args) => (await kv.getKvByKey(str(args, "key")))?.value ?? null,
  },
  {
    name: "kv_set",
    description: "Create or update a KV entry. Keys match [A-Z][A-Z0-9_]*.",
    inputSchema: input({ key: s("Key"), value: s("Value") }, ["key", "value"]),
    run: async (args) => {
      const entry = await kv.upsertKvByKey({ key: str(args, "key"), value: typeof args.value === "string" ? args.value : JSON.stringify(args.value ?? "") });
      return entry ? { key: entry.key, value: entry.value } : null;
    },
  },
  {
    name: "kv_delete",
    description: "Delete a KV entry.",
    inputSchema: input({ key: s("Key") }, ["key"]),
    run: async (args) => kv.deleteKvByKey(str(args, "key")),
  },

  {
    name: "secret_list",
    description: "List secret keys in a workspace (values are never returned).",
    inputSchema: input({}),
    run: async () => ((await secrets.listSecrets({})).items as { key: string; description: string | null }[]).map(({ key, description }) => ({ key, description })),
  },
  {
    name: "secret_set",
    description: "Create or update an encrypted secret. Tools read it with agenthands.secrets.get(KEY).",
    inputSchema: input({ key: s("Key like API_TOKEN"), value: s("Secret value") }, ["key", "value"]),
    run: async (args) => {
      await secrets.upsertSecretByKey({ key: str(args, "key"), value: str(args, "value") });
      return { ok: true, key: str(args, "key") };
    },
  },
  {
    name: "secret_delete",
    description: "Delete a secret.",
    inputSchema: input({ key: s("Key") }, ["key"]),
    run: async (args) => secrets.deleteSecretByKey(str(args, "key")),
  },

  {
    name: "datatable_list_projects",
    description: "List datatable projects with their tables.",
    inputSchema: input({}),
    run: async () => datatables.listProjects(),
  },
  {
    name: "datatable_create_project",
    description: "Create a datatable project.",
    inputSchema: input({ name: s("Project name") }, ["name"]),
    run: async (args) => datatables.createProject({ name: str(args, "name") }),
  },
  {
    name: "datatable_delete_project",
    description: "Delete a datatable project with all tables and rows. Requires confirm=true.",
    inputSchema: input({ project: s("Project id or name"), confirm: { type: "boolean" } }, ["project", "confirm"]),
    run: async (args) => {
      if (args.confirm !== true) throw new Error("Set confirm=true to delete the project");
      const project = await datatables.resolveProject(str(args, "project"));
      if (!project) throw new NotFoundException("Project not found");
      await datatables.deleteProject(project.id);
      return { ok: true };
    },
  },
  {
    name: "datatable_get_schema",
    description: "Get tables and columns of a project.",
    inputSchema: input({ project: s("Project id or name") }, ["project"]),
    run: async (args) => datatables.getProjectSchemaByRef(str(args, "project")),
  },
  {
    name: "datatable_create_table",
    description: "Create a table, optionally with columns. Column types: text, number, boolean, datetime, select, json.",
    inputSchema: input(
      {
        project: s("Project id or name"),
        name: s("Table name"),
        columns: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" }, type: { type: "string" }, options: { type: "array", items: { type: "string" } }, required: { type: "boolean" } }, required: ["name", "type"] },
        },
      },
      ["project", "name"],
    ),
    run: async (args) => {
      const project = await datatables.resolveProject(str(args, "project"));
      if (!project) throw new NotFoundException("Project not found");
      const table = await datatables.createTable(project.id, { name: str(args, "name") });
      const columns = Array.isArray(args.columns) ? (args.columns as { name: string; type: string; options?: string[]; required?: boolean }[]) : [];
      for (const column of columns) await datatables.createColumn(table.id as string, column);
      return datatables.getProjectSchemaByRef(project.id);
    },
  },
  {
    name: "datatable_add_column",
    description: "Add a column to a table.",
    inputSchema: input({ project: s("Project id or name"), table: s("Table id or name"), name: s("Column name"), type: s("text | number | boolean | datetime | select | json"), options: { type: "array", items: { type: "string" } }, required: { type: "boolean" } }, ["project", "table", "name", "type"]),
    run: async (args) => {
      const found = await datatables.resolveProjectAndTable(str(args, "project"), str(args, "table"));
      if (!found) throw new NotFoundException("Table not found");
      return datatables.createColumn(found.table.id, { name: str(args, "name"), type: str(args, "type"), options: strList(args, "options"), required: args.required === true });
    },
  },
  {
    name: "datatable_query",
    description: "Query rows. where: {col: value | {$op: value}} (array = OR). Ops: $eq $neq $gt $gte $lt $lte $in $nin $contains $exists.",
    inputSchema: input({ project: s("Project id or name"), table: s("Table id or name"), where: { type: ["object", "array"] }, order_by: { type: "array", items: { type: "object" } }, limit: { type: "number" }, offset: { type: "number" } }, ["project", "table"]),
    run: async (args) =>
      datatables.queryRowsByName(str(args, "project"), str(args, "table"), {
        where: args.where as WhereFilter | undefined,
        order_by: args.order_by as OrderByItem[] | undefined,
        limit: typeof args.limit === "number" ? args.limit : 50,
        offset: typeof args.offset === "number" ? args.offset : 0,
      }),
  },
  {
    name: "datatable_insert_rows",
    description: "Insert rows (array of objects keyed by column name).",
    inputSchema: input({ project: s("Project id or name"), table: s("Table id or name"), rows: { type: "array", items: { type: "object" } } }, ["project", "table", "rows"]),
    run: async (args) => datatables.insertRowsByName(str(args, "project"), str(args, "table"), Array.isArray(args.rows) ? (args.rows as Record<string, unknown>[]) : []),
  },
  {
    name: "datatable_update_row",
    description: "Update fields of one row.",
    inputSchema: input({ project: s("Project id or name"), table: s("Table id or name"), row_id: s("Row id"), data: { type: "object" } }, ["project", "table", "row_id", "data"]),
    run: async (args) => datatables.updateRowByName(str(args, "project"), str(args, "table"), str(args, "row_id"), (args.data ?? {}) as Record<string, unknown>),
  },
  {
    name: "datatable_delete_rows",
    description: "Delete rows by id.",
    inputSchema: input({ project: s("Project id or name"), table: s("Table id or name"), row_ids: { type: "array", items: { type: "string" } } }, ["project", "table", "row_ids"]),
    run: async (args) => datatables.deleteRowsByName(str(args, "project"), str(args, "table"), strList(args, "row_ids")),
  },

  {
    name: "list_sites",
    description: "List sites in a workspace.",
    inputSchema: input({}),
    run: async () => (await sites.listSites({})).items,
  },
  {
    name: "create_site",
    description: "Create a site with starter files. Slug is lowercase-kebab and globally unique; it becomes /public/sites/<slug>.",
    inputSchema: input({ name: s("Site name"), slug: s("URL slug") }, ["name", "slug"]),
    run: async (args) => sites.createSite({ name: str(args, "name"), slug: str(args, "slug") }),
  },
  {
    name: "get_site_files",
    description: "Read app.tsx, backend.ts, styles.css and package.json from the draft (default) or prod tree.",
    inputSchema: input({ site: s("Site id or slug"), tree: { type: "string", enum: ["draft", "prod"] } }, ["site"]),
    run: async (args) => sites.getSiteFiles((await findSite(str(args, "site"))).id, optStr(args, "tree") === "prod" ? "prod" : "draft"),
  },
  {
    name: "write_site_file",
    description: "Write a draft file (app.tsx, backend.ts or styles.css). npm imports are installed automatically. See get_guide topic=sites.",
    inputSchema: input({ site: s("Site id or slug"), file: { type: "string", enum: ["app.tsx", "backend.ts", "styles.css"] }, content: s("Full file content") }, ["site", "file", "content"]),
    run: async (args) => {
      const site = await findSite(str(args, "site"));
      await sites.updateSiteFile(site.id, str(args, "file"), typeof args.content === "string" ? args.content : "", "draft");
      return { ok: true };
    },
  },
  {
    name: "preview_site",
    description: "Bundle the draft and run the backend GET. Returns the backend data or the build error.",
    inputSchema: input({ site: s("Site id or slug") }, ["site"]),
    run: async (args) => {
      const preview = await sites.previewSite((await findSite(str(args, "site"))).id);
      return { ok: true, data: preview.data, appJsChars: preview.appJsChars };
    },
  },
  {
    name: "approve_site",
    description: "Promote the draft files to production.",
    inputSchema: input({ site: s("Site id or slug") }, ["site"]),
    run: async (args) => sites.approveSite((await findSite(str(args, "site"))).id),
  },
  {
    name: "publish_site",
    description: "Publish or unpublish a site, optionally with a password (empty string removes it).",
    inputSchema: input({ site: s("Site id or slug"), published: { type: "boolean" }, password: s("Optional access password") }, ["site", "published"]),
    run: async (args) => {
      const site = await findSite(str(args, "site"));
      const updated = await sites.updateSite(site.id, { isPublished: args.published === true, ...(typeof args.password === "string" ? { publicPassword: args.password || null } : {}) });
      return { ...updated, url: `/public/sites/${site.slug}` };
    },
  },
  {
    name: "delete_site",
    description: "Delete a site and its files.",
    inputSchema: input({ site: s("Site id or slug") }, ["site"]),
    run: async (args) => {
      await sites.deleteSite((await findSite(str(args, "site"))).id);
      return { ok: true };
    },
  },

  {
    name: "list_jobs",
    description: "List jobs in a workspace with status (scheduled, paused or manual) and nextRuns.",
    inputSchema: input({}),
    run: async () => ((await jobs.listJobs({})).items as Record<string, unknown>[]).map(({ code, draftCode, ...rest }) => rest),
  },
  {
    name: "get_job",
    description: "Get a job with its code.",
    inputSchema: input({ job: s("Job id or name") }, ["job"]),
    run: async (args) => jobs.toPublicJob(await findJob(str(args, "job"))),
  },
  {
    name: "create_job",
    description: "Create a cron job. cron: 5-field expressions, one per line, in the app timezone; empty = manual only. Returns status and nextRuns so you can check the schedule. See get_guide topic=jobs.",
    inputSchema: input({ name: s("Job name"), code: s("Bun/TypeScript script"), cron: s("Cron expression(s)"), description: s("Optional description"), timeout_ms: { type: "number" }, enabled: { type: "boolean", description: "Start paused with false. Default true when cron is set." } }, ["name", "code"]),
    run: async (args) =>
      jobs.createJob({
        name: str(args, "name"),
        code: str(args, "code"),
        cron: optStr(args, "cron") ?? "",
        description: optStr(args, "description") ?? null,
        ...(typeof args.timeout_ms === "number" ? { timeoutMs: args.timeout_ms } : {}),
        ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
      }),
  },
  {
    name: "update_job",
    description: "Update a job's name, code, cron, description, timeout or enabled. A job paused by a person stays paused unless you pass enabled=true; resume only when the user asked.",
    inputSchema: input({ job: s("Job id or name"), name: s("New name"), code: s("New script"), cron: s("New cron (empty string = manual only)"), description: s("New description"), timeout_ms: { type: "number" }, enabled: { type: "boolean", description: "false pauses the schedule, true resumes it" } }, ["job"]),
    run: async (args) => {
      const job = await findJob(str(args, "job"));
      return jobs.updateJob(job.id, {
        ...(typeof args.name === "string" ? { name: args.name } : {}),
        ...(typeof args.code === "string" ? { code: args.code } : {}),
        ...(typeof args.cron === "string" ? { cron: args.cron } : {}),
        ...(typeof args.description === "string" ? { description: args.description } : {}),
        ...(typeof args.timeout_ms === "number" ? { timeoutMs: args.timeout_ms } : {}),
        ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
      });
    },
  },
  {
    name: "run_job",
    description: "Run a job now. With wait=true, waits up to 120s and returns the run with logs.",
    inputSchema: input({ job: s("Job id or name"), wait: { type: "boolean" } }, ["job"]),
    run: async (args) => {
      const job = await findJob(str(args, "job"));
      const claimed = await jobs.tryClaimJob(job.id, "manual");
      if (!claimed) throw new Error("Job is already running");
      startClaimedRun(claimed.job.id, claimed.run.id, false);
      return args.wait === true ? waitForRun(claimed.run.id, 120_000) : claimed.run;
    },
  },
  {
    name: "get_job_runs",
    description: "Recent runs of a job with logs.",
    inputSchema: input({ job: s("Job id or name"), limit: { type: "number" } }, ["job"]),
    run: async (args) => {
      const job = await findJob(str(args, "job"));
      return jobs.listJobRuns(job.id, { limit: String(typeof args.limit === "number" ? args.limit : 5) });
    },
  },
  {
    name: "delete_job",
    description: "Delete a job.",
    inputSchema: input({ job: s("Job id or name") }, ["job"]),
    run: async (args) => {
      await jobs.deleteJob((await findJob(str(args, "job"))).id);
      return { ok: true };
    },
  },
];

const GROUP_RULES: [string, (name: string) => boolean][] = [
  ["Guide", (n) => n === "get_guide"],
  ["Workspaces", (n) => n.includes("workspace")],
  ["Tools", (n) => n.endsWith("_tool") || n.endsWith("_tools")],
  ["MCP servers", (n) => n.includes("mcp_server")],
  ["KV", (n) => n.startsWith("kv_")],
  ["Secrets", (n) => n.startsWith("secret_")],
  ["Datatables", (n) => n.startsWith("datatable_")],
  ["Sites", (n) => n.includes("site")],
  ["Jobs", (n) => n.includes("job")],
];

function groupOf(name: string): string {
  return GROUP_RULES.find(([, match]) => match(name))?.[0] ?? "Other";
}

export function listCoreToolGroups(): { group: string; tools: { name: string; description: string }[] }[] {
  const groups = new Map<string, { name: string; description: string }[]>();
  for (const [group] of GROUP_RULES) groups.set(group, []);
  for (const tool of CORE_TOOLS) {
    const group = groupOf(tool.name);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)?.push({ name: tool.name, description: tool.description });
  }
  return [...groups].filter(([, tools]) => tools.length > 0).map(([group, tools]) => ({ group, tools }));
}

function isFailedResult(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { ok?: unknown }).ok === false;
}

function formatResult(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null, null, 2);
}

export const coreMcpServer: McpServerHandler = {
  name: "agenthands-core",
  instructions: CORE_MCP_INSTRUCTIONS,
  listTools: async () => CORE_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  callTool: async (name, args) => {
    const tool = CORE_TOOLS.find((t) => t.name === name);
    if (!tool) return textResult(`Unknown tool: ${name}`, true);
    try {
      const value = tool.global ? await tool.run(args) : await runInWorkspace(await resolveWorkspaceId(args.workspace), () => tool.run(args));
      return textResult(formatResult(value), isFailedResult(value));
    } catch (err) {
      const message = err instanceof HttpException || err instanceof Error ? err.message : String(err);
      return textResult(message, true);
    }
  },
};
