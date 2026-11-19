import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PROJECT_ACTIONS, makeDatatableTool } from "../modules/agents/runtime/llm-tools/datatable.tool.js";
import { createTestApp, setupAdmin } from "./test-helpers.js";

type Row = { id: string; data: Record<string, unknown> };
type Result = { ok: boolean; error?: string; items?: Row[]; total?: number; rows?: Row[]; updated?: number; deleted?: number; row?: Row };

describe("datatable bulk rows", () => {
  let cleanup: () => void;
  let projectId = "";
  let tool: ReturnType<typeof makeDatatableTool>;

  async function call(input: Record<string, unknown>): Promise<Result> {
    return JSON.parse(String(await tool.invoke({ table: "tasks", ...input }))) as Result;
  }

  async function seed(): Promise<Row[]> {
    const created = await call({
      action: "insert",
      rows: [
        { title: "a", status: "open", points: 1 },
        { title: "b", status: "open", points: 2 },
        { title: "c", status: "done", points: 3 },
        { title: "d", status: "done", points: 4 },
      ],
    });
    expect(created.ok).toBe(true);
    return created.rows ?? [];
  }

  async function clear() {
    const all = await call({ action: "query", limit: 500 });
    const ids = (all.items ?? []).map((row) => row.id);
    if (ids.length > 0) await call({ action: "delete", row_ids: ids });
  }

  beforeAll(async () => {
    const t = await createTestApp();
    cleanup = t.cleanup;
    await setupAdmin(t.app);
    const { createProject } = await import("../modules/datatables/datatables.service.js");
    projectId = (await createProject({ name: "BulkRows" })).id as string;
    tool = makeDatatableTool(PROJECT_ACTIONS, { lockedProjectId: projectId });
    await tool.invoke({ action: "create_table", name: "tasks" });
    await tool.invoke({
      action: "edit_schema",
      table: "tasks",
      columns: [
        { op: "create", name: "title", type: "text", required: true },
        { op: "create", name: "status", type: "select", options: ["open", "done"] },
        { op: "create", name: "points", type: "number" },
      ],
    });
  });

  afterAll(() => cleanup());

  test("query fetches many rows by row_ids in one call", async () => {
    const rows = await seed();
    const picked = [rows[0]!.id, rows[2]!.id, rows[3]!.id];
    const found = await call({ action: "query", row_ids: picked, order_by: [{ key: "points", dir: "asc" }] });
    expect(found.ok).toBe(true);
    expect(found.total).toBe(3);
    expect(found.items?.map((row) => row.data.title)).toEqual(["a", "c", "d"]);

    const narrowed = await call({ action: "query", row_ids: picked, where: { status: "done" } });
    expect(narrowed.items?.map((row) => row.data.title).sort()).toEqual(["c", "d"]);
    await clear();
  });

  test("update patches many rows, each with its own patch", async () => {
    const rows = await seed();
    const result = await call({
      action: "update",
      updates: [
        { row_id: rows[0]!.id, data: { title: "a2" } },
        { row_id: rows[1]!.id, data: { title: "b2", points: 20 } },
        { row_id: rows[2]!.id, data: { status: "open" } },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(3);
    const after = await call({ action: "query", row_ids: [rows[0]!.id, rows[1]!.id, rows[2]!.id], order_by: [{ key: "title", dir: "asc" }] });
    expect(after.items?.map((row) => row.data.title)).toEqual(["a2", "b2", "c"]);
    expect(after.items?.[1]?.data.points).toBe(20);
    expect(after.items?.[2]?.data.status).toBe("open");
    await clear();
  });

  test("update has no row cap", async () => {
    const inserted: Row[] = [];
    for (let i = 0; i < 3; i += 1) {
      const batch = await call({ action: "insert", rows: Array.from({ length: 100 }, (_, n) => ({ title: `t${i}-${n}`, status: "open", points: 0 })) });
      inserted.push(...(batch.rows ?? []));
    }
    expect(inserted).toHaveLength(300);
    const result = await call({ action: "update", updates: inserted.map((row) => ({ row_id: row.id, data: { points: 5 } })) });
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(300);
    const check = await call({ action: "query", where: { points: 5 }, limit: 1 });
    expect(check.total).toBe(300);
    await clear();
  });

  test("update writes nothing when one row is invalid", async () => {
    const rows = await seed();
    const result = await call({
      action: "update",
      updates: [
        { row_id: rows[0]!.id, data: { title: "changed" } },
        { row_id: rows[1]!.id, data: { status: "not-an-option" } },
      ],
    });
    expect(result.ok).toBe(false);
    const after = await call({ action: "query", row_ids: [rows[0]!.id] });
    expect(after.items?.[0]?.data.title).toBe("a");
    await clear();
  });

  test("update rejects unknown ids, duplicates and missing updates", async () => {
    const rows = await seed();
    const unknown = await call({ action: "update", updates: [{ row_id: "missing-row", data: { title: "y" } }] });
    expect(unknown.ok).toBe(false);
    const duplicate = await call({
      action: "update",
      updates: [
        { row_id: rows[0]!.id, data: { title: "x" } },
        { row_id: rows[0]!.id, data: { title: "y" } },
      ],
    });
    expect(duplicate.ok).toBe(false);
    const empty = await call({ action: "update", updates: [] });
    expect(empty.ok).toBe(false);
    await clear();
  });

  test("delete removes many rows by row_ids", async () => {
    const rows = await seed();
    const result = await call({ action: "delete", row_ids: [rows[0]!.id, rows[1]!.id] });
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(2);
    const left = await call({ action: "query" });
    expect(left.total).toBe(2);
    await clear();
  });

  test("delete and update refuse a where without ids", async () => {
    await seed();
    const removed = await call({ action: "delete", where: { status: "done" } });
    expect(removed.ok).toBe(false);
    const patched = await call({ action: "update", where: { status: "open" }, data: { points: 9 } });
    expect(patched.ok).toBe(false);
    const legacy = await call({ action: "update", row_id: "any", data: { points: 9 } });
    expect(legacy.ok).toBe(false);
    const all = await call({ action: "query" });
    expect(all.total).toBe(4);
    await clear();
  });

  test("tool description teaches the bulk forms", () => {
    expect(tool.description).toContain("`updates`");
    expect(tool.description).toContain("`updates` = [{ row_id, data }]");
    expect(tool.description).not.toContain("`row_ids` + `data`");
    expect(tool.description).not.toContain("at most");
  });
});
