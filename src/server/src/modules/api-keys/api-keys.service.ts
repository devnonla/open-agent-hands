import { currentWorkspaceId } from "../../common/workspace/workspace-context.js";
import { inWorkspace } from "../../common/workspace/scope.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { apiKeyDatatableProjects, apiKeyKvEntries, apiKeys, datatableProjects, getDb, kvStore } from "../../common/db/client.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException } from "../../common/exceptions/http.exception.js";

const KEY_PREFIX_LEN = 12;

export type ApiKeyMeta = {
  id: string;
  name: string;
  keyPrefix: string;
  datatablesUnrestricted: boolean;
  datatableProjectIds: string[];
  kvUnrestricted: boolean;
  kvEntryIds: string[];
  createdBy: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export type ApiKeyContext = {
  id: string;
  workspaceId: string;
  createdBy: string;
  datatablesUnrestricted: boolean;
  datatableProjectIds: string[];
  kvUnrestricted: boolean;
  kvEntryIds: string[];
};

export type ApiKeyWriteBody = {
  name?: string;
  datatablesUnrestricted?: boolean;
  datatableProjectIds?: string[];
  kvUnrestricted?: boolean;
  kvEntryIds?: string[];
};

function hashApiKey(raw: string): string {
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex");
}

function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
}

async function loadDatatableProjectIds(keyId: string): Promise<string[]> {
  return (await qall(getDb().select({ projectId: apiKeyDatatableProjects.projectId }).from(apiKeyDatatableProjects).where(eq(apiKeyDatatableProjects.apiKeyId, keyId)))).map((r) => r.projectId);
}

async function loadKvEntryIds(keyId: string): Promise<string[]> {
  return (await qall(getDb().select({ kvEntryId: apiKeyKvEntries.kvEntryId }).from(apiKeyKvEntries).where(eq(apiKeyKvEntries.apiKeyId, keyId)))).map((r) => r.kvEntryId);
}

async function loadScope(keyId: string) {
  return {
    datatableProjectIds: await loadDatatableProjectIds(keyId),
    kvEntryIds: await loadKvEntryIds(keyId),
  };
}

function toMeta(row: typeof apiKeys.$inferSelect, scope: { datatableProjectIds: string[]; kvEntryIds: string[] }): ApiKeyMeta {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    datatablesUnrestricted: Boolean(row.datatablesUnrestricted),
    datatableProjectIds: scope.datatableProjectIds,
    kvUnrestricted: Boolean(row.kvUnrestricted),
    kvEntryIds: scope.kvEntryIds,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

async function toContext(row: typeof apiKeys.$inferSelect): Promise<ApiKeyContext> {
  const scope = await loadScope(row.id);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    createdBy: row.createdBy,
    datatablesUnrestricted: Boolean(row.datatablesUnrestricted),
    datatableProjectIds: scope.datatableProjectIds,
    kvUnrestricted: Boolean(row.kvUnrestricted),
    kvEntryIds: scope.kvEntryIds,
  };
}

async function assertExistingIds(ids: string[], table: typeof datatableProjects | typeof kvStore, label: string): Promise<string[]> {
  const unique = uniqueIds(ids);
  if (unique.length === 0) return [];
  const found = await qall(getDb().select({ id: table.id }).from(table).where(and(inWorkspace(table.workspaceId), inArray(table.id, unique))));
  if (found.length !== unique.length) {
    throw new BadRequestException(`One or more ${label} were not found`);
  }
  return unique;
}

async function replaceDatatableProjects(keyId: string, projectIds: string[]) {
  const db = getDb();
  await qrun(db.delete(apiKeyDatatableProjects).where(eq(apiKeyDatatableProjects.apiKeyId, keyId)));
  if (projectIds.length === 0) return;
  await qrun(db.insert(apiKeyDatatableProjects).values(projectIds.map((projectId) => ({ apiKeyId: keyId, projectId }))));
}

async function replaceKvEntries(keyId: string, kvEntryIds: string[]) {
  const db = getDb();
  await qrun(db.delete(apiKeyKvEntries).where(eq(apiKeyKvEntries.apiKeyId, keyId)));
  if (kvEntryIds.length === 0) return;
  await qrun(db.insert(apiKeyKvEntries).values(kvEntryIds.map((kvEntryId) => ({ apiKeyId: keyId, kvEntryId }))));
}

export function canAccessDatatable(apiKey: ApiKeyContext, projectId: string): boolean {
  return apiKey.datatablesUnrestricted || apiKey.datatableProjectIds.includes(projectId);
}

export function canAccessKvEntry(apiKey: ApiKeyContext, entryId: string): boolean {
  return apiKey.kvUnrestricted || apiKey.kvEntryIds.includes(entryId);
}

export async function listApiKeys(): Promise<{ items: ApiKeyMeta[]; total: number }> {
  const rows = await qall(getDb().select().from(apiKeys).where(inWorkspace(apiKeys.workspaceId)));
  const items = [];
  for (const row of rows) {
    items.push(toMeta(row, await loadScope(row.id)));
  }
  return { items, total: items.length };
}

