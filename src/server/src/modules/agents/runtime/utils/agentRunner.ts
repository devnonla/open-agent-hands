/**
 * agentRunner.ts (server-side)
 *
 * Core AI engine — runs entirely on server.
 * - generateAgent(): non-streaming, returns text (for call_agent, task runner)
 * - streamAgent(): streaming via AsyncIterable of AG-UI events
 *
 * Uses createAgent from langchain.
 *
 * Tool resolution:
 *   1. agent_tool_assignments (builtin:*, mcp:*, or custom tool UUID)
 *   2. agent.callableAgentIds → system prompt + one nonla_call_agent__* tool each
 *   3. Always-on builtins: agent task, memory, get current time
 */

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { eq } from "drizzle-orm";
import { createAgent } from "langchain";
import { messagesFromAgentStream, readFinalAssistantText } from "../../../../common/ai/agent-result.js";
import type { AguiEvent } from "../../../../common/ai/agui-sse.js";
import { AguiRun } from "../../../../common/ai/agui-sse.js";
import { extractAiMessageText, unstreamedTextRemainder } from "../../../../common/ai/ai-message-text.js";
import { type CallAgentStep, activityParentId, createChildActivityEmitter, currentCallAgentSink, feedChildActivity, nestChildStep, popCallAgentSink, pushCallAgentSink, upsertActivityStep } from "../../../../common/ai/call-agent-activity.js";
import { getChatModel } from "../../../../common/ai/getChatModel.js";
import { estimateTokens, loadModelContext } from "../../../../common/ai/model-context.js";
import { type NormalizedUsage, normalizeUsage } from "../../../../common/ai/usage.js";
import { agentConversations, agents, getDb } from "../../../../common/db/client.js";
import { qall, qone } from "../../../../common/db/query.js";
import { formatNonlaPageBlock } from "../../../nonla-bot/nonla-page.js";
import { type AssignmentWithTool, listAssignments } from "../../agents.service.js";
import { isAgentTaskToolName } from "../llm-tools/agent-task.tool.js";
import { isCallAgentToolName, parseCallAgentToolTargetId } from "../llm-tools/call-agent.tool.js";
import { resolveSystemPrompt } from "./buildSystemPrompt.js";
import { appendToolsCatalog, buildLazyToolsBundle } from "./lazy-tools.middleware.js";
import { type CallerModel, resolveRunModel } from "./resolve-run-model.js";
import { getToolIcon, getToolLabel, resolveAgentTools } from "./resolveTools.js";
import { type TranscriptCursor, rememberTranscriptStep, syncCalledAgentTranscript } from "./save-call-transcript.js";

const MODEL_NODE = "model_request";
const NOSTREAM_TAG = "langsmith:nostream";

function isParentModelStreamChunk(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return true;
  const node = metadata.langgraph_node;
  if (typeof node === "string" && node !== MODEL_NODE) return false;
  const ns = (metadata.langgraph_checkpoint_ns ?? metadata.checkpoint_ns) as string | undefined;
  if (typeof ns === "string" && ns.includes("|")) return false;
  return true;
}

/** Best-effort JSON parse of streamed tool-call arg fragments (often empty/partial). */
function tryParseToolArgs(argsStr: string): unknown {
  if (!argsStr) return {};
  try {
    return JSON.parse(argsStr);
  } catch {
    return {};
  }
}

export type MessageParam =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "assistant"; content: string; toolCalls: Array<{ id: string; name: string; args: unknown }> }
  | { role: "tool-result"; toolCallId: string; toolName: string; result: string };

export function peelSummary(messages: MessageParam[]): { summary: string | null; messages: MessageParam[] } {
  if (messages[0]?.role === "system") return { summary: messages[0].content, messages: messages.slice(1) };
  return { summary: null, messages };
}

function contextUsageEvent(last: NormalizedUsage, modelContext: { max: number; providerType: string }, runModel: { providerId: string; modelId: string }, estimatedInputTokens: number, calls: NormalizedUsage[] = []) {
  const used = last.valid ? last.contextTokens : estimatedInputTokens;
  const source = last.valid ? "provider_usage" : "local_estimate";
  return {
    type: "CUSTOM" as const,
    name: "context-usage" as const,
    value: {
      used,
      max: modelContext.max,
      percent: modelContext.max > 0 ? Math.min(100, Math.max(0, Math.round((used / modelContext.max) * 100))) : 0,
      source,
      providerId: runModel.providerId,
      providerType: modelContext.providerType,
      modelId: runModel.modelId,
      estimatedInputTokens,
      calls,
    },
  };
}

