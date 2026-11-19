/**
 * resolveTools.ts — User agent tool resolver.
 *
 * Builds the full tool list for a user-created agent:
 *   - Builtin tools (directly imported)
 *   - Custom tools (from DB agent_tools table, Bun/TypeScript sandbox)
 *   - MCP tools (from mcp_servers.tools catalog via virtual assignment ids)
 *   - Datatable: builtin agents only (managers). User agents call Datatable Manager instead.
 *   - Always-on builtins: agent task, get current time. Memory stays on for user agents only.
 *   - nonla_run_js only when assigned
 *   - nonla_call_agent__* tools (one per callableAgentIds target, top-level only)
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type McpCatalogTool, agentTools, agents, getDb, mcpServers, toolFolders } from "../../../../common/db/client.js";
import { qall, qone } from "../../../../common/db/query.js";
import { BUILTIN_DATATABLE_TOOL_ID, isDatatableProjectToolName, parseDatatableProjectAssignmentId, parseDatatableProjectToolTargetId } from "../../../datatables/datatable-tool-id.js";
import { getProject } from "../../../datatables/datatables.service.js";
import { callMcpTool } from "../../../mcp-servers/mcp-client.js";
import { buildMcpToolName, parseMcpToolId } from "../../../mcp-servers/mcp-tool-id.js";
import { hasBuiltinTool, runToolWithSoftWait } from "../../../tools/tools.service.js";
import { dropToolAssignment } from "../../agents.service.js";

import { makeRunJsTool } from "../../../../common/ai/agent-tools/run-js.tool.js";
import { webFetchTool } from "../../../../common/ai/agent-tools/web-fetch.tool.js";
import { AGENT_TASK_TOOL_NAME, makeAgentTaskTool } from "../llm-tools/agent-task.tool.js";
import { makeBackgroundTasksTool } from "../llm-tools/background-tasks.tool.js";
import { type CallAgentTarget, isCallAgentToolName, makeCallAgentTools, parseCallAgentToolTargetId } from "../llm-tools/call-agent.tool.js";
import { makeDatatableProjectTool, makeDatatableTool } from "../llm-tools/datatable.tool.js";
import { getCurrentTimeTool } from "../llm-tools/get-current-time.tool.js";
import { makeHistoryTools } from "../llm-tools/history.tool.js";
import { kvStoreTool } from "../llm-tools/kv-store.tool.js";
import { makeMemoryTool } from "../llm-tools/memory.tool.js";
import { openuiTool } from "../llm-tools/openui.tool.js";
import { makeReadSkillTool } from "../llm-tools/read-skill.tool.js";

import { NONLA_BOT_AGENT_ID, isBuiltinAgentId } from "../../../nonla-bot/builtin-ids.js";
import { canonicalBuiltinToolId, canonicalBuiltinToolName } from "../../../tools/builtin-names.js";
import { CUSTOM_TOOL_SOFT_WAIT_MS } from "../../../tools/common/tool-runner.js";
import { NONLA_ADMIN_TOOL_DEFS } from "../../../tools/nonla-builtin-catalog.js";

const SCHEMA_ONLY_DATATABLE_ACTIONS = ["list_projects", "get_schema"] as const;
const schemaOnlyDatatableTool = makeDatatableTool(SCHEMA_ONLY_DATATABLE_ACTIONS);

const STATIC_BUILTINS: Record<string, StructuredToolInterface> = {
  nonla_get_current_time: getCurrentTimeTool,
  nonla_web_fetch: webFetchTool,
  nonla_kv_store: kvStoreTool,
  nonla_openui: openuiTool,
};

export function formatToolName(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function getToolLabel(toolName: string): Promise<string> {
  if (isCallAgentToolName(toolName)) {
    return await getCallAgentLabel({ agent_id: parseCallAgentToolTargetId(toolName) });
  }
  if (isDatatableProjectToolName(toolName)) {
    return await getDatatableProjectLabel(parseDatatableProjectToolTargetId(toolName));
  }

  const KNOWN_LABELS: Record<string, string> = {
    nonla_get_current_time: "Get Current Time",
    get_current_time: "Get Current Time",
    nonla_web_fetch: "Web Fetch",
    web_fetch: "Web Fetch",
    fetch_url: "Web Fetch",
    browser: "Web Fetch",
    nonla_openui: "OpenUI",
    nonla_kv_store: "KV Store",
    kv_store: "KV Store",
    nonla_run_js: "Run JS",
    run_js: "Run JS",
    nonla_datatable: "Datatable",
    datatable: "Datatable",
    call_agent: "Call Agent",
    nonla_call_agent: "Call Agent",
    nonla_agent_task: "Agent Task",
    nonla_memory: "Memory",
    memory: "Memory",
    user_memory: "Memory",
    manage_memory: "Memory",
    nonla_read_skill: "Read Skill",
    read_skill: "Read Skill",
    get_tool_schema: "Get Tool Schema",
    nonla_background_tasks: "Background Tasks",
    background_tasks: "Background Tasks",
    nonla_read_current_code: "Read Current Code",
    read_current_code: "Read Current Code",
    nonla_edit_code: "Edit Code",
    edit_code: "Edit Code",
    nonla_run_current_script: "Run Current Script",
    run_current_script: "Run Current Script",
    get_nonlaagents_guide: "Nonlaagents SDK",
  };
  if (KNOWN_LABELS[toolName]) return KNOWN_LABELS[toolName];
  const adminLabel = NONLA_ADMIN_TOOL_DEFS.find((tool) => tool.toolName === toolName)?.toolLabel;
  if (adminLabel) return adminLabel;
  try {
    const db = getDb();
    const servers = await qall(db.select({ id: mcpServers.id, name: mcpServers.name, tools: mcpServers.tools }).from(mcpServers));
    for (const server of servers) {
      const catalog = (server.tools ?? []) as McpCatalogTool[];
      for (const t of catalog) {
        if (buildMcpToolName(server.name, t.name) === toolName) {
          return `${server.name} → ${t.name}`;
        }
      }
    }
    const row = await qone(db.select({ label: agentTools.label, folderName: toolFolders.name }).from(agentTools).leftJoin(toolFolders, eq(agentTools.folderId, toolFolders.id)).where(eq(agentTools.name, toolName)));
    if (row) {
      const label = row.label && row.label !== toolName ? row.label : formatToolName(toolName);
      return row.folderName ? `${row.folderName} → ${label}` : label;
    }
  } catch {
    /* ignore */
  }
  return formatToolName(toolName);
}

