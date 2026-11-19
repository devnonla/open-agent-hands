import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PROJECT_ACTIONS, SCHEMA_ACTIONS, makeDatatableTool } from "../modules/agents/runtime/llm-tools/datatable.tool.js";
import { createTestApp, setupAdmin } from "./test-helpers.js";

describe("datatable schema tool", () => {
  let cleanup: () => void;
  let projectId = "";

  beforeAll(async () => {
    const t = await createTestApp();
    cleanup = t.cleanup;
    const { app } = t;
    await setupAdmin(app);

    const { createProject } = await import("../modules/datatables/datatables.service.js");
    projectId = (await createProject({ name: "SchemaToolProj" })).id as string;
  });

  afterAll(() => cleanup());

  test("create_table → edit_schema (create, update, delete many columns) → delete_table", async () => {
    const tool = makeDatatableTool(SCHEMA_ACTIONS, { lockedProjectId: projectId });

    const createdTableRaw = await tool.invoke({ action: "create_table", name: "orders" });
    const createdTable = JSON.parse(String(createdTableRaw)) as { ok: boolean; table: { id: string; name: string } };
    expect(createdTable.ok).toBe(true);
    expect(createdTable.table.name).toBe("orders");

    await tool.invoke({ action: "create_table", name: "notes" });

    const editedRaw = await tool.invoke({
      action: "edit_schema",
      table: "orders",
      columns: [
        { op: "create", name: "title", type: "text", required: true },
        { op: "create", name: "qty", type: "number" },
        { op: "create", name: "status", type: "select", options: ["open", "done"], required: true },
        { op: "create", table: "notes", name: "body", type: "text" },
        { op: "update", column: "status", name: "order_status", options: ["open", "shipped", "done"] },
        { op: "delete", column: "qty" },
      ],
    });
    const edited = JSON.parse(String(editedRaw)) as {
      ok: boolean;
      applied: { op: string; column?: { name: string; type?: string; options?: string[] }; deleted?: { name: string }; table: { name: string } }[];
    };
    expect(edited.ok).toBe(true);
    expect(edited.applied.map((item) => item.op)).toEqual(["create", "create", "create", "create", "update", "delete"]);
    expect(edited.applied[2]?.column?.type).toBe("select");
    expect(edited.applied[3]?.table.name).toBe("notes");
    expect(edited.applied[4]?.column?.name).toBe("order_status");
    expect(edited.applied[4]?.column?.options).toEqual(["open", "shipped", "done"]);
    expect(edited.applied[5]?.deleted?.name).toBe("qty");

    const schemaRaw = await tool.invoke({ action: "get_schema" });
    const schema = JSON.parse(String(schemaRaw)) as { ok: boolean; tables: { name: string; columns: { name: string }[] }[] };
    expect(schema.ok).toBe(true);
    const orders = schema.tables.find((t) => t.name === "orders");
    const notes = schema.tables.find((t) => t.name === "notes");
    expect(orders?.columns.map((c) => c.name)).toEqual(["title", "order_status"]);
    expect(notes?.columns.map((c) => c.name)).toEqual(["body"]);

    const stoppedRaw = await tool.invoke({
      action: "edit_schema",
      table: "orders",
      columns: [
        { op: "create", name: "note", type: "text" },
        { op: "delete", column: "missing" },
        { op: "create", name: "extra", type: "text" },
      ],
    });
    const stopped = JSON.parse(String(stoppedRaw)) as { ok: boolean; error: string; applied: { op: string }[] };
    expect(stopped.ok).toBe(false);
    expect(stopped.error).toContain("columns[1]");
    expect(stopped.applied).toHaveLength(1);
    expect(stopped.applied[0]?.op).toBe("create");

    const renamedTableRaw = await tool.invoke({ action: "update_table", table: "orders", name: "shop_orders" });
    const renamedTable = JSON.parse(String(renamedTableRaw)) as { ok: boolean; table: { name: string } };
    expect(renamedTable.ok).toBe(true);
    expect(renamedTable.table.name).toBe("shop_orders");

    await tool.invoke({ action: "delete_table", table: "shop_orders" });
    await tool.invoke({ action: "delete_table", table: "notes" });

    const emptyRaw = await tool.invoke({ action: "get_schema" });
    const empty = JSON.parse(String(emptyRaw)) as { ok: boolean; tables: unknown[] };
    expect(empty.ok).toBe(true);
    expect(empty.tables).toHaveLength(0);
  });

  test("locked project rejects other project refs", async () => {
    const tool = makeDatatableTool(SCHEMA_ACTIONS, { lockedProjectId: projectId });
    const raw = await tool.invoke({ action: "create_table", project: "other-project", name: "x" });
    const result = JSON.parse(String(raw)) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("locked");
  });

  test("PROJECT_ACTIONS — insert → query → update → delete rows", async () => {
    const tool = makeDatatableTool(PROJECT_ACTIONS, { lockedProjectId: projectId });

    await tool.invoke({ action: "create_table", name: "items" });
    await tool.invoke({
      action: "edit_schema",
      table: "items",
      columns: [{ op: "create", name: "title", type: "text", required: true }],
    });

    const insertedRaw = await tool.invoke({
      action: "insert",
      table: "items",
      rows: [{ title: "alpha" }, { title: "beta" }],
    });
    const inserted = JSON.parse(String(insertedRaw)) as { ok: boolean; rows: { id: string; data: { title: string } }[] };
    expect(inserted.ok).toBe(true);
    expect(inserted.rows).toHaveLength(2);

    const queriedRaw = await tool.invoke({
      action: "query",
      table: "items",
      where: { title: "alpha" },
      order_by: [{ key: "title", dir: "asc" }],
    });
    const queried = JSON.parse(String(queriedRaw)) as { ok: boolean; items: { id: string; data: { title: string } }[]; total: number };
    expect(queried.ok).toBe(true);
    expect(queried.total).toBe(1);
    expect(queried.items[0].data.title).toBe("alpha");

    const rowId = queried.items[0].id;
    const updatedRaw = await tool.invoke({ action: "update", table: "items", updates: [{ row_id: rowId, data: { title: "alpha2" } }] });
    const updated = JSON.parse(String(updatedRaw)) as { ok: boolean; updated: number };
    expect(updated.ok).toBe(true);
    expect(updated.updated).toBe(1);

    const deletedRaw = await tool.invoke({ action: "delete", table: "items", row_ids: [rowId] });
    const deleted = JSON.parse(String(deletedRaw)) as { ok: boolean; deleted?: number; count?: number };
    expect(deleted.ok).toBe(true);

    const afterRaw = await tool.invoke({ action: "query", table: "items" });
    const after = JSON.parse(String(afterRaw)) as { ok: boolean; total: number };
    expect(after.ok).toBe(true);
    expect(after.total).toBe(1);

    await tool.invoke({ action: "delete_table", table: "items" });
  });

  test("PROJECT_ACTIONS — preserves Vietnamese text on insert query update", async () => {
    const tool = makeDatatableTool(PROJECT_ACTIONS, { lockedProjectId: projectId });
    const original = "khoảng 211 nghìn, lạ hơn, ngoại nửa, phân bổ, lý nhỏ, vision png, trung, kênh: khác, các kênh ấy";
    const updated = `${original} — ${"ảầẫấậ ".repeat(200)}`;

    await tool.invoke({ action: "create_table", name: "vi_notes" });
    await tool.invoke({
      action: "edit_schema",
      table: "vi_notes",
      columns: [{ op: "create", name: "body", type: "text", required: true }],
    });

    const insertedRaw = await tool.invoke({ action: "insert", table: "vi_notes", rows: [{ body: original }] });
    const inserted = JSON.parse(String(insertedRaw)) as { ok: boolean; rows: { id: string; data: { body: string } }[] };
    expect(inserted.ok).toBe(true);
    expect(inserted.rows[0].data.body).toBe(original);

    const queriedRaw = await tool.invoke({ action: "query", table: "vi_notes" });
    const queried = JSON.parse(String(queriedRaw)) as { ok: boolean; items: { id: string; data: { body: string } }[] };
    expect(queried.ok).toBe(true);
    expect(queried.items[0].data.body).toBe(original);

    const updatedRaw = await tool.invoke({
      action: "update",
      table: "vi_notes",
      updates: [{ row_id: inserted.rows[0].id, data: { body: updated } }],
    });
    const updatedRow = JSON.parse(String(updatedRaw)) as { ok: boolean; updated: number };
    expect(updatedRow.ok).toBe(true);
    expect(updatedRow.updated).toBe(1);

    const againRaw = await tool.invoke({ action: "query", table: "vi_notes" });
    const again = JSON.parse(String(againRaw)) as { ok: boolean; items: { data: { body: string } }[] };
    expect(again.items[0].data.body).toBe(updated);

    await tool.invoke({ action: "delete_table", table: "vi_notes" });
  });

  test("makeDatatableProjectTool — unique name, locked to project", async () => {
    const { createProject } = await import("../modules/datatables/datatables.service.js");
    const { datatableProjectToolName } = await import("../modules/datatables/datatable-tool-id.js");
    const { makeDatatableProjectTool } = await import("../modules/agents/runtime/llm-tools/datatable.tool.js");

    const other = await createProject({ name: "OtherLockedProj" });
    const tool = makeDatatableProjectTool({ id: projectId, name: "SchemaToolProj" });
    expect(tool.name).toBe(datatableProjectToolName(projectId));

    const schemaRaw = await tool.invoke({ action: "get_schema" });
    const schema = JSON.parse(String(schemaRaw)) as { ok: boolean; project: { id: string } };
    expect(schema.ok).toBe(true);
    expect(schema.project.id).toBe(projectId);

    const leakRaw = await tool.invoke({ action: "get_schema", project: other.id });
    const leak = JSON.parse(String(leakRaw)) as { ok: boolean; error: string };
    expect(leak.ok).toBe(false);
    expect(leak.error).toContain("locked");
    expect(tool.description).not.toContain("list_projects");
  });

  test("query description teaches order_by format", () => {
    const tool = makeDatatableTool(PROJECT_ACTIONS, { lockedProjectId: projectId });
    expect(tool.description).toContain("order_by");
    expect(tool.description).toContain('{"key": "created_at", "dir": "desc"}');
  });
});
