import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { authHeaders, createTestApp, setupAdmin } from "./test-helpers.js";

describe("Workspaces", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;
  let wsB: string;

  function req(method: string, path: string, body?: unknown, workspaceId?: string) {
    const headers: Record<string, string> = authHeaders(token);
    if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
    return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    token = (await setupAdmin(app)).token;
  });

  afterAll(() => cleanup());

  test("default workspace exists and cannot be deleted", async () => {
    const list = (await (await req("GET", "/api/workspaces")).json()) as { items: { id: string; isDefault: boolean }[] };
    expect(list.items.map((w) => w.id)).toEqual(["default"]);
    expect(list.items[0].isDefault).toBe(true);
    expect((await req("DELETE", "/api/workspaces/default")).status).toBe(400);
  });

  test("create, rename and list workspaces", async () => {
    const created = await req("POST", "/api/workspaces", { name: "Client B" });
    expect(created.status).toBe(201);
    wsB = ((await created.json()) as { id: string }).id;
    expect((await req("POST", "/api/workspaces", { name: "  " })).status).toBe(400);
    const renamed = await req("PUT", `/api/workspaces/${wsB}`, { name: "Client B2", description: "second" });
    expect(((await renamed.json()) as { name: string }).name).toBe("Client B2");
    const list = (await (await req("GET", "/api/workspaces")).json()) as { items: { id: string }[] };
    expect(list.items.map((w) => w.id)).toEqual(["default", wsB]);
  });

  test("unknown workspace header is rejected", async () => {
    expect((await req("GET", "/api/kvstore", undefined, "nope")).status).toBe(404);
  });

  test("KV keys are isolated and may repeat across workspaces", async () => {
    expect((await req("POST", "/api/kvstore", { key: "SHARED", value: "a" })).status).toBe(201);
    expect((await req("POST", "/api/kvstore", { key: "SHARED", value: "b" }, wsB)).status).toBe(201);
    const listA = (await (await req("GET", "/api/kvstore")).json()) as { items: { key: string; value: string }[] };
    const listB = (await (await req("GET", "/api/kvstore", undefined, wsB)).json()) as { items: { id: string; key: string; value: string }[] };
    expect(listA.items.map((e) => e.value)).toEqual(["a"]);
    expect(listB.items.map((e) => e.value)).toEqual(["b"]);
    expect((await req("GET", `/api/kvstore/${listB.items[0].id}`)).status).toBe(400);
  });

  test("tools are isolated and a tool cannot be read from another workspace", async () => {
    const code = "// @name Echo\n// @description Echo input\nexport default async function main(input: Record<string, unknown>) {\n  return input;\n}\n";
    const created = await req("POST", "/api/tools", { name: "echo", label: "Echo", description: "Echo input", codeContent: code }, wsB);
    expect(created.status).toBe(201);
    const toolId = ((await created.json()) as { id: string }).id;
    const listA = (await (await req("GET", "/api/tools")).json()) as { items: unknown[] };
    expect(listA.items.length).toBe(0);
    expect((await req("GET", `/api/tools/${toolId}`)).status).toBe(400);
    expect((await req("GET", `/api/tools/${toolId}`, undefined, wsB)).status).toBe(200);
    expect((await req("POST", "/api/tools", { name: "echo", label: "Echo", description: "Echo input", codeContent: code })).status).toBe(201);
  });

  test("datatable ids from another workspace are not reachable", async () => {
    const project = await req("POST", "/api/datatables/projects", { name: "crm" }, wsB);
    const projectId = ((await project.json()) as { id: string }).id;
    const table = await req("POST", `/api/datatables/projects/${projectId}/tables`, { name: "leads" }, wsB);
    const tableId = ((await table.json()) as { id: string }).id;
    expect((await req("GET", `/api/datatables/projects/${projectId}`)).status).toBe(404);
    expect((await req("GET", `/api/datatables/tables/${tableId}/columns`)).status).toBe(404);
    expect((await req("GET", `/api/datatables/tables/${tableId}/columns`, undefined, wsB)).status).toBe(200);
  });

  test("sites are listed per workspace while slugs stay globally unique", async () => {
    const created = await req("POST", "/api/sites", { name: "B site", slug: "b-site" }, wsB);
    expect(created.status).toBe(201);
    const siteId = ((await created.json()) as { id: string }).id;
    const listA = (await (await req("GET", "/api/sites")).json()) as { items: unknown[] };
    const listB = (await (await req("GET", "/api/sites", undefined, wsB)).json()) as { items: unknown[] };
    expect(listA.items.length).toBe(0);
    expect(listB.items.length).toBe(1);
    expect((await req("GET", `/api/sites/${siteId}`)).status).toBe(404);
    expect((await req("POST", "/api/sites", { name: "Clash", slug: "b-site" })).status).toBe(400);
  });

  test("API keys read only their own workspace through /api/v1", async () => {
    const created = await req("POST", "/api/api-keys", { name: "b-key", kvUnrestricted: true }, wsB);
    expect(created.status).toBe(201);
    const key = ((await created.json()) as { key: string }).key;
    const res = await app.request("/api/v1/kv", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { key: string; value: string }[] };
    expect(body.items.map((e) => `${e.key}=${e.value}`)).toEqual(["SHARED=b"]);
  });

  test("hosted MCP only exposes tools from its workspace", async () => {
    const tools = (await (await req("GET", "/api/tools", undefined, wsB)).json()) as { items: { id: string }[] };
    const defaultTools = (await (await req("GET", "/api/tools")).json()) as { items: { id: string }[] };
    expect((await req("POST", "/api/my-mcp-servers", { name: "cross", toolIds: [defaultTools.items[0].id] }, wsB)).status).toBe(400);
    const server = await req("POST", "/api/my-mcp-servers", { name: "b-mcp", toolIds: [tools.items[0].id] }, wsB);
    expect(server.status).toBe(201);
    const { id, key } = (await server.json()) as { id: string; key: string };
    const list = await app.request(`/mcp/${id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const names = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names).toEqual(["echo"]);
  });

  test("deleting a workspace removes its resources", async () => {
    expect((await req("DELETE", `/api/workspaces/${wsB}`)).status).toBe(200);
    expect((await req("GET", "/api/kvstore", undefined, wsB)).status).toBe(404);
    const listA = (await (await req("GET", "/api/kvstore")).json()) as { items: { value: string }[] };
    expect(listA.items.map((e) => e.value)).toEqual(["a"]);
  });
});
