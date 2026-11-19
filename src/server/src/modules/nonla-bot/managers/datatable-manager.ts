import type { StructuredToolInterface } from "@langchain/core/tools";
import { COLUMN_ACTIONS, RECORD_ACTIONS, TABLE_ACTIONS, makeDatatableTool } from "../../agents/runtime/llm-tools/datatable.tool.js";
import { createProject, deleteProject, listProjects, updateProject } from "../../datatables/datatables.service.js";
import { NONLA_DATATABLE_MANAGER_ID } from "../builtin-ids.js";
import { datatableManagerInstruct } from "../instructs/datatable-manager.js";
import { type Fields, makeManageTool, requireId, requireName, text } from "./helpers.js";
import type { SpecialistDef } from "./types.js";

export { NONLA_DATATABLE_MANAGER_ID };

async function handleDatatables(action: string, fields: Fields): Promise<unknown> {
  if (action === "list") {
    return (await listProjects()).map((project) => ({ id: project.id, name: project.name }));
  }
  if (action === "create") {
    const created = await createProject({ name: requireName(fields) });
    return { id: created.id, name: created.name };
  }
  if (action === "update") {
    const updated = await updateProject(requireId(fields), { name: text(fields.name) || undefined });
    return { id: updated.id, name: updated.name };
  }
  if (action === "delete") {
    const id = requireId(fields);
    await deleteProject(id);
    return { deleted: id };
  }
  throw new Error(`Unknown datatables action "${action}". Use list, create, update, delete. Use the datatable tool for tables and rows.`);
}

export function makeManageDatatablesTool(): StructuredToolInterface {
  return makeManageTool(
    "nonla_manage_datatable_projects",
    `Add, rename, and delete datatable projects.
Actions: list, create (needs name), update, delete.
Tables, columns, and rows have their own tools.`,
    handleDatatables,
  );
}

export const DATATABLE_MANAGER_DELEGATED_TOOLS = ["nonla_manage_datatable_projects", "nonla_manage_datatable_tables", "nonla_manage_datatable_schema", "nonla_manage_datatable_records"] as const;

export const datatableManagerSpecialist: SpecialistDef = {
  id: NONLA_DATATABLE_MANAGER_ID,
  label: "Datatable Manager",
  group: "datatables",
  instruct: datatableManagerInstruct,
  job: "List, create, update, and delete datatable projects, tables, columns, and rows. Changes are live. There is no approve step. Call this agent for any datatable work.",
  uses: [
    { id: "nonla_manage_datatable_projects", label: "Manage Datatable Projects" },
    { id: "nonla_manage_datatable_tables", label: "Manage Datatable Tables" },
    { id: "nonla_manage_datatable_schema", label: "Manage Datatable Table Schema" },
    { id: "nonla_manage_datatable_records", label: "Manage Datatable Table Records" },
    { id: "nonla_web_fetch", label: "Web Fetch" },
    { id: "nonla_run_js", label: "Run JS" },
    { id: "nonla_get_current_time", label: "Get Current Time" },
    { id: "nonla_openui", label: "OpenUI" },
  ],
};

export function makeDatatableManagerTools(): StructuredToolInterface[] {
  return [
    makeManageDatatablesTool(),
    makeDatatableTool(TABLE_ACTIONS, {
      name: "nonla_manage_datatable_tables",
      summary: "Create, rename, and delete tables in one datatable project. Does not edit columns or rows. Use nonla_manage_datatable_schema for columns and nonla_manage_datatable_records for rows.",
    }),
    makeDatatableTool(COLUMN_ACTIONS, {
      name: "nonla_manage_datatable_schema",
      summary:
        "Add, edit, and delete columns in one datatable project. The table must already exist. Does not create tables or write rows. Several column changes fit in one edit_schema call; items run in order, so a later item can use a name from an earlier create. Column names match [a-z][a-z0-9_]*, snake_case preferred. Types: text, number (integer or float, sent as a JSON number), boolean, datetime, select (needs options), json. Rename a column with op update, not delete then create, so the row values follow the new name.",
    }),
    makeDatatableTool(RECORD_ACTIONS, {
      name: "nonla_manage_datatable_records",
      summary: "Query, insert, update, and delete rows in one datatable project. Does not change tables or columns. Row values are keyed by column name. Send datetime values as ISO 8601 strings. Query returns items shaped { id, data, createdAt, updatedAt } with column values under data.",
    }),
  ];
}
