import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import {
  CALL_AGENT_TOOL_PREFIX,
  type CallAgentOutcome,
  attachCalledConversation,
  callAgentArgsSchema,
  callAgentToolName,
  callConversationTitle,
  closeCallAgentConversation,
  isCallAgentToolName,
  normalizeCallAgentArgs,
  openCallAgentConversation,
  parseCallAgentToolTargetId,
  settleCallAgentWork,
} from "../modules/agents/runtime/llm-tools/call-agent.tool.js";
import { rememberTranscriptStep, saveCalledAgentTranscript, syncCalledAgentTranscript } from "../modules/agents/runtime/utils/save-call-transcript.js";
import { createMessage } from "../modules/conversations/conversations.service.js";
import { bgTaskRegistry } from "../modules/tools/common/bg-task-registry.js";
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

function pendingOutcome(): {
  work: Promise<CallAgentOutcome>;
  resolve: (value: CallAgentOutcome) => void;
} {
  let resolve!: (value: CallAgentOutcome) => void;
  const work = new Promise<CallAgentOutcome>((r) => {
    resolve = r;
  });
  return { work, resolve };
}

const ok = (response: string, agentId = "agent-target"): CallAgentOutcome => ({
  success: true,
  agent_id: agentId,
  response,
  error: null,
});

describe("call_agent names", () => {
  test("new tools use the nonla_ prefix", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    expect(callAgentToolName(uuid)).toBe(`${CALL_AGENT_TOOL_PREFIX}11111111_2222_3333_4444_555555555555`);
    expect(isCallAgentToolName(callAgentToolName(uuid))).toBe(true);
    expect(parseCallAgentToolTargetId(callAgentToolName(uuid))).toBe(uuid);
  });

  test("old call_agent__ names still parse", () => {
    const legacy = "call_agent__11111111_2222_3333_4444_555555555555";
    expect(isCallAgentToolName(legacy)).toBe(true);
    expect(parseCallAgentToolTargetId(legacy)).toBe("11111111-2222-3333-4444-555555555555");
  });

  test("builtin ids stay as written after the prefix", () => {
    expect(callAgentToolName("nonla_agent_instruct_writer")).toBe("nonla_call_agent__nonla_agent_instruct_writer");
    expect(parseCallAgentToolTargetId("nonla_call_agent__nonla_agent_instruct_writer")).toBe("nonla_agent_instruct_writer");
    expect(parseCallAgentToolTargetId("nonla_call_agent__nonla_bot")).toBe("nonla-bot");
  });
});

describe("call_agent args", () => {
  test("message stays message", () => {
    expect(normalizeCallAgentArgs({ message: "Tạo agent", context: "team Invest" })).toEqual({
      message: "Tạo agent",
      context: "team Invest",
    });
  });

  test("input is accepted as the task", () => {
    const parsed = callAgentArgsSchema.parse({ input: "Tạo một agent mới" }) as { message: string };
    expect(parsed.message).toBe("Tạo một agent mới");
  });

  test("a raw string is accepted as the task", () => {
    const parsed = callAgentArgsSchema.parse("Tạo agent") as { message: string };
    expect(parsed.message).toBe("Tạo agent");
  });
});

describe("call_agent soft-wait", () => {
  afterEach(() => {
    bgTaskRegistry._reset();
  });

  test("completes within soft-wait returns outcome JSON", async () => {
    const abort = new AbortController();
    const out = await settleCallAgentWork({
      work: Promise.resolve(ok("hello")),
      abort,
      softWaitMs: 5_000,
      toolId: "call-agent:agent-target",
      toolName: "Call Reviewer",
      targetId: "agent-target",
      agentId: "agent-caller",
    });
    const parsed = JSON.parse(out) as CallAgentOutcome;
    expect(parsed.success).toBe(true);
    expect(parsed.response).toBe("hello");
    expect(parsed.agent_id).toBe("agent-target");
    expect(bgTaskRegistry.list()).toHaveLength(0);
  });

  test("exceeds soft-wait detaches then await completes", async () => {
    const abort = new AbortController();
    const { work, resolve } = pendingOutcome();
    const out = await settleCallAgentWork({
      work,
      abort,
      softWaitMs: 40,
      toolId: "call-agent:agent-target",
      toolName: "Call Reviewer",
      targetId: "agent-target",
      agentId: "agent-caller",
      conversationId: "conv-1",
    });
    const parsed = JSON.parse(out) as { status: string; taskId: string; agent_id: string };
    expect(parsed.status).toBe("running");
    expect(parsed.agent_id).toBe("agent-target");
    expect(typeof parsed.taskId).toBe("string");

    const listed = bgTaskRegistry.list({ conversationId: "conv-1" });
    expect(listed.some((t) => t.taskId === parsed.taskId)).toBe(true);

    resolve(ok("done later"));
    const finished = await bgTaskRegistry.await(parsed.taskId, 5_000);
    expect(finished.status).toBe("completed");
    expect(finished.result).toEqual(ok("done later"));
  });

  test("cancel aborts a detached call_agent", async () => {
    const abort = new AbortController();
    const { work } = pendingOutcome();
    const out = await settleCallAgentWork({
      work,
      abort,
      softWaitMs: 40,
      toolId: "call-agent:agent-target",
      toolName: "Call Reviewer",
      targetId: "agent-target",
    });
    const parsed = JSON.parse(out) as { status: string; taskId: string };
    expect(parsed.status).toBe("running");

    const cancelled = bgTaskRegistry.cancel(parsed.taskId);
    expect(cancelled?.status).toBe("cancelled");
    expect(abort.signal.aborted).toBe(true);
  });
});

