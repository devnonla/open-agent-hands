import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, skillReferences } from "../../../../common/db/client.js";
import { qall, qone } from "../../../../common/db/query.js";
import { getAssignedSkillById } from "../../../skills/skills.service.js";

export async function makeReadSkillTool(agentId: string): Promise<StructuredToolInterface> {
  return tool(
    async ({ id, reference }: { id: string; reference?: string }) => {
      const skillId = id?.trim();
      if (!skillId) {
        return JSON.stringify({ ok: false, error: "Provide skill `id`." });
      }

      const skill = await getAssignedSkillById(agentId, skillId);
      if (!skill) {
        return JSON.stringify({
          ok: false,
          error: `Skill "${skillId}" is not assigned to this agent (or inactive).`,
        });
      }

      const refs = await qall(getDb().select({ name: skillReferences.name, title: skillReferences.title }).from(skillReferences).where(eq(skillReferences.skillId, skill.id)));

      if (reference?.trim()) {
        const refName = reference.trim();
        const row = await qone(
          getDb()
            .select()
            .from(skillReferences)
            .where(and(eq(skillReferences.skillId, skill.id), eq(skillReferences.name, refName))),
        );
        if (!row) {
          return JSON.stringify({
            ok: false,
            error: `Reference "${refName}" not found on skill "${skill.name}".`,
            available_references: refs,
          });
        }
        return JSON.stringify({
          ok: true,
          id: skill.id,
          skill: skill.name,
          reference: row.name,
          title: row.title,
          content: row.content,
        });
      }

      return JSON.stringify({
        ok: true,
        id: skill.id,
        skill: skill.name,
        description: skill.description,
        content: skill.content,
        references: refs,
      });
    },
    {
      name: "nonla_read_skill",
      description: "Load an assigned skill's instructions. Call with the skill `id` from <skills> to get the main body (and available reference names). Then call again with `reference` to load a named reference mentioned in that body.",
      schema: z.object({
        id: z.string().describe("Skill id from <skills>"),
        reference: z.string().optional().describe("Optional reference slug within the skill (e.g. api-details)"),
      }),
    },
  );
}

export const TOOL_DEF = {
  toolName: "nonla_read_skill",
  toolLabel: "Read Skill",
  description: "Load an assigned skill body or a skill reference by skill id. Use when a skill in <skills> matches the task.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Skill id from <skills>" },
      reference: { type: "string", description: "Optional reference slug" },
    },
    required: ["id"],
  },
};
