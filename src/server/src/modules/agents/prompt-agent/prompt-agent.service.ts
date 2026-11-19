/**
 * Shared system-prompt review helpers for Agent Manager.
 * The system prompt is written by the agent (or the user on the System prompt page). There is no generate_prompt tool.
 */

/** 8 or higher means the candidate is ready to save. */
export const PROMPT_PASS_SCORE = 8;

/** Same rubric on every review. Callers copy this. They do not invent a new one. */
export const AGENT_PROMPT_REVIEW_BRIEF = `You review one system prompt candidate. Do not rewrite it. Do not save it. Do not add criteria. Do not call any tool.

## Load the candidate
The parent pasted the candidate system prompt into this prompt. Review only that text.
If the candidate is missing or empty, set the score to 0 and say that the candidate is missing.

## Score
Score only these five criteria. Give each one 0, 1, or 2 points. Add the points. The total is from 0 to 10.
1. Task: the candidate does the given task, and only that task.
2. Tools: every tool it names exists in this app. It does not invent a tool.
3. Steps: the steps are in order, and the candidate says when to stop.
4. Output: the candidate says what the answer must look like.
5. Plain: there is no greeting, no filler, and no "as an AI".

## Reply
A score of ${PROMPT_PASS_SCORE} or higher means the draft is ready to save, so passed is true.
A score below ${PROMPT_PASS_SCORE} means it is not ready, so passed is false.
Return only this JSON: {"score": number, "passed": true or false, "notes": "which criteria failed and how to fix them, or why it passes"}`;

export function parseReviewScore(raw: string): { score: number; notes: string } {
  let text = raw.trim();
  try {
    const wrapped = JSON.parse(text) as { response?: unknown };
    if (wrapped && typeof wrapped === "object" && typeof wrapped.response === "string") text = wrapped.response;
  } catch {
    /* the reviewer text is not wrapped */
  }
  const scoreMatch = text.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/);
  const notesMatch = text.match(/"notes"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!scoreMatch) return { score: 0, notes: text.slice(0, 800) };
  const score = Math.max(0, Math.min(10, Math.round(Number(scoreMatch[1]))));
  const notes = notesMatch?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, "\n").trim() ?? "";
  return { score, notes };
}
