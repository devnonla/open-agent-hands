import type { StructuredToolInterface } from "@langchain/core/tools";
import { makeSkillAdminTools } from "../../agents/runtime/llm-tools/skill-admin.tool.js";
import { NONLA_SKILL_MANAGER_ID } from "../builtin-ids.js";
import { skillManagerInstruct } from "../instructs/skill-manager.js";
import type { ManagerToolCtx, SpecialistDef } from "./types.js";

export { NONLA_SKILL_MANAGER_ID };

export const SKILL_MANAGER_DELEGATED_TOOLS = ["nonla_manage_skills", "nonla_manage_skill_folders", "nonla_get_skill_files", "nonla_edit_skill_code", "nonla_delete_skill_file"] as const;

export const skillManagerSpecialist: SpecialistDef = {
  id: NONLA_SKILL_MANAGER_ID,
  label: "Skill Manager",
  group: "skills",
  instruct: skillManagerInstruct,
  job: "List, create, update, and delete skills and skill folders. To change files, this manager reads and edits the code itself. Edits go live at once. Call this agent for any skill work.",
  uses: [
    { id: "nonla_manage_skills", label: "Manage Skills" },
    { id: "nonla_manage_skill_folders", label: "Manage Skill Folders" },
    { id: "nonla_get_skill_files", label: "Get Skill Files" },
    { id: "nonla_edit_skill_code", label: "Edit Skill Code" },
    { id: "nonla_delete_skill_file", label: "Delete Skill File" },
    { id: "nonla_web_fetch", label: "nonla_web_fetch" },
    { id: "nonla_run_js", label: "nonla_run_js" },
    { id: "nonla_get_current_time", label: "nonla_get_current_time" },
    { id: "nonla_openui", label: "OpenUI" },
  ],
};

export function makeSkillManagerTools(_ctx: ManagerToolCtx = {}): StructuredToolInterface[] {
  return [...makeSkillAdminTools()];
}
