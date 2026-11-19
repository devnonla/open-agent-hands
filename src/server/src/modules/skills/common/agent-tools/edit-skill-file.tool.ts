import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { type EditHunk, OMITTED_EDIT_TOOL_ERROR, applyEdits, editPayloadIsOmitted, normalizeToLf } from "../../../../common/ai/apply-exact-replace.js";
import { type SkillFileIndexEntry, deleteReference, formatSkillFileIndex, getReferenceByName, getSkill, getSkillContent, listSkillFileIndex, readSkillPath, writeSkillPath } from "../../skills.service.js";

const editHunkSchema = z.object({
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

const editSkillFileSchema = z
  .object({
    path: z.string().describe('Virtual file path: "SKILL.md" or "references/{name}.md"'),
    mode: z.enum(["replace", "full"]),
    content: z.string().optional(),
    edits: z.array(editHunkSchema).optional(),
    summary: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "full") {
      if (typeof val.content !== "string") {
        ctx.addIssue({ code: "custom", message: "mode=full requires content", path: ["content"] });
      }
    } else if (!val.edits || val.edits.length === 0) {
      ctx.addIssue({ code: "custom", message: "mode=replace requires a non-empty edits array", path: ["edits"] });
    }
  });

const skillVirtualPath = z.string().describe('Virtual file path: "SKILL.md" or "references/{kebab-name}.md"');

const readSkillFileSchema = z.object({
  path: skillVirtualPath.optional().describe("Single file. Omit path and paths to return the file index only."),
  paths: z.array(skillVirtualPath).min(1).optional().describe("One or more virtual file paths. Batch every file you need in a single call. Omit to return the file index only."),
});

function collectReadPaths(input: { path?: string; paths?: string[] }): string[] {
  const raw = [...(input.paths ?? []), ...(input.path ? [input.path] : [])];
  return [...new Set(raw.map((p) => p.replace(/^\/+/, "").trim()).filter(Boolean))];
}

const deleteSkillFileSchema = z.object({
  path: z.string().describe('Reference path only: "references/{kebab-name}.md". Cannot delete SKILL.md.'),
});

async function fileIndex(skillId: string): Promise<SkillFileIndexEntry[]> {
  return await listSkillFileIndex(skillId);
}

export function makeReadSkillFileTool(skillId: string) {
  return tool(
    async (input) => {
      const index = await fileIndex(skillId);
      const available = index.map((entry) => entry.path);
      const parsed = readSkillFileSchema.safeParse(input ?? {});
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join("; "),
          available,
          index,
        });
      }

      const requested = collectReadPaths(parsed.data);
      if (requested.length === 0) {
        return JSON.stringify({ ok: true, index });
      }

      const results = await Promise.all(
        requested.map(async (path) => {
          const found = await readSkillPath(skillId, path);
          return found ?? { path, missing: true as const };
        }),
      );

      const files = results.filter((r): r is { path: string; content: string } => !("missing" in r));
      const missing = results.filter((r): r is { path: string; missing: true } => "missing" in r).map((r) => r.path);

      if (missing.length > 0) {
        return JSON.stringify({
          ok: false,
          error: missing.length === 1 ? `File not found: ${missing[0]}` : `Files not found: ${missing.join(", ")}`,
          ...(files.length > 0 ? { files } : {}),
          missing,
          available,
          index,
        });
      }

      const first = files[0];
      return JSON.stringify({
        ok: true,
        ...(files.length === 1 && first ? { path: first.path, content: first.content } : {}),
        files,
        index,
      });
    },
    {
      name: "read_skill_file",
      description: 'With no path, returns the file index only (path, lines, title). With paths, returns live content for each file and a fresh index. Prefer paths=["SKILL.md"] for files the task names. Call again when replace fails and you need exact current text.',
      schema: readSkillFileSchema,
    },
  );
}

