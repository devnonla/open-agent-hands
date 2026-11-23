import { mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { rename, rm } from "node:fs/promises";
import { and, asc, count, eq, like, sum } from "drizzle-orm";
import { type StorageSpace, type StorageFile, executeRaw, getDb, storageSpaces, storageFiles } from "../../common/db/client.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException, NotFoundException } from "../../common/exceptions/http.exception.js";
import { storageSpaceDir, storageFilePath } from "../../common/utils/data-paths.js";
import { wsHub } from "../../common/ws/wsHub.js";

const SPACE_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export const FILE_KINDS = ["images", "documents", "data", "media", "other"] as const;
export type FileKindName = (typeof FILE_KINDS)[number];

export type SpaceInsights = { folderCount: number; lastFileAt: Date | null; bytesByKind: Record<FileKindName, number> };

export type SpaceSummary = StorageSpace & { fileCount: number; totalBytes: number } & Partial<SpaceInsights>;

export type PublicStorageFile = Omit<StorageFile, "publicToken"> & { space: string; publicUrl: string | null };

function assertSpaceName(name: string): string {
  const value = name.trim();
  if (!SPACE_NAME_RE.test(value)) throw new BadRequestException("Space name must be 2-63 lowercase letters, digits or - and start with a letter or digit (e.g. reports, user-uploads)");
  return value;
}

export function normalizeKey(key: string): string {
  const value = key.trim().replace(/^\/+/, "");
  if (!value) throw new BadRequestException("key is required (e.g. reports/2026-11.pdf)");
  if (value.length > 1024) throw new BadRequestException("key is longer than 1024 characters");
  if (value.includes("\0") || value.includes("\\")) throw new BadRequestException("key must not contain NUL or backslash");
  if (value.split("/").some((part) => part === "" || part === "." || part === "..")) throw new BadRequestException('key must not contain empty, "." or ".." segments');
  return value;
}

export function guessContentType(key: string): string {
  const type = Bun.file(key).type;
  return type || DEFAULT_CONTENT_TYPE;
}

export function isTextContentType(type: string): boolean {
  const base = type.split(";")[0].trim().toLowerCase();
  return base.startsWith("text/") || /\/(json|xml|javascript|typescript|x-yaml|yaml|csv|sql|x-sh|svg\+xml)$/.test(base) || base.endsWith("+json") || base.endsWith("+xml");
}

export function newPublicToken(): string {
  return randomBytes(24).toString("base64url");
}

export function publicFileUrl(file: Pick<StorageFile, "key" | "publicToken">): string {
  return `/public/storage/${file.publicToken}/${encodeURIComponent(file.key.split("/").pop() || "file")}`;
}

function toPublic(file: StorageFile, space: StorageSpace): PublicStorageFile {
  const { publicToken: _token, ...rest } = file;
  return { ...rest, space: space.name, publicUrl: space.isPublic ? publicFileUrl(file) : null };
}

// ─── Spaces ──────────────────────────────────────────────────────────────────

async function spaceStats(spaceId?: string) {
  const query = getDb().select({ spaceId: storageFiles.spaceId, n: count(), bytes: sum(storageFiles.size) }).from(storageFiles);
  const rows = await qall((spaceId ? query.where(eq(storageFiles.spaceId, spaceId)) : query).groupBy(storageFiles.spaceId));
  return new Map(rows.map((row) => [row.spaceId, { fileCount: Number(row.n), totalBytes: Number(row.bytes ?? 0) }]));
}

async function summarize(space: StorageSpace): Promise<SpaceSummary> {
  const stats = (await spaceStats(space.id)).get(space.id);
  return { ...space, fileCount: stats?.fileCount ?? 0, totalBytes: stats?.totalBytes ?? 0 };
}

const KIND_SQL = `CASE
  WHEN content_type LIKE 'image/%' THEN 'images'
  WHEN content_type LIKE 'video/%' OR content_type LIKE 'audio/%' THEN 'media'
  WHEN content_type LIKE '%json%' OR content_type LIKE '%csv%' OR content_type LIKE '%xml%' OR content_type LIKE '%yaml%' OR content_type LIKE '%sheet%' OR content_type LIKE '%excel%' OR content_type LIKE '%sql%' THEN 'data'
  WHEN content_type LIKE 'text/%' OR content_type LIKE 'application/pdf%' OR content_type LIKE '%word%' OR content_type LIKE '%presentation%' THEN 'documents'
  ELSE 'other' END`;

function emptyKinds(): Record<FileKindName, number> {
  return { images: 0, documents: 0, data: 0, media: 0, other: 0 };
}

async function spaceInsights(): Promise<Map<string, SpaceInsights>> {
  const kinds = await executeRaw<{ space_id: string; kind: FileKindName; bytes: number }>(`SELECT space_id, ${KIND_SQL} AS kind, SUM(size) AS bytes FROM storage_files GROUP BY space_id, kind`);
  const meta = await executeRaw<{ space_id: string; folders: number; last_at: number | null }>(
    "SELECT space_id, COUNT(DISTINCT CASE WHEN instr(key, '/') > 0 THEN substr(key, 1, instr(key, '/')) END) AS folders, MAX(updated_at) AS last_at FROM storage_files GROUP BY space_id",
  );
  const map = new Map<string, SpaceInsights>();
  for (const row of meta) map.set(row.space_id, { folderCount: Number(row.folders ?? 0), lastFileAt: row.last_at ? new Date(Number(row.last_at) * 1000) : null, bytesByKind: emptyKinds() });
  for (const row of kinds) {
    const entry = map.get(row.space_id);
    if (entry) entry.bytesByKind[row.kind] = Number(row.bytes ?? 0);
  }
  return map;
}

export async function listSpaces(): Promise<{ items: SpaceSummary[] }> {
  const spaces = await qall(getDb().select().from(storageSpaces).orderBy(asc(storageSpaces.name)));
  const stats = await spaceStats();
  const insights = await spaceInsights();
  return {
    items: spaces.map((space) => ({
      ...space,
      fileCount: stats.get(space.id)?.fileCount ?? 0,
      totalBytes: stats.get(space.id)?.totalBytes ?? 0,
      ...(insights.get(space.id) ?? { folderCount: 0, lastFileAt: null, bytesByKind: emptyKinds() }),
    })),
  };
}

export async function getSpace(id: string): Promise<StorageSpace | null> {
  return (await qone(getDb().select().from(storageSpaces).where(eq(storageSpaces.id, id)))) ?? null;
}

export async function resolveSpace(ref: string): Promise<StorageSpace | null> {
  const value = ref.trim();
  if (!value) return null;
  return (await getSpace(value)) ?? (await qone(getDb().select().from(storageSpaces).where(eq(storageSpaces.name, value.toLowerCase())))) ?? null;
}

export async function requireSpace(ref: string): Promise<StorageSpace> {
  const space = await resolveSpace(ref);
  if (!space) throw new NotFoundException(`Space "${ref.trim()}" not found. Call storage_list_spaces to see the spaces, or storage_create_space to create it.`);
  return space;
}

export async function ensureSpace(ref: string): Promise<StorageSpace> {
  return (await resolveSpace(ref)) ?? (await createSpace({ name: ref }));
}

export async function createSpace(body: { name: string; description?: string | null; isPublic?: boolean }): Promise<SpaceSummary> {
  const name = assertSpaceName(body.name ?? "");
  if (await resolveSpace(name)) throw new BadRequestException(`Space "${name}" already exists`);
  const now = new Date();
  const space: StorageSpace = { id: crypto.randomUUID(), name, description: body.description?.trim() || null, isPublic: body.isPublic === true, createdAt: now, updatedAt: now };
  await qrun(getDb().insert(storageSpaces).values(space));
  const result = { ...space, fileCount: 0, totalBytes: 0 };
  wsHub.emit("storage:space-created", result);
  return result;
}

export async function updateSpace(id: string, body: { description?: string | null; isPublic?: boolean }): Promise<SpaceSummary> {
  const current = await getSpace(id);
  if (!current) throw new NotFoundException("Space not found");
  await qrun(
    getDb()
      .update(storageSpaces)
      .set({
        description: body.description !== undefined ? body.description?.trim() || null : current.description,
        isPublic: typeof body.isPublic === "boolean" ? body.isPublic : current.isPublic,
        updatedAt: new Date(),
      })
      .where(eq(storageSpaces.id, id)),
  );
  const updated = await summarize((await getSpace(id)) as StorageSpace);
  wsHub.emit("storage:space-updated", updated);
  return updated;
}

export async function deleteSpace(id: string): Promise<{ deletedObjects: number }> {
  const current = await getSpace(id);
  if (!current) throw new NotFoundException("Space not found");
  const stats = (await spaceStats(id)).get(id);
  await qrun(getDb().delete(storageFiles).where(eq(storageFiles.spaceId, id)));
  await qrun(getDb().delete(storageSpaces).where(eq(storageSpaces.id, id)));
  rmSync(storageSpaceDir(id), { recursive: true, force: true });
  wsHub.emit("storage:space-deleted", { id });
  return { deletedObjects: stats?.fileCount ?? 0 };
}

// ─── Objects ──────────────────────────────────────────────────────────────────

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listFiles(space: StorageSpace, opts: { prefix?: string; limit?: number; offset?: number } = {}): Promise<{ items: PublicStorageFile[]; total: number }> {
  const prefix = opts.prefix?.trim().replace(/^\/+/, "") ?? "";
  const where = prefix ? and(eq(storageFiles.spaceId, space.id), like(storageFiles.key, `${escapeLike(prefix)}%`)) : eq(storageFiles.spaceId, space.id);
  const limit = Math.min(Math.max(1, opts.limit ?? 1000), 1000);
  const offset = Math.max(0, opts.offset ?? 0);
  const totalRow = await qone(getDb().select({ n: count() }).from(storageFiles).where(where));
  const rows = await qall(getDb().select().from(storageFiles).where(where).orderBy(asc(storageFiles.key)).limit(limit).offset(offset));
  return { items: rows.map((row) => toPublic(row, space)), total: Number(totalRow?.n ?? 0) };
}

export type StorageFolder = { prefix: string; fileCount: number; totalBytes: number; updatedAt: Date };

export async function browseFiles(space: StorageSpace, rawPrefix = ""): Promise<{ prefix: string; folders: StorageFolder[]; items: PublicStorageFile[] }> {
  const trimmed = rawPrefix.trim().replace(/^\/+/, "");
  const prefix = trimmed && !trimmed.endsWith("/") ? `${trimmed}/` : trimmed;
  const where = prefix ? and(eq(storageFiles.spaceId, space.id), like(storageFiles.key, `${escapeLike(prefix)}%`)) : eq(storageFiles.spaceId, space.id);
  const rows = await qall(getDb().select().from(storageFiles).where(where).orderBy(asc(storageFiles.key)));
  const folders = new Map<string, StorageFolder>();
  const items: PublicStorageFile[] = [];
  for (const row of rows) {
    const rest = row.key.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      items.push(toPublic(row, space));
      continue;
    }
    const folderPrefix = `${prefix}${rest.slice(0, slash + 1)}`;
    const folder = folders.get(folderPrefix) ?? { prefix: folderPrefix, fileCount: 0, totalBytes: 0, updatedAt: row.updatedAt };
    folder.fileCount += 1;
    folder.totalBytes += row.size;
    if (row.updatedAt > folder.updatedAt) folder.updatedAt = row.updatedAt;
    folders.set(folderPrefix, folder);
  }
  return { prefix, folders: [...folders.values()], items };
}

