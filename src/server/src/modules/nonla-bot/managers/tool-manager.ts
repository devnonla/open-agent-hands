import type { StructuredToolInterface } from "@langchain/core/tools";
import { searchNpmTool } from "../../../common/ai/agent-tools/search-npm.tool.js";
import { renameTool } from "../../agents/runtime/llm-tools/bind-to-id.js";
import { makeToolAdminTools } from "../../agents/runtime/llm-tools/tool-admin.tool.js";
import { NONLA_TOOL_MANAGER_ID } from "../builtin-ids.js";
import { toolManagerInstruct } from "../instructs/tool-manager.js";
import type { ManagerToolCtx, SpecialistDef } from "./types.js";

export { NONLA_TOOL_MANAGER_ID };

export const TOOL_MANAGER_DELEGATED_TOOLS = ["nonla_manage_tools", "nonla_manage_tool_folders", "nonla_get_tool_code", "nonla_edit_tool_code", "nonla_run_tool", "nonla_search_npm"] as const;

export const toolManagerSpecialist: SpecialistDef = {
  id: NONLA_TOOL_MANAGER_ID,
  label: "Tool Manager",
  group: "tools",
  instruct: toolManagerInstruct,
  job: "List, create, update, and delete custom tools and tool folders. To change source, this manager reads, edits, and runs the code itself until it runs clean. Edits go live at once. Call this agent for any custom tool work.",
  uses: [
    { id: "nonla_manage_tools", label: "Manage Tools" },
    { id: "nonla_manage_tool_folders", label: "Manage Tool Folders" },
    { id: "nonla_get_tool_code", label: "Get Tool Code" },
    { id: "nonla_edit_tool_code", label: "Edit Tool Code" },
    { id: "nonla_run_tool", label: "Run Tool" },
    { id: "nonla_search_npm", label: "Search npm" },
    { id: "nonla_web_fetch", label: "nonla_web_fetch" },
    { id: "nonla_run_js", label: "nonla_run_js" },
    { id: "nonla_get_current_time", label: "nonla_get_current_time" },
    { id: "nonla_openui", label: "OpenUI" },
    { id: "nonla_datatable", label: "nonla_datatable · list_projects, get_schema" },
  ],
};

export function makeToolManagerTools(ctx: ManagerToolCtx = {}): StructuredToolInterface[] {
  return [...makeToolAdminTools(ctx.abortSignal), renameTool(searchNpmTool, "nonla_search_npm")];
}
