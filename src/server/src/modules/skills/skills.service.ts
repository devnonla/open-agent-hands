import { and, eq, ne } from "drizzle-orm";
import { OMITTED_WRITE_MESSAGE, isOmittedSource } from "../../common/ai/apply-exact-replace.js";
import { type NewSkill, type NewSkillReference, agentSkillAssignments, getDb, skillFolders, skillReferences, skills } from "../../common/db/client.js";
import { type RawQuery, listQuery } from "../../common/db/list-query.util.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException, NotFoundException } from "../../common/exceptions/http.exception.js";
import { wsHub } from "../../common/ws/wsHub.js";
import { BUILTIN_SKILL_FOLDER_ID, isBuiltinSkillId } from "../nonla-bot/builtin-ids.js";
import { skillBody } from "./common/frontmatter.js";

function assertSkillWritable(id: string) {
  if (isBuiltinSkillId(id)) throw new BadRequestException("Builtin skills are read-only");
}

const REF_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertSkillName(name: string) {
  if (!name) {
    throw new BadRequestException("Skill name is required");
  }
  if (name.length > 64) {
    throw new BadRequestException("Skill name must be at most 64 characters");
  }
  if (/[\r\n]/.test(name)) {
    throw new BadRequestException("Skill name must be a single line");
  }
}

function assertRefName(name: string) {
  if (!REF_NAME_RE.test(name)) {
    throw new BadRequestException("Reference name must be kebab-case (e.g. api-details)");
  }
  if (name.length > 64) {
    throw new BadRequestException("Reference name must be at most 64 characters");
  }
}

const DEFAULT_SKILL_BODY = `## Instructions

Describe how the agent should perform this skill.

## Additional resources

- Put detailed docs under \`references/\` and mention them here.
`;

async function getSkillOrThrow(id: string) {
  const row = await qone(getDb().select().from(skills).where(eq(skills.id, id)));
  if (!row) throw new NotFoundException("Skill not found");
  return row;
}

export async function listSkills(query: RawQuery = {}) {
  return await listQuery({ table: skills, searchColumns: ["name", "description"] }, query);
}

export async function getSkill(id: string) {
  const row = await qone(getDb().select().from(skills).where(eq(skills.id, id)));
  if (!row) return null;
  return {
    ...row,
    content: skillBody(row.content),
  };
}

export async function getSkillByName(name: string) {
  return (await qone(getDb().select().from(skills).where(eq(skills.name, name)))) ?? null;
}

async function resolveFolderId(folderId: string | null | undefined): Promise<string | null> {
  if (folderId === BUILTIN_SKILL_FOLDER_ID) throw new BadRequestException("The Builtin folder is for built-in skills");
  if (folderId == null || folderId === "") return null;
  const folder = await qone(getDb().select({ id: skillFolders.id }).from(skillFolders).where(eq(skillFolders.id, folderId)));
  if (!folder) throw new BadRequestException("Folder not found");
  return folderId;
}

async function assertNameAvailable(name: string, excludeId?: string) {
  assertSkillName(name);
  const db = getDb();
  const dup = excludeId
    ? await qone(
        db
          .select()
          .from(skills)
          .where(and(eq(skills.name, name), ne(skills.id, excludeId))),
      )
    : await qone(db.select().from(skills).where(eq(skills.name, name)));
  if (dup) throw new BadRequestException("Skill name already exists");
}

export async function createSkill(body: {
  name: string;
  description: string;
  content?: string;
  folderId?: string | null;
}) {
  const name = (body.name ?? "").trim();
  const description = (body.description ?? "").trim();
  if (!description) throw new BadRequestException("description is required");
  if (isOmittedSource(body.content)) throw new BadRequestException(OMITTED_WRITE_MESSAGE);
  await assertNameAvailable(name);
  const folderId = await resolveFolderId(body.folderId);

  const content = body.content?.trim() ? skillBody(body.content) : DEFAULT_SKILL_BODY;

  const now = new Date();
  const skill: NewSkill = {
    id: crypto.randomUUID(),
    name,
    description,
    content,
    folderId,
    createdAt: now,
    updatedAt: now,
  };
  await qrun(getDb().insert(skills).values(skill));
  wsHub.emit("skills:created", skill);
  return (await getSkill(skill.id!))!;
}

