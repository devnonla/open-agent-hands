import { CODE_RULES_SKILL_ID, NONLA_AGENT_MANAGER_ID, NONLA_JOB_MANAGER_ID, NONLA_SITE_MANAGER_ID, NONLA_TOOL_MANAGER_ID, SDK_SKILL_ID, TESTER_BRIEF_SKILL_ID, WRITE_AGENT_INSTRUCT_SKILL_ID } from "./builtin-ids.js";
import { JOB_CODE_RULES_DOC, SDK_DOC, SITE_CODE_RULES_DOC, TOOL_CODE_RULES_DOC } from "./builtin-skill-docs.js";
import { jobTesterBrief } from "./instructs/job-manager.js";
import { siteTesterBrief } from "./instructs/site-manager.js";

export type BuiltinSkillReference = { name: string; title: string; content: string };

export type BuiltinSkillDef = {
  id: string;
  name: string;
  description: string;
  content: string;
  references: BuiltinSkillReference[];
  agentIds: string[];
};

export const WRITE_AGENT_SYSTEM_PROMPT_SKILL_NAME = "Write Agent System Prompt";

export const WRITE_AGENT_SYSTEM_PROMPT_SKILL_DESCRIPTION = "How to write a short agent system prompt that does one job: Goal, Rules, Output, and Stop.";

export const WRITE_AGENT_SYSTEM_PROMPT_BODY = `Write the system prompt the agent will follow. Short enough to obey. Specific enough that two runs do the same job.

# Shape
Four short sections, in this order:
- Goal: one sentence. The one result this agent owns. Two jobs means the system prompt is too wide.
- Rules: numbered "if X, do Y". Earlier rules win. Keep a rule only when it changes what the agent does.
- Output: the shape, length, and language of the answer. Say what must be in it, and what must stay out.
- Stop: when the job is done, and the one case where the agent asks instead of guessing.

# Make it work
- Name a tool only when that agent has it, and only when that step needs it. Do not invent tool names.
- Put steps in the order the agent should run them.
- One concrete example beats a paragraph of advice.
- Match the user's language.
- No greeting, no filler, no "as an AI".
- Cut anything the model already knows. Keep project facts, fragile steps, and the output shape.`;

function withReferenceIndex(skillId: string, body: string, references: BuiltinSkillReference[]): string {
  if (references.length === 0) return body.trim();
  const lines = references.map((item) => `- \`references/${item.name}.md\`: ${item.title}. Load it with \`nonla_read_skill({ "id": "${skillId}", "reference": "${item.name}" })\`.`).join("\n");
  return `${body.trim()}\n\n# References\n${lines}`;
}

function finalizeSkills(defs: BuiltinSkillDef[]): BuiltinSkillDef[] {
  return defs.map((def) => ({ ...def, content: withReferenceIndex(def.id, def.content, def.references) }));
}

export function builtinSkillCatalog(): BuiltinSkillDef[] {
  return finalizeSkills([
    {
      id: WRITE_AGENT_INSTRUCT_SKILL_ID,
      name: WRITE_AGENT_SYSTEM_PROMPT_SKILL_NAME,
      description: WRITE_AGENT_SYSTEM_PROMPT_SKILL_DESCRIPTION,
      content: WRITE_AGENT_SYSTEM_PROMPT_BODY.trim(),
      references: [],
      agentIds: [NONLA_AGENT_MANAGER_ID],
    },
    {
      id: SDK_SKILL_ID,
      name: "nonla-sdk",
      description: "How code uses workspace kv, secrets, datatables and agents through nonlaagents.",
      content: SDK_DOC,
      references: [],
      agentIds: [NONLA_TOOL_MANAGER_ID, NONLA_SITE_MANAGER_ID, NONLA_JOB_MANAGER_ID],
    },
    {
      id: CODE_RULES_SKILL_ID,
      name: "code-rules",
      description: "Rules for the source you write: custom tool, site files, or job script. Load the reference for the kind you edit.",
      content: "Rules for the source you write. Load the reference for the kind you edit: tool, site or job. Follow it for every edit.",
      references: [
        { name: "tool", title: "Custom tool code", content: TOOL_CODE_RULES_DOC },
        { name: "site", title: "Site files", content: SITE_CODE_RULES_DOC },
        { name: "job", title: "Job script", content: JOB_CODE_RULES_DOC },
      ],
      agentIds: [NONLA_TOOL_MANAGER_ID, NONLA_SITE_MANAGER_ID, NONLA_JOB_MANAGER_ID],
    },
    {
      id: TESTER_BRIEF_SKILL_ID,
      name: "tester-brief",
      description: "Instructions for the Tester or Reviewer you start with nonla_agent_task. Load the reference named in the call instruction.",
      content: "Briefs for the Tester and Reviewer sub-agents. Load the reference that matches what you check: site or job, then follow it exactly.",
      references: [
        { name: "site", title: "Test a site", content: siteTesterBrief() },
        { name: "job", title: "Test a job", content: jobTesterBrief() },
      ],
      agentIds: [NONLA_SITE_MANAGER_ID, NONLA_JOB_MANAGER_ID],
    },
  ]);
}
