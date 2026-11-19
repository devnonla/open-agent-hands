export const BUILTIN_SKILL_FOLDER_ID = "builtin";

export function isBuiltinSkillId(id: string): boolean {
  return id.startsWith("nonla_skill_");
}
