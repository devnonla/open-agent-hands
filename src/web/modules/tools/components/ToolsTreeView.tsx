import { type CollisionDetection, DndContext, type DragEndEvent, type DragOverEvent, DragOverlay, type DragStartEvent, PointerSensor, type UniqueIdentifier, closestCorners, getFirstCollision, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Card, Empty, OverlayScroll, Popover, Tag, Text, Tooltip, message, Icon } from "devnonla-ui";
import { Folder, Hash, List, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "src/common/lib/cn";
import type { AgentTool } from "src/common/types";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import RenderIf from "src/components/RenderIf";
import { TreeBranch } from "src/components/TreeBranch";
import { useAppDispatch } from "src/store/store";
import type { ToolFolderWithTools } from "../common/toolFoldersSlice";
import { ToolIcon } from "./ToolIcon";
import { fetchTools, reorderTools, reorderToolsLocal } from "../common/toolsSlice";

export const UNGROUPED_ID = "ungrouped";
export const ALL_TOOLS_KEY = "all";

export type ToolsViewMode = "card" | "list";

interface ToolsTreeViewProps {
  view?: ToolsViewMode;
  tools: AgentTool[];
  folders: ToolFolderWithTools[];
  onToolClick?: (toolId: string) => void;
  onEditFolder?: (folder: ToolFolderWithTools) => void;
  activeKey?: string;
}

type Items = Record<string, string[]>;

type FolderMeta = {
  key: string;
  title: string;
  folderId: string | null;
  folder?: ToolFolderWithTools;
  editable: boolean;
};

export function sortFolders(folders: ToolFolderWithTools[]) {
  return [...folders].sort((a, b) => {
    const byOrder = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (byOrder !== 0) return byOrder;
    return a.name.localeCompare(b.name);
  });
}

function buildItems(tools: AgentTool[], folders: ToolFolderWithTools[]): Items {
  const sortedFolders = sortFolders(folders);
  const folderIds = new Set(sortedFolders.map((f) => f.id));
  const byId = new Map(tools.map((t) => [t.id, t]));
  const bySortOrder = (ids: string[]) =>
    [...ids].sort((a, b) => {
      const byOrder = (byId.get(a)?.sortOrder ?? 0) - (byId.get(b)?.sortOrder ?? 0);
      if (byOrder !== 0) return byOrder;
      return (byId.get(a)?.label ?? "").localeCompare(byId.get(b)?.label ?? "");
    });

  const items: Items = { [UNGROUPED_ID]: [] };
  for (const folder of sortedFolders) {
    items[folder.id] = [];
  }

  for (const tool of tools) {
    if (tool.folderId && folderIds.has(tool.folderId)) {
      items[tool.folderId].push(tool.id);
    } else {
      items[UNGROUPED_ID].push(tool.id);
    }
  }

  for (const key of Object.keys(items)) {
    items[key] = bySortOrder(items[key]);
  }
  return items;
}

function buildFolderMetas(folders: ToolFolderWithTools[], items: Items, keepUngrouped = false): FolderMeta[] {
  const metas: FolderMeta[] = sortFolders(folders).map((folder) => ({
    key: folder.id,
    title: folder.name,
    folderId: folder.id,
    folder,
    editable: true,
  }));

  if (keepUngrouped || (items[UNGROUPED_ID]?.length ?? 0) > 0 || metas.length === 0) {
    metas.push({
      key: UNGROUPED_ID,
      title: "Ungrouped",
      folderId: null,
      editable: false,
    });
  }

  return metas;
}

function sameOrder(a: string[] = [], b: string[] = []) {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function containerToFolderId(containerId: string): string | null {
  return containerId === UNGROUPED_ID ? null : containerId;
}

function findContainerIn(items: Items, id: UniqueIdentifier): string | undefined {
  const sid = String(id);
  if (sid in items) return sid;
  return Object.keys(items).find((key) => items[key].includes(sid));
}

function FolderSettingsButton({ onOpen }: { onOpen?: () => void }) {
  return (
    <Tooltip title="Folder settings">
      <Button
        type="icon"
        size="small"
        aria-label="Folder settings"
        icon={<Settings size={15} />}
        className="opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.();
        }}
      />
    </Tooltip>
  );
}

type ParamSchema = { type?: string; description?: string; enum?: string[]; items?: { type?: string } };

