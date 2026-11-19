import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { eq } from "drizzle-orm";
import { createAgent } from "langchain";
import { z } from "zod";
import { readFinalAssistantText } from "../../../../common/ai/agent-result.js";
import { type ActivityTrace, createActivityTrace, readParentToolCallId } from "../../../../common/ai/call-agent-activity.js";
import { getChatModel } from "../../../../common/ai/getChatModel.js";
import { runChildAgent } from "../../../../common/ai/run-child-agent.js";
import { agents, getDb, llmProviders } from "../../../../common/db/client.js";
import { qall, qone } from "../../../../common/db/query.js";
import { CALL_AGENT_SOFT_WAIT_MS, type CallAgentOutcome, settleCallAgentWork } from "./call-agent.tool.js";

export const AGENT_TASK_TOOL_NAME = "nonla_agent_task";
export const AGENT_TASK_LABEL = "Agent Task";
export const AGENT_TASK_ID = "agent-task";

export function isAgentTaskToolName(name: string | null | undefined): boolean {
  return name === AGENT_TASK_TOOL_NAME;
}

export const TOOL_DEF = {
  toolName: AGENT_TASK_TOOL_NAME,
  toolLabel: AGENT_TASK_LABEL,
  description:
    "Run a one-off agent task. Pass name and prompt on every call. name is the name on that agenttask block, such as Reviewer. model defaults to inherit, which uses this agent's model. The prompt must state the criteria. The agent task gets all of your tools except this one, then returns its final answer to you.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "The agent task name from its block, such as Reviewer." },
      prompt: { type: "string", description: "That agent task's system prompt, then the task, the id, and the facts." },
      model: { type: "string", description: "inherit uses this agent's model. Pass a model id only when a different model is required. If several providers list that id, pass providerId/modelId." },
    },
    required: ["name", "prompt"],
  },
};

export function toolsForAgentTask(parentTools: StructuredToolInterface[]): StructuredToolInterface[] {
  return parentTools.filter((item) => item.name && item.name !== AGENT_TASK_TOOL_NAME);
}

export type ProviderModelRow = { id: string; models: string[] | null };

const PROVIDER_PREFIX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(.+)$/i;

function inheritsModel(requested: string | undefined): boolean {
  const raw = requested?.trim().toLowerCase() ?? "";
  return raw.length === 0 || raw === "inherit";
}

export function pickAgentTaskModel(requested: string | undefined, providers: ProviderModelRow[], fallback: { providerId?: string; modelId?: string }): { providerId: string; modelId: string } {
  if (inheritsModel(requested)) {
    if (!fallback.providerId || !fallback.modelId) {
      throw new Error("No model. Pass model, or set a model on this agent.");
    }
    return { providerId: fallback.providerId, modelId: fallback.modelId };
  }

  const raw = requested?.trim() ?? "";
  const prefixed = raw.match(PROVIDER_PREFIX);
  if (prefixed) {
    const providerId = prefixed[1] ?? "";
    const modelId = prefixed[2] ?? "";
    const provider = providers.find((row) => row.id === providerId);
    if (!provider) throw new Error(`Provider "${providerId}" not found`);
    if (!(provider.models ?? []).includes(modelId)) throw new Error(`Model "${modelId}" is not on that provider`);
    return { providerId, modelId };
  }

  const matches = providers.filter((row) => (row.models ?? []).includes(raw));
  if (matches.length === 1) {
    const only = matches[0];
    if (!only) throw new Error(`Model "${raw}" is not on a configured provider`);
    return { providerId: only.id, modelId: raw };
  }
  if (matches.length > 1) {
    const preferred = fallback.providerId ? matches.find((row) => row.id === fallback.providerId) : undefined;
    if (preferred) return { providerId: preferred.id, modelId: raw };
    throw new Error(`Model "${raw}" is on more than one provider. Pass providerId/modelId.`);
  }
  throw new Error(`Model "${raw}" is not on a configured provider`);
}

export type MakeAgentTaskToolOptions = {
  parentTools: StructuredToolInterface[];
  callerAgentId: string;
  providerId?: string;
  modelId?: string;
  abortSignal?: AbortSignal;
  conversationId?: string | null;
};

function isAbortError(err: unknown, abortSignal?: AbortSignal): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (err instanceof Error && err.name === "AbortError") || msg.includes("AbortError") || Boolean(abortSignal?.aborted);
}

function finalText(messages: BaseMessage[]): string {
  return readFinalAssistantText(messages);
}

async function loadCallerName(callerAgentId: string): Promise<string> {
  try {
    const caller = await qone(getDb().select({ name: agents.name }).from(agents).where(eq(agents.id, callerAgentId)));
    if (caller?.name) return caller.name;
  } catch {
    /* ignore */
  }
  return "the parent agent";
}

