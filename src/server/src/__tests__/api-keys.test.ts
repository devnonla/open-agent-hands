import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

describe("API Keys", () => {
  let app: Hono;
  let cleanup: () => void;
  let adminToken: string;
  let keyId: string;
  let rawKey: string;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    const admin = await setupAdmin(app);
    adminToken = admin.token;
  });

  afterAll(() => cleanup());

  test("POST /api/api-keys — create returns raw key once", async () => {
    const res = await authRequest(app, adminToken, "POST", "/api/api-keys", {
      name: "Prod key",
      kvUnrestricted: true,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      id: string;
      key: string;
      keyPrefix: string;
      datatablesUnrestricted: boolean;
      datatableProjectIds: string[];
      kvUnrestricted: boolean;
      kvEntryIds: string[];
      keyHash?: string;
    };
    expect(data.key.startsWith("ra_")).toBe(false);
    expect(data.key).toMatch(/^[0-9a-f]{64}$/);
    expect(data.keyPrefix).toBe(data.key.slice(0, 12));
    expect(data.datatablesUnrestricted).toBe(false);
    expect(data.datatableProjectIds).toEqual([]);
    expect(data.kvUnrestricted).toBe(true);
    expect(data.kvEntryIds).toEqual([]);
    expect(data).not.toHaveProperty("keyHash");
    keyId = data.id;
    rawKey = data.key;
  });

  test("GET /api/api-keys — list does not expose hash or raw key", async () => {
    const res = await authRequest(app, adminToken, "GET", "/api/api-keys");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: Record<string, unknown>[] };
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    const row = data.items.find((item) => item.id === keyId);
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty("keyHash");
    expect(row).not.toHaveProperty("key");
    expect(row?.keyPrefix).toBe(rawKey.slice(0, 12));
  });

  test("PUT /api/api-keys/:id — update name and scope", async () => {
    const res = await authRequest(app, adminToken, "PUT", `/api/api-keys/${keyId}`, {
      name: "Prod key v2",
      datatablesUnrestricted: true,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { name: string; datatablesUnrestricted: boolean };
    expect(data.name).toBe("Prod key v2");
    expect(data.datatablesUnrestricted).toBe(true);
  });

  test("POST /api/api-keys — missing name returns 400", async () => {
    const res = await authRequest(app, adminToken, "POST", "/api/api-keys", { kvUnrestricted: true });
    expect(res.status).toBe(400);
  });

  test("POST /api/api-keys/:id/revoke — revokes key", async () => {
    const created = await authRequest(app, adminToken, "POST", "/api/api-keys", { name: "Temp" });
    const temp = (await created.json()) as { id: string };
    const res = await authRequest(app, adminToken, "POST", `/api/api-keys/${temp.id}/revoke`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { revokedAt: string | null };
    expect(data.revokedAt).toBeTruthy();
  });

  test("DELETE /api/api-keys/:id — deletes key", async () => {
    const created = await authRequest(app, adminToken, "POST", "/api/api-keys", { name: "To delete" });
    const temp = (await created.json()) as { id: string };
    const res = await authRequest(app, adminToken, "DELETE", `/api/api-keys/${temp.id}`);
    expect(res.status).toBe(200);
    const list = await authRequest(app, adminToken, "GET", "/api/api-keys");
    const data = (await list.json()) as { items: { id: string }[] };
    expect(data.items.some((item) => item.id === temp.id)).toBe(false);
  });
});
