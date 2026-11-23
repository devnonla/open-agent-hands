import { HttpException, NotFoundException } from "../../common/exceptions/http.exception.js";
import { absoluteUrl } from "../../common/utils/public-url.js";
import { type McpServerHandler, type McpToolDescriptor, textResult } from "../../common/mcp/json-rpc.js";
import * as datatables from "../datatables/datatables.service.js";
import type { OrderByItem, WhereFilter } from "../datatables/datatable-where.util.js";
import { startClaimedRun } from "../jobs/jobs-runner.js";
import * as jobs from "../jobs/jobs.service.js";
import * as kv from "../kvstore/kvstore.service.js";
import * as mcpServers from "../my-mcp-servers/my-mcp-servers.service.js";
import * as secrets from "../secrets/secrets.service.js";
import * as sites from "../sites/sites.service.js";
import * as storage from "../storage/storage.service.js";
import { buildJsonSchemaFromCode, parseMetaFromCode } from "../tools/common/code-annotations.js";
import * as toolFolders from "../tool-folders/tool-folders.service.js";
import * as tools from "../tools/tools.service.js";
import { CORE_MCP_INSTRUCTIONS, getGuide } from "./core-mcp-guide.js";

type Args = Record<string, unknown>;

type CoreTool = McpToolDescriptor & {
  run: (args: Args) => Promise<unknown>;
};

type Schema = Record<string, unknown>;

const MAX_INLINE_BYTES = 5 * 1024 * 1024;

const KV_PROJECT_HINT = 'KV project name or id. Defaults to "default".';

function s(description: string): Schema {
  return { type: "string", description };
}

function input(properties: Record<string, Schema>, required: string[] = []): object {
  return { type: "object", properties, required };
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

async function findFolder(ref: string) {
  const list = await toolFolders.listToolFolders({});
  const match = (list.items as { id: string; name: string; description: string | null; toolIds: string[] }[]).find((f) => f.id === ref || f.name === ref);
  if (!match) throw new NotFoundException(`Tool folder "${ref}" not found. Use list_tool_folders to see folders.`);
  return match;
}

async function findMcpServer(ref: string) {
  const list = await mcpServers.listMyMcpServers({});
  const match = (list.items as { id: string; name: string; tools: { id: string }[] }[]).find((m) => m.id === ref || m.name === ref);
  if (!match) throw new NotFoundException(`MCP server "${ref}" not found`);
  return match;
}

function forAgent<T extends { tools: { icon?: string | null }[] }>(server: T): T {
  return { ...server, tools: server.tools.map(({ icon: _icon, ...tool }) => tool) };
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

function toolSummary(tool: { id: string; name: string; label: string; description: string; folderId?: string | null; icon?: string | null }) {
  return { id: tool.id, name: tool.name, label: tool.label, description: tool.description, folderId: tool.folderId ?? null, hasIcon: !!tool.icon };
}

function spaceSummary(space: storage.SpaceSummary) {
  return { name: space.name, description: space.description, public: space.isPublic, fileCount: space.fileCount, totalBytes: space.totalBytes };
}

function fileSummary(file: storage.PublicStorageFile) {
  return { space: file.space, key: file.key, size: file.size, contentType: file.contentType, updatedAt: file.updatedAt, publicUrl: file.publicUrl };
}

async function fetchForStorage(url: string): Promise<{ data: ReadableStream<Uint8Array> | Uint8Array; contentType: string | null }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"url" is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error('"url" must start with http:// or https://');
  const res = await fetch(parsed);
  if (!res.ok) throw new Error(`Downloading ${url} failed: HTTP ${res.status}`);
  return { data: res.body ?? new Uint8Array(0), contentType: res.headers.get("content-type") };
}

async function waitForRun(runId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await jobs.getJobRun(runId);
    if (run && !jobs.isActiveRunStatus(run.status)) return jobs.toPublicJobRun(run);
    await Bun.sleep(500);
  }
  const run = await jobs.getJobRun(runId);
  return run ? jobs.toPublicJobRun(run) : null;
}

