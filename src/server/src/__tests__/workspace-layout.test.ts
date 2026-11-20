import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { getDb, sites } from "../common/db/client.js";
import { qrun } from "../common/db/query.js";
import { getDataDir } from "../common/utils/data-dir.js";
import { migrateLegacyDataLayout } from "../common/workspace/legacy-layout.js";
import { siteDir, workspaceDir } from "../common/workspace/workspace-paths.js";
import { authHeaders, createTestApp, setupAdmin } from "./test-helpers.js";

describe("Workspace data layout", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;

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

  test("tests never touch the real data dir", () => {
    expect(getDataDir()).toContain("agenthands-test-");
  });

  test("site files live under their workspace and go away with it", async () => {
    const ws = ((await (await req("POST", "/api/workspaces", { name: "Layout" })).json()) as { id: string }).id;
    const site = ((await (await req("POST", "/api/sites", { name: "Layout site", slug: "layout-site" }, ws)).json()) as { id: string }).id;
    expect(existsSync(join(siteDir(site, ws), "app.tsx"))).toBe(true);
    expect(siteDir(site, ws).startsWith(workspaceDir(ws))).toBe(true);

    expect((await req("DELETE", `/api/workspaces/${ws}`)).status).toBe(200);
    expect(existsSync(workspaceDir(ws))).toBe(false);
  });

  test("legacy sites/ and tool_envs/ folders are moved into workspaces/", async () => {
    const id = crypto.randomUUID();
    const now = new Date();
    await qrun(getDb().insert(sites).values({ id, workspaceId: "default", name: "Legacy", slug: `legacy-${id.slice(0, 8)}`, createdAt: now, updatedAt: now }));
    const legacy = join(getDataDir(), "sites", id);
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "app.tsx"), "export default function App() { return null; }\n");
    mkdirSync(join(getDataDir(), "tool_envs", "orphan"), { recursive: true });

    await migrateLegacyDataLayout();

    expect(existsSync(join(siteDir(id, "default"), "app.tsx"))).toBe(true);
    expect(existsSync(join(getDataDir(), "sites"))).toBe(false);
    expect(existsSync(join(getDataDir(), "tool_envs"))).toBe(false);
  });
});
