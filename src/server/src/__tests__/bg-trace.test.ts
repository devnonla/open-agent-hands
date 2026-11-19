import { afterEach, describe, expect, test } from "bun:test";
import { createActivityTrace } from "../common/ai/call-agent-activity.js";
import { settleCallAgentWork } from "../modules/agents/runtime/llm-tools/call-agent.tool.js";
import { bgTaskRegistry } from "../modules/tools/common/bg-task-registry.js";

describe("detached run trace", () => {
  afterEach(() => bgTaskRegistry._reset());

  test("steps and child conversation reach the registry after detach", async () => {
    const trace = createActivityTrace();
    const abort = new AbortController();
    let finish: (value: { success: boolean; agent_id: string; response: string | null; error: string | null }) => void = () => {};
    const work = new Promise<{ success: boolean; agent_id: string; response: string | null; error: string | null }>((resolve) => {
      finish = resolve;
    });

    trace.push({ id: "t1", kind: "tool", name: "web_fetch", input: { url: "x" } });
    const out = await settleCallAgentWork({ work, abort, softWaitMs: 0, toolId: "agent-task", toolName: "Agent Task", targetId: "Reviewer", conversationId: "conv-1", label: "Reviewer", trace });
    const ref = JSON.parse(out) as { status: string; taskId: string };
    expect(ref.status).toBe("running");

    trace.setConversationId("child-1");
    trace.push({ id: "t1", kind: "tool", name: "web_fetch", output: { ok: true } });
    trace.push({ id: "x1", kind: "text", text: "done soon" });

    const snap = bgTaskRegistry.get(ref.taskId);
    expect(snap?.label).toBe("Reviewer");
    expect(snap?.childConversationId).toBe("child-1");
    expect(snap?.activity?.map((s) => s.id)).toEqual(["t1", "x1"]);
    expect(snap?.activity?.[0]?.output).toEqual({ ok: true });

    finish({ success: true, agent_id: "agent-task", response: "ok", error: null });
    const done = await bgTaskRegistry.await(ref.taskId, 1000);
    expect(done.status).toBe("completed");
  });
});
