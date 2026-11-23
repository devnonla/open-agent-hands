import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { _stopProxyHubForTests } from "../modules/tools/common/runtime-proxy.js";
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

describe("Storage", () => {
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
    return { isError: body.result?.isError === true, text, value: value as any };
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

  test("creates spaces and validates names", async () => {
    expect((await call("storage_create_space", { name: "Bad Name" })).isError).toBe(true);
    const created = await call("storage_create_space", { name: "reports", description: "Daily reports" });
    expect(created.isError).toBe(false);
    expect(created.value).toMatchObject({ name: "reports", public: false, fileCount: 0 });
    expect((await call("storage_create_space", { name: "reports" })).isError).toBe(true);
  });

  test("puts, lists, reads and deletes files", async () => {
    const put = await call("storage_put_file", { space: "reports", key: "2026/11/summary.json", content: '{"ok":true}' });
    expect(put.isError).toBe(false);
    expect(put.value).toMatchObject({ key: "2026/11/summary.json", size: 11, publicUrl: null });
    expect(put.value.contentType).toContain("application/json");

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]).toString("base64");
    expect((await call("storage_put_file", { space: "reports", key: "logo.png", content: png, encoding: "base64" })).isError).toBe(false);

    const got = await call("storage_get_file", { space: "reports", key: "2026/11/summary.json" });
    expect(got.value).toMatchObject({ encoding: "utf8", content: '{"ok":true}' });
    const bin = await call("storage_get_file", { space: "reports", key: "logo.png" });
    expect(bin.value).toMatchObject({ encoding: "base64", content: png });

    const replaced = await call("storage_put_file", { space: "reports", key: "/2026/11/summary.json", content: '{"ok":false}' });
    expect(replaced.value.size).toBe(12);

    const all = await call("storage_list_files", { space: "reports" });
    expect(all.value.total).toBe(2);
    const folder = await call("storage_list_files", { space: "reports", prefix: "2026/" });
    expect(folder.value.items.map((o: { key: string }) => o.key)).toEqual(["2026/11/summary.json"]);

    const top = await call("storage_list_files", { space: "reports", folders: true });
    expect(top.value.folders).toEqual([expect.objectContaining({ prefix: "2026/", fileCount: 1, totalBytes: 12 })]);
    expect(top.value.items.map((o: { key: string }) => o.key)).toEqual(["logo.png"]);

    expect((await call("storage_put_file", { space: "reports", key: "../x", content: "x" })).isError).toBe(true);
    expect((await call("storage_put_file", { space: "reports", key: "a.txt" })).isError).toBe(true);

    expect((await call("storage_delete_file", { space: "reports", key: "logo.png" })).isError).toBe(false);
    expect((await call("storage_get_file", { space: "reports", key: "logo.png" })).isError).toBe(true);
    expect((await call("storage_list_spaces")).value).toEqual([expect.objectContaining({ name: "reports", fileCount: 1, totalBytes: 12 })]);
  });

  test("put_object creates a missing space", async () => {
    const put = await call("storage_put_file", { space: "scratch", key: "note.txt", content: "hi" });
    expect(put.isError).toBe(false);
    expect((await call("storage_list_spaces")).value.map((b: { name: string }) => b.name)).toEqual(["reports", "scratch"]);
  });

  test("public links are per-file tokens that cannot be guessed", async () => {
    const before = await call("storage_list_files", { space: "scratch" });
    expect(before.value.items[0].publicUrl).toBeNull();
    expect((await app.request("/public/storage/scratch/note.txt")).status).toBe(404);

    const updated = await call("storage_update_space", { space: "scratch", public: true });
    expect(updated.value.public).toBe(true);
    const url = (await call("storage_list_files", { space: "scratch" })).value.items[0].publicUrl as string;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8429\/public\/storage\/[A-Za-z0-9_-]{32}\/note\.txt$/);

    const res = await app.request(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await app.request(url, { headers: { "If-None-Match": res.headers.get("etag") ?? "" } })).status).toBe(304);
    expect((await app.request(url.replace(/note\.txt$/, "other-name.txt"))).status).toBe(200);

    expect((await app.request("/public/storage/scratch/note.txt")).status).toBe(404);
    expect((await app.request(`/public/storage/${"A".repeat(32)}/note.txt`)).status).toBe(404);
    expect((await app.request("/public/storage/")).status).toBe(404);

    const reset = await call("storage_reset_public_link", { space: "scratch", key: "note.txt" });
    expect(reset.value.publicUrl).not.toBe(url);
    expect((await app.request(url)).status).toBe(404);
    expect((await app.request(reset.value.publicUrl)).status).toBe(200);

    await call("storage_update_space", { space: "scratch", public: false });
    expect((await app.request(reset.value.publicUrl)).status).toBe(404);
    await call("storage_update_space", { space: "scratch", public: true });
    expect((await app.request(reset.value.publicUrl)).status).toBe(200);
  });

  test("public links start with the configured public URL", async () => {
    const save = await authRequest(app, token, "PATCH", "/api/settings", { public_url: "https://hands.example.com/" });
    expect(save.status).toBe(200);
    const url = (await call("storage_list_files", { space: "scratch" })).value.items[0].publicUrl as string;
    expect(url).toMatch(/^https:\/\/hands\.example\.com\/public\/storage\/[A-Za-z0-9_-]{32}\/note\.txt$/);
    const info = (await (await authRequest(app, token, "GET", "/api/settings/public-url")).json()) as { effective: string; source: string };
    expect(info).toMatchObject({ effective: "https://hands.example.com", source: "setting" });
    expect((await authRequest(app, token, "PATCH", "/api/settings", { public_url: "not a url" })).status).toBe(400);
    await authRequest(app, token, "PATCH", "/api/settings", { public_url: "" });
    expect(((await call("storage_list_files", { space: "scratch" })).value.items[0].publicUrl as string).startsWith("http://127.0.0.1:8429/")).toBe(true);
  });

  test("UI routes upload, browse, download and delete", async () => {
    expect((await app.request("/api/storage/spaces")).status).toBe(401);
    const spaces = (await (await authRequest(app, token, "GET", "/api/storage/spaces")).json()) as { items: { id: string; name: string }[] };
    const reports = spaces.items.find((b) => b.name === "reports");
    if (!reports) throw new Error("reports space missing");

    const upload = await app.request(`/api/storage/spaces/${reports.id}/files?key=${encodeURIComponent("2026/data.csv")}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/csv" }, body: "a,b\n1,2\n" });
    expect(upload.status).toBe(201);
    const uploaded = (await upload.json()) as { id: string; key: string; size: number };
    expect(uploaded).toMatchObject({ key: "2026/data.csv", size: 8 });

    const view = (await (await authRequest(app, token, "GET", `/api/storage/spaces/${reports.id}/browse?prefix=2026`)).json()) as { prefix: string; folders: { prefix: string }[]; items: { key: string }[] };
    expect(view.prefix).toBe("2026/");
    expect(view.folders.map((f) => f.prefix)).toEqual(["2026/11/"]);
    expect(view.items.map((o) => o.key)).toEqual(["2026/data.csv"]);

    const download = await authRequest(app, token, "GET", `/api/storage/files/${uploaded.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain('filename="data.csv"');
    expect(await download.text()).toBe("a,b\n1,2\n");

    expect((await authRequest(app, token, "DELETE", `/api/storage/files/${uploaded.id}`)).status).toBe(200);
    expect((await authRequest(app, token, "GET", `/api/storage/files/${uploaded.id}/download`)).status).toBe(404);
  });

  test("space list carries folder count, last change and bytes by kind", async () => {
    const spaces = (await (await authRequest(app, token, "GET", "/api/storage/spaces")).json()) as { items: { name: string; fileCount: number; folderCount: number; lastFileAt: string | null; bytesByKind: Record<string, number> }[] };
    const reports = spaces.items.find((s) => s.name === "reports");
    expect(reports).toMatchObject({ fileCount: 1, folderCount: 1, bytesByKind: { images: 0, documents: 0, data: 12, media: 0, other: 0 } });
    expect(reports?.lastFileAt).not.toBeNull();
    const scratch = spaces.items.find((s) => s.name === "scratch");
    expect(scratch).toMatchObject({ folderCount: 0, bytesByKind: { documents: 2 } });
  });

  test("tools use agenthands.storage", async () => {
    const code = `// @name Storage Roundtrip
// @description Write and read a file
import agenthands from "@agenthands/runtime";
export default async function main() {
  const b = agenthands.storage.space("runtime-test");
  await b.put("dir/a.json", JSON.stringify({ n: 1 }));
  await b.put("bytes.bin", new Uint8Array([1, 2, 3]));
  await b.put("streamed.txt", new Blob(["a", "b", "c"]).stream());
  const bytes = await b.get("bytes.bin");
  const streamed = await new Response(await b.stream("streamed.txt")).text();
  return { json: await b.getJson("dir/a.json"), bytes: Array.from(bytes ?? []), streamed, keys: (await b.list()).map((o) => o.key), missing: await b.get("nope"), deleted: await b.delete("bytes.bin") };
}
`;
    expect((await call("create_tool", { code })).isError).toBe(false);
    const run = await call("run_tool", { tool: "storage_roundtrip" });
    expect(run.value).toMatchObject({ ok: true, result: { json: { n: 1 }, bytes: [1, 2, 3], streamed: "abc", keys: ["bytes.bin", "dir/a.json", "streamed.txt"], missing: null, deleted: { deleted: true } } });
  }, 120_000);

  test("tools get the full public link from put and list", async () => {
    await authRequest(app, token, "PATCH", "/api/settings", { public_url: "https://hands.example.com" });
    expect((await call("storage_create_space", { name: "shared-files", public: true })).isError).toBe(false);
    const code = `// @name Upload Report
// @description Upload a report and return its link
import agenthands from "@agenthands/runtime";
export default async function main() {
  const files = agenthands.storage.space("shared-files");
  const saved = await files.put("reports/q4.pdf", "pdf bytes", { contentType: "application/pdf" });
  const listed = await files.list("reports/");
  const privateFile = await agenthands.storage.space("tool-private").put("note.txt", "hi");
  return { putUrl: saved.publicUrl, listUrl: listed[0].publicUrl, privateUrl: privateFile.publicUrl };
}
`;
    expect((await call("create_tool", { code })).isError).toBe(false);
    const run = await call("run_tool", { tool: "upload_report" });
    const result = run.value.result as { putUrl: string; listUrl: string; privateUrl: string | null };
    expect(result.putUrl).toMatch(/^https:\/\/hands\.example\.com\/public\/storage\/[A-Za-z0-9_-]{32}\/q4\.pdf$/);
    expect(result.listUrl).toBe(result.putUrl);
    expect(result.privateUrl).toBeNull();
    const res = await app.request(result.putUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pdf bytes");
    await authRequest(app, token, "PATCH", "/api/settings", { public_url: "" });
  }, 120_000);

  test("delete_space needs confirm and removes files", async () => {
    expect((await call("storage_delete_space", { space: "reports" })).isError).toBe(true);
    const deleted = await call("storage_delete_space", { space: "reports", confirm: true });
    expect(deleted.value).toEqual({ ok: true, deletedObjects: 1 });
    expect((await call("storage_list_files", { space: "reports" })).isError).toBe(true);
  });
});