function usageCallsFromMessages(messages: BaseMessage[], contextMax: number, estimatedInputTokens: number): NormalizedUsage[] {
  const calls: NormalizedUsage[] = [];
  for (const msg of messages) {
    if (typeof msg._getType === "function" && msg._getType() !== "ai") continue;
    const usage = normalizeUsage(msg, { contextMax, estimatedInputTokens });
    if (usage.inputTokens > 0 || usage.outputTokens > 0) calls.push(usage);
  }
  return calls;
}

async function lastConversationMessageId(conversationId: string): Promise<string | null> {
  const { listConversationRows } = await import("./context-usage.js");
  const rows = await listConversationRows(conversationId);
  return rows.at(-1)?.id ?? null;
}

export type AgentStepSummary = {
  toolCalls: Array<{ toolName: string; label: string; args: unknown }>;
  toolResults: Array<{ toolName: string; result: unknown }>;
  text: string;
};

export type AgentResult = {
  text: string;
  steps: AgentStepSummary[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build enabled tool_id list from junction table assignments */
function buildEnabledToolIds(assignments: AssignmentWithTool[]): string[] {
  return assignments.map((a) => a.toolId).filter((id) => id !== "builtin:call_agent" && id !== "builtin:nonla_call_agent");
}

async function loadCallableAgents(callableAgentIds: string[]): Promise<{ id: string; name: string; description: string | null }[]> {
  if (callableAgentIds.length === 0) return [];
  const db = getDb();
  const all = await qall(db.select({ id: agents.id, name: agents.name, description: agents.description }).from(agents));
  return all.filter((a) => callableAgentIds.includes(a.id));
}

function enrichToolCallInput(toolName: string, args: unknown): unknown {
  if (!isCallAgentToolName(toolName)) return args;
  const agentId = parseCallAgentToolTargetId(toolName);
  if (!agentId) return args;
  const base = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  return { ...base, agent_id: agentId };
}

/** Convert MessageParam[] to BaseMessage[] for LangChain */
function toBaseMessages(messages: MessageParam[]): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === "system") return new SystemMessage(m.content);
    if (m.role === "user") return new HumanMessage(m.content);
    if (m.role === "tool-result") {
      return new ToolMessage({
        content: m.result,
        tool_call_id: m.toolCallId,
        name: m.toolName,
      });
    }
    // assistant (with or without tool_calls)
    if ("toolCalls" in m && m.toolCalls.length > 0) {
      return new AIMessage({
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args as Record<string, unknown> })),
      });
    }
    return new AIMessage(m.content);
  });
}

/** Parse final messages from the agent's output state into AgentResult */
async function parseAgentResult(resultMessages: BaseMessage[]): Promise<AgentResult> {
  const steps: AgentStepSummary[] = [];
  let currentStep: AgentStepSummary | null = null;

  for (const msg of resultMessages) {
    const type = msg._getType();

    if (type === "ai") {
      const aiMsg = msg as AIMessage;

      // Finalize previous step if it had tool calls
      if (currentStep && currentStep.toolCalls.length > 0) {
        steps.push(currentStep);
      }

      // Check for tool calls
      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        currentStep = {
          text: extractAiMessageText(aiMsg.content),
          toolCalls: await Promise.all(
            aiMsg.tool_calls.map(async (tc) => ({
              toolName: tc.name,
              label: await getToolLabel(tc.name),
              args: tc.args,
            })),
          ),
          toolResults: [],
        };
      } else {
        currentStep = null;
      }
    } else if (type === "tool") {
      // Tool result — attach to current step
      if (currentStep) {
        const toolMsg = msg as any;
        currentStep.toolResults.push({
          toolName: toolMsg.name ?? "unknown",
          result:
            typeof toolMsg.content === "string"
              ? (() => {
                  try {
                    return JSON.parse(toolMsg.content);
                  } catch {
                    return toolMsg.content;
                  }
                })()
              : toolMsg.content,
        });
      }
    }
  }

  // Finalize last step if it had tool calls
  if (currentStep && currentStep.toolCalls.length > 0) {
    steps.push(currentStep);
  }

  return { text: readFinalAssistantText(resultMessages), steps };
}