function paramType(schema: ParamSchema): string {
  if (schema.enum?.length) return "one of";
  if (schema.type === "array") return `list of ${schema.items?.type ?? "any"}`;
  return schema.type ?? "any";
}

function ParamTypeIcon({ schema }: { schema: ParamSchema }) {
  const props = { size: 13, strokeWidth: 2 };
  const icon = schema.enum?.length ? <Icon name="select" size={13} /> : schema.type === "array" ? <List {...props} /> : schema.type === "number" || schema.type === "integer" ? <Hash {...props} /> : schema.type === "boolean" ? <Icon name="checkbox" size={13} /> : schema.type === "object" ? <Icon name="json" size={13} /> : <Icon name="text" size={13} />;
  return (
    <Tooltip title={paramType(schema)}>
      <span className="flex h-5 w-4 shrink-0 items-center justify-center text-tertiary-foreground">{icon}</span>
    </Tooltip>
  );
}

function ParamsList({ parameters }: { parameters: object }) {
  const schema = parameters as { properties?: Record<string, ParamSchema>; required?: string[] };
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(schema.properties ?? {}).sort(([a], [b]) => Number(required.has(b)) - Number(required.has(a)));
  return (
    <div className="flex w-[22rem] max-w-[calc(100vw-56px)] flex-col">
      <div className="border-b border-border pb-2 text-sm font-semibold text-foreground">Parameters</div>
      <OverlayScroll autoHeight className="-mr-3 max-h-[min(24rem,calc(var(--radix-popover-content-available-height,24rem)-72px))] w-[calc(100%+0.75rem)]" innerClassName="pr-3">
        <div className="flex flex-col">
          {entries.map(([name, p]) => (
            <div key={name} className="flex flex-col gap-1.5 border-b border-border/60 py-3 last:border-b-0 last:pb-0">
              <div className="flex items-start gap-2">
                <ParamTypeIcon schema={p} />
                <code className="min-w-0 flex-1 font-mono text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">
                  {name}
                  {required.has(name) ? <span className="ml-0.5 text-destructive">*</span> : null}
                </code>
              </div>
              {p.enum?.length ? (
                <div className="flex flex-wrap gap-1 pl-6">
                  {p.enum.map((v) => (
                    <Text key={v} code className="[overflow-wrap:anywhere]">
                      {v}
                    </Text>
                  ))}
                </div>
              ) : null}
              <p className={cn("m-0 line-clamp-4 pl-6 text-xs leading-relaxed [overflow-wrap:anywhere]", p.description ? "text-foreground" : "italic text-tertiary-foreground")}>{p.description || "No description"}</p>
            </div>
          ))}
        </div>
      </OverlayScroll>
    </div>
  );
}

function ParamCount({ tool, count }: { tool: AgentTool; count: number }) {
  if (count === 0) return <span>No params</span>;
  return (
    <Popover trigger="hover" placement="bottomLeft" mouseEnterDelay={0.15} content={<ParamsList parameters={tool.parameters} />}>
      <span className="-mx-1 rounded px-1 tabular-nums transition-colors hover:bg-muted hover:text-foreground">
        {count} param{count === 1 ? "" : "s"}
      </span>
    </Popover>
  );
}