const CORE_TOOLS: CoreTool[] = [
  {
    name: "get_guide",
    description: "How to write tools, jobs and sites, and the @agenthands/runtime SDK. Read before writing code.",
    inputSchema: input({ topic: { type: "string", enum: ["tools", "jobs", "sites", "runtime", "all"] } }, ["topic"]),
    run: async (args) => getGuide(str(args, "topic")),
  },
  {
    name: "list_tools",
    description: "List tools (without code).",
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
    inputSchema: input({ code: s("Full TypeScript module with annotation header and export default async function main(input)"), folder_id: s("Optional tool folder id or name"), icon: s("Optional inline SVG icon shown in the UI (e.g. a Lucide icon, 24x24 viewBox, stroke=\"currentColor\"). Plain SVG only, max 8000 chars. Without it the UI shows a default icon.") }, ["code"]),
    run: async (args) => {
      const code = str(args, "code");
      const meta = parseMetaFromCode(code);
      if (!meta.label || !meta.name) throw new Error("Code must start with // @name <Label>");
      if (!meta.description) throw new Error("Code must include // @description <text>");
      const created = await tools.createTool({ name: meta.name, label: meta.label, description: meta.description, parameters: buildJsonSchemaFromCode(code), codeContent: code, icon: optStr(args, "icon"), folderId: optStr(args, "folder_id") ? (await findFolder(str(args, "folder_id"))).id : null });
      return toolSummary(await tools.updateTool(created.id as string, { codeContent: code }));
    },
  },
  {
    name: "update_tool",
    description: "Update a tool's code (annotations re-read) and/or its icon.",
    inputSchema: input({ tool: s("Tool id or name"), code: s("New full module"), icon: s("Inline SVG icon; empty string removes it and the UI falls back to the default icon") }, ["tool"]),
    run: async (args) => {
      const tool = await findTool(str(args, "tool"));
      const patch: Record<string, unknown> = {};
      if (typeof args.code === "string") patch.codeContent = args.code;
      if (typeof args.icon === "string") patch.icon = args.icon;
      if (!Object.keys(patch).length) throw new Error("Pass code and/or icon to update");
      return toolSummary(await tools.updateTool(tool.id, patch));
    },
  },
  {
    name: "manage_tool_folder",
    description: "Manage tool folders. action=list (folders with their tool ids), create (name, description?), update (folder, name?, description?), delete (folder, confirm=true; tools inside are NOT deleted, they become ungrouped). Use move_tool to put a tool in a folder.",
    inputSchema: input({ action: { type: "string", enum: ["list", "create", "update", "delete"] }, folder: s("Folder id or name (update, delete)"), name: s("Folder name (create) or new name (update)"), description: s("Description (create, update)"), confirm: { type: "boolean", description: "Required for delete" } }, ["action"]),
    run: async (args) => {
      const action = str(args, "action");
      if (action === "list") return ((await toolFolders.listToolFolders({})).items as { id: string; name: string; description: string | null; toolIds: string[] }[]).map(({ id, name, description, toolIds }) => ({ id, name, description, toolIds }));
      if (action === "create") {
        const name = str(args, "name");
        const existing = await toolFolders.listToolFolders({});
        if ((existing.items as { name: string }[]).some((f) => f.name.toLowerCase() === name.toLowerCase())) throw new Error(`Tool folder "${name}" already exists`);
        const { id, description } = await toolFolders.createToolFolder({ name, description: optStr(args, "description") });
        return { id, name, description };
      }
      if (action === "update") {
        const folder = await findFolder(str(args, "folder"));
        const patch: { name?: string; description?: string } = {};
        if (typeof args.name === "string" && args.name.trim()) patch.name = args.name.trim();
        if (typeof args.description === "string") patch.description = args.description;
        if (!Object.keys(patch).length) throw new Error("Pass name and/or description to update");
        const updated = (await toolFolders.updateToolFolder(folder.id, patch)) as { id: string; name: string; description: string | null };
        return { id: updated.id, name: updated.name, description: updated.description };
      }
      if (action === "delete") {
        if (args.confirm !== true) throw new Error("Set confirm=true to delete the folder (its tools become ungrouped)");
        const folder = await findFolder(str(args, "folder"));
        await toolFolders.deleteToolFolder(folder.id);
        return { ok: true, ungroupedTools: folder.toolIds.length };
      }
      throw new Error(`Unknown action "${action}". Use list, create, update or delete`);
    },
  },
  {
    name: "move_tool",
    description: "Move a tool into a tool folder. Omit folder (or pass an empty string) to make it ungrouped.",
    inputSchema: input({ tool: s("Tool id or name"), folder: s("Destination folder id or name; empty for ungrouped") }, ["tool"]),
    run: async (args) => {
      const tool = await findTool(str(args, "tool"));
      const ref = optStr(args, "folder")?.trim();
      const folderId = ref ? (await findFolder(ref)).id : null;
      return toolSummary(await tools.updateTool(tool.id, { folderId }));
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
    description: "List hosted MCP servers. Each one exposes a set of tools at /mcp/<id>.",
    inputSchema: input({}),
    run: async () => (await mcpServers.listMyMcpServers({})).items.map(forAgent),
  },
  {
    name: "create_mcp_server",
    description: "Create a hosted MCP server exposing the given tools. Returns the endpoint path and its Bearer key (shown once).",
    inputSchema: input({ name: s("Server name"), description: s("Optional description"), tools: { type: "array", items: { type: "string" }, description: "Tool ids or names" } }, ["name"]),
    run: async (args) => {
      const created = await mcpServers.createMyMcpServer({ name: str(args, "name"), description: optStr(args, "description") ?? null, toolIds: await toolIdsFor(strList(args, "tools")) });
      return { ...forAgent(created), endpoint: `/mcp/${created.id}` };
    },
  },
  {
    name: "update_mcp_server",
    description: "Rename or enable/disable a hosted MCP server. Passing tools REPLACES the whole tool list; use add_tools_to_mcp_server / remove_tools_from_mcp_server to change it incrementally.",
    inputSchema: input({ server: s("Server id or name"), name: s("New name"), active: { type: "boolean" }, tools: { type: "array", items: { type: "string" }, description: "Replaces assigned tools (ids or names)" } }, ["server"]),
    run: async (args) => {
      const server = await findMcpServer(str(args, "server"));
      return forAgent(await mcpServers.updateMyMcpServer(server.id, {
        ...(typeof args.name === "string" ? { name: args.name } : {}),
        ...(typeof args.active === "boolean" ? { isActive: args.active } : {}),
        ...(Array.isArray(args.tools) ? { toolIds: await toolIdsFor(strList(args, "tools")) } : {}),
      }));
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
      return forAgent(await mcpServers.updateMyMcpServer(server.id, { toolIds: [...ids] }));
    },
  },
  {
    name: "remove_tools_from_mcp_server",
    description: "Stop exposing some tools on a hosted MCP server. The tools themselves are not deleted.",
    inputSchema: input({ server: s("Server id or name"), tools: { type: "array", items: { type: "string" }, description: "Tool ids or names to remove" } }, ["server", "tools"]),
    run: async (args) => {
      const server = await findMcpServer(str(args, "server"));
      const remove = new Set(await toolIdsFor(strList(args, "tools")));
      return forAgent(await mcpServers.updateMyMcpServer(server.id, { toolIds: server.tools.map((tool) => tool.id).filter((id) => !remove.has(id)) }));
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
    name: "kv_list_projects",
    description: "List KV projects with how many keys each holds. Every key belongs to one project; \"default\" always exists.",
    inputSchema: input({}),
    run: async () => {
      const result = await kv.listKvProjects();
      return result.items.map(({ id, name, description, keyCount }) => ({ id, name, description, keyCount }));
    },
  },
  {
    name: "kv_list",
    description: "List KV entries. Pass project to list one project, or omit it to list every key with its project.",
    inputSchema: input({ project: s(KV_PROJECT_HINT) }),
    run: async (args) => {
      const ref = optStr(args, "project")?.trim();
      if (ref) await kv.requireKvProjectId(ref);
      const names = new Map((await kv.listKvProjects()).items.map((p) => [p.id, p.name]));
      const items = (await kv.listKvEntries({ sorts: "key", ...(ref ? { project: ref } : {}) })).items as { key: string; value: string; description: string | null; projectId: string }[];
      return items.map(({ key, value, description, projectId }) => ({ project: names.get(projectId) ?? projectId, key, value, description }));
    },
  },
  {
    name: "kv_get",
    description: "Get a KV value. Returns null when the key is not set.",
    inputSchema: input({ key: s("Key like BASE_URL"), project: s(KV_PROJECT_HINT) }, ["key"]),
    run: async (args) => (await kv.getKvByKey(str(args, "key"), await kv.requireKvProjectId(optStr(args, "project"))))?.value ?? null,
  },
  {
    name: "kv_set",
    description: "Create or update a KV entry. Keys match [A-Z][A-Z0-9_]*. A project that does not exist yet is created.",
    inputSchema: input({ key: s("Key"), value: s("Value"), project: s(`${KV_PROJECT_HINT} Created if missing.`) }, ["key", "value"]),
    run: async (args) => {
      const projectId = await kv.ensureKvProjectId(optStr(args, "project"));
      const entry = await kv.upsertKvByKey({ key: str(args, "key"), value: typeof args.value === "string" ? args.value : JSON.stringify(args.value ?? ""), projectId });
      return entry ? { project: optStr(args, "project")?.trim() || kv.DEFAULT_KV_PROJECT, key: entry.key, value: entry.value } : null;
    },
  },
  {
    name: "kv_delete",
    description: "Delete a KV entry.",
    inputSchema: input({ key: s("Key"), project: s(KV_PROJECT_HINT) }, ["key"]),
    run: async (args) => kv.deleteKvByKey(str(args, "key"), await kv.requireKvProjectId(optStr(args, "project"))),
  },
  {
    name: "kv_delete_project",
    description: "Delete a KV project and every key in it. The default project cannot be deleted. Requires confirm=true.",
    inputSchema: input({ project: s("Project id or name"), confirm: { type: "boolean" } }, ["project", "confirm"]),
    run: async (args) => {
      if (args.confirm !== true) throw new Error("Set confirm=true to delete the KV project and all its keys");
      const projectId = await kv.requireKvProjectId(str(args, "project"));
      return { ok: true, ...(await kv.deleteKvProject(projectId)) };
    },
  },

  {
    name: "secret_list",
    description: "List secret keys (values are never returned).",
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
    name: "storage_list_spaces",
    description: "List storage spaces with file count, total bytes and whether files are public.",
    inputSchema: input({}),
    run: async () => (await storage.listSpaces()).items.map(spaceSummary),
  },
  {
    name: "storage_create_space",
    description: "Create a storage space. Names are 2-63 lowercase letters, digits or -. public=true gives every file a full link that works without login (publicUrl, <public URL>/public/storage/<random token>/<file name>); links cannot be guessed or listed. Default private.",
    inputSchema: input({ name: s("Space name, e.g. reports"), description: s("What the space holds, one short sentence"), public: { type: "boolean", description: "Serve files publicly without login. Default false." } }, ["name"]),
    run: async (args) => spaceSummary(await storage.createSpace({ name: str(args, "name"), description: optStr(args, "description") ?? null, isPublic: args.public === true })),
  },
  {
    name: "storage_update_space",
    description: "Change a space's description or public flag. public=true makes every file readable by anyone who has its publicUrl; only do that when the user asked. Turning it off stops all its links; turning it on again brings back the same links.",
    inputSchema: input({ space: s("Space name or id"), description: s("New description"), public: { type: "boolean", description: "true: every file gets a publicUrl anyone can open. false: private." } }, ["space"]),
    run: async (args) => {
      const space = await storage.requireSpace(str(args, "space"));
      if (typeof args.description !== "string" && typeof args.public !== "boolean") throw new Error("Pass description and/or public to update");
      return spaceSummary(await storage.updateSpace(space.id, { ...(typeof args.description === "string" ? { description: args.description } : {}), ...(typeof args.public === "boolean" ? { isPublic: args.public } : {}) }));
    },
  },
  {
    name: "storage_delete_space",
    description: "Delete a space and every file in it. Cannot be undone. Requires confirm=true.",
    inputSchema: input({ space: s("Space name or id"), confirm: { type: "boolean" } }, ["space", "confirm"]),
    run: async (args) => {
      if (args.confirm !== true) throw new Error("Set confirm=true to delete the space and all its files");
      const space = await storage.requireSpace(str(args, "space"));
      return { ok: true, ...(await storage.deleteSpace(space.id)) };
    },
  },
  {
    name: "storage_list_files",
    description: "List files in a space, sorted by key. Keys use / for folders; pass prefix (e.g. reports/2026/) to list one folder. folders=true lists only that level: sub-folders with their counts, plus the files directly in it.",
    inputSchema: input({ space: s("Space name or id"), prefix: s("Only keys starting with this"), folders: { type: "boolean", description: "Group deeper keys into folders" }, limit: { type: "number", description: "Max 1000, default 200" }, offset: { type: "number" } }, ["space"]),
    run: async (args) => {
      const space = await storage.requireSpace(str(args, "space"));
      if (args.folders === true) {
        const view = await storage.browseFiles(space, optStr(args, "prefix") ?? "");
        return { prefix: view.prefix, folders: view.folders, items: view.items.map(fileSummary) };
      }
      const result = await storage.listFiles(space, { prefix: optStr(args, "prefix"), limit: typeof args.limit === "number" ? args.limit : 200, offset: typeof args.offset === "number" ? args.offset : 0 });
      return { total: result.total, items: result.items.map(fileSummary) };
    },
  },
  {
    name: "storage_put_file",
    description: "Write a file to a space, replacing any file with the same key. Pass content (utf8 text, or base64 with encoding=base64) or url to download from (the server streams it to disk, any size; this can take a while for big files). The space is created (private) if it does not exist. No size limit.",
    inputSchema: input(
      {
        space: s("Space name or id; created if missing"),
        key: s("File path in the space, e.g. reports/2026-11.csv"),
        content: s("File content"),
        encoding: { type: "string", enum: ["utf8", "base64"], description: "How content is encoded. Default utf8." },
        url: s("http(s) URL to download instead of content"),
        content_type: s("MIME type. Default: guessed from the key's extension."),
      },
      ["space", "key"],
    ),
    run: async (args) => {
      const hasContent = typeof args.content === "string";
      const url = optStr(args, "url")?.trim();
      if (hasContent === !!url) throw new Error("Pass exactly one of content or url");
      let data: ReadableStream<Uint8Array> | Uint8Array;
      let contentType = optStr(args, "content_type")?.trim() || null;
      if (url) {
        const fetched = await fetchForStorage(url);
        data = fetched.data;
        contentType ??= fetched.contentType;
      } else {
        const encoding = optStr(args, "encoding") ?? "utf8";
        if (encoding !== "utf8" && encoding !== "base64") throw new Error('encoding must be "utf8" or "base64"');
        data = encoding === "base64" ? new Uint8Array(Buffer.from(args.content as string, "base64")) : new TextEncoder().encode(args.content as string);
      }
      const space = await storage.ensureSpace(str(args, "space"));
      return fileSummary(await storage.putFile(space, { key: str(args, "key"), data, contentType }));
    },
  },
  {
    name: "storage_get_file",
    description: "Read a file. Text types come back as utf8, others as base64 (override with encoding). Files over 5 MB are not returned inline; use publicUrl or read them from a tool with agenthands.storage.",
    inputSchema: input({ space: s("Space name or id"), key: s("File key"), encoding: { type: "string", enum: ["utf8", "base64"] } }, ["space", "key"]),
    run: async (args) => {
      const space = await storage.requireSpace(str(args, "space"));
      const file = await storage.requireFile(space, str(args, "key"));
      const meta = fileSummary({ ...file, space: space.name, publicUrl: space.isPublic ? storage.publicFileUrl(file) : null });
      if (file.size > MAX_INLINE_BYTES) throw new Error(`${file.key} is ${file.size} bytes; storage_get_file returns at most 5 MB. Read it from a tool with agenthands.storage.space("${space.name}").get(key).`);
      const encoding = optStr(args, "encoding") ?? (storage.isTextContentType(file.contentType) ? "utf8" : "base64");
      const bytes = await storage.readFileBytes(file);
      return { ...meta, encoding, content: encoding === "base64" ? Buffer.from(bytes).toString("base64") : new TextDecoder().decode(bytes) };
    },
  },
  {
    name: "storage_reset_public_link",
    description: "Give one file a new publicUrl. The old link stops working at once. Use it when a link was shared too widely.",
    inputSchema: input({ space: s("Space name or id"), key: s("File key") }, ["space", "key"]),
    run: async (args) => {
      const space = await storage.requireSpace(str(args, "space"));
      return fileSummary(await storage.resetPublicLink(await storage.requireFile(space, str(args, "key"))));
    },
  },
  {
    name: "storage_delete_file",
    description: "Delete one file from a space.",
    inputSchema: input({ space: s("Space name or id"), key: s("File key") }, ["space", "key"]),
    run: async (args) => {
      const space = await storage.requireSpace(str(args, "space"));
      const file = await storage.requireFile(space, str(args, "key"));
      await storage.deleteFile(file);
      return { ok: true, key: file.key };
    },
  },

  {
    name: "list_sites",
    description: "List sites.",
    inputSchema: input({}),
    run: async () => (await sites.listSites({})).items,
  },
  {
    name: "create_site",
    description: "Create a site with starter files. Slug is lowercase-kebab and unique; it becomes /public/sites/<slug>. Returns the full url.",
    inputSchema: input({ name: s("Site name"), slug: s("URL slug") }, ["name", "slug"]),
    run: async (args) => {
      const site = await sites.createSite({ name: str(args, "name"), slug: str(args, "slug") });
      return { ...site, url: absoluteUrl(`/public/sites/${site.slug}`) };
    },
  },
  {
    name: "get_site_files",
    description: "Read app.tsx, backend.ts, styles.css and package.json of a site.",
    inputSchema: input({ site: s("Site id or slug") }, ["site"]),
    run: async (args) => sites.getSiteFiles((await findSite(str(args, "site"))).id),
  },
  {
    name: "write_site_file",
    description: "Write a site file (app.tsx, backend.ts or styles.css). The change is live at once on the site URL, with no review step. npm imports are installed automatically. See get_guide topic=sites.",
    inputSchema: input({ site: s("Site id or slug"), file: { type: "string", enum: ["app.tsx", "backend.ts", "styles.css"] }, content: s("Full file content") }, ["site", "file", "content"]),
    run: async (args) => {
      const site = await findSite(str(args, "site"));
      await sites.updateSiteFile(site.id, str(args, "file"), typeof args.content === "string" ? args.content : "");
      return { ok: true };
    },
  },
  {
    name: "preview_site",
    description: "Bundle the site and run the backend GET. Returns the backend data or the build error. Call it after write_site_file to check the change.",
    inputSchema: input({ site: s("Site id or slug") }, ["site"]),
    run: async (args) => {
      const preview = await sites.previewSite((await findSite(str(args, "site"))).id);
      return { ok: true, data: preview.data, appJsChars: preview.appJsChars };
    },
  },
  {
    name: "publish_site",
    description: "Publish or unpublish a site, optionally with a password (empty string removes it).",
    inputSchema: input({ site: s("Site id or slug"), published: { type: "boolean" }, password: s("Optional access password") }, ["site", "published"]),
    run: async (args) => {
      const site = await findSite(str(args, "site"));
      const updated = await sites.updateSite(site.id, { isPublished: args.published === true, ...(typeof args.password === "string" ? { publicPassword: args.password || null } : {}) });
      return { ...updated, url: absoluteUrl(`/public/sites/${site.slug}`) };
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
    description: "List jobs with status (scheduled, paused or manual) and nextRuns.",
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
    inputSchema: input({ name: s('Readable title people see in the jobs list, in plain words, e.g. "Sync GitHub issues". Not kebab-case.'), code: s("Bun/TypeScript script"), cron: s("Cron expression(s)"), description: s("Optional description"), timeout_ms: { type: "number", description: "Limit for one attempt. Default 300000 (5 min)." }, max_retries: { type: "number", description: "Run the whole script again this many times when it fails (0-5, default 0). Waits 5s, 10s, 20s… between attempts. Only for idempotent jobs." }, enabled: { type: "boolean", description: "Start paused with false. Default true when cron is set." } }, ["name", "code"]),
    run: async (args) =>
      jobs.createJob({
        name: str(args, "name"),
        code: str(args, "code"),
        cron: optStr(args, "cron") ?? "",
        description: optStr(args, "description") ?? null,
        ...(typeof args.timeout_ms === "number" ? { timeoutMs: args.timeout_ms } : {}),
        ...(typeof args.max_retries === "number" ? { maxRetries: args.max_retries } : {}),
        ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
      }),
  },
  {
    name: "update_job",
    description: "Update a job's name, code, cron, description, timeout, retries or enabled. A job paused by a person stays paused unless you pass enabled=true; resume only when the user asked.",
    inputSchema: input({ job: s("Job id or name"), name: s("New name"), code: s("New script"), cron: s("New cron (empty string = manual only)"), description: s("New description"), timeout_ms: { type: "number", description: "Limit for one attempt" }, max_retries: { type: "number", description: "0-5 whole-run retries on failure" }, enabled: { type: "boolean", description: "false pauses the schedule, true resumes it" } }, ["job"]),
    run: async (args) => {
      const job = await findJob(str(args, "job"));
      return jobs.updateJob(job.id, {
        ...(typeof args.name === "string" ? { name: args.name } : {}),
        ...(typeof args.code === "string" ? { code: args.code } : {}),
        ...(typeof args.cron === "string" ? { cron: args.cron } : {}),
        ...(typeof args.description === "string" ? { description: args.description } : {}),
        ...(typeof args.timeout_ms === "number" ? { timeoutMs: args.timeout_ms } : {}),
        ...(typeof args.max_retries === "number" ? { maxRetries: args.max_retries } : {}),
        ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
      });
    },
  },
  {
    name: "run_job",
    description: "Run a job now. input (any JSON, up to 64KB) reaches the script as agenthands.run.input. With wait=true, waits up to 120s and returns the run with status, output, error and logs.",
    inputSchema: input({ job: s("Job id or name"), input: { description: "Optional JSON value passed to the run" }, wait: { type: "boolean" } }, ["job"]),
    run: async (args) => {
      const job = await findJob(str(args, "job"));
      const claimed = await jobs.tryClaimJob(job.id, "manual", { input: args.input });
      if (!claimed) throw new Error("Job is already running");
      startClaimedRun(claimed.job.id, claimed.run.id, false);
      return args.wait === true ? waitForRun(claimed.run.id, 120_000) : claimed.run;
    },
  },
  {
    name: "get_job_runs",
    description: "Recent runs of a job: status, attempts, input, output, error and logs.",
    inputSchema: input({ job: s("Job id or name"), limit: { type: "number" } }, ["job"]),
    run: async (args) => {
      const job = await findJob(str(args, "job"));
      return jobs.listJobRuns(job.id, { limit: String(typeof args.limit === "number" ? args.limit : 5) });
    },
  },
  {
    name: "clear_job_runs",
    description: "Delete the finished run history (logs, input, output) of a job. Queued or running runs are kept. The job and its schedule stay. Requires confirm=true.",
    inputSchema: input({ job: s("Job id or name"), confirm: { type: "boolean" } }, ["job", "confirm"]),
    run: async (args) => {
      if (args.confirm !== true) throw new Error("Set confirm=true to delete this job's run history");
      return jobs.clearJobRuns((await findJob(str(args, "job"))).id);
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
  ["Tools", (n) => n.endsWith("_tool") || n.endsWith("_tools")],
  ["MCP servers", (n) => n.includes("mcp_server")],
  ["KV", (n) => n.startsWith("kv_")],
  ["Secrets", (n) => n.startsWith("secret_")],
  ["Datatables", (n) => n.startsWith("datatable_")],
  ["Storage", (n) => n.startsWith("storage_")],
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
      const value = await tool.run(args);
      return textResult(formatResult(value), isFailedResult(value));
    } catch (err) {
      const message = err instanceof HttpException || err instanceof Error ? err.message : String(err);
      return textResult(message, true);
    }
  },
};
