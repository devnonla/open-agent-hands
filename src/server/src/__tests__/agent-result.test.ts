import { describe, expect, test } from "bun:test";
import { messagesFromAgentStream, readFinalAssistantText } from "../common/ai/agent-result.js";

function ai(id: string, content: unknown, toolCalls?: unknown[]) {
  return { id, content, tool_calls: toolCalls, _getType: () => "ai" };
}

function tool(id: string, content: string) {
  return { id, content, name: "nonla_manage_agents", _getType: () => "tool" };
}

const reply = "id: agent-1, name: CK VN, team: Invest";

describe("call agent stream result", () => {
  test("keeps the final reply when each update is only the new message", () => {
    const chunks = [
      { mode: "updates", data: { agent: { messages: [ai("ai-1", "", [{ name: "nonla_manage_agents" }])] } } },
      { mode: "updates", data: { tools: { messages: [tool("tool-1", '{"ok":true,"id":"agent-1"}')] } } },
      { mode: "updates", data: { agent: { messages: [ai("ai-2", reply)] } } },
    ];
    const messages = messagesFromAgentStream(chunks, 1);
    expect(messages).toHaveLength(3);
    expect(readFinalAssistantText(messages)).toBe(reply);
  });

  test("reads the final reply from the full values snapshot", () => {
    const chunks = [
      {
        mode: "values",
        data: {
          messages: [{ id: "human", content: "create the agent", _getType: () => "human" }, ai("ai-1", "", [{ name: "nonla_manage_agents" }]), tool("tool-1", '{"ok":true}'), ai("ai-2", reply)],
        },
      },
    ];
    const messages = messagesFromAgentStream(chunks, 1);
    expect(messages).toHaveLength(3);
    expect(readFinalAssistantText(messages)).toBe(reply);
  });

  test("reads text blocks, not only a plain string", () => {
    expect(readFinalAssistantText([ai("ai-1", [{ type: "text", text: reply }])])).toBe(reply);
  });
});
