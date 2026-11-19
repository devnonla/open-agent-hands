import { AsyncLocalStorage } from "node:async_hooks";
import { extractAiMessageText } from "./ai-message-text.js";

export type CallAgentStep = {
  id: string;
  kind: "tool" | "text";
  name?: string;
  text?: string;
  input?: unknown;
  output?: unknown;
  /** Steps this tool ran. Used by Agent Task so the card can show the live run. */
  activity?: CallAgentStep[];
  /** Set once so the parent tool card can open this conversation. Not a visible step. */
  conversationId?: string;
};

type Sink = {
  emit: (parentToolCallId: string, step: CallAgentStep) => void | Promise<void>;
};

/** Set by the parent stream while a call_agent tool is running. */
export const callAgentActivity = new AsyncLocalStorage<Sink>();

/**
 * LangChain runs the tool outside the AsyncLocalStorage that wraps `iterator.next()`.
 * This stack stays set for the whole parent stream, so the child can still report steps.
 */
const sinkStack: Sink[] = [];

export function pushCallAgentSink(sink: Sink): void {
  sinkStack.push(sink);
}

export function popCallAgentSink(): void {
  sinkStack.pop();
}

export function currentCallAgentSink(): Sink | undefined {
  return sinkStack.at(-1) ?? callAgentActivity.getStore();
}

const ACTIVITY_CLIP = 4000;

type ChildChunk = {
  _getType?: () => string;
  type?: string;
  content?: unknown;
  tool_calls?: { id?: string; name?: string; args?: unknown }[];
  tool_call_chunks?: { id?: string; name?: string; args?: string }[];
  name?: string;
  tool_call_id?: string;
};

function clipText(value: string): string {
  return value.length > ACTIVITY_CLIP ? `${value.slice(0, ACTIVITY_CLIP)}…` : value;
}

function clipValue(value: unknown): unknown {
  if (typeof value === "string") return clipText(value);
  if (value == null || typeof value !== "object") return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= ACTIVITY_CLIP) return value;
    return `${json.slice(0, ACTIVITY_CLIP)}…`;
  } catch {
    return undefined;
  }
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function tryParseToolArgs(argsStr: string): unknown {
  if (!argsStr) return {};
  try {
    return JSON.parse(argsStr);
  } catch {
    return {};
  }
}

/** Chunks are sometimes a delta, sometimes the text so far. */
function mergeStreamText(prev: string, next: string): string {
  if (!next) return prev;
  if (!prev) return next;
  if (next.startsWith(prev)) return next;
  if (prev.endsWith(next)) return prev;
  return prev + next;
}

/**
 * Turn one child-agent stream into steps the parent card can show:
 * the child's own words, then each tool it runs.
 */
function mergeStep(prev: CallAgentStep, step: CallAgentStep): CallAgentStep {
  return {
    ...prev,
    ...step,
    kind: step.kind || prev.kind,
    name: step.name ?? prev.name,
    text: step.text !== undefined ? step.text : prev.text,
    input: step.input !== undefined ? step.input : prev.input,
    output: step.output !== undefined ? step.output : prev.output,
    activity: step.activity ?? prev.activity,
  };
}

/** Insert or update one step. Streaming text keeps the same id. */
export function upsertActivityStep(steps: CallAgentStep[], step: CallAgentStep): CallAgentStep[] {
  const idx = steps.findIndex((item) => item.id === step.id);
  if (idx === -1) return [...steps, step];
  const prev = steps[idx];
  if (!prev) return steps;
  const next = [...steps];
  next[idx] = mergeStep(prev, step);
  return next;
}

/**
 * Put a child step inside the tool step that owns it.
 * Returns null when that tool step is not in this list.
 */
export function nestChildStep(steps: CallAgentStep[], hostId: string, step: CallAgentStep): CallAgentStep[] | null {
  let changed = false;
  const next = steps.map((item) => {
    if (item.id === hostId) {
      changed = true;
      return { ...item, activity: upsertActivityStep(item.activity ?? [], step) };
    }
    if (!item.activity?.length) return item;
    const nested = nestChildStep(item.activity, hostId, step);
    if (!nested) return item;
    changed = true;
    return { ...item, activity: nested };
  });
  return changed ? next : null;
}

/**
 * A nested run emits steps under its own tool id.
 * If that id is not on this stream, attach the steps to the open parent card.
 */
export function activityParentId(known: (id: string) => boolean, activeId: string | null, requestedId: string): string | null {
  if (requestedId && known(requestedId)) return requestedId;
  if (activeId && known(activeId)) return activeId;
  return null;
}

export type ActivityTrace = {
  push: (step: CallAgentStep) => void;
  setConversationId: (id: string) => void;
  follow: (onChange: (trace: { activity: CallAgentStep[]; childConversationId?: string }) => void) => void;
};