export async function getFile(id: string): Promise<StorageFile | null> {
  return (await qone(getDb().select().from(storageFiles).where(eq(storageFiles.id, id)))) ?? null;
}

export async function getFileByKey(spaceId: string, key: string): Promise<StorageFile | null> {
  return (await qone(getDb().select().from(storageFiles).where(and(eq(storageFiles.spaceId, spaceId), eq(storageFiles.key, key))))) ?? null;
}

export async function requireFile(space: StorageSpace, key: string): Promise<StorageFile> {
  const normalized = normalizeKey(key);
  const file = await getFileByKey(space.id, normalized);
  if (!file) throw new NotFoundException(`File "${normalized}" not found in space "${space.name}". Call storage_list_files to see the keys.`);
  return file;
}

export function fileBlob(file: StorageFile) {
  return Bun.file(storageFilePath(file.spaceId, file.id));
}

export async function readFileBytes(file: StorageFile): Promise<Uint8Array> {
  return new Uint8Array(await fileBlob(file).arrayBuffer());
}

export type StorageData = Uint8Array | Blob | ReadableStream<Uint8Array>;

export type WrittenFile = { size: number; md5: string; sha256: string | null };

export function md5Hex(data: Uint8Array | ArrayBuffer): string {
  return new Bun.CryptoHasher("md5").update(data).digest("hex");
}

