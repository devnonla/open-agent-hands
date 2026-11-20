import { rmSync } from "node:fs";
import { asc, eq, inArray } from "drizzle-orm";
import { DEFAULT_WORKSPACE_ID, agentTools, apiKeys, datatableProjects, getDb, jobs, kvStore, myMcpServers, secrets, sites, toolFolders, workspaces } from "../../common/db/client.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException, NotFoundException } from "../../common/exceptions/http.exception.js";
import { wsHub } from "../../common/ws/wsHub.js";
import { workspaceDir } from "../../common/workspace/workspace-paths.js";

export type WorkspaceItem = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toItem(row: typeof workspaces.$inferSelect): WorkspaceItem {
  return { ...row, isDefault: row.id === DEFAULT_WORKSPACE_ID };
}

function cleanName(name: unknown): string {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) throw new BadRequestException("Workspace name is required");
  if (value.length > 80) throw new BadRequestException("Workspace name is too long");
  return value;
}

function cleanDescription(description: unknown): string | null {
  if (typeof description !== "string") return null;
  const value = description.trim();
  return value ? value : null;
}

export async function listWorkspaces(): Promise<WorkspaceItem[]> {
  const rows = await qall(getDb().select().from(workspaces).orderBy(asc(workspaces.createdAt), asc(workspaces.name)));
  return rows.map(toItem).sort((x, y) => Number(y.isDefault) - Number(x.isDefault));
}

export async function getWorkspace(id: string): Promise<WorkspaceItem | null> {
  const row = await qone(getDb().select().from(workspaces).where(eq(workspaces.id, id)));
  return row ? toItem(row) : null;
}

export async function workspaceExists(id: string): Promise<boolean> {
  return !!(await qone(getDb().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, id))));
}

export async function createWorkspace(body: { name?: unknown; description?: unknown }): Promise<WorkspaceItem> {
  const now = new Date();
  const row = { id: crypto.randomUUID(), name: cleanName(body.name), description: cleanDescription(body.description), createdAt: now, updatedAt: now };
  await qrun(getDb().insert(workspaces).values(row));
  const item = toItem(row);
  wsHub.emit("workspaces:created", item);
  return item;
}

export async function updateWorkspace(id: string, body: { name?: unknown; description?: unknown }): Promise<WorkspaceItem> {
  const existing = await getWorkspace(id);
  if (!existing) throw new NotFoundException("Workspace not found");
  const patch: { name?: string; description?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (body.name !== undefined) patch.name = cleanName(body.name);
  if (body.description !== undefined) patch.description = cleanDescription(body.description);
  await qrun(getDb().update(workspaces).set(patch).where(eq(workspaces.id, id)));
  const updated = await getWorkspace(id);
  if (!updated) throw new NotFoundException("Workspace not found");
  wsHub.emit("workspaces:updated", updated);
  return updated;
}

export async function deleteWorkspace(id: string): Promise<void> {
  if (id === DEFAULT_WORKSPACE_ID) throw new BadRequestException("The default workspace cannot be deleted");
  if (!(await workspaceExists(id))) throw new NotFoundException("Workspace not found");
  const db = getDb();
  const siteIds = (await qall(db.select({ id: sites.id }).from(sites).where(eq(sites.workspaceId, id)))).map((row) => row.id);
  await qrun(db.delete(myMcpServers).where(eq(myMcpServers.workspaceId, id)));
  await qrun(db.delete(agentTools).where(eq(agentTools.workspaceId, id)));
  await qrun(db.delete(toolFolders).where(eq(toolFolders.workspaceId, id)));
  await qrun(db.delete(apiKeys).where(eq(apiKeys.workspaceId, id)));
  await qrun(db.delete(kvStore).where(eq(kvStore.workspaceId, id)));
  await qrun(db.delete(secrets).where(eq(secrets.workspaceId, id)));
  await qrun(db.delete(datatableProjects).where(eq(datatableProjects.workspaceId, id)));
  await qrun(db.delete(jobs).where(eq(jobs.workspaceId, id)));
  if (siteIds.length > 0) await qrun(db.delete(sites).where(inArray(sites.id, siteIds)));
  await qrun(db.delete(workspaces).where(eq(workspaces.id, id)));
  rmSync(workspaceDir(id), { recursive: true, force: true });
  wsHub.emit("workspaces:deleted", { id });
}
