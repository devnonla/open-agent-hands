import { Dropdown, message } from "devnonla-ui";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { type Workspace, listWorkspaces } from "../common/workspacesApi";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { useCurrentWorkspace } from "../common/currentWorkspace";
import { useWorkspaceNavigation } from "../common/useWorkspaceNavigation";

export function WorkspaceSwitcher() {
  const workspace = useCurrentWorkspace();
  const { enterWorkspace } = useWorkspaceNavigation();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<Workspace[]>([]);

  useEffect(() => {
    if (!open) return;
    listWorkspaces()
      .then(setItems)
      .catch(() => {});
  }, [open]);

  if (!workspace) return null;

  const menuItems = [
    ...(items.length ? items : [workspace]).map((w) => ({
      key: w.id,
      label: (
        <span className="flex items-center justify-between gap-3">
          <span className="truncate">{w.name}</span>
          {w.id === workspace.id ? <Check size={14} className="shrink-0 text-primary" /> : null}
        </span>
      ),
    })),
    { type: "divider" as const },
    {
      key: "__create",
      label: (
        <span className="flex items-center gap-2">
          <Plus size={14} />
          Create workspace
        </span>
      ),
    },
  ];

  const onSelect = ({ key }: { key: string }) => {
    setOpen(false);
    if (key === "__create") setCreating(true);
    else if (key !== workspace.id) enterWorkspace(key, window.location.pathname.split("/").slice(0, 2).join("/") || "/tools");
  };

  return (
    <>
      <Dropdown trigger={["click"]} placement="bottomLeft" open={open} onOpenChange={setOpen} menu={{ items: menuItems, onClick: onSelect, style: { minWidth: 220 } }}>
        <button type="button" title="Switch workspace" className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-ink-hover">
          <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-semibold text-primary">{workspace.name.slice(0, 1).toUpperCase()}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Workspace</span>
            <span className="truncate text-[13px] font-medium text-foreground">{workspace.name}</span>
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </Dropdown>
      <WorkspaceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(saved) => {
          setCreating(false);
          message.success("Workspace created");
          enterWorkspace(saved.id, window.location.pathname.split("/").slice(0, 2).join("/") || "/tools");
        }}
      />
    </>
  );
}
