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
    expect(init.body.result?.instructions).toContain("get_guide");
    const list = await rpc("tools/list");
    const tools = list.body.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    expect(names.some((n) => n.includes("workspace"))).toBe(false);
    expect(JSON.stringify(tools)).not.toContain('"workspace"');
    expect(names).toEqual(expect.arrayContaining(["get_guide", "create_tool", "run_tool", "create_mcp_server", "kv_set", "datatable_query", "create_site", "run_job"]));
  });

  test("manages resources", async () => {
    expect((await call("kv_set", { entries: [{ key: "GREETING", value: "xin chao" }] })).isError).toBe(false);
    expect((await call("kv_list")).value).toEqual([expect.objectContaining({ key: "GREETING" })]);
    expect((await call("kv_get", { keys: ["GREETING"] })).value).toEqual({ project: "default", values: { GREETING: "xin chao" } });

    const code = "// @name Greeter\n// @description Read the greeting from KV\n// @param {string} name (required) - Who to greet\nimport agenthands from \"@agenthands/runtime\";\nexport default async function main(input: { name: string }) {\n  return { text: `${await agenthands.kv.get(\"GREETING\")} ${input.name}` };\n}\n";
    const created = await call("create_tool", { code });
    expect(created.isError).toBe(false);
    expect((created.value as { name: string }).name).toBe("greeter");
    expect((await call("list_tools")).value).toEqual([expect.objectContaining({ name: "greeter" })]);
    const schema = (await call("get_tool_schema", { tools: ["greeter", (created.value as { id: string }).id] })).value as Record<string, unknown>;
    const greeterSchema = { tool: "greeter", description: "Read the greeting from KV", input: expect.objectContaining({ type: "object", properties: { name: expect.objectContaining({ type: "string" }) }, required: ["name"] }) };
    expect(schema).toEqual({ callWith: "run_tool", tools: [greeterSchema] });
    expect(JSON.stringify(schema)).not.toContain("export default");
    const missing = await call("get_tool_schema", { tools: ["greeter", "nope_missing", "nope_two"] });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("nope_missing, nope_two");
    expect((await call("get_tool_schema", { tools: [] })).isError).toBe(true);

    const badCode = "// @name Bad Params\n// @description Wrong param types\n// @param {\"loud\"|\"quiet\"} mode (optional) - Mode\n// @param {int} count (optional) - Count\nexport default async function main() {\n  return 1;\n}\n";
    const bad = await call("create_tool", { code: badCode });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('mode {"loud"|"quiet"}, count {int}');
    expect(bad.text).toContain("{enum:loud|quiet}");
    expect(((await call("list_tools")).value as { name: string }[]).map((t) => t.name)).not.toContain("bad_params");
    const badUpdate = await call("edit_tool_code", { tool: "greeter", edits: [{ old_string: "{string} name", new_string: "{strng} name" }] });
    expect(badUpdate.isError).toBe(true);
    expect(badUpdate.text).toContain("name {strng}");
    const enumTool = await call("create_tool", { code: badCode.replace('{"loud"|"quiet"}', "{enum:loud|quiet}").replace("{int}", "{integer}") });
    expect(enumTool.isError).toBe(false);
    const enumSchema = (await call("get_tool_schema", { tools: ["bad_params"] })).value as { tools: { input: { properties: Record<string, unknown> } }[] };
    expect(enumSchema.tools[0].input.properties).toEqual({ mode: { type: "string", enum: ["loud", "quiet"], description: "Mode" }, count: { type: "integer", description: "Count" } });
    await call("delete_tool", { tools: ["bad_params"], confirm: true });

    const malformed = "// @name Malformed\n// @description Bad param line\n// @param name string Who to greet\nexport default async function main(input: { name: string }) {\n  return input.name;\n}\n";
    const rejected = await call("create_tool", { code: malformed });
    expect(rejected.isError).toBe(true);
    expect(rejected.text).toContain("Malformed @param line");
    expect(rejected.text).toContain("// @param {string} city (required) - City name");
    expect((await call("edit_tool_code", { tool: "greeter", code: malformed.replace("Malformed", "Greeter") })).isError).toBe(true);
    const jsdoc = "// @name JsDoc Tool\n// @description Mentions @param in prose\n// @param {string} city (required) - City\n/**\n * Entry point.\n * @param input - the tool input\n */\nexport default async function main(input: { city: string }) {\n  return input.city;\n}\n";
    const jsdocTool = await call("create_tool", { code: jsdoc });
    expect(jsdocTool.isError).toBe(false);
    expect((await call("get_tool_schema", { tools: ["jsdoc_tool"] })).value).toMatchObject({ tools: [{ input: { properties: { city: expect.anything() }, required: ["city"] } }] });
    await call("delete_tool", { tools: ["jsdoc_tool"], confirm: true });

    const folder = await call("manage_tool_folder", { action: "create", name: "Utils" });
    expect(folder.isError).toBe(false);
    expect((await call("manage_tool_folder", { action: "create", name: "utils" })).isError).toBe(true);
    expect((await call("move_tool", { tools: ["greeter"], folder: "Nope Folder" })).text).toContain('manage_tool_folder { action: "list" }');
    expect((await call("manage_tool_folder", { action: "update", folder: "Utils", name: "Helpers" })).isError).toBe(false);
    const moved = await call("move_tool", { tools: ["greeter"], folder: "Helpers" });
    expect(moved.value).toEqual({ folder: "Helpers", moved: ["greeter"] });
    expect(((await call("list_tools")).value as { name: string; folder: string | null }[]).find((t) => t.name === "greeter")?.folder).toBe("Helpers");
    expect(((await call("manage_tool_folder", { action: "list" })).value as { tools: string[] }[])[0].tools).toEqual(["greeter"]);
    expect((await call("manage_tool_folder", { action: "delete", folder: "Helpers" })).isError).toBe(true);
    expect((await call("manage_tool_folder", { action: "delete", folder: "Helpers", confirm: true })).value).toEqual({ ok: true, ungroupedTools: 1 });
    expect(((await call("move_tool", { tools: ["greeter"] })).value as { folder: string | null }).folder).toBeNull();

    const ran = await call("run_tool", { tool: "greeter", input: { name: "Quy" } });
    expect(ran.value).toMatchObject({ ok: true, result: { text: "xin chao Quy" } });

    const server = await call("create_mcp_server", { name: "lab-mcp", tools: ["greeter"] });
    const { endpoint, key } = server.value as { endpoint: string; key: string };
    const hosted = await app.request(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const hostedTools = ((await hosted.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(hostedTools).toEqual(["greeter"]);

    await call("create_tool", { code: "// @name Second\n// @description Second tool\nexport default async function main() {\n  return 2;\n}\n" });
    const added = await call("add_tools_to_mcp_server", { server: "lab-mcp", tools: ["second"] });
    expect((added.value as { tools: string[] }).tools.sort()).toEqual(["greeter", "second"]);
    const removed = await call("remove_tools_from_mcp_server", { server: "lab-mcp", tools: ["greeter"] });
    expect((removed.value as { tools: string[] }).tools).toEqual(["second"]);

    await call("create_tool", { code: '// @name Big Out\n// @description Big output\nexport default async function main() {\n  for (let i = 0; i < 500; i++) console.log("noise " + i + " " + "n".repeat(100));\n  return Array.from({ length: 2000 }, (_, i) => ({ i, s: "z".repeat(40) }));\n}\n' });
    const big = (await call("run_tool", { tool: "big_out" })).value as { ok: boolean; result: string; resultTruncated: { totalChars: number; hint: string }; console: string };
    expect(big.ok).toBe(true);
    expect(big.result.length).toBe(20_000);
    expect(big.resultTruncated.totalChars).toBeGreaterThan(20_000);
    expect(big.console.length).toBeLessThan(4_200);
    expect(big.console).toContain("noise 499");

    const failing = await call("run_tool", { tool: "second", code: "// @name Second\n// @description Second tool\nexport default async function main() {\n  throw new Error(\"boom\");\n}\n" });
    expect(failing.isError).toBe(true);
    expect(failing.text).toContain("boom");
  }, 180_000);

  test("edit_tool_code replaces exact text or the whole module", async () => {
    const code = '// @name Editable\n// @description Says a word\n// @param {string} word (required) - Word to say\nexport default async function main(input: { word: string }) {\n  const a = "x";\n  const b = "x";\n  return { said: input.word, a, b };\n}\n';
    expect((await call("create_tool", { code })).isError).toBe(false);

    const one = await call("edit_tool_code", { tool: "editable", edits: [{ old_string: "said: input.word", new_string: "said: input.word.toUpperCase()" }] });
    expect(one.value).toMatchObject({ name: "editable", replacements: 1 });
    expect((await call("run_tool", { tool: "editable", input: { word: "hi" } })).value).toMatchObject({ ok: true, result: { said: "HI" } });

    const ambiguous = await call("edit_tool_code", { tool: "editable", edits: [{ old_string: '"x"', new_string: '"y"' }] });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("matches 2 places");
    const missing = await call("edit_tool_code", { tool: "editable", edits: [{ old_string: "nope", new_string: "x" }] });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('get_tool { tools: ["editable"] }');

    const current = (((await call("get_tool", { tools: ["editable"] })).value as { code: string }[])[0]).code;
    const emptied = await call("edit_tool_code", { tool: "editable", edits: [{ old_string: current, new_string: "" }] });
    expect(emptied.isError).toBe(true);
    expect(emptied.text).toContain("no code");

    const atomic = await call("edit_tool_code", { tool: "editable", edits: [{ old_string: "toUpperCase()", new_string: "toLowerCase()" }, { old_string: "not there", new_string: "x" }] });
    expect(atomic.isError).toBe(true);
    expect(atomic.text).toContain("edits[1]");
    expect((((await call("get_tool", { tools: ["editable"] })).value as { code: string }[])[0]).code).toContain("toUpperCase()");

    const all = await call("edit_tool_code", { tool: "editable", edits: [{ old_string: '"x"', new_string: '"y"', replace_all: true }, { old_string: "toUpperCase()", new_string: "repeat(2)" }] });
    expect(all.value).toMatchObject({ replacements: 3 });
    expect((await call("run_tool", { tool: "editable", input: { word: "ab" } })).value).toMatchObject({ result: { said: "abab", a: "y", b: "y" } });

    const dropped = await call("edit_tool_code", { tool: "editable", edits: [{ old_string: "// @param {string} word (required) - Word to say\n", new_string: "" }] });
    expect((dropped.value as { parameters: { properties: object } }).parameters.properties).toEqual({});
    expect((((await call("get_tool", { tools: ["editable"] })).value as { code: string }[])[0]).code).not.toContain("@param");

    const whole = await call("edit_tool_code", { tool: "editable", code: "// @name Editable\n// @description Says a word\n// @param {integer} n (required) - Count\nexport default async function main(input: { n: number }) {\n  return input.n * 2;\n}\n" });
    expect(whole.value).toMatchObject({ parameters: { properties: { n: expect.objectContaining({ type: "integer" }) } } });
    expect((whole.value as Record<string, unknown>).replacements).toBeUndefined();

    expect((await call("edit_tool_code", { tool: "editable" })).isError).toBe(true);
    expect((await call("edit_tool_code", { tool: "editable", code: "x", edits: [] })).isError).toBe(true);
    const oldWay = await call("update_tool", { tool: "editable", code: "x" });
    expect(oldWay.isError).toBe(true);
    expect(oldWay.text).toContain("edit_tool_code");
    expect((await call("delete_tool", { tools: ["editable"] })).text).toContain("confirm=true");
    expect((await call("delete_tool", { tools: ["editable"], confirm: true })).value).toEqual({ ok: true, deleted: ["editable"] });
  }, 120_000);

  test("tool icons are plain inline SVG", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/></svg>';
    const code = "// @name Iconic\n// @description Has an icon\nexport default async function main() {\n  return 1;\n}\n";
    const created = await call("create_tool", { code, icon: svg });
    expect(created.isError).toBe(false);
    expect((created.value as { hasIcon: boolean }).hasIcon).toBe(true);
    const got = ((await call("get_tool", { tools: ["iconic"] })).value as Record<string, unknown>[])[0];
    expect(got).toMatchObject({ hasIcon: true, code: expect.stringContaining("@name Iconic") });
    expect(got.icon).toBeUndefined();

    const unsafe = await call("update_tool", { tool: "iconic", icon: '<svg onload="alert(1)"></svg>' });
    expect(unsafe.isError).toBe(true);
    expect(unsafe.text).toContain("plain SVG");
    expect((await call("update_tool", { tool: "iconic", icon: "<div></div>" })).isError).toBe(true);
    const noViewBox = await call("update_tool", { tool: "iconic", icon: '<svg width="24" height="24"><path d="M0 0"/></svg>' });
    expect(noViewBox.isError).toBe(true);
    expect(noViewBox.text).toContain("viewBox");

    const cleared = await call("update_tool", { tool: "iconic", icon: "" });
    expect((cleared.value as { hasIcon: boolean }).hasIcon).toBe(false);
    expect((await call("update_tool", { tool: "iconic" })).isError).toBe(true);
    expect((((await call("get_tool", { tools: ["iconic"] })).value as { code: string }[])[0]).code).toContain("return 1");
  });

  test("datatables and jobs", async () => {
    await call("datatable_create_project", { name: "crm" });
    const badTable = await call("datatable_create_table", { project: "crm", name: "leads", columns: [{ name: "email", type: "text" }, { name: "score", type: "int" }] });
    expect(badTable.text).toContain("columns[1]");
    expect(badTable.text).toContain("The table was not created");
    const schema = await call("datatable_create_table", { project: "crm", name: "leads", columns: [{ name: "email", type: "text", required: true }, { name: "score", type: "number" }] });
    expect(schema.isError).toBe(false);
    expect(schema.value).toEqual({ project: "crm", tables: [{ name: "leads", columns: [{ name: "email", type: "text", required: true }, { name: "score", type: "number" }] }] });
    expect((await call("datatable_list_projects")).value).toEqual([expect.objectContaining({ name: "crm", tables: ["leads"] })]);
    await call("datatable_insert_rows", { project: "crm", table: "leads", rows: [{ email: "a@x.io", score: 5 }, { email: "b@x.io", score: 9 }] });
    const hot = await call("datatable_query", { project: "crm", table: "leads", where: { score: { $gt: 6 } } });
    expect(JSON.stringify(hot.value)).toContain("b@x.io");
    expect(JSON.stringify(hot.value)).not.toContain("a@x.io");

    const job = await call("create_job", { name: "hello", code: 'import agenthands from "@agenthands/runtime";\nawait agenthands.step("Main", async () => { agenthands.log.info("hi " + (await agenthands.kv.get("GREETING"))); });\n' });
    expect(job.isError).toBe(false);
    const run = await call("run_job", { job: "hello", wait: true });
    const done = run.value as { status: string; logs: { message: string }[] };
    expect(done.status).toBe("success");
    expect(done.logs.map((l) => l.message)).toContain("hi xin chao");

    const noisy = await call("create_job", { name: "noisy", code: 'import agenthands from "@agenthands/runtime";\nfor (let i = 0; i < 300; i++) agenthands.log.info("line " + i + " " + "w".repeat(600));\n' });
    expect((noisy.value as Record<string, unknown>).code).toBeUndefined();
    const loud = (await call("run_job", { job: "noisy", wait: true })).value as { id: string; status: string; logCount: number; logOffset: number; logs: { message: string; kind?: string }[]; logHint: string };
    expect(loud.status).toBe("success");
    expect(loud.logs.length).toBe(50);
    expect(loud.logOffset).toBe(loud.logCount - 50);
    expect(loud.logs.at(-1)?.message).not.toContain("line 0 ");
    expect(loud.logs.every((l) => l.message.length < 600 && l.kind === undefined)).toBe(true);
    expect(loud.logHint).toContain("log_offset");

    const runs = (await call("get_job_runs", { job: "noisy" })).value as { total: number; items: Record<string, unknown>[] };
    expect(runs.total).toBe(1);
    expect(runs.items[0]).toMatchObject({ id: loud.id, status: "success", logCount: loud.logCount });
    expect(runs.items[0].logs).toBeUndefined();
    const page = (await call("get_job_runs", { job: "noisy", run: loud.id, log_offset: 0, log_limit: 3 })).value as { logs: { message: string }[] };
    expect(page.logs[0].message).toBe("Run started");
    expect(page.logs.length).toBe(3);
    expect((await call("get_job_runs", { job: "hello", run: loud.id })).isError).toBe(true);
    expect(JSON.stringify((await call("list_jobs")).value)).not.toContain("leaseOwner");

    await call("datatable_insert_rows", { project: "crm", table: "leads", rows: [{ email: "c@x.io", score: 1 }] }).then((r) => expect(r.value).toMatchObject({ inserted: 1, ids: [expect.any(String)] }));
    const rows = (await call("datatable_query", { project: "crm", table: "leads", limit: 1 })).value as { total: number; items: Record<string, unknown>[] };
    expect(rows.total).toBe(3);
    expect(Object.keys(rows.items[0]).sort()).toEqual(["data", "id"]);

    const added = await call("datatable_add_columns", { project: "crm", table: "leads", columns: [{ name: "stage", type: "select", options: ["new", "won"] }, { name: "note", type: "text" }] });
    expect(added.value).toMatchObject({ table: "leads", added: ["stage", "note"] });
    const clash = await call("datatable_add_columns", { project: "crm", table: "leads", columns: [{ name: "extra", type: "text" }, { name: "note", type: "text" }] });
    expect(clash.text).toContain("columns[1]");
    expect(JSON.stringify((await call("datatable_get_schema", { project: "crm" })).value)).not.toContain("extra");

    const all = (await call("datatable_query", { project: "crm", table: "leads", limit: 10 })).value as { items: { id: string }[] };
    const [first, second] = all.items.map((r) => r.id);
    expect((await call("datatable_update_rows", { project: "crm", table: "leads", rows: [{ id: first, data: { stage: "won" } }, { id: second, data: { score: 1 } }] })).value).toEqual({ updated: 2, ids: [first, second] });
    const badUpdate = await call("datatable_update_rows", { project: "crm", table: "leads", rows: [{ id: first, data: { stage: "new" } }, { id: second, data: { stage: "lost" } }] });
    expect(badUpdate.isError).toBe(true);
    const firstRow = ((await call("datatable_query", { project: "crm", table: "leads", where: { stage: "won" } })).value as { items: { id: string }[] }).items;
    expect(firstRow.map((r) => r.id)).toContain(first);

    const badInsert = await call("datatable_insert_rows", { project: "crm", table: "leads", rows: [{ email: "ok@x.io" }, { score: 3 }] });
    expect(badInsert.text).toContain("rows[1]");
    expect(((await call("datatable_query", { project: "crm", table: "leads", where: { email: "ok@x.io" } })).value as { total: number }).total).toBe(0);
  }, 180_000);

  test("deletes say ok and every tool sits in a named group", async () => {
    expect((await call("kv_set", { entries: [{ key: "TEMP_A", value: "1" }, { key: "TEMP_B", value: { n: 2 } }] })).value).toEqual({ project: "default", saved: ["TEMP_A", "TEMP_B"] });
    expect((await call("kv_get", { keys: ["TEMP_A", "TEMP_B"] })).value).toEqual({ project: "default", values: { TEMP_A: "1", TEMP_B: '{"n":2}' } });
    const badSet = await call("kv_set", { entries: [{ key: "TEMP_C", value: "x" }, { key: "bad key", value: "x" }] });
    expect(badSet.text).toContain("entries[1]");
    expect((await call("kv_get", { keys: ["TEMP_C"] })).value).toEqual({ project: "default", values: { TEMP_C: null } });
    const oldKv = await call("kv_set", { key: "TEMP_A", value: "x" });
    expect(oldKv.text).toContain('"key" is gone');
    expect((await call("kv_delete", { keys: ["TEMP_A"] })).text).toContain("confirm=true");
    const partial = await call("kv_delete", { keys: ["TEMP_A", "NOPE_KEY"], confirm: true });
    expect(partial.text).toContain("NOPE_KEY");
    expect((await call("kv_get", { keys: ["TEMP_A"] })).value).toEqual({ project: "default", values: { TEMP_A: "1" } });
    expect((await call("kv_delete", { keys: ["TEMP_A", "TEMP_B"], confirm: true })).value).toEqual({ ok: true, project: "default", deleted: ["TEMP_A", "TEMP_B"] });
    expect((await call("kv_get", { keys: ["TEMP_A", "TEMP_A"] })).text).toContain("more than once");

    expect((await call("secret_set", { entries: [{ key: "TEMP_SECRET", value: "x" }, { key: "TEMP_SECRET_2", value: "y" }] })).value).toEqual({ ok: true, saved: ["TEMP_SECRET", "TEMP_SECRET_2"] });
    expect((await call("secret_set", { entries: [{ key: "TEMP_SECRET_3", value: "" }] })).isError).toBe(true);
    expect((await call("secret_delete", { keys: ["TEMP_SECRET"] })).text).toContain("confirm=true");
    expect((await call("secret_delete", { keys: ["TEMP_SECRET", "TEMP_SECRET_2"], confirm: true })).value).toEqual({ ok: true, deleted: ["TEMP_SECRET", "TEMP_SECRET_2"] });
    const admin = (await (await authRequest(app, token, "GET", "/api/core-mcp")).json()) as { groups: { group: string; tools: { name: string }[] }[] };
    const groupOf = (name: string) => admin.groups.find((g) => g.tools.some((t) => t.name === name))?.group;
    expect(groupOf("get_tool_schema")).toBe("Tools");
    expect(groupOf("manage_tool_folder")).toBe("Tools");
    expect(groupOf("add_tools_to_mcp_server")).toBe("MCP servers");
    expect(admin.groups.find((g) => g.group === "Other")?.tools ?? []).toEqual([]);
  });

  test("sites, guides and errors", async () => {
    const site = await call("create_site", { name: "Lab site", slug: "lab-site" });
    expect(site.isError).toBe(false);
    const files = (await call("get_site_files", { site: "lab-site" })).value as { files: Record<string, string> };
    expect(files.files["backend.ts"]).toContain("export async function handle");
    expect((await call("list_sites")).value).toEqual([expect.objectContaining({ slug: "lab-site", url: expect.stringContaining("/public/sites/lab-site") })]);
    expect(JSON.stringify((await call("list_sites")).value)).not.toContain("createdBy");
    expect((await call("get_site_files", { site: "lab-site", file: "styles.css" })).value).toMatchObject({ file: "styles.css", content: expect.any(String) });
    expect((await call("get_site_files", { site: "lab-site", file: "nope.ts" })).isError).toBe(true);

    const written = await call("edit_site_file", { site: "lab-site", file: "backend.ts", content: 'export async function handle() {\n  const a = "x";\n  const b = "x";\n  return { greeting: "xin chao", a, b };\n}\n' });
    expect(written.value).toMatchObject({ ok: true, file: "backend.ts" });
    expect((await call("preview_site", { site: "lab-site" })).value).toMatchObject({ ok: true, data: { greeting: "xin chao" } });

    const edited = await call("edit_site_file", { site: "lab-site", file: "backend.ts", edits: [{ old_string: '"xin chao"', new_string: '"chao ban"' }, { old_string: '"x"', new_string: '"y"', replace_all: true }] });
    expect(edited.value).toMatchObject({ ok: true, replacements: 3 });
    expect((await call("preview_site", { site: "lab-site" })).value).toMatchObject({ data: { greeting: "chao ban", a: "y", b: "y" } });

    const ambiguous = await call("edit_site_file", { site: "lab-site", file: "backend.ts", edits: [{ old_string: '"y"', new_string: '"z"' }] });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("matches 2 places");
    const atomic = await call("edit_site_file", { site: "lab-site", file: "backend.ts", edits: [{ old_string: "chao ban", new_string: "hello" }, { old_string: "missing", new_string: "x" }] });
    expect(atomic.isError).toBe(true);
    expect(atomic.text).toContain('get_site_files { site: "lab-site", file: "backend.ts" }');
    expect(((await call("get_site_files", { site: "lab-site", file: "backend.ts" })).value as { content: string }).content).toContain("chao ban");
    expect((await call("edit_site_file", { site: "lab-site", file: "backend.ts" })).isError).toBe(true);
    expect((await call("edit_site_file", { site: "lab-site", file: "package.json", content: "{}" })).isError).toBe(true);

    expect((await call("get_guide", { topic: "tools" })).text).toContain("@param");
    const missing = await call("get_tool", { tools: ["greeter", "nope_missing"] });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("not found");
  });

  test("rotating the key invalidates the old one", async () => {
    const rotated = (await (await authRequest(app, token, "POST", "/api/core-mcp/rotate")).json()) as { key: string };
    expect(rotated.key).not.toBe(coreKey);
    expect((await rpc("ping")).status).toBe(401);
    expect((await rpc("ping", {}, rotated.key)).status).toBe(200);
  });
});