export function createActivityTrace(): ActivityTrace {
  let steps: CallAgentStep[] = [];
  let childConversationId: string | undefined;
  let listener: ((trace: { activity: CallAgentStep[]; childConversationId?: string }) => void) | null = null;
  const notify = () => listener?.({ activity: steps, childConversationId });
  return {
    push(step) {
      steps = upsertActivityStep(steps, step);
      notify();
    },
    setConversationId(id) {
      childConversationId = id;
      notify();
    },
    follow(onChange) {
      listener = onChange;
      notify();
    },
  };
}

/** LangChain passes `toolCallId` on the tool config. Some paths only set `toolCall.id`. */
export function readParentToolCallId(runtime: unknown): string | undefined {
  if (!runtime || typeof runtime !== "object") return undefined;
  const record = runtime as { toolCallId?: unknown; toolCall?: { id?: unknown } };
  if (typeof record.toolCallId === "string" && record.toolCallId) return record.toolCallId;
  if (typeof record.toolCall?.id === "string" && record.toolCall.id) return record.toolCall.id;
  return undefined;
}

/**
 * One LangGraph `streamMode: ["messages", "updates"]` chunk.
 * Updates carry the finished tool call and its result. Their text is skipped
 * so the streamed words are not shown twice.
 */
export async function feedChildActivity(onChunk: (msg: ChildChunk | undefined) => Promise<void>, mode: string, data: unknown): Promise<void> {
  if (mode === "messages") {
    const msg = Array.isArray(data) ? data[0] : data;
    await onChunk(msg);
    return;
  }
  if (mode !== "updates" || !data || typeof data !== "object") return;
  for (const state of Object.values(data as Record<string, { messages?: unknown[] }>)) {
    if (!Array.isArray(state?.messages)) continue;
    for (const msg of state.messages) {
      const toolMsg = toolActivityMessage(msg);
      if (toolMsg) await onChunk(toolMsg);
    }
  }
}

function toolActivityMessage(msg: unknown): ChildChunk | null {
  if (!msg || typeof msg !== "object") return null;
  const record = msg as {
    _getType?: () => string;
    getType?: () => string;
    type?: string;
    tool_calls?: unknown;
    tool_call_chunks?: unknown;
  };
  const kind = record._getType?.() ?? record.getType?.() ?? record.type;
  if (kind === "tool" || kind === "ToolMessage") return msg;
  const calls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
  const chunks = Array.isArray(record.tool_call_chunks) ? record.tool_call_chunks : [];
  if (calls.length === 0 && chunks.length === 0) return null;
  return { type: "ai", content: "", tool_calls: calls, tool_call_chunks: chunks };
}

export function createChildActivityEmitter(emit: (step: CallAgentStep) => void | Promise<void>) {
  let textId: string | null = null;
  let text = "";

  const closeText = () => {
    textId = null;
    text = "";
  };

  const pushText = async (delta: string) => {
    text = mergeStreamText(text, delta);
    if (!text.trim()) return;
    if (!textId) textId = `text-${crypto.randomUUID()}`;
    await emit({ id: textId, kind: "text", text: clipText(text) });
  };

  return async function onChildChunk(msg: ChildChunk | undefined): Promise<void> {
    if (!msg) return;
    const kind = msg._getType?.() ?? msg.type;

    if (kind === "tool" || kind === "ToolMessage") {
      closeText();
      const name = typeof msg.name === "string" ? msg.name : "";
      if (!name) return;
      await emit({ id: msg.tool_call_id || name, kind: "tool", name, output: clipValue(parseMaybeJson(msg.content)) });
      return;
    }

    const spoken = typeof msg.content === "string" ? msg.content : extractAiMessageText(msg.content);
    if (spoken) await pushText(spoken);

    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter((call) => call?.name) : [];
    const chunks = Array.isArray(msg.tool_call_chunks) ? msg.tool_call_chunks.filter((call) => call?.name && call.id) : [];
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const toolUses = blocks.filter((block) => {
      const item = block as { type?: string; name?: string };
      return item?.type === "tool_use" && typeof item.name === "string" && item.name.length > 0;
    }) as { id?: string; name: string; input?: unknown }[];
    if (calls.length > 0 || chunks.length > 0 || toolUses.length > 0) closeText();

    for (const call of calls) {
      await emit({ id: call.id || call.name || "tool", kind: "tool", name: call.name, input: clipValue(call.args) });
    }
    for (const call of chunks) {
      await emit({ id: call.id as string, kind: "tool", name: call.name, input: clipValue(tryParseToolArgs(call.args ?? "")) });
    }
    for (const block of toolUses) {
      await emit({ id: block.id || block.name, kind: "tool", name: block.name, input: clipValue(block.input) });
    }
  };
}
