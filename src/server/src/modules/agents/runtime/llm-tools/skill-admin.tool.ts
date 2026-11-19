import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { HttpException } from "../../../../common/exceptions/http.exception.js";
import { createSkillFolder, deleteSkillFolder, listSkillFolders, updateSkillFolder } from "../../../skill-folders/skill-folders.service.js";
import { makeDeleteSkillFileTool, makeEditSkillFileTool, makeReadSkillFileTool } from "../../../skills/common/agent-tools/edit-skill-file.tool.js";
import { createSkill, deleteSkill, getSkill, listSkills, updateSkill } from "../../../skills/skills.service.js";
import { bindToId } from "./bind-to-id.js";

type Fields = Record<string, unknown>;

function ok(result: unknown): string {
  return JSON.stringify({ ok: true, result });
}

function fail(error: string): string {
  return JSON.stringify({ ok: false, error });
}

function errorMessage(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requireId(fields: { id?: string }): string {
  const id = text(fields.id);
  if (!id) throw new Error("'id' is required");
  return id;
}

const MANAGE_SCHEMA = z.object({
  action: z.string().describe("list, get, create, update, delete"),
  id: z.string().optional().describe("Skill id for get, update, delete"),
  name: z.string().optional().describe("Skill name for create or update"),
  description: z.string().optional().describe("Skill description for create or update"),
  body: z.record(z.string(), z.any()).optional().describe("folderId. Markdown is ignored."),
});

export function makeManageSkillsTool(): StructuredToolInterface {
  return tool(
    async (input: { action?: string; id?: string; name?: string; description?: string; body?: Fields }) => {
      try {
        const action = text(input.action);
        if (!action) return fail("'action' is required");
        if (action === "list") {
          const result = await listSkills({ limit: "200" });
          return ok(result.items.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, folderId: skill.folderId ?? null })));
        }
        if (action === "get") {
          const skill = await getSkill(requireId(input));
          if (!skill) return fail("Skill not found");
          return ok({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            folderId: skill.folderId ?? null,
          });
        }
        if (action === "create") {
          const name = text(input.name);
          const description = text(input.description);
          if (!name) return fail("'name' is required");
          if (!description) return fail("'description' is required");
          const created = await createSkill({
            name,
            description,
            folderId: text(input.body?.folderId) || null,
          });
          return ok({ id: created.id, name: created.name, path: `/skills/${created.id}` });
        }
        if (action === "update") {
          const id = requireId(input);
          const updated = await updateSkill(id, {
            ...(typeof input.name === "string" ? { name: input.name } : {}),
            ...(typeof input.description === "string" ? { description: input.description } : {}),
            ...(input.body?.folderId === null || typeof input.body?.folderId === "string" ? { folderId: text(input.body.folderId) || null } : {}),
          });
          return ok({ id: updated.id, name: updated.name });
        }
        if (action === "delete") {
          const id = requireId(input);
          await deleteSkill(id);
          return ok({ deleted: id });
        }
        return fail(`Unknown action "${action}". Use list, get, create, update, delete.`);
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_manage_skills",
      description: `Add, edit, and delete skills. Does not edit SKILL.md.
Actions: list, get, create, update, delete.
list returns id, name, description, folderId.
get needs id. It returns name, description, and folder. It does not return markdown.
create needs name and description. Optional body.folderId. Does not accept markdown.
update needs id. It changes name and description on the skill record, and body.folderId. body.folderId null removes the skill from a folder. It does not change the skill body. Name and description are not inside the file.
delete needs id. List first.
SKILL.md changes go through nonla_get_skill_files and nonla_edit_skill_code. Every edit goes live at once.`,
      schema: MANAGE_SCHEMA,
    },
  );
}

