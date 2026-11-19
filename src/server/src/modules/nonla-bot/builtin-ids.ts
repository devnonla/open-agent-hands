export const BUILTIN_TEAM_ID = "builtin";
export const BUILTIN_SKILL_FOLDER_ID = "builtin";
export const NONLA_BOT_AGENT_ID = "nonla-bot";
export const WRITE_AGENT_INSTRUCT_SKILL_ID = "nonla_skill_write_agent_instruct";
export const SDK_SKILL_ID = "nonla_skill_sdk";
export const CODE_RULES_SKILL_ID = "nonla_skill_code_rules";
export const TESTER_BRIEF_SKILL_ID = "nonla_skill_tester_brief";

export const NONLA_AGENT_MANAGER_ID = "nonla_agent_manager";

export const NONLA_TOOL_MANAGER_ID = "nonla_tool_manager";

export const NONLA_SKILL_MANAGER_ID = "nonla_skill_manager";

export const NONLA_SITE_MANAGER_ID = "nonla_site_manager";

export const NONLA_JOB_MANAGER_ID = "nonla_job_manager";

export const NONLA_DATATABLE_MANAGER_ID = "nonla_datatable_manager";

export function isBuiltinAgentId(id: string): boolean {
  return id === NONLA_BOT_AGENT_ID || id.startsWith("nonla_");
}

export function isCoreManagerAgentId(id: string): boolean {
  return id.startsWith("nonla_");
}

export function isBuiltinSkillId(id: string): boolean {
  return id.startsWith("nonla_skill_");
}
