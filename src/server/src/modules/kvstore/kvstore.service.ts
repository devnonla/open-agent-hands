import { and, count, eq, type SQL } from "drizzle-orm";
import { type KvProject, type NewKvStoreEntry, getDb, kvProjects, kvStore } from "../../common/db/client.js";
import { type RawQuery, listQuery } from "../../common/db/list-query.util.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException, NotFoundException } from "../../common/exceptions/http.exception.js";
import { wsHub } from "../../common/ws/wsHub.js";

const KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const DEFAULT_KV_PROJECT = "default";

export function assertKey(key: string) {
  if (!KEY_RE.test(key)) {
    throw new BadRequestException("Key must match [A-Z][A-Z0-9_]* (e.g. BASE_URL)");
  }
}

function assertProjectName(name: string): string {
  const value = name.trim();
  if (!PROJECT_NAME_RE.test(value)) throw new BadRequestException("Project name must be lowercase letters, digits, - or _ (e.g. crm, daily-report), up to 64 characters");
  return value;
}

function inProject(projectId: string): SQL {
  return eq(kvStore.projectId, projectId);
}

/** Id of the "default" project, created when missing. Code that names no project uses it. */
export async function defaultKvProjectId(): Promise<string> {
  const db = getDb();
  const row = await qone(db.select({ id: kvProjects.id }).from(kvProjects).where(eq(kvProjects.name, DEFAULT_KV_PROJECT)));
  if (row) return row.id;
  const now = new Date();
  await qrun(db.insert(kvProjects).values({ id: DEFAULT_KV_PROJECT, name: DEFAULT_KV_PROJECT, description: null, createdAt: now, updatedAt: now }).onConflictDoNothing());
  return DEFAULT_KV_PROJECT;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export type KvProjectWithCount = KvProject & { keyCount: number };

export async function listKvProjects(): Promise<{ items: KvProjectWithCount[] }> {
  const db = getDb();
  await defaultKvProjectId();
  const projects = await qall(db.select().from(kvProjects).orderBy(kvProjects.name));
  const counts = await qall(db.select({ projectId: kvStore.projectId, n: count() }).from(kvStore).groupBy(kvStore.projectId));
  const byProject = new Map(counts.map((row) => [row.projectId, Number(row.n)]));
  const items = projects.map((project) => ({ ...project, keyCount: byProject.get(project.id) ?? 0 }));
  items.sort((a, b) => Number(b.name === DEFAULT_KV_PROJECT) - Number(a.name === DEFAULT_KV_PROJECT) || a.name.localeCompare(b.name));
  return { items };
}

export async function getKvProject(id: string): Promise<KvProject | null> {
  return (await qone(getDb().select().from(kvProjects).where(eq(kvProjects.id, id)))) ?? null;
}

export async function resolveKvProject(ref: string): Promise<KvProject | null> {
  const value = ref.trim();
  if (!value) return null;
  return (await getKvProject(value)) ?? (await qone(getDb().select().from(kvProjects).where(eq(kvProjects.name, value.toLowerCase())))) ?? null;
}

/** Project id for a ref. Empty means the default project. Throws when the project does not exist. */
export async function requireKvProjectId(ref: string | null | undefined): Promise<string> {
  const value = ref?.trim() ?? "";
  if (!value) return await defaultKvProjectId();
  const project = await resolveKvProject(value);
  if (!project) throw new NotFoundException(`KV project "${value}" not found. Call kv_list_projects to see the projects, or kv_set with this project to create it.`);
  return project.id;
}

/** Like requireKvProjectId, but creates the project when it does not exist yet. */
export async function ensureKvProjectId(ref: string | null | undefined): Promise<string> {
  const value = ref?.trim() ?? "";
  if (!value) return await defaultKvProjectId();
  const existing = await resolveKvProject(value);
  if (existing) return existing.id;
  return (await createKvProject({ name: value })).id;
}

export async function createKvProject(body: { name: string; description?: string | null }): Promise<KvProjectWithCount> {
  const name = assertProjectName(body.name ?? "");
  if (await resolveKvProject(name)) throw new BadRequestException(`KV project "${name}" already exists`);
  const now = new Date();
  const project: KvProject = { id: crypto.randomUUID(), name, description: body.description?.trim() || null, createdAt: now, updatedAt: now };
  await qrun(getDb().insert(kvProjects).values(project));
  const result = { ...project, keyCount: 0 };
  wsHub.emit("kvprojects:created", result);
  return result;
}

export async function updateKvProject(id: string, body: { name?: string; description?: string | null }): Promise<KvProject> {
  const current = await getKvProject(id);
  if (!current) throw new NotFoundException("KV project not found");
  if (current.name === DEFAULT_KV_PROJECT) throw new BadRequestException("The default project cannot be changed");
  const name = body.name !== undefined ? assertProjectName(body.name) : current.name;
  if (name !== current.name) {
    const clash = await qone(getDb().select().from(kvProjects).where(eq(kvProjects.name, name)));
    if (clash) throw new BadRequestException(`KV project "${name}" already exists`);
  }
  await qrun(
    getDb()
      .update(kvProjects)
      .set({ name, description: body.description !== undefined ? body.description?.trim() || null : current.description, updatedAt: new Date() })
      .where(eq(kvProjects.id, id)),
  );
  const updated = (await getKvProject(id)) as KvProject;
  wsHub.emit("kvprojects:updated", updated);
  return updated;
}

export async function deleteKvProject(id: string): Promise<{ deletedKeys: number }> {
  const current = await getKvProject(id);
  if (!current) throw new NotFoundException("KV project not found");
  if (current.name === DEFAULT_KV_PROJECT) throw new BadRequestException("The default project cannot be deleted");
  const keys = await qall(getDb().select({ id: kvStore.id }).from(kvStore).where(eq(kvStore.projectId, id)));
  await qrun(getDb().delete(kvStore).where(eq(kvStore.projectId, id)));
  await qrun(getDb().delete(kvProjects).where(eq(kvProjects.id, id)));
  wsHub.emit("kvprojects:deleted", { id });
  return { deletedKeys: keys.length };
}

// ─── Entries ──────────────────────────────────────────────────────────────────

/** `project` in the query: omitted lists every key, otherwise a project id or name. */
export async function listKvEntries(query: RawQuery = {}) {
  const { project, ...rest } = query;
  let where: SQL | undefined;
  if (project !== undefined && project !== "") {
    const projectId = (await resolveKvProject(project))?.id;
    if (!projectId) return { items: [], total: 0, page: 1, limit: 0, totalPages: 0 };
    where = inProject(projectId);
  }
  return await listQuery({ table: kvStore, where, searchColumns: ["key", "value", "description"] }, rest);
}

export async function getKvEntry(id: string) {
  return (await qone(getDb().select().from(kvStore).where(eq(kvStore.id, id)))) ?? null;
}

export async function getKvByKey(key: string, projectId: string) {
  return (await qone(getDb().select().from(kvStore).where(and(eq(kvStore.key, key), inProject(projectId))))) ?? null;
}

export async function upsertKvByKey(body: { key: string; value: string; projectId: string }) {
  const key = body.key?.trim() ?? "";
  assertKey(key);
  if (typeof body.value !== "string") {
    throw new BadRequestException("value is required");
  }
  const projectId = body.projectId;
  const existing = await getKvByKey(key, projectId);
  if (existing) {
    return await updateKvEntry(existing.id, { value: body.value });
  }
  return await createKvEntry({ key, value: body.value, projectId });
}

export async function deleteKvByKey(key: string, projectId: string) {
  const existing = await getKvByKey(key, projectId);
  if (!existing) throw new BadRequestException(`Key "${key}" not found`);
  await deleteKvEntry(existing.id);
  return { key };
}

export async function createKvEntry(body: { key: string; value: string; description?: string | null; projectId?: string | null }) {
  const key = body.key?.trim() ?? "";
  assertKey(key);
  if (typeof body.value !== "string") {
    throw new BadRequestException("value is required");
  }
  const projectId = body.projectId ?? (await defaultKvProjectId());
  if (!(await getKvProject(projectId))) throw new NotFoundException("KV project not found");
  if (await getKvByKey(key, projectId)) throw new BadRequestException(`Key "${key}" already exists`);

  const now = new Date();
  const entry: NewKvStoreEntry = {
    id: crypto.randomUUID(),
    projectId,
    key,
    value: body.value,
    description: body.description?.trim() || null,
    createdAt: now,
    updatedAt: now,
  };
  await qrun(getDb().insert(kvStore).values(entry));
  wsHub.emit("kvstore:created", entry);
  return entry;
}

export async function updateKvEntry(id: string, body: { key?: string; value?: string; description?: string | null }) {
  const current = await getKvEntry(id);
  if (!current) throw new BadRequestException("KV entry not found");

  const nextKey = body.key !== undefined ? body.key.trim() : current.key;
  assertKey(nextKey);

  if (nextKey !== current.key && (await getKvByKey(nextKey, current.projectId))) {
    throw new BadRequestException(`Key "${nextKey}" already exists`);
  }

  await qrun(
    getDb()
      .update(kvStore)
      .set({
        key: nextKey,
        value: body.value !== undefined ? body.value : current.value,
        description: body.description !== undefined ? body.description?.trim() || null : current.description,
        updatedAt: new Date(),
      })
      .where(eq(kvStore.id, id)),
  );

  const updated = await getKvEntry(id);
  wsHub.emit("kvstore:updated", updated);
  return updated;
}

export async function deleteKvEntry(id: string) {
  const current = await getKvEntry(id);
  if (!current) throw new BadRequestException("KV entry not found");
  await qrun(getDb().delete(kvStore).where(eq(kvStore.id, id)));
  wsHub.emit("kvstore:deleted", { id });
}

export async function loadKvMap(projectId?: string): Promise<Record<string, string>> {
  const rows = await qall(getDb().select({ key: kvStore.key, value: kvStore.value }).from(kvStore).where(inProject(projectId ?? (await defaultKvProjectId()))));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
