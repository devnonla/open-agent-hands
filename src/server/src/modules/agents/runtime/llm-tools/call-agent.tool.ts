/**
 * call-agent.tool.ts — Builtin: one LangChain tool per callable sub-agent.
 *
 * NOTE: generateAgent is imported lazily to avoid circular dependency:
 *   agentRunner → resolveTools → call-agent → agentRunner
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type ActivityTrace, createActivityTrace, currentCallAgentSink, readParentToolCallId } from "../../../../common/ai/call-agent-activity.js";
import { agents, getDb } from "../../../../common/db/client.js";
import { qone } from "../../../../common/db/query.js";
import { createConversation, createMessage, listMessages, updateConversation, updateConversationStatus, updateMessage } from "../../../conversations/conversations.service.js";
import { bgTaskRegistry } from "../../../tools/common/bg-task-registry.js";

export const CALL_AGENT_TOOL_PREFIX = "nonla_call_agent__";
const LEGACY_CALL_AGENT_TOOL_PREFIX = "call_agent__";

/** Soft-wait before detaching into bgTaskRegistry — same window as custom tools. */
export const CALL_AGENT_SOFT_WAIT_MS = 120_000;

export function callAgentToolName(agentId: string): string {
  return `${CALL_AGENT_TOOL_PREFIX}${agentId.replace(/-/g, "_")}`;
}

export function isCallAgentToolName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name === "call_agent" || name === "nonla_call_agent" || name.startsWith(CALL_AGENT_TOOL_PREFIX) || name.startsWith(LEGACY_CALL_AGENT_TOOL_PREFIX);
}

export function parseCallAgentToolTargetId(toolName: string): string | null {
  if (toolName === "call_agent" || toolName === "nonla_call_agent") return null;
  let raw: string | null = null;
  if (toolName.startsWith(CALL_AGENT_TOOL_PREFIX)) raw = toolName.slice(CALL_AGENT_TOOL_PREFIX.length);
  else if (toolName.startsWith(LEGACY_CALL_AGENT_TOOL_PREFIX)) raw = toolName.slice(LEGACY_CALL_AGENT_TOOL_PREFIX.length);
  if (!raw) return null;
  if (raw === "nonla_bot") return "nonla-bot";
  const parts = raw.split("_");
  if (parts.length === 5 && parts.every((part) => part.length > 0)) return parts.join("-");
  return raw;
}

export type CallAgentTarget = {
  id: string;
  name: string;
  description: string | null;
};

export type CallAgentOutcome = {
  success: boolean;
  agent_id: string;
  response: string | null;
  error: string | null;
  conversation_id?: string | null;
};

/** Title shown in the called agent's history. */
export function callConversationTitle(callerName: string, task: string): string {
  const line =
    task
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "Task";
  const short = line.length > 72 ? `${line.slice(0, 72)}…` : line;
  return `${callerName}: ${short}`;
}

/** Open a chat on the called agent so the call shows in that agent's history. */
export async function openCallAgentConversation(opts: { targetId: string; callerAgentId: string; callerName: string; task: string; ownerId: string }): Promise<string | null> {
  try {
    const conv = await createConversation({
      agentId: opts.targetId,
      title: callConversationTitle(opts.callerName, opts.task),
      trigger: "manual",
      ownerId: opts.ownerId,
    });
    const id = conv.id;
    if (!id) return null;
    await updateConversation(id, { status: "running" });
    await createMessage(id, {
      agentId: opts.targetId,
      chatAgentId: opts.callerAgentId,
      role: "user",
      content: opts.task,
      metadata: { callerAgentId: opts.callerAgentId, callerName: opts.callerName },
    });
    return id;
  } catch {
    return null;
  }
}

/** Point the parent tool row at the called conversation so the card can follow it while the call runs. */
export async function attachCalledConversation(parentConversationId: string, toolCallId: string, childConversationId: string): Promise<void> {
  const rows = await listMessages(parentConversationId);
  const row = [...rows].reverse().find((item) => item.role === "tool" && item.metadata?.toolCallId === toolCallId);
  if (!row) return;
  const meta = { ...(row.metadata ?? {}) };
  const input = meta.toolInput && typeof meta.toolInput === "object" && !Array.isArray(meta.toolInput) ? { ...(meta.toolInput as Record<string, unknown>) } : {};
  input.conversation_id = childConversationId;
  delete input.activity;
  await updateMessage(row.id, { metadata: { ...meta, toolInput: input } });
}

