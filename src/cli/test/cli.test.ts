import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { parseToolArgs } from "../src/args.js";
import { type CliIo, runCli } from "../src/cli.js";
import { resolveServer } from "../src/config.js";
import { _stopProxyHubForTests } from "../../server/src/modules/tools/common/runtime-proxy.js";
import { authRequest, createTestApp, setupAdmin } from "../../server/src/__tests__/test-helpers.js";

const LOCAL = "http://127.0.0.1:8429";
const VPS = "https://hands.example.com";

describe("CLI", () => {
  let app: Hono;
  let cleanup: () => void;
  let coreKey: string;
  let home: string;

  function makeIo(cwd = home, extra: Partial<CliIo> = {}) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const hits: string[] = [];
    const io: CliIo = {
      fetch: async (input, init) => {
        const url = new URL(input);
        hits.push(url.origin);
        return app.request(`http://localhost${url.pathname}${url.search}`, init);
      },
      env: { AGENTHANDS_CONFIG_DIR: join(home, "config") },
      cwd,
      stdout: (t) => stdout.push(t),
      stderr: (t) => stderr.push(t),
      stdoutIsTty: false,
      stdinIsTty: false,
      readStdin: async () => "",
      readSecret: async () => "",
      version: "test",
      ...extra,
    };
    return { io, stdout, stderr, hits, json: () => JSON.parse(stdout.join("\n")) };
  }

  async function run(argv: string[], cwd?: string, extra?: Partial<CliIo>) {
    const ctx = makeIo(cwd, extra);
    const code = await runCli(argv, ctx.io);
    return { code, ...ctx };
  }

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    const token = (await setupAdmin(app)).token;
    coreKey = ((await (await authRequest(app, token, "GET", "/api/core-mcp")).json()) as { key: string }).key;
    home = mkdtempSync(join(tmpdir(), "agenthands-cli-"));
  });

  afterAll(() => {
    _stopProxyHubForTests();
    cleanup();
  });

  test("login rejects a wrong key and saves nothing", async () => {
    const r = await run(["login", "--key", "ah_core_wrong"]);
    expect(r.code).toBe(1);
    expect(r.stderr.join("\n")).toContain("rejected the key");
    const s = await run(["servers"]);
    expect(s.json().servers).toEqual([]);
  });

  test("login saves local and vps, first becomes default, file is private", async () => {
    const local = await run(["login", coreKey]);
    expect(local.code).toBe(0);
    expect(local.json()).toMatchObject({ ok: true, server: "local", url: LOCAL, default: "local" });
    const vps = await run(["login", "hands.example.com", "--name", "vps"], home, { readStdin: async () => `${coreKey}\n` });
    expect(vps.code).toBe(0);
    expect(vps.json()).toMatchObject({ server: "vps", url: VPS, default: "local" });
    expect(statSync(local.json().config).mode & 0o777).toBe(0o600);
    const list = (await run(["servers"])).json();
    expect(list.servers.map((s: { name: string }) => s.name)).toEqual(["local", "vps"]);
    expect(list.active).toMatchObject({ name: "local", source: "default" });
  });

  test("login takes url and key in either order", async () => {
    const r = await run(["login", coreKey, "http://localhost:9999", "--name", "tmp"]);
    expect(r.json()).toMatchObject({ server: "tmp", url: "http://localhost:9999" });
    expect((await run(["logout", "tmp"])).code).toBe(0);
  });

  test("picks the server from flag, env, pin and default, and names it on stderr", async () => {
    const byDefault = await run(["list_sites"]);
    expect(byDefault.code).toBe(0);
    expect(byDefault.stderr[0]).toBe(`→ local (${LOCAL})`);
    expect(byDefault.hits.every((h) => h === LOCAL)).toBe(true);

    const byFlag = await run(["-s", "vps", "list_sites"]);
    expect(byFlag.hits.every((h) => h === VPS)).toBe(true);

    const project = join(home, "proj", "sub");
    mkdirSync(project, { recursive: true });
    expect((await run(["pin", "vps"], join(home, "proj"))).code).toBe(0);
    const pinned = await run(["list_sites"], project);
    expect(pinned.stderr[0]).toBe(`→ vps (${VPS})`);
    const flagWins = await run(["list_sites", "--server", "local"], project);
    expect(flagWins.stderr[0]).toBe(`→ local (${LOCAL})`);

    const ctx = makeIo(project);
    ctx.io.env.AGENTHANDS_SERVER = "local";
    await runCli(["list_sites"], ctx.io);
    expect(ctx.stderr[0]).toBe(`→ local (${LOCAL})`);

    const missing = await run(["-s", "nope", "list_sites"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr.join("\n")).toContain("Known servers: local, vps");
  });

  test("fails loudly when several servers exist and none applies", () => {
    const config = { servers: { a: { url: LOCAL, key: "k" }, b: { url: VPS, key: "k" } } };
    expect(() => resolveServer(config, { env: {}, cwd: tmpdir() })).toThrow("none is the default");
    expect(resolveServer({ ...config, default: "b" }, { env: {}, cwd: tmpdir() }).name).toBe("b");
  });

  test("calls tools by name, group words, positionals and flags", async () => {
    const set = await run(["kv", "set", "BASE_URL=https://api.x.com", "MODE=prod"]);
    expect(set.code).toBe(0);
    const get = await run(["kv_get", "BASE_URL", "MODE"]);
    expect(get.code).toBe(0);
    expect(JSON.stringify(get.json())).toContain("https://api.x.com");

    const toolFile = join(home, "echo.ts");
    writeFileSync(toolFile, `// @name Echo Back\n// @description Echo the text\n// @param {string} text (required) - Text\nexport default async function main(input: { text: string }) {\n  return { said: input.text };\n}\n`);
    const created = await run(["tools", "create", "--code-file", toolFile]);
    expect(created.code).toBe(0);
    const listed = await run(["tools", "list"]);
    expect(JSON.stringify(listed.json())).toContain("echo_back");
  });

  test("tool errors go to stderr with exit 1, and unknown commands suggest names", async () => {
    const del = await run(["kv_delete", "BASE_URL"]);
    expect(del.code).toBe(1);
    expect(del.stderr.join("\n")).toContain("--confirm");
    const ok = await run(["kv_delete", "BASE_URL", "--confirm"]);
    expect(ok.code).toBe(0);

    const unknown = await run(["kv", "frobnicate"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr.join("\n")).toContain("Did you mean");

    const badFlag = await run(["list_sites", "--nope", "1"]);
    expect(badFlag.stderr.join("\n")).toContain("Unknown flag --nope");
  });

  test("call takes a raw JSON object", async () => {
    const r = await run(["call", "kv_set", '{"entries":[{"key":"RAW","value":"1"}]}']);
    expect(r.code).toBe(0);
    const bad = await run(["call", "no_such_tool"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr.join("\n")).toContain("Unknown tool");
  });

  test("help lists tools by group and shows one tool's arguments", async () => {
    const all = await run(["help"]);
    expect(all.stdout.join("\n")).toContain("Storage:");
    const one = await run(["help", "kv_set"]);
    expect(one.stdout.join("\n")).toContain("KEY=VALUE...");
  });

  test("upload and download stream files and folders", async () => {
    const dir = join(home, "assets");
    mkdirSync(join(dir, "img"), { recursive: true });
    writeFileSync(join(dir, "a.txt"), "alpha");
    writeFileSync(join(dir, "img", "b.bin"), Buffer.from([0, 1, 2, 3]));
    const up = await run(["upload", "cli-space", dir, "--prefix", "drop"]);
    expect(up.code).toBe(0);
    expect(up.json().uploaded.map((f: { key: string }) => f.key).sort()).toEqual(["drop/assets/a.txt", "drop/assets/img/b.bin"]);

    const out = join(home, "out");
    const down = await run(["download", "cli-space", "drop/assets/a.txt", "drop/assets/img/b.bin", "--out", out]);
    expect(down.code).toBe(0);
    expect(readFileSync(join(out, "drop/assets/a.txt"), "utf8")).toBe("alpha");
    expect([...readFileSync(join(out, "drop/assets/img/b.bin"))]).toEqual([0, 1, 2, 3]);
  });

  test("logout moves the default and unpin removes the pin", async () => {
    expect((await run(["unpin"], join(home, "proj", "sub"))).stderr.join("\n")).toContain("comes from");
    expect((await run(["unpin"], join(home, "proj"))).code).toBe(0);
    const out = await run(["logout", "local"]);
    expect(out.json()).toMatchObject({ removed: "local", default: "vps" });
  });
});

describe("CLI argument parsing", () => {
  const schema = { properties: { space: { type: "string" }, keys: { type: "array", items: { type: "string" } }, limit: { type: "number" }, confirm: { type: "boolean" }, where: { type: ["object", "array"] } }, required: ["space", "keys", "confirm"] };
  const noFiles = async () => "";

  test("positionals fill required slots and arrays take the rest", async () => {
    expect(await parseToolArgs(schema, ["docs", "a", "b", "--confirm", "--limit", "5"], noFiles)).toEqual({ space: "docs", keys: ["a", "b"], confirm: true, limit: 5 });
  });

  test("JSON values, --no- booleans and --json", async () => {
    expect(await parseToolArgs(schema, ["--json", '{"space":"x"}', "--keys", '["k"]', "--no-confirm", "--where", '{"a":1}'], noFiles)).toEqual({ space: "x", keys: ["k"], confirm: false, where: { a: 1 } });
  });

  test("missing and bad values are explicit", async () => {
    await expect(parseToolArgs(schema, ["docs"], noFiles)).rejects.toThrow("Missing --keys, --confirm");
    await expect(parseToolArgs(schema, ["docs", "a", "--confirm", "--limit", "x"], noFiles)).rejects.toThrow("expects a number");
  });
});