function toStream(data: Blob | ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return data instanceof Blob ? data.stream() : data;
}

/** Streams data to a file while hashing it, so files of any size never sit in memory. */
export async function writeStreamToFile(path: string, data: StorageData, opts: { sha256?: boolean } = {}): Promise<WrittenFile> {
  const md5 = new Bun.CryptoHasher("md5");
  const sha = opts.sha256 ? new Bun.CryptoHasher("sha256") : null;
  if (data instanceof Uint8Array) {
    await Bun.write(path, data);
    md5.update(data);
    sha?.update(data);
    return { size: data.byteLength, md5: md5.digest("hex"), sha256: sha ? sha.digest("hex") : null };
  }
  const sink = Bun.file(path).writer({ highWaterMark: 1024 * 1024 });
  let size = 0;
  try {
    for await (const chunk of toStream(data)) {
      md5.update(chunk);
      sha?.update(chunk);
      size += chunk.byteLength;
      sink.write(chunk);
    }
    await sink.end();
  } catch (err) {
    try {
      await sink.end();
    } catch {}
    await rm(path, { force: true });
    throw err;
  }
  return { size, md5: md5.digest("hex"), sha256: sha ? sha.digest("hex") : null };
}

export async function fileEtag(file: StorageFile): Promise<string> {
  if (file.etag) return file.etag;
  const hasher = new Bun.CryptoHasher("md5");
  for await (const chunk of fileBlob(file).stream()) hasher.update(chunk);
  const etag = hasher.digest("hex");
  await qrun(getDb().update(storageFiles).set({ etag }).where(eq(storageFiles.id, file.id)));
  return etag;
}

