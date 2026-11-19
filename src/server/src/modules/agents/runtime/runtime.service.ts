import { eq } from "drizzle-orm";
import type { SSEStreamingApi } from "hono/streaming";
import type { AguiEvent } from "../../../common/ai/agui-sse.js";
import { writeRunError } from "../../../common/ai/agui-sse.js";
import { isContextOverflow, learnedContextLimit } from "../../../common/ai/model-context.js";
import { agentConversations, agentMessages, agents, getDb } from "../../../common/db/client.js";
import { qone, qrun } from "../../../common/db/query.js";
import { wsHub } from "../../../common/ws/wsHub.js";
import { appendMessageContent, patchMessageMetadata, saveMessage, updateConversationStatus } from "../../conversations/conversations.service.js";
import { verifyPublicToken } from "../../public/public.service.js";
import type { MessageParam } from "./utils/agentRunner.js";
import { generateAgent, streamAgent } from "./utils/agentRunner.js";
import { compactConversation, compactionEnabled } from "./utils/compact-run.js";
import { recordCapturedUsage, rememberLearnedContext } from "./utils/context-usage.js";
import { loadHistory } from "./utils/loadHistory.js";
import { relayRunToSSE, runRegistry } from "./utils/run-registry.js";

export { loadHistory };

/** A later args event must not erase the called conversation or child steps already saved on the tool row. */
async function keepSavedActivity(toolMsgId: string, input: unknown): Promise<unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = { ...(input as Record<string, unknown>) };
  const row = await qone(getDb().select().from(agentMessages).where(eq(agentMessages.id, toolMsgId)));
  const meta = row?.metadata as Record<string, unknown> | null;
  const existing = meta?.toolInput;
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return record;
  const saved = existing as Record<string, unknown>;
  if (record.conversation_id == null && typeof saved.conversation_id === "string") record.conversation_id = saved.conversation_id;
  const activity = saved.activity;
  if ((!Array.isArray(record.activity) || record.activity.length === 0) && Array.isArray(activity) && activity.length > 0) record.activity = activity;
  return record;
}

// ─── Stream chat (HTTP is a subscriber; run is background) ───────────────────

interface ChatStreamInput {
  agentId: string;
  conversationId: string;
  message: string;
  password?: string;
  token?: string;
  pagePath?: string;
}

/**
 * Validate access, save user message, start a background agent run, then relay
 * events into the caller's SSE stream.
 *
 * The AI run is independent of this HTTP connection: client disconnect /
 * F5 only unsubscribes the relay — the background task keeps going and late
 * clients can reconnect via GET /stream (with event replay).
 */
export async function streamChatSSE(body: ChatStreamInput, stream: SSEStreamingApi): Promise<void> {
  const { agentId, conversationId, message, password, token, pagePath } = body;
  if (!conversationId || !agentId || !message) {
    await writeRunError(stream, "agentId, conversationId, and message are required");
    return;
  }

  const db = getDb();
  const conv = await qone(db.select({ agentId: agentConversations.agentId, ownerId: agentConversations.ownerId, trigger: agentConversations.trigger }).from(agentConversations).where(eq(agentConversations.id, conversationId)));

  const msgAgentId = conv?.agentId ?? agentId;

  // ── Public access validation ──────────────────────────────────────────────
  if (conv?.trigger === "public") {
    const agent = await qone(db.select({ publicPassword: agents.publicPassword, isPublic: agents.isPublic }).from(agents).where(eq(agents.id, msgAgentId)));
    if (!agent?.isPublic) {
      await writeRunError(stream, "Agent is not public.");
      return;
    }
    if (agent.publicPassword && agent.publicPassword !== password) {
      const tokenValid = token ? await verifyPublicToken(msgAgentId, token) : false;
      if (!tokenValid) {
        await writeRunError(stream, "Nhập sai mật khẩu!");
        return;
      }
    }
  }

  if (compactionEnabled()) {
    await compactConversation(conversationId, "pre_run");
  }

  // ── Prepare ───────────────────────────────────────────────────────────────
  const history = await loadHistory(conversationId);
  await saveMessage({ agentId: msgAgentId, conversationId, role: "user", content: message, metadata: null });

  // Mark running + broadcast (clear finishedAt so other tabs don't treat this as stale)
  await qrun(db.update(agentConversations).set({ status: "running", startedAt: new Date(), finishedAt: null, errorMessage: null }).where(eq(agentConversations.id, conversationId)));
  const updatedConv = await qone(db.select().from(agentConversations).where(eq(agentConversations.id, conversationId)));
  if (updatedConv) wsHub.broadcast("conversations:updated", updatedConv);

  const { abort, runId } = runRegistry.create(conversationId, agentId);

  // Background run — must not depend on this HTTP stream staying open
  void runChatBackground({
    agentId,
    conversationId,
    msgAgentId,
    message,
    history,
    ownerId: conv?.ownerId ?? "user",
    isGuest: conv?.trigger === "public",
    enableMemory: conv?.trigger !== "api",
    abortSignal: abort.signal,
    runId,
    pagePath,
  });

  // This connection is just a subscriber; abort/disconnect only unsubscribes
  await relayRunToSSE(conversationId, stream);
}

