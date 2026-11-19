import { and, eq, isNull, ne } from "drizzle-orm";
import { OMITTED_WRITE_MESSAGE, isOmittedSource } from "../../common/ai/apply-exact-replace.js";
import { BadRequestException } from "../../common/exceptions/http.exception.js";
import { slugify } from "../../common/utils/slug.js";
import { buildJsonSchemaFromCode, isAnnotationComment, parseMetaFromCode, syncAnnotationHeader } from "./common/code-annotations.js";

interface ToolDefinition {
  toolName: string;
  toolLabel: string;
  description: string;
  parameters: object;
}
import { TOOL_DEF as RUN_JS_DEF } from "../../common/ai/agent-tools/run-js.tool.js";
import { TOOL_DEF as WEB_FETCH_DEF } from "../../common/ai/agent-tools/web-fetch.tool.js";
import { TOOL_DEF as AGENT_TASK_DEF } from "../agents/runtime/llm-tools/agent-task.tool.js";
import { TOOL_DEF as BACKGROUND_TASKS_DEF } from "../agents/runtime/llm-tools/background-tasks.tool.js";
import { TOOL_DEF as DATATABLE_DEF } from "../agents/runtime/llm-tools/datatable.tool.js";
import { TOOL_DEF as GET_TIME_DEF } from "../agents/runtime/llm-tools/get-current-time.tool.js";
import { TOOL_DEF as MEMORY_DEF } from "../agents/runtime/llm-tools/memory.tool.js";
import { TOOL_DEF as OPENUI_DEF } from "../agents/runtime/llm-tools/openui.tool.js";
import { TOOL_DEF as READ_SKILL_DEF } from "../agents/runtime/llm-tools/read-skill.tool.js";

const ALL_TOOL_DEFS: ToolDefinition[] = [
  GET_TIME_DEF,
  WEB_FETCH_DEF,
  RUN_JS_DEF,
  AGENT_TASK_DEF,
  DATATABLE_DEF,
  MEMORY_DEF,
  READ_SKILL_DEF,
  BACKGROUND_TASKS_DEF,
  OPENUI_DEF,
  ...NONLA_ADMIN_TOOL_DEFS,
  {
    toolName: "nonla_read_current_code",
    toolLabel: "Read Current Code",
    description: "Read the TypeScript module currently in the editor (draft if present, else published). Returns the source as plain text. Call before editing and whenever replace fails.",
    parameters: { type: "object", properties: {} },
  },
  {
    toolName: "nonla_edit_code",
    toolLabel: "Edit Code",
    description: 'Edit the TypeScript module in the editor. mode="replace": exact edits[{ old_string, new_string }]. mode="full": replace the entire file. Complete module with // @name / // @description / // @param and export default async function main(input) — NO markdown fences.',
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["replace", "full"] },
        code: {
          type: "string",
          description: "Full TypeScript module when mode=full (annotations + export default async function main, NO markdown fences).",
        },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" },
            },
            required: ["old_string", "new_string"],
          },
        },
        summary: { type: "string", description: "Short description of changes made (shown to the user)." },
      },
      required: ["mode"],
    },
  },
  {
    toolName: "nonla_run_current_script",
    toolLabel: "Run Current Script",
    description: "Run the latest code in a Bun sandbox.",
    parameters: {
      type: "object",
      properties: {
        testInput: {
          type: "object",
          description: "Parameters object to pass into the script. Keys must match the tool's // @param annotations. Example: { query: 'lofi music', limit: 5 }",
        },
      },
    },
  },
];
import { type NewAgentTool, agentToolAssignments, agentTools, getDb } from "../../common/db/client.js";
import { type RawQuery, listQuery } from "../../common/db/list-query.util.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { getDataDir } from "../../common/utils/data-dir.js";
import { wsHub } from "../../common/ws/wsHub.js";
import { canonicalBuiltinToolId } from "./builtin-names.js";
import { type BgTaskSnapshot, bgTaskRegistry } from "./common/bg-task-registry.js";
import { type SoftWaitExecuteResult, executeTool, executeToolWithSoftWait } from "./common/tool-runner.js";
import { NONLA_ADMIN_TOOL_DEFS } from "./nonla-builtin-catalog.js";