/** SVG markup for a custom tool, or null for builtins/MCP/unknown. */
export async function getToolIcon(toolName: string): Promise<string | null> {
  try {
    const row = await qone(getDb().select({ icon: agentTools.icon }).from(agentTools).where(eq(agentTools.name, toolName)));
    const icon = row?.icon?.trim();
    if (icon?.startsWith("<svg")) return icon;
  } catch {
    /* ignore */
  }
  return null;
}

export async function getCallAgentLabel(args: unknown): Promise<string> {
  try {
    const agentId = (args as { agent_id?: string; agentId?: string; id?: string } | null)?.agent_id ?? (args as { agentId?: string } | null)?.agentId ?? (args as { id?: string } | null)?.id;
    if (!agentId || typeof agentId !== "string") return "Call Agent";
    const db = getDb();
    const row = await qone(db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId)));
    if (row?.name) return `Call ${row.name}`;
  } catch {
    /* ignore */
  }
  return "Call Agent";
}

async function getDatatableProjectLabel(projectId: string | null): Promise<string> {
  if (!projectId) return "Datatable";
  try {
    const project = await getProject(projectId);
    if (project?.name) return `Datatable · ${project.name}`;
  } catch {
    /* ignore */
  }
  return "Datatable";
}

function buildZodSchema(parameters: object): z.ZodObject<Record<string, z.ZodType>> {
  const props = ((parameters as { properties?: Record<string, { type?: string; description?: string; default?: unknown }> })?.properties ?? {}) as Record<string, { type?: string; description?: string; default?: unknown }>;
  const required = ((parameters as { required?: string[] })?.required ?? []) as string[];
  const shape: Record<string, z.ZodType> = {};

  for (const [key, def] of Object.entries(props)) {
    let field: z.ZodType;
    switch (def.type) {
      case "number":
      case "integer":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      case "array":
        field = z.array(z.unknown());
        break;
      case "object":
        field = z.object({}).passthrough();
        break;
      default:
        field = z.string();
    }
    if (def.description) field = field.describe(def.description);
    if (def.default !== undefined) {
      field = field.optional().default(def.default) as z.ZodType;
    } else if (!required.includes(key)) {
      field = field.optional() as z.ZodType;
    }
    shape[key] = field;
  }

  return z.object(shape);
}

