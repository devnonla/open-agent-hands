import { Background, type Edge, Handle, type Node, type NodeChange, type NodeProps, type NodeTypes, Position, ReactFlow, applyNodeChanges, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Icon, type IconName, Modal, OverlayScroll } from "devnonla-ui";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiClient } from "src/common/api";
import { useNonlaDark } from "src/common/hooks/useNonlaDark";
import { cn } from "src/common/lib/cn";
import type { AgentListItem, AgentSkillAssignment, AgentTool, AgentToolAssignment, McpServer, Skill } from "src/common/types";
import { fetchAgents } from "src/modules/agents/common/agentsSlice";
import { isBuiltinAgentId } from "src/modules/agents/common/builtinAgents";
import { fetchTeams } from "src/modules/agents/common/teamsSlice";
import { fetchMcpServers } from "src/modules/mcp-servers/common/mcpServersSlice";
import { fetchSkills } from "src/modules/skills/common/skillsSlice";
import { fetchToolFolders } from "src/modules/tools/common/toolFoldersSlice";
import { fetchTools } from "src/modules/tools/common/toolsSlice";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { useAgentDetailContext } from "../common/agentDetailContext";
import { buildCallAgentTeams, buildMcpGroups, buildSkillItems, buildToolGroups } from "../common/configGroups";
import { ConfigTreeGroup, ConfigTreeRow } from "../components/config/ConfigTree";
import { McpToggleList } from "../components/config/McpToggleList";
import { ToolsToggleList } from "../components/config/ToolsToggleList";
import { MemoryPage } from "../memory/MemoryPage";
import { PromptPage } from "../prompt/PromptPage";
import { MainAgentNode } from "./MainAgentNode";
import { type FlowCard, type FlowHandle, type FlowLink, type MeasuredBox, type PortSide, buildAgentCanvas, placeMeasuredNodes } from "./buildAgentCanvas";

type TreeItem = { id: string; label: string; connected: boolean };
type TreeGroup = { title: string; icon: IconName; items: TreeItem[] };

type CardData = {
  kind: "agent" | "branch" | "input" | "instruct" | "memory";
  title: string;
  subtitle: string;
  body: string;
  branchKey: string;
  groups: TreeGroup[];
  targets: FlowHandle[];
  sources: FlowHandle[];
};

type CardNode = Node<CardData, "agent" | "branch" | "step">;

const PORT: Record<PortSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

const handleClass = "!size-2 !border-0 !bg-transparent !opacity-0";

function portStyle(port: FlowHandle): { top?: string; left?: string } | undefined {
  if (port.along === undefined) return undefined;
  if (port.side === "left" || port.side === "right") return { top: `${port.along}%` };
  return { left: `${port.along}%` };
}

const BRANCH_TONE: Record<string, { card: string; header: string }> = {
  tools: {
    card: "border-[color-mix(in_oklab,var(--color-sky-500)_55%,var(--card))] bg-white",
    header: "border-[color-mix(in_oklab,var(--color-sky-500)_55%,var(--card))] bg-[color-mix(in_oklab,var(--color-sky-500)_34%,var(--card))]",
  },
  mcp: {
    card: "border-[color-mix(in_oklab,var(--color-violet-500)_55%,var(--card))] bg-white",
    header: "border-[color-mix(in_oklab,var(--color-violet-500)_55%,var(--card))] bg-[color-mix(in_oklab,var(--color-violet-500)_34%,var(--card))]",
  },
  calls: {
    card: "border-[color-mix(in_oklab,var(--color-teal-500)_55%,var(--card))] bg-white",
    header: "border-[color-mix(in_oklab,var(--color-teal-500)_55%,var(--card))] bg-[color-mix(in_oklab,var(--color-teal-500)_34%,var(--card))]",
  },
  skills: {
    card: "border-[color-mix(in_oklab,var(--color-amber-500)_55%,var(--card))] bg-white",
    header: "border-[color-mix(in_oklab,var(--color-amber-500)_55%,var(--card))] bg-[color-mix(in_oklab,var(--color-amber-500)_34%,var(--card))]",
  },
};