export function makeManageSkillFoldersTool(): StructuredToolInterface {
  return tool(
    async (input: { action?: string; id?: string; name?: string; description?: string; body?: Fields }) => {
      try {
        const action = text(input.action);
        if (!action) return fail("'action' is required");
        if (action === "list") {
          const result = await listSkillFolders({ limit: "200" });
          return ok(
            result.items.map((folder) => ({
              id: folder.id,
              name: folder.name,
              description: folder.description ?? "",
              skillIds: folder.skillIds,
            })),
          );
        }
        if (action === "create") {
          const name = text(input.name);
          if (!name) return fail("'name' is required");
          const created = await createSkillFolder({ name, description: text(input.description) || undefined });
          return ok({ id: created.id, name: created.name, path: "/skills" });
        }
        if (action === "update") {
          const id = requireId(input);
          const patch: { name?: string; description?: string | null } = {};
          if (typeof input.name === "string") patch.name = input.name;
          if (typeof input.description === "string") patch.description = text(input.description) || null;
          const updated = await updateSkillFolder(id, patch);
          return ok(updated ? { id: updated.id, name: updated.name } : null);
        }
        if (action === "delete") {
          const id = requireId(input);
          await deleteSkillFolder(id);
          return ok({ deleted: id });
        }
        if (action === "set_skill") {
          const skillId = text(input.body?.skillId);
          if (!skillId) return fail("'body.skillId' is required");
          const folderId = input.body?.folderId === null ? null : text(input.body?.folderId) || null;
          const updated = await updateSkill(skillId, { folderId });
          return ok({ id: updated.id, folderId: updated.folderId ?? null });
        }
        return fail(`Unknown action "${action}". Use list, create, update, delete, set_skill.`);
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_manage_skill_folders",
      description: `Add, edit, and delete skill folders, and move a skill into a folder.
Actions: list, create, update, delete, set_skill.
create needs name. Optional description.
update and delete need id.
set_skill needs body.skillId and body.folderId. body.folderId null moves the skill to Ungrouped.
Deleting a folder also moves its skills to Ungrouped.
List before update, delete, or set_skill.`,
      schema: z.object({
        action: z.string().describe("list, create, update, delete, set_skill"),
        id: z.string().optional().describe("Folder id for update and delete"),
        name: z.string().optional().describe("Folder name for create or update"),
        description: z.string().optional().describe("Folder description"),
        body: z.record(z.string(), z.any()).optional().describe("set_skill: skillId and folderId"),
      }),
    },
  );
}

export function makeGetSkillFilesTool(): StructuredToolInterface {
  return bindToId({
    name: "nonla_get_skill_files",
    description: 'Read a skill\'s live files by skill id. With no paths it returns the file index (path, lines, title). With paths (for example ["SKILL.md", "references/api.md"]) it returns the live content of each file. Call this before nonla_edit_skill_code so old_string matches.',
    idLabel: "Skill id from nonla_manage_skills.",
    inputSchema: z.object({
      path: z.string().optional().describe("Single virtual path"),
      paths: z.array(z.string()).optional().describe("Several virtual paths in one call"),
    }),
    make: makeReadSkillFileTool,
  });
}

export function makeEditSkillCodeTool(): StructuredToolInterface {
  return bindToId({
    name: "nonla_edit_skill_code",
    description: 'Edit a skill file by id. path is "SKILL.md" or "references/{kebab-name}.md". mode="replace": exact edits[{ old_string, new_string }]. mode="full": replace the whole file with content. Call nonla_get_skill_files first. The edit goes live at once.',
    idLabel: "Skill id from nonla_manage_skills.",
    inputSchema: z.object({
      path: z.string().describe('Virtual file path: "SKILL.md" or "references/{name}.md"'),
      mode: z.enum(["replace", "full"]),
      content: z.string().optional(),
      edits: z
        .array(
          z.object({
            old_string: z.string().min(1),
            new_string: z.string(),
            replace_all: z.boolean().optional(),
          }),
        )
        .optional(),
      summary: z.string().optional(),
    }),
    make: makeEditSkillFileTool,
  });
}

export function makeDeleteSkillFileAdminTool(): StructuredToolInterface {
  return bindToId({
    name: "nonla_delete_skill_file",
    description: 'Permanently delete a skill reference file by skill id. path must be "references/{kebab-name}.md". Cannot delete SKILL.md. After deleting, edit SKILL.md to drop links to that path when present.',
    idLabel: "Skill id from nonla_manage_skills.",
    inputSchema: z.object({
      path: z.string().describe('Reference path only: "references/{kebab-name}.md"'),
    }),
    make: makeDeleteSkillFileTool,
  });
}

export function makeSkillAdminTools(): StructuredToolInterface[] {
  return [makeManageSkillsTool(), makeManageSkillFoldersTool(), makeGetSkillFilesTool(), makeEditSkillCodeTool(), makeDeleteSkillFileAdminTool()];
}