function ToolCardView({
  tool,
  view = "card",
  onClick,
  className,
  style,
  innerRef,
  listeners,
  attributes,
  dragging,
}: {
  tool: AgentTool;
  view?: ToolsViewMode;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  innerRef?: (node: HTMLElement | null) => void;
  listeners?: React.HTMLAttributes<HTMLElement>;
  attributes?: React.HTMLAttributes<HTMLElement>;
  dragging?: boolean;
}) {
  const paramCount = Object.keys((tool.parameters as { properties?: Record<string, unknown> })?.properties ?? {}).length;
  const description = tool.description?.trim();

  if (view === "list") {
    return (
      <div ref={innerRef} style={style} className={cn("flex", className)}>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex w-full cursor-grab touch-none items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left transition-colors duration-150 active:cursor-grabbing",
            !dragging && "hover:bg-muted/70 focus-visible:bg-muted/70",
            dragging && "cursor-grabbing bg-card shadow-xl ring-1 ring-foreground/10",
          )}
          {...listeners}
          {...attributes}
        >
          <ToolIcon icon={tool.icon} size={18} />
          <Tooltip title={description || tool.label} mouseEnterDelay={0.5}>
            <span className="min-w-0 truncate text-sm leading-5 text-foreground">{tool.label}</span>
          </Tooltip>
        </button>
      </div>
    );
  }

  return (
    <div ref={innerRef} style={style} className={cn("flex", className)}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group/tool flex w-full cursor-grab touch-none items-start gap-4 rounded-xl border-0 bg-transparent px-2 pt-3 text-left transition-colors duration-150 active:cursor-grabbing",
          !dragging && "hover:bg-muted/70 focus-visible:bg-muted/70",
          dragging && "cursor-grabbing bg-card shadow-xl ring-1 ring-foreground/10",
        )}
        {...listeners}
        {...attributes}
      >
        <div className="flex size-7 shrink-0 items-center justify-center">
          <ToolIcon icon={tool.icon} size={28} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pb-3">
          <Tooltip title={tool.label} mouseEnterDelay={0.5}>
            <span className="truncate text-base font-medium text-foreground">{tool.label}</span>
          </Tooltip>
          <Tooltip title={description || undefined} mouseEnterDelay={0.5}>
            <span className={cn("line-clamp-2 text-sm leading-snug [overflow-wrap:anywhere]", description ? "text-tertiary-foreground" : "italic text-tertiary-foreground")}>{description || "No description"}</span>
          </Tooltip>
          <span className="mt-1 flex items-center text-xs text-tertiary-foreground">
            <ParamCount tool={tool} count={paramCount} />
          </span>
        </div>
      </button>
    </div>
  );
}

function SortableToolCard({ tool, view, onClick }: { tool: AgentTool; view: ToolsViewMode; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tool.id,
    data: { type: "tool", toolId: tool.id, folderId: tool.folderId ?? null },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return <ToolCardView tool={tool} view={view} onClick={isDragging ? undefined : onClick} innerRef={setNodeRef} listeners={listeners} attributes={attributes} style={style} className={cn(isDragging && "z-10 opacity-40")} />;
}

function FolderNode({
  meta,
  view,
  tools,
  onToolClick,
  onEditFolder,
  bare = false,
}: {
  meta: FolderMeta;
  view: ToolsViewMode;
  tools: AgentTool[];
  onToolClick: (toolId: string) => void;
  onEditFolder: (folder: ToolFolderWithTools) => void;
  bare?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: meta.key,
    data: { type: "folder", folderId: meta.folderId },
  });

  const toolIds = tools.map((t) => t.id);

  if (bare) {
    return (
      <div ref={setNodeRef}>
        <RenderIf condition={tools.length > 0} fallback={<Empty className="py-16" description={meta.folderId ? "No tools in this folder" : "No ungrouped tools"} />}>
          <SortableContext items={toolIds} strategy={rectSortingStrategy}>
            <div className={cn("-mx-2 grid grid-cols-1", view === "card" ? "gap-x-6 gap-y-1 md:grid-cols-2" : "gap-y-0.5")}>
              {tools.map((tool) => (
                <SortableToolCard key={tool.id} tool={tool} view={view} onClick={() => onToolClick(tool.id)} />
              ))}
            </div>
          </SortableContext>
        </RenderIf>
      </div>
    );
  }

  if (view === "list") {
    return (
      <div ref={setNodeRef} className={cn("flex flex-col rounded-lg transition-colors", isOver && "bg-muted/40")}>
        <div className="group/folder flex items-center gap-2 px-2 py-1.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Folder size={13} />
          </span>
          <Tooltip title={meta.title} mouseEnterDelay={0.5}>
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{meta.title}</span>
          </Tooltip>
          <span className="shrink-0 text-xs tabular-nums text-tertiary-foreground">{tools.length}</span>
          <div className="ml-auto">
            <RenderIf condition={meta.editable && !!meta.folder}>
              <FolderSettingsButton onOpen={() => meta.folder && onEditFolder(meta.folder)} />
            </RenderIf>
          </div>
        </div>
        <SortableContext items={toolIds} strategy={rectSortingStrategy}>
          <TreeBranch lineX={20} elbowY={18} indent={30} className="mt-1.5">
            {tools.length > 0
              ? tools.map((tool) => <SortableToolCard key={tool.id} tool={tool} view={view} onClick={() => onToolClick(tool.id)} />)
              : [
                  <div key="empty" className="px-2 py-1.5 text-xs italic leading-5 text-tertiary-foreground">
                    Drag tools here
                  </div>,
                ]}
          </TreeBranch>
        </SortableContext>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} className={cn("rounded-xl transition-shadow", isOver && "ring-2 ring-focus-ring")}>
      <Card>
        <Card.Item
          className="group/folder py-3"
          label={
            <>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Folder size={14} />
              </span>
              <Tooltip title={meta.title} mouseEnterDelay={0.5}>
                <span className="min-w-0 truncate text-md font-medium tracking-tight text-foreground">{meta.title}</span>
              </Tooltip>
              <Tag className="shrink-0 tabular-nums">{tools.length}</Tag>
            </>
          }
        >
          <RenderIf condition={meta.editable && !!meta.folder}>
            <FolderSettingsButton onOpen={() => meta.folder && onEditFolder(meta.folder)} />
          </RenderIf>
        </Card.Item>
        <Card.Item className="block p-2">
          <RenderIf condition={tools.length > 0} fallback={<Empty bordered={false} icon={null} description="Drag tools here" className="py-6" />}>
            <SortableContext items={toolIds} strategy={rectSortingStrategy}>
              <div className={cn("grid grid-cols-1", view === "card" ? "gap-x-6 gap-y-1 md:grid-cols-2" : "gap-y-0.5")}>
                {tools.map((tool) => (
                  <SortableToolCard key={tool.id} tool={tool} view={view} onClick={() => onToolClick(tool.id)} />
                ))}
              </div>
            </SortableContext>
          </RenderIf>
        </Card.Item>
      </Card>
    </div>
  );
}