export async function closeCallAgentConversation(conversationId: string | null, agentId: string, result: { text: string | null; error: string | null }): Promise<void> {
  if (!conversationId) return;
  try {
    const text = result.text?.trim() ? result.text : (result.error ?? "");
    const rows = await listMessages(conversationId);
    const match = text ? [...rows].reverse().find((row) => row.role === "assistant" && !!row.content && (row.content === text || text.startsWith(row.content))) : undefined;
    if (!match && text) {
      await createMessage(conversationId, { agentId, role: "assistant", content: text, metadata: null });
    } else if (match && text && match.content !== text) {
      await updateMessage(match.id, { content: text });
    }
    await updateConversationStatus(conversationId, {
      status: result.error ? "failed" : "done",
      finishedAt: new Date(),
      ...(result.error ? { errorMessage: result.error } : {}),
    });
  } catch {
    /* history is optional; the call result still returns */
  }
}

export type MakeCallAgentToolsOptions = {
  callerAgentId: string;
  targets: CallAgentTarget[];
  ownerId: string;
  isGuest?: boolean;
  abortSignal?: AbortSignal;
  conversationId?: string | null;
  enableMemory?: boolean;
  providerId?: string;
  modelId?: string;
};

function isAbortError(err: unknown, abortSignal?: AbortSignal): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (err instanceof Error && err.name === "AbortError") || msg.includes("AbortError") || Boolean(abortSignal?.aborted);
}

/**
 * Race a nested agent run against soft-wait. Completes in-window → JSON outcome.
 * Exceeds → register bg task (no wall-clock kill) and return `{ status: "running", taskId }`.
 */
export async function settleCallAgentWork(opts: {
  work: Promise<CallAgentOutcome>;
  abort: AbortController;
  softWaitMs: number;
  toolId: string;
  toolName: string;
  targetId: string;
  agentId?: string;
  conversationId?: string | null;
  label?: string;
  trace?: ActivityTrace;
}): Promise<string> {
  const softTimer = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), Math.max(0, opts.softWaitMs));
  });

  const raced = await Promise.race([opts.work.then((r) => ({ kind: "done" as const, r })), softTimer.then(() => ({ kind: "timeout" as const }))]);

  if (raced.kind === "done") {
    return JSON.stringify(raced.r);
  }

  const taskId = bgTaskRegistry.register({
    toolId: opts.toolId,
    toolName: opts.toolName,
    agentId: opts.agentId,
    conversationId: opts.conversationId,
    label: opts.label,
    kill: () => opts.abort.abort(),
  });
  opts.trace?.follow((trace) => bgTaskRegistry.setTrace(taskId, trace));

  void opts.work.then((r) => {
    if (r.success) bgTaskRegistry.finish(taskId, { ok: true, result: r });
    else bgTaskRegistry.finish(taskId, { ok: false, error: r.error ?? "call_agent failed" });
  });

  return JSON.stringify({
    status: "running",
    taskId,
    toolName: opts.toolName,
    agent_id: opts.targetId,
    message: "Still running in the background. Use background_tasks (await/get/list/cancel) with this taskId.",
  });
}

