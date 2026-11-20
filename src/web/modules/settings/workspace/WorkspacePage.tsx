import { Button, Input, Modal, message } from "devnonla-ui";
import { useEffect, useState } from "react";
import { SectionCard } from "src/components/SectionCard";
import { useCurrentWorkspace, useSetCurrentWorkspace } from "src/modules/workspaces/common/currentWorkspace";
import { useWorkspaceNavigation } from "src/modules/workspaces/common/useWorkspaceNavigation";
import { deleteWorkspace, listWorkspaces, updateWorkspace } from "src/modules/workspaces/common/workspacesApi";

export function WorkspacePage() {
  const workspace = useCurrentWorkspace();
  const setWorkspace = useSetCurrentWorkspace();
  const { enterWorkspace } = useWorkspaceNavigation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(workspace?.name ?? "");
    setDescription(workspace?.description ?? "");
  }, [workspace]);

  if (!workspace) return null;

  const dirty = name.trim() !== workspace.name || (description.trim() || null) !== workspace.description;

  const save = async () => {
    if (!name.trim()) {
      message.error("Please enter a workspace name");
      return;
    }
    setSaving(true);
    try {
      setWorkspace(await updateWorkspace(workspace.id, { name: name.trim(), description: description.trim() || null }));
      message.success("Workspace saved");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save workspace");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Modal.confirm({
      title: `Delete "${workspace.name}"?`,
      content: "All tools, MCP servers, sites, jobs, datatables, KV entries, secrets and API keys in this workspace will be deleted. This cannot be undone.",
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await deleteWorkspace(workspace.id);
          const fallback = (await listWorkspaces()).find((w) => w.isDefault);
          if (fallback) enterWorkspace(fallback.id);
          message.success("Workspace deleted");
        } catch (err) {
          message.error(err instanceof Error ? err.message : "Failed to delete workspace");
        }
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Workspace" description="Name and describe this workspace.">
        <div className="flex max-w-xl flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="workspace-name" className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="workspace-description" className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <Input id="workspace-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this workspace for?" autoComplete="off" />
          </div>
          <div className="flex items-center gap-2">
            <Button type="primary" onClick={save} loading={saving} disabled={!dirty}>
              Save
            </Button>
            {workspace.isDefault ? null : (
              <Button danger onClick={confirmDelete}>
                Delete
              </Button>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
