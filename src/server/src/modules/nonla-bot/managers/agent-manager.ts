import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { createAgent, deleteAgent, getAgent, listAgents, listAssignments, listSkillAssignments, setAssignments, setSkillAssignments, updateAgent } from "../../agents/agents.service.js";
import { makeSystemPromptTools } from "../../agents/prompt-agent/llm-tools/system-prompt.tool.js";
import { callAgentToolName } from "../../agents/runtime/llm-tools/call-agent.tool.js";
import { getProvider, listModelChoices } from "../../llm-providers/llm-providers.service.js";
import { getMcpServer, listMcpServers } from "../../mcp-servers/mcp-servers.service.js";
import { buildMcpToolId, parseMcpToolId } from "../../mcp-servers/mcp-tool-id.js";
import { listSkills } from "../../skills/skills.service.js";
import { createTeam, deleteTeam, listTeams, updateTeam } from "../../teams/teams.service.js";
import { canonicalBuiltinToolId } from "../../tools/builtin-names.js";
import { getBuiltinTool, getTool, listTools } from "../../tools/tools.service.js";
import { NONLA_AGENT_MANAGER_ID, isBuiltinAgentId } from "../builtin-ids.js";
import { agentManagerInstruct } from "../instructs/agent-manager.js";
import { type Fields, errorMessage, fail, makeManageTool, ok, requireId, requireName, text } from "./helpers.js";
import type { SpecialistDef } from "./types.js";

export { NONLA_AGENT_MANAGER_ID };

type ToolOption = { id: string; label: string; kind: "builtin" | "custom" | "mcp"; description: string };

async function listToolOptions(): Promise<ToolOption[]> {
  const options: ToolOption[] = [];
  const tools = await listTools({ limit: "200" });
  for (const row of tools.items as { id: string; label: string; description?: string | null; workspaceOnly?: boolean; alwaysOn?: boolean }[]) {
    if (row.workspaceOnly || row.alwaysOn) continue;
    options.push({ id: row.id, label: row.label, kind: row.id.startsWith("builtin:") ? "builtin" : "custom", description: row.description ?? "" });
  }
  const servers = await listMcpServers({ limit: "200" });
  for (const server of servers.items as { id: string; name: string; tools?: { name: string; description?: string }[] }[]) {
    for (const mcpTool of server.tools ?? []) {
      options.push({ id: buildMcpToolId(server.id, mcpTool.name), label: `${server.name} → ${mcpTool.name}`, kind: "mcp", description: mcpTool.description ?? "" });
    }
  }
  return options;
}

async function assertToolIdsExist(toolIds: string[]): Promise<void> {
  const bad: string[] = [];
  for (const toolId of toolIds) {
    if (toolId.startsWith("datatable:") || toolId === "builtin:datatable" || canonicalBuiltinToolId(toolId) === "builtin:nonla_datatable") {
      throw new Error(`Datatable tools are no longer assignable (${toolId}). Enable Datatable Manager under Call Agents instead.`);
    }
    if (toolId.startsWith("builtin:")) {
      const builtin = getBuiltinTool(toolId);
      if (!builtin) {
        bad.push(toolId);
        continue;
      }
      if (builtin.workspaceOnly) throw new Error(`${toolId} is a workspace admin tool. Only builtin agents can use it. Don't assign it to this agent.`);
      continue;
    }
    const mcp = parseMcpToolId(toolId);
    if (mcp) {
      const server = await getMcpServer(mcp.serverId);
      if (!server || !(server.tools ?? []).some((item: { name: string }) => item.name === mcp.toolName)) bad.push(toolId);
      continue;
    }
    try {
      if (!(await getTool(toolId))) bad.push(toolId);
    } catch {
      bad.push(toolId);
    }
  }
  if (bad.length > 0) throw new Error(`Unknown tool ids: ${bad.join(", ")}. Call list_tools for valid ids.`);
}

function stringIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`'${field}' is required (array of ids)`);
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))];
}

