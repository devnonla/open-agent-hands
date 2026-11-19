/**
 * Persist a called agent's tool steps into its own conversation.
 * The parent chat already shows them live. This writes the same steps
 * so the called agent's history shows them after reload.
 */

import { type CallAgentStep, nestChildStep, upsertActivityStep } from "../../../../common/ai/call-agent-activity.js";
import { createMessage, saveMessage, updateMessage } from "../../../conversations/conversations.service.js";
import { getToolLabel } from "./resolveTools.js";

type ToolPayload = {
  name: string;
  args: unknown;
  output?: unknown;
};

/** Place a live step on the transcript. Nested runs sit inside the tool that started them. */
export function rememberTranscriptStep(steps: CallAgentStep[], step: CallAgentStep, hostId?: string): CallAgentStep[] {
  if (hostId) {
    const nested = nestChildStep(steps, hostId, step);
    if (nested) return nested;
  }
  return upsertActivityStep(steps, step);
}

function kindOf(msg: Record<string, unknown>): string | undefined {
  const typed = msg as { _getType?: () => string; type?: unknown };
  const fromGetter = typed._getType?.();
  if (typeof fromGetter === "string") return fromGetter;
  return typeof typed.type === "string" ? typed.type : undefined;
}

/** Full tool args and results from the model transcript. Activity steps are clipped. */
export function toolPayloadsFromMessages(messages: unknown[]): Map<string, ToolPayload> {
  const map = new Map<string, ToolPayload>();
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const msg = raw as Record<string, unknown>;
    const kind = kindOf(msg);
    if (kind === "ai" || kind === "AIMessage") {
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      for (const call of calls) {
        if (!call || typeof call !== "object") continue;
        const row = call as { id?: unknown; name?: unknown; args?: unknown };
        const id = typeof row.id === "string" ? row.id : "";
        const name = typeof row.name === "string" ? row.name : "";
        if (!id || !name) continue;
        map.set(id, { name, args: row.args });
      }
      continue;
    }
    if (kind !== "tool" && kind !== "ToolMessage") continue;
    const id = typeof msg.tool_call_id === "string" ? msg.tool_call_id : "";
    if (!id) continue;
    const prev = map.get(id) ?? { name: typeof msg.name === "string" && msg.name ? msg.name : "tool", args: {} };
    if (typeof msg.name === "string" && msg.name) prev.name = msg.name;
    prev.output = msg.content;
    map.set(id, prev);
  }
  return map;
}

function isFinalSpeech(text: string, finalText: string): boolean {
  const speech = text.trim();
  const final = finalText.trim();
  if (!speech || !final) return false;
  return speech === final || final.startsWith(speech);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function outputString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isToolError(value: unknown): boolean {
  const record = asRecord(value) ?? asRecord(typeof value === "string" ? tryParse(value) : null);
  if (!record) return false;
  return record.success === false || record.ok === false;
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toolInputOf(step: CallAgentStep, args: unknown): unknown {
  const activity = step.activity;
  const base = asRecord(args) ?? (args == null ? {} : { value: args });
  if (!activity?.length) return args ?? {};
  return { ...base, activity };
}

export type TranscriptCursor = Map<string, { messageId: string; fingerprint: string }>;

function stepFingerprint(step: CallAgentStep, text: string, outputText: string): string {
  const activity = step.activity?.length ?? 0;
  return `${step.kind}|${step.name ?? ""}|${text}|${outputText}|${activity}`;
}

/**
 * Upsert the called agent's steps into its conversation.
 * The same step id updates one row, so a live stream does not insert copies.
 */
export async function syncCalledAgentTranscript(opts: { conversationId: string; agentId: string; steps: CallAgentStep[]; messages?: unknown[]; cursor: TranscriptCursor; closing?: boolean }): Promise<void> {
  const payloads = toolPayloadsFromMessages(opts.messages ?? []);
  const labels = new Map<string, string>();

  for (let index = 0; index < opts.steps.length; index++) {
    const step = opts.steps[index];
    const stepId = step?.id;
    if (!step || !stepId || step.conversationId) continue;
    const isOpenText = step.kind === "text" && index === opts.steps.length - 1 && !opts.closing;
    if (step.kind === "text") {
      const text = step.text?.trim() ?? "";
      if (!text || isOpenText) continue;
      const fingerprint = stepFingerprint(step, text, "");
      const prev = opts.cursor.get(stepId);
      if (prev?.fingerprint === fingerprint) continue;
      if (!prev) {
        const msg = await createMessage(opts.conversationId, { agentId: opts.agentId, role: "assistant", content: text, metadata: null });
        if (!msg.id) continue;
        opts.cursor.set(stepId, { messageId: msg.id, fingerprint });
      } else {
        await updateMessage(prev.messageId, { content: text });
        prev.fingerprint = fingerprint;
      }
      continue;
    }

    const payload = payloads.get(stepId);
    const name = payload?.name || step.name || "tool";
    let label = labels.get(name);
    if (!label) {
      label = await getToolLabel(name);
      labels.set(name, label);
    }
    const output = payload && "output" in payload ? payload.output : step.output;
    const outputText = outputString(output);
    const fingerprint = stepFingerprint(step, "", outputText);
    const prev = opts.cursor.get(stepId);
    if (prev?.fingerprint === fingerprint) continue;
    const metadata = {
      toolName: name,
      toolLabel: label,
      toolCallId: stepId,
      toolInput: toolInputOf(step, payload?.args ?? step.input),
      ...(outputText ? { toolOutput: outputText } : {}),
      ...(isToolError(output) ? { toolError: true } : {}),
    };
    if (!prev) {
      const msg = await createMessage(opts.conversationId, { agentId: opts.agentId, role: "tool", content: name, metadata });
      if (!msg.id) continue;
      opts.cursor.set(stepId, { messageId: msg.id, fingerprint });
    } else {
      await updateMessage(prev.messageId, { content: name, metadata });
      prev.fingerprint = fingerprint;
    }
  }
}

/**
 * Write tool rows and the words between them.
 * The closing assistant message is saved by closeCallAgentConversation.
 */
export async function saveCalledAgentTranscript(opts: { conversationId: string; agentId: string; steps: CallAgentStep[]; finalText: string; messages?: unknown[] }): Promise<void> {
  const payloads = toolPayloadsFromMessages(opts.messages ?? []);
  const labels = new Map<string, string>();

  for (const step of opts.steps) {
    if (step.kind === "text") {
      const text = step.text?.trim() ?? "";
      if (!text || isFinalSpeech(text, opts.finalText)) continue;
      await saveMessage({
        agentId: opts.agentId,
        conversationId: opts.conversationId,
        role: "assistant",
        content: text,
        metadata: null,
      });
      continue;
    }

    const payload = step.id ? payloads.get(step.id) : undefined;
    const name = payload?.name || step.name || "tool";
    let label = labels.get(name);
    if (!label) {
      label = await getToolLabel(name);
      labels.set(name, label);
    }
    const output = payload && "output" in payload ? payload.output : step.output;
    const outputText = outputString(output);
    await saveMessage({
      agentId: opts.agentId,
      conversationId: opts.conversationId,
      role: "tool",
      content: name,
      metadata: {
        toolName: name,
        toolLabel: label,
        ...(step.id ? { toolCallId: step.id } : {}),
        toolInput: toolInputOf(step, payload?.args ?? step.input),
        ...(outputText ? { toolOutput: outputText } : {}),
        ...(isToolError(output) ? { toolError: true } : {}),
      },
    });
  }
}