async function buildCustomTool(
  record: {
    id: string;
    name: string;
    description: string;
    parameters: object;
    codeContent: string;
  },
  context: { agentId: string; conversationId?: string | null },
): Promise<StructuredToolInterface> {
  const schema = buildZodSchema(record.parameters);

  return tool(
    async (input: unknown) => {
      try {
        const inputJson = JSON.stringify(input ?? {});
        const soft = await runToolWithSoftWait({
          id: record.id,
          inputJson,
          code: record.codeContent,
          softWaitMs: CUSTOM_TOOL_SOFT_WAIT_MS,
          agentId: context.agentId,
          conversationId: context.conversationId,
        });
        if (!soft) {
          return JSON.stringify({ error: `Custom tool "${record.name}" not found`, ok: false });
        }
        if (soft.status === "running") {
          return JSON.stringify({
            status: "running",
            taskId: soft.taskId,
            toolName: soft.toolName,
            message: "Still running in the background. Use nonla_background_tasks (await/get/list/cancel) with this taskId.",
          });
        }
        const result = JSON.parse(soft.payload) as { ok?: boolean; result?: unknown; error?: string };
        if (!result.ok) {
          return JSON.stringify({ error: result.error ?? `Custom tool "${record.name}" failed`, ok: false });
        }
        return JSON.stringify(result.result);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err), ok: false });
      }
    },
    { name: record.name, description: record.description, schema },
  );
}

async function buildMcpTool(opts: {
  name: string;
  description: string;
  parameters: object;
  serverId: string;
  mcpToolName: string;
  abortSignal?: AbortSignal;
}): Promise<StructuredToolInterface> {
  const schema = buildZodSchema(opts.parameters);

  return tool(
    async (input: unknown) => {
      try {
        const db = getDb();
        const server = await qone(db.select().from(mcpServers).where(eq(mcpServers.id, opts.serverId)));
        if (!server) {
          return JSON.stringify({ error: `MCP server not found for tool "${opts.name}"`, ok: false });
        }
        if (!server.isActive) {
          return JSON.stringify({ error: `MCP server is inactive for tool "${opts.name}"`, ok: false });
        }

        const result = await callMcpTool(opts.serverId, server.url, (server.headers ?? {}) as Record<string, string>, opts.mcpToolName, (input ?? {}) as Record<string, unknown>, { abortSignal: opts.abortSignal });
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err), ok: false });
      }
    },
    { name: opts.name, description: opts.description, schema },
  );
}

/** True when this assignment still points at a tool the catalog can run. */
async function assignedToolStillValid(toolId: string): Promise<boolean> {
  if (toolId.startsWith("builtin:")) {
    const id = canonicalBuiltinToolId(toolId);
    if (id === BUILTIN_DATATABLE_TOOL_ID) return true;
    return hasBuiltinTool(id);
  }

  const projectId = parseDatatableProjectAssignmentId(toolId);
  if (projectId) return (await getProject(projectId)) != null;

  const mcp = parseMcpToolId(toolId);
  if (mcp) {
    const server = await qone(getDb().select().from(mcpServers).where(eq(mcpServers.id, mcp.serverId)));
    if (!server) return false;
    const catalog = (server.tools ?? []) as McpCatalogTool[];
    return catalog.some((item) => item.name === mcp.toolName);
  }

  const row = await qone(getDb().select({ id: agentTools.id }).from(agentTools).where(eq(agentTools.id, toolId)));
  return row != null;
}

