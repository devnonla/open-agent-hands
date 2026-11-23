import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { _stopProxyHubForTests } from "../modules/tools/common/runtime-proxy.js";
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

describe("KV projects", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;
  let coreKey: string;
  let rpcId = 0;

  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await app.request("/mcp/core", {
      method: "POST",
      headers: { Authorization: `Bearer ${coreKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    });
    const body = (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
    const text = body.result?.content?.[0]?.text ?? "";
    let value: unknown = text;
    try {
      value = JSON.parse(text);
    } catch {}
    return { isError: body.result?.isError === true, text, value };
  }

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    token = (await setupAdmin(app)).token;
    coreKey = ((await (await authRequest(app, token, "GET", "/api/core-mcp")).json()) as { key: string }).key;
  });

  afterAll(() => {
    _stopProxyHubForTests();
    cleanup();
  });

  test("every key belongs to a project, default when none is given", async () => {
    const plain = await authRequest(app, token, "POST", "/api/kvstore", { key: "BASE_URL", value: "default" });
    expect(plain.status).toBe(201);
    expect(((await plain.json()) as { projectId: string }).projectId).toBe("default");
    const created = await authRequest(app, token, "POST", "/api/kvstore/projects", { name: "crm", description: "CRM sync" });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string; name: string };
    expect((await authRequest(app, token, "POST", "/api/kvstore", { key: "BASE_URL", value: "crm", project: "crm" })).status).toBe(201);
    expect((await authRequest(app, token, "POST", "/api/kvstore", { key: "BASE_URL", value: "again", project: project.id })).status).toBe(400);

    const byDefault = (await (await authRequest(app, token, "GET", "/api/kvstore?project=default")).json()) as { items: { value: string }[] };
    expect(byDefault.items.map((i) => i.value)).toEqual(["default"]);
    const crm = (await (await authRequest(app, token, "GET", `/api/kvstore?project=${project.id}`)).json()) as { items: { value: string }[] };
    expect(crm.items.map((i) => i.value)).toEqual(["crm"]);

    const projects = (await (await authRequest(app, token, "GET", "/api/kvstore/projects")).json()) as { items: { name: string; keyCount: number }[] };
    expect(projects.items.map((p) => [p.name, p.keyCount])).toEqual([
      ["default", 1],
      ["crm", 1],
    ]);
  });

  test("project names are validated and unique", async () => {
    expect((await authRequest(app, token, "POST", "/api/kvstore/projects", { name: "CRM Team" })).status).toBe(400);
    expect((await authRequest(app, token, "POST", "/api/kvstore/projects", { name: "default" })).status).toBe(400);
    expect((await authRequest(app, token, "POST", "/api/kvstore/projects", { name: "crm" })).status).toBe(400);
  });

  test("Core MCP reads and writes per project", async () => {
    expect((await call("kv_get", { key: "BASE_URL" })).value).toBe("default");
    expect((await call("kv_get", { key: "BASE_URL", project: "crm" })).value).toBe("crm");

    const missing = await call("kv_get", { key: "BASE_URL", project: "nope" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("kv_list_projects");

    expect((await call("kv_set", { key: "LAST_RUN", value: "1", project: "reports" })).isError).toBe(false);
    const listed = (await call("kv_list_projects")).value as { name: string; keyCount: number }[];
    expect(listed.map((p) => p.name)).toEqual(["default", "crm", "reports"]);

    const all = (await call("kv_list")).value as { project: string; key: string }[];
    expect(all.map((e) => `${e.project}/${e.key}`).sort()).toEqual(["crm/BASE_URL", "default/BASE_URL", "reports/LAST_RUN"]);
    expect(((await call("kv_list", { project: "reports" })).value as unknown[]).length).toBe(1);

    expect((await call("kv_delete_project", { project: "reports" })).isError).toBe(true);
    expect((await call("kv_delete_project", { project: "reports", confirm: true })).value).toEqual({ ok: true, deletedKeys: 1 });
    expect(((await call("kv_list_projects")).value as { name: string }[]).map((p) => p.name)).toEqual(["default", "crm"]);
    const keepDefault = await call("kv_delete_project", { project: "default", confirm: true });
    expect(keepDefault.isError).toBe(true);
    expect(keepDefault.text).toContain("cannot be deleted");
  });

  test("tool code uses kv.project()", async () => {
    const code = '// @name Kv Probe\n// @description Reads KV from the default project and others\nimport agenthands from "@agenthands/runtime";\nexport default async function main() {\n  const crm = agenthands.kv.project("crm");\n  await agenthands.kv.project("fresh").set("COUNT", "7");\n  return { plain: await agenthands.kv.get("BASE_URL"), named: await agenthands.kv.project("default").get("BASE_URL"), crm: await crm.get("BASE_URL"), crmKeys: (await crm.list()).map((e) => e.key), fresh: await agenthands.kv.project("fresh").get("COUNT"), missing: await agenthands.kv.project("ghost").get("X", "fallback") };\n}\n';
    expect((await call("create_tool", { code })).isError).toBe(false);
    const ran = await call("run_tool", { tool: "kv_probe", input: {} });
    expect(ran.isError).toBe(false);
    expect(JSON.stringify(ran.value)).toContain('"plain":"default"');
    expect(JSON.stringify(ran.value)).toContain('"named":"default"');
    expect(JSON.stringify(ran.value)).toContain('"crm":"crm"');
    expect(JSON.stringify(ran.value)).toContain('"crmKeys":["BASE_URL"]');
    expect(JSON.stringify(ran.value)).toContain('"fresh":"7"');
    expect(JSON.stringify(ran.value)).toContain('"missing":"fallback"');
  }, 180_000);

  test("deleting a project removes its keys, the default project stays", async () => {
    const projects = (await (await authRequest(app, token, "GET", "/api/kvstore/projects")).json()) as { items: { id: string; name: string }[] };
    expect((await authRequest(app, token, "DELETE", "/api/kvstore/projects/default")).status).toBe(400);
    expect((await authRequest(app, token, "PUT", "/api/kvstore/projects/default", { name: "main" })).status).toBe(400);
    expect((await authRequest(app, token, "PUT", "/api/kvstore/projects/default", { description: "x" })).status).toBe(400);
    const crm = projects.items.find((p) => p.name === "crm");
    expect(crm).toBeDefined();
    const renamed = await authRequest(app, token, "PUT", `/api/kvstore/projects/${crm?.id}`, { name: "crm-v2" });
    expect(((await renamed.json()) as { name: string }).name).toBe("crm-v2");
    const deleted = await authRequest(app, token, "DELETE", `/api/kvstore/projects/${crm?.id}`);
    expect(await deleted.json()).toEqual({ deletedKeys: 1 });
    const all = (await (await authRequest(app, token, "GET", "/api/kvstore")).json()) as { items: { key: string }[] };
    expect(all.items.map((i) => i.key).sort()).toEqual(["BASE_URL", "COUNT"]);
  });
});
