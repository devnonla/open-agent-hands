import { NONLA_BOT_AGENT_ID } from "./builtin-ids.js";
import { NONLA_BOT_SYSTEM_PROMPT } from "./instructs/nonla-bot.js";
import { NONLA_SPECIALISTS } from "./managers/index.js";

export { BUILTIN_TEAM_ID, NONLA_BOT_AGENT_ID, isBuiltinAgentId } from "./builtin-ids.js";

export const BUILTIN_TEAM_NAME = "Builtin";

export type BuiltinAgentKind = "bot" | "manage";

export type BuiltinAgentDef = {
  id: string;
  name: string;
  description: string;
  kind: BuiltinAgentKind;
  instruct: () => string;
};

const NONLA_BOT: BuiltinAgentDef = {
  id: NONLA_BOT_AGENT_ID,
  name: "Nonla Bot",
  description: "Workspace assistant. Calls a manager for agents, tools, skills, sites, jobs, and datatables. Handles KV entries and secrets itself. Does not write source or a live prompt.",
  kind: "bot",
  instruct: () => NONLA_BOT_SYSTEM_PROMPT,
};

export function builtinAgentCatalog(): BuiltinAgentDef[] {
  const managers: BuiltinAgentDef[] = NONLA_SPECIALISTS.map((item) => ({
    id: item.id,
    name: item.label,
    description: item.job,
    kind: "manage",
    instruct: item.instruct,
  }));
  return [NONLA_BOT, ...managers];
}
