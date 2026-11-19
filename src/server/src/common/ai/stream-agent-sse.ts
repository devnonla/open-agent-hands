/**
 * stream-agent-sse.ts — Shared SSE streaming helper for LangChain agents.
 *
 * Writes AG-UI events (RUN_STARTED, TEXT_MESSAGE_*, TOOL_CALL_*, RUN_FINISHED, RUN_ERROR).
 * Keep-alive is an SSE comment (`: ping`), not a JSON event.
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { SSEStreamingApi } from "hono/streaming";
import { isAgentTaskToolName } from "../../modules/agents/runtime/llm-tools/agent-task.tool.js";
import { isCallAgentToolName } from "../../modules/agents/runtime/llm-tools/call-agent.tool.js";
import { AguiRun, writeAguiEvents, writeSseComment } from "./agui-sse.js";
import { extractAiMessageText, unstreamedTextRemainder } from "./ai-message-text.js";
import { type CallAgentStep, activityParentId, callAgentActivity, nestChildStep, popCallAgentSink, pushCallAgentSink, upsertActivityStep } from "./call-agent-activity.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StreamAgentSSEOptions {
  /** A compiled LangChain agent (returned by `createAgent`). */
  agent: { stream: (input: any, config?: any) => Promise<AsyncIterable<any>> };
  /** The full list of messages (system + user/assistant history). */
  messages: BaseMessage[];
  /** Maximum ReAct loop iterations (default 12). */
  maxSteps?: number;
  /** Hono SSE stream to write events to. */
  stream: SSEStreamingApi;
  /** Optional AbortSignal — when fired, the agent run is cancelled. */
  abortSignal?: AbortSignal;
  /** AG-UI thread. Defaults to a fresh id so runs do not share one thread. */
  threadId?: string;
}

const SSE_HEARTBEAT_MS = 15_000;

const CODE_AGENT_LABELS: Record<string, string> = {
  nonla_agent_instruct_writer: "Write Agent Prompt",
  nonla_agent_manager: "Agent Manager",
  nonla_tool_manager: "Tool Manager",
  nonla_skill_manager: "Skill Manager",
  nonla_site_manager: "Site Manager",
  nonla_job_manager: "Job Manager",
  nonla_storage_manager: "Nonla Storage Manager",
  nonla_datatable_manager: "Datatable Manager",
  nonla_kv_manager: "Nonla KV Manager",
  nonla_agent_instruct_reviewer: "Review Agent Prompt",
  nonla_get_skill_files: "Get Skill Files",
  nonla_edit_skill_code: "Edit Skill Code",
  nonla_delete_skill_file: "Delete Skill File",
  nonla_get_site_code: "Get Site Code",
  nonla_edit_site_code: "Edit Site Code",
  nonla_edit_job_code: "Edit Job Code",
  nonla_run_job: "Run Job",
  nonla_writer: "Writer",
  nonla_reviewer: "Reviewer",
  nonla_write_tool_draft_code: "Write Tool Draft Code",
  nonla_review_tool_draft_code: "Test Tool Draft Code",
  nonla_write_site_draft: "Write Site Draft",
  nonla_review_site_draft: "Test Site Draft",
  nonla_write_job_draft: "Write Job Draft",
  nonla_review_job_draft: "Test Job Draft",
  nonla_write_agent_instruct: "Write Agent Prompt",
  nonla_review_agent_instruct: "Prompt Reviewer",
  nonla_tools_manager: "Write Tool Draft Code",
  nonla_code_site: "Edit Site Code",
  nonla_code_job: "Edit Job Code",
  nonla_code_datatable: "Datatable Agent",
  nonla_code_prompt: "Write Agent Prompt",
};

function codeAgentLabel(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return CODE_AGENT_LABELS[name];
}

/** Nested agent runs (nonla_code_* → specialist agent) share this stream. Their checkpoint ns contains "|". */
export function isNestedAgentChunk(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  const ns = metadata.langgraph_checkpoint_ns ?? metadata.checkpoint_ns;
  return typeof ns === "string" && ns.includes("|");
}

