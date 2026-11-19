/**
 * runRegistry — in-memory registry of active AI streaming runs.
 *
 * Design:
 *   - Each run is keyed by conversationId
 *   - Run lifecycle is INDEPENDENT of any HTTP connection (F5-resilient)
 *   - Structural AG-UI events (tools / RUN_FINISHED / RUN_ERROR) are buffered for replay
 *   - Live text/thinking is kept as a snapshot (avoids duplicating DB messages on F5)
 *   - Multiple SSE clients can subscribe to the same run
 *   - Stop endpoint calls cancel() to abort the background AI task
 */

import type { SSEStreamingApi } from "hono/streaming";
import type { AguiEvent } from "../../../../common/ai/agui-sse.js";
import { isAguiTerminal, writeAguiEvent, writeRunError, writeSseComment } from "../../../../common/ai/agui-sse.js";

type RunSubscriber = (event: AguiEvent) => void;

interface ActiveRun {
  runId: symbol;
  /** AG-UI runId. Stable for the life of this run so reconnects share it. */
  publicRunId: string;
  abort: AbortController;
  agentId: string;
  conversationId: string;
  subscribers: Set<RunSubscriber>;
  /** Structural AG-UI events only (tools / RUN_FINISHED / RUN_ERROR / RUN_STARTED) */
  eventBuffer: AguiEvent[];
  /** Unsaved assistant text since last tool / segment flush */
  liveText: string;
  /** messageId of the open TEXT_MESSAGE, if the model is still writing it */
  liveTextMessageId: string | null;
  /** Unsaved thinking text since last flush */
  liveThinking: string;
  /** messageId of the open REASONING span */
  liveThinkingId: string | null;
  /** True after REASONING_MESSAGE_START until that message closes */
  liveReasoningMessageOpen: boolean;
  /** Tool calls with START and no END yet. Closed before a terminal event. */
  openToolIds: string[];
  finished: boolean;
  /** Last time any event was emitted (for stall watchdog) */
  lastEventAt: number;
}

const REPLAY_GRACE_MS = 60_000;
/** Keep SSE sockets warm through proxies / Bun idleTimeout (120s). */
export const SSE_HEARTBEAT_MS = 15_000;

class RunRegistry {
  private runs = new Map<string, ActiveRun>();

  isCurrent(conversationId: string, runId: symbol): boolean {
    const run = this.runs.get(conversationId);
    return !!run && run.runId === runId && !run.finished;
  }

  /** True while a run exists and is not finished (or still in replay grace if finished). */
  has(conversationId: string): boolean {
    return this.runs.has(conversationId);
  }

  /** AG-UI run id for the current run, if one exists. */
  publicRunId(conversationId: string): string | null {
    return this.runs.get(conversationId)?.publicRunId ?? null;
  }

  /** True when there is an unfinished run for this conversation. */
  isActive(conversationId: string): boolean {
    const run = this.runs.get(conversationId);
    return !!run && !run.finished;
  }

  lastEventAt(conversationId: string): number | null {
    return this.runs.get(conversationId)?.lastEventAt ?? null;
  }

  /** Register a new run. Cancels any existing run and unblocks its relays. */
  create(conversationId: string, agentId: string): { abort: AbortController; runId: symbol } {
    const existing = this.runs.get(conversationId);
    if (existing) {
      existing.abort.abort();
      if (!existing.finished) {
        this.closeOpenSequences(existing);
        const cancelEvent: AguiEvent = { type: "RUN_ERROR", message: "cancelled" };
        existing.eventBuffer.push(cancelEvent);
        existing.finished = true;
        this.fanout(existing, cancelEvent);
      }
      existing.subscribers.clear();
    }

    const runId = Symbol(conversationId);
    const abort = new AbortController();
    this.runs.set(conversationId, {
      runId,
      publicRunId: crypto.randomUUID(),
      abort,
      agentId,
      conversationId,
      subscribers: new Set(),
      eventBuffer: [],
      liveText: "",
      liveTextMessageId: null,
      liveThinking: "",
      liveThinkingId: null,
      liveReasoningMessageOpen: false,
      openToolIds: [],
      finished: false,
      lastEventAt: Date.now(),
    });
    return { abort, runId };
  }