async function modelFields(fields: Fields, current?: { aiProvider: string | null; aiModel: string | null }): Promise<{ aiProvider: string; aiModel: string } | undefined> {
  const sentProvider = typeof fields.aiProvider === "string";
  const sentModel = typeof fields.aiModel === "string";
  if (!sentProvider && !sentModel) return undefined;
  const aiProvider = text(sentProvider ? fields.aiProvider : current?.aiProvider);
  const aiModel = text(sentModel ? fields.aiModel : current?.aiModel);
  if (!aiProvider || !aiModel) throw new Error("Set aiProvider and aiModel together. Call nonla_list_model_providers.");
  const row = await getProvider(aiProvider);
  if (!row) throw new Error(`Provider "${aiProvider}" not found. Call nonla_list_model_providers.`);
  if (!(row.models ?? []).includes(aiModel)) throw new Error(`Model "${aiModel}" is not on that provider. Call nonla_list_model_providers.`);
  return { aiProvider, aiModel };
}

async function handleAgents(action: string, fields: Fields): Promise<unknown> {
  if (action === "list") {
    const items = await listAgents();
    return items.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? "",
      isActive: agent.isActive,
      teamId: agent.teamId,
      aiProvider: agent.aiProvider,
      aiModel: agent.aiModel,
    }));
  }

  if (action === "get") {
    const agent = await getAgent(requireId(fields));
    if (!agent) throw new Error("Agent not found");
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      isActive: agent.isActive,
      isPublic: agent.isPublic,
      teamId: agent.teamId,
      aiProvider: agent.aiProvider,
      aiModel: agent.aiModel,
    };
  }

  if (action === "create") {
    const name = requireName(fields);
    const model = await modelFields(fields);
    const created = await createAgent({
      name,
      description: text(fields.description) || null,
      systemPrompt: "",
      aiProvider: model?.aiProvider ?? null,
      aiModel: model?.aiModel ?? null,
      teamId: text(fields.teamId) || null,
      isActive: true,
      isPublic: false,
      callableAgentIds: [],
    });
    return { id: created.id, name: created.name, aiProvider: created.aiProvider, aiModel: created.aiModel };
  }

  if (action === "update") {
    const id = requireId(fields);
    if (isBuiltinAgentId(id)) throw new Error("Builtin agents are read-only. Change their model on the dashboard.");
    const current = await getAgent(id);
    if (!current) throw new Error("Agent not found");
    const model = await modelFields(fields, current);
    const patch: Parameters<typeof updateAgent>[1] = {};
    if (typeof fields.name === "string") patch.name = fields.name;
    if (typeof fields.description === "string") patch.description = fields.description;
    if (typeof fields.teamId === "string") patch.teamId = fields.teamId || null;
    if (model) {
      patch.aiProvider = model.aiProvider;
      patch.aiModel = model.aiModel;
    }
    if (typeof fields.isActive === "boolean") patch.isActive = fields.isActive;
    if (typeof fields.isPublic === "boolean") patch.isPublic = fields.isPublic;
    const updated = await updateAgent(id, patch);
    return updated ? { id: updated.id, name: updated.name, aiProvider: updated.aiProvider, aiModel: updated.aiModel } : null;
  }

  if (action === "delete") {
    const id = requireId(fields);
    await deleteAgent(id);
    return { deleted: id };
  }

  throw new Error(`Unknown agents action "${action}". Use list, get, create, update, delete. Tools, skills, and callable agents are on nonla_manage_agent.`);
}

async function handleAgent(action: string, fields: Fields): Promise<unknown> {
  if (action === "list_available_tools") return await listToolOptions();

  if (action === "list_available_skills") {
    const result = await listSkills({ limit: "200" });
    return result.items.map((skill: { id: string; name: string; description?: string | null }) => ({ id: skill.id, name: skill.name, description: skill.description ?? "" }));
  }

  if (action === "list_assigned_tools") {
    const id = requireId(fields);
    if (!(await getAgent(id))) throw new Error("Agent not found");
    return (await listAssignments(id)).map((row) => ({ toolId: row.toolId, label: row.tool.label, name: row.tool.name }));
  }

  if (action === "list_assigned_skills") {
    const id = requireId(fields);
    if (!(await getAgent(id))) throw new Error("Agent not found");
    return (await listSkillAssignments(id)).map((row) => ({ skillId: row.skillId, name: row.skill.name }));
  }

  if (action === "list_assigned_agents") {
    const id = requireId(fields);
    const agent = await getAgent(id);
    if (!agent) throw new Error("Agent not found");
    const all = await listAgents();
    const callable = new Set(agent.callableAgentIds ?? []);
    return all.filter((item) => callable.has(item.id)).map((item) => ({ agentId: item.id, name: item.name, toolName: callAgentToolName(item.id) }));
  }

  const change = action.match(/^(set|add|remove)_assigned_(tools|skills|agents)$/);
  if (change) {
    const mode = change[1] as "set" | "add" | "remove";
    const kind = change[2] as "tools" | "skills" | "agents";
    return await changeAssigned(mode, kind, requireId(fields), fields);
  }

  throw new Error(`Unknown agent action "${action}". Use list_available_tools, list_available_skills, list_assigned_tools, list_assigned_skills, list_assigned_agents, set_assigned_*, add_assigned_*, remove_assigned_* (tools, skills, agents).`);
}

