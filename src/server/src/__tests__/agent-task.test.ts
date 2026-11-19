import { describe, expect, test } from "bun:test";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { parseReviewScore } from "../modules/agents/prompt-agent/prompt-agent.service.js";
import { makeAgentTaskTool, pickAgentTaskModel, toolsForAgentTask } from "../modules/agents/runtime/llm-tools/agent-task.tool.js";

function namedTool(name: string) {
  return tool(async () => "ok", { name, description: name, schema: z.object({}) });
}

const PROVIDER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROVIDER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("pickAgentTaskModel", () => {
  const providers = [
    { id: PROVIDER_A, models: ["gpt-4o", "openai/gpt-4o"] },
    { id: PROVIDER_B, models: ["gpt-4o"] },
  ];

  test("inherit and an omitted model use the parent model", () => {
    expect(pickAgentTaskModel(undefined, providers, { providerId: PROVIDER_A, modelId: "gpt-4o" })).toEqual({
      providerId: PROVIDER_A,
      modelId: "gpt-4o",
    });
    expect(pickAgentTaskModel("inherit", providers, { providerId: PROVIDER_A, modelId: "gpt-4o" })).toEqual({
      providerId: PROVIDER_A,
      modelId: "gpt-4o",
    });
    expect(pickAgentTaskModel("  ", providers, { providerId: PROVIDER_B, modelId: "gpt-4o" })).toEqual({
      providerId: PROVIDER_B,
      modelId: "gpt-4o",
    });
  });

  test("unique model id picks that provider", () => {
    expect(pickAgentTaskModel("openai/gpt-4o", providers, { providerId: PROVIDER_B, modelId: "gpt-4o" })).toEqual({
      providerId: PROVIDER_A,
      modelId: "openai/gpt-4o",
    });
  });

  test("shared model id prefers the parent provider", () => {
    expect(pickAgentTaskModel("gpt-4o", providers, { providerId: PROVIDER_B, modelId: "other" })).toEqual({
      providerId: PROVIDER_B,
      modelId: "gpt-4o",
    });
  });

  test("providerId/modelId selects that provider even when the model id contains a slash", () => {
    expect(pickAgentTaskModel(`${PROVIDER_A}/openai/gpt-4o`, providers, {})).toEqual({
      providerId: PROVIDER_A,
      modelId: "openai/gpt-4o",
    });
  });

  test("unknown model throws", () => {
    expect(() => pickAgentTaskModel("missing-model", providers, { providerId: PROVIDER_A, modelId: "gpt-4o" })).toThrow("not on a configured provider");
  });
});

describe("parseReviewScore", () => {
  test("reads a score and notes from the reviewer text", () => {
    expect(parseReviewScore('{"score": 9, "notes": "Ready."}')).toEqual({ score: 9, notes: "Ready." });
  });

  test("reads a score wrapped in the agent task result", () => {
    const raw = JSON.stringify({ success: true, response: '{"score": 6, "notes": "Add the tool list."}' });
    expect(parseReviewScore(raw)).toEqual({ score: 6, notes: "Add the tool list." });
  });

  test("a missing score is not a pass", () => {
    expect(parseReviewScore("looks fine")).toEqual({ score: 0, notes: "looks fine" });
  });
});

describe("toolsForAgentTask", () => {
  test("the agent task gets every parent tool except itself", () => {
    const parent = [namedTool("nonla_manage_agents"), namedTool("nonla_web_fetch"), namedTool("nonla_get_system_prompt"), namedTool("nonla_edit_system_prompt"), namedTool("nonla_agent_task")];
    expect(toolsForAgentTask(parent).map((item) => item.name)).toEqual(["nonla_manage_agents", "nonla_web_fetch", "nonla_get_system_prompt", "nonla_edit_system_prompt"]);
  });
});

describe("agent task tool", () => {
  test("blank prompt returns an error and does not call a model", async () => {
    const agentTask = makeAgentTaskTool({
      parentTools: [],
      callerAgentId: "agent-1",
      providerId: PROVIDER_A,
      modelId: "gpt-4o",
    });
    const raw = await agentTask.invoke({ name: "Writer", prompt: "   ", model: "gpt-4o" });
    const parsed = JSON.parse(String(raw)) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("prompt is required");
  });
});