/** Hidden from the tool catalog. Still injected at runtime where noted. */
const ALWAYS_ON_TOOL_NAMES = new Set([
  "memory",
  "user_memory",
  "manage_memory",
  "nonla_read_skill",
  "read_skill",
  "nonla_background_tasks",
  "background_tasks",
  "nonla_read_current_code",
  "read_current_code",
  "nonla_edit_code",
  "edit_code",
  "nonla_run_current_script",
  "run_current_script",
  "update_prompt",
  "nonla_datatable",
  "datatable",
]);

/** Listed with the other builtins. Every agent has them. The switch cannot turn them off. */
const PINNED_BUILTIN_NAMES = new Set(["nonla_agent_task", "nonla_memory", "nonla_get_current_time", "nonla_openui"]);

const WORKSPACE_ADMIN_TOOL_NAMES = new Set(NONLA_ADMIN_TOOL_DEFS.map((tool) => tool.toolName));

function toBuiltinTool(b: ToolDefinition) {
  return {
    id: `builtin:${b.toolName}`,
    name: b.toolName,
    label: b.toolLabel,
    description: b.description,
    icon: null,
    parameters: (b.parameters ?? { type: "object", properties: {}, required: [] }) as object,
    codeContent: "",
    folderId: null as string | null,
    sortOrder: 0,
    isActive: true,
    /** Workspace admin tools stay on the Builtin Tools page. User agents do not toggle them. */
    workspaceOnly: WORKSPACE_ADMIN_TOOL_NAMES.has(b.toolName),
    /** Builtin that stays on for every agent. */
    alwaysOn: PINNED_BUILTIN_NAMES.has(b.toolName),
    createdAt: new Date(0),
  };
}

/** Catalog builtins. Pinned ones stay in this list and are marked alwaysOn. */
const BUILTIN_TOOLS = ALL_TOOL_DEFS.filter((b) => !ALWAYS_ON_TOOL_NAMES.has(b.toolName)).map(toBuiltinTool);

const HIDDEN_BUILTIN_TOOLS = ALL_TOOL_DEFS.filter((b) => ALWAYS_ON_TOOL_NAMES.has(b.toolName)).map((b) => ({ id: `builtin:${b.toolName}`, name: b.toolName, label: b.toolLabel, description: b.description }));

export function listHiddenBuiltinTools() {
  return HIDDEN_BUILTIN_TOOLS;
}

async function nextSortOrder(folderId: string | null): Promise<number> {
  const db = getDb();
  const rows = folderId == null ? await qall(db.select({ sortOrder: agentTools.sortOrder }).from(agentTools).where(isNull(agentTools.folderId))) : await qall(db.select({ sortOrder: agentTools.sortOrder }).from(agentTools).where(eq(agentTools.folderId, folderId)));
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}

/** Lookup a builtin tool by its virtual id. Old ids such as builtin:web_fetch still resolve. */
export function getBuiltinTool(id: string) {
  const resolved = canonicalBuiltinToolId(id);
  return BUILTIN_TOOLS.find((t) => t.id === resolved) ?? null;
}

export function hasBuiltinTool(id: string): boolean {
  const resolved = canonicalBuiltinToolId(id);
  return BUILTIN_TOOLS.some((t) => t.id === resolved) || HIDDEN_BUILTIN_TOOLS.some((t) => t.id === resolved);
}

/** Builtin ids a user agent can toggle. */
export function listAssignableBuiltinToolIds(): string[] {
  return BUILTIN_TOOLS.filter((tool) => !tool.workspaceOnly && !tool.alwaysOn).map((tool) => tool.id);
}

