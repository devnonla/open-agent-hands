import { and, eq, inArray } from "drizzle-orm";
import { agentSkillAssignments, agentTeams, agentToolAssignments, agents, getDb, skillFolders, skillReferences, skills } from "../../common/db/client.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { NONLA_ADMIN_TOOL_DEFS } from "../tools/nonla-builtin-catalog.js";
import { BUILTIN_TEAM_NAME, type BuiltinAgentDef, builtinAgentCatalog } from "./builtin-agents.js";
import { BUILTIN_SKILL_FOLDER_ID, BUILTIN_TEAM_ID, NONLA_AGENT_MANAGER_ID, NONLA_BOT_AGENT_ID, NONLA_DATATABLE_MANAGER_ID, NONLA_JOB_MANAGER_ID, NONLA_SITE_MANAGER_ID, NONLA_SKILL_MANAGER_ID, NONLA_TOOL_MANAGER_ID, isBuiltinSkillId } from "./builtin-ids.js";
import { type BuiltinSkillDef, builtinSkillCatalog } from "./builtin-skills.js";
import { NONLA_BOT_DELEGATED_TOOLS } from "./managers/index.js";

const BASIC_BUILTIN_TOOLS = ["builtin:nonla_web_fetch", "builtin:nonla_run_js", "builtin:nonla_get_current_time", "builtin:nonla_openui"] as const;

