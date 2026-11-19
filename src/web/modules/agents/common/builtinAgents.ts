/** Same ids as src/server/src/modules/nonla-bot/builtin-ids.ts */

export const BUILTIN_TEAM_ID = "builtin";

export function isBuiltinAgentId(id: string): boolean {
  return id === "nonla-bot" || id.startsWith("nonla_");
}

export function isCoreManagerAgentId(id: string): boolean {
  return id.startsWith("nonla_");
}

export function agentModelLabel(agent: { id: string; aiModel: string | null }): string {
  if (!agent.aiModel) return isCoreManagerAgentId(agent.id) ? "Inherit" : "No model";
  return agent.aiModel.split("/").pop() || agent.aiModel;
}
