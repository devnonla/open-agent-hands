import { describe, expect, test } from "bun:test";
import type { SSEStreamingApi } from "hono/streaming";
import { currentCallAgentSink } from "../common/ai/call-agent-activity.js";
import { isNestedAgentChunk, messagesFromUpdateValue, streamAgentSSE } from "../common/ai/stream-agent-sse.js";

function collectStream() {
  const events: Record<string, unknown>[] = [];
  const stream = {
    writeSSE: async (sse: { data: string }) => {
      events.push(JSON.parse(sse.data) as Record<string, unknown>);
    },
    write: async () => {},
  } as unknown as SSEStreamingApi;
  return { events, stream };
}

function toolMsg(id: string, name: string, content: string) {
  return {
    type: "tool",
    name,
    tool_call_id: id,
    content,
    _getType: () => "tool",
  };
}

async function* chunksOf(chunks: unknown[]) {
  for (const chunk of chunks) yield chunk;
}

function fakeAgent(chunks: unknown[]) {
  return {
    stream: async () => chunksOf(chunks),
  };
}

describe("messagesFromUpdateValue", () => {
  test("reads { messages }, arrays, and a bare tool message", () => {
    const msg = toolMsg("tc1", "run_current_script", "{}");
    expect(messagesFromUpdateValue({ messages: [msg] })).toEqual([msg]);
    expect(messagesFromUpdateValue([msg])).toEqual([msg]);
    expect(messagesFromUpdateValue(msg)).toEqual([msg]);
    expect(messagesFromUpdateValue(null)).toEqual([]);
  });
});

