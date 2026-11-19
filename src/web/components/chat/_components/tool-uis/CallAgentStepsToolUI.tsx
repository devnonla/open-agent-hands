import { Icon, Modal, Shimmer, Spin } from "devnonla-ui";
import { ChatAgentMessage, ChatToolCall, type ToolUIProps, ToolUiTrailing, formatToolName, isToolRunning } from "devnonla-ui/chat";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "src/common/api";
import { wsClient } from "src/common/api/wsClient";
import { cn } from "src/common/lib/cn";
import type { AgentListItem, AgentMessage } from "src/common/types";
import { AgentFace } from "src/components/AgentFace";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";
import { ManageToolsToolUI } from "src/components/chat/_components/tool-uis/ManageToolsToolUI";
import { useAppSelector } from "src/store/store";
import { formatDuration, parseBgTaskRef, statusLabel, timeMs } from "../../common/bgTaskUtils";
import { useBgTask, useNow } from "../../hooks/useBgTask";

const CALL_PREFIX = "nonla_call_agent__";
const LEGACY_PREFIX = "call_agent__";

/** Matches `nonla_call_agent__*` and the old `call_agent` / `call_agent__*` names in saved chats. */
export function isCallAgentToolName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name === "call_agent" || name === "nonla_call_agent" || name.startsWith(CALL_PREFIX) || name.startsWith(LEGACY_PREFIX);
}

/** Same id rules as the server `parseCallAgentToolTargetId`. */
function parseCallAgentTargetId(toolName: string | null | undefined): string | null {
  if (!toolName || toolName === "call_agent" || toolName === "nonla_call_agent") return null;
  let raw: string | null = null;
  if (toolName.startsWith(CALL_PREFIX)) raw = toolName.slice(CALL_PREFIX.length);
  else if (toolName.startsWith(LEGACY_PREFIX)) raw = toolName.slice(LEGACY_PREFIX.length);
  if (!raw) return null;
  if (raw === "nonla_bot") return "nonla-bot";
  const parts = raw.split("_");
  if (parts.length === 5 && parts.every((part) => part.length > 0)) return parts.join("-");
  return raw;
}

export type Step = {
  id?: string;
  kind?: string;
  name?: string;
  text?: string;
  input?: unknown;
  output?: unknown;
  activity?: Step[];
};

export function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

export function textField(input: unknown, key: string): string {
  const value = asRecord(input)?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function stepsOf(input: unknown): Step[] {
  const activity = asRecord(input)?.activity;
  return Array.isArray(activity) ? (activity as Step[]) : [];
}

/** The call card reads the called agent's conversation. Activity on the parent tool is only a fallback for older chats. */
export function messagesToSteps(messages: AgentMessage[]): Step[] {
  const steps: Step[] = [];
  for (const message of messages) {
    if (message.role === "user" || message.role === "thinking") continue;
    if (message.role === "assistant") {
      if (message.content?.trim()) steps.push({ id: message.id, kind: "text", text: message.content });
      continue;
    }
    if (message.role !== "tool") continue;
    const meta = message.metadata ?? {};
    const name = typeof meta.toolName === "string" ? meta.toolName : message.content;
    const input = meta.toolInput;
    const rawOutput = meta.toolOutput;
    const output = typeof rawOutput === "string" ? parsedOutput(rawOutput) : rawOutput;
    const activity = asRecord(input)?.activity;
    steps.push({ id: message.id, kind: "tool", name, input, output, activity: Array.isArray(activity) ? (activity as Step[]) : undefined });
  }
  return steps;
}

export function useCalledConversation(conversationId: string | null, running: boolean): AgentMessage[] {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      void apiClient
        .get<AgentMessage[]>(`/api/conversations/${conversationId}/messages`)
        .then((rows) => {
          if (!cancelled) setMessages(rows);
        })
        .catch(() => {});
    };
    load();
    const merge = (msg: AgentMessage) => {
      if (msg.conversationId !== conversationId) return;
      setMessages((prev) => {
        const index = prev.findIndex((item) => item.id === msg.id);
        if (index === -1) return [...prev, msg];
        const next = prev.slice();
        next[index] = { ...next[index], ...msg };
        return next;
      });
    };
    const offCreated = wsClient.on<AgentMessage>("messages:created", merge);
    const offUpdated = wsClient.on<AgentMessage>("messages:updated", merge);
    return () => {
      cancelled = true;
      offCreated();
      offUpdated();
    };
  }, [conversationId, running]);
  return messages;
}

