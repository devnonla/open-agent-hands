import { HttpException, NotFoundException } from "../../common/exceptions/http.exception.js";
import { absoluteUrl, publicUrlInfo, requestOrigin } from "../../common/utils/public-url.js";
import { TEXT_EDITS_SCHEMA, applyTextEdits } from "../../common/utils/text-edits.js";
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
import { buildJsonSchemaFromCode, paramAnnotationError, parseMetaFromCode } from "../tools/common/code-annotations.js";
import * as toolFolders from "../tool-folders/tool-folders.service.js";
import * as tools from "../tools/tools.service.js";
import { CORE_MCP_INSTRUCTIONS, getGuide } from "./core-mcp-guide.js";
import { groupOf, groupTools } from "./core-mcp-groups.js";

type Args = Record<string, unknown>;

type CoreTool = McpToolDescriptor & {
  run: (args: Args, request?: Request) => Promise<unknown>;
};

type Schema = Record<string, unknown>;

const MAX_INLINE_BYTES = 256 * 1024;
const MAX_RESULT_CHARS = 20_000;
const MAX_TEXT_CHARS = 4_000;
const MAX_LOG_CHARS = 500;
const DEFAULT_LOG_TAIL = 50;
const MAX_LOG_PAGE = 500;
const KV_PREVIEW_CHARS = 200;
const SITE_FILES = ["app.tsx", "backend.ts", "styles.css", "package.json"];

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

async function findTools(refs: string[]) {
  const all = (await tools.listTools({})).items as { id: string; name: string }[];
  const matches = refs.map((ref) => all.find((t) => t.id === ref || t.name === ref));
  const missing = refs.filter((_, i) => !matches[i]);
  if (missing.length) throw missingError("Tools", missing, "Use list_tools to see tool names.");
  const unique = [...new Map(matches.map((t) => [t!.id, t!])).values()];
  return Promise.all(unique.map(async (t) => (await tools.getTool(t.id))!));
}

async function findFolder(ref: string) {
  const list = await toolFolders.listToolFolders({});
  const match = (list.items as { id: string; name: string; description: string | null; toolIds: string[] }[]).find((f) => f.id === ref || f.name === ref);
  if (!match) throw new NotFoundException(`Tool folder "${ref}" not found. Use manage_tool_folder { action: "list" } to see folders.`);
  return match;
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

type ToolRow = { id: string; name: string; label: string; description: string; folderId?: string | null; icon?: string | null };

async function folderNames(): Promise<Map<string, string>> {
  return new Map(((await toolFolders.listToolFolders({})).items as { id: string; name: string }[]).map((f) => [f.id, f.name]));
}

function toolSummary(tool: ToolRow, folders: Map<string, string>) {
  return { id: tool.id, name: tool.name, label: tool.label, description: tool.description, folder: tool.folderId ? (folders.get(tool.folderId) ?? null) : null, hasIcon: !!tool.icon };
}

async function toolResult(tool: ToolRow) {
  return toolSummary(tool, await folderNames());
}

function spaceSummary(space: storage.SpaceSummary) {
  return { name: space.name, description: space.description, public: space.isPublic, fileCount: space.fileCount, totalBytes: space.totalBytes };
}

function fileSummary(file: storage.PublicStorageFile) {
  return { space: file.space, key: file.key, size: file.size, contentType: file.contentType, updatedAt: file.updatedAt, publicUrl: file.publicUrl };
}

function capJson(value: unknown, max = MAX_RESULT_CHARS): { value: unknown; totalChars?: number } {
  const json = value === undefined ? undefined : JSON.stringify(value);
  if (json === undefined || json.length <= max) return { value };
  return { value: json.slice(0, max), totalChars: json.length };
}

function headText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…(${text.length - max} more chars)`;
}

function tailText(text: string, max: number): string {
  return text.length <= max ? text : `…(${text.length - max} earlier chars cut)\n${text.slice(-max)}`;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function cappedField(name: string, value: unknown, max = MAX_RESULT_CHARS, hint?: string): Record<string, unknown> {
  if (value === undefined) return {};
  const capped = capJson(value, max);
  return { [name]: capped.value, ...(capped.totalChars ? { [`${name}Truncated`]: { totalChars: capped.totalChars, ...(hint ? { hint } : {}) } } : {}) };
}

type StorageFileRow = NonNullable<Awaited<ReturnType<typeof storage.getFileByKey>>>;

type ToolOutcome = { ok?: boolean; result?: unknown; error?: string; console?: string | null } & Record<string, unknown>;

function toolOutcomeForAgent(outcome: ToolOutcome | null) {
  if (!outcome || typeof outcome !== "object") return outcome;
  const { result, error, console: out, ...rest } = outcome;
  return {
    ...rest,
    ...cappedField("result", result, MAX_RESULT_CHARS, "The result is cut to 20000 chars of JSON. Return less, or put big output in storage from the tool and return its key."),
    ...(typeof error === "string" ? { error: headText(error, MAX_TEXT_CHARS) } : {}),
    ...(typeof out === "string" ? { console: tailText(out, MAX_TEXT_CHARS) } : out === null ? { console: null } : {}),
  };
}

function logForAgent(entry: jobs.JobLogEntry) {
  const { kind: _kind, message, data, error, ...rest } = entry;
  return { ...rest, message: headText(message, MAX_LOG_CHARS), ...(typeof error === "string" ? { error: headText(error, MAX_LOG_CHARS) } : {}), ...cappedField("data", data, MAX_LOG_CHARS) };
}

function runSummary(run: jobs.PublicJobRun) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    attempts: run.attempts,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error ? headText(run.error, MAX_LOG_CHARS) : null,
    ...cappedField("output", run.output, 2_000),
    logCount: run.logs.length,
  };
}

function runDetail(run: jobs.PublicJobRun, opts: { logOffset?: unknown; logLimit?: unknown } = {}) {
  const count = run.logs.length;
  const limit = clampInt(opts.logLimit, 1, MAX_LOG_PAGE, DEFAULT_LOG_TAIL);
  const offset = clampInt(opts.logOffset, 0, count, Math.max(0, count - limit));
  return {
    ...runSummary(run),
    error: run.error ? headText(run.error, MAX_TEXT_CHARS) : null,
    ...cappedField("input", run.input),
    ...cappedField("output", run.output),
    logOffset: offset,
    logs: run.logs.slice(offset, offset + limit).map(logForAgent),
    ...(offset > 0 || offset + limit < count ? { logHint: `Showing logs ${offset}-${Math.min(count, offset + limit) - 1} of ${count}. Page with get_job_runs { run, log_offset, log_limit }.` } : {}),
  };
}

function jobForAgent<T extends Record<string, unknown>>(job: T, mode: "list" | "full" | "result") {
  const { leaseOwner: _o, leaseUntil: _u, draftCode: _d, createdAt: _c, nextRunAt: _n, code, recentRuns: _r, timeoutMs, maxRetries, ...rest } = job;
  if (mode === "list") return rest;
  return { ...rest, timeoutMs, maxRetries, ...(mode === "full" ? { code } : {}) };
}

type SiteRow = { id: string; name: string; slug: string; isPublished: boolean; hasPublicPassword?: boolean; depsError?: string | null; draftDepsError?: string | null; updatedAt?: unknown };

function siteForAgent(site: SiteRow) {
  const depsError = site.draftDepsError || site.depsError;
  return { id: site.id, name: site.name, slug: site.slug, isPublished: site.isPublished, hasPublicPassword: !!site.hasPublicPassword, url: absoluteUrl(`/public/sites/${site.slug}`), updatedAt: site.updatedAt, ...(depsError ? { depsError } : {}) };
}

async function toolForAgent(tool: ToolRow & { parameters?: unknown; codeContent?: string | null; updatedAt?: unknown }) {
  return { ...(await toolResult(tool)), parameters: tool.parameters, code: tool.codeContent, updatedAt: tool.updatedAt };
}

type McpServerRow = { id: string; name: string; description: string | null; isActive: boolean; tools: { name: string }[]; keyPrefix?: string | null; lastUsedAt?: unknown; key?: string };

function mcpServerForAgent(server: McpServerRow) {
  return { id: server.id, name: server.name, description: server.description, isActive: server.isActive, endpoint: `/mcp/${server.id}`, tools: server.tools.map((tool) => tool.name), keyPrefix: server.keyPrefix ?? null, lastUsedAt: server.lastUsedAt ?? null, ...(server.key ? { key: server.key } : {}) };
}

function rowForAgent(row: { id: string; data: unknown }) {
  return { id: row.id, data: row.data };
}

function fileInList(file: storage.PublicStorageFile) {
  const { space: _space, ...rest } = fileSummary(file);
  return rest;
}

function linkBase(request?: Request): string {
  const info = publicUrlInfo();
  return info.source === "setting" || !request ? info.effective : requestOrigin(request);
}

type SchemaRow = { project: { name: string }; tables: { name: string; columns: { name: string; type: string; options: unknown; required: boolean }[] }[] };

function schemaForAgent(schema: SchemaRow) {
  return { project: schema.project.name, tables: schema.tables.map((table) => ({ name: table.name, columns: table.columns.map((c) => ({ name: c.name, type: c.type, ...(c.options ? { options: c.options } : {}), ...(c.required ? { required: true } : {}) })) })) };
}

const MAX_BATCH = 100;

function batch(args: Args, key: string, example: string, legacy: string[] = [], max = MAX_BATCH): unknown[] {
  const old = legacy.find((name) => args[name] !== undefined);
  if (old && args[key] === undefined) throw new Error(`"${old}" is gone: pass "${key}" as an array, even for one item, e.g. ${key}: ${example}`);
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) throw new Error(`"${key}" must be a non-empty array, e.g. ${key}: ${example}`);
  if (value.length > max) throw new Error(`"${key}" has ${value.length} items; the most per call is ${max}. Split it into several calls.`);
  return value;
}

function batchNames(args: Args, key: string, example: string, legacy: string[] = [], max = MAX_BATCH): string[] {
  const names = batch(args, key, example, legacy, max).map((v, i) => {
    if (typeof v !== "string" || !v.trim()) throw new Error(`${key}[${i}] must be a non-empty string`);
    return v.trim();
  });
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dupes.length) throw new Error(`"${key}" lists ${dupes.join(", ")} more than once`);
  return names;
}

function storageKeys(args: Args, example: string): string[] {
  const keys = batchNames(args, "keys", example, ["key"]).map((key, i) => {
    try {
      return storage.normalizeKey(key);
    } catch (err) {
      throw new Error(`keys[${i}]: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (dupes.length) throw new Error(`"keys" lists ${dupes.join(", ")} more than once`);
  return keys;
}