/** Edge fill matches the child card (branch / step). */
const BRANCH_EDGE_COLOR: Record<string, string> = {
  tools: "#0ea5e9",
  mcp: "#8b5cf6",
  calls: "#14b8a6",
  skills: "#f59e0b",
};

/** Make.com-style: solid soft fill + white icon + matching edge. */
const STEP_EDGE_COLOR: Record<string, string> = {
  input: "#5BA8D0",
  instruct: "#E8924A",
  memory: "#8B74C4",
};

const ToggleCtx = createContext<{ readonly: boolean; onToggle: (branchKey: string, id: string, on: boolean) => void }>({
  readonly: true,
  onToggle: () => {},
});

const StepCtx = createContext<{ openInstruct: () => void; openMemory: () => void }>({
  openInstruct: () => {},
  openMemory: () => {},
});

const CIRCLE_META: Partial<Record<CardData["kind"], { name: IconName; bg: string }>> = {
  input: { name: "dialog", bg: "#5BA8D0" },
  instruct: { name: "book", bg: "#E8924A" },
  memory: { name: "monitor", bg: "#8B74C4" },
};

function CircleNode({ data, onClick }: { data: CardData; onClick?: () => void }) {
  const meta = CIRCLE_META[data.kind] ?? { name: "dialog" as IconName, bg: "#7EC4E0" };
  const body = (
    <>
      <span className="relative flex size-18 items-center justify-center rounded-full shadow-sm" style={{ backgroundColor: meta.bg }}>
        {data.targets.map((port) => (
          <Handle key={port.id} id={port.id} type="target" position={PORT[port.side]} className={cn(handleClass, "top-9!")} style={portStyle(port)} />
        ))}
        {data.sources.map((port) => (
          <Handle key={port.id} id={port.id} type="source" position={PORT[port.side]} className={cn(handleClass, "top-9!")} style={portStyle(port)} />
        ))}
        <Icon name={meta.name} size={28} className="text-white" />
      </span>
      <span className="mt-2 whitespace-nowrap text-center text-[12px] font-medium leading-4 text-foreground">{data.title}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="nodrag nopan flex min-w-18 cursor-pointer flex-col items-center border-0 bg-transparent p-0" onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className="nodrag nopan flex min-w-18 flex-col items-center">{body}</div>;
}

function StepNode({ data }: NodeProps<CardNode>) {
  const { openInstruct, openMemory } = useContext(StepCtx);
  if (data.kind === "instruct") return <CircleNode data={data} onClick={openInstruct} />;
  if (data.kind === "memory") return <CircleNode data={data} onClick={openMemory} />;
  if (data.kind === "input") return <CircleNode data={data} />;
  return (
    <div className="nodrag nopan w-56 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      {data.sources.map((port) => (
        <Handle key={port.id} id={port.id} type="source" position={PORT[port.side]} className={handleClass} style={portStyle(port)} />
      ))}
      <div className="border-b border-border bg-muted px-3 py-2 text-[13px] font-semibold text-foreground">{data.title}</div>
      <div className="px-3 py-2 text-[12px] text-muted-foreground">{data.body}</div>
    </div>
  );
}

function BranchScroll({ children }: { children: ReactNode }) {
  return (
    <OverlayScroll visibility="hover" autoHeight className="max-h-120" innerClassName="flex flex-col gap-3 px-3 py-2">
      {children}
    </OverlayScroll>
  );
}

function wheelAxis(event: WheelEvent): "x" | "y" {
  return Math.abs(event.deltaX) > Math.abs(event.deltaY) ? "x" : "y";
}

function canScroll(el: HTMLElement, axis: "x" | "y"): boolean {
  const overflow = axis === "y" ? getComputedStyle(el).overflowY : getComputedStyle(el).overflowX;
  if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") return false;
  const overflowSize = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  return overflowSize > 1;
}

function findScrollable(target: EventTarget | null, boundary: HTMLElement, axis: "x" | "y"): HTMLElement | null {
  let el = target instanceof Element ? target : null;
  while (el && el !== boundary) {
    if (el instanceof HTMLElement && canScroll(el, axis)) return el;
    el = el.parentElement;
  }
  return null;
}