export async function listTools(query: RawQuery = {}) {
  const result = await listQuery({ table: agentTools }, query);
  // Join constant-based builtins + custom tools from DB
  const items = [...BUILTIN_TOOLS, ...result.items].map(({ codeContent, draftCode, ...rest }: any) => rest);
  return {
    ...result,
    items,
    total: items.length,
  };
}

export async function getTool(id: string) {
  // Handle virtual builtin tool IDs
  if (id.startsWith("builtin:")) return getBuiltinTool(id);
  return await qone(getDb().select().from(agentTools).where(eq(agentTools.id, id)));
}

async function assertToolNameAvailable(name: string, excludeId?: string) {
  if (BUILTIN_TOOLS.some((t) => t.name === name)) {
    throw new BadRequestException("Tool name already exists");
  }
  const db = getDb();
  const dup = excludeId
    ? await qone(
        db
          .select()
          .from(agentTools)
          .where(and(eq(agentTools.name, name), ne(agentTools.id, excludeId))),
      )
    : await qone(db.select().from(agentTools).where(eq(agentTools.name, name)));
  if (dup) {
    throw new BadRequestException("Tool name already exists");
  }
}

export async function createTool(
  body: Pick<NewAgentTool, "name" | "label" | "description" | "parameters" | "codeContent"> & {
    isActive?: boolean;
    folderId?: string | null;
    sortOrder?: number;
  },
) {
  const { isActive = true, folderId = null, sortOrder, ...rest } = body;
  if (isOmittedSource(rest.codeContent)) {
    throw new BadRequestException(OMITTED_WRITE_MESSAGE);
  }
  await assertToolNameAvailable(rest.name);
  const tool: NewAgentTool = {
    ...rest,
    id: crypto.randomUUID(),
    folderId,
    sortOrder: sortOrder ?? (await nextSortOrder(folderId)),
    isActive,
    createdAt: new Date(),
  };
  await qrun(getDb().insert(agentTools).values(tool));
  wsHub.emit("tools:created", tool);
  return tool;
}

export async function updateTool(id: string, body: Partial<NewAgentTool>) {
  if (id.startsWith("builtin:")) throw new Error("Cannot modify builtin tools");
  if (isOmittedSource(body.codeContent) || isOmittedSource(body.draftCode)) {
    throw new BadRequestException(OMITTED_WRITE_MESSAGE);
  }

  const db = getDb();
  const existing = await qone(db.select().from(agentTools).where(eq(agentTools.id, id)));
  if (!existing) throw new BadRequestException("Not found");

  // Derive metadata from // @name / // @description / // @param comments, then
  // canonicalize those headers in the stored code so share/export stays self-describing.
  if (body.codeContent) {
    const submittedCode = body.codeContent;
    const code = submittedCode;
    const meta = parseMetaFromCode(code);

    // Code annotations are the source of truth — do not fall back to stored DB
    // label/description, or deleting @name/@description would silently restore them.
    const label = (body.label?.trim() || meta.label || "").trim();
    const description = (body.description?.trim() || meta.description || "").trim();

    const errors: string[] = [];
    if (!label) errors.push("name");
    if (!description) errors.push("description");
    const codeLines = code.split("\n").filter((l) => {
      const t = l.trim();
      return t && !isAnnotationComment(t);
    });
    if (codeLines.length === 0) errors.push("code body");
    if (!/export\s+default\b/.test(code) && !/\breturn\b/.test(code)) errors.push("export default");
    if (errors.length > 0) {
      throw new BadRequestException(`Missing required: ${errors.join(", ")}`);
    }

    const schemaFromCode = buildJsonSchemaFromCode(code);
    const parameters = body.parameters ?? (Object.keys(schemaFromCode.properties).length > 0 ? schemaFromCode : existing.parameters);

    body.label = label;
    if (!body.name) body.name = meta.name || slugify(label, "_");
    body.description = description;
    body.parameters = parameters;
    body.codeContent = syncAnnotationHeader(code, { label, description }, parameters);
    // Publishing must not leave a stale AI draft (often the same body without headers).
    // That mismatch re-opens the Accept overlay after Save/Accept.
    if (body.draftCode === undefined || body.draftCode === submittedCode) {
      body.draftCode = body.codeContent;
    }
  }

  if (body.name) {
    await assertToolNameAvailable(body.name, id);
  }

  if (body.folderId !== undefined && body.sortOrder === undefined) {
    const nextFolderId = body.folderId ?? null;
    if ((existing.folderId ?? null) !== nextFolderId) {
      body.sortOrder = await nextSortOrder(nextFolderId);
    }
  }

  await qrun(db.update(agentTools).set(body).where(eq(agentTools.id, id)));
  const updated = await qone(db.select().from(agentTools).where(eq(agentTools.id, id)));
  if (!updated) throw new BadRequestException("Not found");

  // Spec / icon / active updates must not broadcast codeContent — that resets an unsaved editor.
  if (body.codeContent !== undefined) {
    wsHub.emit("tools:updated", updated);
  } else {
    const slim: Record<string, unknown> = { id: updated.id };
    for (const key of Object.keys(body) as (keyof typeof updated)[]) {
      if (key === "id") continue;
      slim[key] = updated[key];
    }
    wsHub.emit("tools:updated", slim);
  }
  return updated;
}

