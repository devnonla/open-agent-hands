/**
 * AG-UI events are the only stream protocol.
 * https://docs.ag-ui.com/concepts/events
 *
 * LangChain chunks go through AguiRun, which emits these events.
 * Registry, replay, and SSE write the same objects.
 */

import type { SSEStreamingApi } from "hono/streaming";

export type AguiEvent =
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  | { type: "RUN_FINISHED"; threadId: string; runId: string; result?: unknown }
  | { type: "RUN_ERROR"; message: string }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "REASONING_START"; messageId: string }
  | { type: "REASONING_MESSAGE_START"; messageId: string; role: "reasoning" }
  | { type: "REASONING_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "REASONING_MESSAGE_END"; messageId: string }
  | { type: "REASONING_END"; messageId: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string; parentMessageId?: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "TOOL_CALL_RESULT"; messageId: string; toolCallId: string; content: string; role: "tool" }
  | { type: "CUSTOM"; name: "tool-meta"; value: { toolCallId: string; toolLabel?: string; toolIcon?: string | null } }
  | { type: "CUSTOM"; name: "tool-call-input"; value: { toolCallId: string; toolName: string; input: unknown } }
  | {
      type: "CUSTOM";
      name: "context-usage";
      value: {
        used: number;
        max: number;
        percent: number;
        source: string;
        providerId: string;
        providerType: string;
        modelId: string;
        estimatedInputTokens: number;
        calls: Array<{
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens: number;
          cacheWriteTokens: number;
          reasoningTokens: number;
          contextTokens: number;
          valid: boolean;
          suspicious: boolean;
        }>;
      };
    };

type ToolState = {
  name: string;
  latest: unknown;
  /**
   * Exact argument text from stream chunks.
   * Used when the call closes before a completed object arrives.
   * A later completed `toolCall` clears this and sends that object instead.
   */
  argsText: string | null;
  /** ARGS + END already sent for the completed snapshot. */
  closed: boolean;
};

function argsJson(input: unknown): string {
  if (input === undefined) return "{}";
  const json = JSON.stringify(input);
  return typeof json === "string" ? json : "{}";
}

function resultContent(result: unknown): string {
  if (typeof result === "string") return result;
  const json = JSON.stringify(result ?? null);
  return typeof json === "string" ? json : String(result);
}

export function isAguiTerminal(event: AguiEvent): boolean {
  return event.type === "RUN_FINISHED" || event.type === "RUN_ERROR";
}

export async function writeAguiEvent(stream: Pick<SSEStreamingApi, "writeSSE">, event: AguiEvent): Promise<void> {
  await stream.writeSSE({ data: JSON.stringify(event) });
}

export async function writeAguiEvents(stream: Pick<SSEStreamingApi, "writeSSE">, events: AguiEvent[]): Promise<void> {
  for (const event of events) await writeAguiEvent(stream, event);
}

export async function writeRunError(stream: Pick<SSEStreamingApi, "writeSSE">, message: string): Promise<void> {
  await writeAguiEvent(stream, { type: "RUN_ERROR", message });
}

export async function writeSseComment(stream: SSEStreamingApi, comment: string): Promise<void> {
  await stream.write(`: ${comment}\n\n`);
}

/**
 * One run, one id sequence. Callers emit the returned events as-is.
 * Replay must forward those events, not build a second sequence.
 */
export class AguiRun {
  private started = false;
  private ended = false;
  private textMessageId: string | null = null;
  private reasoningId: string | null = null;
  /** Assistant message that owns the current tool group. Kept until the next text message. */
  private toolParentId: string | null = null;
  private readonly tools = new Map<string, ToolState>();
  private pending: AguiEvent[] = [];

  constructor(private readonly ids: { threadId: string; runId: string }) {}

  begin(): AguiEvent[] {
    if (this.started || this.ended) return [];
    this.started = true;
    this.push({ type: "RUN_STARTED", threadId: this.ids.threadId, runId: this.ids.runId });
    return this.take();
  }

  textDelta(text: string): AguiEvent[] {
    if (!text || this.ended) return [];
    const started = this.begin();
    this.closeReasoning();
    if (!this.textMessageId) {
      this.toolParentId = null;
      this.textMessageId = crypto.randomUUID();
      this.push({ type: "TEXT_MESSAGE_START", messageId: this.textMessageId, role: "assistant" });
    }
    this.push({ type: "TEXT_MESSAGE_CONTENT", messageId: this.textMessageId, delta: text });
    return [...started, ...this.take()];
  }

  reasoningDelta(text: string): AguiEvent[] {
    if (!text || this.ended) return [];
    const started = this.begin();
    this.closeText();
    if (!this.reasoningId) {
      this.reasoningId = crypto.randomUUID();
      this.push({ type: "REASONING_START", messageId: this.reasoningId });
      this.push({ type: "REASONING_MESSAGE_START", messageId: this.reasoningId, role: "reasoning" });
    }
    this.push({ type: "REASONING_MESSAGE_CONTENT", messageId: this.reasoningId, delta: text });
    return [...started, ...this.take()];
  }

  /**
   * Remember streamed argument text for a call that is still open.
   * `toolResult` / `finish` then emit this text, not the first partial parse.
   */
  setToolArgs(toolCallId: string, argsText: string): void {
    if (this.ended || !argsText) return;
    const tool = this.tools.get(toolCallId);
    if (!tool || tool.closed) return;
    tool.argsText = argsText;
  }

  /**
   * First call paints START immediately (args are often still partial).
   * The next call for the same id is the completed args.
   * If that second call never arrives, args are flushed before the result or RUN_FINISHED.
   */
  toolCall(event: { toolCallId: string; toolName: string; toolLabel?: string; toolIcon?: string | null; input: unknown }): AguiEvent[] {
    if (this.ended) return [];
    const started = this.begin();
    this.closeReasoning();
    const parentMessageId = this.closeText();
    let tool = this.tools.get(event.toolCallId);
    if (!tool) {
      tool = { name: event.toolName, latest: event.input, argsText: null, closed: false };
      this.tools.set(event.toolCallId, tool);
      this.push({
        type: "TOOL_CALL_START",
        toolCallId: event.toolCallId,
        toolCallName: event.toolName,
        ...(parentMessageId ? { parentMessageId } : {}),
      });
      if (event.toolLabel || event.toolIcon) {
        this.push({
          type: "CUSTOM",
          name: "tool-meta",
          value: {
            toolCallId: event.toolCallId,
            toolLabel: event.toolLabel,
            toolIcon: event.toolIcon ?? null,
          },
        });
      }
      return [...started, ...this.take()];
    }

    tool.latest = event.input;
    tool.name = event.toolName || tool.name;
    tool.argsText = null;
    this.closeToolArgs(event.toolCallId, tool);
    return [...started, ...this.take()];
  }

  toolResult(toolCallId: string, result: unknown): AguiEvent[] {
    if (this.ended) return [];
    const started = this.begin();
    this.closeReasoning();
    this.closeText();
    const tool = this.tools.get(toolCallId);
    if (tool && !tool.closed) this.closeToolArgs(toolCallId, tool);
    this.push({
      type: "TOOL_CALL_RESULT",
      messageId: crypto.randomUUID(),
      toolCallId,
      content: resultContent(result),
      role: "tool",
    });
    return [...started, ...this.take()];
  }

  finish(reason?: string): AguiEvent[] {
    if (this.ended) return [];
    const started = this.begin();
    this.ended = true;
    this.closeReasoning();
    this.closeText();
    this.closeDanglingTools();
    this.push({
      type: "RUN_FINISHED",
      threadId: this.ids.threadId,
      runId: this.ids.runId,
      ...(reason ? { result: { reason } } : {}),
    });
    return [...started, ...this.take()];
  }

  fail(message: string): AguiEvent[] {
    if (this.ended) return [];
    this.ended = true;
    this.closeReasoning();
    this.closeText();
    this.closeDanglingTools();
    this.push({ type: "RUN_ERROR", message });
    return this.take();
  }

  private push(event: AguiEvent): void {
    this.pending.push(event);
  }

  private take(): AguiEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  private closeText(): string | undefined {
    if (!this.textMessageId) return this.toolParentId ?? undefined;
    const id = this.textMessageId;
    this.textMessageId = null;
    this.toolParentId = id;
    this.push({ type: "TEXT_MESSAGE_END", messageId: id });
    return id;
  }

  private closeReasoning(): void {
    if (!this.reasoningId) return;
    const id = this.reasoningId;
    this.reasoningId = null;
    this.push({ type: "REASONING_MESSAGE_END", messageId: id });
    this.push({ type: "REASONING_END", messageId: id });
  }

  private closeToolArgs(toolCallId: string, tool: ToolState): void {
    if (tool.closed) {
      this.push({
        type: "CUSTOM",
        name: "tool-call-input",
        value: { toolCallId, toolName: tool.name, input: tool.latest },
      });
      return;
    }
    tool.closed = true;
    const delta = tool.argsText != null && tool.argsText.length > 0 ? tool.argsText : argsJson(tool.latest);
    this.push({ type: "TOOL_CALL_ARGS", toolCallId, delta });
    this.push({ type: "TOOL_CALL_END", toolCallId });
  }

  private closeDanglingTools(): void {
    for (const [id, tool] of this.tools) {
      if (!tool.closed) this.closeToolArgs(id, tool);
    }
  }
}
