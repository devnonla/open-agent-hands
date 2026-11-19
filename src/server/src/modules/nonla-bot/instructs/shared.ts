import { AGENT_PROMPT_REVIEW_BRIEF } from "../../agents/prompt-agent/prompt-agent.service.js";

export function mdFence(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body.trim()}\n\`\`\``;
}

export function agentReviewerBrief(): string {
  return AGENT_PROMPT_REVIEW_BRIEF;
}
