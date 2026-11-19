/**
 * Split tools for custom JS tools: catalog, source, and a sandbox run.
 * The editor's read_current_code / edit_code stay bound to one open tool.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { type EditHunk, OMITTED_EDIT_TOOL_ERROR, applyEdits, editPayloadIsOmitted, normalizeToLf } from "../../../../common/ai/apply-exact-replace.js";
import { HttpException } from "../../../../common/exceptions/http.exception.js";
import { createToolFolder, deleteToolFolder, listToolFolders, updateToolFolder } from "../../../tool-folders/tool-folders.service.js";
import { createTool, deleteTool, getTool, getToolCode, listTools, runToolCode, saveToolCode, updateTool } from "../../../tools/tools.service.js";

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

function requireId(fields: Fields): string {
  const id = text(fields.id);
  if (!id) throw new Error("'id' is required");
  return id;
}

function requireName(fields: Fields): string {
  const name = text(fields.name);
  if (!name) throw new Error("'name' is required");
  return name;
}

const idSchema = z.object({
  id: z.string().describe("Custom tool id"),
});

export function makeManageToolsTool(): StructuredToolInterface {
  return tool(
    async (input: { action?: string; id?: string; name?: string; description?: string; body?: Fields }) => {
      try {
        const action = text(input.action);
        if (!action) return fail("'action' is required");
        if (action === "list") {
          const result = await listTools({ limit: "200" });
          const items = result.items
            .filter((item: { id: string }) => !String(item.id).startsWith("builtin:"))
            .map((item: { id: string; name: string; label: string; description: string; folderId?: string | null }) => ({
              id: item.id,
              name: item.name,
              label: item.label,
              description: item.description,
              folderId: item.folderId ?? null,
            }));
          return ok(items);
        }
        if (action === "get") {
          const row = await getTool(requireId(input));
          if (!row) return fail("Tool not found");
          if (String(row.id).startsWith("builtin:")) return fail("Builtin tools have no editable source. Use list for custom tools.");
          return ok({
            id: row.id,
            name: row.name,
            label: row.label,
            description: row.description,
            parameters: row.parameters,
            folderId: row.folderId ?? null,
            isActive: row.isActive,
          });
        }
        if (action === "create") {
          const name = requireName(input);
          const description = text(input.description);
          if (!description) return fail("'description' is required");
          const label = text(input.body?.label) || name;
          const starter = `// @name ${label}\n// @description ${description}\nexport default async function main(input) {\n  return input;\n}\n`;
          const created = await createTool({
            name,
            label,
            description,
            parameters: (input.body?.parameters as object) ?? { type: "object", properties: {}, required: [] },
            codeContent: starter,
            isActive: true,
            ...(text(input.body?.folderId) ? { folderId: text(input.body?.folderId) } : {}),
          });
          if (!created.id) return fail("Failed to create tool");
          return ok({ id: created.id, name: created.name, path: `/tools/${created.id}` });
        }
        if (action === "update") {
          const id = requireId(input);
          const patch: Parameters<typeof updateTool>[1] = {};
          if (typeof input.name === "string") patch.name = input.name;
          if (typeof input.body?.label === "string") patch.label = input.body.label;
          if (typeof input.description === "string") patch.description = input.description;
          if (input.body?.parameters && typeof input.body.parameters === "object") patch.parameters = input.body.parameters as object;
          if (typeof input.body?.isActive === "boolean") patch.isActive = input.body.isActive;
          if (input.body?.folderId === null || typeof input.body?.folderId === "string") patch.folderId = text(input.body.folderId) || null;
          const updated = await updateTool(id, patch);
          return ok(updated ? { id: updated.id, name: updated.name } : null);
        }
        if (action === "delete") {
          const id = requireId(input);
          await deleteTool(id);
          return ok({ deleted: id });
        }
        return fail(`Unknown action "${action}". Use list, get, create, update, delete.`);
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_manage_tools",
      description: `Add, edit, and delete custom tools. Does not edit source.
Actions: list, get, create, update, delete.
list returns id, name, label, description, folderId. Builtin tools are not included.
get needs id. It returns name, description, parameters, folder, and isActive. It does not return source.
create needs name and description. Optional body.label, body.parameters, and body.folderId. Does not accept source. The starter is live right away.
update needs id. It can change name, description, body.label, body.parameters, body.isActive, and body.folderId. body.folderId null removes the tool from a folder. It does not change source.
delete needs id. List first. Cannot delete builtin tools.
Source changes go through nonla_get_tool_code, nonla_edit_tool_code and nonla_run_tool. Every edit changes the live tool, and nonla_run_tool runs the live tool.`,
      schema: z.object({
        action: z.string().describe("list, get, create, update, delete"),
        id: z.string().optional().describe("Custom tool id for get, update, delete"),
        name: z.string().optional().describe("Tool name for create or update"),
        description: z.string().optional().describe("Tool description for create or update"),
        body: z.record(z.string(), z.any()).optional().describe("label, parameters, isActive, folderId"),
      }),
    },
  );
}

export function makeGetToolCodeTool(): StructuredToolInterface {
  return tool(
    async (input) => {
      try {
        const id = requireId(input);
        const code = await getToolCode(id);
        if (code == null) return fail("Tool not found");
        return ok({ id, code });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_get_tool_code",
      description: "Read a custom tool's live TypeScript source. Call this before nonla_edit_tool_code so old_string matches the file. Returns the source in result.code.",
      schema: idSchema,
    },
  );
}

const editHunkSchema = z.object({
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

const editSchema = z
  .object({
    id: z.string(),
    mode: z.enum(["replace", "full"]),
    code: z.string().optional(),
    edits: z.array(editHunkSchema).optional(),
    summary: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "full") {
      if (typeof val.code !== "string") ctx.addIssue({ code: "custom", message: "mode=full requires code", path: ["code"] });
    } else if (!val.edits || val.edits.length === 0) {
      ctx.addIssue({ code: "custom", message: "mode=replace requires edits", path: ["edits"] });
    }
  });

export function makeEditToolCodeTool(): StructuredToolInterface {
  return tool(
    async (input) => {
      const parsed = editSchema.safeParse(input);
      if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
      const { id, mode, code, edits, summary } = parsed.data;
      try {
        let next: string;
        if (mode === "full") {
          next = normalizeToLf(code!);
        } else {
          const current = (await getToolCode(id)) ?? "";
          if (!current.trim()) return fail('Source is empty. Use mode="full" to write the whole module.');
          const applied = applyEdits(current, edits as EditHunk[]);
          if (!applied.ok) return fail(applied.hint ? `${applied.error}. ${applied.hint}` : applied.error);
          next = applied.content;
        }
        if (editPayloadIsOmitted(next, edits)) return fail(OMITTED_EDIT_TOOL_ERROR.error);
        await saveToolCode(id, next);
        return ok({ id, mode, message: summary ?? "Tool updated." });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_edit_tool_code",
      description:
        'Edit a custom tool source by id. mode="replace": exact edits[{ old_string, new_string }]. mode="full": replace the whole file with code. Module needs // @name, // @description, // @param, and export default async function main(input). No markdown fences. Call nonla_get_tool_code first. The edit goes live at once. Then call nonla_run_tool.',
      schema: editSchema,
    },
  );
}

export function makeRunToolTool(abortSignal?: AbortSignal): StructuredToolInterface {
  return tool(
    async (input: { id?: string; testInput?: Record<string, unknown> }) => {
      try {
        const id = requireId(input);
        const resultStr = await runToolCode(id, JSON.stringify(input.testInput ?? {}), abortSignal);
        if (!resultStr) return fail("No code to run. Use nonla_edit_tool_code first.");
        try {
          const parsed = JSON.parse(resultStr) as { ok?: boolean; result?: unknown; error?: string; console?: unknown };
          if (parsed.ok) return ok({ success: true, output: parsed.result, console: parsed.console });
          return ok({ success: false, error: parsed.error, console: parsed.console });
        } catch {
          return ok({ success: false, error: resultStr });
        }
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_run_tool",
      description: "Run a custom tool's live source in a Bun sandbox. Needs id. Optional testInput object whose keys match // @param. Call this after nonla_edit_tool_code. If it fails, nonla_get_tool_code and edit again.",
      schema: z.object({
        id: z.string(),
        testInput: z.record(z.string(), z.unknown()).optional().describe("Arguments passed to main(input). Example: { query: 'lofi', limit: 5 }"),
      }),
    },
  );
}

export function makeManageToolFoldersTool(): StructuredToolInterface {
  return tool(
    async (input: { action?: string; id?: string; name?: string; description?: string; body?: Fields }) => {
      try {
        const action = text(input.action);
        if (!action) return fail("'action' is required");
        if (action === "list") {
          const result = await listToolFolders({ limit: "200" });
          return ok(
            result.items.map((folder) => ({
              id: folder.id,
              name: folder.name,
              description: folder.description ?? "",
              toolIds: folder.toolIds,
            })),
          );
        }
        if (action === "create") {
          const name = text(input.name);
          if (!name) return fail("'name' is required");
          const created = await createToolFolder({ name, description: text(input.description) || undefined });
          return ok({ id: created.id, name: created.name, path: "/tools" });
        }
        if (action === "update") {
          const id = requireId(input);
          const patch: { name?: string; description?: string | null } = {};
          if (typeof input.name === "string") patch.name = input.name;
          if (typeof input.description === "string") patch.description = text(input.description) || null;
          const updated = await updateToolFolder(id, patch);
          return ok(updated ? { id: updated.id, name: updated.name } : null);
        }
        if (action === "delete") {
          const id = requireId(input);
          await deleteToolFolder(id);
          return ok({ deleted: id });
        }
        if (action === "set_tool") {
          const toolId = text(input.body?.toolId);
          if (!toolId) return fail("'body.toolId' is required");
          const folderId = input.body?.folderId === null ? null : text(input.body?.folderId) || null;
          const updated = await updateTool(toolId, { folderId });
          return ok({ id: updated.id, folderId: updated.folderId ?? null });
        }
        return fail(`Unknown action "${action}". Use list, create, update, delete, set_tool.`);
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_manage_tool_folders",
      description: `Add, edit, and delete tool folders, and move a tool into a folder.
Actions: list, create, update, delete, set_tool.
create needs name. Optional description.
update and delete need id.
set_tool needs body.toolId and body.folderId. body.folderId null moves the tool to Ungrouped.
Deleting a folder also moves its tools to Ungrouped.
List before update, delete, or set_tool.`,
      schema: z.object({
        action: z.string().describe("list, create, update, delete, set_tool"),
        id: z.string().optional().describe("Folder id for update and delete"),
        name: z.string().optional().describe("Folder name for create or update"),
        description: z.string().optional().describe("Folder description"),
        body: z.record(z.string(), z.any()).optional().describe("set_tool: toolId and folderId"),
      }),
    },
  );
}

export function makeToolAdminTools(abortSignal?: AbortSignal): StructuredToolInterface[] {
  return [makeManageToolsTool(), makeManageToolFoldersTool(), makeGetToolCodeTool(), makeEditToolCodeTool(), makeRunToolTool(abortSignal)];
}