export function makeEditSkillFileTool(skillId: string) {
  return tool(
    async (input) => {
      const index = await fileIndex(skillId);
      const parsed = editSkillFileSchema.safeParse(input);
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join("; "),
          index,
        });
      }

      const { path, mode, content, edits, summary } = parsed.data;
      try {
        let next: string;
        if (mode === "full") {
          next = normalizeToLf(content!);
        } else {
          const current = (await getSkillContent(skillId, path)) ?? "";
          if (!current.trim()) {
            return JSON.stringify({
              ok: false,
              error: "file is empty — cannot replace",
              hint: 'Use mode="full" to write the complete file first.',
              index,
            });
          }
          const applied = applyEdits(current, edits as EditHunk[]);
          if (!applied.ok) {
            return JSON.stringify({ ok: false, error: applied.error, hint: applied.hint, index });
          }
          next = applied.content;
        }

        if (editPayloadIsOmitted(next, edits)) {
          return JSON.stringify({ ...OMITTED_EDIT_TOOL_ERROR, index });
        }

        const written = await writeSkillPath(skillId, path, next);
        const nextIndex = await fileIndex(skillId);
        return JSON.stringify({
          ok: true,
          path: written.path,
          mode,
          message: summary ?? "Skill file updated.",
          index: nextIndex,
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err), index });
      }
    },
    {
      name: "edit_skill_file",
      description:
        'Edit a skill virtual file. The edit goes live at once. path="SKILL.md" is the instruction body only. Name and description are on the skill record, not in this file. path="references/{kebab-name}.md" is an extra doc. mode="full" replaces the file; mode="replace" applies exact edits[{ old_string, new_string }]. Returns ok, path, and a fresh index — not file contents. Call read_skill_file when you need current text.',
      schema: editSkillFileSchema,
    },
  );
}

