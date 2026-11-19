const MANAGE_PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", description: "What to do. Each tool lists its actions." },
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    body: { type: "object" },
  },
  required: ["action"],
};

const MANAGE_AGENT_PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", description: "list_available_tools, list_available_skills, list_assigned_*, set_assigned_*, add_assigned_*, remove_assigned_* for tools, skills, agents." },
    id: { type: "string", description: "The agent id." },
    body: { type: "object", description: "toolIds, skillIds, or agentIds string array." },
  },
  required: ["action"],
};

const DATATABLE_COLUMN_CHANGE = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["create", "update", "delete"] },
    table: { type: "string", description: "Table id or name. Defaults to the top-level table." },
    column: { type: "string", description: "Column id or name. Required for update and delete." },
    name: { type: "string", description: "Column name. Required for create. New name for update." },
    type: { type: "string", enum: ["text", "number", "boolean", "datetime", "select", "json"] },
    options: { type: "array", items: { type: "string" }, description: "Required when type is select." },
    required: { type: "boolean" },
  },
  required: ["op"],
};

const DATATABLE_TABLES_PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["get_schema", "create_table", "update_table", "delete_table"] },
    project: { type: "string", description: "Project id (preferred) or name" },
    table: { type: "string", description: "Table id or name. Needed for update_table and delete_table." },
    name: { type: "string", description: "Table name for create_table. New name for update_table." },
  },
  required: ["action", "project"],
};

const DATATABLE_SCHEMA_PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["get_schema", "edit_schema"] },
    project: { type: "string", description: "Project id (preferred) or name" },
    table: { type: "string", description: "Default table for edit_schema items that omit table." },
    columns: { type: "array", items: DATATABLE_COLUMN_CHANGE, description: "Column changes for edit_schema, applied in order." },
  },
  required: ["action", "project"],
};

const DATATABLE_RECORDS_PARAMETERS = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["get_schema", "query", "insert", "update", "delete"] },
    project: { type: "string", description: "Project id (preferred) or name" },
    table: { type: "string", description: "Table id or name. Needed for every action except get_schema." },
    where: { type: "object", additionalProperties: true, description: "Filter for query. Object = AND, array of objects = OR." },
    order_by: { type: "array", items: { type: "object", properties: { key: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } }, required: ["key"] } },
    limit: { type: "number" },
    offset: { type: "number" },
    rows: { type: "array", items: { type: "object" }, description: "Rows to insert, keyed by column name." },
    row_ids: { type: "array", items: { type: "string" }, description: "Row ids: fetch in query, remove in delete." },
    updates: {
      type: "array",
      items: { type: "object", properties: { row_id: { type: "string" }, data: { type: "object", additionalProperties: true } }, required: ["row_id", "data"] },
      description: "Row patches for update: [{ row_id, data }]. data is partial.",
    },
  },
  required: ["action", "project"],
};

const ID_ONLY_PARAMETERS = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
};

const SYSTEM_PROMPT_ID_PARAMETERS = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
};

