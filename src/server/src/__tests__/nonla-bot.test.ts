import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { anyToolOk, toolPayloads } from "../common/ai/agent-result.js";
import { getAgent } from "../modules/agents/agents.service.js";
import { makeEditSystemPromptTool, makeGetSystemPromptTool } from "../modules/agents/prompt-agent/llm-tools/system-prompt.tool.js";
import { makeGotoPageTool } from "../modules/agents/runtime/llm-tools/goto-page.tool.js";
import { makeGetJobCodeTool, makeJobAdminTools, makeManageJobsTool, makeRunJobTool } from "../modules/agents/runtime/llm-tools/job-admin.tool.js";
import { makeCheckSiteLiveTool, makeGetSiteCodeTool, makeManageSitesTool, makeSiteAdminTools } from "../modules/agents/runtime/llm-tools/site-admin.tool.js";
import { makeEditSkillCodeTool, makeGetSkillFilesTool, makeManageSkillFoldersTool, makeManageSkillsTool } from "../modules/agents/runtime/llm-tools/skill-admin.tool.js";
import { makeManageToolFoldersTool, makeToolAdminTools } from "../modules/agents/runtime/llm-tools/tool-admin.tool.js";
import { NONLA_BUILTIN_TOOLS, NONLA_SPECIALISTS, makeListModelProvidersTool, makeManageAgentTool, makeManageAgentsTool, makeManageTeamsTool, makeNonlaBuiltinTools } from "../modules/agents/runtime/llm-tools/workspace.tool.js";
import { getJob, saveJobCode } from "../modules/jobs/jobs.service.js";
import { builtinAgentCatalog } from "../modules/nonla-bot/builtin-agents.js";
import { appPathForGoto, formatNonlaPageBlock, resolveNonlaPage } from "../modules/nonla-bot/nonla-page.js";
import { syncBuiltinAgents } from "../modules/nonla-bot/sync-builtin-agents.js";
import { updateSiteFile } from "../modules/sites/sites.service.js";
import { getSkill, writeSkillPath } from "../modules/skills/skills.service.js";
import { getTool } from "../modules/tools/tools.service.js";
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

