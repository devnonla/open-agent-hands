import { NONLA_BUILTIN_TOOLS, NONLA_SPECIALISTS, NONLA_TOOL_GROUPS } from "./managers/index.js";

export { NONLA_BOT_SYSTEM_PROMPT } from "./instructs/nonla-bot.js";

export interface NonlaBotToolGroup {
  id: string;
  name: string;
  kind: "builtin" | "subagent";
  tools: { id: string; label: string; uses?: { id: string; label: string }[] }[];
}

function shownInPanel(tool: (typeof NONLA_BUILTIN_TOOLS)[number]): boolean {
  return !("hidden" in tool && tool.hidden);
}

export async function listNonlaBotToolGroups(): Promise<NonlaBotToolGroup[]> {
  const groups = NONLA_TOOL_GROUPS.map((group) => ({
    id: group.id,
    name: group.name,
    kind: "builtin" as const,
    tools: NONLA_BUILTIN_TOOLS.filter((tool) => tool.group === group.id && shownInPanel(tool)).map((tool) => ({ id: tool.id, label: tool.label })),
  })).filter((group) => group.tools.length > 0);
  const subAgents = NONLA_SPECIALISTS.map((tool) => ({ id: tool.id, label: tool.label, uses: tool.uses }));
  if (subAgents.length === 0) return groups;
  return [...groups, { id: "subagents", name: "Sub agents", kind: "subagent", tools: subAgents }];
}
