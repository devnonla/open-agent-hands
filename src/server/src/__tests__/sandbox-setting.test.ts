import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { invalidateSandboxSetting, isSandboxAvailable, wrapForSandbox } from "../common/sandbox/index.js";
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

describe("Sandbox setting", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    token = (await setupAdmin(app)).token;
    invalidateSandboxSetting();
  });

  afterAll(() => {
    invalidateSandboxSetting();
    cleanup();
  });

  test("is off by default and leaves commands unwrapped", async () => {
    const status = (await (await authRequest(app, token, "GET", "/api/settings/sandbox")).json()) as { enabled: boolean };
    expect(status.enabled).toBe(false);
    expect(await wrapForSandbox(["bun", "run.ts"], { cwd: "/tmp", writablePaths: ["/tmp"] })).toEqual(["bun", "run.ts"]);
  });

  test("enabling wraps commands when a backend is available", async () => {
    expect((await authRequest(app, token, "PATCH", "/api/settings", { sandbox_enabled: "true" })).status).toBe(200);
    const status = (await (await authRequest(app, token, "GET", "/api/settings/sandbox")).json()) as { enabled: boolean; available: boolean };
    expect(status.enabled).toBe(true);
    const wrapped = await wrapForSandbox(["bun", "run.ts"], { cwd: "/tmp", writablePaths: ["/tmp"] });
    if (await isSandboxAvailable()) expect(wrapped).not.toEqual(["bun", "run.ts"]);
    else expect(wrapped).toEqual(["bun", "run.ts"]);

    await authRequest(app, token, "PATCH", "/api/settings", { sandbox_enabled: "false" });
    expect(await wrapForSandbox(["bun", "run.ts"], { cwd: "/tmp", writablePaths: ["/tmp"] })).toEqual(["bun", "run.ts"]);
  });
});