const ASSIGNED_FIELD = { tools: "toolIds", skills: "skillIds", agents: "agentIds" } as const;

async function changeAssigned(mode: "set" | "add" | "remove", kind: "tools" | "skills" | "agents", id: string, fields: Fields): Promise<unknown> {
  const agent = await getAgent(id);
  if (!agent) throw new Error("Agent not found");
  const key = (value: string) => (kind === "tools" && value.startsWith("builtin:") ? canonicalBuiltinToolId(value) : value);
  const sent = stringIds(fields[ASSIGNED_FIELD[kind]], ASSIGNED_FIELD[kind]).map(key);
  const current = kind === "tools" ? (await listAssignments(id)).map((row) => row.toolId) : kind === "skills" ? (await listSkillAssignments(id)).map((row) => row.skillId) : [...(agent.callableAgentIds ?? [])];
  const next = mode === "set" ? sent : mode === "add" ? [...new Set([...current, ...sent])] : current.filter((item) => !sent.includes(item));
  const toCheck = mode === "remove" ? [] : sent;

  if (kind === "tools") {
    await assertToolIdsExist(toCheck);
    const rows = await setAssignments(
      id,
      next.map((toolId) => ({ toolId })),
    );
    return rows.map((row) => ({ toolId: row.toolId, label: row.tool.label, name: row.tool.name }));
  }

  if (kind === "skills") {
    const rows = await setSkillAssignments(
      id,
      next.map((skillId) => ({ skillId })),
    );
    return rows.map((row) => ({ skillId: row.skillId, name: row.skill.name }));
  }

  if (toCheck.includes(id)) throw new Error("An agent cannot call itself");
  const missing: string[] = [];
  for (const targetId of toCheck) {
    if (!(await getAgent(targetId))) missing.push(targetId);
  }
  if (missing.length > 0) throw new Error(`Agent not found: ${missing.join(", ")}`);
  const updated = await updateAgent(id, { callableAgentIds: next });
  return { id, callableAgentIds: updated?.callableAgentIds ?? next };
}

async function handleTeams(action: string, fields: Fields): Promise<unknown> {
  if (action === "list") {
    const result = await listTeams({ limit: "200" });
    return result.items.map((team: { id: string; name: string; description?: string | null; agentIds?: string[] }) => ({
      id: team.id,
      name: team.name,
      description: team.description ?? "",
      agentIds: team.agentIds ?? [],
    }));
  }
  if (action === "create") {
    const created = await createTeam({ name: requireName(fields), description: text(fields.description) || undefined });
    return { id: created.id, name: created.name };
  }
  if (action === "update") {
    const updated = await updateTeam(requireId(fields), {
      ...(typeof fields.name === "string" ? { name: fields.name } : {}),
      ...(typeof fields.description === "string" ? { description: fields.description } : {}),
    });
    return updated;
  }
  if (action === "delete") {
    const id = requireId(fields);
    await deleteTeam(id);
    return { deleted: id };
  }
  throw new Error(`Unknown teams action "${action}". Use list, create, update, delete.`);
}

const MANAGE_AGENT_SCHEMA = z.object({
  action: z.string().describe("list_available_tools, list_available_skills, list_assigned_tools, list_assigned_skills, list_assigned_agents, and set_assigned_*, add_assigned_*, remove_assigned_* for tools, skills, agents"),
  id: z.string().optional().describe("The agent id. Needed for every list_assigned_*, set_assigned_*, add_assigned_* and remove_assigned_* action."),
  body: z.record(z.string(), z.any()).optional().describe("tools actions: toolIds string array. skills actions: skillIds string array. agents actions: agentIds string array."),
});

