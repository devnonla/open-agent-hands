import { Icon, Shimmer, Spin } from "devnonla-ui";
import { ChatToolCall, type ToolUIProps, ToolUiTrailing, formatToolName } from "devnonla-ui/chat";
import type { ComponentType } from "react";
import { useState } from "react";
import { cn } from "src/common/lib/cn";
import { formatDuration, latestLine, parseBgTaskRef, statusLabel, taskTitle, timeMs } from "../../common/bgTaskUtils";
import { useBgTask, useNow } from "../../hooks/useBgTask";
import { BgTaskModal } from "../BgTaskModal";

export function DetachedTaskToolUI({ msg }: ToolUIProps) {
  const ref = parseBgTaskRef(msg.toolOutput);
  const task = useBgTask(ref?.taskId);
  const [open, setOpen] = useState(false);
  const running = !task || task.status === "running";
  const failed = task?.status === "failed";
  const now = useNow(running);
  const startedAt = task?.startedAt || timeMs(msg.timestamp);
  const fallbackName = ref?.toolName ?? msg.toolLabel ?? msg.toolName ?? "Tool";
  const title = task?.toolName ? taskTitle(task) : formatToolName(fallbackName);
  const elapsed = formatDuration((running ? now : (task?.finishedAt ?? now)) - startedAt);
  const aside = running ? `in background · ${elapsed}` : task?.status === "expired" ? statusLabel(task.status).toLowerCase() : `${statusLabel(task?.status).toLowerCase()} in ${elapsed}`;
  const live = running ? latestLine(task) : null;

  return (
    <div className="nonla-chat-tool mt-1">
      <div className="px-4">
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="group flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-1 text-left text-sm leading-5.5 outline-none">
          {running ? <Spin variant="agent" size="small" className="shrink-0" /> : <Icon name={failed ? "error" : "check"} size={13} className={cn("shrink-0", failed ? "text-destructive" : "text-muted-foreground")} />}
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Shimmer active={running} className={cn("min-w-0 truncate font-normal", !running && "text-muted-foreground")}>
              {title}
            </Shimmer>
            <span className="shrink-0 tabular-nums text-tertiary-foreground">{aside}</span>
            <ToolUiTrailing failed={failed} chevron chevronClassName="text-muted-foreground group-hover:opacity-100" />
          </span>
        </button>
        {live ? <div className="truncate pb-1 pl-5.5 text-xs text-muted-foreground">{live}</div> : null}
      </div>
      <BgTaskModal taskId={ref?.taskId ?? ""} fallback={task} open={open && Boolean(ref)} onClose={() => setOpen(false)} />
    </div>
  );
}

export function GenericToolUI({ msg, generating = false }: ToolUIProps) {
  if (parseBgTaskRef(msg.toolOutput)) return <DetachedTaskToolUI msg={msg} />;
  const pending = msg.toolOutput == null && !msg.toolError;
  return <ChatToolCall toolName={msg.toolName} label={msg.toolLabel} toolInput={msg.toolInput} toolOutput={msg.toolOutput} toolError={msg.toolError} running={pending && generating} />;
}

export function withDetachedTask(Inner: ComponentType<ToolUIProps>): ComponentType<ToolUIProps> {
  return function DetachedAware(props: ToolUIProps) {
    if (parseBgTaskRef(props.msg.toolOutput)) return <DetachedTaskToolUI {...props} />;
    return <Inner {...props} />;
  };
}
