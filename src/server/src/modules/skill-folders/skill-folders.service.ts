import { eq } from "drizzle-orm";
import { type NewSkillFolder, getDb, skillFolders, skills } from "../../common/db/client.js";
import { type RawQuery, listQuery } from "../../common/db/list-query.util.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException } from "../../common/exceptions/http.exception.js";
import { wsHub } from "../../common/ws/wsHub.js";
import { BUILTIN_SKILL_FOLDER_ID } from "../nonla-bot/builtin-ids.js";

function assertFolderWritable(id: string) {
  if (id === BUILTIN_SKILL_FOLDER_ID) throw new BadRequestException("Builtin skills are in the Builtin folder");
}

async function attachSkillIds<T extends { id: string }>(folders: T[]) {
  const skillRows = await qall(getDb().select({ id: skills.id, folderId: skills.folderId }).from(skills));
  return folders.map((folder) => ({
    ...folder,
    skillIds: skillRows.filter((skill) => skill.folderId === folder.id).map((skill) => skill.id),
  }));
}

function sortFoldersByOrder<T extends { sortOrder: number; name: string }>(folders: T[]) {
  return [...folders].sort((a, b) => {
    const byOrder = a.sortOrder - b.sortOrder;
    if (byOrder !== 0) return byOrder;
    return a.name.localeCompare(b.name);
  });
}

export async function listSkillFolders(query: RawQuery = {}) {
  const result = await listQuery({ table: skillFolders }, query);
  const items = sortFoldersByOrder(await attachSkillIds(result.items as Array<(typeof result.items)[number] & { sortOrder: number; name: string }>));
  return { ...result, items };
}

export async function createSkillFolder(body: { name: string; description?: string }) {
  const name = body.name?.trim() ?? "";
  if (!name) throw new BadRequestException("Folder name is required");

  const db = getDb();
  const existing = await qall(db.select({ sortOrder: skillFolders.sortOrder }).from(skillFolders));
  const nextOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;

  const folder: NewSkillFolder = {
    id: crypto.randomUUID(),
    name,
    description: body.description?.trim() ? body.description.trim() : null,
    sortOrder: nextOrder,
    isActive: true,
    createdAt: new Date(),
  };
  await qrun(db.insert(skillFolders).values(folder));
  const payload = { ...folder, skillIds: [] as string[] };
  wsHub.emit("skill-folders:created", payload);
  return payload;
}

export async function updateSkillFolder(id: string, body: Partial<Pick<NewSkillFolder, "name" | "description">>) {
  assertFolderWritable(id);
  const patch: Partial<Pick<NewSkillFolder, "name" | "description">> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new BadRequestException("Folder name is required");
    patch.name = name;
  }
  if (body.description !== undefined) {
    patch.description = body.description?.trim() ? body.description.trim() : null;
  }
  await qrun(getDb().update(skillFolders).set(patch).where(eq(skillFolders.id, id)));
  const updated = await qone(getDb().select().from(skillFolders).where(eq(skillFolders.id, id)));
  if (!updated) throw new BadRequestException("Folder not found");
  wsHub.emit("skill-folders:updated", updated);
  return updated;
}

export async function reorderSkillFolders(folderIds: string[]) {
  const db = getDb();
  const ids = folderIds.filter((id) => id !== BUILTIN_SKILL_FOLDER_ID);
  for (let i = 0; i < ids.length; i++) {
    await qrun(db.update(skillFolders).set({ sortOrder: i }).where(eq(skillFolders.id, ids[i])));
  }
  wsHub.emit("skill-folders:reordered", { folderIds });
  return { folderIds };
}

export async function deleteSkillFolder(id: string) {
  assertFolderWritable(id);
  await qrun(getDb().delete(skillFolders).where(eq(skillFolders.id, id)));
  wsHub.emit("skill-folders:deleted", { id });
}
