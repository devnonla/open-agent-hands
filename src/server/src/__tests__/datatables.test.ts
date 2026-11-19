import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

describe("Datatables API", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;
  let projectId = "";
  let tableId = "";
  let columnId = "";
  let rowId = "";

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    const admin = await setupAdmin(app);
    token = admin.token;
  });

  afterAll(() => cleanup());

  test("POST /api/datatables/projects — create", async () => {
    const res = await authRequest(app, token, "POST", "/api/datatables/projects", { name: "CRM" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string; name: string };
    expect(data.name).toBe("CRM");
    projectId = data.id;
  });

  test("POST /api/datatables/projects — duplicate name", async () => {
    const res = await authRequest(app, token, "POST", "/api/datatables/projects", { name: "CRM" });
    expect(res.status).toBe(400);
  });

  test("GET /api/datatables/projects — list", async () => {
    const res = await authRequest(app, token, "GET", "/api/datatables/projects");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { name: string; tableCount: number; tableNames: string[] }[];
    const crm = data.find((p) => p.name === "CRM");
    expect(crm).toBeDefined();
    expect(crm!.tableCount).toBe(0);
    expect(crm!.tableNames).toEqual([]);
    expect((crm as { tables?: unknown[] }).tables).toEqual([]);
  });

  test("POST /api/datatables/projects/:id/tables — create table", async () => {
    const res = await authRequest(app, token, "POST", `/api/datatables/projects/${projectId}/tables`, { name: "Customers" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string; name: string };
    expect(data.name).toBe("Customers");
    tableId = data.id;

    const list = await authRequest(app, token, "GET", "/api/datatables/projects");
    const projects = (await list.json()) as { name: string; tableCount: number; tableNames: string[] }[];
    const crm = projects.find((p) => p.name === "CRM");
    expect(crm?.tableCount).toBe(1);
    expect(crm?.tableNames).toEqual(["Customers"]);
    expect((crm as { tables?: { id: string; name: string }[] }).tables).toEqual([{ id: tableId, name: "Customers" }]);
  });

  test("POST /api/datatables/tables/:id/columns — create columns", async () => {
    const nameRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/columns`, {
      name: "name",
      type: "text",
      required: true,
    });
    expect(nameRes.status).toBe(201);

    const statusRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/columns`, {
      name: "status",
      type: "select",
      options: ["active", "inactive"],
    });
    expect(statusRes.status).toBe(201);
    columnId = ((await statusRes.json()) as { id: string }).id;

    const ageRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/columns`, {
      name: "age",
      type: "number",
    });
    expect(ageRes.status).toBe(201);
  });

  test("GET /api/datatables/projects/:id/schema — nested tables + columns", async () => {
    const res = await authRequest(app, token, "GET", `/api/datatables/projects/${projectId}/schema`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      project: { id: string; name: string };
      tables: { id: string; name: string; columns: { name: string }[] }[];
    };
    expect(data.project.id).toBe(projectId);
    expect(data.tables).toHaveLength(1);
    expect(data.tables[0].id).toBe(tableId);
    expect(data.tables[0].columns.map((c) => c.name).sort()).toEqual(["age", "name", "status"]);
  });

  test("POST /api/datatables/tables/:id/rows — insert", async () => {
    const res = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows`, {
      rows: [
        { name: "Ann", status: "active", age: 30 },
        { name: "Bob", status: "inactive", age: 17 },
        { name: "Cara", status: "active", age: 42 },
      ],
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string }[];
    expect(data).toHaveLength(3);
    rowId = data[0].id;
  });

  test("POST /api/datatables/tables/:id/rows/query — where filters", async () => {
    const res = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows/query`, {
      where: { status: "active", age: { $gte: 18 } },
      order_by: [{ key: "age", dir: "desc" }],
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { data: { name: string; age: number } }[]; total: number };
    expect(data.total).toBe(2);
    expect(data.items[0].data.name).toBe("Cara");
    expect(data.items[1].data.name).toBe("Ann");
  });

  test("POST /api/datatables/tables/:id/rows/query — where array is OR of AND-groups", async () => {
    const res = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows/query`, {
      where: [{ status: "inactive" }, { age: { $gte: 40 } }],
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { data: { name: string } }[]; total: number };
    expect(data.total).toBe(2);
    expect(data.items.map((r) => r.data.name).sort()).toEqual(["Bob", "Cara"]);
  });

  test("POST /api/datatables/tables/:id/rows/query — where array with non-object branch → 400", async () => {
    const res = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows/query`, {
      where: [{ status: "active" }, "not-an-object"],
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/datatables/tables/:id/rows/query — order_by created_at", async () => {
    const res = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows/query`, {
      order_by: [{ key: "created_at", dir: "desc" }],
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: unknown[]; total: number };
    expect(data.total).toBe(3);
    expect(data.items).toHaveLength(3);
  });

  test("PUT /api/datatables/rows/:id — update", async () => {
    const res = await authRequest(app, token, "PUT", `/api/datatables/rows/${rowId}`, {
      data: { status: "inactive" },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { data: { status: string } };
    expect(data.data.status).toBe("inactive");
  });

  test("POST /api/datatables/tables/:id/rows — preserves Vietnamese on insert query update", async () => {
    const original = "khoảng 211 nghìn, lạ hơn, ngoại nửa, phân bổ, lý nhỏ, vision png, trung, kênh: khác, các kênh ấy";
    const updated = `${original} — ${"ảầẫấậ ".repeat(200)}`;

    const insertRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows`, {
      rows: [{ name: original, status: "active", age: 1 }],
    });
    expect(insertRes.status).toBe(201);
    const inserted = (await insertRes.json()) as { id: string; data: { name: string } }[];
    expect(inserted[0].data.name).toBe(original);

    const queryRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows/query`, {
      where: { name: original },
    });
    expect(queryRes.status).toBe(200);
    const queried = (await queryRes.json()) as { items: { id: string; data: { name: string } }[] };
    expect(queried.items[0].data.name).toBe(original);

    const putRes = await authRequest(app, token, "PUT", `/api/datatables/rows/${inserted[0].id}`, {
      data: { name: updated },
    });
    expect(putRes.status).toBe(200);
    const put = (await putRes.json()) as { data: { name: string } };
    expect(put.data.name).toBe(updated);

    const againRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows/query`, {
      where: { name: updated },
    });
    const again = (await againRes.json()) as { items: { data: { name: string } }[] };
    expect(again.items[0].data.name).toBe(updated);
  });

  test("number column stores floats and comma decimals", async () => {
    const colRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/columns`, {
      name: "score",
      type: "number",
    });
    expect(colRes.status).toBe(201);

    const insertRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows`, {
      rows: [
        { name: "float-low", status: "active", score: 1.5 },
        { name: "float-high", status: "active", score: "2,25" },
      ],
    });
    expect(insertRes.status).toBe(201);
    const inserted = (await insertRes.json()) as { data: { score: number } }[];
    expect(inserted.map((r) => r.data.score)).toEqual([1.5, 2.25]);

    const bad = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows`, {
      rows: [{ name: "float-bad", status: "active", score: "nope" }],
    });
    expect(bad.status).toBe(400);

    const queryRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows/query`, {
      where: { score: { $gte: 1.25 } },
      order_by: [{ key: "score", dir: "asc" }],
    });
    expect(queryRes.status).toBe(200);
    const queried = (await queryRes.json()) as { items: { data: { name: string; score: number } }[] };
    expect(queried.items.map((r) => r.data.name)).toEqual(["float-low", "float-high"]);
    expect(queried.items.map((r) => r.data.score)).toEqual([1.5, 2.25]);
  });

  test("DELETE /api/datatables/columns/:id — strips name from rows", async () => {
    const res = await authRequest(app, token, "DELETE", `/api/datatables/columns/${columnId}`);
    expect(res.status).toBe(200);
    const rowRes = await authRequest(app, token, "POST", `/api/datatables/tables/${tableId}/rows/query`, {});
    const data = (await rowRes.json()) as { items: { data: Record<string, unknown> }[] };
    expect(data.items.every((r) => !("status" in r.data))).toBe(true);
  });

  test("POST /api/agents/:id/tool-assignments — datatable project is rejected", async () => {
    const agentRes = await authRequest(app, token, "POST", "/api/agents", { name: "DT Agent" });
    expect(agentRes.status).toBe(201);
    const agent = (await agentRes.json()) as { id: string };
    const toolId = `datatable:${projectId}`;
    const res = await authRequest(app, token, "POST", `/api/agents/${agent.id}/tool-assignments`, { toolId });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string };
    expect(body.message ?? "").toMatch(/Datatable Manager/i);

    const { resolveAgentTools } = await import("../modules/agents/runtime/utils/resolveTools.js");
    const names = (await resolveAgentTools(agent.id, [toolId, "builtin:datatable"], "owner")).map((t) => t.name);
    expect(names).not.toContain("nonla_datatable");
    expect(names.every((n) => !n.startsWith("datatable__"))).toBe(true);
  });

  test("POST /api/agents/:id/tool-assignments — legacy builtin:datatable is rejected", async () => {
    const agentRes = await authRequest(app, token, "POST", "/api/agents", { name: "Legacy DT Agent" });
    expect(agentRes.status).toBe(201);
    const agent = (await agentRes.json()) as { id: string };

    const legacyRes = await authRequest(app, token, "POST", `/api/agents/${agent.id}/tool-assignments`, { toolId: "builtin:datatable" });
    expect(legacyRes.status).toBe(400);
  });

  test("DELETE /api/datatables/projects/:id — cascade", async () => {
    const res = await authRequest(app, token, "DELETE", `/api/datatables/projects/${projectId}`);
    expect(res.status).toBe(200);
    const tables = await authRequest(app, token, "GET", `/api/datatables/projects/${projectId}/tables`);
    expect(tables.status).toBe(404);
  });

  test("GET /api/datatables/projects — unauthenticated → 401", async () => {
    const res = await app.request("/api/datatables/projects");
    expect(res.status).toBe(401);
  });

  test("POST /api/datatables/projects/:id/agent/stream — project not found", async () => {
    const res = await authRequest(app, token, "POST", "/api/datatables/projects/missing-project/agent/stream", {
      providerId: "p",
      modelId: "m",
      messages: [],
    });
    expect(res.status).toBe(404);
  });
});