export function makeDeleteSkillFileTool(skillId: string) {
  return tool(
    async (input) => {
      const indexNow = async () => {
        const index = await fileIndex(skillId);
        return { available: index.map((entry) => entry.path), index };
      };
      const parsed = deleteSkillFileSchema.safeParse(input);
      if (!parsed.success) {
        return JSON.stringify({
          ok: false,
          error: parsed.error.issues.map((i) => i.message).join("; "),
          ...(await indexNow()),
        });
      }

      const path = parsed.data.path.replace(/^\/+/, "").trim();
      if (path === "SKILL.md") {
        return JSON.stringify({
          ok: false,
          error: "Cannot delete SKILL.md",
          ...(await indexNow()),
        });
      }

      const refMatch = path.match(/^references\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/);
      if (!refMatch?.[1]) {
        return JSON.stringify({
          ok: false,
          error: 'path must be "references/{kebab-name}.md"',
          ...(await indexNow()),
        });
      }

      const existing = await getReferenceByName(skillId, refMatch[1]);
      if (!existing) {
        return JSON.stringify({
          ok: false,
          error: `File not found: ${path}`,
          ...(await indexNow()),
        });
      }

      try {
        await deleteReference(skillId, existing.id);
        return JSON.stringify({
          ok: true,
          path,
          deleted: true,
          message: "Reference deleted permanently. Remove any links to this path from SKILL.md via edit_skill_file if needed.",
          ...(await indexNow()),
        });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    },
    {
      name: "delete_skill_file",
      description: "Permanently delete a references/{kebab-name}.md file. Cannot delete SKILL.md. Returns a fresh index. After deleting, remove links to that path from SKILL.md via edit_skill_file when present.",
      schema: deleteSkillFileSchema,
    },
  );
}

export async function buildSkillAgentSystemPrompt(skillId: string): Promise<string> {
  const skill = await getSkill(skillId);
  const index = await listSkillFileIndex(skillId);
  const fileIndex = formatSkillFileIndex(index);

  return `You are the Skill writing assistant inside Nonla Agents.
Help the user author skills as SKILL.md plus optional references/*.md.
Follow the Agent Skills standard (agentskills.io): progressive disclosure. Name and description sit on the skill record and in the consuming agent's prompt. The body and references load later via read_skill.
Always reply in the same language the user writes in.
Do not rename the skill and do not change its description. Those are record fields. nonla_manage_skills action update changes them.

<skill>
id: ${skillId}
name: ${skill?.name ?? ""}
description: ${skill?.description ?? ""}
</skill>

<files>
Virtual tree (SQLite-backed, not a real disk):
  • SKILL.md — required. This file is the instruction body only. Do not add a YAML header. Do not put name or description in the file.
  • references/{kebab-name}.md — optional level-3 docs. Mention the slug from SKILL.md (e.g. \`api-details\`) so the consuming agent can call read_skill({ id, reference: "api-details" }).
Use the exact paths listed below — do not invent alternate names or append extra suffixes.
File index (path, lines, title). This copy is from the start of the run. Later tool results include a fresh index.
${fileIndex}
Read a file when the task names that path, or when you need its current text before an edit.
</files>

<tools>
  • read_skill_file — no path returns the index only. paths=[...] returns live content and a fresh index. Call this before editing a file, and whenever replace fails.
  • edit_skill_file — write SKILL.md or references/*.md (prefer mode=replace with unique hunks; mode=full for new files / large rewrites). Success returns ok, path, and index — not file contents. Edits go live at once.
  • delete_skill_file — permanently delete a references/{kebab-name}.md file (cannot delete SKILL.md). Returns a fresh index. Then unlink that path from SKILL.md if mentioned.
</tools>

<workflow>
1. Clarify the goal briefly if needed, then act with tools.
2. Read the files the task names. Batch those paths in one read_skill_file call.
3. Research only when the user asks or facts are missing: nonla_web_fetch (md). Summarize findings into the skill — never dump raw page text.
4. Edit via edit_skill_file. Prefer small replace hunks with unique old_string. After a successful edit, use the returned index and the new text from your previous tool-call args. If replace fails: read_skill_file again, then retry with a better unique hunk or mode=full.
5. To remove a reference: delete_skill_file on that exact path, then edit_skill_file on SKILL.md to drop any links to it.
6. After edits, briefly tell the user which paths changed. Edits are already live.
</workflow>

<standard>
Agent Skills (agentskills.io) as Nonla implements it — three load stages:

1. Metadata (~100 tokens, always in the consuming agent prompt): the skill record's name + description. This is the only discovery signal. If description is vague, the skill will never be selected. Change those fields with nonla_manage_skills action update, not in SKILL.md.
2. Instructions (target <500 lines / <5k tokens): SKILL.md, loaded via read_skill({ id }) when the task matches.
3. Resources (on demand): references/{kebab}.md, loaded via read_skill({ id, reference: "kebab-name" }) only when SKILL.md names that slug.

Write for that runtime. Do not assume the full body is always in context.
</standard>

<quality>
The skill record holds name and description. Do not write them into SKILL.md.
  • name: ≤64 chars, one line. Prefer kebab-case activity names (pdf-processing, reviewing-code). Avoid vague names (helper, utils, tools).
  • description: ≤1024 chars, third person, both WHAT it does and WHEN to use it, with concrete trigger keywords the user might say. Not marketing. Not "I can…" / "You can use this to…".
    Good: "Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction."
    Bad: "Helps with documents."

SKILL.md (level 2):
  • Assume the consuming agent is already smart. Add only domain knowledge, project conventions, fragile steps, and output formats it would not already know. Cut any paragraph that does not change behavior.
  • Lead with a short numbered workflow. Match freedom to fragility: high (heuristics) for judgment tasks; low (exact sequence or template) when consistency is critical.
  • Put long checklists, API catalogs, and many examples in references — SKILL.md only points to them by slug.
  • One term throughout (do not mix endpoint / URL / route). No dates that will rot; put legacy notes under "Old patterns".
  • Concrete examples (input → output), not abstract advice. Give an output template when shape matters.
  • For multi-step work, include a copyable checklist and a validate-then-fix loop when quality is critical.

References (level 3):
  • kebab-case names only, ≤64 chars (e.g. channel-profile.md). Create the file AND mention the slug from SKILL.md in the same turn.
  • One level deep: SKILL.md links to references; references must not chain to other references.
  • If a reference is long (>~100 lines), start with a table of contents.
  • Do not duplicate the same detail in both SKILL.md and a reference.
  • Focused files beat one giant dump. Split mutually exclusive domains into separate references.

Before finishing, self-check:
  [ ] description has WHAT + WHEN + trigger terms, third person, one YAML line
  [ ] SKILL.md is a short playbook, not a textbook
  [ ] every reference is named by slug from SKILL.md
  [ ] no nested reference chains, no "before date X" rules
</quality>

<rules>
- Always edit via edit_skill_file — never paste full files as chat-only text.
- Never paste compacted placeholders like "[omitted — see latest tool result / system draft]" into files.
- Delete references only via delete_skill_file — never claim a file is gone without calling it.
- Never invent reference paths; use listed paths or create a new kebab-case name deliberately.
- Be concise in chat replies; put durable content into the skill files.
</rules>`;
}
