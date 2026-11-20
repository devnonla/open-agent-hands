import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { _stopProxyHubForTests } from "../modules/tools/common/runtime-proxy.js";
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

describe("Core MCP", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;
  let coreKey: string;
  let rpcId = 0;

  async function rpc(method: string, params: Record<string, unknown> = {}, key = coreKey) {
    const res = await app.request("/mcp/core", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    return { status: res.status, body: (await res.json()) as { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[]; instructions?: string }; error?: unknown } };
  }

  async function call(name: string, args: Record<string, unknown> = {}) {
    const { body } = await rpc("tools/call", { name, arguments: args });
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
  });

  afterAll(() => {
    _stopProxyHubForTests();
    cleanup();
  });

  test("admin API returns a stable key and requires login", async () => {
    expect((await app.request("/api/core-mcp")).status).toBe(401);
    const first = (await (await authRequest(app, token, "GET", "/api/core-mcp")).json()) as { key: string; path: string; toolCount: number };
    const second = (await (await authRequest(app, token, "GET", "/api/core-mcp")).json()) as { key: string };
    expect(first.key).toMatch(/^ah_core_[0-9a-f]{64}$/);
    expect(second.key).toBe(first.key);
    expect(first.path).toBe("/mcp/core");
    expect(first.toolCount).toBeGreaterThan(30);
    coreKey = first.key;
  });

  test("rejects missing or wrong keys", async () => {
    const missing = await app.request("/mcp/core", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(missing.status).toBe(401);
    expect((await rpc("ping", {}, "ah_core_wrong")).status).toBe(401);
  });

  test("initialize and tools/list", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(init.body.result?.instructions).toContain("workspace");
    const list = await rpc("tools/list");
    const names = list.body.result?.tools?.map((t) => t.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["get_guide", "list_workspaces", "create_tool", "run_tool", "create_mcp_server", "kv_set", "datatable_query", "create_site", "run_job"]));
  });

  test("manages resources across workspaces", async () => {
    const ws = await call("create_workspace", { name: "Lab" });
    expect(ws.isError).toBe(false);

    expect((await call("kv_set", { workspace: "Lab", key: "GREETING", value: "xin chao" })).isError).toBe(false);
    expect((await call("kv_list")).value).toEqual([]);
    expect((await call("kv_get", { workspace: "Lab", key: "GREETING" })).value).toBe("xin chao");

    const code = "// @name Greeter\n// @description Read the greeting from KV\n// @param {string} name (required) - Who to greet\nimport agenthands from \"@agenthands/runtime\";\nexport default async function main(input: { name: string }) {\n  return { text: `${await agenthands.kv.get(\"GREETING\")} ${input.name}` };\n}\n";
    const created = await call("create_tool", { workspace: "Lab", code });
    expect(created.isError).toBe(false);
    expect((created.value as { name: string }).name).toBe("greeter");
    expect((await call("list_tools")).value).toEqual([]);

    const ran = await call("run_tool", { workspace: "Lab", tool: "greeter", input: { name: "Quy" } });
    expect(ran.value).toMatchObject({ ok: true, result: { text: "xin chao Quy" } });

    const server = await call("create_mcp_server", { workspace: "Lab", name: "lab-mcp", tools: ["greeter"] });
    const { endpoint, key } = server.value as { endpoint: string; key: string };
    const hosted = await app.request(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const hostedTools = ((await hosted.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(hostedTools).toEqual(["greeter"]);

    await call("create_tool", { workspace: "Lab", code: "// @name Second\n// @description Second tool\nexport default async function main() {\n  return 2;\n}\n" });
    const added = await call("add_tools_to_mcp_server", { workspace: "Lab", server: "lab-mcp", tools: ["second"] });
    expect((added.value as { tools: { name: string }[] }).tools.map((t) => t.name).sort()).toEqual(["greeter", "second"]);
    const removed = await call("remove_tools_from_mcp_server", { workspace: "Lab", server: "lab-mcp", tools: ["greeter"] });
    expect((removed.value as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(["second"]);

    const failing = await call("run_tool", { workspace: "Lab", tool: "second", code: "// @name Second\n// @description Second tool\nexport default async function main() {\n  throw new Error(\"boom\");\n}\n" });
    expect(failing.isError).toBe(true);
    expect(failing.text).toContain("boom");
  }, 180_000);

  test("datatables and jobs", async () => {
    await call("datatable_create_project", { workspace: "Lab", name: "crm" });
    const schema = await call("datatable_create_table", { workspace: "Lab", project: "crm", name: "leads", columns: [{ name: "email", type: "text", required: true }, { name: "score", type: "number" }] });
    expect(schema.isError).toBe(false);
    await call("datatable_insert_rows", { workspace: "Lab", project: "crm", table: "leads", rows: [{ email: "a@x.io", score: 5 }, { email: "b@x.io", score: 9 }] });
    const hot = await call("datatable_query", { workspace: "Lab", project: "crm", table: "leads", where: { score: { $gt: 6 } } });
    expect(JSON.stringify(hot.value)).toContain("b@x.io");
    expect(JSON.stringify(hot.value)).not.toContain("a@x.io");

    const job = await call("create_job", { workspace: "Lab", name: "hello", code: 'import agenthands from "@agenthands/runtime";\nawait agenthands.step("Main", async () => { agenthands.log.info("hi " + (await agenthands.kv.get("GREETING"))); });\n' });
    expect(job.isError).toBe(false);
    const run = await call("run_job", { workspace: "Lab", job: "hello", wait: true });
    const done = run.value as { status: string; logs: { message: string }[] };
    expect(done.status).toBe("success");
    expect(done.logs.map((l) => l.message)).toContain("hi xin chao");
  }, 180_000);

  test("sites, guides and errors", async () => {
    const site = await call("create_site", { workspace: "Lab", name: "Lab site", slug: "lab-site" });
    expect(site.isError).toBe(false);
    const files = (await call("get_site_files", { workspace: "Lab", site: "lab-site" })).value as { files: Record<string, string> };
    expect(files.files["backend.ts"]).toContain("export async function handle");
    expect((await call("list_sites")).value).toEqual([]);

    expect((await call("get_guide", { topic: "tools" })).text).toContain("@param");
    const missing = await call("kv_list", { workspace: "nope" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("not found");
    expect((await call("delete_workspace", { workspace_id: "default", confirm: true })).isError).toBe(true);
  });

  test("rotating the key invalidates the old one", async () => {
    const rotated = (await (await authRequest(app, token, "POST", "/api/core-mcp/rotate")).json()) as { key: string };
    expect(rotated.key).not.toBe(coreKey);
    expect((await rpc("ping")).status).toBe(401);
    expect((await rpc("ping", {}, rotated.key)).status).toBe(200);
  });
});