/** Set folder + sort order for tools in one column (kanban). */
export async function reorderTools(folderId: string | null, toolIds: string[]) {
  const db = getDb();
  for (let i = 0; i < toolIds.length; i++) {
    const id = toolIds[i];
    if (!id || id.startsWith("builtin:")) continue;
    await qrun(db.update(agentTools).set({ folderId, sortOrder: i }).where(eq(agentTools.id, id)));
  }
  wsHub.emit("tools:reordered", { folderId, toolIds });
  return { folderId, toolIds };
}

export async function deleteTool(id: string) {
  if (id.startsWith("builtin:")) throw new Error("Cannot delete builtin tools");
  const db = getDb();
  // Find affected agents BEFORE cascade delete
  const affected = await qall(db.select({ agentId: agentToolAssignments.agentId }).from(agentToolAssignments).where(eq(agentToolAssignments.toolId, id)));
  // Manually clean up assignments (no FK cascade since builtin tools share this table)
  await qrun(db.delete(agentToolAssignments).where(eq(agentToolAssignments.toolId, id)));
  await qrun(db.delete(agentTools).where(eq(agentTools.id, id)));
  wsHub.emit("tools:deleted", { id });
  // Notify affected agents that their tool assignments changed
  for (const { agentId } of affected) {
    wsHub.emit("agents:tools-updated", { agentId, toolId: id });
  }
}

export async function runTool(id: string, inputJson = "{}", code?: string) {
  const tool = await getTool(id);
  if (!tool) return null;
  const codeToRun = code ?? tool.codeContent;
  const resultStr = await executeTool(id, codeToRun, inputJson, getDataDir());
  return JSON.parse(resultStr);
}

export async function runToolWithSoftWait(opts: {
  id: string;
  inputJson?: string;
  code?: string;
  softWaitMs?: number;
  agentId?: string;
  conversationId?: string | null;
}): Promise<SoftWaitExecuteResult | null> {
  const tool = await getTool(opts.id);
  if (!tool) return null;
  const codeToRun = opts.code ?? tool.codeContent;
  return executeToolWithSoftWait({
    toolId: opts.id,
    toolName: tool.name,
    code: codeToRun,
    inputJson: opts.inputJson ?? "{}",
    dataDir: getDataDir(),
    softWaitMs: opts.softWaitMs,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
  });
}

/** Update draftCode for a tool and notify FE (used by edit_code tool). */
export async function updateDraftCode(id: string, draftCode: string): Promise<void> {
  if (isOmittedSource(draftCode)) {
    throw new BadRequestException(OMITTED_WRITE_MESSAGE);
  }
  await qrun(getDb().update(agentTools).set({ draftCode }).where(eq(agentTools.id, id)));
  wsHub.emit("tools:updated", { id, draftCode });
}