function taskOf(input: unknown): string {
  const message = textField(input, "message") || textField(input, "prompt") || textField(input, "msg");
  const context = textField(input, "context");
  if (message && context) return `${message}\n\n${context}`;
  return message || context;
}

export function parsedOutput(output: unknown): unknown {
  if (typeof output !== "string") return output;
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return output;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return output;
  }
}

export function responseOf(output: unknown): string {
  const parsed = parsedOutput(output);
  if (typeof parsed === "string") return parsed.trim();
  return textField(parsed, "response");
}

function errorOf(output: unknown): string {
  return textField(parsedOutput(output), "error");
}

function toolFailed(output: unknown): string | boolean | undefined {
  const record = asRecord(output);
  if (!record) return undefined;
  if (record.success === false || record.ok === false) return typeof record.error === "string" ? record.error : true;
  return undefined;
}

export function statusLine(steps: Step[], running: boolean): string | null {
  if (!running) return null;
  const last = steps[steps.length - 1];
  if (!last) return "Thinking...";
  if (last.kind !== "text" && last.output == null) return `Running ${formatToolName(last.name || "tool")}...`;
  return "Writing...";
}

const AGENT_TASK_TOOL = "nonla_agent_task";

function nestedSteps(step: Step): Step[] {
  return Array.isArray(step.activity) ? (step.activity as Step[]) : [];
}

function stepResponse(step: Step): string {
  const record = asRecord(step.output);
  const response = record?.response;
  return typeof response === "string" ? response.trim() : "";
}