function withBasicTools(toolIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...BASIC_BUILTIN_TOOLS, ...toolIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function face(shape: string, color: string): string {
  return JSON.stringify({ shape, color, eyeColor: "black" });
}

const AVATAR: Record<BuiltinAgentDef["kind"], string> = {
  bot: face("nonla", "#f18d00"),
  manage: face("diamond", "#0E7490"),
};

const AVATAR_BY_ID: Record<string, string> = {
  [NONLA_AGENT_MANAGER_ID]: face("diamond", "#E11D48"),
  [NONLA_TOOL_MANAGER_ID]: face("gem", "#F2549B"),
  [NONLA_SKILL_MANAGER_ID]: face("pill", "#F0B429"),
  [NONLA_SITE_MANAGER_ID]: face("cloud", "#3DCFC0"),
  [NONLA_JOB_MANAGER_ID]: face("square", "#A56B3C"),
  [NONLA_DATATABLE_MANAGER_ID]: face("arch", "#6366F1"),
};

function avatarFor(agent: BuiltinAgentDef): string {
  return AVATAR_BY_ID[agent.id] ?? AVATAR[agent.kind];
}

function callableIdsFor(agent: BuiltinAgentDef, catalog: BuiltinAgentDef[]): string[] {
  if (agent.id !== NONLA_BOT_AGENT_ID) return [];
  return catalog.filter((item) => item.id !== NONLA_BOT_AGENT_ID).map((item) => item.id);
}

function toolIdsFor(agent: BuiltinAgentDef): string[] {
  if (agent.id === NONLA_BOT_AGENT_ID) {
    return withBasicTools([...NONLA_ADMIN_TOOL_DEFS.filter((tool) => !NONLA_BOT_DELEGATED_TOOLS.has(tool.toolName)).map((tool) => `builtin:${tool.toolName}`)]);
  }
  if (agent.id === NONLA_AGENT_MANAGER_ID) {
    return withBasicTools(["builtin:nonla_manage_agents", "builtin:nonla_manage_agent", "builtin:nonla_manage_agent_teams", "builtin:nonla_list_model_providers", "builtin:nonla_agent_task", "builtin:nonla_get_system_prompt", "builtin:nonla_edit_system_prompt"]);
  }
  if (agent.id === NONLA_TOOL_MANAGER_ID) {
    return withBasicTools(["builtin:nonla_manage_tools", "builtin:nonla_manage_tool_folders", "builtin:nonla_get_tool_code", "builtin:nonla_edit_tool_code", "builtin:nonla_run_tool", "builtin:nonla_search_npm", "builtin:nonla_datatable"]);
  }
  if (agent.id === NONLA_SKILL_MANAGER_ID) {
    return withBasicTools(["builtin:nonla_manage_skills", "builtin:nonla_manage_skill_folders", "builtin:nonla_get_skill_files", "builtin:nonla_edit_skill_code", "builtin:nonla_delete_skill_file"]);
  }
  if (agent.id === NONLA_SITE_MANAGER_ID) {
    return withBasicTools(["builtin:nonla_manage_sites", "builtin:nonla_get_site_code", "builtin:nonla_edit_site_code", "builtin:nonla_check_site", "builtin:nonla_agent_task", "builtin:nonla_datatable"]);
  }
  if (agent.id === NONLA_JOB_MANAGER_ID) {
    return withBasicTools(["builtin:nonla_manage_jobs", "builtin:nonla_get_job_code", "builtin:nonla_edit_job_code", "builtin:nonla_run_job", "builtin:nonla_agent_task", "builtin:nonla_datatable"]);
  }
  if (agent.id === NONLA_DATATABLE_MANAGER_ID) {
    return withBasicTools(["builtin:nonla_manage_datatable_projects", "builtin:nonla_manage_datatable_tables", "builtin:nonla_manage_datatable_schema", "builtin:nonla_manage_datatable_records"]);
  }
  return withBasicTools([]);
}

const BUILTIN_SKILL_FOLDER_NAME = "Builtin";

async function syncBuiltinSkillFolder(): Promise<void> {
  const db = getDb();
  const existing = await qone(db.select({ id: skillFolders.id }).from(skillFolders).where(eq(skillFolders.id, BUILTIN_SKILL_FOLDER_ID)));
  if (!existing) {
    await qrun(
      db.insert(skillFolders).values({
        id: BUILTIN_SKILL_FOLDER_ID,
        name: BUILTIN_SKILL_FOLDER_NAME,
        description: "Built-in skills. A restart copies them from code.",
        sortOrder: -1,
        isActive: true,
        createdAt: new Date(),
      }),
    );
    return;
  }
  await qrun(
    db
      .update(skillFolders)
      .set({
        name: BUILTIN_SKILL_FOLDER_NAME,
        description: "Built-in skills. A restart copies them from code.",
        sortOrder: -1,
        isActive: true,
      })
      .where(eq(skillFolders.id, BUILTIN_SKILL_FOLDER_ID)),
  );
}

async function syncBuiltinSkillReferences(skillId: string, references: BuiltinSkillDef["references"], now: Date): Promise<void> {
  const db = getDb();
  const existing = await qall(db.select({ id: skillReferences.id, name: skillReferences.name }).from(skillReferences).where(eq(skillReferences.skillId, skillId)));
  const wanted = new Set(references.map((item) => item.name));
  for (const row of existing) {
    if (!wanted.has(row.name)) await qrun(db.delete(skillReferences).where(eq(skillReferences.id, row.id)));
  }
  for (const reference of references) {
    const current = existing.find((row) => row.name === reference.name);
    if (current) {
      await qrun(db.update(skillReferences).set({ title: reference.title, content: reference.content, updatedAt: now }).where(eq(skillReferences.id, current.id)));
      continue;
    }
    await qrun(db.insert(skillReferences).values({ id: crypto.randomUUID(), skillId, name: reference.name, title: reference.title, content: reference.content, createdAt: now, updatedAt: now }));
  }
}

async function syncBuiltinSkills(defs: BuiltinSkillDef[]): Promise<void> {
  const db = getDb();
  const now = new Date();
  for (const def of defs) {
    const existing = await qone(db.select({ id: skills.id }).from(skills).where(eq(skills.id, def.id)));
    if (!existing) {
      await qrun(
        db.insert(skills).values({
          id: def.id,
          name: def.name,
          description: def.description,
          content: def.content,
          folderId: BUILTIN_SKILL_FOLDER_ID,
          createdAt: now,
          updatedAt: now,
        }),
      );
    } else {
      await qrun(
        db
          .update(skills)
          .set({
            name: def.name,
            description: def.description,
            content: def.content,
            folderId: BUILTIN_SKILL_FOLDER_ID,
            updatedAt: now,
          })
          .where(eq(skills.id, def.id)),
      );
    }
    await syncBuiltinSkillReferences(def.id, def.references, now);
  }
  const wanted = new Set(defs.map((def) => def.id));
  const rows = await qall(db.select({ id: skills.id }).from(skills).where(eq(skills.folderId, BUILTIN_SKILL_FOLDER_ID)));
  const stale = rows.map((row) => row.id).filter((id) => !wanted.has(id));
  if (stale.length === 0) return;
  await qrun(db.delete(agentSkillAssignments).where(inArray(agentSkillAssignments.skillId, stale)));
  await qrun(db.delete(skillReferences).where(inArray(skillReferences.skillId, stale)));
  await qrun(db.delete(skills).where(inArray(skills.id, stale)));
}

async function ensureSkillAssigned(agentId: string, skillId: string): Promise<void> {
  const db = getDb();
  const existing = await qone(
    db
      .select({ id: agentSkillAssignments.id })
      .from(agentSkillAssignments)
      .where(and(eq(agentSkillAssignments.agentId, agentId), eq(agentSkillAssignments.skillId, skillId))),
  );
  if (existing) return;
  await qrun(
    db.insert(agentSkillAssignments).values({
      id: crypto.randomUUID(),
      agentId,
      skillId,
      createdAt: new Date(),
    }),
  );
}

async function syncBuiltinSkillAssignments(agentId: string, skillIds: string[]): Promise<void> {
  const db = getDb();
  const rows = await qall(db.select({ id: agentSkillAssignments.id, skillId: agentSkillAssignments.skillId }).from(agentSkillAssignments).where(eq(agentSkillAssignments.agentId, agentId)));
  const wanted = new Set(skillIds);
  for (const row of rows) {
    if (isBuiltinSkillId(row.skillId) && !wanted.has(row.skillId)) await qrun(db.delete(agentSkillAssignments).where(eq(agentSkillAssignments.id, row.id)));
  }
  for (const skillId of skillIds) await ensureSkillAssigned(agentId, skillId);
}

async function replaceTools(agentId: string, toolIds: string[]): Promise<void> {
  const db = getDb();
  await qrun(db.delete(agentToolAssignments).where(eq(agentToolAssignments.agentId, agentId)));
  for (const toolId of toolIds) {
    await qrun(
      db.insert(agentToolAssignments).values({
        id: crypto.randomUUID(),
        agentId,
        toolId,
        createdAt: new Date(),
      }),
    );
  }
}

const LEGACY_STORAGE_MANAGER_ID = "nonla_storage_manager";
const LEGACY_KV_MANAGER_ID = "nonla_kv_manager";

async function retargetLegacyStorageManager(): Promise<void> {
  const db = getDb();
  const rows = await qall(db.select({ id: agents.id, callableAgentIds: agents.callableAgentIds }).from(agents));
  for (const row of rows) {
    const ids = row.callableAgentIds ?? [];
    if (!ids.includes(LEGACY_STORAGE_MANAGER_ID) && !ids.includes(LEGACY_KV_MANAGER_ID)) continue;
    const next = ids.filter((id) => id !== LEGACY_STORAGE_MANAGER_ID && id !== LEGACY_KV_MANAGER_ID);
    if (ids.includes(LEGACY_STORAGE_MANAGER_ID) && !next.includes(NONLA_DATATABLE_MANAGER_ID)) next.push(NONLA_DATATABLE_MANAGER_ID);
    await qrun(db.update(agents).set({ callableAgentIds: next, updatedAt: new Date() }).where(eq(agents.id, row.id)));
  }
}

export async function syncBuiltinAgents(): Promise<void> {
  const db = getDb();
  const now = new Date();
  await syncBuiltinSkillFolder();
  const skillCatalog = builtinSkillCatalog();
  await syncBuiltinSkills(skillCatalog);
  const team = await qone(db.select({ id: agentTeams.id }).from(agentTeams).where(eq(agentTeams.id, BUILTIN_TEAM_ID)));
  if (!team) {
    await qrun(
      db.insert(agentTeams).values({
        id: BUILTIN_TEAM_ID,
        name: BUILTIN_TEAM_NAME,
        description: "Built-in agents. A restart copies name, prompt, and tools from code. Chats stay.",
        sortOrder: -1,
        isActive: true,
        createdAt: now,
      }),
    );
  } else {
    await qrun(
      db
        .update(agentTeams)
        .set({
          name: BUILTIN_TEAM_NAME,
          description: "Built-in agents. A restart copies name, prompt, and tools from code. Chats stay.",
          sortOrder: -1,
          isActive: true,
        })
        .where(eq(agentTeams.id, BUILTIN_TEAM_ID)),
    );
  }

  const catalog = builtinAgentCatalog();
  for (let index = 0; index < catalog.length; index++) {
    const agent = catalog[index];
    if (!agent) continue;
    const prompt = agent.instruct();
    const callableAgentIds = callableIdsFor(agent, catalog);
    const existing = await qone(db.select({ id: agents.id }).from(agents).where(eq(agents.id, agent.id)));
    if (!existing) {
      await qrun(
        db.insert(agents).values({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          avatar: avatarFor(agent),
          systemPrompt: prompt,
          isActive: true,
          isPublic: false,
          callableAgentIds,
          teamId: BUILTIN_TEAM_ID,
          sortOrder: index,
          createdBy: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
    } else {
      await qrun(
        db
          .update(agents)
          .set({
            name: agent.name,
            description: agent.description,
            avatar: avatarFor(agent),
            systemPrompt: prompt,
            isActive: true,
            callableAgentIds,
            teamId: BUILTIN_TEAM_ID,
            sortOrder: index,
            updatedAt: now,
          })
          .where(eq(agents.id, agent.id)),
      );
    }
    await replaceTools(agent.id, toolIdsFor(agent));
    await syncBuiltinSkillAssignments(
      agent.id,
      skillCatalog.filter((skill) => skill.agentIds.includes(agent.id)).map((skill) => skill.id),
    );
  }

  await retargetLegacyStorageManager();

  const catalogIds = new Set(catalog.map((item) => item.id));
  const builtinRows = await qall(db.select({ id: agents.id }).from(agents).where(eq(agents.teamId, BUILTIN_TEAM_ID)));
  for (const row of builtinRows) {
    if (!catalogIds.has(row.id)) await qrun(db.delete(agents).where(eq(agents.id, row.id)));
  }
}