// ─── Background agent run ─────────────────────────────────────────────────────

interface BackgroundRunInput {
  agentId: string;
  conversationId: string;
  msgAgentId: string;
  message: string;
  history: MessageParam[];
  ownerId: string;
  isGuest: boolean;
  enableMemory: boolean;
  abortSignal: AbortSignal;
  runId: symbol;
  pagePath?: string;
}

/** Kill hung runs that emit nothing for this long (tools/LLM true hangs). */
const RUN_STALL_MS = 5 * 60_000;
const RUN_STALL_CHECK_MS = 30_000;

async function runChatBackground(input: BackgroundRunInput): Promise<{ text: string; failed: boolean }> {
  const { agentId, conversationId, msgAgentId, message, history, ownerId, isGuest, enableMemory, abortSignal, runId, pagePath } = input;
  const db = getDb();

  let fullText = "";
  let thinkingText = "";
  let thinkingStart = 0;
  let failed = false;
  let trailingAssistantSaved = false;
  let terminalSent = false;
  /** True while saving consecutive tool-calls that share one assistant (with tool_calls). */
  let inToolGroup = false;
  /** True when the assistant row for this tool group was saved empty (late preamble may still arrive). */
  let fillEmptyAssistant = false;
  const toolMsgIds = new Map<string, string>();
  const toolNames = new Map<string, string>();
  const toolArgs = new Map<string, string>();
  let lastAssistantMsgId: string | null = null;
  let pendingUsage: Extract<AguiEvent, { type: "CUSTOM"; name: "context-usage" }>["value"] | null = null;
  let overflowRetried = false;
  const publicRunId = runRegistry.publicRunId(conversationId) ?? crypto.randomUUID();

  const stillCurrent = () => runRegistry.isCurrent(conversationId, runId);

  const emit = (event: AguiEvent) => {
    runRegistry.emit(conversationId, event, runId);
  };

  // Stall watchdog — if the agent/tools stop emitting, unblock SSE + free status
  const stallTimer = setInterval(() => {
    if (!stillCurrent()) return;
    const last = runRegistry.lastEventAt(conversationId);
    if (last != null && Date.now() - last >= RUN_STALL_MS) {
      failed = true;
      terminalSent = true;
      runRegistry.stall(conversationId, runId);
    }
  }, RUN_STALL_CHECK_MS);

  try {
    let promptMessages: MessageParam[] = [...history, { role: "user", content: message }];
    let restartForOverflow = false;

    do {
      restartForOverflow = false;
      for await (const event of streamAgent(agentId, promptMessages, {
        abortSignal,
        ownerId,
        isGuest,
        conversationId,
        enableMemory,
        publicRunId,
        pagePath,
      })) {
        // Superseded by a newer run — stop mutating DB / registry
        if (!stillCurrent()) break;

        switch (event.type) {
          case "TEXT_MESSAGE_CONTENT":
            if (thinkingText) {
              await saveMessage({
                agentId: msgAgentId,
                conversationId,
                role: "thinking",
                content: thinkingText,
                metadata: { thinkingDuration: Math.round((Date.now() - thinkingStart) / 1000) },
              });
              thinkingText = "";
              thinkingStart = 0;
            }
            if (inToolGroup && lastAssistantMsgId && fillEmptyAssistant) {
              await appendMessageContent(lastAssistantMsgId, event.delta);
              break;
            }
            inToolGroup = false;
            lastAssistantMsgId = null;
            fillEmptyAssistant = false;
            fullText += event.delta;
            break;

          case "REASONING_MESSAGE_CONTENT":
            inToolGroup = false;
            lastAssistantMsgId = null;
            fillEmptyAssistant = false;
            if (!thinkingStart) {
              if (fullText.trim()) {
                await saveMessage({ agentId: msgAgentId, conversationId, role: "assistant", content: fullText, metadata: null });
                fullText = "";
              }
              thinkingStart = Date.now();
            }
            thinkingText += event.delta;
            break;

          case "TOOL_CALL_START": {
            const toolName = event.toolCallName;
            toolNames.set(event.toolCallId, toolName);
            if (thinkingText) {
              await saveMessage({
                agentId: msgAgentId,
                conversationId,
                role: "thinking",
                content: thinkingText,
                metadata: { thinkingDuration: Math.round((Date.now() - thinkingStart) / 1000) },
              });
              thinkingText = "";
              thinkingStart = 0;
            }
            // OpenAI requires tool messages to follow an assistant with tool_calls.
            // Always persist that assistant (text or empty) before the first tool in a group.
            if (fullText.trim()) {
              const saved = await saveMessage({ agentId: msgAgentId, conversationId, role: "assistant", content: fullText, metadata: null });
              lastAssistantMsgId = saved.id;
              fullText = "";
              inToolGroup = true;
              fillEmptyAssistant = false;
            } else if (!inToolGroup) {
              const saved = await saveMessage({ agentId: msgAgentId, conversationId, role: "assistant", content: "", metadata: null });
              lastAssistantMsgId = saved.id;
              inToolGroup = true;
              fillEmptyAssistant = true;
            }
            const toolMsg = await saveMessage({
              agentId: msgAgentId,
              conversationId,
              role: "tool",
              content: toolName,
              metadata: {
                toolName,
                toolInput: {},
                toolCallId: event.toolCallId,
              },
            });
            if (toolMsg.id) toolMsgIds.set(event.toolCallId, toolMsg.id);
            break;
          }

          case "CUSTOM": {
            if (event.name === "context-usage") {
              pendingUsage = event.value;
              break;
            }
            const toolMsgId = toolMsgIds.get(event.value.toolCallId);
            if (!toolMsgId) break;
            if (event.name === "tool-meta") {
              await patchMessageMetadata(toolMsgId, {
                ...(event.value.toolLabel ? { toolLabel: event.value.toolLabel } : {}),
                ...(event.value.toolIcon != null ? { toolIcon: event.value.toolIcon } : {}),
              });
            } else {
              toolNames.set(event.value.toolCallId, event.value.toolName);
              await patchMessageMetadata(toolMsgId, {
                toolName: event.value.toolName,
                toolInput: await keepSavedActivity(toolMsgId, event.value.input),
              });
            }
            break;
          }

          case "TOOL_CALL_ARGS": {
            const toolMsgId = toolMsgIds.get(event.toolCallId);
            if (!toolMsgId) break;
            const next = (toolArgs.get(event.toolCallId) ?? "") + event.delta;
            toolArgs.set(event.toolCallId, next);
            try {
              await patchMessageMetadata(toolMsgId, { toolInput: await keepSavedActivity(toolMsgId, JSON.parse(next)) });
            } catch {
              /* partial args */
            }
            break;
          }

          case "TOOL_CALL_RESULT": {
            inToolGroup = false;
            lastAssistantMsgId = null;
            fillEmptyAssistant = false;
            const toolMsgId = toolMsgIds.get(event.toolCallId);
            const toolName = toolNames.get(event.toolCallId) ?? "unknown";
            if (toolMsgId) {
              const raw = event.content;
              const result =
                typeof raw === "string"
                  ? (() => {
                      try {
                        return JSON.parse(raw);
                      } catch {
                        return raw;
                      }
                    })()
                  : raw;
              const resultStr = typeof raw === "string" ? raw : JSON.stringify(raw);
              const patchData: Record<string, unknown> = {
                toolOutput: resultStr,
                result,
              };
              const { isCallAgentToolName, parseCallAgentToolTargetId } = await import("./llm-tools/call-agent.tool.js");
              if (isCallAgentToolName(toolName)) {
                try {
                  const parsed = typeof result === "string" ? JSON.parse(result) : result;
                  const calledAgentId = parsed?.agent_id ?? parseCallAgentToolTargetId(toolName);
                  if (calledAgentId) {
                    const existingInput = await (async (): Promise<Record<string, unknown>> => {
                      const row = await qone(getDb().select().from(agentMessages).where(eq(agentMessages.id, toolMsgId)));
                      const meta = row?.metadata as Record<string, unknown> | null;
                      return (meta?.toolInput as Record<string, unknown>) ?? {};
                    })();
                    patchData.toolInput = { ...existingInput, agent_id: calledAgentId };
                    const { getCallAgentLabel } = await import("./utils/resolveTools.js");
                    patchData.toolLabel = await getCallAgentLabel({ agent_id: calledAgentId });
                  }
                } catch {
                  /* ignore parse errors */
                }
              }
              await patchMessageMetadata(toolMsgId, patchData);
            }
            break;
          }

          case "RUN_FINISHED":
            // Persist trailing thinking/text BEFORE clients see RUN_FINISHED (avoids refetch race).
            // Thinking stays thinking — never promote into assistant content.
            if (thinkingText) {
              await saveMessage({
                agentId: msgAgentId,
                conversationId,
                role: "thinking",
                content: thinkingText,
                metadata: { thinkingDuration: Math.round((Date.now() - thinkingStart) / 1000) },
              });
              thinkingText = "";
              thinkingStart = 0;
            }
            if (fullText.trim()) {
              const saved = await saveMessage({ agentId: msgAgentId, conversationId, role: "assistant", content: fullText, metadata: null });
              lastAssistantMsgId = saved.id;
              trailingAssistantSaved = true;
            }
            break;

          case "RUN_ERROR":
            if (!overflowRetried && isContextOverflow(event.message) && toolMsgIds.size === 0 && !fullText.trim()) {
              overflowRetried = true;
              restartForOverflow = true;
              const learned = learnedContextLimit(event.message);
              if (learned && pendingUsage) {
                await rememberLearnedContext(pendingUsage.providerId, pendingUsage.modelId, learned);
              }
              break;
            }
            failed = true;
            break;
        }

        if (restartForOverflow) break;

        emit(event);

        if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
          terminalSent = true;
          break;
        }
      }
      if (restartForOverflow) {
        await compactConversation(conversationId, "overflow");
        const retryHistory = await loadHistory(conversationId);
        promptMessages = [...retryHistory, { role: "user", content: message }];
        pendingUsage = null;
      }
    } while (restartForOverflow);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = abortSignal.aborted || msg.includes("AbortError") || msg === "AbortError" || (err instanceof Error && err.name === "AbortError");
    failed = true;
    // Only emit cancel/error if we still own the run (superseded / cancel already terminalized)
    if (stillCurrent()) {
      const errorMsg = isAbort ? "cancelled" : msg;
      emit({ type: "RUN_ERROR", message: errorMsg });
      terminalSent = true;
    } else if (abortSignal.aborted) {
      // cancel() already finished the run + notified subscribers; still mark for DB cleanup below
      failed = true;
      terminalSent = true;
    }
  } finally {
    clearInterval(stallTimer);

    const runStillOurs = () => {
      // isCurrent requires !finished — after cancel/stall the run is finished but may still be ours in grace.
      // Prefer finishing DB when this runId still owns the registry entry OR entry already dropped after grace.
      if (runRegistry.isCurrent(conversationId, runId)) return true;
      // Finished by cancel()/stall() while we were blocked in a tool — still need DB status
      if (abortSignal.aborted && !runRegistry.isActive(conversationId)) return true;
      return false;
    };

    // Superseded by a newer create() — do not touch status / messages / registry
    if (runStillOurs()) {
      // If cancel already marked finished mid-tool, treat as failed/cancelled
      if (abortSignal.aborted) failed = true;

      if (failed) {
        for (const [, toolMsgId] of toolMsgIds.entries()) {
          const row = await qone(db.select().from(agentMessages).where(eq(agentMessages.id, toolMsgId)));
          const meta = row?.metadata as Record<string, unknown> | null;
          if (row && !meta?.toolOutput) {
            await patchMessageMetadata(toolMsgId, {
              toolOutput: JSON.stringify({ error: "Tool execution failed or was interrupted" }),
              toolError: true,
            });
          }
        }
      }

      // Leftover thinking/text after stream end (may already be flushed on `done`).
      // Thinking stays thinking — never promote into assistant content.
      if (thinkingText) {
        await saveMessage({
          agentId: msgAgentId,
          conversationId,
          role: "thinking",
          content: thinkingText,
          metadata: { thinkingDuration: Math.round((Date.now() - thinkingStart) / 1000) },
        });
        thinkingText = "";
      }
      if (fullText.trim() && !trailingAssistantSaved) {
        const saved = await saveMessage({ agentId: msgAgentId, conversationId, role: "assistant", content: fullText, metadata: null });
        lastAssistantMsgId = saved.id;
      }

      if (pendingUsage && !failed) {
        const conv = await qone(db.select({ summaryVersion: agentConversations.summaryVersion }).from(agentConversations).where(eq(agentConversations.id, conversationId)));
        await recordCapturedUsage({
          conversationId,
          agentId,
          runId: publicRunId,
          anchorMessageId: lastAssistantMsgId,
          captured: {
            calls: pendingUsage.calls,
            providerId: pendingUsage.providerId,
            providerType: pendingUsage.providerType,
            modelId: pendingUsage.modelId,
            estimatedInputTokens: pendingUsage.estimatedInputTokens,
            contextMax: pendingUsage.max,
          },
          summaryVersion: conv?.summaryVersion ?? 0,
        });
      }

      await updateConversationStatus(conversationId, { status: failed ? "failed" : "done", finishedAt: new Date() });

      if (!failed && compactionEnabled()) {
        void compactConversation(conversationId, "post_run").catch(() => undefined);
      }

      if (stillCurrent()) {
        if (!terminalSent) {
          if (failed) {
            emit({ type: "RUN_ERROR", message: "Stream ended unexpectedly" });
          } else {
            emit({ type: "RUN_FINISHED", threadId: conversationId, runId: publicRunId });
          }
        }
        runRegistry.finish(conversationId, runId);
      }
    }
  }

  return { text: fullText, failed };
}

