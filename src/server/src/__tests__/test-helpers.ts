import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { Hono } from "hono";
import { runMigrations } from "../common/db/client.js";
import * as schema from "../common/db/schema.js";

function createTestDb() {
  const raw = new Database(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  runMigrations(raw);
  const db = drizzle(raw, { schema });
  return { db, raw };
}

// ─── App + Auth Helpers ──────────────────────────────────────────────────────

import { createApp } from "../app.js";
import { _resetSecretEncryptionKeyCache, loadSecretEncryptionKey } from "../common/crypto/secret-crypto.js";
import { _resetDb, _setTestDb } from "../common/db/client.js";
import { loadJwtSecret } from "../common/middleware/auth.middleware.js";
import { getConfiguredTimezone } from "../common/utils/cronHelper.js";

/**
 * Create a full Hono app backed by a fresh in-memory DB.
 * Returns the app, db, and a cleanup function.
 */
export async function createTestApp() {
  const { db, raw } = createTestDb();

  // Inject the test DB into the singleton so all services use it
  _setTestDb(db, raw);
  _resetSecretEncryptionKeyCache();
  await loadSecretEncryptionKey();
  await loadJwtSecret();
  await getConfiguredTimezone();

  const app = createApp();

  return {
    app,
    db,
    raw,
    cleanup: () => {
      raw.close();
      _resetDb();
      _resetSecretEncryptionKeyCache();
    },
  };
}

/**
 * Setup an admin user via the /api/auth/setup endpoint.
 * Returns the JWT token for subsequent authenticated requests.
 */
export async function setupAdmin(app: Hono, opts?: { username?: string; name?: string; password?: string; timezone?: string }) {
  const body = {
    username: opts?.username ?? "admin",
    name: opts?.name ?? "Admin User",
    password: opts?.password ?? "password123",
    timezone: opts?.timezone ?? "Asia/Ho_Chi_Minh",
  };

  const res = await app.request("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as { token: string; refreshToken: string; user: Record<string, unknown> };
  return { token: data.token, refreshToken: data.refreshToken, user: data.user, ...body };
}

/**
 * Create Authorization header from a JWT token.
 */
export function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Helper to make authenticated JSON requests.
 */
export async function authRequest(app: Hono, token: string, method: string, path: string, body?: unknown) {
  const options: RequestInit = {
    method,
    headers: authHeaders(token),
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return app.request(path, options);
}