function wheelPixels(event: WheelEvent, axis: "x" | "y", scroller: HTMLElement): number {
  const delta = axis === "y" ? event.deltaY : event.deltaX;
  if (event.deltaMode === 1) return delta * 16;
  if (event.deltaMode === 2) return delta * (axis === "y" ? scroller.clientHeight : scroller.clientWidth);
  return delta;
}

/** Wheel zooms the canvas. A body that can scroll takes the wheel instead. */
function useScrollBeforeZoom(canvasRef: { readonly current: HTMLDivElement | null }) {
  useEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const axis = wheelAxis(event);
      const scroller = findScrollable(event.target, root, axis);
      if (!scroller) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = wheelPixels(event, axis, scroller);
      if (axis === "y") {
        const max = scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTop = Math.min(max, Math.max(0, scroller.scrollTop + delta));
      } else {
        const max = scroller.scrollWidth - scroller.clientWidth;
        scroller.scrollLeft = Math.min(max, Math.max(0, scroller.scrollLeft + delta));
      }
    };
    root.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => root.removeEventListener("wheel", onWheel, { capture: true });
  }, [canvasRef]);
}

function BranchNode({ data }: NodeProps<CardNode>) {
  const { readonly, onToggle } = useContext(ToggleCtx);
  const tone = BRANCH_TONE[data.branchKey] ?? { card: "border-border bg-card", header: "border-border bg-muted" };
  const showInnerTitle = data.groups.length > 1 || data.groups[0]?.title !== data.title;
  return (
    <div className={cn("nodrag nopan w-100 overflow-hidden rounded-xl border shadow-sm", tone.card)}>
      {data.targets.map((port) => (
        <Handle key={port.id} id={port.id} type="target" position={PORT[port.side]} className={handleClass} style={portStyle(port)} />
      ))}
      <div className={cn("border-b px-3 py-2 text-[13px] font-semibold text-foreground", tone.header)}>{data.title}</div>
      <BranchScroll>
        {data.branchKey === "tools" ? (
          <ToolsToggleList />
        ) : data.branchKey === "mcp" ? (
          <McpToggleList />
        ) : (
          data.groups.map((group) =>
            showInnerTitle ? (
              <ConfigTreeGroup key={group.title} icon={group.icon} title={group.title}>
                {group.items.map((item, index) => (
                  <ConfigTreeRow key={item.id} icon={group.icon} label={item.label} checked={item.connected} disabled={readonly} onToggle={readonly ? undefined : (on) => onToggle(data.branchKey, item.id, on)} isLast={index === group.items.length - 1} />
                ))}
              </ConfigTreeGroup>
            ) : (
              <div key={group.title}>
                {group.items.map((item, index) => (
                  <ConfigTreeRow key={item.id} icon={group.icon} label={item.label} checked={item.connected} disabled={readonly} onToggle={readonly ? undefined : (on) => onToggle(data.branchKey, item.id, on)} isLast={index === group.items.length - 1} />
                ))}
              </div>
            ),
          )
        )}
      </BranchScroll>
    </div>
  );
}

const nodeTypes: NodeTypes = { agent: MainAgentNode, branch: BranchNode, step: StepNode };

function edgeColorFor(link: FlowLink): string {
  if (link.target.startsWith("branch:")) {
    const key = link.target.slice("branch:".length);
    return BRANCH_EDGE_COLOR[key] ?? "#94a3b8";
  }
  return STEP_EDGE_COLOR[link.source] ?? "#94a3b8";
}

function toNodes(cards: FlowCard[], groupsById: Record<string, TreeGroup[]>): CardNode[] {
  return cards.map((card) => {
    const branchKey = card.id.startsWith("branch:") ? card.id.slice("branch:".length) : "";
    return {
      id: card.id,
      type: card.kind === "input" || card.kind === "instruct" || card.kind === "memory" ? "step" : card.kind,
      position: card.position,
      data: {
        kind: card.kind,
        title: card.title,
        subtitle: card.subtitle,
        body: card.body,
        branchKey,
        groups: groupsById[card.id] ?? [],
        targets: card.targets,
        sources: card.sources,
      },
      draggable: card.kind === "agent",
      style: { pointerEvents: "all" },
    };
  });
}