/**
 * Run an agent inside an existing conversation using the same streaming registry as chat.
 * Jobs/cron can await the final text; Stop in the UI works via runRegistry + GET /stream resume.
 * Caller must already have saved the user message.
 */
export async function runAgentConversation(opts: {
  agentId: string;
  conversationId: string;
  message: string;
  ownerId: string;
  isGuest?: boolean;
}): Promise<{ text: string; failed: boolean; cancelled: boolean }> {
  const { agentId, conversationId, message, ownerId, isGuest = false } = opts;
  const history = await loadHistory(conversationId);
  // runChatBackground appends the user message — drop the trailing duplicate if already saved
  const hist = [...history];
  if (hist.length > 0) {
    const last = hist[hist.length - 1];
    if (last.role === "user" && last.content === message) hist.pop();
  }

  const db = getDb();
  await qrun(db.update(agentConversations).set({ status: "running", startedAt: new Date(), finishedAt: null, errorMessage: null }).where(eq(agentConversations.id, conversationId)));
  const updatedConv = await qone(db.select().from(agentConversations).where(eq(agentConversations.id, conversationId)));
  if (updatedConv) wsHub.broadcast("conversations:updated", updatedConv);

  const { abort, runId } = runRegistry.create(conversationId, agentId);
  const result = await runChatBackground({
    agentId,
    conversationId,
    msgAgentId: agentId,
    message,
    history: hist,
    ownerId,
    isGuest,
    enableMemory: true,
    abortSignal: abort.signal,
    runId,
  });

  return {
    text: result.text,
    failed: result.failed,
    cancelled: abort.signal.aborted,
  };
}

