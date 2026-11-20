// Route: /tools — custom tools, organized like folders.

import { Button, message } from "devnonla-ui";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentTool } from "src/common/types";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { deleteToolFolder, fetchToolFolders } from "./common/toolFoldersSlice";
import type { ToolFolderWithTools } from "./common/toolFoldersSlice";
import { fetchTools } from "./common/toolsSlice";
import { FolderDialog } from "./components/FolderDialog";
import { ToolsTreeView } from "./components/ToolsTreeView";

export default function ToolsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const tools = useAppSelector((s) => s.tools.items) as AgentTool[];
  const folders = useAppSelector((s) => s.toolFolders.folders) as ToolFolderWithTools[];

  const [editingFolder, setEditingFolder] = useState<ToolFolderWithTools | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [_newOpen, _setNewOpen] = useState(false);

  useEffect(() => {
    dispatch(fetchTools());
    dispatch(fetchToolFolders());
  }, [dispatch]);

  const customTools = useMemo(() => tools.filter((t) => !t.id.startsWith("builtin:")), [tools]);

  const handleToolClick = (toolId: string) => {
    navigate(`/tools/${toolId}`);
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      await dispatch(deleteToolFolder(folderId)).unwrap();
      message.success("Folder deleted");
      await dispatch(fetchTools());
    } catch {
      message.error("Failed to delete folder");
    }
  };

  return (
    <>
      <PageShell>
        <PageHeader
          title="Tools"
          icon="tools"
          actions={
            <Button icon={<Plus size={16} />} onClick={() => setCreatingFolder(true)}>
              New folder
            </Button>
          }
        />

        <ToolsTreeView tools={customTools} folders={folders} onToolClick={handleToolClick} onEditFolder={setEditingFolder} onDeleteFolder={handleDeleteFolder} onCreateFolder={() => setCreatingFolder(true)} />
      </PageShell>

      <FolderDialog
        open={!!editingFolder || creatingFolder}
        onClose={() => {
          setEditingFolder(null);
          setCreatingFolder(false);
        }}
        folder={editingFolder}
      />
    </>
  );
}
