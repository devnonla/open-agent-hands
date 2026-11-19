import { TESTER_BRIEF_SKILL_ID } from "../builtin-ids.js";
import { fence } from "../builtin-skill-docs.js";

export type DraftCheck = "review" | "test";

export function checkWords(check: DraftCheck) {
  if (check === "test") return { role: "Tester", verb: "test", done: "tested", round: "test", rounds: "tests", notes: "tester's notes", need: "a test" };
  return { role: "Reviewer", verb: "review", done: "reviewed", round: "review", rounds: "reviews", notes: "reviewer's notes", need: "a verdict" };
}

export function testerBrief(input: { noun: string; check: DraftCheck; inputs: string[]; checks: string[]; passWhen: string; live?: boolean }): string {
  const words = checkWords(input.check);
  const subject = input.live ? input.noun : `${input.noun} draft`;
  const rules = input.live ? "Don't edit it or call any manage tool." : "Don't edit it, publish it, or call any manage or approve tool.";
  const inputs = input.inputs.map((line) => `- ${line}`).join("\n");
  const steps = input.checks.map((line, i) => `${i + 1}. ${line}`).join("\n");
  const body = `You ${words.verb} one ${subject}. ${rules}

The message that sent you here gives:
${inputs}

${steps}

passed is true only when ${input.passWhen}. If a tool fails or you can't read the ${input.live ? input.noun : "draft"}, passed is false and notes says why.

Reply with only this JSON:
${fence("json", '{"passed":true|false,"notes":"..."}')}`;
  return body.replace(/(?<!`)\bnonla_[a-z_]+\b(?!`)/g, "`$&`");
}

export function testerCallInstruction(input: { noun: string; check: DraftCheck; lines: string[]; live?: boolean }): string {
  const words = checkWords(input.check);
  const subject = input.live ? input.noun : "draft";
  const lines = input.lines.map((line) => `- ${line}`).join("\n");
  return `To get ${words.need}, call nonla_agent_task with name ${words.role} and model inherit. Its prompt is one sentence, then these lines:
Read skill ${TESTER_BRIEF_SKILL_ID} with nonla_read_skill and reference ${input.noun}, then follow it exactly.
${lines}
Don't ${words.verb} the ${subject} yourself, and don't paste the ${input.live ? "source" : "draft"}. The ${words.role} reads it by id.`;
}
