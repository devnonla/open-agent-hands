/**
 * my-mcp-servers.service.ts — CRUD for MCP servers we host (Cursor / Claude Code).
 */

import { and, eq, inArray } from "drizzle-orm";
import { agentTools, getDb, myMcpServerTools, myMcpServers, toolFolders } from "../../common/db/client.js";
import { type RawQuery, listQuery } from "../../common/db/list-query.util.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException, NotFoundException } from "../../common/exceptions/http.exception.js";
import { wsHub } from "../../common/ws/wsHub.js";

const KEY_PREFIX_LEN = 12;

export type MyMcpServerListItem = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  toolCount: number;
  tools: MyMcpServerToolInfo[];
  keyPrefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MyMcpServerToolInfo = {
  id: string;
  name: string;
  label: string;
  description: string;
  folderName: string | null;
  icon: string | null;
};

export type MyMcpServerDetail = MyMcpServerListItem;

export type MyMcpServerWriteBody = {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  toolIds?: string[];
};

function hashMcpKey(raw: string): string {
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex");
}

function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `ra_mcp_${hex}`;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
}

async function assertCustomToolIds(ids: string[]): Promise<string[]> {
  const unique = uniqueIds(ids);
  if (unique.length === 0) return [];
  for (const id of unique) {
    if (id.startsWith("builtin:") || id.startsWith("mcp:")) {
      throw new BadRequestException("Only custom tools can be assigned");
    }
  }
  const found = await qall(getDb().select({ id: agentTools.id }).from(agentTools).where(inArray(agentTools.id, unique)));
  if (found.length !== unique.length) {
    throw new BadRequestException("One or more tools were not found");
  }
  return unique;
}

async function replaceTools(serverId: string, toolIds: string[]) {
  const db = getDb();
  await qrun(db.delete(myMcpServerTools).where(eq(myMcpServerTools.serverId, serverId)));
  if (toolIds.length === 0) return;
  await qrun(db.insert(myMcpServerTools).values(toolIds.map((toolId) => ({ serverId, toolId }))));
}

function toListItem(row: typeof myMcpServers.$inferSelect, tools: MyMcpServerToolInfo[]): MyMcpServerListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    isActive: Boolean(row.isActive),
    toolCount: tools.length,
    tools,
    keyPrefix: row.keyPrefix,
    lastUsedAt: row.lastUsedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadAssignedTools(serverId: string): Promise<MyMcpServerToolInfo[]> {
  const map = await loadAssignedToolsMap([serverId]);
  return map.get(serverId) ?? [];
}

async function loadAssignedToolsMap(serverIds: string[]): Promise<Map<string, MyMcpServerToolInfo[]>> {
  const map = new Map<string, MyMcpServerToolInfo[]>();
  if (serverIds.length === 0) return map;
  const rows = await qall(
    getDb()
      .select({
        serverId: myMcpServerTools.serverId,
        id: agentTools.id,
        name: agentTools.name,
        label: agentTools.label,
        description: agentTools.description,
        folderName: toolFolders.name,
        icon: agentTools.icon,
      })
      .from(myMcpServerTools)
      .innerJoin(agentTools, eq(myMcpServerTools.toolId, agentTools.id))
      .leftJoin(toolFolders, eq(agentTools.folderId, toolFolders.id))
      .where(inArray(myMcpServerTools.serverId, serverIds)),
  );
  for (const { serverId, ...tool } of rows) {
    const list = map.get(serverId) ?? [];
    list.push(tool);
    map.set(serverId, list);
  }
  for (const list of map.values()) list.sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
  return map;
}

export async function listMyMcpServers(query: RawQuery = {}) {
  const result = await listQuery({ table: myMcpServers, searchColumns: ["name", "description"] }, query);
  const items = result.items as (typeof myMcpServers.$inferSelect)[];
  const toolsMap = await loadAssignedToolsMap(items.map((row) => row.id));
  return {
    ...result,
    items: items.map((row) => toListItem(row, toolsMap.get(row.id) ?? [])),
  };
}

export async function getMyMcpServer(id: string): Promise<MyMcpServerDetail> {
  const row = await qone(
    getDb()
      .select()
      .from(myMcpServers)
      .where(eq(myMcpServers.id, id)),
  );
  if (!row) throw new NotFoundException("MCP server not found");
  return toListItem(row, await loadAssignedTools(id));
}

export async function createMyMcpServer(body: MyMcpServerWriteBody): Promise<MyMcpServerListItem & { key: string }> {
  const name = body.name?.trim() ?? "";
  if (!name) throw new BadRequestException("name is required");
  const toolIds = await assertCustomToolIds(body.toolIds ?? []);
  const raw = generateRawKey();
  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    name,
    description: body.description?.trim() || null,
    isActive: body.isActive !== false,
    keyPrefix: raw.slice(0, KEY_PREFIX_LEN),
    keyHash: hashMcpKey(raw),
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await qrun(getDb().insert(myMcpServers).values(row));
  await replaceTools(row.id, toolIds);
  const item = toListItem(row, await loadAssignedTools(row.id));
  wsHub.emit("my-mcp-servers:created", item);
  return { ...item, key: raw };
}