/** Get draftCode for a tool (used by run_current_script / edit_code). Fallback to published codeContent. */
export async function getDraftCode(id: string): Promise<string | null> {
  const row = await qone(getDb().select({ draftCode: agentTools.draftCode, codeContent: agentTools.codeContent }).from(agentTools).where(eq(agentTools.id, id)));
  if (!row) return null;
  return row.draftCode ?? row.codeContent ?? null;
}

export async function getToolCode(id: string): Promise<string | null> {
  const row = await qone(getDb().select({ codeContent: agentTools.codeContent }).from(agentTools).where(eq(agentTools.id, id)));
  if (!row) return null;
  return row.codeContent ?? "";
}

export async function saveToolCode(id: string, code: string): Promise<string> {
  const updated = await updateTool(id, { codeContent: code });
  return updated?.codeContent ?? code;
}

export async function runToolCode(id: string, inputJson = "{}", abortSignal?: AbortSignal) {
  const code = await getToolCode(id);
  if (!code) return null;
  return executeTool(id, code, inputJson, getDataDir(), undefined, abortSignal);
}

/** Run draftCode of a tool in the Bun sandbox (used by run_current_script tool). */
export async function runDraftCode(id: string, inputJson = "{}", abortSignal?: AbortSignal) {
  const draftCode = await getDraftCode(id);
  if (!draftCode) return null;
  const resultStr = await executeTool(id, draftCode, inputJson, getDataDir(), undefined, abortSignal);
  return resultStr;
}

export type BgTaskClient = Pick<BgTaskSnapshot, "taskId" | "toolId" | "toolName" | "conversationId" | "startedAt" | "finishedAt" | "error" | "console" | "result" | "label" | "childConversationId" | "activity"> & {
  status: BgTaskSnapshot["status"] | "expired";
};

function toBgTaskClient(t: BgTaskSnapshot, extras: { console?: boolean; result?: boolean } = {}): BgTaskClient {
  return {
    taskId: t.taskId,
    toolId: t.toolId,
    toolName: t.toolName,
    conversationId: t.conversationId,
    status: t.status,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    error: t.error,
    label: t.label,
    childConversationId: t.childConversationId,
    activity: t.activity,
    ...(extras.console ? { console: t.console } : {}),
    ...(extras.result && t.result !== undefined ? { result: t.result } : {}),
  };
}

function belongsToConversation(task: BgTaskSnapshot, conversationId: string): boolean {
  return !task.conversationId || task.conversationId === conversationId;
}

export function listConversationBgTasks(conversationId: string): BgTaskClient[] {
  return bgTaskRegistry
    .list({ conversationId })
    .filter((t) => t.status === "running")
    .map((t) => toBgTaskClient(t));
}

export function findBgTask(taskId: string): BgTaskClient | null {
  const existing = bgTaskRegistry.get(taskId);
  if (!existing) return { taskId, toolId: "", toolName: "", status: "expired", startedAt: 0 };
  return toBgTaskClient(existing, { console: true, result: true });
}

export function getConversationBgTask(conversationId: string, taskId: string): BgTaskClient | null {
  const existing = bgTaskRegistry.get(taskId);
  if (!existing) {
    return { taskId, toolId: "", toolName: "", status: "expired", startedAt: 0 };
  }
  if (!belongsToConversation(existing, conversationId)) return null;
  return toBgTaskClient(existing, { console: true, result: true });
}

export function cancelConversationBgTask(conversationId: string, taskId: string): BgTaskClient | null {
  const existing = bgTaskRegistry.get(taskId);
  if (!existing || !belongsToConversation(existing, conversationId)) return null;
  const cancelled = bgTaskRegistry.cancel(taskId);
  return cancelled ? toBgTaskClient(cancelled, { console: true, result: true }) : null;
}
