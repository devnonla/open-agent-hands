/**
 * Read a finished agent task. Used to decide whether Nonla may approve a draft.
 */

import { extractAiMessageText } from "./ai-message-text.js";

type AgentMsg = {
  id?: string;
  content?: unknown;
  name?: string;
  tool_calls?: unknown;
  _getType?: () => string;
  type?: string;
};

type StreamChunk = { mode: string; data: unknown };

function kindOf(msg: AgentMsg | undefined): string | undefined {
  return msg?._getType?.() ?? msg?.type;
}

/** Last assistant reply. Skips tool-call turns, then falls back to any assistant text. */
export function readFinalAssistantText(messages: AgentMsg[]): string {
  let lastAny = "";
  let lastFinal = "";
  for (const msg of messages) {
    const kind = kindOf(msg);
    if (kind !== "ai" && kind !== "AIMessage") continue;
    const text = extractAiMessageText(msg?.content).trim();
    if (!text) continue;
    lastAny = text;
    const calls = msg.tool_calls;
    if (!Array.isArray(calls) || calls.length === 0) lastFinal = text;
  }
  return lastFinal || lastAny;
}

/**
 * `updates` chunks are only the new messages from that step.
 * `values` chunks are the full list, including the input messages.
 * Prefer the latest values snapshot. Otherwise keep every update.
 */
export function messagesFromAgentStream(chunks: StreamChunk[], inputCount: number): AgentMsg[] {
  let snapshot: AgentMsg[] | null = null;
  const deltas: AgentMsg[] = [];
  for (const chunk of chunks) {
    if (chunk.mode === "values") {
      const list = snapshotMessages(chunk.data);
      if (list) snapshot = list;
      continue;
    }
    if (chunk.mode !== "updates") continue;
    for (const list of updateMessageLists(chunk.data)) collectUpdateMessages(deltas, list);
  }
  if (snapshot && snapshot.length > 0) return snapshot.slice(Math.max(0, inputCount));
  return deltas;
}

function snapshotMessages(data: unknown): AgentMsg[] | null {
  if (Array.isArray(data)) return messageList(data);
  if (!data || typeof data !== "object") return null;
  return messageList((data as { messages?: unknown }).messages);
}

function updateMessageLists(data: unknown): AgentMsg[][] {
  if (!data || typeof data !== "object") return [];
  const lists: AgentMsg[][] = [];
  for (const state of Object.values(data as Record<string, { messages?: unknown }>)) {
    const list = messageList(state?.messages);
    if (list) lists.push(list);
  }
  return lists;
}

function messageList(value: unknown): AgentMsg[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((item) => item && typeof item === "object")) return null;
  return value as AgentMsg[];
}

function collectUpdateMessages(produced: AgentMsg[], incoming: AgentMsg[]): void {
  const known = new Set(produced.map((msg) => msg.id).filter((id): id is string => typeof id === "string" && id.length > 0));
  const incomingIds = incoming.map((msg) => msg.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  const overlap = incomingIds.some((id) => known.has(id));
  if (overlap) {
    if (incoming.length >= produced.length) produced.splice(0, produced.length, ...incoming);
    return;
  }
  produced.push(...incoming);
}

export function assistantSummary(messages: AgentMsg[], max = 2000): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const kind = kindOf(msg);
    if (kind !== "ai" && kind !== "AIMessage") continue;
    const content = msg?.content;
    if (typeof content === "string" && content.trim()) return content.trim().slice(0, max);
    if (!Array.isArray(content)) continue;
    const text = content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block && typeof (block as { text?: unknown }).text === "string") return (block as { text: string }).text;
        return "";
      })
      .join("")
      .trim();
    if (text) return text.slice(0, max);
  }
  return "";
}

export function toolPayloads(messages: AgentMsg[], name: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const msg of messages) {
    const kind = kindOf(msg);
    if (kind !== "tool" && kind !== "ToolMessage") continue;
    if (msg.name !== name) continue;
    const raw = typeof msg.content === "string" ? msg.content : "";
    try {
      const parsed = JSON.parse(raw) as unknown;
      rows.push(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {});
    } catch {
      rows.push({});
    }
  }
  return rows;
}

/** At least one call of `name` returned ok: true. */
export function anyToolOk(messages: AgentMsg[], name: string): boolean {
  return toolPayloads(messages, name).some((row) => row.ok === true);
}

export function nonlaDelegateMessage(task: string, extra = ""): string {
  const note = extra.trim() ? `${extra.trim()}\n\n` : "";
  return `This request comes from Nonla Bot, not from the user directly.
Do the task. Do not ask questions.
${note}${task.trim().slice(0, 4000)}`;
}