function InvokeStream({ step, running, failed = false, fallbackText = "" }: { step: Step; running: boolean; failed?: boolean; fallbackText?: string }) {
  const steps = nestedSteps(step);
  const endRef = useRef<HTMLDivElement>(null);
  const title = formatToolName(step.name || AGENT_TASK_TOOL);
  const [open, setOpen] = useState(true);
  const reply = fallbackText || stepResponse(step);
  const lastText = [...steps]
    .reverse()
    .find((item) => item.kind === "text" && item.text?.trim())
    ?.text?.trim();
  const showReply = Boolean(reply) && reply !== lastText && !running;

  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  useEffect(() => {
    if (!running || !open) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [running, open, steps.length]);

  return (
    <div className="nonla-chat-tool">
      <div className="px-4">
        <button type="button" onClick={() => setOpen((value) => !value)} className="group flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-1 text-sm leading-5.5 outline-none">
          {running ? <Spin variant="agent" size="small" className="shrink-0" /> : <Icon name="code" size={13} className="shrink-0 text-muted-foreground" />}
          <span className="flex min-w-0 items-center gap-1">
            <Shimmer active={running} className={cn("min-w-0 truncate text-left font-medium", !running && "text-muted-foreground")}>
              {title}
            </Shimmer>
            <ToolUiTrailing failed={failed && !running} chevron chevronClassName={cn("text-muted-foreground group-hover:opacity-100", open && "rotate-90 opacity-100")} />
          </span>
        </button>
        {open ? (
          <div className={cn("mt-1.5 mb-1 max-h-80 overflow-y-auto rounded-lg border bg-card", failed && !running ? "border-destructive/35" : "border-border")}>
            <StepList steps={steps} running={running} />
            {showReply ? <ChatAgentMessage content={reply} /> : null}
            <div ref={endRef} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ActivitySteps({ steps, running }: { steps: Step[]; running: boolean }) {
  return <StepList steps={steps} running={running} />;
}

function StepList({ steps, running }: { steps: Step[]; running: boolean }) {
  return (
    <>
      {steps.map((step, index) => {
        const stepRunning = running && step.output == null;
        if (step.kind === "text") return step.text?.trim() ? <ChatAgentMessage key={step.id ?? index} content={step.text} /> : null;
        if (step.name === AGENT_TASK_TOOL || nestedSteps(step).length > 0) return <InvokeStream key={step.id ?? index} step={step} running={stepRunning} />;
        if (step.name === "nonla_manage_tools") {
          return <ManageToolsToolUI key={step.id ?? index} msg={{ toolName: step.name, toolLabel: "Manage Tools", toolInput: step.input, toolOutput: step.output, toolError: toolFailed(step.output) }} generating={stepRunning} />;
        }
        return <ChatToolCall key={step.id ?? index} toolName={step.name || "tool"} toolInput={step.input} toolOutput={step.output} toolError={toolFailed(step.output)} running={stepRunning} icon={stepRunning ? <Spin variant="agent" size="small" className="shrink-0" /> : undefined} />;
      })}
    </>
  );
}

export function oneLine(text: string): string {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > 96 ? `${line.slice(0, 96)}…` : line;
}

function agentNameFromLabel(label: string | undefined): string {
  const stripped = (label || "").replace(/^(Call|Invoke)\s+/i, "").trim();
  return stripped || "Agent";
}

function CallAgentTranscript({
  task,
  steps,
  response,
  error,
  failed,
  running,
  live,
  showResponse,
}: {
  task: string;
  steps: Step[];
  response: string;
  error: string;
  failed: boolean;
  running: boolean;
  live: string | null;
  showResponse: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [running, steps.length, response]);

  return (
    <div className="pb-2">
      {task ? <div className="mx-4 mt-3 mb-2 rounded-xl border border-(--nonla-input) bg-muted-strong px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground [.light:not(.dark)_&]:bg-sidebar">{task}</div> : null}
      <StepList steps={steps} running={running} />
      {showResponse ? <ChatAgentMessage content={response} /> : null}
      {failed && !running && !response ? <ChatAgentMessage content={error || "Agent failed"} /> : null}
      {live ? (
        <div className="px-4 py-1">
          <Shimmer className="text-sm font-medium text-muted-foreground">{live}</Shimmer>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

function useDetachedRun(msg: ToolUIProps["msg"], generating: boolean) {
  const ref = parseBgTaskRef(msg.toolOutput);
  const task = useBgTask(ref?.taskId);
  const background = Boolean(ref);
  const backgroundRunning = background && (!task || task.status === "running");
  const now = useNow(backgroundRunning);
  const finished = background && task && task.status !== "running" && task.status !== "expired";
  let output = msg.toolOutput;
  if (finished) output = task.status === "completed" ? (task.result ?? msg.toolOutput) : { success: false, error: task.error ?? statusLabel(task.status) };
  const startedAt = task?.startedAt || timeMs(msg.timestamp);
  return {
    background,
    task,
    running: isToolRunning(msg, generating) || backgroundRunning,
    failed: Boolean(finished && task.status !== "completed"),
    output,
    elapsed: formatDuration(now - startedAt),
  };
}

/** Compact row in the chat. The full run opens in a modal. */
export function CallAgentStepsToolUI({ msg, generating = false }: ToolUIProps) {
  if (msg.toolName === AGENT_TASK_TOOL) return <AgentTaskCard msg={msg} generating={generating} />;
  return <CallAgentCard msg={msg} generating={generating} />;
}

function agentTaskTitle(input: unknown): string {
  return textField(input, "name") || "Agent Task";
}

function AgentTaskCard({ msg, generating }: { msg: ToolUIProps["msg"]; generating: boolean }) {
  const [open, setOpen] = useState(false);
  const detached = useDetachedRun(msg, generating);
  const running = detached.running;
  const traced = detached.task?.activity;
  const steps = traced?.length ? traced : stepsOf(msg.toolInput);
  const output = parsedOutput(detached.output);
  const response = responseOf(output);
  const error = errorOf(output);
  const record = asRecord(output);
  const failed = Boolean(msg.toolError) || detached.failed || record?.success === false || record?.ok === false;
  const name = agentTaskTitle(msg.toolInput);
  const live = detached.background ? `In background · ${detached.elapsed}${statusLine(steps, running) ? ` · ${statusLine(steps, running)}` : ""}` : statusLine(steps, running);
  const lastText = [...steps]
    .reverse()
    .find((step) => step.kind === "text" && step.text?.trim())
    ?.text?.trim();
  const showResponse = Boolean(response) && response !== lastText;
  const subtitle = running ? live || "Running…" : failed ? error || "Failed" : oneLine(response) || "Open to see the run";

  return (
    <div className="mt-1 px-4 py-1">
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={name} className={cn("group flex w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-card px-2.5 py-2 text-left outline-none hover:bg-ink-hover", failed && !running ? "border-destructive/35" : "border-border")}>
        <span className="min-w-0 flex-1">
          {running ? <Spin variant="agent" size="small" className="mb-1" /> : null}
          <Shimmer active={running} className="block truncate text-sm font-medium text-foreground">
            {name}
          </Shimmer>
          {subtitle !== name ? <span className={cn("mt-0.5 block truncate text-xs", failed && !running ? "text-destructive" : "text-muted-foreground")}>{subtitle}</span> : null}
        </span>
        <ToolUiTrailing failed={failed && !running} chevron chevronClassName="opacity-60 group-hover:opacity-100" />
      </button>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="min(760px, calc(100vw - 32px))"
        centered
        destroyOnHidden
        title={
          <div className="min-w-0" style={{ maxWidth: "calc(min(760px, 100vw - 32px) - 64px)" }}>
            {running ? <Spin variant="agent" size="small" className="mb-1" /> : null}
            <div className="truncate">{name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">{running ? live || "Running…" : failed ? "Failed" : "Agent task"}</div>
          </div>
        }
        styles={{ body: { padding: 0, maxHeight: "min(70vh, 640px)", overflowY: "auto" } }}
      >
        <CallAgentTranscript task="" steps={steps} response={response} error={error} failed={failed} running={running} live={live} showResponse={showResponse} />
      </Modal>
    </div>
  );
}

function CallAgentCard({ msg, generating }: { msg: ToolUIProps["msg"]; generating: boolean }) {
  const [open, setOpen] = useState(false);
  const agents = useAppSelector((s) => s.agents.items) as AgentListItem[];
  const detached = useDetachedRun(msg, generating);
  const running = detached.running;
  const task = taskOf(msg.toolInput);
  const output = parsedOutput(detached.output);
  const response = responseOf(output);
  const error = errorOf(output);
  const record = asRecord(output);
  const fromPayload = textField(msg.toolInput, "conversation_id") || textField(record, "conversation_id") || detached.task?.childConversationId || null;
  const [linkedId, setLinkedId] = useState<string | null>(null);
  useEffect(() => {
    if (fromPayload) setLinkedId(fromPayload);
  }, [fromPayload]);
  useEffect(() => {
    const toolCallId = msg.toolCallId;
    if (!toolCallId) return;
    return wsClient.on<AgentMessage>("messages:updated", (row) => {
      if (row.metadata?.toolCallId !== toolCallId) return;
      const id = textField(row.metadata?.toolInput, "conversation_id");
      if (id) setLinkedId(id);
    });
  }, [msg.toolCallId]);
  const conversationId = linkedId || fromPayload;
  const conversationMessages = useCalledConversation(conversationId, running);
  const steps = conversationId ? messagesToSteps(conversationMessages) : stepsOf(msg.toolInput);
  const failed = Boolean(msg.toolError) || detached.failed || record?.success === false || record?.ok === false;
  const lastText = [...steps]
    .reverse()
    .find((step) => step.kind === "text" && step.text?.trim())
    ?.text?.trim();
  const showResponse = !conversationId && Boolean(response) && response !== lastText;
  const stepLine = statusLine(steps, running);
  const live = detached.background ? `In background · ${detached.elapsed}${stepLine ? ` · ${stepLine}` : ""}` : stepLine;

  const targetId = parseCallAgentTargetId(msg.toolName) || textField(output, "agent_id");
  const agent = targetId && targetId !== "agent-task" ? agents.find((item) => item.id === targetId) : undefined;
  const name = agent?.name || agentNameFromLabel(msg.toolLabel);
  const subtitle = running ? live : failed ? error || "Call failed" : oneLine(task) || oneLine(response) || "Open to see the run";

  return (
    <div className="mt-1 px-4 py-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Call ${name}`}
        className={cn("group flex w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-transparent px-2.5 py-2 text-left outline-none hover:bg-ink-hover", failed && !running ? "border-destructive/35" : "border-border")}
      >
        <AgentFace config={parseAgentAvatar(agent?.avatar)} label={name} size={28} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <Shimmer active={running} className="block truncate text-sm font-medium text-foreground">
            Call {name}
          </Shimmer>
          <span className={cn("mt-0.5 block truncate text-xs", failed && !running ? "text-destructive" : "text-muted-foreground")}>{subtitle}</span>
        </span>
        {running ? <Spin variant="agent" size="small" className="shrink-0" /> : <ToolUiTrailing failed={failed} chevron chevronClassName="opacity-60 group-hover:opacity-100" />}
      </button>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="min(760px, calc(100vw - 32px))"
        centered
        destroyOnHidden
        title={
          <div className="flex min-w-0 items-center gap-2.5">
            <AgentFace config={parseAgentAvatar(agent?.avatar)} label={name} size={28} className="shrink-0" />
            <div className="min-w-0">
              <div className="truncate">{name}</div>
              <div className="truncate text-xs font-normal text-muted-foreground">{running ? live || "Calling…" : failed ? "Call failed" : "Called agent"}</div>
            </div>
          </div>
        }
        styles={{ body: { padding: 0, maxHeight: "min(70vh, 640px)", overflowY: "auto" } }}
      >
        <CallAgentTranscript task={task} steps={steps} response={response} error={error} failed={failed} running={running} live={live} showResponse={showResponse} />
      </Modal>
    </div>
  );
}
