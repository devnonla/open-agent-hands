import { and, eq, isNull, ne } from "drizzle-orm";
import { type NewAgentTool, agentTools, getDb } from "../../common/db/client.js";
import { type RawQuery, listQuery } from "../../common/db/list-query.util.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException } from "../../common/exceptions/http.exception.js";
import { slugify } from "../../common/utils/slug.js";
import { wsHub } from "../../common/ws/wsHub.js";
import { normalizeToolIcon } from "./common/tool-icon.js";
import { buildJsonSchemaFromCode, isAnnotationComment, parseMetaFromCode, syncAnnotationHeader } from "./common/code-annotations.js";
import { executeTool, removeToolSandbox } from "./common/tool-runner.js";

async function nextSortOrder(folderId: string | null): Promise<number> {
  const db = getDb();
  const rows =
    folderId == null
      ? await qall(db.select({ sortOrder: agentTools.sortOrder }).from(agentTools).where(isNull(agentTools.folderId)))
      : await qall(
          db
            .select({ sortOrder: agentTools.sortOrder })
            .from(agentTools)
            .where(eq(agentTools.folderId, folderId)),
        );
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}

export async function listTools(query: RawQuery = {}) {
  const result = await listQuery({ table: agentTools }, query);
  const items = result.items.map(({ codeContent, draftCode, ...rest }: any) => rest);
  return { ...result, items };
}

export async function getTool(id: string) {
  return await qone(
    getDb()
      .select()
      .from(agentTools)
      .where(eq(agentTools.id, id)),
  );
}

async function assertToolNameAvailable(name: string, excludeId?: string) {
  const db = getDb();
  const dup = excludeId
    ? await qone(
        db
          .select()
          .from(agentTools)
          .where(and(eq(agentTools.name, name), ne(agentTools.id, excludeId))),
      )
    : await qone(
        db
          .select()
          .from(agentTools)
          .where(eq(agentTools.name, name)),
      );
  if (dup) {
    throw new BadRequestException("Tool name already exists");
  }
}

export async function createTool(
  body: Pick<NewAgentTool, "name" | "label" | "description" | "parameters" | "codeContent" | "icon"> & {
    folderId?: string | null;
    sortOrder?: number;
  },
) {
  const { folderId = null, sortOrder, ...rest } = body;
  await assertToolNameAvailable(rest.name);
  const tool: NewAgentTool = {
    ...rest,
    icon: normalizeToolIcon(rest.icon),
    id: crypto.randomUUID(),
    folderId,
    sortOrder: sortOrder ?? (await nextSortOrder(folderId)),
    createdAt: new Date(),
  };
  await qrun(getDb().insert(agentTools).values(tool));
  wsHub.emit("tools:created", tool);
  return tool;
}

export async function updateTool(id: string, body: Partial<NewAgentTool>) {
  const db = getDb();
  const existing = await qone(
    db
      .select()
      .from(agentTools)
      .where(eq(agentTools.id, id)),
  );
  if (!existing) throw new BadRequestException("Not found");

  if (body.icon !== undefined) body.icon = normalizeToolIcon(body.icon);

  // Derive metadata from // @name / // @description / // @param comments, then
  // canonicalize those headers in the stored code so share/export stays self-describing.
  if (body.codeContent) {
    const submittedCode = body.codeContent;
    const code = submittedCode;
    const meta = parseMetaFromCode(code);

    // Code annotations are the source of truth — do not fall back to stored DB
    // label/description, or deleting @name/@description would silently restore them.
    const label = (body.label?.trim() || meta.label || "").trim();
    const description = (body.description?.trim() || meta.description || "").trim();

    const errors: string[] = [];
    if (!label) errors.push("name");
    if (!description) errors.push("description");
    const codeLines = code.split("\n").filter((l) => {
      const t = l.trim();
      return t && !isAnnotationComment(t);
    });
    if (codeLines.length === 0) errors.push("code body");
    if (!/export\s+default\b/.test(code) && !/\breturn\b/.test(code)) errors.push("export default");
    if (errors.length > 0) {
      throw new BadRequestException(`Missing required: ${errors.join(", ")}`);
    }

    const schemaFromCode = buildJsonSchemaFromCode(code);
    const parameters = body.parameters ?? (Object.keys(schemaFromCode.properties).length > 0 ? schemaFromCode : existing.parameters);

    body.label = label;
    if (!body.name) body.name = meta.name || slugify(label, "_");
    body.description = description;
    body.parameters = parameters;
    body.codeContent = syncAnnotationHeader(code, { label, description }, parameters);
    // Publishing must not leave a stale AI draft (often the same body without headers).
    // That mismatch re-opens the Accept overlay after Save/Accept.
    if (body.draftCode === undefined || body.draftCode === submittedCode) {
      body.draftCode = body.codeContent;
    }
  }

  if (body.name) {
    await assertToolNameAvailable(body.name, id);
  }

  if (body.folderId !== undefined && body.sortOrder === undefined) {
    const nextFolderId = body.folderId ?? null;
    if ((existing.folderId ?? null) !== nextFolderId) {
      body.sortOrder = await nextSortOrder(nextFolderId);
    }
  }

  await qrun(
    db
      .update(agentTools)
      .set(body)
      .where(eq(agentTools.id, id)),
  );
  const updated = await qone(
    db
      .select()
      .from(agentTools)
      .where(eq(agentTools.id, id)),
  );
  if (!updated) throw new BadRequestException("Not found");

  // Spec / icon updates must not broadcast codeContent — that resets an unsaved editor.
  if (body.codeContent !== undefined) {
    wsHub.emit("tools:updated", updated);
  } else {
    const slim: Record<string, unknown> = { id: updated.id };
    for (const key of Object.keys(body) as (keyof typeof updated)[]) {
      if (key === "id") continue;
      slim[key] = updated[key];
    }
    wsHub.emit("tools:updated", slim);
  }
  return updated;
}

/** Set folder + sort order for tools in one column (kanban). */
export async function reorderTools(folderId: string | null, toolIds: string[]) {
  const db = getDb();
  for (let i = 0; i < toolIds.length; i++) {
    const id = toolIds[i];
    if (!id) continue;
    await qrun(
      db
        .update(agentTools)
        .set({ folderId, sortOrder: i })
        .where(eq(agentTools.id, id)),
    );
  }
  wsHub.emit("tools:reordered", { folderId, toolIds });
  return { folderId, toolIds };
}

export async function deleteTool(id: string) {
  await qrun(
    getDb()
      .delete(agentTools)
      .where(eq(agentTools.id, id)),
  );
  removeToolSandbox(id);
  wsHub.emit("tools:deleted", { id });
}

export async function runTool(id: string, inputJson = "{}", code?: string) {
  const tool = await getTool(id);
  if (!tool) return null;
  const codeToRun = code ?? tool.codeContent;
  const resultStr = await executeTool(id, codeToRun, inputJson);
  return JSON.parse(resultStr);
}

export async function getToolCode(id: string): Promise<string | null> {
  const row = await qone(
    getDb()
      .select({ codeContent: agentTools.codeContent })
      .from(agentTools)
      .where(eq(agentTools.id, id)),
  );
  if (!row) return null;
  return row.codeContent ?? "";
}

export async function saveToolCode(id: string, code: string): Promise<string> {
  const updated = await updateTool(id, { codeContent: code });
  return updated?.codeContent ?? code;
}

export async function runToolCode(id: string, inputJson = "{}", abortSignal?: AbortSignal) {
  const code = await getToolCode(id);
  if (!code) return null;
  return executeTool(id, code, inputJson, undefined, abortSignal);
}
