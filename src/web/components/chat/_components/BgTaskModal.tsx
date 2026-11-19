import { Icon, Modal, Popconfirm, Shimmer, Spin } from "devnonla-ui";
import { ChatAgentMessage, prettyJson } from "devnonla-ui/chat";
import { useEffect, useRef } from "react";
import { cn } from "src/common/lib/cn";
import { formatDuration, latestLine, parseObject, statusLabel, taskTitle } from "../common/bgTaskUtils";
import { type BgTaskView, useBgTask, useCancelBgTask, useNow } from "../hooks/useBgTask";
import { ActivitySteps, messagesToSteps, useCalledConversation } from "./tool-uis/CallAgentStepsToolUI";

function responseText(result: unknown): string {
  const response = parseObject(result)?.response;
  return typeof response === "string" ? response.trim() : "";
}

export function BgTaskStatusBar({ task }: { task: BgTaskView }) {
  const running = task.status === "running";
  const now = useNow(running);
  const { busy, cancel } = useCancelBgTask(task);
  const elapsed = formatDuration((running ? now : (task.finishedAt ?? now)) - task.startedAt);
  const failed = task.status === "failed";
  const tone = failed ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-4 py-2 text-sm">
      {running ? <Spin variant="agent" size="small" className="shrink-0" /> : <Icon name={failed ? "error" : "check"} size={13} className={cn("shrink-0", tone)} />}
      <span className={cn("font-medium", tone)}>{statusLabel(task.status)}</span>
      {task.startedAt > 0 ? <span className="tabular-nums text-tertiary-foreground">{running ? `${elapsed} elapsed` : `in ${elapsed}`}</span> : null}
      <span className="flex-1" />
      {running && task.conversationId ? (
        <Popconfirm title={`Stop ${taskTitle(task)}?`} okText="Stop" okType="danger" onConfirm={cancel} getPopupContainer={() => document.body}>
          <button type="button" disabled={busy} className="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-md border border-destructive/35 px-2 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40">
            <Icon name="stop" size={9} />
            Stop
          </button>
        </Popconfirm>
      ) : null}
    </div>
  );
}

export function BgTaskLiveView({ task, className }: { task: BgTaskView; className?: string }) {
  const running = task.status === "running";
  const conversationMessages = useCalledConversation(task.childConversationId ?? null, running);
  const steps = task.childConversationId ? messagesToSteps(conversationMessages) : (task.activity ?? []);
  const logs = (task.console ?? "").trim();
  const response = responseText(task.result);
  const lastText = [...steps]
    .reverse()
    .find((step) => step.kind === "text" && step.text?.trim())
    ?.text?.trim();
  const showResponse = Boolean(response) && response !== lastText;
  const rawResult = task.result !== undefined && !response ? prettyJson(task.result) : "";
  const endRef = useRef<HTMLDivElement>(null);
  const live = latestLine(task);
  const progressKey = `${steps.length}:${logs.length}`;

  useEffect(() => {
    if (!running || !progressKey) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [running, progressKey]);

  return (
    <div className={cn("min-w-0", className)}>
      <BgTaskStatusBar task={task} />
      <div className="pb-2">
        {steps.length > 0 ? <ActivitySteps steps={steps} running={running} /> : null}
        {steps.length === 0 && logs ? <pre className="m-0 px-4 py-3 font-mono text-sm leading-[1.65] break-all whitespace-pre-wrap text-foreground">{logs}</pre> : null}
        {steps.length === 0 && !logs && running ? (
          <div className="px-4 py-3">
            <Shimmer className="text-sm text-muted-foreground">Waiting for output…</Shimmer>
          </div>
        ) : null}
        {showResponse ? <ChatAgentMessage content={response} /> : null}
        {rawResult && !running ? <pre className="m-0 border-t border-border px-4 py-3 font-mono text-sm leading-[1.65] break-all whitespace-pre-wrap text-muted-foreground">{rawResult}</pre> : null}
        {task.error && task.status !== "running" ? <pre className="m-0 border-t border-destructive/35 bg-destructive/6 px-4 py-3 font-mono text-sm leading-[1.65] break-all whitespace-pre-wrap text-destructive">{task.error}</pre> : null}
        {running && live && steps.length > 0 ? (
          <div className="px-4 py-1">
            <Shimmer className="text-sm font-medium text-muted-foreground">{live}</Shimmer>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
    </div>
  );
}

export function BgTaskModal({ taskId, fallback, open, onClose }: { taskId: string; fallback?: BgTaskView | null; open: boolean; onClose: () => void }) {
  const task = useBgTask(open ? taskId : null, fallback);
  const view = task ?? fallback ?? null;
  const running = view?.status === "running";

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(760px, calc(100vw - 32px))"
      centered
      destroyOnHidden
      title={
        <div className="min-w-0" style={{ maxWidth: "calc(min(760px, 100vw - 32px) - 64px)" }}>
          <div className="truncate">{taskTitle(view)}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{running ? (latestLine(view) ?? "Running in background") : statusLabel(view?.status)}</div>
        </div>
      }
      styles={{ body: { padding: 0, maxHeight: "min(70vh, 640px)", overflowY: "auto" } }}
    >
      {view ? (
        <BgTaskLiveView task={view} />
      ) : (
        <div className="px-4 py-3">
          <Shimmer className="text-sm text-muted-foreground">Loading…</Shimmer>
        </div>
      )}
    </Modal>
  );
}
