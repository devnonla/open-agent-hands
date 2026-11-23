import { Segmented, Tabs, Tooltip, message } from "devnonla-ui";
import { LayoutGrid, List, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import type { AgentTool } from "src/common/types";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { deleteToolFolder, fetchToolFolders } from "./common/toolFoldersSlice";
import type { ToolFolderWithTools } from "./common/toolFoldersSlice";
import { fetchTools } from "./common/toolsSlice";
import { FolderDialog } from "./components/FolderDialog";
import { ALL_TOOLS_KEY, type ToolsViewMode, ToolsTreeView, UNGROUPED_ID, sortFolders } from "./components/ToolsTreeView";

const VIEW_KEY = "agenthands_tools_view";

function readView(): ToolsViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

function TabLabel({ name, count, active, onSettings }: { name: string; count: number; active: boolean; onSettings?: () => void }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", active ? "text-foreground" : "text-muted-foreground")}>
      <span className="max-w-48 truncate">{name}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      {onSettings && active ? (
        <Tooltip title="Folder settings">
          <span
            role="button"
            tabIndex={0}
            aria-label={`Settings for ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              onSettings();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              onSettings();
            }}
            className="-mr-1 inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-ink-hover hover:text-foreground"
          >
            <Settings size={13} />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

export default function ToolsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const tools = useAppSelector((s) => s.tools.items) as AgentTool[];
  const folders = useAppSelector((s) => s.toolFolders.folders) as ToolFolderWithTools[];

  const [editingFolder, setEditingFolder] = useState<ToolFolderWithTools | null>(null);
  const [view, setView] = useState<ToolsViewMode>(readView);

  useEffect(() => {
    dispatch(fetchTools());
    dispatch(fetchToolFolders());
  }, [dispatch]);

  const customTools = useMemo(() => tools.filter((t) => !t.id.startsWith("builtin:")), [tools]);
  const [searchParams, setSearchParams] = useSearchParams();
  const sortedFolders = useMemo(() => sortFolders(folders), [folders]);
  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const countFor = (key: string) => (key === ALL_TOOLS_KEY ? customTools.length : key === UNGROUPED_ID ? customTools.filter((t) => !t.folderId || !folderIds.has(t.folderId)).length : customTools.filter((t) => t.folderId === key).length);
  const requested = searchParams.get("folder") ?? ALL_TOOLS_KEY;
  const activeKey = requested === ALL_TOOLS_KEY || requested === UNGROUPED_ID || folderIds.has(requested) ? requested : ALL_TOOLS_KEY;
  const selectTab = (key: string) => setSearchParams(key === ALL_TOOLS_KEY ? {} : { folder: key }, { replace: true });
  const tabItems = [
    { key: ALL_TOOLS_KEY, label: <TabLabel name="All" count={countFor(ALL_TOOLS_KEY)} active={activeKey === ALL_TOOLS_KEY} /> },
    ...sortedFolders.map((folder) => ({ key: folder.id, label: <TabLabel name={folder.name} count={countFor(folder.id)} active={activeKey === folder.id} onSettings={() => setEditingFolder(folder)} /> })),
    { key: UNGROUPED_ID, label: <TabLabel name="Ungrouped" count={countFor(UNGROUPED_ID)} active={activeKey === UNGROUPED_ID} /> },
  ];

  const changeView = (next: ToolsViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

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
            actions={
              <Segmented
                value={view}
                onChange={(v) => changeView(v as ToolsViewMode)}
                options={[
                  {
                    value: "card",
                    label: (
                      <span className="flex items-center gap-1.5">
                        <LayoutGrid size={14} />
                        Card
                      </span>
                    ),
                  },
                  {
                    value: "list",
                    label: (
                      <span className="flex items-center gap-1.5">
                        <List size={14} />
                        List
                      </span>
                    ),
                  },
                ]}
              />
            }
          />
        }
        tabs={<Tabs aria-label="Tool folders" className="min-w-0" activeKey={activeKey} onChange={selectTab} items={tabItems} />}
      >
        <ToolsTreeView view={view} tools={customTools} folders={folders} onToolClick={(id) => navigate(`/tools/${id}`)} onEditFolder={setEditingFolder} activeKey={activeKey} />
      </PageShell>

      <FolderDialog open={!!editingFolder} onClose={() => setEditingFolder(null)} folder={editingFolder} onDelete={(folder) => void handleDeleteFolder(folder.id)} />
    </>
  );
}
