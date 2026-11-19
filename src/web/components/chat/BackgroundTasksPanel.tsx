import { Icon, Popconfirm, Spin } from "devnonla-ui";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "src/common/lib/cn";
import { BgTaskModal } from "./_components/BgTaskModal";
import { formatDuration, latestLine, taskTitle } from "./common/bgTaskUtils";
import { type BgTaskView, useNow } from "./hooks/useBgTask";

function TaskRow({ task, now, cancelling, onCancel, onOpen }: { task: BgTaskView; now: number; cancelling: boolean; onCancel: () => void; onOpen: () => void }) {
  const line = latestLine(task);
  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5">
      <button type="button" onClick={onOpen} title="Open live view" aria-label={`Open ${taskTitle(task)}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-0.75 text-left transition-colors hover:bg-muted">
        <Spin variant="agent" size="small" className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-normal text-foreground">{taskTitle(task)}</span>
          {line ? <span className="block truncate text-xs text-muted-foreground">{line}</span> : null}
        </span>
        <span className="shrink-0 text-sm tabular-nums text-tertiary-foreground">{formatDuration(now - task.startedAt)}</span>
      </button>
      <Popconfirm title={`Stop ${taskTitle(task)}?`} okText="Stop" okType="danger" onConfirm={onCancel} getPopupContainer={() => document.body}>
        <button type="button" disabled={cancelling} title="Stop" aria-label={`Stop ${taskTitle(task)}`} className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40">
          <Icon name="stop" size={10} />
        </button>
      </Popconfirm>
    </div>
  );
}

export function BackgroundTasksPanel({ children, tasks = [], cancellingIds, onCancel }: { children: ReactNode; tasks?: BgTaskView[]; cancellingIds?: ReadonlySet<string>; onCancel?: (taskId: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const now = useNow(tasks.length > 0);
  const viewTask = viewId ? (tasks.find((task) => task.taskId === viewId) ?? null) : null;
  const listInnerRef = useRef<HTMLDivElement>(null);
  const [listH, setListH] = useState(0);

  useEffect(() => {
    if (tasks.length === 0) setOpen(false);
  }, [tasks.length]);

  useLayoutEffect(() => {
    const el = listInnerRef.current;
    if (!el) {
      setListH(0);
      return;
    }
    const update = () => setListH((h) => (h === el.offsetHeight ? h : el.offsetHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tasks.length]);

  const label = tasks.length === 1 ? "1 background task" : `${tasks.length} background tasks`;

  return (
    <>
      {tasks.length > 0 ? (
        <div className="mx-8 rounded-t-lg bg-muted-strong shadow-[inset_0_1px_0_0_var(--nonla-border),inset_1px_0_0_0_var(--nonla-border),inset_-1px_0_0_0_var(--nonla-border)] [.light:not(.dark)_&]:bg-background [.light_.nonla-ui:not(.dark)_&]:bg-background">
          <div className={cn("flex h-7.5 items-center gap-1 border-b px-1", open ? "border-border-secondary" : "border-transparent")}>
            <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-sm font-normal text-muted-foreground/90 transition-colors hover:text-foreground" aria-expanded={open} aria-label={label}>
              <Icon name="arrow-down" size={13} className={cn("shrink-0 transition-transform duration-200 ease-out", !open && "-rotate-90")} />
              <span className="truncate">{label}</span>
            </button>
          </div>
          <div className="overflow-hidden transition-[height] duration-200 ease-out" style={{ height: open ? listH : 0 }}>
            <div ref={listInnerRef} className="max-h-55 overflow-y-auto py-0.5">
              {tasks.map((task) => (
                <TaskRow
                  key={task.taskId}
                  task={task}
                  now={now}
                  cancelling={cancellingIds?.has(task.taskId) ?? false}
                  onCancel={() => {
                    void onCancel?.(task.taskId);
                  }}
                  onOpen={() => setViewId(task.taskId)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {children}
      <BgTaskModal taskId={viewId ?? ""} fallback={viewTask} open={Boolean(viewId)} onClose={() => setViewId(null)} />
    </>
  );
}