export async function updateMyMcpServer(id: string, body: MyMcpServerWriteBody): Promise<MyMcpServerListItem> {
  const existing = await qone(
    getDb()
      .select()
      .from(myMcpServers)
      .where(eq(myMcpServers.id, id)),
  );
  if (!existing) throw new NotFoundException("MCP server not found");

  const patch: Partial<typeof myMcpServers.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new BadRequestException("name is required");
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = body.description?.trim() || null;
  if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);

  await qrun(
    getDb()
      .update(myMcpServers)
      .set(patch)
      .where(eq(myMcpServers.id, id)),
  );

  if (body.toolIds !== undefined) {
    await replaceTools(id, await assertCustomToolIds(body.toolIds));
  }

  const updated =
    (await qone(
      getDb()
        .select()
        .from(myMcpServers)
        .where(eq(myMcpServers.id, id)),
    )) ?? existing;
  const item = toListItem(updated, await loadAssignedTools(id));
  wsHub.emit("my-mcp-servers:updated", item);
  return item;
}

export async function rotateMyMcpServerKey(id: string): Promise<MyMcpServerListItem & { key: string }> {
  const existing = await qone(
    getDb()
      .select()
      .from(myMcpServers)
      .where(eq(myMcpServers.id, id)),
  );
  if (!existing) throw new NotFoundException("MCP server not found");
  const raw = generateRawKey();
  await qrun(
    getDb()
      .update(myMcpServers)
      .set({
        keyPrefix: raw.slice(0, KEY_PREFIX_LEN),
        keyHash: hashMcpKey(raw),
        updatedAt: new Date(),
      })
      .where(eq(myMcpServers.id, id)),
  );
  const updated =
    (await qone(
      getDb()
        .select()
        .from(myMcpServers)
        .where(eq(myMcpServers.id, id)),
    )) ?? existing;
  const item = toListItem(updated, await loadAssignedTools(id));
  wsHub.emit("my-mcp-servers:updated", item);
  return { ...item, key: raw };
}

export async function deleteMyMcpServer(id: string) {
  const existing = await qone(
    getDb()
      .select()
      .from(myMcpServers)
      .where(eq(myMcpServers.id, id)),
  );
  if (!existing) throw new NotFoundException("MCP server not found");
  await qrun(
    getDb()
      .delete(myMcpServers)
      .where(eq(myMcpServers.id, id)),
  );
  wsHub.emit("my-mcp-servers:deleted", { id });
}

export type AuthenticatedMyMcpServer = typeof myMcpServers.$inferSelect;

export async function authenticateMyMcpServer(id: string, rawKey: string): Promise<AuthenticatedMyMcpServer | "missing" | "unauthorized" | "inactive"> {
  const row = await qone(
    getDb()
      .select()
      .from(myMcpServers)
      .where(eq(myMcpServers.id, id)),
  );
  if (!row) return "missing";
  if (row.keyHash !== hashMcpKey(rawKey)) return "unauthorized";
  if (!row.isActive) return "inactive";
  await qrun(
    getDb()
      .update(myMcpServers)
      .set({ lastUsedAt: new Date() })
      .where(eq(myMcpServers.id, id)),
  );
  return row;
}

export type LiveMcpTool = {
  name: string;
  description: string;
  inputSchema: object;
  id: string;
  codeContent: string;
};

export async function listLiveMcpTools(serverId: string): Promise<LiveMcpTool[]> {
  const rows = await qall(
    getDb()
      .select({
        id: agentTools.id,
        name: agentTools.name,
        description: agentTools.description,
        parameters: agentTools.parameters,
        codeContent: agentTools.codeContent,
      })
      .from(myMcpServerTools)
      .innerJoin(agentTools, eq(myMcpServerTools.toolId, agentTools.id))
      .where(eq(myMcpServerTools.serverId, serverId)),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    inputSchema: (row.parameters ?? { type: "object", properties: {} }) as object,
    codeContent: row.codeContent,
  }));
}

export async function getAssignedToolForCall(serverId: string, toolName: string): Promise<LiveMcpTool | null> {
  const row = await qone(
    getDb()
      .select({
        id: agentTools.id,
        name: agentTools.name,
        description: agentTools.description,
        parameters: agentTools.parameters,
        codeContent: agentTools.codeContent,
      })
      .from(myMcpServerTools)
      .innerJoin(agentTools, eq(myMcpServerTools.toolId, agentTools.id))
      .where(and(eq(myMcpServerTools.serverId, serverId), eq(agentTools.name, toolName))),
  );
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inputSchema: (row.parameters ?? { type: "object", properties: {} }) as object,
    codeContent: row.codeContent,
  };
}
