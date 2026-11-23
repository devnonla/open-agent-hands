import { Empty, MenuItem, SearchInput, Skeleton, Switch, message, Icon } from "devnonla-ui";
import { Folder } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import type { AgentTool, MyMcpServer, MyMcpServerTool } from "src/common/types";
import RenderIf from "src/components/RenderIf";
import { TreeBranch } from "src/components/TreeBranch";
import { fetchToolFolders, type ToolFolderWithTools } from "src/modules/tools/common/toolFoldersSlice";
import { fetchTools } from "src/modules/tools/common/toolsSlice";
import { ToolIcon } from "src/modules/tools/components/ToolIcon";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { toMyMcpServerListItem, updateMyMcpServer, upsertMyMcpServerLocal } from "../common/myMcpServersSlice";

type Group = { id: string; name: string | null; tools: AgentTool[] };

function isCustomTool(tool: AgentTool) {
  return !tool.id.startsWith("builtin:") && !tool.id.startsWith("mcp:");
}

function bySortOrder(a: AgentTool, b: AgentTool) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.label || a.name).localeCompare(b.label || b.name);
}

export function McpServerToolTree({ server }: { server: MyMcpServer }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const allTools = useAppSelector((s) => s.tools.items) as AgentTool[];
  const folders = useAppSelector((s) => s.toolFolders.folders) as ToolFolderWithTools[];
  const [loading, setLoading] = useState(allTools.length === 0);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);

  useEffect(() => {
    void Promise.all([dispatch(fetchTools()), dispatch(fetchToolFolders())]).finally(() => setLoading(false));
  }, [dispatch]);

  const assigned = useMemo(() => new Set((server.tools ?? []).map((tool) => tool.id)), [server.tools]);
  const tools = useMemo(() => allTools.filter(isCustomTool), [allTools]);
  const folderName = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.name])), [folders]);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (tool: AgentTool) => !q || tool.name.toLowerCase().includes(q) || tool.label.toLowerCase().includes(q);
    const sortedFolders = [...folders].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const result: Group[] = sortedFolders.map((folder) => ({ id: folder.id, name: folder.name, tools: tools.filter((tool) => tool.folderId === folder.id && (matches(tool) || folder.name.toLowerCase().includes(q))).sort(bySortOrder) }));
    const known = new Set(folders.map((folder) => folder.id));
    result.push({ id: "ungrouped", name: null, tools: tools.filter((tool) => (!tool.folderId || !known.has(tool.folderId)) && matches(tool)).sort(bySortOrder) });
    return result.filter((group) => group.tools.length > 0);
  }, [folders, tools, query]);

  const save = (nextIds: Set<string>) => {
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    const nextTools: MyMcpServerTool[] = [...nextIds].flatMap((id) => {
      const tool = byId.get(id);
      const existing = server.tools?.find((t) => t.id === id);
      if (existing) return [existing];
      if (!tool) return [];
      return [{ id: tool.id, name: tool.name, label: tool.label, description: tool.description, folderName: tool.folderId ? (folderName.get(tool.folderId) ?? null) : null, icon: tool.icon ?? null }];
    });
    const previous = server;
    dispatch(upsertMyMcpServerLocal({ ...server, tools: nextTools, toolCount: nextTools.length }));
    inFlight.current += 1;
    queue.current = queue.current
      .then(() => dispatch(updateMyMcpServer({ id: server.id, toolIds: [...nextIds] })).unwrap())
      .then((updated: MyMcpServer) => {
        if (inFlight.current === 1) dispatch(upsertMyMcpServerLocal(toMyMcpServerListItem(updated)));
      })
      .catch((err: unknown) => {
        dispatch(upsertMyMcpServerLocal(previous));
        message.error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        inFlight.current -= 1;
      });
  };

  const setTools = (ids: string[], on: boolean) => {
    const next = new Set(assigned);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    save(next);
  };

  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toolRow = (tool: AgentTool) => (
    <div key={tool.id} className="flex items-center gap-2">
      <MenuItem className="min-w-0 flex-1" onClick={() => navigate(`/tools/${tool.id}`)} icon={<ToolIcon icon={tool.icon} size={16} />} label={<span className={cn(!assigned.has(tool.id) && "text-muted-foreground")}>{tool.label || tool.name}</span>} />
      <Switch size="small" checked={assigned.has(tool.id)} onChange={(checked) => setTools([tool.id], checked)} aria-label={`${assigned.has(tool.id) ? "Remove" : "Add"} ${tool.label || tool.name}`} />
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton.Input active />
        <Skeleton.Input active />
        <Skeleton.Input active />
      </div>
    );
  }

  if (tools.length === 0) return <Empty className="py-8" description="No tools yet. Ask your agent to create one with create_tool." />;

  return (
    <div className="flex flex-col gap-2 px-2 pt-3 pb-2">
      <RenderIf condition={tools.length > 8}>
        <div className="px-2 pb-1">
          <SearchInput size="small" placeholder="Find a tool" onChange={setQuery} wait={120} />
        </div>
      </RenderIf>
      <RenderIf condition={groups.length > 0} fallback={<Empty className="py-6" description={`No tool matches "${query}".`} />}>
        <div className="flex flex-col gap-0.5 pr-2">
          {groups.map((group) => {
            if (group.name === null) return group.tools.map(toolRow);
            const ids = group.tools.map((tool) => tool.id);
            const onCount = ids.filter((id) => assigned.has(id)).length;
            const open = query.trim() !== "" || !collapsed.has(group.id);
            return (
              <div key={group.id} className="flex flex-col">
                <div className="flex items-center gap-2">
                  <MenuItem
                    className="min-w-0 flex-1"
                    onClick={() => toggleCollapsed(group.id)}
                    icon={<Icon name="arrow-right" size={14} className={cn("text-tertiary-foreground transition-transform duration-150", open && "rotate-90")} />}
                    label={
                      <span className="flex min-w-0 items-center gap-2">
                        <Folder size={15} className="shrink-0 text-muted-foreground" />
                        <span className="truncate">{group.name}</span>
                      </span>
                    }
                    extra={`${onCount}/${ids.length}`}
                  />
                  <Switch size="small" checked={onCount === ids.length} onChange={(checked) => setTools(ids, checked)} aria-label={`${onCount === ids.length ? "Remove" : "Add"} every tool in ${group.name}`} />
                </div>
                <RenderIf condition={open}>
                  <TreeBranch lineX={17} elbowY={16} indent={30}>
                    {group.tools.map(toolRow)}
                  </TreeBranch>
                </RenderIf>
              </div>
            );
          })}
        </div>
      </RenderIf>
    </div>
  );
}
