import { eq } from "drizzle-orm";
import { agents, getDb } from "../../../../common/db/client.js";
import { qall, qone } from "../../../../common/db/query.js";
import { isBuiltinAgentId } from "../../../nonla-bot/builtin-ids.js";
import { listAssignedSkillSummaries } from "../../../skills/skills.service.js";
import { callAgentToolName } from "../llm-tools/call-agent.tool.js";

type AgentLike = {
  id: string;
  name: string;
  systemPrompt: string | null | undefined;
};

type DelegateAgent = {
  id: string;
  name: string;
  description: string | null;
  teamName?: string;
};

type SkillSummary = { id: string; name: string; description: string };

type BuildSystemPromptOptions = {
  agentsToDelegate?: DelegateAgent[];
  skills?: SkillSummary[];
};

function buildRoleSection(systemPrompt: string): string {
  return `<role>
${systemPrompt}
</role>`;
}

function buildMemoryInstructions(): string {
  return `<memory_instructions>
You have a long-term memory tool: \`nonla_memory\`. It stores a small knowledge graph about this user — not a scratchpad.
Nothing is auto-injected. Call \`nonla_memory\` (search / neighbors / list) when you need to recall.

**When to save (rare):** stable preferences, people, projects, constraints, or explicit "remember this".
**Do NOT save:** task progress, research dumps, intermediate answers, playbooks (use Skills), or one-off details.
Prefer 0–2 nodes per turn. Prefer \`link\` / \`update_node\` over duplicate nodes.
Each node is one short \`content\` string (no type). Links use a short free-form \`relation\` (snake_case).

Actions: upsert_node, update_node, forget_node, link, unlink, search, neighbors, list.
</memory_instructions>`;
}

function buildBackgroundTasksInstructions(): string {
  return `<background_tasks>
Custom tools may return \`{ "status": "running", "taskId": "..." }\` if they take longer than ~2 minutes.
Do not re-invoke the same tool to poll. Use \`nonla_background_tasks\`:
- \`await\` (preferred) — wait up to timeout_ms for completion
- \`get\` / \`list\` — check status
- \`cancel\` — stop a running task
</background_tasks>`;
}

function buildSkillsSection(skills: SkillSummary[]): string | null {
  if (skills.length === 0) return null;
  const list = skills.map((s) => `- ${s.name} (id: ${s.id}) — ${s.description}`).join("\n");
  return `<skills>
When a skill matches the task, call \`nonla_read_skill({ id })\` with the id below to load full instructions.
Then follow any references named inside that content via \`nonla_read_skill({ id, reference })\`.

${list}
</skills>`;
}

function buildCallableAgentsSection(agentsToDelegate: DelegateAgent[]): string | null {
  if (agentsToDelegate.length === 0) return null;
  const memberList = agentsToDelegate
    .map((a) => {
      const desc = a.description ? ` — ${a.description}` : "";
      const toolName = callAgentToolName(a.id);
      return `- **${a.name}** → tool \`${toolName}\`${desc}`;
    })
    .join("\n");

  return `<callable_agents>
You can delegate tasks using these specialist tools (one tool per agent):

${memberList}

### Rules
- Call the tool that matches the specialist you need — do not invent tool names.
- Pass the task as { "message": "<full task>" }. The field name is message.
- When you need **multiple independent tasks**, call those tools in the SAME step (parallel).
- Call specialists one after another only when the next task needs the previous result.
- If an agent call fails, report the error clearly to the user.
</callable_agents>`;
}

function buildResponseFormat(): string {
  return `<response_format>
Always respond using **Markdown** formatting.
- Use headings, lists, bold, italic, code blocks, tables, etc. for clarity.
- When you need to visualize a graph, flowchart, or diagram, use a mermaid code block.
- For interactive UI in chat (cards, charts, forms, dashboards): call \`nonla_openui\` with action=render and paste the returned markdown fence (language openui) into your reply. Call action=guide first if you need OpenUI Lang syntax. Use normal markdown tables for read-only tabular data — do not use OpenUI Table for that. Children/content args must be arrays — write TabItem("id", "Label", [Card([...])]), never a bare Card. Prefer Stack+Card for simple widgets. Do not invent a Site for that.
</response_format>`;
}

export type PromptSections = {
  system: string;
  skills: string;
  subagents: string;
};

export function collectPromptSections(agent: AgentLike, options: BuildSystemPromptOptions = {}): PromptSections {
  const system: string[] = [];
  if (agent.systemPrompt) system.push(buildRoleSection(agent.systemPrompt));
  if (!isBuiltinAgentId(agent.id)) system.push(buildMemoryInstructions());
  system.push(buildBackgroundTasksInstructions());
  system.push(buildResponseFormat());
  return {
    system: system.join("\n\n"),
    skills: options.skills ? (buildSkillsSection(options.skills) ?? "") : "",
    subagents: options.agentsToDelegate ? (buildCallableAgentsSection(options.agentsToDelegate) ?? "") : "",
  };
}

export function buildSystemPrompt(agent: AgentLike, options: BuildSystemPromptOptions = {}): string {
  const { agentsToDelegate, skills } = options;
  const parts: string[] = [];

  if (agent.systemPrompt) parts.push(buildRoleSection(agent.systemPrompt));
  if (!isBuiltinAgentId(agent.id)) parts.push(buildMemoryInstructions());
  parts.push(buildBackgroundTasksInstructions());

  const skillsSection = skills ? buildSkillsSection(skills) : null;
  if (skillsSection) parts.push(skillsSection);

  const callableSection = agentsToDelegate ? buildCallableAgentsSection(agentsToDelegate) : null;
  if (callableSection) parts.push(callableSection);

  parts.push(buildResponseFormat());
  return parts.join("\n\n");
}

export async function resolveSystemPrompt(agentId: string, callableAgentIds?: string[]): Promise<string> {
  const db = getDb();

  const agent = await qone(db.select().from(agents).where(eq(agents.id, agentId)));
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const effectiveCallableIds = callableAgentIds ?? (agent.callableAgentIds as string[] | null) ?? [];

  let agentsToDelegate: { id: string; name: string; description: string | null }[] | undefined;

  if (effectiveCallableIds.length > 0) {
    const all = await qall(db.select({ id: agents.id, name: agents.name, description: agents.description }).from(agents));
    agentsToDelegate = all.filter((a) => effectiveCallableIds.includes(a.id));
  }

  const skillSummaries = await listAssignedSkillSummaries(agentId);

  return buildSystemPrompt(agent, {
    agentsToDelegate,
    skills: skillSummaries,
  });
}

export async function resolvePromptSections(agentId: string, callableAgentIds?: string[]): Promise<PromptSections> {
  const db = getDb();
  const agent = await qone(db.select().from(agents).where(eq(agents.id, agentId)));
  if (!agent) return { system: "", skills: "", subagents: "" };

  const effectiveCallableIds = callableAgentIds ?? (agent.callableAgentIds as string[] | null) ?? [];
  let agentsToDelegate: { id: string; name: string; description: string | null }[] | undefined;
  if (effectiveCallableIds.length > 0) {
    const all = await qall(db.select({ id: agents.id, name: agents.name, description: agents.description }).from(agents));
    agentsToDelegate = all.filter((item) => effectiveCallableIds.includes(item.id));
  }
  const skills = await listAssignedSkillSummaries(agentId);
  return collectPromptSections(agent, { agentsToDelegate, skills });
}