  /**
   * Subscribe to events from a run.
   * Replays structural events + current unsaved text snapshot, then receives live events.
   */
  subscribe(conversationId: string, cb: RunSubscriber): () => void {
    const run = this.runs.get(conversationId);
    if (!run) return () => {};

    let alive = true;
    const safeCb: RunSubscriber = (event) => {
      if (!alive) return;
      cb(event);
    };

    // 1. Replay structural events (tool calls, results, terminal)
    for (const event of run.eventBuffer) {
      safeCb(event);
    }

    const last = run.eventBuffer[run.eventBuffer.length - 1];
    if ((last && isAguiTerminal(last)) || run.finished) {
      return () => {
        alive = false;
      };
    }

    // 2. Catch up unsaved streaming text (not in DB yet) as one AG-UI snapshot.
    // Open the span even when no delta has arrived yet, or the next CONTENT is orphaned.
    if (run.liveThinkingId) {
      safeCb({ type: "REASONING_START", messageId: run.liveThinkingId });
      if (run.liveReasoningMessageOpen) {
        safeCb({ type: "REASONING_MESSAGE_START", messageId: run.liveThinkingId, role: "reasoning" });
        if (run.liveThinking) {
          safeCb({ type: "REASONING_MESSAGE_CONTENT", messageId: run.liveThinkingId, delta: run.liveThinking });
        }
      }
    }
    if (run.liveTextMessageId) {
      safeCb({ type: "TEXT_MESSAGE_START", messageId: run.liveTextMessageId, role: "assistant" });
      if (run.liveText) {
        safeCb({ type: "TEXT_MESSAGE_CONTENT", messageId: run.liveTextMessageId, delta: run.liveText });
      }
    }

    // 3. Live events from here
    run.subscribers.add(safeCb);
    return () => {
      alive = false;
      run.subscribers.delete(safeCb);
    };
  }

  private fanout(run: ActiveRun, event: AguiEvent) {
    for (const sub of run.subscribers) {
      try {
        sub(event);
      } catch {
        /* ignore */
      }
    }
  }

  /** Close text and reasoning without touching open tool calls. */
  private closeLiveTextAndReasoning(run: ActiveRun) {
    this.closeReasoningLive(run);
    this.closeTextLive(run);
  }

  /** Close an open reasoning span for live subscribers. Not buffered. */
  private closeReasoningLive(run: ActiveRun) {
    if (!run.liveThinkingId) return;
    if (run.liveReasoningMessageOpen) {
      this.fanout(run, { type: "REASONING_MESSAGE_END", messageId: run.liveThinkingId });
    }
    this.fanout(run, { type: "REASONING_END", messageId: run.liveThinkingId });
    run.liveThinking = "";
    run.liveThinkingId = null;
    run.liveReasoningMessageOpen = false;
  }

  /** Close an open text message for live subscribers. Not buffered. */
  private closeTextLive(run: ActiveRun) {
    if (!run.liveTextMessageId) return;
    this.fanout(run, { type: "TEXT_MESSAGE_END", messageId: run.liveTextMessageId });
    run.liveText = "";
    run.liveTextMessageId = null;
  }

  /** Close tool calls that never got TOOL_CALL_END. Buffered so replay stays valid. */
  private closeOpenTools(run: ActiveRun) {
    for (const toolCallId of run.openToolIds) {
      const endEvent: AguiEvent = { type: "TOOL_CALL_END", toolCallId };
      run.eventBuffer.push(endEvent);
      this.fanout(run, endEvent);
    }
    run.openToolIds = [];
  }

  /** Close text, reasoning, and tool calls before RUN_FINISHED / RUN_ERROR. */
  private closeOpenSequences(run: ActiveRun) {
    this.closeReasoningLive(run);
    this.closeTextLive(run);
    this.closeOpenTools(run);
  }

