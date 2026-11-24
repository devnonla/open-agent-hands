import { Tabs, message } from "devnonla-ui";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import type { AgentTool } from "src/common/types";
import { PageHeader } from "src/components/PageHeader";
import { TabCountSettings } from "src/components/TabCountSettings";
import { PageShell } from "src/components/PageShell";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { deleteToolFolder, fetchToolFolders } from "./common/toolFoldersSlice";
import type { ToolFolderWithTools } from "./common/toolFoldersSlice";
import { fetchTools } from "./common/toolsSlice";
import { FolderDialog } from "./components/FolderDialog";
import { ALL_TOOLS_KEY, ToolsTreeView, UNGROUPED_ID, sortFolders } from "./components/ToolsTreeView";

function TabLabel({ name, count, active, onSettings }: { name: string; count: number; active: boolean; onSettings?: () => void }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", active ? "text-foreground" : "text-muted-foreground")}>
      <span className="max-w-48 truncate">{name}</span>
      <TabCountSettings count={count} active={active} label={`Settings for ${name}`} onOpen={onSettings} />
    </span>
  );
}

export default function ToolsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const tools = useAppSelector((s) => s.tools.items) as AgentTool[];
  const folders = useAppSelector((s) => s.toolFolders.folders) as ToolFolderWithTools[];

  const [editingFolder, setEditingFolder] = useState<ToolFolderWithTools | null>(null);

  useEffect(() => {
    dispatch(fetchTools());
    dispatch(fetchToolFolders());
  }, [dispatch]);

  const customTools = useMemo(() => tools.filter((t) => !t.id.startsWith("builtin:")), [tools]);
  const [searchParams, setSearchParams] = useSearchParams();
  const sortedFolders = useMemo(() => sortFolders(folders), [folders]);
  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const countFor = (key: string) => (key === ALL_TOOLS_KEY ? customTools.length : key === UNGROUPED_ID ? customTools.filter((t) => !t.folderId || !folderIds.has(t.folderId)).length : customTools.filter((t) => t.folderId === key).length);
  const ungroupedCount = countFor(UNGROUPED_ID);
  const requested = searchParams.get("folder") ?? ALL_TOOLS_KEY;
  const activeKey = requested === ALL_TOOLS_KEY || (requested === UNGROUPED_ID && ungroupedCount > 0) || folderIds.has(requested) ? requested : ALL_TOOLS_KEY;
  const selectTab = (key: string) => setSearchParams(key === ALL_TOOLS_KEY ? {} : { folder: key }, { replace: true });
  const tabItems = [
    { key: ALL_TOOLS_KEY, label: <TabLabel name="All" count={countFor(ALL_TOOLS_KEY)} active={activeKey === ALL_TOOLS_KEY} /> },
    ...sortedFolders.map((folder) => ({ key: folder.id, label: <TabLabel name={folder.name} count={countFor(folder.id)} active={activeKey === folder.id} onSettings={() => setEditingFolder(folder)} /> })),
    ...(ungroupedCount > 0 ? [{ key: UNGROUPED_ID, label: <TabLabel name="Ungrouped" count={ungroupedCount} active={activeKey === UNGROUPED_ID} /> }] : []),
  ];

  const handleDeleteFolder = async (folderId: string) => {
    try {
      await dispatch(deleteToolFolder(folderId)).unwrap();
      message.success("Folder deleted");
      if (activeKey === folderId) selectTab(ALL_TOOLS_KEY);
      await dispatch(fetchTools());
    } catch {
      message.error("Failed to delete folder");
    }
  };

  return (
    <>
      <PageShell
        header={
          <PageHeader
            title="Tools"
            icon="tools"
            className="mb-0 pb-0"
            bordered={false}
          />
        }
        tabs={customTools.length > 0 || folders.length > 0 ? <Tabs aria-label="Tool folders" className="min-w-0" activeKey={activeKey} onChange={selectTab} items={tabItems} /> : undefined}
      >
        <ToolsTreeView tools={customTools} folders={folders} onToolClick={(id) => navigate(`/tools/${id}`)} onEditFolder={setEditingFolder} activeKey={activeKey} />
      </PageShell>

      <FolderDialog open={!!editingFolder} onClose={() => setEditingFolder(null)} folder={editingFolder} onDelete={(folder) => void handleDeleteFolder(folder.id)} />
    </>
  );
}
