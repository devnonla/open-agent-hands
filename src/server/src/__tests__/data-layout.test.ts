import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { getDataDir } from "../common/utils/data-dir.js";
import { siteDir } from "../common/utils/data-paths.js";
import { migrateLegacyDataLayout } from "../common/utils/legacy-layout.js";
import { authHeaders, createTestApp, setupAdmin } from "./test-helpers.js";

describe("Data layout", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;

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

  test("site files live under sites/<id>", async () => {
    const res = await app.request("/api/sites", { method: "POST", headers: authHeaders(token), body: JSON.stringify({ name: "Layout site", slug: "layout-site" }) });
    const site = (await res.json()) as { id: string };
    expect(siteDir(site.id)).toBe(join(getDataDir(), "sites", site.id));
    expect(existsSync(join(siteDir(site.id), "app.tsx"))).toBe(true);
  });

  test("folders under workspaces/ are moved back to the top level", () => {
    const id = crypto.randomUUID();
    const old = join(getDataDir(), "workspaces", "some-workspace");
    mkdirSync(join(old, "sites", id), { recursive: true });
    writeFileSync(join(old, "sites", id, "app.tsx"), "export default function App() { return null; }\n");
    mkdirSync(join(old, "tools", "orphan"), { recursive: true });
    mkdirSync(join(getDataDir(), "tool_envs", "orphan"), { recursive: true });

    migrateLegacyDataLayout();

    expect(existsSync(join(siteDir(id), "app.tsx"))).toBe(true);
    expect(existsSync(join(getDataDir(), "workspaces"))).toBe(false);
    expect(existsSync(join(getDataDir(), "tool_envs"))).toBe(false);
  });
});