/**
 * Stop a running stream. Unblocks SSE immediately and marks conversation failed
 * so the UI does not stay on spinner while a hung tool ignores abort.
 */
export async function stopStream(conversationId: string) {
  const cancelled = runRegistry.cancel(conversationId);
  if (cancelled) {
    await updateConversationStatus(conversationId, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: "cancelled",
    });
    return true;
  }
  // Orphan running row (e.g. legacy non-registry job call) — clear spinner in UI
  const conv = await qone(getDb().select().from(agentConversations).where(eq(agentConversations.id, conversationId)));
  if (conv?.status === "running") {
    await updateConversationStatus(conversationId, {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: "cancelled",
    });
    return true;
  }
  return false;
}

// ─── Generate (non-streaming) ─────────────────────────────────────────────────

export async function generateResponse(agentId: string, message: string, conversationId?: string, maxSteps = 40, opts: { ownerId?: string } = {}) {
  const history = conversationId ? await loadHistory(conversationId) : [];
  const messages = [...history, { role: "user" as const, content: message }];

  let ownerId = opts.ownerId ?? "user";
  if (conversationId) {
    const conv = await qone(getDb().select({ ownerId: agentConversations.ownerId }).from(agentConversations).where(eq(agentConversations.id, conversationId)));
    if (conv?.ownerId) ownerId = conv.ownerId;
  }

  return generateAgent(agentId, messages, {
    maxSteps,
    ownerId,
    conversationId: conversationId ?? null,
  });
}
