import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { getDataDir } from "../utils/data-dir.js";
import { MIGRATIONS } from "./migrations/index.js";
import * as schema from "./schema.js";

export type AppDb = BunSQLiteDatabase<typeof schema>;

let _db: AppDb | null = null;
let _raw: Database | null = null;

function openSqlite(dataDir?: string): AppDb {
  const dir = dataDir ?? getDataDir();
  mkdirSync(dir, { recursive: true });
  _raw = new Database(`${dir}/data.db`);
  _raw.run("PRAGMA journal_mode = WAL;");
  _raw.run("PRAGMA foreign_keys = ON;");
  _db = drizzle(_raw, { schema });
  runMigrations(_raw);
  return _db;
}

export async function initDb(dataDir?: string): Promise<AppDb> {
  if (_db) return _db;
  openSqlite(dataDir);
  await warmupSecrets();
  return _db!;
}

export function isDbReady(): boolean {
  return _db !== null;
}

export function getDb(dataDir?: string): AppDb {
  return _db ?? openSqlite(dataDir);
}

export async function closeDb(): Promise<void> {
  const raw = _raw;
  _raw = null;
  _db = null;
  raw?.close();
}

export function _setTestDb(db: AppDb, raw: Database): void {
  _db = db;
  _raw = raw;
}

export function _resetDb(): void {
  _raw = null;
  _db = null;
}

function splitSqlStatements(sqlText: string): string[] {
  return sqlText
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function runMigrations(raw: Database): void {
  raw.run(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY,
      ran_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  const pending = MIGRATIONS.filter((migration) => !raw.query("SELECT name FROM __migrations WHERE name = ?").get(migration.name));
  if (pending.length === 0) return;
  const fkRow = raw.query("PRAGMA foreign_keys").get() as { foreign_keys: number } | null;
  raw.run("PRAGMA foreign_keys = OFF;");
  try {
    for (const migration of pending) {
      raw.transaction(() => {
        for (const stmt of splitSqlStatements(migration.sql)) raw.run(stmt);
        raw.query("INSERT INTO __migrations (name) VALUES (?)").run(migration.name);
      })();
    }
    const violations = raw.query("PRAGMA foreign_key_check").all();
    if (violations.length > 0) throw new Error(`Migration left ${violations.length} foreign key violations`);
  } finally {
    if (fkRow?.foreign_keys) raw.run("PRAGMA foreign_keys = ON;");
  }
}

export async function executeRaw<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  if (!_raw) getDb();
  if (!_raw) throw new Error("Database not initialized");
  return _raw.query(query).all(...(params as (string | number | boolean | null)[])) as T[];
}

async function warmupSecrets(): Promise<void> {
  const { loadSecretEncryptionKey } = await import("../crypto/secret-crypto.js");
  const { loadJwtSecret } = await import("../middleware/auth.middleware.js");
  const { getConfiguredTimezone } = await import("../utils/cronHelper.js");
  await loadSecretEncryptionKey();
  await loadJwtSecret();
  await getConfiguredTimezone();
}

export * from "./schema.js";