export function ToolsTreeView({ view = "card", tools, folders, onToolClick = () => {}, onEditFolder = () => {}, activeKey = ALL_TOOLS_KEY }: ToolsTreeViewProps) {
  const dispatch = useAppDispatch();
  const [items, setItems] = useState<Items>(() => buildItems(tools, folders));
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const didDragRef = useRef(false);
  const isDraggingRef = useRef(false);
  const clonedItemsRef = useRef<Items | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const recentlyMovedToNewContainer = useRef(false);

  const toolsById = useMemo(() => {
    const map = new Map<string, AgentTool>();
    for (const tool of tools) map.set(tool.id, tool);
    return map;
  }, [tools]);

  useEffect(() => {
    if (isDraggingRef.current) return;
    setItems(buildItems(tools, folders));
  }, [tools, folders]);

  const folderMetas = useMemo(() => buildFolderMetas(folders, items, !!activeToolId), [folders, items, activeToolId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerIntersections = pointerWithin(args);
      const intersections = pointerIntersections.length > 0 ? pointerIntersections : rectIntersection(args);
      let overId = getFirstCollision(intersections, "id");

      if (overId != null) {
        if (overId === args.active.id) {
          lastOverId.current = overId;
          return [{ id: overId }];
        }

        if (String(overId) in items) {
          const containerItems = items[String(overId)];
          if (containerItems.length > 0) {
            overId = closestCorners({
              ...args,
              droppableContainers: args.droppableContainers.filter((c) => c.id !== overId && containerItems.includes(String(c.id))),
            })[0]?.id;
          }
        }

        lastOverId.current = overId;
        return [{ id: overId }];
      }

      if (recentlyMovedToNewContainer.current) {
        lastOverId.current = args.active.id;
      }
      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [items],
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    didDragRef.current = true;
    isDraggingRef.current = true;
    recentlyMovedToNewContainer.current = false;
    clonedItemsRef.current = items;
    setActiveToolId(String(active.id));
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || recentlyMovedToNewContainer.current) return;

    const overId = String(over.id);
    const activeId = String(active.id);

    setItems((prev) => {
      const activeContainer = findContainerIn(prev, activeId);
      const overContainer = findContainerIn(prev, overId);
      if (!activeContainer || !overContainer || activeContainer === overContainer) return prev;

      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const activeIndex = activeItems.indexOf(activeId);
      if (activeIndex < 0) return prev;

      let newIndex: number;
      if (overId in prev) {
        newIndex = overItems.length + 1;
      } else {
        const overIndex = overItems.indexOf(overId);
        const isBelowOverItem = !!active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
        const modifier = isBelowOverItem ? 1 : 0;
        newIndex = overIndex >= 0 ? overIndex + modifier : overItems.length + 1;
      }

      recentlyMovedToNewContainer.current = true;

      return {
        ...prev,
        [activeContainer]: activeItems.filter((id) => id !== activeId),
        [overContainer]: [...overItems.slice(0, newIndex), activeItems[activeIndex], ...overItems.slice(newIndex)],
      };
    });
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    recentlyMovedToNewContainer.current = false;
    const activeId = String(active.id);
    const cloned = clonedItemsRef.current;
    const currentContainer = findContainerIn(items, activeId);
    const overContainer = over ? (findContainerIn(items, over.id) ?? currentContainer) : currentContainer;

    if (!currentContainer || !overContainer || !over) {
      if (cloned) setItems(cloned);
      clonedItemsRef.current = null;
      isDraggingRef.current = false;
      setActiveToolId(null);
      return;
    }

    let nextItems = items;
    const overIndex = items[overContainer].indexOf(String(over.id));
    const activeIndex = items[overContainer].indexOf(activeId);

    if (activeIndex >= 0 && overIndex >= 0 && activeIndex !== overIndex) {
      nextItems = {
        ...items,
        [overContainer]: arrayMove(items[overContainer], activeIndex, overIndex),
      };
      setItems(nextItems);
    }

    const changedContainers = Object.keys(nextItems).filter((key) => !sameOrder(cloned?.[key], nextItems[key]));

    for (const containerId of changedContainers) {
      dispatch(
        reorderToolsLocal({
          folderId: containerToFolderId(containerId),
          toolIds: nextItems[containerId] ?? [],
        }),
      );
    }

    clonedItemsRef.current = null;
    isDraggingRef.current = false;
    setActiveToolId(null);

    if (changedContainers.length === 0) return;

    try {
      await Promise.all(
        changedContainers.map((containerId) =>
          dispatch(
            reorderTools({
              folderId: containerToFolderId(containerId),
              toolIds: nextItems[containerId] ?? [],
            }),
          ).unwrap(),
        ),
      );
    } catch {
      if (cloned) setItems(cloned);
      dispatch(fetchTools());
      message.error("Failed to move tool");
    }
  };

  const handleDragCancel = () => {
    if (clonedItemsRef.current) setItems(clonedItemsRef.current);
    clonedItemsRef.current = null;
    isDraggingRef.current = false;
    setActiveToolId(null);
    recentlyMovedToNewContainer.current = false;
  };

  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMovedToNewContainer.current = false;
    });
  }, [items]);

  const handleToolClick = (toolId: string) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    onToolClick(toolId);
  };

  const activeTool = activeToolId ? (toolsById.get(activeToolId) ?? null) : null;

  const toolsFor = (containerId: string) => (items[containerId] ?? []).map((id) => toolsById.get(id)).filter((t): t is AgentTool => !!t);

  if (activeKey === ALL_TOOLS_KEY) {
    const all = folderMetas.flatMap((meta) => toolsFor(meta.key));
    if (all.length === 0) {
      return (
        <Empty className="py-16" description="No tools yet">
          <AskClaudeHint what="tool" tool="create_tool" />
        </Empty>
      );
    }
    return (
      <div className={cn("-mx-2 grid grid-cols-1", view === "card" ? "gap-x-6 gap-y-1 md:grid-cols-2" : "gap-y-0.5")}>
        {all.map((tool) => (
          <ToolCardView key={tool.id} tool={tool} view={view} onClick={() => onToolClick(tool.id)} />
        ))}
      </div>
    );
  }

  const activeMeta: FolderMeta = folderMetas.find((meta) => meta.key === activeKey) ?? { key: UNGROUPED_ID, title: "Ungrouped", folderId: null, editable: false };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          <FolderNode key={activeMeta.key} meta={activeMeta} view={view} tools={toolsFor(activeMeta.key)} onToolClick={handleToolClick} onEditFolder={onEditFolder} bare />
          <DragOverlay dropAnimation={null}>{activeTool ? <ToolCardView tool={activeTool} view={view} dragging /> : null}</DragOverlay>
        </DndContext>
      </section>
    </div>
  );
}
