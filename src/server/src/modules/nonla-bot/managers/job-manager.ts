import type { StructuredToolInterface } from "@langchain/core/tools";
import { makeJobAdminTools } from "../../agents/runtime/llm-tools/job-admin.tool.js";
import { NONLA_JOB_MANAGER_ID } from "../builtin-ids.js";
import { jobManagerInstruct } from "../instructs/job-manager.js";
import type { ManagerToolCtx, SpecialistDef } from "./types.js";

export { NONLA_JOB_MANAGER_ID };

export const JOB_MANAGER_DELEGATED_TOOLS = ["nonla_manage_jobs", "nonla_get_job_code", "nonla_edit_job_code", "nonla_run_job"] as const;

export const jobManagerSpecialist: SpecialistDef = {
  id: NONLA_JOB_MANAGER_ID,
  label: "Job Manager",
  group: "jobs",
  instruct: jobManagerInstruct,
  job: "List, create, update, and delete jobs. Update covers schedule and settings. To change the script, this manager reads, edits, and runs the code itself until it runs clean. Edits go live at once. One agent task then tests it again. Call this agent for any job work.",
  uses: [
    { id: "nonla_manage_jobs", label: "Manage Jobs" },
    { id: "nonla_get_job_code", label: "Get Job Code" },
    { id: "nonla_edit_job_code", label: "Edit Job Code" },
    { id: "nonla_run_job", label: "Run Job" },
    { id: "nonla_agent_task", label: "Agent Task" },
    { id: "nonla_web_fetch", label: "Web Fetch" },
    { id: "nonla_run_js", label: "Run JS" },
    { id: "nonla_get_current_time", label: "Get Current Time" },
    { id: "nonla_openui", label: "OpenUI" },
    { id: "nonla_datatable", label: "nonla_datatable · list_projects, get_schema" },
  ],
};

export function makeJobManagerTools(_ctx: ManagerToolCtx = {}): StructuredToolInterface[] {
  return makeJobAdminTools();
}
