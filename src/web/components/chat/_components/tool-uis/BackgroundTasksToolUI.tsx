import { Icon, Shimmer, Spin } from "devnonla-ui";
import { type ToolUIProps, ToolUiTrailing, isToolRunning, prettyJson } from "devnonla-ui/chat";
import { useState } from "react";
import { cn } from "src/common/lib/cn";
import { DEFAULT_AWAIT_MS, formatDuration, latestLine, parseObject, statusLabel, taskTitle, timeMs } from "../../common/bgTaskUtils";
import { type BgTaskView, useBgTask, useNow } from "../../hooks/useBgTask";
import { BgTaskLiveView, BgTaskModal } from "../BgTaskModal";

function toView(value: unknown): BgTaskView | null {
  const record = parseObject(value);
  if (!record || typeof record.taskId !== "string") return null;
  return record as unknown as BgTaskView;
}

function taskDuration(task: BgTaskView | null, now: number): string {
  if (!task?.startedAt) return "";
  const end = task.status === "running" ? now : (task.finishedAt ?? now);
  return formatDuration(end - task.startedAt);
}

function headline(action: string, running: boolean, failed: boolean, task: BgTaskView | null, name: string, remainingMs: number, timeoutMs: number, now: number, count: number | null): { text: string; aside: string } {
  const duration = taskDuration(task, now);
  const status = task?.status;
  if (action === "list") return { text: running ? "Listing background tasks" : "Background tasks", aside: count == null ? "" : `${count} ${count === 1 ? "task" : "tasks"}` };
  if (action === "cancel") return { text: running ? `Stopping ${name}` : `Stopped ${name}`, aside: "" };
  if (failed && !task) return { text: `Background ${action || "task"} failed`, aside: "" };
  if (action === "await") {
    if (running) return { text: `Waiting for ${name}`, aside: `${formatDuration(remainingMs)} left` };
    if (status === "completed") return { text: `${name} finished`, aside: duration ? `in ${duration}` : "" };
    if (status === "failed") return { text: `${name} failed`, aside: duration ? `after ${duration}` : "" };
    if (status === "cancelled") return { text: `${name} cancelled`, aside: duration ? `after ${duration}` : "" };
    return { text: `${name} still running`, aside: `waited ${formatDuration(timeoutMs)}` };
  }
  if (running) return { text: `Checking ${name}`, aside: "" };
  if (status === "running") return { text: `${name} is running`, aside: duration };
  return { text: `${name} ${statusLabel(status).toLowerCase()}`, aside: duration ? `in ${duration}` : "" };
}