export async function updateSkill(id: string, body: Partial<{ name: string; description: string; content: string; folderId: string | null }>) {
  assertSkillWritable(id);
  await getSkillOrThrow(id);
  if (isOmittedSource(body.content)) {
    throw new BadRequestException(OMITTED_WRITE_MESSAGE);
  }
  const patch: Partial<NewSkill> = { updatedAt: new Date() };

  if (body.name !== undefined) {
    const name = body.name.trim();
    await assertNameAvailable(name, id);
    patch.name = name;
  }
  if (body.description !== undefined) {
    const description = body.description.trim();
    if (!description) throw new BadRequestException("description is required");
    patch.description = description;
  }

  if (body.content !== undefined) {
    patch.content = skillBody(body.content);
  }

  if (body.folderId !== undefined) {
    patch.folderId = await resolveFolderId(body.folderId);
  }

  await qrun(getDb().update(skills).set(patch).where(eq(skills.id, id)));
  const updated = (await getSkill(id))!;
  wsHub.emit("skills:updated", updated);
  return updated;
}

export async function deleteSkill(id: string) {
  assertSkillWritable(id);
  await getSkillOrThrow(id);
  const db = getDb();
  const affected = await qall(db.select({ agentId: agentSkillAssignments.agentId }).from(agentSkillAssignments).where(eq(agentSkillAssignments.skillId, id)));
  await qrun(db.delete(skills).where(eq(skills.id, id)));
  wsHub.emit("skills:deleted", { id });
  for (const { agentId } of affected) {
    wsHub.emit("agents:skills-updated", { agentId, skillId: id });
  }
}

export async function listReferences(skillId: string) {
  await getSkillOrThrow(skillId);
  return await qall(getDb().select().from(skillReferences).where(eq(skillReferences.skillId, skillId)));
}

export type SkillFileIndexEntry = {
  path: string;
  lines: number;
  title: string;
};

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

export async function listSkillFileIndex(skillId: string): Promise<SkillFileIndexEntry[]> {
  const skill = await getSkill(skillId);
  if (!skill) throw new NotFoundException("Skill not found");
  const refs = [...(await listReferences(skillId))].sort((a, b) => a.name.localeCompare(b.name));
  const content = skill.content ?? "";
  const entries: SkillFileIndexEntry[] = [
    {
      path: "SKILL.md",
      lines: lineCount(content),
      title: skill.name,
    },
  ];
  for (const ref of refs) {
    const refContent = ref.content ?? "";
    entries.push({
      path: `references/${ref.name}.md`,
      lines: lineCount(refContent),
      title: ref.title,
    });
  }
  return entries;
}

export function formatSkillFileIndex(entries: SkillFileIndexEntry[]): string {
  if (entries.length === 0) return "(none)";
  return entries.map((entry) => `${entry.path}  ${entry.lines} lines  ${entry.title}`).join("\n");
}

export async function getReference(skillId: string, refId: string) {
  return (
    (await qone(
      getDb()
        .select()
        .from(skillReferences)
        .where(and(eq(skillReferences.id, refId), eq(skillReferences.skillId, skillId))),
    )) ?? null
  );
}

export async function getReferenceByName(skillId: string, name: string) {
  return (
    (await qone(
      getDb()
        .select()
        .from(skillReferences)
        .where(and(eq(skillReferences.skillId, skillId), eq(skillReferences.name, name))),
    )) ?? null
  );
}

export async function createReference(skillId: string, body: { name: string; title: string; content?: string }) {
  assertSkillWritable(skillId);
  await getSkillOrThrow(skillId);
  if (isOmittedSource(body.content)) {
    throw new BadRequestException(OMITTED_WRITE_MESSAGE);
  }
  const name = (body.name ?? "").trim();
  const title = (body.title ?? "").trim() || name;
  assertRefName(name);

  const db = getDb();
  const dup = await qone(
    db
      .select()
      .from(skillReferences)
      .where(and(eq(skillReferences.skillId, skillId), eq(skillReferences.name, name))),
  );
  if (dup) throw new BadRequestException("Reference name already exists for this skill");

  const now = new Date();
  const row: NewSkillReference = {
    id: crypto.randomUUID(),
    skillId,
    name,
    title,
    content: body.content ?? `# ${title}\n\n`,
    createdAt: now,
    updatedAt: now,
  };
  await qrun(db.insert(skillReferences).values(row));
  wsHub.emit("skills:updated", await getSkill(skillId));
  return (await getReference(skillId, row.id!))!;
}