const SYSTEM_PROMPT_EDIT_PARAMETERS = {
  type: "object",
  properties: {
    id: { type: "string" },
    mode: { type: "string", enum: ["replace", "full"] },
    prompt: { type: "string" },
    edits: { type: "array", items: { type: "object", properties: { old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["old_string", "new_string"] } },
    summary: { type: "string" },
  },
  required: ["id", "mode"],
};

export const NONLA_ADMIN_TOOL_DEFS = [
  { toolName: "nonla_manage_agents", toolLabel: "Manage Agents", description: "List, create, update, and delete agents. Does not write the live prompt.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_manage_agent", toolLabel: "Manage an Agent", description: "Connect one agent to tools, MCP tools, skills, and other agents. list_available_*, list_assigned_*, set_assigned_* (replace), add_assigned_*, remove_assigned_*.", parameters: MANAGE_AGENT_PARAMETERS },
  { toolName: "nonla_manage_agent_teams", toolLabel: "Manage Agent Teams", description: "List, create, update, and delete agent teams.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_list_model_providers", toolLabel: "List Model Providers", description: "List model providers and the model ids on each. No API keys.", parameters: { type: "object", properties: {}, required: [] } },
  { toolName: "nonla_get_system_prompt", toolLabel: "Get System Prompt", description: "Read one agent's live system prompt.", parameters: SYSTEM_PROMPT_ID_PARAMETERS },
  { toolName: "nonla_edit_system_prompt", toolLabel: "Edit System Prompt", description: "Write one agent's live system prompt. Modes: full and replace (like code). Call after review passes.", parameters: SYSTEM_PROMPT_EDIT_PARAMETERS },
  { toolName: "nonla_manage_tools", toolLabel: "Manage Tools", description: "List, create, update, and delete custom tool records. Does not edit source.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_manage_tool_folders", toolLabel: "Manage Tool Folders", description: "List, create, update, and delete tool folders. set_tool moves one tool.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_get_tool_code", toolLabel: "Get Tool Code", description: "Read one custom tool's live source.", parameters: ID_ONLY_PARAMETERS },
  {
    toolName: "nonla_edit_tool_code",
    toolLabel: "Edit Tool Code",
    description: "Edit one custom tool's live source. Modes: replace (exact edits) and full.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        mode: { type: "string", enum: ["replace", "full"] },
        code: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["old_string", "new_string"] } },
      },
      required: ["id", "mode"],
    },
  },
  { toolName: "nonla_search_npm", toolLabel: "Search npm", description: "Search npm or inspect one package.", parameters: { type: "object", properties: { query: { type: "string" }, name: { type: "string" }, size: { type: "number" } } } },
  { toolName: "nonla_run_tool", toolLabel: "Run Tool", description: "Run one custom tool's live source in a sandbox. Optional testInput object.", parameters: { type: "object", properties: { id: { type: "string" }, testInput: { type: "object" } }, required: ["id"] } },
  { toolName: "nonla_manage_skills", toolLabel: "Manage Skills", description: "List, create, update, and delete skill records. Does not edit SKILL.md.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_manage_skill_folders", toolLabel: "Manage Skill Folders", description: "List, create, update, and delete skill folders. set_skill moves one skill.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_get_skill_files", toolLabel: "Get Skill Files", description: "Read one skill's file index or live files by skill id.", parameters: { type: "object", properties: { id: { type: "string" }, path: { type: "string" }, paths: { type: "array", items: { type: "string" } } }, required: ["id"] } },
  {
    toolName: "nonla_edit_skill_code",
    toolLabel: "Edit Skill Code",
    description: "Edit one live skill file. Modes: replace (exact edits) and full.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        path: { type: "string" },
        mode: { type: "string", enum: ["replace", "full"] },
        content: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["old_string", "new_string"] } },
      },
      required: ["id", "path", "mode"],
    },
  },
  { toolName: "nonla_delete_skill_file", toolLabel: "Delete Skill File", description: "Permanently delete one skill reference file by skill id.", parameters: { type: "object", properties: { id: { type: "string" }, path: { type: "string" } }, required: ["id", "path"] } },
  { toolName: "nonla_manage_sites", toolLabel: "Manage Sites", description: "List, create, update, and delete site records. Does not edit files.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_get_site_code", toolLabel: "Get Site Code", description: "Read one live site source file by id.", parameters: { type: "object", properties: { id: { type: "string" }, file: { type: "string", enum: ["app.tsx", "styles.css", "backend.ts"] } }, required: ["id", "file"] } },
  {
    toolName: "nonla_edit_site_code",
    toolLabel: "Edit Site Code",
    description: "Edit one live site file. Modes: replace (exact edits) and full.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        file: { type: "string", enum: ["app.tsx", "styles.css", "backend.ts"] },
        mode: { type: "string", enum: ["replace", "full"] },
        content: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["old_string", "new_string"] } },
      },
      required: ["id", "file", "mode"],
    },
  },
  { toolName: "nonla_check_site", toolLabel: "Check Site", description: "Bundle one live site and run its backend GET handler.", parameters: ID_ONLY_PARAMETERS },
  { toolName: "nonla_manage_jobs", toolLabel: "Manage Jobs", description: "List, create, update, and delete job records. Does not edit the script.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_get_job_code", toolLabel: "Get Job Code", description: "Read one job's live script.", parameters: ID_ONLY_PARAMETERS },
  {
    toolName: "nonla_edit_job_code",
    toolLabel: "Edit Job Code",
    description: "Edit one job's live script. Modes: replace (exact edits) and full.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        mode: { type: "string", enum: ["replace", "full"] },
        code: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { old_string: { type: "string" }, new_string: { type: "string" }, replace_all: { type: "boolean" } }, required: ["old_string", "new_string"] } },
      },
      required: ["id", "mode"],
    },
  },
  { toolName: "nonla_run_job", toolLabel: "Run Job", description: "Run one job's live script once and wait for the result.", parameters: ID_ONLY_PARAMETERS },
  { toolName: "nonla_manage_mcp_servers", toolLabel: "Manage MCP Servers", description: "List, create, update, and delete MCP servers.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_manage_datatable_projects", toolLabel: "Manage Datatable Projects", description: "List, create, update, and delete datatable projects.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_manage_datatable_tables", toolLabel: "Manage Datatable Tables", description: "Create, rename, and delete tables in one datatable project.", parameters: DATATABLE_TABLES_PARAMETERS },
  { toolName: "nonla_manage_datatable_schema", toolLabel: "Manage Datatable Schema", description: "Add, edit, and delete columns in one datatable project.", parameters: DATATABLE_SCHEMA_PARAMETERS },
  { toolName: "nonla_manage_datatable_records", toolLabel: "Manage Datatable Records", description: "Query, insert, update, and delete rows in one datatable project.", parameters: DATATABLE_RECORDS_PARAMETERS },
  { toolName: "nonla_manage_kv_entries", toolLabel: "Manage KV Entries", description: "List, get, set, and delete KV entries.", parameters: MANAGE_PARAMETERS },
  { toolName: "nonla_manage_secrets", toolLabel: "Manage Secrets", description: "List, get, set, and delete secrets.", parameters: MANAGE_PARAMETERS },
];