// ─── generateAgent ────────────────────────────────────────────────────────────

/**
 * Run agent non-streaming (for call_agent tool, task runner fallback).
 * @returns { text, steps } — full response text and per-step summaries.
 */
export async function generateAgent(
  agentId: string,
  messages: MessageParam[],
  options: {
    maxSteps?: number;
    abortSignal?: AbortSignal;
    allowCallAgent?: boolean;
    ownerId?: string;
    isGuest?: boolean;
    conversationId?: string | null;
    enableMemory?: boolean;
    /** Live child tool steps, used when this run is inside call_agent. */
    onChildStep?: (step: CallAgentStep) => void | Promise<void>;
    /** Write this run's tools into conversationId so that agent's history shows them. */
    persistTranscript?: boolean;
    callerModel?: CallerModel;
  } = {},
): Promise<AgentResult> {
  const db = getDb();
  const agent = await qone(db.select().from(agents).where(eq(agents.id, agentId)));
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  const runModel = await resolveRunModel(agent, options.callerModel);

  // Get tool assignments from junction table
  const assignments = await listAssignments(agentId);
  const enabledToolIds = buildEnabledToolIds(assignments);

  const ownerId = options.ownerId ?? "user";
  const isGuest = options.isGuest ?? false;
  const allowCallAgent = options.allowCallAgent !== false;

  // Callable agents from agent's callableAgentIds column
  const callableAgentIds: string[] = (agent.callableAgentIds as string[]) ?? [];
  const callableAgents = allowCallAgent ? await loadCallableAgents(callableAgentIds) : [];

  const peeled = peelSummary(messages);
  const [model, baseSystemPrompt, tools, modelContext] = await Promise.all([
    getChatModel(runModel.providerId, runModel.modelId),
    Promise.resolve(resolveSystemPrompt(agentId, callableAgents.length > 0 ? callableAgentIds : undefined)),
    Promise.resolve(
      resolveAgentTools(agentId, enabledToolIds, ownerId, isGuest, {
        callableAgents,
        allowCallAgent,
        abortSignal: options.abortSignal,
        conversationId: options.conversationId ?? null,
        enableMemory: options.enableMemory,
        providerId: runModel.providerId,
        modelId: runModel.modelId,
      }),
    ),
    loadModelContext(runModel.providerId, runModel.modelId),
  ]);

  const lazy = buildLazyToolsBundle(tools, { messages: peeled.messages });
  const systemPrompt = appendToolsCatalog(baseSystemPrompt, lazy.catalogPromptSection) + (peeled.summary ? `\n\n${peeled.summary}` : "");

  const reactAgent = createAgent({
    model,
    tools: lazy.allToolsForAgent,
    systemPrompt,
    middleware: [lazy.middleware],
  });

  const input = {
    messages: toBaseMessages(peeled.messages),
  };

  const maxSteps = options.maxSteps ?? 40;
  const originalCount = peeled.messages.length;
  const transcriptId = options.persistTranscript && options.conversationId ? options.conversationId : null;
  const transcript = { steps: [] as CallAgentStep[] };
  const transcriptCursor: TranscriptCursor = new Map();
  const syncTranscript = async (closing = false, produced: unknown[] = []) => {
    if (!transcriptId || transcript.steps.length === 0) return;
    try {
      await syncCalledAgentTranscript({
        conversationId: transcriptId,
        agentId,
        steps: transcript.steps,
        messages: produced,
        cursor: transcriptCursor,
        closing,
      });
    } catch {
      /* history is optional; the call result still returns */
    }
  };

  let popRecorder = () => {};
  if (transcriptId) {
    const previous = currentCallAgentSink();
    pushCallAgentSink({
      emit: async (parentToolCallId, step) => {
        transcript.steps = rememberTranscriptStep(transcript.steps, step, parentToolCallId);
        await syncTranscript();
        await previous?.emit(parentToolCallId, step);
      },
    });
    popRecorder = () => popCallAgentSink();
  }

  try {
    let produced: BaseMessage[];
    if (!options.onChildStep && !transcriptId) {
      const result = await reactAgent.invoke(input, {
        recursionLimit: maxSteps * 2 + 1,
        signal: options.abortSignal,
        tags: [NOSTREAM_TAG],
      });
      produced = result.messages.slice(originalCount);
    } else {
      if (transcriptId) {
        await options.onChildStep?.({ id: `conv-${transcriptId}`, kind: "tool", conversationId: transcriptId });
      }
      const emit = async (step: CallAgentStep) => {
        if (transcriptId) {
          transcript.steps = rememberTranscriptStep(transcript.steps, step);
          await syncTranscript();
        }
        await options.onChildStep?.(step);
      };
      const stream = await reactAgent.stream(input, {
        recursionLimit: maxSteps * 2 + 1,
        signal: options.abortSignal,
        streamMode: ["messages", "updates", "values"] as const,
      });
      const onChildChunk = createChildActivityEmitter(emit);
      const chunks: { mode: string; data: unknown }[] = [];
      for await (const chunk of stream) {
        const [mode, data] = chunk as unknown as [string, unknown];
        await feedChildActivity(onChildChunk, mode, data);
        if (mode === "updates" || mode === "values") chunks.push({ mode, data });
      }
      produced = messagesFromAgentStream(chunks, originalCount) as BaseMessage[];
    }

    await syncTranscript(true, produced);
    if (options.conversationId && (options.persistTranscript || !options.onChildStep)) {
      const estimatedInputTokens = estimateTokens(`${systemPrompt}\n${JSON.stringify(peeled.messages)}`, modelContext.calibration);
      const calls = usageCallsFromMessages(produced, modelContext.max, estimatedInputTokens);
      if (calls.length > 0) {
        const { recordCapturedUsage } = await import("./context-usage.js");
        const conv = await qone(db.select({ summaryVersion: agentConversations.summaryVersion }).from(agentConversations).where(eq(agentConversations.id, options.conversationId)));
        await recordCapturedUsage({
          conversationId: options.conversationId,
          agentId,
          anchorMessageId: await lastConversationMessageId(options.conversationId),
          captured: {
            calls,
            providerId: runModel.providerId,
            providerType: modelContext.providerType,
            modelId: runModel.modelId,
            estimatedInputTokens,
            contextMax: modelContext.max,
          },
          summaryVersion: conv?.summaryVersion ?? 0,
        });
      }
    }
    return await parseAgentResult(produced);
  } finally {
    popRecorder();
  }
}

