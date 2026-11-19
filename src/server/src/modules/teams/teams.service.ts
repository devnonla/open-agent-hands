import { eq } from "drizzle-orm";
import { type NewAgentTeam, agentTeams, agents, getDb } from "../../common/db/client.js";
import { type RawQuery, listQuery } from "../../common/db/list-query.util.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException } from "../../common/exceptions/http.exception.js";
import { wsHub } from "../../common/ws/wsHub.js";
import { BUILTIN_TEAM_ID } from "../nonla-bot/builtin-ids.js";

function sortTeams<T extends { sortOrder: number; name: string }>(teams: T[]) {
  return [...teams].sort((a, b) => {
    const byOrder = a.sortOrder - b.sortOrder;
    if (byOrder !== 0) return byOrder;
    return a.name.localeCompare(b.name);
  });
}

export async function listTeams(query: RawQuery = {}) {
  const db = getDb();
  const result = await listQuery({ table: agentTeams }, query);
  const agentRows = await qall(db.select({ id: agents.id, teamId: agents.teamId }).from(agents));
  const items = sortTeams(
    result.items.map((t: any) => ({
      ...t,
      agentIds: agentRows.filter((a) => a.teamId === t.id).map((a) => a.id),
    })),
  );
  return { ...result, items };
}

export async function createTeam(body: { name: string; description?: string }) {
  const db = getDb();
  const existing = await qall(db.select({ sortOrder: agentTeams.sortOrder }).from(agentTeams));
  const nextOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
  const team: NewAgentTeam = {
    id: crypto.randomUUID(),
    name: body.name,
    description: body.description ?? null,
    sortOrder: nextOrder,
    isActive: true,
    createdAt: new Date(),
  };
  await qrun(db.insert(agentTeams).values(team));
  const payload = { ...team, members: [] };
  wsHub.emit("teams:created", payload);
  return payload;
}

export async function updateTeam(id: string, body: Partial<Pick<NewAgentTeam, "name" | "description">>) {
  if (id === BUILTIN_TEAM_ID) throw new BadRequestException("Builtin team is read-only");
  await qrun(getDb().update(agentTeams).set(body).where(eq(agentTeams.id, id)));
  const updated = await qone(getDb().select().from(agentTeams).where(eq(agentTeams.id, id)));
  wsHub.emit("teams:updated", updated);
  return updated;
}

export async function reorderTeams(teamIds: string[]) {
  const db = getDb();
  for (let i = 0; i < teamIds.length; i++) {
    const id = teamIds[i];
    if (!id) continue;
    await qrun(db.update(agentTeams).set({ sortOrder: i }).where(eq(agentTeams.id, id)));
  }
  wsHub.emit("teams:reordered", { teamIds });
  await qrun(db.update(agentTeams).set({ sortOrder: -1 }).where(eq(agentTeams.id, BUILTIN_TEAM_ID)));
  return { teamIds };
}

export async function deleteTeam(id: string) {
  if (id === BUILTIN_TEAM_ID) throw new BadRequestException("Builtin team is read-only");
  await qrun(getDb().delete(agentTeams).where(eq(agentTeams.id, id)));
  wsHub.emit("teams:deleted", { id });
}