function ListRow({ item }: { item: BgTaskView }) {
  const task = useBgTask(item.taskId, item) ?? item;
  const running = task.status === "running";
  const now = useNow(running);
  const [open, setOpen] = useState(false);
  const failed = task.status === "failed";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-sm outline-none hover:bg-ink-hover">
        {running ? <Spin variant="agent" size="small" className="shrink-0" /> : <Icon name={failed ? "error" : "check"} size={13} className={cn("shrink-0", failed ? "text-destructive" : "text-muted-foreground")} />}
        <span className="min-w-0 flex-1 truncate text-foreground">{taskTitle(task)}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{statusLabel(task.status)}</span>
        <span className="shrink-0 tabular-nums text-xs text-tertiary-foreground">{taskDuration(task, now)}</span>
      </button>
      <BgTaskModal taskId={task.taskId} fallback={task} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function BackgroundTasksToolUI({ msg, generating = false }: ToolUIProps) {
  const input = parseObject(msg.toolInput);
  const output = parseObject(msg.toolOutput);
  const action = typeof input?.action === "string" ? input.action : "";
  const taskId = typeof input?.taskId === "string" && input.taskId ? input.taskId : null;
  const timeoutMs = typeof input?.timeout_ms === "number" && input.timeout_ms > 0 ? input.timeout_ms : DEFAULT_AWAIT_MS;
  const items = Array.isArray(output?.items) ? (output.items as unknown[]).map(toView).filter((item): item is BgTaskView => item !== null) : [];
  const snapshot = toView(output?.task);
  const live = useBgTask(taskId);
  const task = live ?? snapshot;
  const running = isToolRunning(msg, generating);
  const failed = Boolean(msg.toolError) || output?.ok === false;
  const [open, setOpen] = useState(false);
  const waiting = running && action === "await";
  const now = useNow(running || task?.status === "running");
  const waitedMs = Math.max(0, now - timeMs(msg.timestamp));
  const remainingMs = Math.max(0, timeoutMs - waitedMs);
  const progress = Math.min(100, Math.round((waitedMs / timeoutMs) * 100));
  const name = taskTitle(task, "task");
  const { text, aside } = headline(action, running, failed, task, name, remainingMs, timeoutMs, now, action === "list" && output ? Number(output.count ?? items.length) : null);
  const errorText = typeof msg.toolError === "string" ? msg.toolError : typeof output?.error === "string" ? output.error : "Tool execution failed";
  const expandable = Boolean(task) || items.length > 0 || failed || msg.toolInput != null;
  const line = task?.status === "running" ? latestLine(task) : null;

  return (
    <div className="nonla-chat-tool mt-1">
      <div className="px-4">
        <button type="button" onClick={() => setOpen((value) => !value)} disabled={!expandable} className="group flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-1 text-left text-sm leading-5.5 outline-none">
          {running ? <Spin variant="agent" size="small" className="shrink-0" /> : <Icon name="clock" size={13} className="shrink-0 text-muted-foreground" />}
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Shimmer active={running} className={cn("min-w-0 truncate font-normal", !running && "text-muted-foreground")}>
              {text}
            </Shimmer>
            {aside ? <span className="shrink-0 tabular-nums text-tertiary-foreground">{aside}</span> : null}
            <ToolUiTrailing failed={failed && !running} chevron={expandable} chevronClassName={cn("text-muted-foreground group-hover:opacity-100", open && "rotate-90 opacity-100")} />
          </span>
        </button>

        {waiting ? (
          <div className="pb-1 pl-5.5">
            <div className="h-0.5 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
              <span>
                Waited {formatDuration(Math.min(waitedMs, timeoutMs))} of {formatDuration(timeoutMs)}
              </span>
              {task?.startedAt ? <span className="text-tertiary-foreground">· task running {taskDuration(task, now)}</span> : null}
            </div>
            {line ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{line}</div> : null}
          </div>
        ) : line ? (
          <div className="truncate pb-1 pl-5.5 text-xs text-muted-foreground">{line}</div>
        ) : null}

        {open && expandable ? (
          <div className={cn("mt-1 mb-1 overflow-hidden rounded-lg border", failed && !task ? "border-destructive/35 bg-destructive/6" : "border-border bg-card")}>
            {task ? (
              <div className="max-h-80 overflow-y-auto">
                <BgTaskLiveView task={task} />
              </div>
            ) : null}
            {items.length > 0 ? (
              <div className="max-h-60 divide-y divide-border overflow-y-auto">
                {items.map((item) => (
                  <ListRow key={item.taskId} item={item} />
                ))}
              </div>
            ) : null}
            {action === "list" && output && items.length === 0 ? <div className="px-3 py-2 text-sm text-muted-foreground">No background tasks</div> : null}
            {failed && !task ? <pre className="m-0 px-3 py-2 font-mono text-sm break-all whitespace-pre-wrap text-destructive">{errorText}</pre> : null}
            {!task && items.length === 0 && !failed && action !== "list" && msg.toolInput != null ? <pre className="m-0 max-h-27.5 overflow-y-auto px-3 py-1.5 font-mono text-sm break-all whitespace-pre-wrap text-muted-foreground">{prettyJson(msg.toolInput)}</pre> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
