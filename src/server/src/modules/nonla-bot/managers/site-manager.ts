import type { StructuredToolInterface } from "@langchain/core/tools";
import { makeSiteAdminTools } from "../../agents/runtime/llm-tools/site-admin.tool.js";
import { NONLA_SITE_MANAGER_ID } from "../builtin-ids.js";
import { siteManagerInstruct } from "../instructs/site-manager.js";
import type { ManagerToolCtx, SpecialistDef } from "./types.js";

export { NONLA_SITE_MANAGER_ID };

export const SITE_MANAGER_DELEGATED_TOOLS = ["nonla_manage_sites", "nonla_get_site_code", "nonla_edit_site_code", "nonla_check_site"] as const;

export const siteManagerSpecialist: SpecialistDef = {
  id: NONLA_SITE_MANAGER_ID,
  label: "Site Manager",
  group: "sites",
  instruct: siteManagerInstruct,
  job: "List, create, update, and delete sites. To change files, this manager reads, edits, and checks the code itself until it runs clean. Edits go live at once. One agent task then tests it again. Call this agent for any site work.",
  uses: [
    { id: "nonla_manage_sites", label: "Manage Sites" },
    { id: "nonla_get_site_code", label: "Get Site Code" },
    { id: "nonla_edit_site_code", label: "Edit Site Code" },
    { id: "nonla_check_site", label: "Check Site" },
    { id: "nonla_agent_task", label: "Agent Task" },
    { id: "nonla_web_fetch", label: "nonla_web_fetch" },
    { id: "nonla_run_js", label: "nonla_run_js" },
    { id: "nonla_get_current_time", label: "nonla_get_current_time" },
    { id: "nonla_openui", label: "OpenUI" },
    { id: "nonla_datatable", label: "nonla_datatable · list_projects, get_schema" },
  ],
};

export function makeSiteManagerTools(_ctx: ManagerToolCtx = {}): StructuredToolInterface[] {
  return makeSiteAdminTools();
}