type NewColumn = { name: string; type: string; options?: string[]; required: boolean };

function checkColumns(raw: unknown[], existing: Set<string>, nothingDone: string): NewColumn[] {
  return raw.map((item, i) => {
    const column = (item ?? {}) as { name?: unknown; type?: unknown; options?: unknown; required?: unknown };
    try {
      const name = datatables.assertColumnName(typeof column.name === "string" ? column.name : "");
      const type = datatables.assertColumnType(typeof column.type === "string" ? column.type : "");
      if (existing.has(name)) throw new Error(`column "${name}" is listed twice or already exists`);
      existing.add(name);
      return { name, type, options: Array.isArray(column.options) ? column.options.filter((o): o is string => typeof o === "string") : undefined, required: column.required === true };
    } catch (err) {
      throw new Error(`columns[${i}]: ${err instanceof Error ? err.message : String(err)}. ${nothingDone}`);
    }
  });
}

function missingError(kind: string, missing: string[], hint: string): Error {
  return new Error(`${kind} not found: ${missing.join(", ")}. Nothing was changed. ${hint}`);
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
    description: "List tools by name and description, without code or input schema. Use get_tool_schema for a tool's input and run_tool to call it.",
    inputSchema: input({}),
    run: async () => {
      const folders = await folderNames();
      return ((await tools.listTools({})).items as ToolRow[]).map((tool) => toolSummary(tool, folders));
    },
  },
  {
    name: "get_tool_schema",
    description: "Get the input JSON schemas of one or more saved tools in one call, by id or name, without their code. Saved tools are not MCP tools of this session: call each with run_tool { tool, input }, where input matches its schema.",
    inputSchema: input({ tools: { type: "array", items: { type: "string" }, description: "Tool ids or names" } }, ["tools"]),
    run: async (args) => {
      const refs = [...new Set(strList(args, "tools"))];
      if (!refs.length) throw new Error('"tools" must list at least one tool id or name');
      const all = (await tools.listTools({})).items as { id: string; name: string; description: string; parameters: unknown }[];
      const found = refs.map((ref) => all.find((t) => t.id === ref || t.name === ref));
      const missing = refs.filter((_, i) => !found[i]);
      if (missing.length) throw new NotFoundException(`Tools not found: ${missing.join(", ")}. Use list_tools to see tool names.`);
      const unique = [...new Map(found.map((t) => [t!.id, t!])).values()];
      return { callWith: "run_tool", tools: unique.map((t) => ({ tool: t.name, description: t.description, input: t.parameters })) };
    },
  },
  {
    name: "get_tool",
    description: "Get one or more tools with their code and input schema, by id or name.",
    inputSchema: input({ tools: { type: "array", items: { type: "string" }, description: "Tool ids or names, up to 100" } }, ["tools"]),
    run: async (args) => {
      const refs = batchNames(args, "tools", '["weather_lookup"]', ["tool"]);
      const found = await findTools(refs);
      return Promise.all(found.map(toolForAgent));
    },
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
      const typeError = paramAnnotationError(code);
      if (typeError) throw new Error(typeError);
      const created = await tools.createTool({ name: meta.name, label: meta.label, description: meta.description, parameters: buildJsonSchemaFromCode(code), codeContent: code, icon: optStr(args, "icon"), folderId: optStr(args, "folder_id") ? (await findFolder(str(args, "folder_id"))).id : null });
      return toolResult(await tools.updateTool(created.id as string, { codeContent: code }));
    },
  },
  {
    name: "edit_tool_code",
    description: "Change a tool's code. Pass edits [{ old_string, new_string, replace_all? }] to replace exact text: applied in order, all or nothing, and each old_string must match exactly one place unless replace_all. Or pass code to replace the whole module. Read the current code with get_tool first. The @name/@description/@param header is re-read, and the change is live at once on every MCP server that exposes the tool. Test a draft first with run_tool { code }.",
    inputSchema: input({ tool: s("Tool id or name"), edits: TEXT_EDITS_SCHEMA, code: s("The whole new module, instead of edits, for a rewrite") }, ["tool"]),
    run: async (args) => {
      const tool = await findTool(str(args, "tool"));
      const hasCode = typeof args.code === "string";
      if (hasCode === (args.edits !== undefined)) throw new Error("Pass exactly one of edits (exact-text replacements) or code (the whole module)");
      const current = tool.codeContent ?? "";
      const edited = hasCode ? { text: str(args, "code"), replacements: null } : applyTextEdits(current, args.edits, `Read the current code with get_tool { tools: ["${tool.name}"] }`);
      if (!edited.text.trim()) throw new Error("These edits would leave the tool with no code. Nothing was changed. To remove the tool, use delete_tool.");
      const saved = await tools.updateTool(tool.id, { codeContent: edited.text });
      return { ...(await toolResult(saved)), ...(edited.replacements !== null ? { replacements: edited.replacements } : {}), parameters: saved.parameters };
    },
  },
  {
    name: "update_tool",
    description: "Change a tool's icon. To change its code use edit_tool_code.",
    inputSchema: input({ tool: s("Tool id or name"), icon: s("Inline SVG icon (plain SVG, viewBox, max 8000 chars); empty string removes it and the UI falls back to the default icon") }, ["tool", "icon"]),
    run: async (args) => {
      const tool = await findTool(str(args, "tool"));
      if (typeof args.code === "string" || args.edits !== undefined) throw new Error("update_tool only changes the icon. Change code with edit_tool_code { tool, edits } or { tool, code }");
      if (typeof args.icon !== "string") throw new Error("Pass icon (an inline SVG string, or an empty string to remove it)");
      return toolResult(await tools.updateTool(tool.id, { icon: args.icon }));
    },
  },
  {
    name: "manage_tool_folder",
    description: "Manage tool folders. action=list (folders with their tool names), create (name, description?), update (folder, name?, description?), delete (folder, confirm=true; tools inside are NOT deleted, they become ungrouped). Use move_tool to put a tool in a folder.",
    inputSchema: input({ action: { type: "string", enum: ["list", "create", "update", "delete"] }, folder: s("Folder id or name (update, delete)"), name: s("Folder name (create) or new name (update)"), description: s("Description (create, update)"), confirm: { type: "boolean", description: "Required for delete" } }, ["action"]),
    run: async (args) => {
      const action = str(args, "action");
      if (action === "list") {
        const toolNames = new Map(((await tools.listTools({})).items as ToolRow[]).map((tool) => [tool.id, tool.name]));
        return ((await toolFolders.listToolFolders({})).items as { id: string; name: string; description: string | null; toolIds: string[] }[]).map(({ id, name, description, toolIds }) => ({ id, name, description, tools: toolIds.map((toolId) => toolNames.get(toolId) ?? toolId) }));
      }
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
    description: "Move one or more tools into a tool folder. Omit folder (or pass an empty string) to make them ungrouped.",
    inputSchema: input({ tools: { type: "array", items: { type: "string" }, description: "Tool ids or names, up to 100" }, folder: s("Destination folder id or name; empty for ungrouped") }, ["tools"]),
    run: async (args) => {
      const found = await findTools(batchNames(args, "tools", '["weather_lookup"]', ["tool"]));
      const ref = optStr(args, "folder")?.trim();
      const folder = ref ? await findFolder(ref) : null;
      for (const tool of found) await tools.updateTool(tool.id, { folderId: folder?.id ?? null });
      return { folder: folder?.name ?? null, moved: found.map((tool) => tool.name) };
    },
  },
  {
    name: "run_tool",
    description: "Run any tool by id or name for real in its sandbox (side effects happen), including one created moments ago, with no MCP reconnect. Get its input with get_tool_schema. Returns { ok, result } or { ok: false, error, console } with the stack trace. result is cut at 20000 chars of JSON (resultTruncated says so) and console keeps its last 4000 chars. Pass code to test a draft without saving. Type errors are not checked; only runtime and syntax errors surface.",
    inputSchema: input({ tool: s("Tool id or name"), input: { type: "object", description: "Input object for main(input)" }, code: s("Optional draft code to run instead of the saved code") }, ["tool"]),
    run: async (args) => {
      const tool = await findTool(str(args, "tool"));
      return toolOutcomeForAgent(await tools.runTool(tool.id, JSON.stringify(args.input && typeof args.input === "object" ? args.input : {}), optStr(args, "code")));
    },
  },
  {
    name: "delete_tool",
    description: "Delete one or more tools. They are removed from every MCP server too. Cannot be undone. Requires confirm=true. If any tool is missing, nothing is deleted.",
    inputSchema: input({ tools: { type: "array", items: { type: "string" }, description: "Tool ids or names, up to 100" }, confirm: { type: "boolean", description: "Must be true" } }, ["tools", "confirm"]),
    run: async (args) => {
      if (args.confirm !== true) throw new Error("Set confirm=true to delete these tools; they are also removed from every MCP server");
      const found = await findTools(batchNames(args, "tools", '["old_tool"]', ["tool"]));
      for (const tool of found) await tools.deleteTool(tool.id);
      return { ok: true, deleted: found.map((tool) => tool.name) };
    },
  },

  {
    name: "list_mcp_servers",
    description: "List hosted MCP servers with the names of the tools each one exposes at its endpoint.",
    inputSchema: input({}),
    run: async () => ((await mcpServers.listMyMcpServers({})).items as McpServerRow[]).map(mcpServerForAgent),
  },
  {
    name: "create_mcp_server",
    description: "Create a hosted MCP server exposing the given tools. Returns the endpoint path and its Bearer key (shown once).",
    inputSchema: input({ name: s("Server name"), description: s("Optional description"), tools: { type: "array", items: { type: "string" }, description: "Tool ids or names" } }, ["name"]),
    run: async (args) => {
      const created = await mcpServers.createMyMcpServer({ name: str(args, "name"), description: optStr(args, "description") ?? null, toolIds: await toolIdsFor(strList(args, "tools")) });
      return mcpServerForAgent(created as McpServerRow);
    },
  },
  {
    name: "update_mcp_server",
    description: "Rename or enable/disable a hosted MCP server. Passing tools REPLACES the whole tool list; use add_tools_to_mcp_server / remove_tools_from_mcp_server to change it incrementally.",
    inputSchema: input({ server: s("Server id or name"), name: s("New name"), active: { type: "boolean" }, tools: { type: "array", items: { type: "string" }, description: "Replaces assigned tools (ids or names)" } }, ["server"]),
    run: async (args) => {
      const server = await findMcpServer(str(args, "server"));
      return mcpServerForAgent((await mcpServers.updateMyMcpServer(server.id, {
        ...(typeof args.name === "string" ? { name: args.name } : {}),
        ...(typeof args.active === "boolean" ? { isActive: args.active } : {}),
        ...(Array.isArray(args.tools) ? { toolIds: await toolIdsFor(strList(args, "tools")) } : {}),
      })) as McpServerRow);
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
      return mcpServerForAgent((await mcpServers.updateMyMcpServer(server.id, { toolIds: [...ids] })) as McpServerRow);
    },
  },
  {
    name: "remove_tools_from_mcp_server",
    description: "Stop exposing some tools on a hosted MCP server. The tools themselves are not deleted.",
    inputSchema: input({ server: s("Server id or name"), tools: { type: "array", items: { type: "string" }, description: "Tool ids or names to remove" } }, ["server", "tools"]),
    run: async (args) => {
      const server = await findMcpServer(str(args, "server"));
      const remove = new Set(await toolIdsFor(strList(args, "tools")));
      return mcpServerForAgent((await mcpServers.updateMyMcpServer(server.id, { toolIds: server.tools.map((tool) => tool.id).filter((id) => !remove.has(id)) })) as McpServerRow);
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
    description: "List KV entries. Pass project to list one project, or omit it to list every key with its project. Values longer than 200 chars are cut (valueChars gives the full length); read those with kv_get.",
    inputSchema: input({ project: s(KV_PROJECT_HINT) }),
    run: async (args) => {
      const ref = optStr(args, "project")?.trim();
      if (ref) await kv.requireKvProjectId(ref);
      const names = new Map((await kv.listKvProjects()).items.map((p) => [p.id, p.name]));
      const items = (await kv.listKvEntries({ sorts: "key", ...(ref ? { project: ref } : {}) })).items as { key: string; value: string; description: string | null; projectId: string }[];
      return items.map(({ key, value, description, projectId }) => ({ project: names.get(projectId) ?? projectId, key, value: headText(value, KV_PREVIEW_CHARS), ...(value.length > KV_PREVIEW_CHARS ? { valueChars: value.length } : {}), description }));
    },
  },
  {
    name: "kv_get",
    description: "Get one or more KV values from one project. Returns { project, values: { KEY: value } }, with null for a key that is not set.",
    inputSchema: input({ keys: { type: "array", items: { type: "string" }, description: 'Keys like ["BASE_URL"], up to 100' }, project: s(KV_PROJECT_HINT) }, ["keys"]),
    run: async (args) => {
      const keys = batchNames(args, "keys", '["BASE_URL", "TIMEOUT_MS"]', ["key"]);
      const projectId = await kv.requireKvProjectId(optStr(args, "project"));
      const values: Record<string, string | null> = {};
      for (const key of keys) values[key] = (await kv.getKvByKey(key, projectId))?.value ?? null;
      return { project: optStr(args, "project")?.trim() || kv.DEFAULT_KV_PROJECT, values };
    },
  },
  {
    name: "kv_set",
    description: "Create or update one or more KV entries in one project. Keys match [A-Z][A-Z0-9_]*. All keys are checked before anything is written. A project that does not exist yet is created.",
    inputSchema: input({ entries: { type: "array", items: { type: "object", properties: { key: { type: "string" }, value: { type: "string", description: "Value; non-strings are stored as JSON" } }, required: ["key", "value"] }, description: "Up to 100 entries" }, project: s(`${KV_PROJECT_HINT} Created if missing.`) }, ["entries"]),
    run: async (args) => {
      const entries = batch(args, "entries", '[{ "key": "BASE_URL", "value": "https://api.example.com" }]', ["key", "value"]).map((raw, i) => {
        const entry = (raw ?? {}) as { key?: unknown; value?: unknown };
        const key = typeof entry.key === "string" ? entry.key.trim() : "";
        try {
          kv.assertKey(key);
        } catch (err) {
          throw new Error(`entries[${i}]: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (entry.value === undefined) throw new Error(`entries[${i}] (${key}) needs a value`);
        return { key, value: typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value) };
      });
      const dupes = [...new Set(entries.map((e) => e.key).filter((k, i, all) => all.indexOf(k) !== i))];
      if (dupes.length) throw new Error(`"entries" sets ${dupes.join(", ")} more than once`);
      const projectId = await kv.ensureKvProjectId(optStr(args, "project"));
      for (const entry of entries) await kv.upsertKvByKey({ ...entry, projectId });
      return { project: optStr(args, "project")?.trim() || kv.DEFAULT_KV_PROJECT, saved: entries.map((e) => e.key) };
    },
  },
  {
    name: "kv_delete",
    description: "Delete one or more KV entries from one project. Requires confirm=true. If any key is missing, nothing is deleted.",
    inputSchema: input({ keys: { type: "array", items: { type: "string" }, description: "Keys to delete, up to 100" }, project: s(KV_PROJECT_HINT), confirm: { type: "boolean", description: "Must be true" } }, ["keys", "confirm"]),
    run: async (args) => {
      if (args.confirm !== true) throw new Error("Set confirm=true to delete these KV keys");
      const keys = batchNames(args, "keys", '["OLD_KEY"]', ["key"]);
      const projectId = await kv.requireKvProjectId(optStr(args, "project"));
      const missing: string[] = [];
      for (const key of keys) if (!(await kv.getKvByKey(key, projectId))) missing.push(key);
      if (missing.length) throw missingError("KV keys", missing, "Use kv_list to see the keys.");
      for (const key of keys) await kv.deleteKvByKey(key, projectId);
      return { ok: true, project: optStr(args, "project")?.trim() || kv.DEFAULT_KV_PROJECT, deleted: keys };
    },
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
    description: "Create or update one or more encrypted secrets. Tools read them with agenthands.secrets.get(KEY). Only set values the user gave you for this; never invent them. All keys are checked before anything is written.",
    inputSchema: input({ entries: { type: "array", items: { type: "object", properties: { key: { type: "string", description: "Key like API_TOKEN" }, value: { type: "string" } }, required: ["key", "value"] }, description: "Up to 100 entries" } }, ["entries"]),
    run: async (args) => {
      const entries = batch(args, "entries", '[{ "key": "API_TOKEN", "value": "..." }]', ["key", "value"]).map((raw, i) => {
        const entry = (raw ?? {}) as { key?: unknown; value?: unknown };
        const key = typeof entry.key === "string" ? entry.key.trim() : "";
        try {
          secrets.assertKey(key);
        } catch (err) {
          throw new Error(`entries[${i}]: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (typeof entry.value !== "string" || entry.value === "") throw new Error(`entries[${i}] (${key}) needs a non-empty string value`);
        return { key, value: entry.value };
      });
      const dupes = [...new Set(entries.map((e) => e.key).filter((k, i, all) => all.indexOf(k) !== i))];
      if (dupes.length) throw new Error(`"entries" sets ${dupes.join(", ")} more than once`);
      for (const entry of entries) await secrets.upsertSecretByKey(entry);
      return { ok: true, saved: entries.map((e) => e.key) };
    },
  },
  {
    name: "secret_delete",
    description: "Delete one or more secrets. Cannot be undone. Requires confirm=true. If any key is missing, nothing is deleted.",
    inputSchema: input({ keys: { type: "array", items: { type: "string" }, description: "Keys to delete, up to 100" }, confirm: { type: "boolean", description: "Must be true" } }, ["keys", "confirm"]),
    run: async (args) => {
      if (args.confirm !== true) throw new Error("Set confirm=true to delete these secrets; their values cannot be recovered");
      const keys = batchNames(args, "keys", '["OLD_TOKEN"]', ["key"]);
      const missing: string[] = [];
      for (const key of keys) if (!(await secrets.getSecretMetaByKey(key))) missing.push(key);
      if (missing.length) throw missingError("Secrets", missing, "Use secret_list to see the keys.");
      for (const key of keys) await secrets.deleteSecretByKey(key);
      return { ok: true, deleted: keys };
    },
  },

  {
    name: "datatable_list_projects",
    description: "List datatable projects with their table names.",
    inputSchema: input({}),
    run: async () => ((await datatables.listProjects()) as { id: string; name: string; tableNames?: string[] }[]).map((p) => ({ id: p.id, name: p.name, tables: p.tableNames ?? [] })),
  },
  {
    name: "datatable_create_project",
    description: "Create a datatable project.",
    inputSchema: input({ name: s("Project name") }, ["name"]),
    run: async (args) => {
      const project = (await datatables.createProject({ name: str(args, "name") })) as { id: string; name: string };
      return { id: project.id, name: project.name };
    },
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
    description: "Get the tables of a project and their columns: name, type, options (select) and required (only when true).",
    inputSchema: input({ project: s("Project id or name") }, ["project"]),
    run: async (args) => schemaForAgent((await datatables.getProjectSchemaByRef(str(args, "project"))) as SchemaRow),
  },
  {
    name: "datatable_create_table",
    description: "Create a table, optionally with columns. Column types: text, number, boolean, datetime, select, json. Columns are checked first; a bad column creates nothing.",
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
      if (args.columns !== undefined && !Array.isArray(args.columns)) throw new Error('"columns" must be an array, e.g. [{ "name": "email", "type": "text" }]');
      const columns = checkColumns((args.columns as unknown[] | undefined) ?? [], new Set(), "The table was not created.");
      const table = await datatables.createTable(project.id, { name: str(args, "name") });
      for (const column of columns) await datatables.createColumn(table.id as string, column);
      return schemaForAgent((await datatables.getProjectSchemaByRef(project.id)) as SchemaRow);
    },
  },
  {
    name: "datatable_add_columns",
    description: "Add one or more columns to a table. Types: text, number, boolean, datetime, select (with options), json. All columns are checked before any is added. Returns the table's columns.",
    inputSchema: input({ project: s("Project id or name"), table: s("Table id or name"), columns: { type: "array", items: { type: "object", properties: { name: { type: "string" }, type: { type: "string" }, options: { type: "array", items: { type: "string" } }, required: { type: "boolean" } }, required: ["name", "type"] }, description: "Columns to add, up to 100" } }, ["project", "table", "columns"]),
    run: async (args) => {
      const found = await datatables.resolveProjectAndTable(str(args, "project"), str(args, "table"));
      if (!found) throw new NotFoundException("Table not found. Use datatable_get_schema to see the tables.");
      const existing = new Set(((await datatables.getProjectSchemaByRef(found.project.id)) as SchemaRow).tables.find((t) => t.name === found.table.name)?.columns.map((c) => c.name) ?? []);
      const columns = checkColumns(batch(args, "columns", '[{ "name": "status", "type": "select", "options": ["new", "won"] }]', ["name", "type"]), existing, "No columns were added.");
      for (const column of columns) await datatables.createColumn(found.table.id, column);
      const schema = schemaForAgent((await datatables.getProjectSchemaByRef(found.project.id)) as SchemaRow);
      return { project: schema.project, table: found.table.name, added: columns.map((c) => c.name), columns: schema.tables.find((t) => t.name === found.table.name)?.columns ?? [] };
    },
  },
  {
    name: "datatable_query",
    description: "Query rows as { id, data }. Default limit 50, max 500. where: {col: value | {$op: value}} (array = OR). Ops: $eq $neq $gt $gte $lt $lte $in $nin $contains $exists.",
    inputSchema: input({ project: s("Project id or name"), table: s("Table id or name"), where: { type: ["object", "array"] }, order_by: { type: "array", items: { type: "object" } }, limit: { type: "number" }, offset: { type: "number" } }, ["project", "table"]),
    run: async (args) => {
      const result = (await datatables.queryRowsByName(str(args, "project"), str(args, "table"), {
        where: args.where as WhereFilter | undefined,
        order_by: args.order_by as OrderByItem[] | undefined,
        limit: typeof args.limit === "number" ? args.limit : 50,
        offset: typeof args.offset === "number" ? args.offset : 0,
      })) as { items: { id: string; data: unknown }[]; total: number; limit: number; offset: number };
      return { total: result.total, limit: result.limit, offset: result.offset, items: result.items.map(rowForAgent) };
    },
  },
  {
    name: "datatable_insert_rows",
    description: "Insert up to 200 rows (objects keyed by column name). Returns the new row ids in order.",
    inputSchema: input({ project: s("Project id or name"), table: s("Table id or name"), rows: { type: "array", items: { type: "object" } } }, ["project", "table", "rows"]),
    run: async (args) => {
      const inserted = (await datatables.insertRowsByName(str(args, "project"), str(args, "table"), Array.isArray(args.rows) ? (args.rows as Record<string, unknown>[]) : [])) as { id: string }[];
      return { inserted: inserted.length, ids: inserted.map((row) => row.id) };
    },
  },
  {
    name: "datatable_update_rows",
    description: "Update fields of one or more rows: rows [{ id, data }], up to 200. Only the fields in data change. Every row is checked before any is written, so one bad row changes nothing.",
    inputSchema: input({ project: s("Project id or name"), table: s("Table id or name"), rows: { type: "array", items: { type: "object", properties: { id: { type: "string", description: "Row id from datatable_query" }, data: { type: "object" } }, required: ["id", "data"] }, description: "Up to 200 updates" } }, ["project", "table", "rows"]),
    run: async (args) => {
      const rows = batch(args, "rows", '[{ "id": "<row id>", "data": { "score": 7 } }]', ["row_id", "data"], 200) as { id: string; data: Record<string, unknown> }[];
      const found = await datatables.resolveProjectAndTable(str(args, "project"), str(args, "table"));
      if (!found) throw new NotFoundException("Table not found. Use datatable_get_schema to see the tables.");
      const updated = (await datatables.bulkUpdateRows(found.table.id, rows)) as { id: string }[];
      return { updated: updated.length, ids: updated.map((row) => row.id) };
    },
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
        return { space: space.name, prefix: view.prefix, folders: view.folders.slice(0, 500), ...(view.folders.length > 500 ? { foldersTotal: view.folders.length } : {}), items: view.items.slice(0, 500).map(fileInList), ...(view.items.length > 500 ? { itemsTotal: view.items.length } : {}) };
      }
      const result = await storage.listFiles(space, { prefix: optStr(args, "prefix"), limit: typeof args.limit === "number" ? args.limit : 200, offset: typeof args.offset === "number" ? args.offset : 0 });
      return { space: space.name, total: result.total, items: result.items.map(fileInList) };
    },
  },
  {
    name: "storage_upload_link",
    description: "The only way to write files to a space, any size. Pass files [{ key, content_type? }] (up to 100) and get one one-time uploadUrl per key plus a curl command; run it once per file in your shell and curl streams the bytes and prints the saved file as JSON. Local file: curl -fsS -T <path> <uploadUrl>. Text you made: printf '%s' \"...\" | curl -fsS -T - <uploadUrl>. File on the web: curl -fsSL <source url> | curl -fsS -T - <uploadUrl>. Each link writes only its key, works once, and expires in 1 hour. The space is created (private) if it does not exist. Replaces any file with the same key.",
    inputSchema: input({ space: s("Space name or id; created if missing"), files: { type: "array", items: { type: "object", properties: { key: { type: "string", description: "File path in the space, e.g. videos/demo.mp4" }, content_type: { type: "string", description: "MIME type hint. The stored type is detected from the bytes; this (or the key's extension) is kept only when the bytes agree." } }, required: ["key"] }, description: "Files to upload, up to 100" } }, ["space", "files"]),
    run: async (args, request) => {
      const files = batch(args, "files", '[{ "key": "reports/2026-11.csv" }]', ["key"]).map((raw, i) => {
        const file = (raw ?? {}) as { key?: unknown; content_type?: unknown };
        if (typeof file.key !== "string") throw new Error(`files[${i}].key must be a string`);
        try {
          return { key: storage.normalizeKey(file.key), contentType: typeof file.content_type === "string" ? file.content_type : null };
        } catch (err) {
          throw new Error(`files[${i}]: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      const dupes = [...new Set(files.map((f) => f.key).filter((k, i, all) => all.indexOf(k) !== i))];
      if (dupes.length) throw new Error(`"files" lists ${dupes.join(", ")} more than once`);
      const space = await storage.ensureSpace(str(args, "space"));
      const base = linkBase(request);
      const links = files.map((file) => storage.createUploadLink(space, file));
      return { space: space.name, method: "PUT", expiresAt: links[0].expiresAt.toISOString(), command: "curl -fsS -T '<local file path or - for stdin>' '<uploadUrl>'", links: links.map((link) => ({ key: link.key, uploadUrl: `${base}/api/public/storage/upload/${link.token}` })) };
    },
  },
  {
    name: "storage_download_link",
    description: "Download files to your own disk, any size: returns one one-time downloadUrl per key and a curl command (curl -fsS -o <local path> <downloadUrl>). Use it for binary files and anything over 256 KB instead of storage_get_file. Each link reads only its file, works once, and expires in 1 hour.",
    inputSchema: input({ space: s("Space name or id"), keys: { type: "array", items: { type: "string" }, description: "File keys, up to 100" } }, ["space", "keys"]),
    run: async (args, request) => {
      const keys = storageKeys(args, '["reports/2026-11.csv"]');
      const space = await storage.requireSpace(str(args, "space"));
      const found = await Promise.all(keys.map((key) => storage.getFileByKey(space.id, key)));
      const missing = keys.filter((_, i) => !found[i]);
      if (missing.length) throw missingError(`Files in "${space.name}"`, missing, "Use storage_list_files to see the keys.");
      const base = linkBase(request);
      const links = found.map((file) => ({ file: file!, link: storage.createDownloadLink(file!) }));
      return { space: space.name, method: "GET", expiresAt: links[0].link.expiresAt.toISOString(), command: "curl -fsS -o '<local file path>' '<downloadUrl>'", links: links.map(({ file, link }) => ({ key: file.key, size: file.size, contentType: file.contentType, downloadUrl: `${base}/api/public/storage/download/${link.token}` })) };
    },
  },
  {
    name: "storage_get_file",
    description: "Read one or more small files inline, at most 256 KB in total. Text types come back as utf8, others as base64 (override with encoding). For bigger or binary files use storage_download_link and save them with curl.",
    inputSchema: input({ space: s("Space name or id"), keys: { type: "array", items: { type: "string" }, description: "File keys, up to 100" }, encoding: { type: "string", enum: ["utf8", "base64"] } }, ["space", "keys"]),
    run: async (args) => {
      const keys = storageKeys(args, '["config/settings.json"]');
      const space = await storage.requireSpace(str(args, "space"));
      const found = await Promise.all(keys.map((key) => storage.getFileByKey(space.id, key)));
      const missing = keys.filter((_, i) => !found[i]);
      if (missing.length) throw missingError(`Files in "${space.name}"`, missing, "Use storage_list_files to see the keys.");
      const total = found.reduce((sum, file) => sum + file!.size, 0);
      if (total > MAX_INLINE_BYTES) throw new Error(`These files are ${total} bytes together (${found.map((f) => `${f!.key} ${f!.size}`).join(", ")}); storage_get_file returns at most 256 KB per call. Read fewer at once, or call storage_download_link and save them with curl.`);
      const forced = optStr(args, "encoding");
      if (forced !== undefined && forced !== "utf8" && forced !== "base64") throw new Error(`encoding must be "utf8" or "base64" (got "${forced}"); omit it to pick by file type`);
      const files = [];
      for (const file of found as StorageFileRow[]) {
        const encoding = forced ?? (storage.isTextContentType(file.contentType) ? "utf8" : "base64");
        const bytes = await storage.readFileBytes(file);
        const { space: _space, ...meta } = fileSummary({ ...file, space: space.name, publicUrl: space.isPublic ? storage.publicFileUrl(file) : null });
        files.push({ ...meta, encoding, content: encoding === "base64" ? Buffer.from(bytes).toString("base64") : new TextDecoder().decode(bytes) });
      }
      return { space: space.name, files };
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
    description: "Delete one or more files from a space. Cannot be undone. Requires confirm=true. If any key is missing, nothing is deleted.",
    inputSchema: input({ space: s("Space name or id"), keys: { type: "array", items: { type: "string" }, description: "File keys, up to 100" }, confirm: { type: "boolean", description: "Must be true" } }, ["space", "keys", "confirm"]),
    run: async (args) => {
      if (args.confirm !== true) throw new Error("Set confirm=true to delete these files");
      const keys = storageKeys(args, '["reports/old.csv"]');
      const space = await storage.requireSpace(str(args, "space"));
      const found = await Promise.all(keys.map((key) => storage.getFileByKey(space.id, key)));
      const missing = keys.filter((_, i) => !found[i]);
      if (missing.length) throw missingError(`Files in "${space.name}"`, missing, "Use storage_list_files to see the keys.");
      for (const file of found) await storage.deleteFile(file!);
      return { ok: true, space: space.name, deleted: found.map((f) => f!.key) };
    },
  },

  {
    name: "list_sites",
    description: "List sites.",
    inputSchema: input({}),
    run: async () => (await sites.listSites({})).items.map((site) => siteForAgent(site as SiteRow)),
  },
  {
    name: "create_site",
    description: "Create a site with starter files. Slug is lowercase-kebab and unique; it becomes /public/sites/<slug>. Returns the full url.",
    inputSchema: input({ name: s("Site name"), slug: s("URL slug") }, ["name", "slug"]),
    run: async (args) => {
      return siteForAgent((await sites.createSite({ name: str(args, "name"), slug: str(args, "slug") })) as SiteRow);
    },
  },
  {
    name: "get_site_files",
    description: "Read a site's source files. Pass file to read just one (app.tsx, backend.ts, styles.css or package.json); omit it for all four.",
    inputSchema: input({ site: s("Site id or slug"), file: { type: "string", enum: SITE_FILES } }, ["site"]),
    run: async (args) => {
      const { files } = await sites.getSiteFiles((await findSite(str(args, "site"))).id);
      const file = optStr(args, "file")?.trim();
      if (!file) return { files };
      if (!SITE_FILES.includes(file)) throw new Error(`file must be one of ${SITE_FILES.join(", ")}`);
      return { file, content: (files as Record<string, string>)[file] ?? "" };
    },
  },
  {
    name: "edit_site_file",
    description: "Change a site file (app.tsx, backend.ts or styles.css). Pass edits [{ old_string, new_string, replace_all? }] to replace exact text: applied in order, all or nothing, and each old_string must match exactly one place unless replace_all. Or pass content to replace the whole file. Read it first with get_site_files { site, file }. The change is live at once on the site URL, with no review step; check it with preview_site. npm imports are installed automatically. See get_guide topic=sites.",
    inputSchema: input({ site: s("Site id or slug"), file: { type: "string", enum: ["app.tsx", "backend.ts", "styles.css"] }, edits: TEXT_EDITS_SCHEMA, content: s("The whole new file, instead of edits, for a rewrite") }, ["site", "file"]),
    run: async (args) => {
      const site = await findSite(str(args, "site"));
      const file = str(args, "file");
      const hasContent = typeof args.content === "string";
      if (hasContent === (args.edits !== undefined)) throw new Error("Pass exactly one of edits (exact-text replacements) or content (the whole file)");
      if (hasContent) {
        await sites.updateSiteFile(site.id, file, args.content as string);
        return { ok: true, file, chars: (args.content as string).length };
      }
      const current = ((await sites.getSiteFiles(site.id)).files as Record<string, string>)[file];
      if (typeof current !== "string") throw new Error(`file must be one of app.tsx, backend.ts, styles.css`);
      const edited = applyTextEdits(current, args.edits, `Read the file with get_site_files { site: "${site.slug}", file: "${file}" }`);
      await sites.updateSiteFile(site.id, file, edited.text);
      return { ok: true, file, replacements: edited.replacements, chars: edited.text.length };
    },
  },
  {
    name: "preview_site",
    description: "Bundle the site and run the backend GET. Returns the backend data or the build error. Call it after edit_site_file to check the change.",
    inputSchema: input({ site: s("Site id or slug") }, ["site"]),
    run: async (args) => {
      const preview = await sites.previewSite((await findSite(str(args, "site"))).id);
      return { ok: true, ...cappedField("data", preview.data, MAX_RESULT_CHARS, "data is cut to 20000 chars of JSON; the site itself gets all of it."), appJsChars: preview.appJsChars };
    },
  },
  {
    name: "publish_site",
    description: "Publish or unpublish a site, optionally with a password (empty string removes it).",
    inputSchema: input({ site: s("Site id or slug"), published: { type: "boolean" }, password: s("Optional access password") }, ["site", "published"]),
    run: async (args) => {
      const site = await findSite(str(args, "site"));
      return siteForAgent((await sites.updateSite(site.id, { isPublished: args.published === true, ...(typeof args.password === "string" ? { publicPassword: args.password || null } : {}) })) as SiteRow);
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
    run: async () => ((await jobs.listJobs({})).items as Record<string, unknown>[]).map((job) => jobForAgent(job, "list")),
  },
  {
    name: "get_job",
    description: "Get a job with its code.",
    inputSchema: input({ job: s("Job id or name") }, ["job"]),
    run: async (args) => jobForAgent(jobs.toPublicJob(await findJob(str(args, "job"))) as unknown as Record<string, unknown>, "full"),
  },
  {
    name: "create_job",
    description: "Create a cron job. cron: 5-field expressions, one per line, in the app timezone; empty = manual only. Returns status and nextRuns so you can check the schedule. See get_guide topic=jobs.",
    inputSchema: input({ name: s('Readable title people see in the jobs list, in plain words, e.g. "Sync GitHub issues". Not kebab-case.'), code: s("Bun/TypeScript script"), cron: s("Cron expression(s)"), description: s("Optional description"), timeout_ms: { type: "number", description: "Limit for one attempt. Default 300000 (5 min)." }, max_retries: { type: "number", description: "Run the whole script again this many times when it fails (0-5, default 0). Waits 5s, 10s, 20s… between attempts. Only for idempotent jobs." }, enabled: { type: "boolean", description: "Start paused with false. Default true when cron is set." } }, ["name", "code"]),
    run: async (args) =>
      jobForAgent((await jobs.createJob({
        name: str(args, "name"),
        code: str(args, "code"),
        cron: optStr(args, "cron") ?? "",
        description: optStr(args, "description") ?? null,
        ...(typeof args.timeout_ms === "number" ? { timeoutMs: args.timeout_ms } : {}),
        ...(typeof args.max_retries === "number" ? { maxRetries: args.max_retries } : {}),
        ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
      })) as unknown as Record<string, unknown>, "result"),
  },
  {
    name: "update_job",
    description: "Update a job's name, code, cron, description, timeout, retries or enabled. A job paused by a person stays paused unless you pass enabled=true; resume only when the user asked.",
    inputSchema: input({ job: s("Job id or name"), name: s("New name"), code: s("New script"), cron: s("New cron (empty string = manual only)"), description: s("New description"), timeout_ms: { type: "number", description: "Limit for one attempt" }, max_retries: { type: "number", description: "0-5 whole-run retries on failure" }, enabled: { type: "boolean", description: "false pauses the schedule, true resumes it" } }, ["job"]),
    run: async (args) => {
      const job = await findJob(str(args, "job"));
      return jobForAgent((await jobs.updateJob(job.id, {
        ...(typeof args.name === "string" ? { name: args.name } : {}),
        ...(typeof args.code === "string" ? { code: args.code } : {}),
        ...(typeof args.cron === "string" ? { cron: args.cron } : {}),
        ...(typeof args.description === "string" ? { description: args.description } : {}),
        ...(typeof args.timeout_ms === "number" ? { timeoutMs: args.timeout_ms } : {}),
        ...(typeof args.max_retries === "number" ? { maxRetries: args.max_retries } : {}),
        ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
      })) as unknown as Record<string, unknown>, "result");
    },
  },
  {
    name: "run_job",
    description: "Run a job now. input (any JSON, up to 64KB) reaches the script as agenthands.run.input. With wait=true, waits up to 120s and returns the run with status, output, error and its last 50 log lines (get_job_runs { run } pages through the rest).",
    inputSchema: input({ job: s("Job id or name"), input: { description: "Optional JSON value passed to the run" }, wait: { type: "boolean" } }, ["job"]),
    run: async (args) => {
      const job = await findJob(str(args, "job"));
      const claimed = await jobs.tryClaimJob(job.id, "manual", { input: args.input });
      if (!claimed) throw new Error("Job is already running");
      startClaimedRun(claimed.job.id, claimed.run.id, false);
      if (args.wait !== true) return runSummary(claimed.run);
      const done = await waitForRun(claimed.run.id, 120_000);
      return done ? runDetail(done) : null;
    },
  },
  {
    name: "get_job_runs",
    description: "Recent runs of a job, newest first: status, attempts, error, a short output and logCount, without logs. Pass run (a run id) for that one run with input, output and its last 50 log lines; log_offset and log_limit (max 500) page through the rest.",
    inputSchema: input({ job: s("Job id or name"), run: s("Run id for one run's details and logs"), limit: { type: "number", description: "Runs to list, default 5, max 20" }, log_offset: { type: "number", description: "First log line to return (0-based). Default: the last log_limit lines." }, log_limit: { type: "number", description: "Log lines to return, default 50, max 500" } }, ["job"]),
    run: async (args) => {
      const job = await findJob(str(args, "job"));
      const runId = optStr(args, "run")?.trim();
      if (runId) {
        const run = await jobs.getJobRun(runId);
        if (!run || run.jobId !== job.id) throw new NotFoundException(`Run "${runId}" of job "${job.name}" not found. Call get_job_runs without run to list run ids.`);
        return runDetail(jobs.toPublicJobRun(run), { logOffset: args.log_offset, logLimit: args.log_limit });
      }
      const result = await jobs.listJobRuns(job.id, { limit: String(clampInt(args.limit, 1, 20, 5)) });
      return { total: result.total, items: result.items.map(runSummary) };
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

export function listCoreToolGroups(): { group: string; tools: { name: string; description: string }[] }[] {
  return groupTools(CORE_TOOLS.map(({ name, description }) => ({ name, description })));
}

function isFailedResult(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { ok?: unknown }).ok === false;
}

function formatResult(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? null);
}

export const coreMcpServer: McpServerHandler = {
  name: "agenthands-core",
  instructions: CORE_MCP_INSTRUCTIONS,
  listTools: async () => CORE_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, _meta: { "agenthands/group": groupOf(name) } })),
  callTool: async (name, args, request) => {
    const tool = CORE_TOOLS.find((t) => t.name === name);
    if (!tool) return textResult(`Unknown tool: ${name}`, true);
    try {
      const value = await tool.run(args, request);
      return textResult(formatResult(value), isFailedResult(value));
    } catch (err) {
      const message = err instanceof HttpException || err instanceof Error ? err.message : String(err);
      return textResult(message, true);
    }
  },
};
