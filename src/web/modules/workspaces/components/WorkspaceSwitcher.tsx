import { ChevronsUpDown } from "lucide-react";
import { leaveWorkspace } from "src/common/workspace";
import { useCurrentWorkspace } from "../common/currentWorkspace";

export function WorkspaceSwitcher() {
  const workspace = useCurrentWorkspace();
  if (!workspace) return null;
  return (
    <button type="button" onClick={leaveWorkspace} title="Switch workspace" className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-ink-hover">
      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-semibold text-primary">{workspace.name.slice(0, 1).toUpperCase()}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Workspace</span>
        <span className="truncate text-[13px] font-medium text-foreground">{workspace.name}</span>
      </span>
      <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
    </button>
  );
}
