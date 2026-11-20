import { Button, Modal, Tag, Tooltip, message } from "devnonla-ui";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import meadowWallpaper from "src/assets/bg.jpg";
import { enterWorkspace, getCurrentWorkspaceId } from "src/common/workspace";
import { AppMark } from "src/components/AppLogo";
import { type Workspace, deleteWorkspace, listWorkspaces } from "./common/workspacesApi";
import { WorkspaceDialog } from "./components/WorkspaceDialog";

export default function WorkspacesPage() {
  const [items, setItems] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Workspace | null>(null);
  const currentId = getCurrentWorkspaceId();

  useEffect(() => {
    listWorkspaces()
      .then(setItems)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load workspaces"));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (workspace: Workspace) => {
    setEditing(workspace);
    setDialogOpen(true);
  };

  const onSaved = (saved: Workspace) => {
    setItems((prev) => {
      const list = prev ?? [];
      return list.some((w) => w.id === saved.id) ? list.map((w) => (w.id === saved.id ? saved : w)) : [...list, saved];
    });
    message.success(editing ? "Workspace updated" : "Workspace created");
  };

  const confirmDelete = (workspace: Workspace) => {
    Modal.confirm({
      title: `Delete "${workspace.name}"?`,
      content: "All tools, MCP servers, sites, jobs, datatables, KV entries, secrets and API keys in this workspace will be deleted. This cannot be undone.",
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await deleteWorkspace(workspace.id);
          setItems((prev) => (prev ?? []).filter((w) => w.id !== workspace.id));
          message.success("Workspace deleted");
        } catch (err) {
          message.error(err instanceof Error ? err.message : "Failed to delete workspace");
        }
      },
    });
  };

  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-background">
      <img src={meadowWallpaper} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full select-none object-cover object-center" />
      <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto p-6">
        <div className="relative w-full max-w-md animate-fadeIn overflow-hidden rounded-md border border-border bg-card shadow-(--elevated-shadow)">
          <div className="flex h-8 items-center gap-2 border-b border-border/35 bg-background px-3">
            <AppMark size={16} />
            <span className="text-[13px] font-semibold text-foreground">Workspaces</span>
          </div>
          <div className="p-6">
            <div className="flex items-start justify-between gap-4 pb-5">
              <div className="flex flex-col gap-1.5">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">Choose a workspace</h2>
                <p className="text-sm text-muted-foreground">Tools, sites, data and keys live inside a workspace.</p>
              </div>
              <Button type="primary" size="medium" icon={<Plus size={16} />} onClick={openCreate}>
                New
              </Button>
            </div>

            {error ? (
              <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
                <p className="text-xs font-medium text-destructive">{error}</p>
              </div>
            ) : null}

            {items === null && !error ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : null}

            {items && items.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {items.map((workspace) => (
                  <li key={workspace.id} className="group flex items-center gap-2 rounded-md border border-border bg-background transition-colors hover:border-primary/40">
                    <button type="button" onClick={() => enterWorkspace(workspace.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-2.5 text-left">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">{workspace.name.slice(0, 1).toUpperCase()}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{workspace.name}</span>
                          {workspace.isDefault ? <Tag className="m-0! shrink-0 rounded-md text-[10px] leading-none">Default</Tag> : null}
                          {workspace.id === currentId ? (
                            <Tag color="success" className="m-0! shrink-0 rounded-md text-[10px] leading-none">
                              Current
                            </Tag>
                          ) : null}
                        </span>
                        {workspace.description ? <span className="truncate text-xs text-muted-foreground">{workspace.description}</span> : null}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5 pr-2">
                      <Tooltip title="Edit">
                        <Button type="text" size="small" icon={<Pencil size={14} />} aria-label={`Edit ${workspace.name}`} onClick={() => openEdit(workspace)} />
                      </Tooltip>
                      {workspace.isDefault ? null : (
                        <Tooltip title="Delete">
                          <Button type="text" size="small" danger icon={<Trash2 size={14} />} aria-label={`Delete ${workspace.name}`} onClick={() => confirmDelete(workspace)} />
                        </Tooltip>
                      )}
                      <ChevronRight size={16} className="text-muted-foreground" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
      <WorkspaceDialog open={dialogOpen} workspace={editing} onClose={() => setDialogOpen(false)} onSaved={onSaved} />
    </div>
  );
}
