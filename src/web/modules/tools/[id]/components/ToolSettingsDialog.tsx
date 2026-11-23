import { Button, Icon, Modal, Select, message } from "devnonla-ui";
import { useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import type { AgentTool } from "src/common/types";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fetchToolFolders } from "../../common/toolFoldersSlice";
import type { ToolFolderWithTools } from "../../common/toolFoldersSlice";
import { upsertToolLocal } from "../../common/toolsSlice";

const UNGROUPED = "__ungrouped__";

export function ToolSettingsDialog({ open, tool, deleting, onClose, onDelete }: { open: boolean; tool: AgentTool; deleting: boolean; onClose: () => void; onDelete: () => void }) {
  const dispatch = useAppDispatch();
  const folders = useAppSelector((s) => s.toolFolders.folders) as ToolFolderWithTools[];
  const [folderId, setFolderId] = useState<string>(tool.folderId ?? UNGROUPED);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFolderId(tool.folderId ?? UNGROUPED);
    void dispatch(fetchToolFolders());
  }, [open, tool.folderId, dispatch]);

  const dirty = folderId !== (tool.folderId ?? UNGROUPED);

  const save = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const updated = await apiClient.put<AgentTool>(`/api/tools/${tool.id}`, { folderId: folderId === UNGROUPED ? null : folderId });
      dispatch(upsertToolLocal({ ...tool, ...updated }));
      message.success("Tool moved");
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to move the tool");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Modal.confirm({
      title: `Delete "${tool.label || tool.name}"?`,
      content: "MCP servers stop exposing it. This cannot be undone.",
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: onDelete,
    });
  };

  return (
    <Modal open={open} title="Tool settings" onCancel={onClose} onOk={() => void save()} okText="Save" confirmLoading={saving} destroyOnHidden width={480}>
      <div className="flex flex-col gap-5 pt-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Folder</span>
          <Select value={folderId} onChange={(value: string) => setFolderId(value)} options={[{ value: UNGROUPED, label: "Ungrouped" }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} className="w-full" />
          <span className="text-xs text-muted-foreground">Name, description and parameters come from the tool's code header.</span>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/30 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Delete this tool</div>
            <div className="text-xs text-muted-foreground">MCP servers stop exposing it. This cannot be undone.</div>
          </div>
          <Button danger size="small" loading={deleting} icon={<Icon name="trash" size={14} />} onClick={confirmDelete}>
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