export async function updateReference(skillId: string, refId: string, body: Partial<{ name: string; title: string; content: string }>) {
  assertSkillWritable(skillId);
  const existing = await getReference(skillId, refId);
  if (!existing) throw new NotFoundException("Reference not found");
  if (isOmittedSource(body.content)) {
    throw new BadRequestException(OMITTED_WRITE_MESSAGE);
  }

  const patch: Partial<NewSkillReference> = { updatedAt: new Date() };

  if (body.name !== undefined) {
    const name = body.name.trim();
    assertRefName(name);
    const dup = await qone(
      getDb()
        .select()
        .from(skillReferences)
        .where(and(eq(skillReferences.skillId, skillId), eq(skillReferences.name, name), ne(skillReferences.id, refId))),
    );
    if (dup) throw new BadRequestException("Reference name already exists for this skill");
    patch.name = name;
  }
  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) throw new BadRequestException("title is required");
    patch.title = title;
  }
  if (body.content !== undefined) {
    patch.content = body.content;
  }

  await qrun(getDb().update(skillReferences).set(patch).where(eq(skillReferences.id, refId)));
  const updated = (await getReference(skillId, refId))!;
  wsHub.emit("skills:updated", await getSkill(skillId));
  return updated;
}

export async function deleteReference(skillId: string, refId: string) {
  assertSkillWritable(skillId);
  const existing = await getReference(skillId, refId);
  if (!existing) throw new NotFoundException("Reference not found");
  await qrun(getDb().delete(skillReferences).where(eq(skillReferences.id, refId)));
  wsHub.emit("skills:updated", await getSkill(skillId));
}

function normalizeToLf(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function writeSkillPath(skillId: string, path: string, content: string): Promise<{ path: string; content: string }> {
  assertSkillWritable(skillId);
  if (isOmittedSource(content)) {
    throw new BadRequestException(OMITTED_WRITE_MESSAGE);
  }
  const normalized = path.replace(/^\/+/, "").trim();
  if (normalized === "SKILL.md") {
    await getSkillOrThrow(skillId);
    const next = skillBody(normalizeToLf(content));
    await qrun(getDb().update(skills).set({ content: next, updatedAt: new Date() }).where(eq(skills.id, skillId)));
    const updated = (await getSkill(skillId))!;
    wsHub.emit("skills:updated", updated);
    return { path: "SKILL.md", content: next };
  }

  const refMatch = normalized.match(/^references\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
  if (!refMatch?.[1]) {
    throw new BadRequestException('path must be "SKILL.md" or "references/{name}.md"');
  }
  const refName: string = refMatch[1];
  const next = normalizeToLf(content);
  const existing = await getReferenceByName(skillId, refName);
  if (existing) {
    await qrun(getDb().update(skillReferences).set({ content: next, updatedAt: new Date() }).where(eq(skillReferences.id, existing.id)));
    wsHub.emit("skills:updated", await getSkill(skillId));
    return { path: `references/${refName}.md`, content: next };
  }
  await createReference(skillId, { name: refName, title: refName, content: next });
  return { path: `references/${refName}.md`, content: next };
}

export async function getSkillContent(skillId: string, path: string): Promise<string | null> {
  const normalized = path.replace(/^\/+/, "").trim();
  if (normalized === "SKILL.md") {
    const row = await qone(getDb().select().from(skills).where(eq(skills.id, skillId)));
    if (!row) return null;
    return skillBody(row.content);
  }
  const refMatch = normalized.match(/^references\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
  if (!refMatch) return null;
  const row = await getReferenceByName(skillId, refMatch[1]);
  if (!row) return null;
  return row.content;
}

export async function readSkillPath(skillId: string, path: string): Promise<{ path: string; content: string } | null> {
  const normalized = path.replace(/^\/+/, "").trim();
  const content = await getSkillContent(skillId, normalized);
  if (content == null) return null;
  if (normalized === "SKILL.md") return { path: "SKILL.md", content };
  const refMatch = normalized.match(/^references\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
  if (!refMatch) return null;
  return { path: `references/${refMatch[1]}.md`, content };
}

export async function listAssignedSkillSummaries(agentId: string): Promise<{ id: string; name: string; description: string }[]> {
  const db = getDb();
  return await qall(db.select({ id: skills.id, name: skills.name, description: skills.description }).from(agentSkillAssignments).innerJoin(skills, eq(agentSkillAssignments.skillId, skills.id)).where(eq(agentSkillAssignments.agentId, agentId)));
}

export async function getAssignedSkillById(agentId: string, skillId: string) {
  const db = getDb();
  const row =
    (await qone(
      db
        .select({
          id: skills.id,
          name: skills.name,
          description: skills.description,
          content: skills.content,
        })
        .from(agentSkillAssignments)
        .innerJoin(skills, eq(agentSkillAssignments.skillId, skills.id))
        .where(and(eq(agentSkillAssignments.agentId, agentId), eq(skills.id, skillId))),
    )) ?? null;
  if (!row) return null;
  return { ...row, content: skillBody(row.content) };
}