/** A temp path inside the space folder; rename it into place with commitFile. */
export function stagingPath(spaceId: string): string {
  mkdirSync(storageSpaceDir(spaceId), { recursive: true });
  return join(storageSpaceDir(spaceId), `.${crypto.randomUUID()}.tmp`);
}

export async function commitFile(space: StorageSpace, body: { key: string; tmpPath: string; size: number; etag: string; contentType?: string | null }): Promise<PublicStorageFile> {
  const key = normalizeKey(body.key);
  const contentType = body.contentType?.trim() || guessContentType(key);
  const existing = await getFileByKey(space.id, key);
  const id = existing?.id ?? crypto.randomUUID();
  await rename(body.tmpPath, storageFilePath(space.id, id));
  const now = new Date();
  if (existing) {
    await qrun(getDb().update(storageFiles).set({ size: body.size, contentType, etag: body.etag, updatedAt: now }).where(eq(storageFiles.id, id)));
  } else {
    await qrun(getDb().insert(storageFiles).values({ id, spaceId: space.id, key, size: body.size, contentType, etag: body.etag, publicToken: newPublicToken(), createdAt: now, updatedAt: now }));
  }
  const saved = toPublic((await getFile(id)) as StorageFile, space);
  wsHub.emit(existing ? "storage:file-updated" : "storage:file-created", saved);
  return saved;
}

export async function putFile(space: StorageSpace, body: { key: string; data: StorageData; contentType?: string | null }): Promise<PublicStorageFile> {
  const key = normalizeKey(body.key);
  const blobType = body.data instanceof Blob && body.data.type && body.data.type !== DEFAULT_CONTENT_TYPE ? body.data.type : null;
  const tmpPath = stagingPath(space.id);
  const written = await writeStreamToFile(tmpPath, body.data);
  try {
    return await commitFile(space, { key, tmpPath, size: written.size, etag: written.md5, contentType: body.contentType?.trim() || blobType });
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }
}

export async function deleteFile(file: StorageFile): Promise<void> {
  await qrun(getDb().delete(storageFiles).where(eq(storageFiles.id, file.id)));
  await rm(storageFilePath(file.spaceId, file.id), { force: true });
  wsHub.emit("storage:file-deleted", { id: file.id, spaceId: file.spaceId, key: file.key });
}

/** The file behind a public link, or null when the token is unknown or its space is private. */
export async function getPublicFile(token: string): Promise<StorageFile | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const file = await qone(getDb().select().from(storageFiles).where(eq(storageFiles.publicToken, token)));
  if (!file) return null;
  const space = await getSpace(file.spaceId);
  return space?.isPublic ? file : null;
}

/** Gives a file a new public link. The old link stops working at once. */
export async function resetPublicLink(file: StorageFile): Promise<PublicStorageFile> {
  await qrun(getDb().update(storageFiles).set({ publicToken: newPublicToken() }).where(eq(storageFiles.id, file.id)));
  const space = (await getSpace(file.spaceId)) as StorageSpace;
  const updated = toPublic((await getFile(file.id)) as StorageFile, space);
  wsHub.emit("storage:file-updated", updated);
  return updated;
}