  /**
   * Fan-out an event. No-ops if runId is not the current run (superseded).
   * Text/thinking content updates the live snapshot but is NOT buffered (F5 uses snapshot).
   */
  emit(conversationId: string, event: AguiEvent, runId: symbol) {
    const run = this.runs.get(conversationId);
    if (!run || run.runId !== runId || run.finished) return;

    run.lastEventAt = Date.now();

    if (event.type === "TEXT_MESSAGE_START") {
      this.closeReasoningLive(run);
      run.liveText = "";
      run.liveTextMessageId = event.messageId;
      this.fanout(run, event);
      return;
    }

    if (event.type === "TEXT_MESSAGE_CONTENT") {
      this.closeReasoningLive(run);
      run.liveTextMessageId = event.messageId;
      run.liveText += event.delta;
      this.fanout(run, event);
      return;
    }

    if (event.type === "TEXT_MESSAGE_END") {
      run.liveText = "";
      run.liveTextMessageId = null;
      this.fanout(run, event);
      return;
    }

    if (event.type === "REASONING_START" || event.type === "REASONING_MESSAGE_START") {
      this.closeTextLive(run);
      run.liveThinkingId = event.messageId;
      if (event.type === "REASONING_START") {
        run.liveThinking = "";
        run.liveReasoningMessageOpen = false;
      } else {
        run.liveReasoningMessageOpen = true;
      }
      this.fanout(run, event);
      return;
    }

    if (event.type === "REASONING_MESSAGE_CONTENT") {
      this.closeTextLive(run);
      run.liveThinkingId = event.messageId;
      run.liveReasoningMessageOpen = true;
      run.liveThinking += event.delta;
      this.fanout(run, event);
      return;
    }

    if (event.type === "REASONING_MESSAGE_END" || event.type === "REASONING_END") {
      run.liveThinking = "";
      run.liveThinkingId = null;
      run.liveReasoningMessageOpen = false;
      this.fanout(run, event);
      return;
    }

    if (event.type === "TOOL_CALL_END") {
      run.openToolIds = run.openToolIds.filter((id) => id !== event.toolCallId);
    }

    if (event.type === "TOOL_CALL_START") {
      this.closeLiveTextAndReasoning(run);
      if (!run.openToolIds.includes(event.toolCallId)) run.openToolIds.push(event.toolCallId);
    }

    if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
      this.closeOpenSequences(run);
    }

    run.eventBuffer.push(event);
    this.fanout(run, event);
  }

  /**
   * Abort the background AI task and immediately unblock SSE relays with a
   * terminal `cancelled` event. Background finally may still run later; it
   * no-ops DB writes if the run is already finished here — callers that need
   * DB status should update status themselves (watchdog / forced finish).
   */
  cancel(conversationId: string): boolean {
    const run = this.runs.get(conversationId);
    if (!run || run.finished) return false;
    run.abort.abort();
    this.emit(conversationId, { type: "RUN_ERROR", message: "cancelled" }, run.runId);
    this.finish(conversationId, run.runId);
    run.subscribers.clear();
    return true;
  }

  /**
   * Mark a run finished and keep it briefly for late F5 reconnects to replay.
   * No-ops if this run was superseded by a newer create().
   */
  finish(conversationId: string, runId: symbol) {
    const run = this.runs.get(conversationId);
    if (!run || run.runId !== runId) return;
    run.finished = true;
    run.liveText = "";
    run.liveTextMessageId = null;
    run.liveThinking = "";
    run.liveThinkingId = null;
    run.liveReasoningMessageOpen = false;
    run.openToolIds = [];
    setTimeout(() => {
      const current = this.runs.get(conversationId);
      if (current?.runId === runId) this.runs.delete(conversationId);
    }, REPLAY_GRACE_MS);
  }

  /** Abort + emit stalled error + finish if still the current unfinished run. */
  stall(conversationId: string, runId: symbol, message = "Stream stalled (no activity)"): boolean {
    const run = this.runs.get(conversationId);
    if (!run || run.runId !== runId || run.finished) return false;
    run.abort.abort();
    this.emit(conversationId, { type: "RUN_ERROR", message }, runId);
    this.finish(conversationId, runId);
    return true;
  }
}

export const runRegistry = new RunRegistry();

/**
 * Relay runRegistry AG-UI events into an SSE response.
 * Client disconnect only unsubscribes — it does NOT cancel the background run.
 * SSE comments (`: ping`) keep Bun/proxy idleTimeouts from killing long tool waits.
 */
export async function relayRunToSSE(conversationId: string, stream: SSEStreamingApi): Promise<void> {
  if (!runRegistry.has(conversationId)) {
    await writeRunError(stream, "No active stream");
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let chain = Promise.resolve();

    const finish = () => {
      if (settled) return;
      settled = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      resolve();
    };

    let unsub = () => {};
    unsub = runRegistry.subscribe(conversationId, (event) => {
      const terminal = isAguiTerminal(event);
      chain = chain
        .then(async () => {
          if (settled) return;
          await writeAguiEvent(stream, event);
          if (terminal) {
            unsub();
            finish();
          }
        })
        .catch(() => {
          unsub();
          finish();
        });
    });

    if (!runRegistry.has(conversationId)) {
      unsub();
      void writeRunError(stream, "No active stream").finally(() => finish());
      return;
    }

    heartbeat = setInterval(() => {
      writeSseComment(stream, "ping").catch(() => {
        unsub();
        finish();
      });
    }, SSE_HEARTBEAT_MS);

    stream.onAbort(() => {
      unsub();
      finish();
    });
  });
}
