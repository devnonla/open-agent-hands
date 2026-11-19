import type { StructuredToolInterface } from "@langchain/core/tools";
import { makeRunJsTool } from "../../../common/ai/agent-tools/run-js.tool.js";
import { webFetchTool } from "../../../common/ai/agent-tools/web-fetch.tool.js";
import { makeBackgroundTasksTool } from "../../agents/runtime/llm-tools/background-tasks.tool.js";
import { getCurrentTimeTool } from "../../agents/runtime/llm-tools/get-current-time.tool.js";
import { makeGotoPageTool } from "../../agents/runtime/llm-tools/goto-page.tool.js";
import { openuiTool } from "../../agents/runtime/llm-tools/openui.tool.js";
import { NONLA_BOT_AGENT_ID } from "../builtin-ids.js";
import { AGENT_MANAGER_DELEGATED_TOOLS, agentManagerSpecialist, makeAgentManagerTools } from "./agent-manager.js";
import { DATATABLE_MANAGER_DELEGATED_TOOLS, datatableManagerSpecialist, makeDatatableManagerTools } from "./datatable-manager.js";
import { JOB_MANAGER_DELEGATED_TOOLS, jobManagerSpecialist, makeJobManagerTools } from "./job-manager.js";
import { makeKvManagerTools } from "./kv-manager.js";
import { makeManageMcpTool } from "./mcp.js";
import { SITE_MANAGER_DELEGATED_TOOLS, makeSiteManagerTools, siteManagerSpecialist } from "./site-manager.js";
import { SKILL_MANAGER_DELEGATED_TOOLS, makeSkillManagerTools, skillManagerSpecialist } from "./skill-manager.js";
import { TOOL_MANAGER_DELEGATED_TOOLS, makeToolManagerTools, toolManagerSpecialist } from "./tool-manager.js";
import type { ManagerToolCtx, SpecialistDef } from "./types.js";

export type { SpecialistDef, SpecialistUse, ManagerToolCtx } from "./types.js";

export {
  NONLA_AGENT_MANAGER_ID,
  NONLA_JOB_MANAGER_ID,
  NONLA_SITE_MANAGER_ID,
  NONLA_SKILL_MANAGER_ID,
  NONLA_DATATABLE_MANAGER_ID,
  NONLA_TOOL_MANAGER_ID,
} from "../builtin-ids.js";

export {
  makeManageAgentTool,
  makeManageAgentsTool,
  makeManageTeamsTool,
  makeListModelProvidersTool,
  makeAgentManagerTools,
} from "./agent-manager.js";
export { makeDatatableManagerTools, makeManageDatatablesTool } from "./datatable-manager.js";
export { makeKvManagerTools, makeManageKvTool, makeManageSecretsTool } from "./kv-manager.js";
export { makeManageMcpTool } from "./mcp.js";
export { makeToolManagerTools } from "./tool-manager.js";
export { makeSkillManagerTools } from "./skill-manager.js";
export { makeSiteManagerTools } from "./site-manager.js";
export { makeJobManagerTools } from "./job-manager.js";

export const NONLA_TOOL_GROUPS = [
  { id: "builtin", name: "Builtin" },
  { id: "agents", name: "Agents" },
  { id: "tools", name: "Tools" },
  { id: "skills", name: "Skills" },
  { id: "sites", name: "Sites" },
  { id: "jobs", name: "Jobs" },
  { id: "mcp", name: "MCP Servers" },
  { id: "datatables", name: "Datatables" },
  { id: "kv", name: "KV Store" },
  { id: "secrets", name: "Secrets" },
] as const;

export const NONLA_BUILTIN_TOOLS = [
  { id: "nonla_web_fetch", label: "Web Fetch", group: "builtin" },
  { id: "nonla_run_js", label: "Run JS", group: "builtin" },
  { id: "nonla_get_current_time", label: "Get Current Time", group: "builtin" },
  { id: "nonla_openui", label: "OpenUI", group: "builtin" },
  { id: "nonla_background_tasks", label: "Background Tasks", group: "builtin", hidden: true },
  { id: "nonla_goto_page", label: "Go to page", group: "agents", hidden: true },
  { id: "nonla_manage_mcp_servers", label: "Manage MCP Servers", group: "mcp" },
  { id: "nonla_manage_kv_entries", label: "Manage KV Entries", group: "kv" },
  { id: "nonla_manage_secrets", label: "Manage Secrets", group: "secrets" },
] as const;

export const NONLA_BOT_DELEGATED_TOOLS = new Set<string>([...AGENT_MANAGER_DELEGATED_TOOLS, ...TOOL_MANAGER_DELEGATED_TOOLS, ...SKILL_MANAGER_DELEGATED_TOOLS, ...SITE_MANAGER_DELEGATED_TOOLS, ...JOB_MANAGER_DELEGATED_TOOLS, ...DATATABLE_MANAGER_DELEGATED_TOOLS]);

export const NONLA_SPECIALISTS: SpecialistDef[] = [agentManagerSpecialist, toolManagerSpecialist, skillManagerSpecialist, siteManagerSpecialist, jobManagerSpecialist, datatableManagerSpecialist];

export function makeNonlaBuiltinTools(ctx: ManagerToolCtx = {}): StructuredToolInterface[] {
  return [
    webFetchTool,
    makeRunJsTool({ agentId: NONLA_BOT_AGENT_ID, abortSignal: ctx.abortSignal }),
    getCurrentTimeTool,
    openuiTool,
    makeBackgroundTasksTool({ agentId: NONLA_BOT_AGENT_ID }),
    makeGotoPageTool(),
    ...makeAgentManagerTools(),
    ...makeToolManagerTools(ctx),
    ...makeSkillManagerTools(ctx),
    ...makeSiteManagerTools(ctx),
    ...makeJobManagerTools(ctx),
    makeManageMcpTool(),
    ...makeDatatableManagerTools(),
    ...makeKvManagerTools(),
  ];
}