async function invokeSubAgent(opts: {
  callerAgentId: string;
  targetId: string;
  message: string;
  context?: string;
  ownerId: string;
  isGuest: boolean;
  abortSignal: AbortSignal;
  conversationId?: string | null;
  enableMemory?: boolean;
  parentToolCallId?: string;
  callerModel?: { providerId?: string; modelId?: string };
  trace?: ActivityTrace;
}): Promise<CallAgentOutcome> {
  const baseMessage = opts.context ? `${opts.message}\n\n---\n**Additional context:**\n${opts.context}` : opts.message;

  let callerName = "Another agent";
  try {
    const db = getDb();
    const caller = await qone(db.select({ name: agents.name }).from(agents).where(eq(agents.id, opts.callerAgentId)));
    if (caller?.name) callerName = caller.name;
  } catch {
    /* ignore */
  }

  const fullMessage = `<caller_context>
This request comes from agent "${callerName}" (not a human user).
You are being called as a sub-agent to handle a specific task.

Rules for your response:
- Be concise and information-dense. No filler, no pleasantries.
- Provide complete, actionable information in your response.
- Do NOT ask follow-up questions — you will not get a reply.
- Focus solely on executing the task and returning the result.
</caller_context>

${baseMessage}`;

  const childConversationId = await openCallAgentConversation({
    targetId: opts.targetId,
    callerAgentId: opts.callerAgentId,
    callerName,
    task: baseMessage,
    ownerId: opts.ownerId,
  });
  if (childConversationId) opts.trace?.setConversationId(childConversationId);
  if (childConversationId && opts.conversationId && opts.parentToolCallId) {
    try {
      await attachCalledConversation(opts.conversationId, opts.parentToolCallId, childConversationId);
    } catch {
      /* the card can still open the conversation from the tool result */
    }
  }

  try {
    const { generateAgent } = await import("../utils/agentRunner.js");
    const sink = currentCallAgentSink();
    const parentToolCallId = opts.parentToolCallId;
    const result = await generateAgent(opts.targetId, [{ role: "user", content: fullMessage }], {
      allowCallAgent: false,
      ownerId: opts.ownerId,
      isGuest: opts.isGuest,
      abortSignal: opts.abortSignal,
      conversationId: childConversationId ?? opts.conversationId,
      enableMemory: opts.enableMemory,
      persistTranscript: Boolean(childConversationId),
      callerModel: opts.callerModel,
      onChildStep:
        (sink && parentToolCallId) || opts.trace
          ? (step) => {
              if (step.conversationId) opts.trace?.setConversationId(step.conversationId);
              else opts.trace?.push(step);
              if (sink && parentToolCallId) return sink.emit(parentToolCallId, step);
            }
          : undefined,
    });
    await closeCallAgentConversation(childConversationId, opts.targetId, { text: result.text, error: null });
    return { success: true, agent_id: opts.targetId, response: result.text, error: null, conversation_id: childConversationId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const error = isAbortError(err, opts.abortSignal) ? "cancelled" : msg;
    await closeCallAgentConversation(childConversationId, opts.targetId, { text: null, error });
    return {
      success: false,
      agent_id: opts.targetId,
      response: null,
      error,
      conversation_id: childConversationId,
    };
  }
}

const CALL_AGENT_MESSAGE_KEYS = ["message", "input", "msg", "query", "task", "prompt"] as const;

/**
 * Models often send the task under `input` (LangChain's old string-tool field)
 * even when the published schema requires `message`. Map those aliases before validation.
 */
export function normalizeCallAgentArgs(raw: unknown): { message?: string; context?: string } {
  if (typeof raw === "string") return { message: raw };
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  let message: string | undefined;
  for (const key of CALL_AGENT_MESSAGE_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      message = value;
      break;
    }
  }
  const context = typeof obj.context === "string" ? obj.context : undefined;
  return context === undefined ? { message } : { message, context };
}

export const callAgentArgsSchema = z.preprocess(
  normalizeCallAgentArgs,
  z.object({
    message: z.string().min(1).describe("The full task for this specialist. Put the task in this field."),
    context: z.string().optional().describe("Optional extra context from the current task."),
  }),
);

/**
 * Build one tool per callable agent (tool-per-agent pattern).
 * Schema is only message/context — target agent is bound in the closure.
 */
export function makeCallAgentTools(options: MakeCallAgentToolsOptions): StructuredToolInterface[] {
  const { callerAgentId, targets, ownerId, isGuest = false, abortSignal, conversationId, enableMemory, providerId, modelId } = options;

  return targets.map((target) => {
    const toolName = callAgentToolName(target.id);
    const descSuffix = target.description ? ` ${target.description}` : "";

    return tool(
      async (rawArgs: { message?: string; context?: string }, runtime?: { toolCallId?: string }) => {
        const message = rawArgs?.message ?? "";
        if (!message.trim()) {
          return JSON.stringify({
            success: false,
            agent_id: target.id,
            response: null,
            error: "call_agent: message is required",
          });
        }

        const workAbort = new AbortController();
        const onParentAbort = () => workAbort.abort();
        if (abortSignal) {
          if (abortSignal.aborted) workAbort.abort();
          else abortSignal.addEventListener("abort", onParentAbort, { once: true });
        }

        const trace = createActivityTrace();
        const work = invokeSubAgent({
          trace,
          callerAgentId,
          targetId: target.id,
          message,
          context: rawArgs?.context,
          ownerId,
          isGuest,
          abortSignal: workAbort.signal,
          conversationId,
          enableMemory,
          parentToolCallId: readParentToolCallId(runtime),
          callerModel: { providerId, modelId },
        });
        void work.finally(() => {
          abortSignal?.removeEventListener("abort", onParentAbort);
        });

        return settleCallAgentWork({
          work,
          abort: workAbort,
          softWaitMs: CALL_AGENT_SOFT_WAIT_MS,
          toolId: `call-agent:${target.id}`,
          toolName: `Call ${target.name}`,
          targetId: target.id,
          agentId: callerAgentId,
          conversationId,
          label: target.name,
          trace,
        });
      },
      {
        name: toolName,
        description: `Delegate a task to specialist agent "${target.name}".${descSuffix}

Use this when "${target.name}" is the right specialist for the job.
Call it as { "message": "<full task>" }. The message field is required. Put the whole task there.
You CAN call multiple specialist tools in PARALLEL in the same step when tasks are independent.
If the specialist takes longer than two minutes, this returns status "running" with a taskId — use nonla_background_tasks (await/get/cancel). Do not re-call this tool to poll.`,
        schema: callAgentArgsSchema,
      },
    );
  });
}