describe("call_agent history", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;
  let ownerId: string;
  let callerId: string;
  let targetId: string;

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    const admin = await setupAdmin(app);
    token = admin.token;
    ownerId = admin.user.id as string;
    const caller = (await (await authRequest(app, token, "POST", "/api/agents", { name: "Nonla Bot" })).json()) as { id: string };
    const target = (await (await authRequest(app, token, "POST", "/api/agents", { name: "Agent Manager" })).json()) as { id: string };
    callerId = caller.id;
    targetId = target.id;
  });

  afterAll(() => cleanup());

  test("title names the caller and the task", () => {
    expect(callConversationTitle("Nonla Bot", "Tạo agent chứng khoán\nchi tiết")).toBe("Nonla Bot: Tạo agent chứng khoán");
  });

  test("a call shows up in the target agent's history", async () => {
    const conversationId = await openCallAgentConversation({
      targetId,
      callerAgentId: callerId,
      callerName: "Nonla Bot",
      task: "Tạo agent chứng khoán",
      ownerId,
    });
    expect(conversationId).toBeTruthy();
    await closeCallAgentConversation(conversationId, targetId, { text: "id: agent-1, team: Invest", error: null });

    const listed = (await (await authRequest(app, token, "GET", `/api/conversations?agentId=${targetId}`)).json()) as { items: { id: string; title: string; agentId: string; status: string }[] };
    expect(listed.items.some((item) => item.id === conversationId && item.agentId === targetId && item.status === "done")).toBe(true);

    const messages = (await (await authRequest(app, token, "GET", `/api/conversations/${conversationId}/messages`)).json()) as { role: string; content: string }[];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]?.content).toBe("Tạo agent chứng khoán");
    expect(messages[1]?.content).toContain("agent-1");
  });

  test("a called agent history keeps the tools it ran", async () => {
    const conversationId = await openCallAgentConversation({
      targetId,
      callerAgentId: callerId,
      callerName: "Nonla Bot",
      task: "Tạo tool giá xăng",
      ownerId,
    });
    expect(conversationId).toBeTruthy();
    await saveCalledAgentTranscript({
      conversationId: conversationId as string,
      agentId: targetId,
      finalText: "Kết quả cuối đầy đủ hơn bản nháp",
      steps: [
        { id: "text-1", kind: "text", text: "Không có tool giá xăng." },
        { id: "tool-1", kind: "tool", name: "nonla_manage_tools", input: { action: "list" }, output: { ok: true } },
        {
          id: "tool-2",
          kind: "tool",
          name: "nonla_agent_task",
          input: { prompt: "viết code" },
          output: { success: false, error: "not approved" },
          activity: [{ id: "w1", kind: "tool", name: "nonla_edit_code", input: { code: "x" }, output: "saved" }],
        },
        { id: "text-2", kind: "text", text: "Kết quả cuối đầy đủ hơn bản nháp" },
      ],
      messages: [
        { _getType: () => "ai", tool_calls: [{ id: "tool-1", name: "nonla_manage_tools", args: { action: "list", limit: 50 } }] },
        { _getType: () => "tool", name: "nonla_manage_tools", tool_call_id: "tool-1", content: JSON.stringify({ ok: true, items: ["a", "b"] }) },
      ],
    });
    await closeCallAgentConversation(conversationId, targetId, { text: "Kết quả cuối đầy đủ hơn bản nháp", error: null });

    const messages = (await (await authRequest(app, token, "GET", `/api/conversations/${conversationId}/messages`)).json()) as {
      role: string;
      content: string;
      metadata: Record<string, unknown> | null;
    }[];
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "tool", "assistant"]);
    expect(messages[1]?.content).toBe("Không có tool giá xăng.");
    expect(messages[2]?.metadata?.toolName).toBe("nonla_manage_tools");
    expect(messages[2]?.metadata?.toolOutput).toContain('"items"');
    const invokeInput = messages[3]?.metadata?.toolInput as { activity?: { name?: string }[] };
    expect(invokeInput.activity?.[0]?.name).toBe("nonla_edit_code");
    expect(messages[3]?.metadata?.toolError).toBe(true);
    expect(messages[4]?.content).toBe("Kết quả cuối đầy đủ hơn bản nháp");
  });

  test("live steps update one row, and the final reply is not copied", async () => {
    const conversationId = await openCallAgentConversation({
      targetId,
      callerAgentId: callerId,
      callerName: "Nonla Bot",
      task: "Liệt kê tool",
      ownerId,
    });
    const cursor = new Map<string, { messageId: string; fingerprint: string }>();
    const base = { conversationId: conversationId as string, agentId: targetId, cursor };
    await syncCalledAgentTranscript({
      ...base,
      steps: [{ id: "tool-1", kind: "tool", name: "nonla_manage_tools", input: { action: "list" } }],
    });
    await syncCalledAgentTranscript({
      ...base,
      steps: [{ id: "tool-1", kind: "tool", name: "nonla_manage_tools", input: { action: "list" }, output: { ok: true } }],
      closing: true,
    });
    await syncCalledAgentTranscript({
      ...base,
      closing: true,
      steps: [
        { id: "tool-1", kind: "tool", name: "nonla_manage_tools", input: { action: "list" }, output: { ok: true } },
        { id: "text-1", kind: "text", text: "Có 2 tool." },
      ],
    });
    await closeCallAgentConversation(conversationId, targetId, { text: "Có 2 tool.", error: null });

    const messages = (await (await authRequest(app, token, "GET", `/api/conversations/${conversationId}/messages`)).json()) as {
      role: string;
      content: string;
      metadata: { toolOutput?: string } | null;
    }[];
    expect(messages.map((message) => message.role)).toEqual(["user", "tool", "assistant"]);
    expect(messages[1]?.metadata?.toolOutput).toContain("ok");
    expect(messages[2]?.content).toBe("Có 2 tool.");
  });

  test("the parent tool points at the called conversation and does not keep a second activity log", async () => {
    const parentId = await openCallAgentConversation({
      targetId: callerId,
      callerAgentId: callerId,
      callerName: "Nonla Bot",
      task: "parent",
      ownerId,
    });
    const childId = "child-conv";
    await createMessage(parentId as string, {
      agentId: callerId,
      role: "tool",
      content: "nonla_call_agent__nonla_tool_manager",
      metadata: { toolName: "nonla_call_agent__nonla_tool_manager", toolCallId: "call-1", toolInput: { message: "Liệt kê", activity: [{ id: "x", kind: "tool" }] } },
    });
    await attachCalledConversation(parentId as string, "call-1", childId);
    const messages = (await (await authRequest(app, token, "GET", `/api/conversations/${parentId}/messages`)).json()) as {
      role: string;
      metadata: { toolInput?: { conversation_id?: string; activity?: unknown } } | null;
    }[];
    const tool = messages.find((message) => message.role === "tool");
    expect(tool?.metadata?.toolInput?.conversation_id).toBe(childId);
    expect(tool?.metadata?.toolInput?.activity).toBeUndefined();
  });
});

describe("call transcript steps", () => {
  test("a nested run is stored on the tool that started it", () => {
    const started = rememberTranscriptStep([], { id: "invoke-1", kind: "tool", name: "nonla_agent_task", input: { prompt: "write" } });
    const withChild = rememberTranscriptStep(started, { id: "edit-1", kind: "tool", name: "nonla_edit_code", input: { code: "x" } }, "invoke-1");
    expect(withChild).toHaveLength(1);
    expect(withChild[0]?.activity?.[0]?.name).toBe("nonla_edit_code");
  });

  test("a step with no host stays on the transcript", () => {
    const steps = rememberTranscriptStep([], { id: "fetch-1", kind: "tool", name: "nonla_web_fetch" }, "missing-host");
    expect(steps.map((step) => step.name)).toEqual(["nonla_web_fetch"]);
  });
});