async function runAgentTask(opts: {
  prompt: string;
  providerId: string;
  modelId: string;
  parentTools: StructuredToolInterface[];
  callerAgentId: string;
  abortSignal: AbortSignal;
  parentToolCallId?: string;
  trace?: ActivityTrace;
}): Promise<CallAgentOutcome & { model: string }> {
  const modelLabel = opts.modelId;
  try {
    const callerName = await loadCallerName(opts.callerAgentId);
    const chatModel = await getChatModel(opts.providerId, opts.modelId);
    const reactAgent = createAgent({
      model: chatModel,
      tools: toolsForAgentTask(opts.parentTools),
      systemPrompt: `You run one agent task for "${callerName}".
Complete the task. Use your tools when they help.
Be concise and information-dense. Do not ask follow-up questions.
Return the final result only.`,
    });
    const input = {
      messages: [
        new HumanMessage(`<caller_context>
This request comes from agent "${callerName}". You will not get a reply after this message.
</caller_context>

${opts.prompt}`),
      ],
    };
    const messages = await runChildAgent({
      agent: reactAgent,
      messages: input.messages,
      recursionLimit: 81,
      abortSignal: opts.abortSignal,
      parentToolCallId: opts.parentToolCallId,
      onStep: opts.trace ? (step) => opts.trace?.push(step) : undefined,
    });
    const text = finalText(messages);
    return { success: true, agent_id: AGENT_TASK_ID, response: text || "(no response)", error: null, model: modelLabel };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      agent_id: AGENT_TASK_ID,
      response: null,
      error: isAbortError(err, opts.abortSignal) ? "cancelled" : msg,
      model: modelLabel,
    };
  }
}

export async function runAgentTaskNow(opts: {
  prompt: string;
  parentTools: StructuredToolInterface[];
  callerAgentId: string;
  providerId?: string;
  modelId?: string;
  requestedModel?: string;
  abortSignal?: AbortSignal;
}): Promise<CallAgentOutcome & { model: string }> {
  const providers = await qall(getDb().select({ id: llmProviders.id, models: llmProviders.models }).from(llmProviders));
  const chosen = pickAgentTaskModel(opts.requestedModel, providers, { providerId: opts.providerId, modelId: opts.modelId });
  return runAgentTask({
    prompt: opts.prompt,
    providerId: chosen.providerId,
    modelId: chosen.modelId,
    parentTools: opts.parentTools,
    callerAgentId: opts.callerAgentId,
    abortSignal: opts.abortSignal ?? new AbortController().signal,
  });
}

export function makeAgentTaskTool(options: MakeAgentTaskToolOptions): StructuredToolInterface {
  return tool(
    async (rawArgs: { name?: string; prompt?: string; model?: string }, runtime?: { toolCallId?: string }) => {
      const prompt = rawArgs?.prompt?.trim() ?? "";
      const taskName = rawArgs?.name?.trim() ?? "";
      const model = rawArgs?.model?.trim() || "inherit";
      if (!prompt) {
        return JSON.stringify({ success: false, agent_id: AGENT_TASK_ID, response: null, error: "agent_task: prompt is required" });
      }

      let chosen: { providerId: string; modelId: string };
      try {
        const providers = await qall(getDb().select({ id: llmProviders.id, models: llmProviders.models }).from(llmProviders));
        chosen = pickAgentTaskModel(model, providers, { providerId: options.providerId, modelId: options.modelId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ success: false, agent_id: AGENT_TASK_ID, response: null, error: msg });
      }

      const workAbort = new AbortController();
      const onParentAbort = () => workAbort.abort();
      if (options.abortSignal) {
        if (options.abortSignal.aborted) workAbort.abort();
        else options.abortSignal.addEventListener("abort", onParentAbort, { once: true });
      }

      const trace = createActivityTrace();
      const work = runAgentTask({
        trace,
        prompt,
        providerId: chosen.providerId,
        modelId: chosen.modelId,
        parentTools: options.parentTools,
        callerAgentId: options.callerAgentId,
        abortSignal: workAbort.signal,
        parentToolCallId: readParentToolCallId(runtime),
      });
      void work.finally(() => {
        options.abortSignal?.removeEventListener("abort", onParentAbort);
      });

      return settleCallAgentWork({
        work,
        abort: workAbort,
        softWaitMs: CALL_AGENT_SOFT_WAIT_MS,
        toolId: AGENT_TASK_ID,
        toolName: AGENT_TASK_LABEL,
        targetId: taskName || AGENT_TASK_ID,
        agentId: options.callerAgentId,
        conversationId: options.conversationId,
        label: taskName || undefined,
        trace,
      });
    },
    {
      name: AGENT_TASK_TOOL_NAME,
      description: `Run a one-off agent task on a focused job. name labels the agent task (such as Reviewer). The agent task gets all your tools except this one. Do not pass a tool list.

Every call needs name and prompt. name is the name on that agenttask block, such as Reviewer. prompt is that agent task's system prompt, then the task, the id, and the facts. Do not leave the criteria for the agent task to invent.
model defaults to inherit, which uses this agent's model. Pass a model id only when a different model is required. If several providers share that id, pass providerId/modelId.
You receive the agent task's final answer. You CAN call this in parallel for independent tasks.
If it takes longer than two minutes, this returns status "running" with a taskId — use nonla_background_tasks (await/get/cancel). Do not call this tool again to poll.`,
      schema: z.object({
        name: z.string().min(1).describe("The agent task name from its block, such as Reviewer."),
        prompt: z.string().min(1).describe("That agent task's system prompt, then the task, the id, and the facts."),
        model: z.string().optional().describe("inherit uses this agent's model. Pass a model id only when a different model is required. If several providers list that id, pass providerId/modelId."),
      }),
    },
  );
}