/** On invoke, drop the agent link when the tool is gone. Do not run it. */
function guardAssignedTool(agentId: string, toolId: string, inner: StructuredToolInterface): StructuredToolInterface {
  return tool(
    async (input, config) => {
      if (!(await assignedToolStillValid(toolId))) {
        await dropToolAssignment(agentId, toolId);
        return JSON.stringify({ ok: false, error: "Tool is no longer available." });
      }
      const result = await inner.invoke(input, config);
      return typeof result === "string" ? result : JSON.stringify(result);
    },
    {
      name: inner.name,
      description: inner.description,
      schema: inner.schema,
    },
  );
}

export type ResolveAgentToolsOptions = {
  callableAgents?: CallAgentTarget[];
  allowCallAgent?: boolean;
  abortSignal?: AbortSignal;
  /** Parent conversation — attached to nested call_agent usage rows. */
  conversationId?: string | null;
  enableMemory?: boolean;
  /** Model for Nonla Bot specialist tools that run inside this agent. */
  providerId?: string;
  modelId?: string;
};

/**
 * Resolve full tool list for a user agent.
 * @param enabledToolIds — assignment tool_id values (builtin:*, mcp:*, or custom UUID)
 */
export async function resolveAgentTools(agentId: string, enabledToolIds: string[], ownerId: string, isGuest = false, options: ResolveAgentToolsOptions = {}): Promise<StructuredToolInterface[]> {
  const db = getDb();
  const tools: StructuredToolInterface[] = [];
  const allowDatatableTools = isBuiltinAgentId(agentId);
  const hasDatatableProject = allowDatatableTools && enabledToolIds.some((id) => parseDatatableProjectAssignmentId(id));
  let nonlaCatalog: StructuredToolInterface[] | null = null;
  const loadNonlaCatalog = async () => {
    if (nonlaCatalog) return nonlaCatalog;
    const { makeNonlaBuiltinTools } = await import("../llm-tools/workspace.tool.js");
    nonlaCatalog = makeNonlaBuiltinTools({
      abortSignal: options.abortSignal,
      providerId: options.providerId,
      modelId: options.modelId,
    });
    return nonlaCatalog;
  };

  for (const toolId of enabledToolIds) {
    if (toolId.startsWith("builtin:")) {
      const name = canonicalBuiltinToolName(toolId.slice("builtin:".length));
      // call_agent is no longer a single assignable builtin — injected via callableAgents below
      if (name === "call_agent" || name === "nonla_call_agent") continue;
      if (!isBuiltinAgentId(agentId) && NONLA_ADMIN_TOOL_DEFS.some((tool) => tool.toolName === name)) continue;
      // Pinned builtins are attached below. An assignment cannot turn them off.
      if (name === AGENT_TASK_TOOL_NAME || name === "nonla_memory" || name === "nonla_get_current_time" || name === "nonla_openui") continue;
      if (canonicalBuiltinToolId(toolId) === BUILTIN_DATATABLE_TOOL_ID) {
        if (allowDatatableTools && !hasDatatableProject) tools.push(guardAssignedTool(agentId, toolId, schemaOnlyDatatableTool));
        continue;
      }
      if (name === "nonla_run_js") {
        if (!tools.some((existing) => existing.name === "nonla_run_js")) {
          tools.push(
            guardAssignedTool(
              agentId,
              toolId,
              makeRunJsTool({
                agentId,
                conversationId: options.conversationId ?? null,
                abortSignal: options.abortSignal,
              }),
            ),
          );
        }
        continue;
      }
      if (name === "nonla_web_fetch") {
        if (!tools.some((t) => t.name === "nonla_web_fetch")) tools.push(guardAssignedTool(agentId, toolId, webFetchTool));
        continue;
      }
      if (name in STATIC_BUILTINS) {
        tools.push(guardAssignedTool(agentId, toolId, STATIC_BUILTINS[name]));
        continue;
      }
      const admin = (await loadNonlaCatalog()).find((item) => item.name === name);
      if (admin && !tools.some((existing) => existing.name === admin.name)) tools.push(guardAssignedTool(agentId, toolId, admin));
      continue;
    }

    const datatableProjectId = parseDatatableProjectAssignmentId(toolId);
    if (datatableProjectId) {
      if (allowDatatableTools) {
        const project = await getProject(datatableProjectId);
        if (project) tools.push(guardAssignedTool(agentId, toolId, makeDatatableProjectTool(project)));
      }
      continue;
    }

    const mcp = parseMcpToolId(toolId);
    if (mcp) {
      const server = await qone(db.select().from(mcpServers).where(eq(mcpServers.id, mcp.serverId)));
      if (!server || !server.isActive) continue;
      const catalog = (server.tools ?? []) as McpCatalogTool[];
      const def = catalog.find((t) => t.name === mcp.toolName);
      if (!def) continue;

      tools.push(
        guardAssignedTool(
          agentId,
          toolId,
          await buildMcpTool({
            name: buildMcpToolName(server.name, def.name),
            description: def.description || `MCP tool from ${server.name}`,
            parameters: def.inputSchema,
            serverId: server.id,
            mcpToolName: def.name,
            abortSignal: options.abortSignal,
          }),
        ),
      );
      continue;
    }

    const row = await qone(db.select().from(agentTools).where(eq(agentTools.id, toolId)));
    if (row?.isActive) {
      tools.push(
        guardAssignedTool(
          agentId,
          toolId,
          await buildCustomTool(row, {
            agentId,
            conversationId: options.conversationId ?? null,
          }),
        ),
      );
    }
  }

  if (options.allowCallAgent !== false && options.callableAgents && options.callableAgents.length > 0) {
    tools.push(
      ...makeCallAgentTools({
        callerAgentId: agentId,
        targets: options.callableAgents,
        ownerId,
        isGuest,
        abortSignal: options.abortSignal,
        conversationId: options.conversationId ?? null,
        enableMemory: options.enableMemory,
        providerId: options.providerId,
        modelId: options.modelId,
      }),
    );
  }

  if (options.enableMemory !== false && !isBuiltinAgentId(agentId) && !tools.some((existing) => existing.name === "nonla_memory")) {
    tools.push(await makeMemoryTool(agentId, ownerId, isGuest, { conversationId: options.conversationId ?? null }));
  }
  if (!tools.some((existing) => existing.name === "nonla_read_skill")) {
    tools.push(await makeReadSkillTool(agentId));
  }
  if (!tools.some((existing) => existing.name === "nonla_background_tasks")) {
    tools.push(makeBackgroundTasksTool({ agentId, conversationId: options.conversationId ?? null }));
  }
  if (!tools.some((existing) => existing.name === "nonla_get_current_time")) {
    tools.push(getCurrentTimeTool);
  }
  if (options.conversationId && !tools.some((existing) => existing.name === "nonla_read_message")) {
    tools.push(...makeHistoryTools(options.conversationId));
  }
  if (!tools.some((existing) => existing.name === "nonla_openui")) {
    tools.push(openuiTool);
  }

  if (agentId === NONLA_BOT_AGENT_ID) {
    const { NONLA_BOT_DELEGATED_TOOLS } = await import("../llm-tools/workspace.tool.js");
    for (const item of await loadNonlaCatalog()) {
      if (NONLA_BOT_DELEGATED_TOOLS.has(item.name)) continue;
      if (!tools.some((existing) => existing.name === item.name)) tools.push(item);
    }
  }

  if (!tools.some((existing) => existing.name === AGENT_TASK_TOOL_NAME)) {
    tools.push(
      makeAgentTaskTool({
        parentTools: tools,
        callerAgentId: agentId,
        providerId: options.providerId,
        modelId: options.modelId,
        abortSignal: options.abortSignal,
        conversationId: options.conversationId ?? null,
      }),
    );
  }

  return tools;
}