type ChildAgentStep = {
  id: string;
  kind: "text" | "tool";
  name?: string;
  text?: string;
  input?: unknown;
  output?: unknown;
  activity?: ChildAgentStep[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function clipActivityValue(value: unknown, max = 1500): unknown {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (!isRecord(value) && !Array.isArray(value)) return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= max) return value;
    return `${json.slice(0, max)}…`;
  } catch {
    return undefined;
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

function parseToolResultContent(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Agent `updates` stream values vary: `{ messages }`, a message array, or a single message. */
export function messagesFromUpdateValue(state: unknown): any[] {
  if (!state) return [];
  if (Array.isArray(state)) return state;
  if (typeof state !== "object") return [];
  const rec = state as Record<string, unknown>;
  if (rec.messages != null) {
    return Array.isArray(rec.messages) ? rec.messages : [rec.messages];
  }
  if ("_getType" in rec || rec.type != null || rec.tool_calls != null || rec.tool_call_id != null) {
    return [rec];
  }
  return [];
}

function isToolMessage(msg: any): boolean {
  const msgType = msg?._getType?.() ?? msg?.type;
  return msgType === "tool" || msgType === "ToolMessage";
}

function isAiMessage(msg: any): boolean {
  const msgType = msg?._getType?.() ?? msg?.type;
  return msgType === "ai" || msgType === "AIMessage" || msgType === "AIMessageChunk";
}

// ── Helper ────────────────────────────────────────────────────────────────────

/** Run a LangChain agent and write AG-UI events to the SSE response. */
export async function streamAgentSSE({ agent, messages, maxSteps = 100, stream, abortSignal, threadId }: StreamAgentSSEOptions): Promise<void> {
  const agui = new AguiRun({ threadId: threadId || crypto.randomUUID(), runId: crypto.randomUUID() });
  const write = (events: Parameters<typeof writeAguiEvents>[1]) => writeAguiEvents(stream, events);

  let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
    writeSseComment(stream, "ping").catch(() => {
      /* client gone */
    });
  }, SSE_HEARTBEAT_MS);

  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  let flushOpenTools = async (_error: string) => {};

  try {
    await write(agui.begin());
    if (abortSignal?.aborted) {
      await write(agui.fail("cancelled"));
      return;
    }

    const agentStream = await agent.stream(
      { messages },
      {
        recursionLimit: maxSteps * 2 + 1,
        streamMode: ["messages", "updates"] as any,
        signal: abortSignal,
      },
    );

    const emittedToolNames = new Map<string, string>();
    const resolvedToolCallIds = new Set<string>();
    const pendingToolCalls = new Map<string, { name: string; argsStr: string }>();
    const codeToolArgs = new Map<string, Record<string, unknown>>();
    const codeToolNames = new Map<string, string>();
    const codeToolActivity = new Map<string, ChildAgentStep[]>();
    let activeCodeToolId: string | null = null;
    let streamedThisMessage = "";

    const writeTextDelta = async (text: string) => {
      if (!text) return;
      streamedThisMessage += text;
      await write(agui.textDelta(text));
    };

    const flushUnstreamedFromAiMessage = async (msg: { content?: unknown }) => {
      const rest = unstreamedTextRemainder(extractAiMessageText(msg?.content), streamedThisMessage);
      if (rest) await writeTextDelta(rest);
    };

    const emitToolCall = async (toolCallId: string, toolName: string, input: unknown) => {
      emittedToolNames.set(toolCallId, toolName);
      let payload = input;
      if (codeAgentLabel(toolName) || isCallAgentToolName(toolName) || isAgentTaskToolName(toolName)) {
        activeCodeToolId = toolCallId;
        codeToolNames.set(toolCallId, toolName);
        const prev = codeToolArgs.get(toolCallId) ?? {};
        const next = isRecord(input) ? input : {};
        const { activity: _activity, ...rest } = next;
        const merged = { ...prev, ...rest };
        codeToolArgs.set(toolCallId, merged);
        const activity = codeToolActivity.get(toolCallId);
        payload = activity?.length ? { ...merged, activity } : merged;
      }
      await write(
        agui.toolCall({
          toolCallId,
          toolName,
          toolLabel: codeAgentLabel(toolName) ?? (isAgentTaskToolName(toolName) ? "Agent Task" : undefined),
          input: payload,
        }),
      );
    };

    const emitToolResult = async (toolCallId: string, toolName: string, result: unknown) => {
      let id = toolCallId || "";
      const named = toolName && toolName !== "unknown" ? toolName : "";
      if (!id || !emittedToolNames.has(id)) {
        const unresolved = [...emittedToolNames.entries()].filter(([eid, name]) => (named ? name === named : true) && !resolvedToolCallIds.has(eid));
        if (unresolved.length === 1) id = unresolved[0][0];
      }
      if (id && resolvedToolCallIds.has(id)) return;
      if ((!id || !emittedToolNames.has(id)) && named) {
        if (!id) id = `${named}-${crypto.randomUUID()}`;
        await emitToolCall(id, named, {});
      }
      if (id) resolvedToolCallIds.add(id);
      if (id && id === activeCodeToolId) activeCodeToolId = null;
      await write(agui.toolResult(id, result));
    };

    const publishCodeToolActivity = async (parentId: string) => {
      await emitToolCall(parentId, codeToolNames.get(parentId) ?? "nonla_agent_task", codeToolArgs.get(parentId) ?? {});
    };

    const upsertSubStep = (parentId: string, step: ChildAgentStep) => {
      const steps = codeToolActivity.get(parentId) ?? [];
      const idx = steps.findIndex((item) => item.id === step.id);
      if (idx === -1) steps.push(step);
      else steps[idx] = { ...steps[idx], ...step, name: step.name ?? steps[idx].name };
      codeToolActivity.set(parentId, steps);
    };

    const recordNestedActivity = async (msg: any) => {
      const parentId = activeCodeToolId;
      if (!parentId) return;

      if (isToolMessage(msg)) {
        const id = typeof msg.tool_call_id === "string" && msg.tool_call_id ? msg.tool_call_id : crypto.randomUUID();
        const name = typeof msg.name === "string" && msg.name && msg.name !== "unknown" ? msg.name : undefined;
        upsertSubStep(parentId, { id, kind: "tool", name, output: clipActivityValue(parseToolResultContent(msg.content)) });
        await publishCodeToolActivity(parentId);
        return;
      }

      const calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
      for (const tc of calls) {
        if (typeof tc?.name !== "string" || !tc.name) continue;
        const id = typeof tc.id === "string" && tc.id ? tc.id : `${tc.name}-${crypto.randomUUID()}`;
        upsertSubStep(parentId, { id, kind: "tool", name: tc.name, input: clipActivityValue(tc.args) });
      }

      const chunks = Array.isArray(msg?.tool_call_chunks) ? msg.tool_call_chunks : [];
      for (const tc of chunks) {
        if (typeof tc?.name !== "string" || !tc.name || typeof tc.id !== "string" || !tc.id) continue;
        upsertSubStep(parentId, { id: tc.id, kind: "tool", name: tc.name, input: clipActivityValue(tryParseToolArgs(tc.args ?? "")) });
      }

      const text = typeof msg?.content === "string" ? msg.content.trim() : "";
      if (text) {
        upsertSubStep(parentId, { id: `text-${crypto.randomUUID()}`, kind: "text", text: text.slice(0, 1500) });
      }

      if (calls.length > 0 || chunks.some((tc: { name?: string; id?: string }) => tc?.name && tc?.id) || text) {
        await publishCodeToolActivity(parentId);
      }
    };

    flushOpenTools = async (error: string) => {
      for (const [id, name] of emittedToolNames) {
        if (!resolvedToolCallIds.has(id)) {
          await emitToolResult(id, name, { success: false, error });
        }
      }
    };

    const resolveToolCallId = (tc: { id?: string; name?: string }): string => {
      if (tc.id && emittedToolNames.has(tc.id)) return tc.id;
      const unresolved = [...emittedToolNames.entries()].filter(([id, name]) => name === tc.name && !resolvedToolCallIds.has(id));
      if (unresolved.length === 1) return unresolved[0][0];
      if (tc.id) return tc.id;
      for (const [id, pending] of pendingToolCalls) {
        if (pending.name === tc.name) return id;
      }
      return `${tc.name ?? "tool"}-${Date.now()}`;
    };

    const handleToolResultMessage = async (msg: any) => {
      if (!isToolMessage(msg)) return false;
      await emitToolResult(msg.tool_call_id ?? "", msg.name ?? "unknown", parseToolResultContent(msg.content));
      return true;
    };

    const handleAiToolCalls = async (msg: any, opts?: { keepText?: boolean }) => {
      if (!msg?.tool_calls || !Array.isArray(msg.tool_calls)) return;
      if (!opts?.keepText) streamedThisMessage = "";
      for (const tc of msg.tool_calls) {
        if (typeof tc?.name !== "string" || !tc.name) continue;
        const tcId = resolveToolCallId(tc);
        pendingToolCalls.delete(tcId);
        await emitToolCall(tcId, tc.name, tc.args);
      }
    };

    const handleAiStreamChunk = async (msgChunk: any, opts?: { isolate?: boolean }) => {
      const content = msgChunk?.content;
      const writeChunkText = async (text: string) => {
        if (opts?.isolate) {
          if (text) await write(agui.textDelta(text));
          return;
        }
        await writeTextDelta(text);
      };

      if (typeof content === "string" && content) {
        await writeChunkText(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "thinking" && block.thinking) {
            await write(agui.reasoningDelta(block.thinking));
          } else if (block.type === "reasoning") {
            const reasoningBits: string[] = [];
            if (typeof block.reasoning === "string" && block.reasoning) {
              reasoningBits.push(block.reasoning);
            } else {
              const summaries = block.summary ?? block.content ?? [];
              if (Array.isArray(summaries)) {
                for (const s of summaries) {
                  if (s.text) reasoningBits.push(s.text);
                  else if (typeof s.reasoning === "string" && s.reasoning) reasoningBits.push(s.reasoning);
                }
              } else if (typeof block.text === "string" && block.text) {
                reasoningBits.push(block.text);
              } else if (typeof summaries === "string" && summaries) {
                reasoningBits.push(summaries);
              }
            }
            for (const text of reasoningBits) {
              await write(agui.reasoningDelta(text));
            }
          } else if (block.type === "text" && block.text) {
            await writeChunkText(block.text);
          } else if (block.type === "output_text" && block.text) {
            await writeChunkText(block.text);
          }
        }
      }

      const reasoning = msgChunk?.additional_kwargs?.reasoning_content ?? msgChunk?.additional_kwargs?.reasoning;
      if (typeof reasoning === "string" && reasoning) {
        await write(agui.reasoningDelta(reasoning));
      }

      // Early tool-call: first chunk with id+name → paint Running… immediately
      if (msgChunk?.tool_call_chunks) {
        for (const tc of msgChunk.tool_call_chunks) {
          if (!tc.id) continue;
          const pending = pendingToolCalls.get(tc.id);
          if (pending) {
            if (tc.args) pending.argsStr += tc.args;
            agui.setToolArgs(tc.id, pending.argsStr);
            continue;
          }
          if (!tc.name) continue;
          pendingToolCalls.set(tc.id, { name: tc.name, argsStr: tc.args ?? "" });
          if (!emittedToolNames.has(tc.id)) {
            await emitToolCall(tc.id, tc.name, tryParseToolArgs(tc.args ?? ""));
            agui.setToolArgs(tc.id, tc.args ?? "");
          }
        }
      }
    };

    const publishChildStep = async (parentId: string, step: CallAgentStep) => {
      const id = activityParentId((candidate) => codeToolNames.has(candidate), activeCodeToolId, parentId);
      if (!id) return;
      const steps = codeToolActivity.get(id) ?? [];
      if (parentId !== id) {
        const nested = nestChildStep(steps, parentId, step);
        if (nested) {
          codeToolActivity.set(id, nested);
          await publishCodeToolActivity(id);
          return;
        }
      }
      codeToolActivity.set(id, upsertActivityStep(steps, step));
      await publishCodeToolActivity(id);
    };

    let streamStopped = false;
    const childSink = { emit: publishChildStep };
    await callAgentActivity.run(childSink, async () => {
      pushCallAgentSink(childSink);
      try {
        for await (const chunk of agentStream) {
          if (abortSignal?.aborted) {
            await flushOpenTools("cancelled");
            await write(agui.fail("cancelled"));
            streamStopped = true;
            return;
          }
          const [mode, data] = chunk as unknown as [string, any];

          if (mode === "messages") {
            const msgChunk = Array.isArray(data) ? data[0] : data;
            const metadata = Array.isArray(data) ? (data[1] as Record<string, unknown> | undefined) : undefined;
            if (isNestedAgentChunk(metadata)) {
              if (activeCodeToolId) {
                await recordNestedActivity(msgChunk);
                continue;
              }
              if (await handleToolResultMessage(msgChunk)) continue;
              if (isAiMessage(msgChunk) || msgChunk?.tool_call_chunks) {
                await handleAiStreamChunk(msgChunk, { isolate: true });
              }
              await handleAiToolCalls(msgChunk, { keepText: true });
              continue;
            }
            if (await handleToolResultMessage(msgChunk)) continue;
            if (isAiMessage(msgChunk) || msgChunk?.tool_call_chunks) {
              await handleAiStreamChunk(msgChunk);
            }
          } else if (mode === "updates") {
            for (const [, state] of Object.entries(data as Record<string, any>)) {
              const batch = messagesFromUpdateValue(state);
              if (batch.length === 0) continue;

              for (const msg of batch) {
                if (isAiMessage(msg) || (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0)) {
                  await flushUnstreamedFromAiMessage(msg);
                }
                await handleAiToolCalls(msg);
                await handleToolResultMessage(msg);
              }
            }
          }
        }
      } finally {
        popCallAgentSink();
      }
    });

    if (streamStopped) return;

    if (abortSignal?.aborted) {
      await flushOpenTools("cancelled");
      await write(agui.fail("cancelled"));
      return;
    }

    await flushOpenTools("Tool did not return a result");
    await write(agui.finish());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = abortSignal?.aborted || (err as Error)?.name === "AbortError" || msg.includes("AbortError") || msg === "AbortError" || msg.toLowerCase().includes("aborted");

    if (isAbort) {
      await flushOpenTools("cancelled");
      await write(agui.fail("cancelled"));
      return;
    }

    const isRecursionLimit = (err as any)?.constructor?.name === "GraphRecursionError" || msg.includes("Recursion limit");

    if (isRecursionLimit) {
      await flushOpenTools("Tool did not return a result");
      await write(agui.finish("max_steps_reached"));
    } else {
      await flushOpenTools(msg);
      await write(agui.fail(msg));
    }
  } finally {
    stopHeartbeat();
  }
}
