import { describe, expect, test } from "bun:test";
import { type CallAgentStep, activityParentId, createChildActivityEmitter, currentCallAgentSink, feedChildActivity, nestChildStep, popCallAgentSink, pushCallAgentSink, readParentToolCallId } from "../common/ai/call-agent-activity.js";

describe("nestChildStep", () => {
  test("puts a child step inside the invoke tool step", () => {
    const steps: CallAgentStep[] = [{ id: "invoke-1", kind: "tool", name: "nonla_agent_task", input: { prompt: "write" } }];
    const nested = nestChildStep(steps, "invoke-1", { id: "edit-1", kind: "tool", name: "edit_code", input: { path: "a.ts" } });
    expect(nested?.[0]?.activity).toEqual([{ id: "edit-1", kind: "tool", name: "edit_code", input: { path: "a.ts" } }]);
    expect(nested).toHaveLength(1);
  });

  test("returns null when the host step is missing", () => {
    expect(nestChildStep([], "missing", { id: "edit-1", kind: "tool", name: "edit_code" })).toBeNull();
  });
});

describe("activityParentId", () => {
  test("keeps a known id and falls back to the open parent", () => {
    const known = (id: string) => id === "sub";
    expect(activityParentId(known, "sub", "sub")).toBe("sub");
    expect(activityParentId(known, "sub", "inner-tool")).toBe("sub");
    expect(activityParentId(known, null, "inner-tool")).toBeNull();
  });
});

describe("createChildActivityEmitter", () => {
  test("keeps one text bubble, then tools, then a new bubble", async () => {
    const steps: CallAgentStep[] = [];
    const emit = createChildActivityEmitter((step) => {
      steps.push({ ...step });
    });

    await emit({ content: "Hello " });
    await emit({ content: "Hello world" });
    await emit({ tool_call_chunks: [{ id: "c1", name: "lookup", args: '{"q":"a"}' }] });
    await emit({ _getType: () => "tool", name: "lookup", tool_call_id: "c1", content: '{"ok":true}' });
    await emit({ content: "Done" });

    const texts = steps.filter((step) => step.kind === "text");
    expect(texts[0]?.id).toBe(texts[1]?.id);
    expect(texts[1]?.text).toBe("Hello world");
    expect(steps.find((step) => step.id === "c1" && step.output != null)?.output).toEqual({ ok: true });
    expect(texts.at(-1)?.text).toBe("Done");
    expect(texts.at(-1)?.id).not.toBe(texts[0]?.id);
  });

  test("updates mode adds the tool call and its result, not a second copy of the text", async () => {
    const steps: CallAgentStep[] = [];
    const emit = createChildActivityEmitter((step) => {
      const idx = steps.findIndex((item) => item.id === step.id);
      if (idx === -1) steps.push({ ...step });
      else steps[idx] = { ...steps[idx], ...step };
    });

    await feedChildActivity(emit, "messages", [{ content: "Looking up the agent." }]);
    await feedChildActivity(emit, "updates", {
      agent: {
        messages: [{ type: "ai", content: "Looking up the agent.", tool_calls: [{ id: "c1", name: "get_agent", args: { id: "a1" } }] }],
      },
    });
    await feedChildActivity(emit, "updates", {
      tools: {
        messages: [{ _getType: () => "tool", name: "get_agent", tool_call_id: "c1", content: '{"name":"Ada"}' }],
      },
    });

    expect(steps.filter((step) => step.kind === "text")).toHaveLength(1);
    expect(steps.find((step) => step.id === "c1")).toMatchObject({ name: "get_agent", input: { id: "a1" }, output: { name: "Ada" } });
  });

  test("keeps the parent sink without AsyncLocalStorage", () => {
    expect(currentCallAgentSink()).toBeUndefined();
    const sink = { emit: () => {} };
    pushCallAgentSink(sink);
    expect(currentCallAgentSink()).toBe(sink);
    popCallAgentSink();
    expect(currentCallAgentSink()).toBeUndefined();
  });

  test("reads a tool_use block from the child message", async () => {
    const steps: CallAgentStep[] = [];
    const emit = createChildActivityEmitter((step) => {
      steps.push({ ...step });
    });
    await emit({ content: [{ type: "tool_use", id: "tu1", name: "list_agents", input: { limit: 5 } }] });
    expect(steps.at(-1)).toMatchObject({ id: "tu1", kind: "tool", name: "list_agents", input: { limit: 5 } });
  });

  test("reads the parent tool call id from either field", () => {
    expect(readParentToolCallId({ toolCallId: "call-1" })).toBe("call-1");
    expect(readParentToolCallId({ toolCall: { id: "call-2" } })).toBe("call-2");
    expect(readParentToolCallId({})).toBeUndefined();
  });
});