function separateMeasured(nodes: CardNode[]): CardNode[] {
  const boxes: MeasuredBox[] = nodes.map((node) => ({
    id: node.id,
    kind: node.data.kind,
    position: node.position,
    width: node.measured?.width ?? 0,
    height: node.measured?.height ?? 0,
  }));
  const placed = placeMeasuredNodes(boxes);
  if (!placed) return nodes;
  let changed = false;
  const next = nodes.map((node) => {
    const position = placed.find((item) => item.id === node.id);
    if (!position) return node;
    if (Math.abs(node.position.x - position.x) < 0.5 && Math.abs(node.position.y - position.y) < 0.5) return node;
    changed = true;
    return { ...node, position: { x: position.x, y: position.y } };
  });
  return changed ? next : nodes;
}

function toEdges(links: FlowLink[]): Edge[] {
  return links.map((link) => ({
    id: link.id,
    source: link.source,
    target: link.target,
    sourceHandle: link.sourceHandle,
    targetHandle: link.targetHandle,
    markerStart: undefined,
    markerEnd: undefined,
    style: { stroke: edgeColorFor(link), strokeWidth: 2 },
  }));
}

type CanvasViewport = { x: number; y: number; zoom: number };

// Survives canvas remounts when the route id changes. After the first agent, restore this camera instead of fitting.
let seenCanvasAgentId: string | null = null;
let allowCanvasAutoFit = true;
let savedCanvasViewport: CanvasViewport | null = null;

function shouldAutoFitCanvas(agentId: string): boolean {
  if (seenCanvasAgentId !== null && seenCanvasAgentId !== agentId) allowCanvasAutoFit = false;
  seenCanvasAgentId = agentId;
  return allowCanvasAutoFit;
}

/** Fit the open agent while its layout settles. Later agents keep the current zoom and pan. */
function FitOnLayout({ layoutKey }: { layoutKey: string }) {
  const { fitView, getViewport } = useReactFlow();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.18, duration: 0, maxZoom: 1 }).then(() => {
        savedCanvasViewport = getViewport();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutKey, fitView, getViewport]);
  return null;
}

function groupsEqual(a: TreeGroup[], b: TreeGroup[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right || left.title !== right.title || left.items.length !== right.items.length) return false;
    for (let j = 0; j < left.items.length; j++) {
      const li = left.items[j];
      const ri = right.items[j];
      if (!li || !ri || li.id !== ri.id || li.connected !== ri.connected || li.label !== ri.label) return false;
    }
  }
  return true;
}