describe("Nonla Bot assistant", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    const admin = await setupAdmin(app);
    token = admin.token;
  });

  afterAll(() => cleanup());

  test("GET /api/agents — Builtin group is synced", async () => {
    const res = await authRequest(app, token, "GET", "/api/agents?limit=50");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { items: { id: string; name: string; teamId: string | null }[] };
    const bot = data.items.find((item) => item.id === "nonla-bot");
    expect(bot?.name).toBe("Nonla Bot");
    expect(bot?.teamId).toBe("builtin");
    expect(data.items.filter((item) => item.teamId === "builtin")).toHaveLength(7);

    const detail = await authRequest(app, token, "GET", "/api/agents/nonla-bot");
    const agent = (await detail.json()) as { systemPrompt: string; aiModel: string | null; callableAgentIds: string[] };
    expect(agent.systemPrompt.length).toBeGreaterThan(20);
    expect(agent.callableAgentIds).toHaveLength(6);
    expect(agent.callableAgentIds).toContain("nonla_agent_manager");
    expect(agent.callableAgentIds).toContain("nonla_tool_manager");
    expect(agent.callableAgentIds).toContain("nonla_skill_manager");
    expect(agent.callableAgentIds).toContain("nonla_site_manager");
    expect(agent.callableAgentIds).toContain("nonla_job_manager");
    expect(agent.callableAgentIds).toContain("nonla_datatable_manager");
    expect(agent.callableAgentIds).not.toContain("nonla_kv_manager");
    expect(agent.callableAgentIds).not.toContain("nonla_storage_manager");
    expect(agent.callableAgentIds).not.toContain("nonla_tool_draft_code_writer");
    expect(agent.callableAgentIds).not.toContain("nonla_skill_draft_writer");
    expect(agent.callableAgentIds).not.toContain("nonla_site_writer");
    expect(agent.callableAgentIds).not.toContain("nonla_edit_site_code");
    expect(agent.callableAgentIds).not.toContain("nonla_job_draft_writer");
    expect(agent.callableAgentIds).not.toContain("nonla_edit_job_code");
    expect(agent.callableAgentIds).not.toContain("nonla_agent_instruct_writer");
    expect(agent.callableAgentIds).not.toContain("nonla_agent_instruct_reviewer");
    expect(agent.callableAgentIds).not.toContain("nonla-bot");
    expect(agent.systemPrompt).toContain("nonla_call_agent__nonla_agent_manager");
    expect(agent.systemPrompt).toContain("nonla_call_agent__nonla_tool_manager");
    expect(agent.systemPrompt).toContain("nonla_call_agent__nonla_skill_manager");
    expect(agent.systemPrompt).toContain("nonla_call_agent__nonla_site_manager");
    expect(agent.systemPrompt).toContain("nonla_call_agent__nonla_job_manager");
    expect(agent.systemPrompt).toContain("nonla_call_agent__nonla_datatable_manager");
    expect(agent.systemPrompt).toContain("nonla_manage_kv_entries");
    expect(agent.systemPrompt).toContain("nonla_manage_secrets");
    expect(agent.systemPrompt).not.toContain("nonla_call_agent__nonla_kv_manager");
    expect(agent.systemPrompt).not.toContain("nonla_call_agent__nonla_storage_manager");
    expect(agent.systemPrompt).not.toContain("```route");
    expect(agent.systemPrompt).not.toContain('"branches"');
    expect(agent.systemPrompt).toContain("Agent Manager, through nonla_call_agent__nonla_agent_manager");
    expect(agent.systemPrompt).not.toContain("you want to change the workspace");
    expect(agent.systemPrompt).toContain("When a manager's reply gives an id, or a page path");
    expect(agent.systemPrompt).toContain("nonla_goto_page");
    const rules = agent.systemPrompt.slice(agent.systemPrompt.indexOf("# Rules"));
    expect(rules).not.toContain("nonla_goto_page");
    expect(rules).not.toContain("nonla_run_js");
    expect(agent.systemPrompt).not.toContain("Builtin agents are read-only");
    const managerOrder = ["Agent Manager", "Tool Manager", "Skill Manager", "Site Manager", "Job Manager", "Datatable Manager"].map((name) => agent.systemPrompt.indexOf(`: ${name}, through`));
    expect(managerOrder.every((index) => index > 0)).toBe(true);
    expect(managerOrder).toEqual([...managerOrder].sort((a, b) => a - b));
    expect(agent.systemPrompt).toContain("KV entries: use nonla_manage_kv_entries with the actions list, get, set and delete");
    expect(agent.systemPrompt).toContain("Secrets: use nonla_manage_secrets with the actions list, get, set and delete");
    expect(agent.systemPrompt).toContain("MCP servers (list, get, create, update, delete): use nonla_manage_mcp_servers");
    expect(agent.systemPrompt).toContain("nonla_openui");
    expect(agent.systemPrompt).toContain("In-chat widgets");
    expect(agent.systemPrompt).toContain("If a manager returns status running, wait with nonla_background_tasks");
    expect(agent.systemPrompt).toContain("add_assigned_agents");
    expect(agent.systemPrompt).not.toContain("KV entries or secrets");
    expect(agent.systemPrompt).toContain("Agents (list, create, update, delete, tools, teams)");
    expect(agent.systemPrompt).not.toContain("## Call these managers");
    expect(agent.systemPrompt).not.toContain("writes the draft");
    expect(agent.systemPrompt).not.toContain("invokes Reviewer");
    expect(agent.systemPrompt).not.toContain("no approve step");
    expect(agent.systemPrompt).toContain("Datatable Manager");
    expect(agent.systemPrompt).not.toContain("Nonla KV Manager");
    expect(agent.systemPrompt).not.toContain("Nonla Storage Manager");
    expect(agent.systemPrompt).not.toContain("You handle datatables yourself");
    expect(agent.systemPrompt).not.toContain("nonla_manage_datatable_projects");

    const manager = (await (await authRequest(app, token, "GET", "/api/agents/nonla_agent_manager")).json()) as { name: string; systemPrompt: string };
    expect(manager.name).toBe("Agent Manager");
    expect(manager.systemPrompt).toContain("You are Agent Manager.");
    expect(manager.systemPrompt).toContain("nonla_get_system_prompt");
    expect(manager.systemPrompt).toContain("nonla_edit_system_prompt");
    expect(manager.systemPrompt).toContain("mode=full");
    expect(manager.systemPrompt).toContain("mode=replace");
    expect(manager.systemPrompt).not.toContain("action set_draft");
    expect(manager.systemPrompt).not.toContain("set_draft,");
    expect(manager.systemPrompt).toContain("There is no separate review tool.");
    expect(manager.systemPrompt).not.toContain("nonla_save_system_prompt");
    expect(manager.systemPrompt).toContain("It has your tools, but the block below tells it to call none.");
    expect(manager.systemPrompt).toContain("Tools the agent has:");
    expect(manager.systemPrompt).toContain("Builtin agents (the ones in the Builtin team: ids that start with nonla_, plus nonla-bot) are read-only.");
    expect(manager.systemPrompt).toContain("add_assigned_agents");
    expect(manager.systemPrompt).toContain("Do not call any tool");
    expect(manager.systemPrompt).toContain("The parent pasted the candidate system prompt");
    expect(manager.systemPrompt).not.toContain("Call nonla_get_system_prompt before you score");
    expect(manager.systemPrompt).toContain("nonla_read_skill with id nonla_skill_write_agent_instruct");
    expect(manager.systemPrompt).not.toContain("# Tools");
    expect(manager.systemPrompt).not.toContain("nonla_agent_instruct_writer");
    expect(manager.systemPrompt).not.toContain("nonla_agent_instruct_reviewer");
    expect(manager.systemPrompt).not.toContain("```step");
    expect(manager.systemPrompt).not.toContain("```mermaid");
    expect(manager.systemPrompt).not.toContain("```route");
    expect(manager.systemPrompt).toContain("nonla_agent_task with name Reviewer");
    expect(manager.systemPrompt).toContain("passed is true");
    expect(manager.systemPrompt).toContain("nonla_agent_task");
    expect(manager.systemPrompt).not.toContain("```agenttask");
    expect(manager.systemPrompt).not.toContain("name: Writer");
    expect(manager.systemPrompt).toContain("name Reviewer and model inherit");
    expect(manager.systemPrompt).toContain("## Load the candidate");
    expect(manager.systemPrompt).toContain("## Score");
    expect(manager.systemPrompt).toContain("## Reply");
    expect(manager.systemPrompt).toContain("If passed is true, call nonla_edit_system_prompt.");
    expect(manager.systemPrompt).toContain("A separate Reviewer does that.");
    expect(manager.systemPrompt).not.toContain("nonla_approve_draft_instruct");
    expect(manager.systemPrompt).not.toContain("caller asked to publish");
    expect(manager.systemPrompt).not.toContain("# Who calls whom");

    const toolManager = (await (await authRequest(app, token, "GET", "/api/agents/nonla_tool_manager")).json()) as { name: string; systemPrompt: string };
    expect(toolManager.name).toBe("Tool Manager");
    expect(toolManager.systemPrompt).toContain("You are Tool Manager.");
    for (const name of ["nonla_get_tool_code", "nonla_edit_tool_code", "nonla_run_tool"]) expect(toolManager.systemPrompt).toContain(name);
    expect(toolManager.systemPrompt).not.toContain("nonla_approve_tool_draft_code");
    expect(toolManager.systemPrompt).not.toContain("nonla_tool_draft_code_writer");
    expect(toolManager.systemPrompt).not.toContain("nonla_tool_draft_code_reviewer");
    expect(toolManager.systemPrompt).not.toContain("```step");
    expect(toolManager.systemPrompt).not.toContain("```route");
    expect(toolManager.systemPrompt).not.toContain("```mermaid");
    expect(toolManager.systemPrompt).not.toContain("passed is true");
    expect(toolManager.systemPrompt).not.toContain("nonla_agent_task");
    expect(toolManager.systemPrompt).not.toContain("Tester");
    expect(toolManager.systemPrompt).toContain("# Changing the tool code");
    expect(toolManager.systemPrompt).toContain("There's no round limit.");
    expect(toolManager.systemPrompt).not.toContain("Already tested:");
    expect(toolManager.systemPrompt).not.toContain("Not tested yet:");
    expect(toolManager.systemPrompt).not.toContain("// @param {type} name (required|optional) - description");
    expect(toolManager.systemPrompt).toContain("nonla_read_skill with id nonla_skill_code_rules and reference tool");
    expect(toolManager.systemPrompt).not.toContain("nonla_skill_tester_brief");
    expect(toolManager.systemPrompt).not.toContain("caller asked to publish");

    const skillManager = (await (await authRequest(app, token, "GET", "/api/agents/nonla_skill_manager")).json()) as { name: string; systemPrompt: string };
    expect(skillManager.name).toBe("Skill Manager");
    expect(skillManager.systemPrompt).toContain("You are Skill Manager.");
    for (const name of ["nonla_get_skill_files", "nonla_edit_skill_code", "nonla_delete_skill_file"]) expect(skillManager.systemPrompt).toContain(name);
    expect(skillManager.systemPrompt).not.toContain("nonla_skill_draft_writer");
    expect(skillManager.systemPrompt).not.toContain("nonla_approve_skill");
    expect(skillManager.systemPrompt).not.toContain("nonla_agent_task");
    expect(skillManager.systemPrompt).not.toContain("Tester");
    expect(skillManager.systemPrompt).not.toContain("Reviewer");
    expect(skillManager.systemPrompt).not.toContain("nonla_skill_tester_brief");
    expect(skillManager.systemPrompt).not.toContain("```route");
    expect(skillManager.systemPrompt).not.toContain("```mermaid");
    expect(skillManager.systemPrompt).toContain("# Changing the skill files");
    expect(skillManager.systemPrompt).toContain("The edit changes the live skill at once.");

    const siteManager = (await (await authRequest(app, token, "GET", "/api/agents/nonla_site_manager")).json()) as { name: string; systemPrompt: string };
    expect(siteManager.name).toBe("Site Manager");
    expect(siteManager.systemPrompt).toContain("You are Site Manager.");
    for (const name of ["nonla_get_site_code", "nonla_edit_site_code", "nonla_check_site"]) expect(siteManager.systemPrompt).toContain(name);
    expect(siteManager.systemPrompt).not.toContain("nonla_site_writer");
    expect(siteManager.systemPrompt).not.toContain("nonla_site_draft_writer");
    expect(siteManager.systemPrompt).not.toContain("nonla_site_draft_reviewer");
    expect(siteManager.systemPrompt).not.toContain("nonla_approve_site_draft_code");
    expect(siteManager.systemPrompt).toContain("Set isPublished with nonla_manage_sites only when the caller asked for it");
    expect(siteManager.systemPrompt).not.toContain("```route");
    expect(siteManager.systemPrompt).not.toContain("```mermaid");
    expect(siteManager.systemPrompt).toContain("name Tester and model inherit");
    expect(siteManager.systemPrompt).not.toContain("name Reviewer");
    expect(siteManager.systemPrompt).not.toContain("name: Writer");
    expect(siteManager.systemPrompt).toContain("If passed is true, you're done.");
    expect(siteManager.systemPrompt).toContain("There's no round limit.");
    expect(siteManager.systemPrompt).toContain("# Changing the site files");

    const jobManager = (await (await authRequest(app, token, "GET", "/api/agents/nonla_job_manager")).json()) as { name: string; systemPrompt: string };
    expect(jobManager.name).toBe("Job Manager");
    expect(jobManager.systemPrompt).toContain("You are Job Manager.");
    for (const name of ["nonla_get_job_code", "nonla_edit_job_code", "nonla_run_job"]) expect(jobManager.systemPrompt).toContain(name);
    expect(jobManager.systemPrompt).not.toContain("nonla_job_draft_writer");
    expect(jobManager.systemPrompt).not.toContain("nonla_job_draft_reviewer");
    expect(jobManager.systemPrompt).not.toContain("nonla_approve_job_draft_code");
    expect(jobManager.systemPrompt).not.toContain("nonla_run_draft_job");
    expect(jobManager.systemPrompt).toContain("Set body.cron with nonla_manage_jobs only when the caller asked for a schedule");
    expect(jobManager.systemPrompt).toContain("set body.cron to an empty string");
    expect(jobManager.systemPrompt).not.toContain("```route");
    expect(jobManager.systemPrompt).not.toContain("```mermaid");
    expect(jobManager.systemPrompt).toContain("name Tester and model inherit");
    expect(jobManager.systemPrompt).not.toContain("name Reviewer");
    expect(jobManager.systemPrompt).not.toContain("name: Writer");
    expect(jobManager.systemPrompt).toContain("If passed is true, you're done.");
    expect(jobManager.systemPrompt).not.toContain("There's no round limit.");
    expect(jobManager.systemPrompt).toContain("Allow at most 5 fix rounds.");
    expect(jobManager.systemPrompt).toContain("Leave body.cron alone until a run is clean.");
    expect(jobManager.systemPrompt).toContain("status running");
    expect(jobManager.systemPrompt).toContain("Don't run it again.");
    expect(jobManager.systemPrompt).not.toContain("Never start a second Tester");
    expect(jobManager.systemPrompt).toContain("# Changing the job script");

    const gone = await authRequest(app, token, "GET", "/api/agents/nonla_storage_manager");
    expect(gone.status).toBe(400);

    const datatableManager = (await (await authRequest(app, token, "GET", "/api/agents/nonla_datatable_manager")).json()) as { name: string; systemPrompt: string };
    expect(datatableManager.name).toBe("Datatable Manager");
    expect(datatableManager.systemPrompt).toContain("You are Datatable Manager.");
    expect(datatableManager.systemPrompt).toContain("nonla_manage_datatable_projects");
    expect(datatableManager.systemPrompt).not.toContain("nonla_manage_kv_entries");
    expect(datatableManager.systemPrompt).not.toContain("nonla_manage_secrets");
    expect(datatableManager.systemPrompt).not.toContain("nonla_read_skill");
    expect(datatableManager.systemPrompt).not.toContain("```route");
    expect(datatableManager.systemPrompt).not.toContain("```mermaid");
    expect(datatableManager.systemPrompt).toContain("There is no approve step.");
    expect(datatableManager.systemPrompt).not.toContain("nonla_agent_task");

    const kvGone = await authRequest(app, token, "GET", "/api/agents/nonla_kv_manager");
    expect(kvGone.status).toBe(400);

    const renamed = await authRequest(app, token, "PUT", "/api/agents/nonla-bot", { name: "Renamed" });
    expect(renamed.status).toBe(400);
    const writerModel = await authRequest(app, token, "PUT", "/api/agents/nonla_agent_manager", { aiProvider: "provider-1", aiModel: "manager-model" });
    expect(writerModel.status).toBe(200);
    const setModel = await authRequest(app, token, "PUT", "/api/agents/nonla-bot", { aiProvider: "provider-1", aiModel: "demo-model" });
    expect(setModel.status).toBe(200);
    const writer = (await (await authRequest(app, token, "GET", "/api/agents/nonla_agent_manager")).json()) as { aiModel: string | null };
    expect(writer.aiModel).toBe("manager-model");
    const removed = await authRequest(app, token, "DELETE", "/api/agents/nonla-bot");
    expect(removed.status).toBe(400);

    const created = await authRequest(app, token, "POST", "/api/conversations", {
      agentId: "nonla-bot",
      title: "Keep me",
    });
    expect(created.status).toBe(201);
    const conv = (await created.json()) as { id: string };
    await syncBuiltinAgents();
    const still = await authRequest(app, token, "GET", `/api/conversations/${conv.id}`);
    expect(still.status).toBe(200);
    const after = (await (await authRequest(app, token, "GET", "/api/agents/nonla-bot")).json()) as { name: string; aiModel: string | null };
    expect(after.name).toBe("Nonla Bot");
    expect(after.aiModel).toBe("demo-model");
    const writerAfterSync = (await (await authRequest(app, token, "GET", "/api/agents/nonla_agent_manager")).json()) as { aiModel: string | null };
    expect(writerAfterSync.aiModel).toBe("manager-model");
  });

  test("Write Agent System Prompt is view-only and assigned to Agent Manager", async () => {
    const res = await authRequest(app, token, "GET", "/api/skills/nonla_skill_write_agent_instruct");
    expect(res.status).toBe(200);
    const skill = (await res.json()) as { name: string; description: string; content: string; folderId: string | null };
    expect(skill.name).toBe("Write Agent System Prompt");
    expect(skill.folderId).toBe("builtin");
    expect(skill.description).toContain("Goal, Rules, Output, and Stop");
    expect(skill.content).toContain("Goal");
    expect(skill.content).toContain("Stop");
    expect(skill.content).not.toContain("nonla_edit_draft_instruct");
    expect(skill.content).not.toContain("nonla_get_draft_instruct");

    const edited = await authRequest(app, token, "PUT", "/api/skills/nonla_skill_write_agent_instruct", { description: "changed" });
    expect(edited.status).toBe(400);
    const removed = await authRequest(app, token, "DELETE", "/api/skills/nonla_skill_write_agent_instruct");
    expect(removed.status).toBe(400);

    const assignments = (await (await authRequest(app, token, "GET", "/api/agents/nonla_agent_manager/skill-assignments")).json()) as { skillId: string }[];
    expect(assignments.some((item) => item.skillId === "nonla_skill_write_agent_instruct")).toBe(true);

    const { resolveSystemPrompt } = await import("../modules/agents/runtime/utils/buildSystemPrompt.js");
    const prompt = await resolveSystemPrompt("nonla_agent_manager");
    expect(prompt).toContain("Write Agent System Prompt");
  });

  test("managers read builtin skills through nonla_read_skill and have a schema-only datatable tool", async () => {
    const { resolveAgentTools } = await import("../modules/agents/runtime/utils/resolveTools.js");
    const { listAssignments } = await import("../modules/agents/agents.service.js");
    const { listAssignedSkillSummaries } = await import("../modules/skills/skills.service.js");
    const load = async (id: string) =>
      resolveAgentTools(
        id,
        (await listAssignments(id)).map((row) => row.toolId),
        "user",
        false,
        { enableMemory: true },
      );
    const expected: Record<string, string[]> = {
      nonla_agent_manager: ["nonla_skill_write_agent_instruct"],
      nonla_tool_manager: ["nonla_skill_sdk", "nonla_skill_code_rules"],
      nonla_site_manager: ["nonla_skill_sdk", "nonla_skill_code_rules", "nonla_skill_tester_brief"],
      nonla_job_manager: ["nonla_skill_sdk", "nonla_skill_code_rules", "nonla_skill_tester_brief"],
      nonla_skill_manager: [],
      nonla_datatable_manager: [],
    };
    for (const [agentId, skillIds] of Object.entries(expected)) {
      const assigned = (await listAssignedSkillSummaries(agentId)).map((item) => item.id).sort();
      expect(assigned).toEqual([...skillIds].sort());
      const tools = await load(agentId);
      expect(tools.some((tool) => tool.name === "nonla_get_nonlaagents_guide")).toBe(false);
      expect(tools.filter((tool) => tool.name === "nonla_read_skill")).toHaveLength(1);
    }

    const jobTools = await load("nonla_job_manager");
    const read = jobTools.find((tool) => tool.name === "nonla_read_skill");
    const sdk = JSON.parse(String(await read?.invoke({ id: "nonla_skill_sdk" }))) as { ok: boolean; content: string; references: { name: string }[] };
    expect(sdk.ok).toBe(true);
    expect(sdk.references).toEqual([]);
    for (const topic of ["nonlaagents.kv", "nonlaagents.secrets", "nonlaagents.datatable", "nonlaagents.agents"]) expect(sdk.content).toContain(topic);
    expect(sdk.content).not.toContain("# References");
    const rulesBody = JSON.parse(String(await read?.invoke({ id: "nonla_skill_code_rules" }))) as { ok: boolean; content: string };
    expect(rulesBody.content).toContain('`nonla_read_skill({ "id": "nonla_skill_code_rules", "reference": "job" })`');
    const rules = JSON.parse(String(await read?.invoke({ id: "nonla_skill_code_rules", reference: "job" }))) as { ok: boolean; content: string };
    expect(rules.content).toContain("nonlaagents.step");
    expect(rules.content).toContain("No markdown fences");
    const brief = JSON.parse(String(await read?.invoke({ id: "nonla_skill_tester_brief", reference: "job" }))) as { ok: boolean; content: string };
    expect(brief.content).toContain("nonla_run_job");
    expect(brief.content).toContain('{"passed":true|false,"notes":"..."}');
    const skillBrief = JSON.parse(String(await read?.invoke({ id: "nonla_skill_tester_brief", reference: "skill" }))) as { ok: boolean; error?: string };
    expect(skillBrief.ok).toBe(false);

    const datatable = jobTools.find((tool) => tool.name === "nonla_datatable");
    expect(datatable).toBeDefined();
    expect(datatable?.description).toContain("**list_projects**");
    expect(datatable?.description).toContain("**get_schema**");
    expect(datatable?.description).not.toContain("**insert**");
    expect(datatable?.description).not.toContain("**delete**");
  });

  test("core tools stay on for every agent, memory stays off for builtin agents", async () => {
    const { resolveSystemPrompt } = await import("../modules/agents/runtime/utils/buildSystemPrompt.js");
    const { resolveAgentTools } = await import("../modules/agents/runtime/utils/resolveTools.js");
    const { listAssignments } = await import("../modules/agents/agents.service.js");
    const core = ["nonla_agent_task", "nonla_get_current_time"];

    for (const id of ["nonla-bot", "nonla_agent_manager"] as const) {
      const prompt = await resolveSystemPrompt(id);
      expect(prompt).not.toContain("<memory_instructions>");
      expect(prompt).not.toContain("nonla_memory");

      const toolIds = (await listAssignments(id)).map((row) => row.toolId);
      const tools = await resolveAgentTools(id, toolIds, "user", false, { enableMemory: true });
      for (const name of core) {
        expect(tools.filter((tool) => tool.name === name)).toHaveLength(1);
      }
      expect(tools.some((tool) => tool.name === "nonla_memory")).toBe(false);
    }

    const bare = await resolveAgentTools("user-agent", [], "user", false, { enableMemory: true });
    for (const name of [...core, "nonla_memory"]) {
      expect(bare.filter((tool) => tool.name === name)).toHaveLength(1);
    }
    expect(bare.some((tool) => tool.name === "nonla_run_js")).toBe(false);
    const withJs = await resolveAgentTools("user-agent", ["builtin:nonla_run_js"], "user", false, { enableMemory: true });
    expect(withJs.filter((tool) => tool.name === "nonla_run_js")).toHaveLength(1);
    const noMemory = await resolveAgentTools("user-agent", [], "user", false, { enableMemory: false });
    expect(noMemory.some((tool) => tool.name === "nonla_memory")).toBe(false);
    expect(noMemory.some((tool) => tool.name === "nonla_get_current_time")).toBe(true);

    const userTools = await resolveAgentTools("user-agent", ["builtin:nonla_web_fetch", "builtin:nonla_manage_agents", "builtin:nonla_manage_secrets"], "user");
    expect(userTools.some((tool) => tool.name === "nonla_web_fetch")).toBe(true);
    expect(userTools.some((tool) => tool.name === "nonla_manage_agents")).toBe(false);
    expect(userTools.some((tool) => tool.name === "nonla_manage_secrets")).toBe(false);

    const botToolIds = (await listAssignments("nonla-bot")).map((row) => row.toolId);
    expect(botToolIds).not.toContain("builtin:nonla_manage_agent");
    expect(botToolIds).not.toContain("builtin:nonla_manage_datatable_projects");
    expect(botToolIds).not.toContain("builtin:nonla_manage_datatable_tables");
    expect(botToolIds).not.toContain("builtin:nonla_manage_datatable_schema");
    expect(botToolIds).not.toContain("builtin:nonla_manage_datatable_records");
    expect(botToolIds).toContain("builtin:nonla_manage_kv_entries");
    expect(botToolIds).toContain("builtin:nonla_manage_secrets");
    const botTools = await resolveAgentTools("nonla-bot", botToolIds, "user", false, { enableMemory: true });
    expect(botTools.some((tool) => tool.name.startsWith("nonla_manage_datatable_"))).toBe(false);
    expect(botTools.some((tool) => tool.name === "nonla_manage_agent")).toBe(false);
    expect(botTools.filter((tool) => tool.name === "nonla_manage_kv_entries")).toHaveLength(1);
    expect(botTools.filter((tool) => tool.name === "nonla_manage_secrets")).toHaveLength(1);

    const datatableToolIds = (await listAssignments("nonla_datatable_manager")).map((row) => row.toolId);
    expect(datatableToolIds).toEqual(expect.arrayContaining(["builtin:nonla_manage_datatable_projects", "builtin:nonla_manage_datatable_tables", "builtin:nonla_manage_datatable_schema", "builtin:nonla_manage_datatable_records"]));
    expect(datatableToolIds).not.toContain("builtin:nonla_manage_kv_entries");
    expect(datatableToolIds).not.toContain("builtin:nonla_manage_secrets");
    const datatableTools = await resolveAgentTools("nonla_datatable_manager", datatableToolIds, "user", false, { enableMemory: true });
    expect(datatableTools.filter((tool) => tool.name === "nonla_read_skill")).toHaveLength(1);
    expect(datatableTools.some((tool) => tool.name === "nonla_manage_datatable_records")).toBe(true);
    expect(datatableTools.some((tool) => tool.name === "nonla_manage_kv_entries")).toBe(false);
    expect(datatableTools.some((tool) => tool.name === "nonla_manage_secrets")).toBe(false);

    const managerToolIds = (await listAssignments("nonla_agent_manager")).map((row) => row.toolId);
    expect(managerToolIds).not.toContain("builtin:nonla_agent_instruct_writer");
    expect(managerToolIds).not.toContain("builtin:nonla_agent_instruct_reviewer");
    expect(managerToolIds).toContain("builtin:nonla_agent_task");
    expect(managerToolIds).not.toContain("builtin:nonla_save_system_prompt");
    expect(managerToolIds).toContain("builtin:nonla_get_system_prompt");
    expect(managerToolIds).toContain("builtin:nonla_edit_system_prompt");
    expect(managerToolIds).toContain("builtin:nonla_web_fetch");
    expect(managerToolIds).toContain("builtin:nonla_run_js");
    expect(managerToolIds).toContain("builtin:nonla_get_current_time");
    expect(managerToolIds).toContain("builtin:nonla_list_model_providers");
  });

  test("builtin agent catalog stays in code", () => {
    const catalog = builtinAgentCatalog();
    expect(catalog).toHaveLength(7);
    expect(catalog.filter((agent) => agent.kind === "manage").map((agent) => agent.name)).toEqual(["Agent Manager", "Tool Manager", "Skill Manager", "Site Manager", "Job Manager", "Datatable Manager"]);
    expect(catalog[0]?.id).toBe("nonla-bot");
  });

  test("GET /api/nonla-bot/tools — lists the assistant tools", async () => {
    const res = await authRequest(app, token, "GET", "/api/nonla-bot/tools");
    expect(res.status).toBe(200);
    const groups = (await res.json()) as { name: string; tools: { id: string; label: string }[] }[];
    const tools = groups.flatMap((group) => group.tools);
    expect(groups.map((group) => group.name)).toEqual(["Builtin", "MCP Servers", "KV Store", "Secrets", "Sub agents"]);
    const builtin = groups.find((group) => group.name === "Builtin");
    expect(builtin?.tools.map((tool) => tool.id)).toEqual(["nonla_web_fetch", "nonla_run_js", "nonla_get_current_time", "nonla_openui"]);
    expect(groups.find((group) => group.name === "KV Store")?.tools.map((tool) => tool.id)).toEqual(["nonla_manage_kv_entries"]);
    expect(groups.find((group) => group.name === "Secrets")?.tools.map((tool) => tool.id)).toEqual(["nonla_manage_secrets"]);
    const visible = [...NONLA_BUILTIN_TOOLS.filter((tool) => !("hidden" in tool && tool.hidden)), ...NONLA_SPECIALISTS];
    expect(tools.map((tool) => tool.id).sort()).toEqual(visible.map((tool) => tool.id).sort());
    expect(tools.map((tool) => tool.id)).not.toContain("nonla_goto_page");
    expect(groups.find((group) => group.name === "Agents")).toBeUndefined();
    expect(groups.find((group) => group.name === "Tools")).toBeUndefined();
    expect(groups.find((group) => group.name === "Skills")).toBeUndefined();
    expect(groups.find((group) => group.name === "Sites")).toBeUndefined();
    expect(groups.find((group) => group.name === "Jobs")).toBeUndefined();
    const subAgents = groups.find((group) => group.name === "Sub agents") as { tools: { id: string; label: string; uses?: { id: string; label: string }[] }[] } | undefined;
    expect(subAgents?.tools.map((tool) => tool.label)).toEqual(["Agent Manager", "Tool Manager", "Skill Manager", "Site Manager", "Job Manager", "Datatable Manager"]);
    expect(subAgents?.tools.find((tool) => tool.id === "nonla_agent_manager")?.uses?.map((use) => use.id)).toEqual([
      "nonla_manage_agents",
      "nonla_manage_agent",
      "nonla_manage_agent_teams",
      "nonla_list_model_providers",
      "nonla_agent_task",
      "nonla_get_system_prompt",
      "nonla_edit_system_prompt",
      "nonla_web_fetch",
      "nonla_run_js",
      "nonla_get_current_time",
      "nonla_openui",
    ]);
    expect(subAgents?.tools.find((tool) => tool.id === "nonla_tool_manager")?.uses?.map((use) => use.id)).toEqual([
      "nonla_manage_tools",
      "nonla_manage_tool_folders",
      "nonla_get_tool_code",
      "nonla_edit_tool_code",
      "nonla_run_tool",
      "nonla_search_npm",
      "nonla_web_fetch",
      "nonla_run_js",
      "nonla_get_current_time",
      "nonla_openui",
      "nonla_datatable",
    ]);
    expect(subAgents?.tools.find((tool) => tool.id === "nonla_skill_manager")?.uses?.map((use) => use.id)).toEqual([
      "nonla_manage_skills",
      "nonla_manage_skill_folders",
      "nonla_get_skill_files",
      "nonla_edit_skill_code",
      "nonla_delete_skill_file",
      "nonla_web_fetch",
      "nonla_run_js",
      "nonla_get_current_time",
      "nonla_openui",
    ]);
    expect(subAgents?.tools.find((tool) => tool.id === "nonla_site_manager")?.uses?.map((use) => use.id)).toEqual([
      "nonla_manage_sites",
      "nonla_get_site_code",
      "nonla_edit_site_code",
      "nonla_check_site",
      "nonla_agent_task",
      "nonla_web_fetch",
      "nonla_run_js",
      "nonla_get_current_time",
      "nonla_openui",
      "nonla_datatable",
    ]);
    expect(subAgents?.tools.find((tool) => tool.id === "nonla_job_manager")?.uses?.map((use) => use.id)).toEqual(["nonla_manage_jobs", "nonla_get_job_code", "nonla_edit_job_code", "nonla_run_job", "nonla_agent_task", "nonla_web_fetch", "nonla_run_js", "nonla_get_current_time", "nonla_openui", "nonla_datatable"]);
    expect(subAgents?.tools.find((tool) => tool.id === "nonla_datatable_manager")?.uses?.map((use) => use.id)).toEqual([
      "nonla_manage_datatable_projects",
      "nonla_manage_datatable_tables",
      "nonla_manage_datatable_schema",
      "nonla_manage_datatable_records",
      "nonla_web_fetch",
      "nonla_run_js",
      "nonla_get_current_time",
      "nonla_openui",
    ]);
    expect(groups.find((group) => group.name === "Datatables")).toBeUndefined();
    expect(tools.map((tool) => tool.id)).not.toContain("nonla_code_datatable");
    expect(subAgents?.tools.every((tool) => (tool.uses?.length ?? 0) > 0)).toBe(true);
    expect(
      tools.every(
        (tool) =>
          tool.id.startsWith("nonla_") ||
          tool.id === "search_npm" ||
          tool.id === "get_nonlaagents_guide" ||
          tool.id === "read_agent_instruct" ||
          tool.id === "read_skill_file" ||
          tool.id === "edit_skill_file" ||
          tool.id === "delete_skill_file" ||
          tool.id === "read_site_files" ||
          tool.id === "edit_site_files" ||
          tool.id === "check_site" ||
          tool.id === "preview_site" ||
          tool.id === "run_current_job" ||
          tool.id === "get_job_run",
      ),
    ).toBe(true);
    const ids = tools.map((tool) => tool.id);
    expect(ids).not.toContain("manage_skills");
    expect(ids).not.toContain("manage_sites");
    expect(ids).not.toContain("manage_jobs");
    expect(ids).not.toContain("code_tool");
  });

  test("list model providers, then create an agent with that model", async () => {
    const { createProvider } = await import("../modules/llm-providers/llm-providers.service.js");
    const provider = await createProvider({ provider: "openai", label: "OpenAI", apiKey: "sk-test", customBaseUrl: "", models: ["gpt-4.1"] });
    const listed = JSON.parse(String(await makeListModelProvidersTool().invoke({}))) as { ok: boolean; result: { id: string; models: string[]; hasApiKey: boolean }[] };
    expect(listed.ok).toBe(true);
    const row = listed.result.find((item) => item.id === provider?.id);
    expect(row?.models).toEqual(["gpt-4.1"]);
    expect(row?.hasApiKey).toBe(true);
    expect(JSON.stringify(listed.result)).not.toContain("sk-test");

    const manage = makeManageAgentsTool();
    const bad = JSON.parse(String(await manage.invoke({ action: "create", name: "No Model", body: { aiProvider: "missing", aiModel: "gpt-4.1" } }))) as { ok: boolean; error: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("nonla_list_model_providers");
    const created = JSON.parse(String(await manage.invoke({ action: "create", name: "With Model", body: { aiProvider: provider?.id, aiModel: "gpt-4.1" } }))) as { ok: boolean; result: { id: string; aiModel: string } };
    expect(created.ok).toBe(true);
    expect(created.result.aiModel).toBe("gpt-4.1");
    const wrongModel = JSON.parse(String(await manage.invoke({ action: "update", id: created.result.id, body: { aiModel: "nope" } }))) as { ok: boolean };
    expect(wrongModel.ok).toBe(false);
  });

  test("manage agent teams creates a team", async () => {
    const manage = makeManageTeamsTool();
    const raw = await manage.invoke({ action: "create", name: "Ops" });
    const parsed = JSON.parse(String(raw)) as { ok: boolean; result: { name: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.result.name).toBe("Ops");
  });

  test("agent manager tools cannot edit or delete builtin agents", async () => {
    const manage = makeManageAgentsTool();
    const oneAgent = makeManageAgentTool();
    const before = await getAgent("nonla-bot");
    const calls = [
      manage.invoke({ action: "update", id: "nonla-bot", body: { name: "Hacked" } }),
      manage.invoke({ action: "update", id: "nonla_agent_manager", body: { isActive: false } }),
      manage.invoke({ action: "update", id: "nonla-bot", body: { aiProvider: "provider-1", aiModel: "tool-model" } }),
      manage.invoke({ action: "delete", id: "nonla_tool_manager" }),
      oneAgent.invoke({ action: "set_assigned_tools", id: "nonla-bot", body: { toolIds: ["builtin:web_fetch"] } }),
      oneAgent.invoke({ action: "set_assigned_agents", id: "nonla-bot", body: { agentIds: [] } }),
      makeEditSystemPromptTool().invoke({ id: "nonla-bot", mode: "full", prompt: "Hacked." }),
    ];
    for (const raw of await Promise.all(calls)) {
      const result = JSON.parse(String(raw)) as { ok: boolean; error: string };
      expect(result.ok).toBe(false);
      expect(result.error).toContain("read-only");
    }
    const after = await getAgent("nonla-bot");
    expect(after?.name).toBe(before?.name);
    expect(after?.aiModel).toBe(before?.aiModel);
    expect(after?.systemPrompt).toBe(before?.systemPrompt);
    expect(after?.callableAgentIds).toEqual(before?.callableAgentIds);
    expect(await getAgent("nonla_tool_manager")).toBeTruthy();
    expect((await getAgent("nonla_agent_manager"))?.isActive).toBe(true);
  });

  test("manage_agents sets tools. System prompt edit writes systemPrompt", async () => {
    const manage = makeManageAgentsTool();
    const created = JSON.parse(String(await manage.invoke({ action: "create", name: "Helper" }))) as { ok: boolean; result: { id: string } };
    expect(created.ok).toBe(true);
    const prompted = JSON.parse(String(await manage.invoke({ action: "set_prompt", id: created.result.id, body: { systemPrompt: "Be brief." } }))) as { ok: boolean };
    expect(prompted.ok).toBe(false);
    const oneAgent = makeManageAgentTool();
    const oldSetTools = JSON.parse(String(await manage.invoke({ action: "set_tools", id: created.result.id, body: { toolIds: ["builtin:web_fetch"] } }))) as { ok: boolean };
    expect(oldSetTools.ok).toBe(false);
    const tools = JSON.parse(String(await oneAgent.invoke({ action: "set_assigned_tools", id: created.result.id, body: { toolIds: ["builtin:web_fetch"] } }))) as { ok: boolean; result: { toolId: string }[] };
    expect(tools.ok).toBe(true);
    expect(tools.result.map((row) => row.toolId)).toEqual(["builtin:nonla_web_fetch"]);
    const oldAction = JSON.parse(String(await manage.invoke({ action: "set_draft", id: created.result.id, body: { prompt: "x" } }))) as { ok: boolean };
    expect(oldAction.ok).toBe(false);
    const edited = JSON.parse(String(await makeEditSystemPromptTool().invoke({ id: created.result.id, mode: "full", prompt: "Be brief." }))) as { ok: boolean; result: { saved: boolean } };
    expect(edited.ok).toBe(true);
    expect(edited.result.saved).toBe(true);
    expect((await getAgent(created.result.id))?.systemPrompt).toBe("Be brief.");
    const replaced = JSON.parse(String(await makeEditSystemPromptTool().invoke({ id: created.result.id, mode: "replace", edits: [{ old_string: "brief", new_string: "short" }] }))) as { ok: boolean; result: { saved: boolean } };
    expect(replaced.ok).toBe(true);
    expect(replaced.result.saved).toBe(true);
    expect((await getAgent(created.result.id))?.systemPrompt).toBe("Be short.");
    const badReplace = JSON.parse(String(await makeEditSystemPromptTool().invoke({ id: created.result.id, mode: "replace", edits: [{ old_string: "missing text", new_string: "x" }] }))) as { ok: boolean };
    expect(badReplace.ok).toBe(false);
    await expect(makeEditSystemPromptTool().invoke({ id: created.result.id, mode: "replace" })).rejects.toThrow("edits");
    await makeEditSystemPromptTool().invoke({ id: created.result.id, mode: "replace", edits: [{ old_string: "short", new_string: "brief" }] });
    const loaded = JSON.parse(String(await makeGetSystemPromptTool().invoke({ id: created.result.id }))) as { ok: boolean; result: { id: string; systemPrompt: string } };
    expect(loaded.ok).toBe(true);
    expect(loaded.result.systemPrompt).toBe("Be brief.");
    const live = JSON.parse(String(await manage.invoke({ action: "get", id: created.result.id }))) as { ok: boolean; result: { systemPrompt: string | null } };
    expect(live.ok).toBe(true);
    expect(live.result.systemPrompt).toBe("Be brief.");
    const again = JSON.parse(String(await makeEditSystemPromptTool().invoke({ id: created.result.id, mode: "full", prompt: "Be brief." }))) as { ok: boolean; result: { saved: boolean } };
    expect(again.ok).toBe(true);
    expect(again.result.saved).toBe(false);
  });

  test("manage_agent lists options and sets tools, skills, and agents", async () => {
    const manage = makeManageAgentsTool();
    const one = makeManageAgentTool();
    const make = async (name: string) => (JSON.parse(String(await manage.invoke({ action: "create", name }))) as { result: { id: string } }).result.id;
    const run = async (input: Record<string, unknown>) => JSON.parse(String(await one.invoke(input))) as { ok: boolean; error?: string; result: any };
    const caller = await make("Caller");
    const callee = await make("Callee");
    const options = await run({ action: "list_available_tools" });
    expect(options.ok).toBe(true);
    expect(options.result.some((item: { id: string }) => item.id === "builtin:nonla_web_fetch")).toBe(true);
    expect(options.result.some((item: { id: string }) => item.id.startsWith("builtin:nonla_manage_"))).toBe(false);
    expect(options.result.some((item: { id: string }) => item.id === "builtin:nonla_agent_task")).toBe(false);
    const adminTool = await run({ action: "add_assigned_tools", id: caller, body: { toolIds: ["builtin:nonla_manage_agents"] } });
    expect(adminTool.ok).toBe(false);
    expect(adminTool.error).toContain("workspace admin tool");
    expect((await run({ action: "list_available_skills" })).ok).toBe(true);
    const badTools = await run({ action: "set_assigned_tools", id: caller, body: { toolIds: ["builtin:nonla_web_fetch", "mcp:nope:nothing", "does-not-exist"] } });
    expect(badTools.ok).toBe(false);
    expect(badTools.error).toContain("mcp:nope:nothing");
    expect((await run({ action: "set_assigned_tools", id: caller, body: { toolIds: ["builtin:nonla_web_fetch"] } })).ok).toBe(true);
    expect((await run({ action: "list_assigned_tools", id: caller })).result.map((item: { toolId: string }) => item.toolId)).toEqual(["builtin:nonla_web_fetch"]);
    expect((await run({ action: "list_assigned_tools", id: caller })).result[0].name).toBe("nonla_web_fetch");
    expect((await run({ action: "set_assigned_agents", id: caller, body: { agentIds: [caller] } })).ok).toBe(false);
    expect((await run({ action: "set_assigned_agents", id: caller, body: { agentIds: ["missing-agent"] } })).ok).toBe(false);
    const assigned = await run({ action: "set_assigned_agents", id: caller, body: { agentIds: [callee, callee] } });
    expect(assigned.ok).toBe(true);
    expect(assigned.result.callableAgentIds).toEqual([callee]);
    expect((await run({ action: "list_assigned_agents", id: caller })).result).toEqual([{ agentId: callee, name: "Callee", toolName: `nonla_call_agent__${callee.replace(/-/g, "_")}` }]);
    expect((await run({ action: "set_assigned_skills", id: caller, body: { skillIds: ["missing-skill"] } })).ok).toBe(false);
    expect((await run({ action: "set_assigned_skills", id: caller, body: { skillIds: [] } })).ok).toBe(true);
    expect((await run({ action: "list_assigned_skills", id: caller })).result).toEqual([]);
    const third = await make("Third");
    const added = await run({ action: "add_assigned_agents", id: caller, body: { agentIds: [third, callee] } });
    expect(added.result.callableAgentIds).toEqual([callee, third]);
    const removed = await run({ action: "remove_assigned_agents", id: caller, body: { agentIds: [callee, "not-assigned"] } });
    expect(removed.ok).toBe(true);
    expect(removed.result.callableAgentIds).toEqual([third]);
    expect((await run({ action: "add_assigned_agents", id: caller, body: { agentIds: ["missing-agent"] } })).ok).toBe(false);
    expect((await run({ action: "add_assigned_agents", id: caller, body: { agentIds: [caller] } })).ok).toBe(false);
    const addTool = await run({ action: "add_assigned_tools", id: caller, body: { toolIds: ["builtin:run_js", "builtin:nonla_web_fetch"] } });
    expect(addTool.result.map((item: { toolId: string }) => item.toolId).sort()).toEqual(["builtin:nonla_run_js", "builtin:nonla_web_fetch"]);
    const dropTool = await run({ action: "remove_assigned_tools", id: caller, body: { toolIds: ["builtin:run_js"] } });
    expect(dropTool.result.map((item: { toolId: string }) => item.toolId)).toEqual(["builtin:nonla_web_fetch"]);
    expect((await run({ action: "add_assigned_tools", id: caller, body: { toolIds: ["does-not-exist"] } })).ok).toBe(false);
    expect((await run({ action: "add_assigned_skills", id: caller, body: { skillIds: ["missing-skill"] } })).ok).toBe(false);
    expect((await run({ action: "remove_assigned_skills", id: caller, body: { skillIds: ["whatever"] } })).result).toEqual([]);
    expect((await run({ action: "list_assigned_tools" })).ok).toBe(false);
  });

  test("assistant tools include the workspace tools", () => {
    const all = makeNonlaBuiltinTools().map((tool) => tool.name);
    expect(all.every((name) => name.startsWith("nonla_"))).toBe(true);
    expect(all).toEqual(expect.arrayContaining(["nonla_web_fetch", "nonla_run_js", "nonla_get_current_time", "nonla_openui", "nonla_background_tasks", "nonla_manage_kv_entries"]));
    expect(all).not.toContain("nonla_kv_store");
    expect(all).toContain("nonla_manage_agents");
    expect(all).toContain("nonla_manage_tools");
    expect(all).toContain("nonla_manage_skills");
    expect(all).toContain("nonla_manage_jobs");
    expect(all).toContain("nonla_manage_sites");
    expect(all).not.toContain("nonla_approve_site_draft_code");
    expect(all).not.toContain("nonla_approve_job_draft_code");
    expect(all).not.toContain("nonla_list_sites");
    expect(all).not.toContain("nonla_create_site");
    expect(all).not.toContain("nonla_approve_site");
    expect(all).not.toContain("nonla_site_draft_writer");
    expect(all).not.toContain("nonla_site_writer");
    expect(all).toContain("nonla_edit_site_code");
    expect(all).not.toContain("nonla_approve_job");
    expect(all).not.toContain("nonla_list_tools");
    expect(all).not.toContain("nonla_create_tool");
    expect(all).not.toContain("nonla_list_skills");
    expect(all).not.toContain("nonla_create_skill");
    expect(all).not.toContain("nonla_list_jobs");
    expect(all).not.toContain("nonla_create_job");
    expect(all).not.toContain("nonla_skill_draft_writer");
    expect(all).not.toContain("nonla_approve_skill");
    expect(all).toContain("nonla_edit_skill_code");
    expect(all).toContain("nonla_delete_skill_file");
    expect(all).not.toContain("nonla_skill_draft_reviewer");
    expect(all).not.toContain("nonla_site_draft_reviewer");
    expect(all).not.toContain("nonla_job_draft_reviewer");
    expect(all).not.toContain("nonla_job_draft_writer");
    expect(all).not.toContain("nonla_run_draft_job");
    expect(all).toContain("nonla_edit_job_code");
    expect(all).not.toContain("nonla_tool_draft_code_reviewer");
    expect(all).not.toContain("nonla_writer");
    expect(all).not.toContain("nonla_code_skill");
    expect(all).toContain("nonla_manage_datatable_tables");
    expect(all).toContain("nonla_manage_datatable_schema");
    expect(all).toContain("nonla_manage_datatable_records");
    expect(all).toContain("nonla_manage_agent_teams");
    expect(all).toContain("nonla_list_model_providers");
    expect(all).not.toContain("nonla_save_system_prompt");
    expect(all).toContain("nonla_get_system_prompt");
    expect(all).toContain("nonla_edit_system_prompt");
    expect(all).not.toContain("nonla_approve_draft_instruct");
    expect(all).not.toContain("nonla_datatable");
    expect(all).not.toContain("nonla_read_skill");
    expect(all).not.toContain("nonla_get_nonlaagents_guide");
    expect(all).not.toContain("nonla_code_datatable");
    expect(all).not.toContain("manage_skills");
    expect(all).not.toContain("code_tool");
    expect(all).toContain("nonla_manage_agents");
    expect(all).not.toContain("nonla_agent_instruct_writer");
    expect(all).not.toContain("nonla_agent_instruct_reviewer");
    expect(all).toContain("nonla_goto_page");
    expect(all).not.toContain("nonla_tool_draft_code_writer");
    expect(all).not.toContain("nonla_approve_tool_draft_code");
    expect(all).toEqual(
      expect.arrayContaining(["nonla_get_tool_code", "nonla_edit_tool_code", "nonla_run_tool", "nonla_get_skill_files", "nonla_edit_skill_code", "nonla_delete_skill_file", "nonla_get_site_code", "nonla_edit_site_code", "nonla_check_site", "nonla_get_job_code", "nonla_edit_job_code", "nonla_run_job"]),
    );
    expect(all).toContain("nonla_manage_jobs");
    expect(all).not.toContain("nonla_list_jobs");
    expect(all).toContain("nonla_manage_sites");
    expect(all).not.toContain("nonla_approve_job_draft_code");
    expect(all).not.toContain("nonla_list_sites");
  });

  test("manage tool folders creates a folder and moves a tool", async () => {
    const folders = makeManageToolFoldersTool();
    const createdFolder = JSON.parse(String(await folders.invoke({ action: "create", name: "APIs", description: "HTTP tools" }))) as { ok: boolean; result: { id: string; name: string } };
    expect(createdFolder.ok).toBe(true);
    expect(createdFolder.result.name).toBe("APIs");

    const byName = Object.fromEntries(makeToolAdminTools().map((item) => [item.name, item]));
    const createdTool = JSON.parse(String(await byName.nonla_manage_tools.invoke({ action: "create", name: "folder_echo", description: "Echo", body: { folderId: createdFolder.result.id } }))) as { ok: boolean; result: { id: string } };
    expect(createdTool.ok).toBe(true);

    const listed = JSON.parse(String(await folders.invoke({ action: "list" }))) as { ok: boolean; result: { id: string; toolIds: string[] }[] };
    expect(listed.result.find((item) => item.id === createdFolder.result.id)?.toolIds).toContain(createdTool.result.id);

    const moved = JSON.parse(String(await folders.invoke({ action: "set_tool", body: { toolId: createdTool.result.id, folderId: null } }))) as { ok: boolean; result: { folderId: string | null } };
    expect(moved.ok).toBe(true);
    expect(moved.result.folderId).toBeNull();
  });

  test("manage skill folders creates a folder and moves a skill", async () => {
    const folders = makeManageSkillFoldersTool();
    const createdFolder = JSON.parse(String(await folders.invoke({ action: "create", name: "Writing", description: "Draft skills" }))) as { ok: boolean; result: { id: string; name: string } };
    expect(createdFolder.ok).toBe(true);
    expect(createdFolder.result.name).toBe("Writing");

    const createdSkill = JSON.parse(String(await makeManageSkillsTool().invoke({ action: "create", name: "Folder Skill", description: "Lives in a folder", body: { folderId: createdFolder.result.id } }))) as { ok: boolean; result: { id: string } };
    expect(createdSkill.ok).toBe(true);

    const listed = JSON.parse(String(await folders.invoke({ action: "list" }))) as { ok: boolean; result: { id: string; skillIds: string[] }[] };
    expect(listed.result.find((item) => item.id === createdFolder.result.id)?.skillIds).toContain(createdSkill.result.id);

    const moved = JSON.parse(String(await folders.invoke({ action: "set_skill", body: { skillId: createdSkill.result.id, folderId: null } }))) as { ok: boolean; result: { folderId: string | null } };
    expect(moved.ok).toBe(true);
    expect(moved.result.folderId).toBeNull();
  });

  test("tool admin can write code and run it", async () => {
    const byName = Object.fromEntries(makeToolAdminTools().map((item) => [item.name, item]));
    const source = ["// @name Echo", "// @description Echo hi", "export default async function main() {", '  return "hi";', "}", ""].join("\n");
    const created = JSON.parse(String(await byName.nonla_manage_tools.invoke({ action: "create", name: "echo_hi", description: "Echo hi", body: { codeContent: source } }))) as { ok: boolean; result: { id: string } };
    expect(created.ok).toBe(true);
    const written = JSON.parse(String(await byName.nonla_edit_tool_code.invoke({ id: created.result.id, mode: "full", code: source }))) as { ok: boolean };
    expect(written.ok).toBe(true);
    const read = JSON.parse(String(await byName.nonla_get_tool_code.invoke({ id: created.result.id }))) as { ok: boolean; result: { code: string } };
    expect(read.ok).toBe(true);
    expect(read.result.code).toContain('return "hi"');
    const before = await getTool(created.result.id);
    expect(before?.codeContent).toContain('return "hi"');
    const edited = JSON.parse(String(await byName.nonla_edit_tool_code.invoke({ id: created.result.id, mode: "replace", edits: [{ old_string: 'return "hi";', new_string: 'return "yo";' }] }))) as { ok: boolean };
    expect(edited.ok).toBe(true);
    const ran = JSON.parse(String(await byName.nonla_run_tool.invoke({ id: created.result.id, testInput: {} }))) as { ok: boolean; result: { success: boolean; output: unknown } };
    expect(ran.ok).toBe(true);
    expect(ran.result.success).toBe(true);
    expect(ran.result.output).toBe("yo");
    const live = await getTool(created.result.id);
    expect(live?.codeContent).toContain('return "yo"');
    expect(byName.nonla_approve_tool_draft_code).toBeUndefined();
  });

  test("site admin can edit code and check it", async () => {
    const byName = Object.fromEntries(makeSiteAdminTools().map((item) => [item.name, item]));
    const created = JSON.parse(String(await byName.nonla_manage_sites.invoke({ action: "create", name: "Edit Site" }))) as { ok: boolean; result: { id: string } };
    expect(created.ok).toBe(true);
    const css = "body { color: steelblue; }\n";
    const written = JSON.parse(String(await byName.nonla_edit_site_code.invoke({ id: created.result.id, file: "styles.css", mode: "full", content: css }))) as { ok: boolean };
    expect(written.ok).toBe(true);
    const read = JSON.parse(String(await byName.nonla_get_site_code.invoke({ id: created.result.id, file: "styles.css" }))) as { ok: boolean; result: { code: string } };
    expect(read.ok).toBe(true);
    expect(read.result.code).toContain("steelblue");
    const edited = JSON.parse(String(await byName.nonla_edit_site_code.invoke({ id: created.result.id, file: "styles.css", mode: "replace", edits: [{ old_string: "steelblue", new_string: "tomato" }] }))) as { ok: boolean };
    expect(edited.ok).toBe(true);
    const again = JSON.parse(String(await byName.nonla_get_site_code.invoke({ id: created.result.id, file: "styles.css" }))) as { ok: boolean; result: { code: string } };
    expect(again.result.code).toContain("tomato");
    const checked = JSON.parse(String(await byName.nonla_check_site.invoke({ id: created.result.id }))) as { ok: boolean };
    expect(checked.ok).toBe(true);
    expect(byName.nonla_site_writer).toBeUndefined();
  });

  test("job admin can edit code and run it", async () => {
    const byName = Object.fromEntries(makeJobAdminTools().map((item) => [item.name, item]));
    const created = JSON.parse(String(await byName.nonla_manage_jobs.invoke({ action: "create", name: "Edit Job" }))) as { ok: boolean; result: { id: string } };
    expect(created.ok).toBe(true);
    const source = "export const value = 1;\n";
    const written = JSON.parse(String(await byName.nonla_edit_job_code.invoke({ id: created.result.id, mode: "full", code: source }))) as { ok: boolean };
    expect(written.ok).toBe(true);
    const read = JSON.parse(String(await byName.nonla_get_job_code.invoke({ id: created.result.id }))) as { ok: boolean; result: { code: string } };
    expect(read.ok).toBe(true);
    expect(read.result.code).toContain("value = 1");
    const edited = JSON.parse(String(await byName.nonla_edit_job_code.invoke({ id: created.result.id, mode: "replace", edits: [{ old_string: "value = 1", new_string: "value = 2" }] }))) as { ok: boolean };
    expect(edited.ok).toBe(true);
    expect((await getJob(created.result.id))?.code).toContain("value = 2");
    const ran = JSON.parse(String(await byName.nonla_run_job.invoke({ id: created.result.id }))) as { ok: boolean; result: { success: boolean } };
    expect(ran.ok).toBe(true);
    expect(ran.result.success).toBe(true);
    expect(byName.nonla_job_draft_writer).toBeUndefined();
  });

  test("page path becomes the job for that screen", () => {
    const tool = resolveNonlaPage("/tools/tool-1?x=1");
    expect(tool.title).toBe("Tool editor");
    expect(tool.task).toContain("tool-1");
    expect(tool.task).toContain("nonla_call_agent__nonla_tool_manager");
    expect(resolveNonlaPage("/skills/skill-1").task).toContain("nonla_call_agent__nonla_skill_manager");
    expect(resolveNonlaPage("/sites/site-1").task).toContain("nonla_call_agent__nonla_site_manager");
    expect(resolveNonlaPage("/jobs/job-1/schedules").task).toContain("nonla_call_agent__nonla_job_manager");
    expect(tool.path).toBe("/tools/tool-1");

    const dashboard = resolveNonlaPage("/");
    expect(dashboard.title).toBe("Dashboard");

    const rows = resolveNonlaPage("/datatables/proj/schema");
    expect(rows.title).toBe("Datatable schema");
    expect(rows.task).toContain("proj");
    expect(rows.task).toContain("nonla_call_agent__nonla_datatable_manager");
    expect(resolveNonlaPage("/kvstore").task).toContain("nonla_manage_kv_entries");
    expect(resolveNonlaPage("/secrets").task).toContain("nonla_manage_secrets");
    expect(rows.task).not.toContain("nonla_manage_datatable_schema");
    expect(rows.task).not.toContain("nonla_code_datatable");

    const block = formatNonlaPageBlock("/agents/agent-9/canvas");
    expect(block).toContain("Agent canvas");
    expect(block).toContain("agent-9");
    expect(formatNonlaPageBlock("")).toBe("");
    expect(resolveNonlaPage("/tools/../../etc").path).toBe("/");
  });

  test("goto_page only opens app screens", async () => {
    expect(appPathForGoto("/tools/tool-1")).toBe("/tools/tool-1");
    expect(appPathForGoto("https://evil.example/tools/tool-1")).toBeNull();
    expect(appPathForGoto("/tools/../secrets")).toBeNull();
    const goto = makeGotoPageTool();
    const opened = JSON.parse(String(await goto.invoke({ path: "/tools/tool-1" }))) as { ok: boolean; path: string };
    expect(opened).toEqual({ ok: true, path: "/tools/tool-1" });
    const blocked = JSON.parse(String(await goto.invoke({ path: "https://evil.example" }))) as { ok: boolean };
    expect(blocked.ok).toBe(false);
  });

  test("create ignores caller source and live edit writes content at once", async () => {
    const skill = JSON.parse(String(await makeManageSkillsTool().invoke({ action: "create", name: "Live Skill", description: "A live skill", body: { content: "CALLER_MARKDOWN" } }))) as { ok: boolean; result: { id: string } };
    expect(skill.ok).toBe(true);
    expect((await getSkill(skill.result.id))?.content).not.toContain("CALLER_MARKDOWN");
    const body = "# Live Skill\n\nDo the live thing.\n";
    await writeSkillPath(skill.result.id, "SKILL.md", body);
    expect((await getSkill(skill.result.id))?.content).toContain("Do the live thing.");
    const edited = JSON.parse(
      String(
        await makeEditSkillCodeTool().invoke({
          id: skill.result.id,
          path: "SKILL.md",
          mode: "full",
          content: "# Live Skill\n\nUpdated live body.\n",
        }),
      ),
    ) as { ok: boolean };
    expect(edited.ok).toBe(true);
    expect((await getSkill(skill.result.id))?.content).toContain("Updated live body.");

    const job = JSON.parse(String(await makeManageJobsTool().invoke({ action: "create", name: "Draft Job", body: { code: "CALLER_CODE" } }))) as { ok: boolean; result: { id: string } };
    expect(job.ok).toBe(true);
    expect((await getJob(job.result.id))?.code).not.toContain("CALLER_CODE");
    await saveJobCode(job.result.id, "export const ready = true;\n");
    expect((await getJob(job.result.id))?.code).toContain("export const ready = true;");

    const site = JSON.parse(String(await makeManageSitesTool().invoke({ action: "create", name: "Draft Site", body: { content: "CALLER_TSX" } }))) as { ok: boolean; error?: string; result: { id: string } };
    expect(site.ok).toBe(true);
    await updateSiteFile(site.result.id, "styles.css", "body { color: rebeccapurple; }\n", "prod");
    const { readSourceFile } = await import("../modules/sites/sites-fs.js");
    expect(readSourceFile(site.result.id, "prod", "styles.css")).toContain("rebeccapurple");
    expect(readSourceFile(site.result.id, "draft", "styles.css")).toContain("rebeccapurple");
  });

  test("id based read tools return the live content", async () => {
    const skill = JSON.parse(String(await makeManageSkillsTool().invoke({ action: "create", name: "Id Skill", description: "Reads by id" }))) as { result: { id: string } };
    await writeSkillPath(skill.result.id, "SKILL.md", "# Id Skill\n\nFresh live text.\n");
    const index = JSON.parse(String(await makeGetSkillFilesTool().invoke({ id: skill.result.id }))) as { ok: boolean; index: { path: string; lines: number; title: string }[] };
    expect(index.ok).toBe(true);
    expect(index.index.find((entry) => entry.path === "SKILL.md")?.title).toBe("Id Skill");
    const body = JSON.parse(String(await makeGetSkillFilesTool().invoke({ id: skill.result.id, paths: ["SKILL.md"] }))) as { ok: boolean; files: { content: string }[] };
    expect(body.files[0]?.content).toContain("Fresh live text.");
    const noId = JSON.parse(String(await makeGetSkillFilesTool().invoke({ id: " " }))) as { ok: boolean; error: string };
    expect(noId.ok).toBe(false);

    const site = JSON.parse(String(await makeManageSitesTool().invoke({ action: "create", name: "Id Site" }))) as { result: { id: string } };
    await updateSiteFile(site.result.id, "styles.css", "body { color: tomato; }\n", "prod");
    const css = JSON.parse(String(await makeGetSiteCodeTool().invoke({ id: site.result.id, file: "styles.css" }))) as { ok: boolean; result: { code: string } };
    expect(css.ok).toBe(true);
    expect(css.result.code).toContain("tomato");
    expect(makeCheckSiteLiveTool().name).toBe("nonla_check_site");

    const job = JSON.parse(String(await makeManageJobsTool().invoke({ action: "create", name: "Id Job" }))) as { result: { id: string } };
    await saveJobCode(job.result.id, "export const marker = 42;\n");
    const jobCode = JSON.parse(String(await makeGetJobCodeTool().invoke({ id: job.result.id }))) as { ok: boolean; result: { code: string } };
    expect(jobCode.ok).toBe(true);
    expect(jobCode.result.code).toContain("marker = 42");
    const blank = JSON.parse(String(await makeManageJobsTool().invoke({ action: "create", name: "Blank Job" }))) as { result: { id: string } };
    const ran = JSON.parse(String(await makeRunJobTool().invoke({ id: blank.result.id }))) as { ok: boolean; result: { success: boolean; status: string; runId: string } };
    expect(ran.ok).toBe(true);
    expect(ran.result.success).toBe(true);
    expect(ran.result.status).toBe("success");
    expect(ran.result.runId).toBeTruthy();
    const missing = JSON.parse(String(await makeRunJobTool().invoke({ id: "missing-job" }))) as { ok: boolean; error: string };
    expect(missing.ok).toBe(false);
  });

  test("datatable manager has no skill and its schema tool carries the design rules", async () => {
    const { resolveAgentTools } = await import("../modules/agents/runtime/utils/resolveTools.js");
    const { listAssignments } = await import("../modules/agents/agents.service.js");
    const toolIds = (await listAssignments("nonla_datatable_manager")).map((row) => row.toolId);
    const tools = await resolveAgentTools("nonla_datatable_manager", toolIds, "owner");
    const read = tools.find((item) => item.name === "nonla_read_skill");
    const gone = JSON.parse(String(await read?.invoke({ id: "nonla_skill_datatable_schema" }))) as { ok: boolean };
    expect(gone.ok).toBe(false);
    const schema = tools.find((item) => item.name === "nonla_manage_datatable_schema");
    expect(schema?.description).toContain("[a-z][a-z0-9_]*");
    expect(schema?.description).toContain("op update");
    expect(schema?.description).toContain("select (needs options)");
  });

  test("tested follows the specialist tool result", () => {
    const messages = [
      { type: "tool", name: "edit_skill_file", content: JSON.stringify({ ok: true }) },
      { type: "tool", name: "check_site", content: JSON.stringify({ ok: false }) },
      { type: "tool", name: "check_site", content: JSON.stringify({ ok: true }) },
      { type: "tool", name: "get_job_run", content: JSON.stringify({ ok: true, run: { status: "success" } }) },
    ];
    expect(anyToolOk(messages, "edit_skill_file")).toBe(true);
    expect(anyToolOk(messages, "generate_prompt")).toBe(false);
    expect(toolPayloads(messages, "check_site").at(-1)?.ok).toBe(true);
    expect((toolPayloads(messages, "get_job_run").at(-1)?.run as { status: string }).status).toBe("success");
  });
});