describe("streamAgentSSE", () => {
  test("emits tool-result from messages-mode ToolMessage", async () => {
    const { events, stream } = collectStream();
    await streamAgentSSE({
      agent: fakeAgent([
        [
          "messages",
          [
            {
              type: "AIMessageChunk",
              tool_call_chunks: [{ id: "tc1", name: "run_current_script", args: '{"keywords":["test"]}' }],
            },
            {},
          ],
        ],
        ["messages", [toolMsg("tc1", "run_current_script", JSON.stringify({ success: true, output: { n: 1 } })), {}]],
      ]),
      messages: [],
      stream,
    });

    expect(events[0]).toMatchObject({ type: "RUN_STARTED" });
    expect(events.filter((e) => e.type === "TOOL_CALL_START")).toHaveLength(1);
    expect(events.find((e) => e.type === "TOOL_CALL_ARGS")).toMatchObject({
      toolCallId: "tc1",
      delta: JSON.stringify({ keywords: ["test"] }),
    });
    expect(events.find((e) => e.type === "TOOL_CALL_RESULT")).toMatchObject({
      toolCallId: "tc1",
      content: JSON.stringify({ success: true, output: { n: 1 } }),
    });
    expect(events.at(-1)).toMatchObject({ type: "RUN_FINISHED" });
  });

  test("folds nested coding-agent steps into the nonla_tools_manager card", async () => {
    const { events, stream } = collectStream();
    const nested = { langgraph_checkpoint_ns: "tools:parent|model:child" };
    await streamAgentSSE({
      agent: fakeAgent([
        ["messages", [{ type: "AIMessageChunk", content: "", tool_call_chunks: [{ id: "outer", name: "nonla_tools_manager", args: '{"id":"t1","task":"add hi"}' }] }, {}]],
        ["messages", [{ type: "AIMessage", content: "Editing the draft", tool_calls: [{ id: "inner", name: "edit_code", args: { code: "x" } }] }, nested]],
        ["messages", [toolMsg("inner", "edit_code", JSON.stringify({ ok: true })), nested]],
        ["messages", [{ type: "AIMessageChunk", content: "parent says hi", tool_call_chunks: [{ id: "later", name: "list_tools", args: "{}" }] }, {}]],
      ]),
      messages: [],
      stream,
    });

    const starts = events.filter((e) => e.type === "TOOL_CALL_START");
    expect(starts.map((e) => e.toolCallName)).toEqual(["nonla_tools_manager", "list_tools"]);
    expect(events.some((e) => e.toolCallId === "inner")).toBe(false);
    const activityBlob = events.map((e) => JSON.stringify(e)).find((blob) => blob.includes("edit_code") && blob.includes("Editing the draft"));
    expect(activityBlob).toBeTruthy();
    const text = events
      .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
      .map((e) => e.delta)
      .join("");
    expect(text).toContain("parent says hi");
    expect(text).not.toContain("Editing the draft");
    expect(events.find((e) => e.type === "CUSTOM" && e.name === "tool-meta")).toMatchObject({
      value: { toolCallId: "outer", toolLabel: "Write Tool Draft Code" },
    });
    expect(isNestedAgentChunk(nested)).toBe(true);
    expect(isNestedAgentChunk({})).toBe(false);
  });

  test("folds a nested agent task step onto the open card", async () => {
    const { events, stream } = collectStream();
    await streamAgentSSE({
      agent: {
        stream: async () => ({
          async *[Symbol.asyncIterator]() {
            yield ["messages", [{ type: "AIMessageChunk", content: "", tool_call_chunks: [{ id: "sub", name: "nonla_agent_task", args: '{"prompt":"write"}' }] }, {}]];
            const sink = currentCallAgentSink();
            await sink?.emit("inner-1", { id: "edit-1", kind: "tool", name: "edit_code", input: { path: "a.ts" } });
            yield ["messages", [toolMsg("sub", "nonla_agent_task", JSON.stringify({ success: true, response: "saved" })), {}]];
          },
        }),
      },
      messages: [],
      stream,
    });

    const activityBlob = events.map((e) => JSON.stringify(e)).find((blob) => blob.includes("edit_code") && blob.includes("sub"));
    expect(activityBlob).toBeTruthy();
    expect(events.some((e) => e.toolCallId === "inner-1")).toBe(false);
  });

  test("emits tool-result from updates payload that is a message array", async () => {
    const { events, stream } = collectStream();
    await streamAgentSSE({
      agent: fakeAgent([
        [
          "messages",
          [
            {
              type: "AIMessageChunk",
              tool_call_chunks: [{ id: "tc1", name: "run_current_script", args: "{}" }],
            },
            {},
          ],
        ],
        ["updates", { tools: [toolMsg("tc1", "run_current_script", JSON.stringify({ success: true, output: "ok" }))] }],
      ]),
      messages: [],
      stream,
    });

    expect(events.find((e) => e.type === "TOOL_CALL_RESULT")).toMatchObject({
      toolCallId: "tc1",
      content: JSON.stringify({ success: true, output: "ok" }),
    });
  });

  test("re-emits the same toolCallId from updates with full args (client upserts — no ghost error)", async () => {
    const { events, stream } = collectStream();
    await streamAgentSSE({
      agent: fakeAgent([
        [
          "messages",
          [
            {
              type: "AIMessageChunk",
              tool_call_chunks: [{ id: "tc1", name: "edit_skill_file", args: "{" }],
            },
            {},
          ],
        ],
        [
          "updates",
          {
            agent: {
              messages: [
                {
                  type: "AIMessage",
                  tool_calls: [{ id: "tc1", name: "edit_skill_file", args: { path: "SKILL.md", mode: "full", content: "# Skill\n" } }],
                  _getType: () => "ai",
                },
              ],
            },
          },
        ],
        ["updates", { tools: [toolMsg("tc1", "edit_skill_file", JSON.stringify({ ok: true, path: "SKILL.md" }))] }],
      ]),
      messages: [],
      stream,
    });

    const starts = events.filter((e) => e.type === "TOOL_CALL_START");
    expect(starts).toHaveLength(1);
    expect(starts[0]?.toolCallId).toBe("tc1");
    expect(events.find((e) => e.type === "TOOL_CALL_ARGS")).toMatchObject({
      toolCallId: "tc1",
      delta: JSON.stringify({ path: "SKILL.md", mode: "full", content: "# Skill\n" }),
    });
    const results = events.filter((e) => e.type === "TOOL_CALL_RESULT");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ toolCallId: "tc1", content: JSON.stringify({ ok: true, path: "SKILL.md" }) });
    expect(events.at(-1)).toMatchObject({ type: "RUN_FINISHED" });
  });

  test("maps a later updates tool-call with a different id onto the early chunk id", async () => {
    const { events, stream } = collectStream();
    await streamAgentSSE({
      agent: fakeAgent([
        [
          "messages",
          [
            {
              type: "AIMessageChunk",
              tool_call_chunks: [{ id: "chunk-1", name: "read_skill_file", args: "{}" }],
            },
            {},
          ],
        ],
        [
          "updates",
          {
            agent: {
              messages: [
                {
                  type: "AIMessage",
                  tool_calls: [{ id: "final-9", name: "read_skill_file", args: { path: "SKILL.md" } }],
                  _getType: () => "ai",
                },
              ],
            },
          },
        ],
        ["updates", { tools: [toolMsg("final-9", "read_skill_file", JSON.stringify({ ok: true, path: "SKILL.md" }))] }],
      ]),
      messages: [],
      stream,
    });

    const starts = events.filter((e) => e.type === "TOOL_CALL_START");
    expect(starts.map((e) => e.toolCallId)).toEqual(["chunk-1"]);
    expect(events.find((e) => e.type === "TOOL_CALL_ARGS")).toMatchObject({
      toolCallId: "chunk-1",
      delta: JSON.stringify({ path: "SKILL.md" }),
    });
    const results = events.filter((e) => e.type === "TOOL_CALL_RESULT");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ toolCallId: "chunk-1", content: JSON.stringify({ ok: true, path: "SKILL.md" }) });
  });

  test("flushes unresolved tool-calls when the stream ends without a result", async () => {
    const { events, stream } = collectStream();
    await streamAgentSSE({
      agent: fakeAgent([
        [
          "messages",
          [
            {
              type: "AIMessageChunk",
              tool_call_chunks: [{ id: "tc1", name: "run_current_script", args: "{}" }],
            },
            {},
          ],
        ],
      ]),
      messages: [],
      stream,
    });

    const result = events.find((e) => e.type === "TOOL_CALL_RESULT");
    expect(result).toMatchObject({
      type: "TOOL_CALL_RESULT",
      toolCallId: "tc1",
      content: JSON.stringify({ success: false, error: "Tool did not return a result" }),
    });
    expect(events.at(-1)).toMatchObject({ type: "RUN_FINISHED" });
  });

  test("keeps streamed arg text when the tool result arrives before updates", async () => {
    const { events, stream } = collectStream();
    await streamAgentSSE({
      agent: fakeAgent([
        ["messages", [{ type: "AIMessageChunk", tool_call_chunks: [{ id: "tc1", name: "edit_skill_file", args: '{"path":' }] }, {}]],
        ["messages", [{ type: "AIMessageChunk", tool_call_chunks: [{ id: "tc1", args: '"SKILL.md"}' }] }, {}]],
        ["messages", [toolMsg("tc1", "edit_skill_file", JSON.stringify({ ok: true })), {}]],
      ]),
      messages: [],
      stream,
      threadId: "skill-1",
    });

    expect(events[0]).toMatchObject({ type: "RUN_STARTED", threadId: "skill-1" });
    expect(events.find((e) => e.type === "TOOL_CALL_ARGS")).toMatchObject({
      toolCallId: "tc1",
      delta: '{"path":"SKILL.md"}',
    });
    const endIndex = events.findIndex((e) => e.type === "TOOL_CALL_END");
    const resultIndex = events.findIndex((e) => e.type === "TOOL_CALL_RESULT");
    expect(endIndex).toBeGreaterThan(-1);
    expect(resultIndex).toBeGreaterThan(endIndex);
  });
});
