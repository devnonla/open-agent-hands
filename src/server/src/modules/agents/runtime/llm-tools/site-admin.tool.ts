import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { type EditHunk, OMITTED_EDIT_TOOL_ERROR, applyEdits, editPayloadIsOmitted, normalizeToLf } from "../../../../common/ai/apply-exact-replace.js";
import { HttpException } from "../../../../common/exceptions/http.exception.js";
import { slugify } from "../../../../common/utils/slug.js";
import { makeCheckSiteTool } from "../../../sites/common/agent-tools/check-site.tool.js";
import { SITE_EDITABLE_FILES } from "../../../sites/common/agent-tools/edit-site-surface.tool.js";
import { type SiteSourceFile, readSourceFile } from "../../../sites/sites-fs.js";
import { createSite, deleteSite, getSite, listSites, updateSite, updateSiteFile } from "../../../sites/sites.service.js";
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
  id: z.string().optional().describe("Site id for get, update, delete"),
  name: z.string().optional().describe("Site name for create or update"),
  body: z.record(z.string(), z.any()).optional().describe("slug, isPublished. Source files are ignored."),
});

export function makeManageSitesTool(): StructuredToolInterface {
  return tool(
    async (input: { action?: string; id?: string; name?: string; body?: Fields }) => {
      try {
        const action = text(input.action);
        if (!action) return fail("'action' is required");
        if (action === "list") {
          const result = await listSites({ limit: "100" });
          return ok(result.items.map((site) => ({ id: site.id, name: site.name, slug: site.slug, isPublished: site.isPublished })));
        }
        if (action === "get") {
          const site = await getSite(requireId(input));
          return ok({ id: site.id, name: site.name, slug: site.slug, isPublished: site.isPublished });
        }
        if (action === "create") {
          const name = text(input.name);
          if (!name) return fail("'name' is required");
          const slug = text(input.body?.slug) || slugify(name);
          const created = await createSite({ name, slug });
          return ok({ id: created.id, name: created.name, slug: created.slug, path: `/sites/${created.id}` });
        }
        if (action === "update") {
          const updated = await updateSite(requireId(input), {
            ...(typeof input.name === "string" ? { name: input.name } : {}),
            ...(typeof input.body?.slug === "string" ? { slug: input.body.slug } : {}),
            ...(typeof input.body?.isPublished === "boolean" ? { isPublished: input.body.isPublished } : {}),
          });
          return ok({ id: updated.id, name: updated.name, slug: updated.slug, isPublished: updated.isPublished });
        }
        if (action === "delete") {
          const id = requireId(input);
          await deleteSite(id);
          return ok({ deleted: id });
        }
        return fail(`Unknown action "${action}". Use list, get, create, update, delete.`);
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_manage_sites",
      description: `Add, edit, and delete sites. Does not edit files. Sites have no folders.
Actions: list, get, create, update, delete.
list returns id, name, slug, isPublished.
get needs id. It returns name, slug, and isPublished. It does not return source files.
create needs name. Optional body.slug. Does not accept app.tsx or other source. The starter is live right away.
update needs id. It can change name, body.slug, and body.isPublished. It does not change files.
delete needs id. List first.
Source changes go through nonla_get_site_code, nonla_edit_site_code and nonla_check_site. Every edit changes the live site, and nonla_check_site validates the live site.`,
      schema: MANAGE_SCHEMA,
    },
  );
}

const fileSchema = z.enum(SITE_EDITABLE_FILES);

export function makeGetSiteCodeTool(): StructuredToolInterface {
  return tool(
    async (input: { id?: string; file?: string }) => {
      try {
        const id = requireId(input);
        const file = text(input.file);
        if (!file) return fail("'file' is required");
        const parsed = fileSchema.safeParse(file);
        if (!parsed.success) return fail('file must be "app.tsx", "styles.css", or "backend.ts"');
        await getSite(id);
        const code = readSourceFile(id, "prod", parsed.data as SiteSourceFile);
        return ok({ id, file: parsed.data, code });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_get_site_code",
      description: 'Read one live site source file. Needs id and file ("app.tsx", "styles.css", or "backend.ts"). Call this before nonla_edit_site_code so old_string matches the file. Returns the source in result.code.',
      schema: z.object({
        id: z.string().describe("Site id"),
        file: fileSchema.describe('"app.tsx", "styles.css", or "backend.ts"'),
      }),
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
    file: fileSchema,
    mode: z.enum(["replace", "full"]),
    content: z.string().optional(),
    edits: z.array(editHunkSchema).optional(),
    summary: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "full") {
      if (typeof val.content !== "string") ctx.addIssue({ code: "custom", message: "mode=full requires content", path: ["content"] });
    } else if (!val.edits || val.edits.length === 0) {
      ctx.addIssue({ code: "custom", message: "mode=replace requires edits", path: ["edits"] });
    }
  });

export function makeEditSiteCodeTool(): StructuredToolInterface {
  return tool(
    async (input) => {
      const parsed = editSchema.safeParse(input);
      if (!parsed.success) return fail(parsed.error.issues.map((issue) => issue.message).join("; "));
      const { id, file, mode, content, edits, summary } = parsed.data;
      try {
        let next: string;
        if (mode === "full") {
          next = normalizeToLf(content!);
        } else {
          const current = readSourceFile(id, "prod", file as SiteSourceFile);
          if (!current.trim()) return fail('Source is empty. Use mode="full" to write the whole file.');
          const applied = applyEdits(current, edits as EditHunk[]);
          if (!applied.ok) return fail(applied.hint ? `${applied.error}. ${applied.hint}` : applied.error);
          next = applied.content;
        }
        if (editPayloadIsOmitted(next, edits)) return fail(OMITTED_EDIT_TOOL_ERROR.error);
        await updateSiteFile(id, file, next, "prod");
        return ok({ id, file, mode, message: summary ?? "Site updated." });
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    {
      name: "nonla_edit_site_code",
      description:
        'Edit one live site file by id. Needs file ("app.tsx", "styles.css", or "backend.ts"). mode="replace": exact edits[{ old_string, new_string }]. mode="full": replace the whole file with content. No markdown fences. Call nonla_get_site_code first. The edit goes live at once. Then call nonla_check_site.',
      schema: editSchema,
    },
  );
}

export function makeCheckSiteLiveTool(): StructuredToolInterface {
  return bindToId({
    name: "nonla_check_site",
    description: "Validate a live site by site id: bundle the React app and run backend.ts handle() for GET. Returns ok true on success, or the failing stage and error. Call this after nonla_edit_site_code.",
    idLabel: "Site id from nonla_manage_sites.",
    inputSchema: z.object({}),
    make: makeCheckSiteTool,
  });
}

export function makeSiteAdminTools(): StructuredToolInterface[] {
  return [makeManageSitesTool(), makeGetSiteCodeTool(), makeEditSiteCodeTool(), makeCheckSiteLiveTool()];
}
