/**
 * System prompt tools like code get/edit: read live systemPrompt, edit writes systemPrompt.
 * Review first (paste candidate). Call edit only when Reviewer returns passed true.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { type EditHunk, OMITTED_EDIT_TOOL_ERROR, applyEdits, editPayloadIsOmitted, normalizeToLf } from "../../../../common/ai/apply-exact-replace.js";
import { getAgent, updateAgent } from "../../agents.service.js";

export const GET_SYSTEM_PROMPT_TOOL = "nonla_get_system_prompt";
export const EDIT_SYSTEM_PROMPT_TOOL = "nonla_edit_system_prompt";

function ok(result: unknown): string {
  return JSON.stringify({ ok: true, result });
}

function fail(err: unknown, hint?: string): string {
  return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err), ...(hint ? { hint } : {}) });
}

export function makeGetSystemPromptTool(): StructuredToolInterface {
  return tool(
    async (input: { id?: string }) => {
      const id = input.id?.trim() ?? "";
      if (!id) return fail("'id' is required");
      try {
        const agent = await getAgent(id);
        if (!agent) return fail("Agent not found");
        return ok({ id: agent.id, systemPrompt: agent.systemPrompt ?? "", path: `/agents/${id}/canvas` });
      } catch (err) {
        return fail(err);
      }
    },
    {
      name: GET_SYSTEM_PROMPT_TOOL,
      description: "Read one agent's live system prompt. Call before editing and whenever replace fails so old_string matches exact current text. Needs id. Returns systemPrompt.",
      schema: z.object({ id: z.string().describe("Agent id.") }),
    },
  );
}

const editHunkSchema = z.object({
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

const editSystemPromptSchema = z
  .object({
    id: z.string().min(1).describe("Agent id."),
    mode: z.enum(["replace", "full"]).describe("full replaces the whole system prompt. replace applies exact edits."),
    prompt: z.string().optional().describe("The full system prompt text. Needed for mode=full."),
    edits: z.array(editHunkSchema).optional().describe("Exact edits. Needed for mode=replace."),
    summary: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "full") {
      if (typeof val.prompt !== "string" || !val.prompt.trim()) ctx.addIssue({ code: "custom", message: "mode=full requires prompt", path: ["prompt"] });
    } else if (!val.edits || val.edits.length === 0) {
      ctx.addIssue({ code: "custom", message: "mode=replace requires a non-empty edits array", path: ["edits"] });
    }
  });

export function makeEditSystemPromptTool(): StructuredToolInterface {
  return tool(
    async (input) => {
      const parsed = editSystemPromptSchema.safeParse(input);
      if (!parsed.success) {
        return fail(parsed.error.issues.map((issue) => issue.message).join("; "), 'Use mode="full" with prompt, or mode="replace" with edits[{ old_string, new_string }].');
      }
      const { id, mode, prompt, edits, summary } = parsed.data;
      try {
        const agent = await getAgent(id.trim());
        if (!agent) return fail("Agent not found");
        const current = agent.systemPrompt ?? "";
        let next: string;
        if (mode === "full") {
          next = normalizeToLf(prompt ?? "");
        } else {
          if (!current.trim()) {
            return fail("system prompt is empty — cannot replace", 'Use mode="full" to write the complete system prompt first.');
          }
          const applied = applyEdits(current, edits as EditHunk[]);
          if (!applied.ok) return fail(applied.error, applied.hint);
          next = applied.content;
        }
        if (editPayloadIsOmitted(next, edits)) return JSON.stringify(OMITTED_EDIT_TOOL_ERROR);
        if (next === current) {
          return ok({ id: agent.id, mode, saved: false, message: summary ?? "No change.", path: `/agents/${agent.id}/canvas` });
        }
        await updateAgent(agent.id, { systemPrompt: next });
        return ok({ id: agent.id, mode, saved: true, message: summary ?? "System prompt saved.", path: `/agents/${agent.id}/canvas` });
      } catch (err) {
        return fail(err);
      }
    },
    {
      name: EDIT_SYSTEM_PROMPT_TOOL,
      description:
        'Edit one agent\'s live system prompt, like nonla_edit_code. mode="replace": apply exact edits[{ old_string, new_string, replace_all? }] (multi-hunk). mode="full": replace the entire system prompt with prompt. Returns ok and mode only — not the text. Call nonla_get_system_prompt when you need current text. Call this only after Reviewer returns passed true.',
      schema: editSystemPromptSchema,
    },
  );
}

export function makeSystemPromptTools(): StructuredToolInterface[] {
  return [makeGetSystemPromptTool(), makeEditSystemPromptTool()];
}