export async function createApiKey(body: ApiKeyWriteBody & { name: string; createdBy: string }): Promise<ApiKeyMeta & { key: string }> {
  const name = body.name?.trim() ?? "";
  if (!name) throw new BadRequestException("name is required");
  const datatableProjectIds = await assertExistingIds(body.datatableProjectIds ?? [], datatableProjects, "datatable projects");
  const kvEntryIds = await assertExistingIds(body.kvEntryIds ?? [], kvStore, "KV entries");
  const datatablesUnrestricted = Boolean(body.datatablesUnrestricted);
  const kvUnrestricted = Boolean(body.kvUnrestricted);

  const raw = generateRawKey();
  const now = new Date();
  const row = {
    workspaceId: currentWorkspaceId(),
    id: crypto.randomUUID(),
    name,
    keyPrefix: raw.slice(0, KEY_PREFIX_LEN),
    keyHash: hashApiKey(raw),
    createdBy: body.createdBy,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
    datatablesUnrestricted,
    kvUnrestricted,
  };
  await qrun(getDb().insert(apiKeys).values(row));
  await replaceDatatableProjects(row.id, datatableProjectIds);
  await replaceKvEntries(row.id, kvEntryIds);
  return { ...toMeta(row, { datatableProjectIds, kvEntryIds }), key: raw };
}

export async function updateApiKey(id: string, body: ApiKeyWriteBody): Promise<ApiKeyMeta> {
  const existing = await qone(
    getDb()
      .select()
      .from(apiKeys)
      .where(and(inWorkspace(apiKeys.workspaceId), eq(apiKeys.id, id))),
  );
  if (!existing) throw new BadRequestException("API key not found");

  const name = body.name !== undefined ? body.name.trim() : existing.name;
  if (!name) throw new BadRequestException("name is required");

  const patch: { name?: string; datatablesUnrestricted?: boolean; kvUnrestricted?: boolean } = {};
  if (body.name !== undefined) patch.name = name;
  if (body.datatablesUnrestricted !== undefined) patch.datatablesUnrestricted = Boolean(body.datatablesUnrestricted);
  if (body.kvUnrestricted !== undefined) patch.kvUnrestricted = Boolean(body.kvUnrestricted);
  if (Object.keys(patch).length > 0) {
    await qrun(
      getDb()
        .update(apiKeys)
        .set(patch)
        .where(and(inWorkspace(apiKeys.workspaceId), eq(apiKeys.id, id))),
    );
  }

  let datatableProjectIds = await loadDatatableProjectIds(id);
  if (body.datatableProjectIds !== undefined) {
    datatableProjectIds = await assertExistingIds(body.datatableProjectIds, datatableProjects, "datatable projects");
    await replaceDatatableProjects(id, datatableProjectIds);
  }
  let kvEntryIds = await loadKvEntryIds(id);
  if (body.kvEntryIds !== undefined) {
    kvEntryIds = await assertExistingIds(body.kvEntryIds, kvStore, "KV entries");
    await replaceKvEntries(id, kvEntryIds);
  }

  const updated = (await qone(
    getDb()
      .select()
      .from(apiKeys)
      .where(and(inWorkspace(apiKeys.workspaceId), eq(apiKeys.id, id))),
  )) ?? { ...existing, name };
  return toMeta(updated, { datatableProjectIds, kvEntryIds });
}

export async function revokeApiKey(id: string): Promise<ApiKeyMeta> {
  const existing = await qone(
    getDb()
      .select()
      .from(apiKeys)
      .where(and(inWorkspace(apiKeys.workspaceId), eq(apiKeys.id, id))),
  );
  if (!existing) throw new BadRequestException("API key not found");
  if (!existing.revokedAt) {
    await qrun(
      getDb()
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(inWorkspace(apiKeys.workspaceId), eq(apiKeys.id, id))),
    );
  }
  const updated =
    (await qone(
      getDb()
        .select()
        .from(apiKeys)
        .where(and(inWorkspace(apiKeys.workspaceId), eq(apiKeys.id, id))),
    )) ?? existing;
  return toMeta(updated, await loadScope(id));
}

export async function deleteApiKey(id: string) {
  const existing = await qone(
    getDb()
      .select()
      .from(apiKeys)
      .where(and(inWorkspace(apiKeys.workspaceId), eq(apiKeys.id, id))),
  );
  if (!existing) throw new BadRequestException("API key not found");
  await qrun(
    getDb()
      .delete(apiKeys)
      .where(and(inWorkspace(apiKeys.workspaceId), eq(apiKeys.id, id))),
  );
}

export async function authenticateApiKey(raw: string): Promise<ApiKeyContext | null> {
  if (!raw) return null;
  const row = await qone(
    getDb()
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hashApiKey(raw))),
  );
  if (!row || row.revokedAt) return null;
  await qrun(
    getDb()
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id)),
  );
  return await toContext(row);
}