export function makeManageAgentsTool(): StructuredToolInterface {
  return makeManageTool(
    "nonla_manage_agents",
    `Add, edit, and delete agents. This tool works on many agents.
Actions: list, get, create, update, delete.
create needs name. Optional description, and body.teamId, body.aiProvider, body.aiModel.
aiProvider is a provider id from nonla_list_model_providers. aiModel is one model id on that provider. Set them together. Do not invent ids.
update can change name, description, teamId, aiProvider, aiModel, isActive, isPublic. It does not change the live prompt. teamId moves an agent to another team.
get returns the live prompt. List before update or delete.
Tools, skills, and callable agents of one agent are on nonla_manage_agent. The system prompt is on nonla_get_system_prompt and nonla_edit_system_prompt.`,
    handleAgents,
  );
}

export function makeManageAgentTool(): StructuredToolInterface {
  return makeManageTool(
    "nonla_manage_agent",
    `Connect one agent to tools, MCP tools, skills, and other agents. id is the agent id.
Actions:
- list_available_tools: every tool id you can assign. builtin:*, custom tool ids, mcp:{serverId}:{toolName}. Each has label and kind. Workspace admin tools (nonla_manage_*) and tools every agent already has are not listed. Datatable access is via Call Agents → Datatable Manager, not a tool assignment. KV and secrets stay with Nonla Bot. Do not assign them.
- list_available_skills: every skill id, name, and description.
- Agents you can assign: use nonla_manage_agents list.
- list_assigned_tools: toolId, label, and name. name is the tool name the agent calls.
- list_assigned_skills: skillId and name.
- list_assigned_agents: agentId, name, and toolName. toolName is the tool name the agent calls.
- All three need id.
- Change what is connected, for tools, skills, and agents:
  - set_assigned_tools / set_assigned_skills / set_assigned_agents replace the whole list. Use for a new agent or a full redo. Body: toolIds, skillIds, agentIds.
  - add_assigned_* adds the ids you send and keeps the rest. remove_assigned_* removes the ids you send and keeps the rest. Use for small changes. They need no list_assigned_* first.
  - Each returns the new list. Unknown ids fail. An agent cannot be assigned to itself. Old tool ids builtin:web_fetch, builtin:run_js, and builtin:get_current_time still work.`,
    handleAgent,
    MANAGE_AGENT_SCHEMA,
  );
}

export function makeListModelProvidersTool(): StructuredToolInterface {
  return tool(
    async () => {
      try {
        return ok(await listModelChoices());
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_list_model_providers",
      description: "List model providers and the model ids on each. Use a provider id as aiProvider and one of its model ids as aiModel on nonla_manage_agents create or update. Does not return API keys. Does not create providers.",
      schema: z.object({}),
    },
  );
}

export function makeManageTeamsTool(): StructuredToolInterface {
  return makeManageTool(
    "nonla_manage_agent_teams",
    `Add, edit, and delete agent teams.
Actions: list, create, update, delete.
create needs name. Optional description.
List before update or delete.`,
    handleTeams,
  );
}

export const AGENT_MANAGER_DELEGATED_TOOLS = ["nonla_manage_agents", "nonla_manage_agent", "nonla_manage_agent_teams", "nonla_list_model_providers", "nonla_get_system_prompt", "nonla_edit_system_prompt"] as const;

export const agentManagerSpecialist: SpecialistDef = {
  id: NONLA_AGENT_MANAGER_ID,
  label: "Agent Manager",
  group: "agents",
  instruct: agentManagerInstruct,
  job: "List, create, update, and delete agents. Set their team, tools, skills and callable agents. To change a system prompt, this manager gets live, drafts a candidate, invokes Reviewer, then edits systemPrompt when passed is true. Call this agent for any agent work.",
  uses: [
    { id: "nonla_manage_agents", label: "Manage Agents" },
    { id: "nonla_manage_agent", label: "Manage an Agent" },
    { id: "nonla_manage_agent_teams", label: "Manage Agent Teams" },
    { id: "nonla_list_model_providers", label: "List Model Providers" },
    { id: "nonla_agent_task", label: "Agent Task" },
    { id: "nonla_get_system_prompt", label: "Get System Prompt" },
    { id: "nonla_edit_system_prompt", label: "Edit System Prompt" },
    { id: "nonla_web_fetch", label: "nonla_web_fetch" },
    { id: "nonla_run_js", label: "nonla_run_js" },
    { id: "nonla_get_current_time", label: "nonla_get_current_time" },
    { id: "nonla_openui", label: "OpenUI" },
  ],
};

export function makeAgentManagerTools(): StructuredToolInterface[] {
  return [makeManageTeamsTool(), makeListModelProvidersTool(), makeManageAgentsTool(), makeManageAgentTool(), ...makeSystemPromptTools()];
}