export function AgentFlowCanvas() {
  const { id, agent, name, description, aiModel, toolAssignments, setToolAssignments, skillAssignments, setSkillAssignments, callableAgentIds, readonly, onToggleTool, onToggleSkill, onToggleCallableAgent } = useAgentDetailContext();
  const dispatch = useAppDispatch();
  const colorMode = useNonlaDark() ? "dark" : "light";
  const allTools = useAppSelector((s) => s.tools.items) as AgentTool[];
  const toolFolders = useAppSelector((s) => s.toolFolders.folders);
  const mcpServers = useAppSelector((s) => s.mcpServers.items) as McpServer[];
  const allSkills = useAppSelector((s) => s.skills.items) as Skill[];
  const agents = useAppSelector((s) => s.agents.items) as AgentListItem[];
  const teams = useAppSelector((s) => s.teams.teams);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void Promise.all([
      apiClient.get<AgentToolAssignment[]>(`/api/agents/${id}/tool-assignments`),
      apiClient.get<AgentSkillAssignment[]>(`/api/agents/${id}/skill-assignments`),
      dispatch(fetchTools()).unwrap(),
      dispatch(fetchToolFolders()).unwrap(),
      dispatch(fetchMcpServers()).unwrap(),
      dispatch(fetchSkills()).unwrap(),
      dispatch(fetchAgents()).unwrap(),
      dispatch(fetchTeams()).unwrap(),
    ])
      .then(([toolRows, skillRows]) => {
        if (cancelled) return;
        setToolAssignments(Array.isArray(toolRows) ? toolRows : []);
        setSkillAssignments(Array.isArray(skillRows) ? skillRows : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, dispatch, setToolAssignments, setSkillAssignments]);

  const groupsById = useMemo(() => {
    const catalog = readonly ? allTools : allTools.filter((tool) => tool.workspaceOnly !== true);
    const toolBuilt = buildToolGroups({ allTools: catalog, toolFolders, toolAssignments, includeMemory: !readonly });
    const toolSource = readonly ? toolBuilt.map((group) => ({ ...group, tools: group.tools.filter((tool) => tool.connected) })).filter((group) => group.tools.length > 0) : toolBuilt;
    const toolGroups = toolSource
      .map((group) => ({
        title: group.name,
        icon: "code" as const,
        items: group.tools.map((tool) => ({ id: tool.id, label: tool.label, connected: tool.connected })),
      }))
      .filter((group) => group.items.length > 0);
    const mcpBuilt = buildMcpGroups({ mcpServers, toolAssignments }).map((group) => ({
      title: group.name,
      icon: "stars" as const,
      items: group.tools.map((tool) => ({ id: tool.id, label: tool.label, connected: tool.connected })),
    }));
    const mcpSource = readonly ? mcpBuilt.map((group) => ({ ...group, items: group.items.filter((item) => item.connected) })).filter((group) => group.items.length > 0) : mcpBuilt;
    const mcpGroups = mcpSource.filter((group) => group.items.length > 0);
    const callBuilt = id
      ? buildCallAgentTeams({ agents, currentAgentId: id, teams, callableAgentIds }).map((team) => ({
          title: team.name,
          icon: "stars" as const,
          items: team.agents.map((item) => ({ id: item.id, label: item.name, connected: item.connected })),
        }))
      : [];
    const callSource = readonly ? callBuilt.map((group) => ({ ...group, items: group.items.filter((item) => item.connected) })).filter((group) => group.items.length > 0) : callBuilt;
    const callGroups = callSource.filter((group) => group.items.length > 0);
    const skillBuilt = buildSkillItems({ allSkills, skillAssignments }).map((skill) => ({ id: skill.id, label: skill.label, connected: skill.connected }));
    const skillItems = readonly ? skillBuilt.filter((skill) => skill.connected) : skillBuilt;
    const map: Record<string, TreeGroup[]> = {};
    if (toolGroups.length > 0) map["branch:tools"] = toolGroups;
    if (mcpGroups.length > 0) map["branch:mcp"] = mcpGroups;
    if (callGroups.length > 0) map["branch:calls"] = callGroups;
    if (skillItems.length > 0) map["branch:skills"] = [{ title: "Skills", icon: "stars", items: skillItems }];
    return map;
  }, [allTools, toolFolders, toolAssignments, mcpServers, allSkills, skillAssignments, agents, teams, callableAgentIds, id, readonly]);

  const graph = useMemo(() => {
    const groupsOf = (idKey: string) => (groupsById[idKey] ?? []).map((group) => ({ title: group.title, items: group.items.length }));
    return buildAgentCanvas({
      agent: { name: name || agent.name, description: description || agent.description || "", model: aiModel || agent.aiModel || "" },
      branches: [
        { id: "tools", title: "Tools", groups: groupsOf("branch:tools") },
        { id: "mcp", title: "MCP Tools", groups: groupsOf("branch:mcp") },
        { id: "calls", title: "Call Agents", groups: groupsOf("branch:calls") },
        { id: "skills", title: "Skills", groups: groupsOf("branch:skills") },
      ],
      memory: !(id && isBuiltinAgentId(id)),
    });
  }, [agent, name, description, aiModel, groupsById, id]);

  // Item counts + card positions — ignores connected toggles so zoom stays put.
  const layoutKey = useMemo(() => {
    const tree = Object.entries(groupsById)
      .map(([key, groups]) => `${key}:${groups.map((group) => `${group.title}=${group.items.length}`).join(",")}`)
      .join("|");
    return `${tree}::${graph.cards.map((card) => `${card.id}:${card.position.x}:${card.position.y}`).join("|")}`;
  }, [groupsById, graph]);

  const [nodes, setNodes] = useState<CardNode[]>(() => toNodes(graph.cards, groupsById));
  const [edges, setEdges] = useState<Edge[]>(() => toEdges(graph.links));
  const graphRef = useRef(graph);
  const groupsRef = useRef(groupsById);
  graphRef.current = graph;
  groupsRef.current = groupsById;

  useEffect(() => {
    setNodes(toNodes(graphRef.current.cards, groupsRef.current));
    setEdges(toEdges(graphRef.current.links));
  }, [layoutKey]);

  // Toggle checkmarks: patch node data only — keep measured size so fitView does not fire.
  useEffect(() => {
    setNodes((current) => {
      if (current.length === 0) return current;
      let changed = false;
      const next = current.map((node) => {
        const groups = groupsById[node.id] ?? [];
        if (groupsEqual(node.data.groups, groups)) return node;
        changed = true;
        return { ...node, data: { ...node.data, groups } };
      });
      return changed ? next : current;
    });
  }, [groupsById]);

  const onNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      if (!changes.some((change) => change.type === "dimensions")) return next;
      return separateMeasured(next);
    });
  }, []);

  const canvasRef = useRef<HTMLDivElement>(null);
  useScrollBeforeZoom(canvasRef);

  const autoFit = id ? shouldAutoFitCanvas(id) : false;
  const location = useLocation();
  const navigate = useNavigate();
  const [instructOpen, setInstructOpen] = useState(() => Boolean((location.state as { openInstruct?: boolean } | null)?.openInstruct));
  const [memoryOpen, setMemoryOpen] = useState(false);
  const openInstruct = useCallback(() => setInstructOpen(true), []);
  const openMemory = useCallback(() => setMemoryOpen(true), []);

  useEffect(() => {
    const state = location.state as { openInstruct?: boolean } | null;
    if (!state?.openInstruct) return;
    setInstructOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const onToggle = useCallback(
    (branchKey: string, itemId: string, on: boolean) => {
      if (branchKey === "calls") onToggleCallableAgent(itemId, on);
      else if (branchKey === "skills") onToggleSkill(itemId, on);
      else onToggleTool(itemId, on);
    },
    [onToggleCallableAgent, onToggleSkill, onToggleTool],
  );

  return (
    <ToggleCtx.Provider value={{ readonly, onToggle }}>
      <StepCtx.Provider value={{ openInstruct, openMemory }}>
        <div ref={canvasRef} className="agent-flow absolute inset-0" aria-label="Agent canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            colorMode={colorMode}
            defaultViewport={savedCanvasViewport ?? undefined}
            onMove={(_event, viewport) => {
              savedCanvasViewport = viewport;
            }}
            fitView={autoFit}
            fitViewOptions={{ padding: 0.18, duration: 0, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.5}
            nodesConnectable={false}
            elementsSelectable={false}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            zoomActivationKeyCode={null}
            zoomOnDoubleClick={false}
          >
            <Background gap={20} size={1} />
            {autoFit ? <FitOnLayout layoutKey={layoutKey} /> : null}
          </ReactFlow>
        </div>
        <Modal
          open={instructOpen}
          onCancel={() => setInstructOpen(false)}
          title="System prompt"
          footer={null}
          className="nonla-instruct-modal"
          destroyOnHidden
          styles={{
            content: { top: 16, right: "calc(16px + var(--nonla-bot-inset))", bottom: 16, left: 16, width: "auto", maxWidth: "none", maxHeight: "none", transform: "none" },
            body: { flex: "1 1 auto", minHeight: 0, padding: 0, overflow: "hidden", position: "relative" },
          }}
        >
          <div className="absolute inset-0">
            <PromptPage />
          </div>
        </Modal>
        <Modal
          open={memoryOpen}
          onCancel={() => setMemoryOpen(false)}
          title="Memory"
          footer={null}
          className="nonla-instruct-modal"
          destroyOnHidden
          styles={{
            content: { top: 16, right: "calc(16px + var(--nonla-bot-inset))", bottom: 16, left: 16, width: "auto", maxWidth: "none", maxHeight: "none", transform: "none" },
            body: { flex: "1 1 auto", minHeight: 0, padding: 0, overflow: "hidden", position: "relative" },
          }}
        >
          <div className="absolute inset-0">
            <MemoryPage />
          </div>
        </Modal>
      </StepCtx.Provider>
    </ToggleCtx.Provider>
  );
}
