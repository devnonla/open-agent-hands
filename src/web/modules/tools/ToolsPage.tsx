// Route: /tools — custom tools, organized like folders.

import { Button, Dropdown, Icon, Tabs, message } from "devnonla-ui";
import type { MenuProps } from "devnonla-ui";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { AgentTool } from "src/common/types";
import { MissingProviderCallout } from "src/components/MissingProviderCallout";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { useAppDispatch, useAppSelector } from "src/store/store";
import McpToolsPanel from "./McpToolsPage";
import { deleteToolFolder, fetchToolFolders } from "./common/toolFoldersSlice";
import type { ToolFolderWithTools } from "./common/toolFoldersSlice";
import { fetchTools } from "./common/toolsSlice";
import { AddToolDialog } from "./components/AddToolDialog";
import { BuiltinToolsTree } from "./components/BuiltinToolsTree";
import { FolderDialog } from "./components/FolderDialog";
import { ToolsTreeView } from "./components/ToolsTreeView";

export default function ToolsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tools = useAppSelector((s) => s.tools.items) as AgentTool[];
  const folders = useAppSelector((s) => s.toolFolders.folders) as ToolFolderWithTools[];

  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = pathname === "/tools/mcp" ? "mcp" : tabParam === "builtin" ? "builtin" : "custom";

  const selectTab = (key: string) => {
    if (key === "mcp") {
      navigate("/tools/mcp");
      return;
    }
    if (key === "builtin") {
      navigate("/tools?tab=builtin");
      return;
    }
    navigate("/tools");
  };
  const [editingFolder, setEditingFolder] = useState<ToolFolderWithTools | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [addToolOpen, setAddToolOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    dispatch(fetchTools());
    dispatch(fetchToolFolders());
  }, [dispatch]);

  const builtinTools = useMemo(() => tools.filter((t) => t.id.startsWith("builtin:")).sort((a, b) => a.label.localeCompare(b.label)), [tools]);
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

  const newItems: MenuProps["items"] = [
    {
      key: "folder",
      label: (
        <div className="flex items-center gap-2">
          <Icon name="code" size={15} />
          New folder
        </div>
      ),
      onClick: () => setCreatingFolder(true),
    },
    {
      key: "tool",
      label: (
        <div className="flex items-center gap-2">
          <Icon name="code" size={15} />
          New tool
        </div>
      ),
      onClick: () => setAddToolOpen(true),
    },
  ];

  return (
    <>
      <PageShell>
        <MissingProviderCallout />
        <PageHeader
          title="Tools"
          icon="tools"
          actions={
            activeTab === "custom" ? (
              <Dropdown trigger={["click"]} placement="bottomRight" open={newOpen} onOpenChange={setNewOpen} menu={{ items: newItems, style: { minWidth: 200 } }}>
                <Button type="primary" icon={<Plus size={16} />}>
                  New
                </Button>
              </Dropdown>
            ) : null
          }
        />

        <Tabs
          aria-label="Tool groups"
          activeKey={activeTab}
          onChange={selectTab}
          items={[
            {
              key: "custom",
              label: "Custom Tools",
              children: <ToolsTreeView tools={customTools} folders={folders} showCustomTools showMcpServers={false} onToolClick={handleToolClick} onToolCreated={handleToolClick} onEditFolder={setEditingFolder} onDeleteFolder={handleDeleteFolder} onCreateFolder={() => setCreatingFolder(true)} />,
            },
            {
              key: "builtin",
              label: "Builtin Tools",
              children: <BuiltinToolsTree tools={builtinTools} />,
            },
            {
              key: "mcp",
              label: "Remote MCP Servers",
              children: <McpToolsPanel />,
            },
          ]}
        />
      </PageShell>

      <AddToolDialog open={addToolOpen} onOpenChange={setAddToolOpen} onCreated={handleToolClick} />

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
