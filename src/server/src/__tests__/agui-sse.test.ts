import { describe, expect, test } from "bun:test";
import { AguiRun } from "../common/ai/agui-sse.js";

describe("AguiRun", () => {
  test("parallel tool calls share the assistant message that preceded them", () => {
    const agui = new AguiRun({ threadId: "thread-1", runId: "run-1" });
    const events = [...agui.begin(), ...agui.textDelta("hello"), ...agui.toolCall({ toolCallId: "a", toolName: "one", input: {} }), ...agui.toolCall({ toolCallId: "b", toolName: "two", input: { x: 1 } })];

    const textStart = events.find((e) => e.type === "TEXT_MESSAGE_START");
    const starts = events.filter((e) => e.type === "TOOL_CALL_START");
    expect(textStart && "messageId" in textStart).toBe(true);
    if (textStart?.type !== "TEXT_MESSAGE_START") throw new Error("missing text start");
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ toolCallId: "a", parentMessageId: textStart.messageId });
    expect(starts[1]).toMatchObject({ toolCallId: "b", parentMessageId: textStart.messageId });
  });

  test("tool result message ids are unique across calls", () => {
    const agui = new AguiRun({ threadId: "thread-1", runId: "run-1" });
    agui.toolCall({ toolCallId: "a", toolName: "one", input: {} });
    agui.toolCall({ toolCallId: "b", toolName: "two", input: {} });
    const first = agui.toolResult("a", { ok: true }).find((e) => e.type === "TOOL_CALL_RESULT");
    const second = agui.toolResult("b", { ok: true }).find((e) => e.type === "TOOL_CALL_RESULT");
    expect(first?.type).toBe("TOOL_CALL_RESULT");
    expect(second?.type).toBe("TOOL_CALL_RESULT");
    if (first?.type !== "TOOL_CALL_RESULT" || second?.type !== "TOOL_CALL_RESULT") return;
    expect(first.messageId).not.toBe(second.messageId);
    expect(first.messageId.startsWith("tool-result-")).toBe(false);
    expect(second.messageId.startsWith("tool-result-")).toBe(false);
  });

  test("setToolArgs is what TOOL_CALL_ARGS sends when the call closes early", () => {
    const agui = new AguiRun({ threadId: "thread-1", runId: "run-1" });
    agui.toolCall({ toolCallId: "tc1", toolName: "edit", input: {} });
    agui.setToolArgs("tc1", '{"path":"SKILL.md"}');
    const events = agui.toolResult("tc1", { ok: true });
    expect(events.find((e) => e.type === "TOOL_CALL_ARGS")).toMatchObject({
      toolCallId: "tc1",
      delta: '{"path":"SKILL.md"}',
    });
  });

  test("fail closes an open text message and an open tool before RUN_ERROR", () => {
    const agui = new AguiRun({ threadId: "thread-1", runId: "run-1" });
    const events = [...agui.textDelta("hi"), ...agui.toolCall({ toolCallId: "tc1", toolName: "search", input: {} }), ...agui.fail("cancelled")];
    const types = events.map((e) => e.type);
    const errorAt = types.lastIndexOf("RUN_ERROR");
    expect(types.indexOf("TEXT_MESSAGE_END")).toBeLessThan(errorAt);
    expect(types.indexOf("TOOL_CALL_END")).toBeLessThan(errorAt);
    expect(types.at(-1)).toBe("RUN_ERROR");
  });
});