async function* iterateWithCallAgentActivity<T>(source: AsyncIterable<T>, sink: { emit: (parentToolCallId: string, step: CallAgentStep) => void }): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  pushCallAgentSink(sink);
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    popCallAgentSink();
  }
}

// ─── streamAgent ──────────────────────────────────────────────────────────────

/**
 * Run agent with streaming — yields AG-UI events.
 * Used by the chat run; the SSE relay writes them unchanged.
 */
export async function* streamAgent(
  agentId: string,
  messages: MessageParam[],
  options: {
    maxSteps?: number;
    abortSignal?: AbortSignal;
    ownerId?: string;
    isGuest?: boolean;
    conversationId?: string | null;
    enableMemory?: boolean;
    /** AG-UI run id. Same id the registry replays. */
    publicRunId?: string;
    /** Panel pathname. Appended to the system prompt for this run only. */
    pagePath?: string;
  } = {},
): AsyncGenerator<AguiEvent> {
  const agui = new AguiRun({
    threadId: options.conversationId || agentId,
    runId: options.publicRunId ?? crypto.randomUUID(),
  });
  yield* agui.begin();

  const db = getDb();
  const agent = await qone(db.select().from(agents).where(eq(agents.id, agentId)));

  if (!agent) {
    yield* agui.fail(`Agent not found: ${agentId}`);
    return;
  }

  // Get tool assignments from junction table
  const assignments = await listAssignments(agentId);
  const enabledToolIds = buildEnabledToolIds(assignments);

  const ownerId = options.ownerId ?? "user";
  const isGuest = options.isGuest ?? false;

  try {
    const runModel = await resolveRunModel(agent);
    // Callable agents from agent's callableAgentIds column
    const callableAgentIds: string[] = (agent.callableAgentIds as string[]) ?? [];
    const callableAgents = await loadCallableAgents(callableAgentIds);

    const peeled = peelSummary(messages);
    const [model, baseSystemPrompt, tools, modelContext] = await Promise.all([
      getChatModel(runModel.providerId, runModel.modelId),
      Promise.resolve(resolveSystemPrompt(agentId, callableAgents.length > 0 ? callableAgentIds : undefined)),
      Promise.resolve(
        resolveAgentTools(agentId, enabledToolIds, ownerId, isGuest, {
          callableAgents,
          allowCallAgent: true,
          abortSignal: options.abortSignal,
          conversationId: options.conversationId ?? null,
          enableMemory: options.enableMemory,
          providerId: runModel.providerId,
          modelId: runModel.modelId,
        }),
      ),
      loadModelContext(runModel.providerId, runModel.modelId),
    ]);

    const lazy = buildLazyToolsBundle(tools, { messages: peeled.messages });
    const systemPrompt = appendToolsCatalog(baseSystemPrompt, lazy.catalogPromptSection) + formatNonlaPageBlock(options.pagePath) + (peeled.summary ? `\n\n${peeled.summary}` : "");
    const estimatedInputTokens = estimateTokens(`${systemPrompt}\n${JSON.stringify(peeled.messages)}`, modelContext.calibration);

    const reactAgent = createAgent({
      model,
      tools: lazy.allToolsForAgent,
      systemPrompt,
      middleware: [lazy.middleware],
    });

    const input = {
      messages: toBaseMessages(peeled.messages),
    };

    const maxSteps = options.maxSteps ?? 40;
    const stream = await reactAgent.stream(input, {
      recursionLimit: maxSteps * 2 + 1,
      signal: options.abortSignal,
      streamMode: ["messages", "updates"] as any,
    });

    let streamedThisMessage = "";
    const emittedToolCalls = new Set<string>();
    const pendingToolCalls = new Map<string, { name: string; argsStr: string }>();
    const usageCalls: NormalizedUsage[] = [];

    const yieldTextDelta = function* (text: string) {
      if (!text) return;
      streamedThisMessage += text;
      yield* agui.textDelta(text);
    };

    const flushUnstreamedFromAiMessage = function* (msg: { content?: unknown }) {
      const rest = unstreamedTextRemainder(extractAiMessageText(msg?.content), streamedThisMessage);
      if (rest) yield* yieldTextDelta(rest);
    };

    const callParents = new Map<string, { name: string; label: string; icon: string | null; input: Record<string, unknown>; steps: CallAgentStep[] }>();
    let activeParentId: string | null = null;
    const queued: AguiEvent[][] = [];
    const noteCall = (id: string, name: string, label: string, icon: string | null, input: unknown) => {
      if (!isCallAgentToolName(name) && !isAgentTaskToolName(name)) return;
      const prev = callParents.get(id);
      const base = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
      delete base.activity;
      if (base.conversation_id == null && typeof prev?.input.conversation_id === "string") base.conversation_id = prev.input.conversation_id;
      callParents.set(id, { name, label, icon, input: base, steps: prev?.steps ?? [] });
      activeParentId = id;
    };
    const sink = {
      emit(parentId: string, step: CallAgentStep) {
        const id = activityParentId((candidate) => callParents.has(candidate), activeParentId, parentId);
        const parent = id ? callParents.get(id) : undefined;
        if (!id || !parent) return;
        if (isCallAgentToolName(parent.name)) {
          if (!step.conversationId) return;
          parent.input = { ...parent.input, conversation_id: step.conversationId };
          queued.push(agui.toolCall({ toolCallId: id, toolName: parent.name, toolLabel: parent.label, toolIcon: parent.icon, input: parent.input }));
          return;
        }
        if (parentId !== id) {
          const nested = nestChildStep(parent.steps, parentId, step);
          if (nested) {
            parent.steps = nested;
            queued.push(agui.toolCall({ toolCallId: id, toolName: parent.name, toolLabel: parent.label, toolIcon: parent.icon, input: { ...parent.input, activity: parent.steps } }));
            return;
          }
        }
        parent.steps = upsertActivityStep(parent.steps, step);
        queued.push(agui.toolCall({ toolCallId: id, toolName: parent.name, toolLabel: parent.label, toolIcon: parent.icon, input: { ...parent.input, activity: parent.steps } }));
      },
    };
    const publishParentCall = (id: string, name: string, label: string, icon: string | null, input: unknown) => {
      noteCall(id, name, label, icon, input);
      const parent = callParents.get(id);
      const nextInput = parent && !isCallAgentToolName(name) && parent.steps.length > 0 ? { ...parent.input, activity: parent.steps } : (parent?.input ?? input);
      return agui.toolCall({ toolCallId: id, toolName: name, toolLabel: label, toolIcon: icon, input: nextInput });
    };

    try {
      for await (const chunk of iterateWithCallAgentActivity(stream, sink)) {
        while (queued.length > 0) {
          const events = queued.shift();
          if (events) yield* events;
        }
        const [mode, data] = chunk as unknown as [string, any];

        if (mode === "messages") {
          const [msgChunk, metadata] = data as [any, Record<string, unknown> | undefined];
          if (!isParentModelStreamChunk(metadata)) continue;

          const msgType = msgChunk?._getType?.() ?? msgChunk?.type;

          if (msgType === "ai" || msgType === "AIMessageChunk") {
            const content = msgChunk?.content;

            // ── Extract text + thinking from content ──
            if (typeof content === "string" && content) {
              yield* yieldTextDelta(content);
            } else if (Array.isArray(content)) {
              for (const block of content) {
                // Claude: {type:"thinking", thinking:"..."}
                if (block.type === "thinking" && block.thinking) {
                  yield* agui.reasoningDelta(block.thinking);
                }
                // Reasoning: LangChain standard `{type:"reasoning", reasoning}` /
                // OpenAI Responses `{summary:[...]}` / flat `{text}`
                else if (block.type === "reasoning") {
                  if (typeof block.reasoning === "string" && block.reasoning) {
                    yield* agui.reasoningDelta(block.reasoning);
                  } else {
                    const summaries = block.summary ?? block.content ?? [];
                    if (Array.isArray(summaries)) {
                      for (const s of summaries) {
                        if (s.text) {
                          yield* agui.reasoningDelta(s.text);
                        } else if (typeof s.reasoning === "string" && s.reasoning) {
                          yield* agui.reasoningDelta(s.reasoning);
                        }
                      }
                    } else if (typeof block.text === "string" && block.text) {
                      yield* agui.reasoningDelta(block.text);
                    } else if (typeof summaries === "string" && summaries) {
                      yield* agui.reasoningDelta(summaries);
                    }
                  }
                }
                // Standard text block
                else if (block.type === "text" && block.text) {
                  yield* yieldTextDelta(block.text);
                } else if (block.type === "output_text" && block.text) {
                  yield* yieldTextDelta(block.text);
                }
              }
            }

            // Fallback: reasoning in additional_kwargs (older LangChain or non-Responses API)
            const reasoning = msgChunk?.additional_kwargs?.reasoning_content ?? msgChunk?.additional_kwargs?.reasoning;
            if (typeof reasoning === "string" && reasoning) {
              yield* agui.reasoningDelta(reasoning);
            }

            // Tool call chunks — emit early on first id+name so UI can show Running… while
            // the model finishes args and the tools node executes. updates mode later
            // re-yields the same toolCallId with full args (client/service upsert).
            if (msgChunk?.tool_call_chunks) {
              for (const tc of msgChunk.tool_call_chunks) {
                if (tc.id) {
                  const pending = pendingToolCalls.get(tc.id);
                  if (pending) {
                    // Append incremental args fragment
                    if (tc.args) pending.argsStr += tc.args;
                    agui.setToolArgs(tc.id, pending.argsStr);
                  } else if (tc.name) {
                    // First chunk for this tool call — register + notify UI immediately
                    pendingToolCalls.set(tc.id, { name: tc.name, argsStr: tc.args ?? "" });
                    if (!emittedToolCalls.has(tc.id)) {
                      emittedToolCalls.add(tc.id);
                      const earlyArgs = tryParseToolArgs(tc.args ?? "");
                      const earlyLabel = await getToolLabel(tc.name);
                      const earlyIcon = await getToolIcon(tc.name);
                      const earlyInput = enrichToolCallInput(tc.name, earlyArgs);
                      yield* publishParentCall(tc.id, tc.name, earlyLabel, earlyIcon, earlyInput);
                      agui.setToolArgs(tc.id, tc.args ?? "");
                    }
                  }
                }
              }
            }
          }
        } else if (mode === "updates") {
          // updates mode: { nodeName: { messages: [...] } }
          // Extract both tool-call and tool-result from updates mode to guarantee ordering
          // (tool-call from agent node always arrives before tool-result from tools node).
          for (const [, state] of Object.entries(data as Record<string, any>)) {
            if (!state?.messages) continue;

            for (const msg of state.messages) {
              const msgType = msg?._getType?.() ?? msg?.type;
              const isAi = msgType === "ai" || msgType === "AIMessage" || msgType === "AIMessageChunk";
              if (isAi || (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0)) {
                yield* flushUnstreamedFromAiMessage(msg);
              }
              if (isAi) {
                const usage = normalizeUsage(msg, { contextMax: modelContext.max, estimatedInputTokens });
                const prev = usageCalls[usageCalls.length - 1];
                const same = prev && prev.inputTokens === usage.inputTokens && prev.outputTokens === usage.outputTokens && prev.contextTokens === usage.contextTokens;
                if ((usage.inputTokens > 0 || usage.outputTokens > 0) && !same) {
                  usageCalls.push(usage);
                  yield contextUsageEvent(usage, modelContext, runModel, estimatedInputTokens);
                }
              }

              if (msg?.tool_calls && Array.isArray(msg.tool_calls)) {
                streamedThisMessage = "";
                for (const tc of msg.tool_calls) {
                  const tcId = tc.id ?? `${tc.name}-${Date.now()}`;
                  emittedToolCalls.add(tcId);
                  // Remove from pending since we have the complete version
                  pendingToolCalls.delete(tcId);
                  // Always yield: first paint or arg-complete upsert (same toolCallId)
                  const fullLabel = await getToolLabel(tc.name);
                  const fullIcon = await getToolIcon(tc.name);
                  const fullInput = enrichToolCallInput(tc.name, tc.args);
                  yield* publishParentCall(tcId, tc.name, fullLabel, fullIcon, fullInput);
                }
              }

              if (msgType === "tool" || msgType === "ToolMessage") {
                const toolCallId: string = msg.tool_call_id ?? "";
                const rawContent = msg.content;
                const result =
                  typeof rawContent === "string"
                    ? (() => {
                        try {
                          return JSON.parse(rawContent);
                        } catch {
                          return rawContent;
                        }
                      })()
                    : rawContent;
                const parentCall = callParents.get(toolCallId);
                if (activeParentId === toolCallId) activeParentId = null;
                if (parentCall && parentCall.steps.length > 0 && !isCallAgentToolName(parentCall.name)) {
                  yield* agui.toolCall({
                    toolCallId,
                    toolName: parentCall.name,
                    toolLabel: parentCall.label,
                    toolIcon: parentCall.icon,
                    input: { ...parentCall.input, activity: parentCall.steps },
                  });
                }
                yield* agui.toolResult(toolCallId, result);
              }
            }
          }
        }
      }

      // Flush any pending tool calls that weren't emitted via updates mode (edge case)
      for (const [tcId, pending] of pendingToolCalls) {
        agui.setToolArgs(tcId, pending.argsStr);
        if (!emittedToolCalls.has(tcId)) {
          emittedToolCalls.add(tcId);
          const parsedArgs = pending.argsStr
            ? (() => {
                try {
                  return JSON.parse(pending.argsStr);
                } catch {
                  return pending.argsStr;
                }
              })()
            : {};
          const pendingLabel = await getToolLabel(pending.name);
          const pendingIcon = await getToolIcon(pending.name);
          const pendingInput = enrichToolCallInput(pending.name, parsedArgs);
          yield* publishParentCall(tcId, pending.name, pendingLabel, pendingIcon, pendingInput);
        }
      }

      if (usageCalls.length > 0) {
        const last = [...usageCalls].reverse().find((call) => call.valid) ?? usageCalls[usageCalls.length - 1];
        if (last) yield contextUsageEvent(last, modelContext, runModel, estimatedInputTokens, usageCalls);
      }

      yield* agui.finish();
    } catch (streamErr) {
      const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      const isAbort = msg.includes("AbortError") || msg === "AbortError" || (streamErr instanceof Error && streamErr.name === "AbortError");
      if (isAbort) {
        yield* agui.fail("cancelled");
        return;
      }
      yield* agui.fail(msg);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = msg.includes("AbortError") || msg === "AbortError" || (err instanceof Error && err.name === "AbortError");
    if (isAbort) {
      yield* agui.fail("cancelled");
      return;
    }
    yield* agui.fail(msg);
  }
}
