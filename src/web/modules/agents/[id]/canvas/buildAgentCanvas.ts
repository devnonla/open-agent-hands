// Input, Instruct, and Memory sit on the left of the agent. Branches stack on the right.
// Heights match BranchNode + ConfigTree so boxes do not overlap.

export type PortSide = "left" | "right" | "top" | "bottom";

export type FlowHandle = {
  id: string;
  side: PortSide;
  /** Percent along the edge (0–100). Default 50. */
  along?: number;
};

export type FlowCard = {
  id: string;
  kind: "agent" | "branch" | "input" | "instruct" | "memory";
  title: string;
  subtitle: string;
  body: string;
  position: { x: number; y: number };
  targets: FlowHandle[];
  sources: FlowHandle[];
};

export type FlowLink = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
};

export type CanvasGroup = {
  title: string;
  items: number;
};

export type CanvasBranch = {
  id: string;
  title: string;
  groups: CanvasGroup[];
};

const AGENT_W = 360;
const AGENT_H = 460;
const BRANCH_W = 400;
const CIRCLE_W = 72;
const CIRCLE_H = 100;
const GAP_X = 144;
const GAP_Y = 36;

// BranchNode: 1px border + header + body. Body is max-h-120 (480) including py-2.
const CARD_CHROME = 40;
const MAX_BODY = 480;
const BODY_PAD = 16;
const GROUP_GAP = 12;
// ConfigTreeGroup: header 40, gap-0.5, list pt-1. Row is py-2 + 12px * leading-snug.
const GROUP_HEAD = 46;
const ROW = 32.5;
const ROW_GAP = 2;

export function showsGroupTitles(branchTitle: string, groups: { title: string }[]): boolean {
  return groups.length > 1 || (groups[0] !== undefined && groups[0].title !== branchTitle);
}

function groupHeight(items: number, titled: boolean): number {
  if (items <= 0) return 0;
  if (!titled) return items * ROW;
  return GROUP_HEAD + items * ROW + Math.max(items - 1, 0) * ROW_GAP;
}

export function branchBoxHeight(branch: CanvasBranch): number {
  const groups = branch.groups.filter((group) => group.items > 0);
  if (groups.length === 0) return 0;
  const titled = showsGroupTitles(branch.title, groups);
  const blocks = groups.reduce((sum, group) => sum + groupHeight(group.items, titled), 0);
  const inner = blocks + Math.max(groups.length - 1, 0) * GROUP_GAP;
  const body = Math.min(MAX_BODY, BODY_PAD + inner);
  return Math.round(CARD_CHROME + body);
}

export type MeasuredBox = {
  id: string;
  kind: "agent" | "branch" | "input" | "instruct" | "memory";
  position: { x: number; y: number };
  width: number;
  height: number;
};

/** Input, Instruct, and Memory feed the agent. They stack in one column left of the agent. Branches stack on the right. Returns null until every box has a size. */
export function placeMeasuredNodes(nodes: MeasuredBox[]): { id: string; x: number; y: number }[] | null {
  const agent = nodes.find((node) => node.kind === "agent");
  if (!agent || agent.width <= 0 || agent.height <= 0) return null;
  const branches = nodes.filter((node) => node.kind === "branch");
  const input = nodes.find((node) => node.kind === "input");
  const instruct = nodes.find((node) => node.kind === "instruct");
  const memory = nodes.find((node) => node.kind === "memory");
  const upstream = [input, instruct, memory].filter((node): node is MeasuredBox => node !== undefined);
  if ([...branches, ...upstream].some((node) => node.height <= 0 || node.width <= 0)) return null;

  const placed = [{ id: agent.id, x: agent.position.x, y: agent.position.y }];
  const columnRight = agent.position.x - GAP_X;
  const columnHeight = upstream.reduce((sum, node) => sum + node.height, 0) + Math.max(upstream.length - 1, 0) * GAP_Y;
  let upY = agent.position.y + (agent.height - columnHeight) / 2;
  for (const node of upstream) {
    placed.push({ id: node.id, x: columnRight - node.width, y: upY });
    upY += node.height + GAP_Y;
  }

  const x = agent.position.x + agent.width + GAP_X;
  const total = branches.reduce((sum, node) => sum + node.height, 0) + Math.max(branches.length - 1, 0) * GAP_Y;
  let y = agent.position.y + (agent.height - total) / 2;
  for (const branch of branches) {
    placed.push({ id: branch.id, x, y });
    y += branch.height + GAP_Y;
  }
  return placed;
}

function leftTargets(ids: string[]): FlowHandle[] {
  const along = ids.length === 2 ? [28, 72] : ids.length === 3 ? [22, 50, 78] : [50];
  return ids.map((id, index) => ({ id, side: "left", along: along[index] ?? 50 }));
}

export function buildAgentCanvas(input: { agent: { name: string; description: string; model: string }; branches: CanvasBranch[]; memory?: boolean }): { cards: FlowCard[]; links: FlowLink[] } {
  const visible = input.branches.map((branch) => ({ branch, height: branchBoxHeight(branch) })).filter((entry) => entry.height > 0);
  const upstreamIds = input.memory ? ["input", "instruct", "memory"] : ["input", "instruct"];

  const boxes: MeasuredBox[] = [
    { id: "agent", kind: "agent", position: { x: 0, y: 0 }, width: AGENT_W, height: AGENT_H },
    { id: "input", kind: "input", position: { x: 0, y: 0 }, width: CIRCLE_W, height: CIRCLE_H },
    { id: "instruct", kind: "instruct", position: { x: 0, y: 0 }, width: CIRCLE_W, height: CIRCLE_H },
    ...(input.memory ? [{ id: "memory", kind: "memory" as const, position: { x: 0, y: 0 }, width: CIRCLE_W, height: CIRCLE_H }] : []),
    ...visible.map(({ branch, height }) => ({
      id: `branch:${branch.id}`,
      kind: "branch" as const,
      position: { x: 0, y: 0 },
      width: BRANCH_W,
      height,
    })),
  ];
  const placed = placeMeasuredNodes(boxes) ?? [];
  const positionOf = new Map(placed.map((item) => [item.id, { x: item.x, y: item.y }]));

  const cards: FlowCard[] = [
    {
      id: "agent",
      kind: "agent",
      title: input.agent.name,
      subtitle: input.agent.model || "No model",
      body: input.agent.description,
      position: positionOf.get("agent") ?? { x: 0, y: 0 },
      targets: leftTargets(upstreamIds.map((id) => `from-${id}`)),
      sources: visible.length > 0 ? [{ id: "right", side: "right" }] : [],
    },
    {
      id: "input",
      kind: "input",
      title: "Input",
      subtitle: "",
      body: "User message",
      position: positionOf.get("input") ?? { x: 0, y: 0 },
      targets: [],
      sources: [{ id: "right", side: "right" }],
    },
    {
      id: "instruct",
      kind: "instruct",
      title: "System prompt",
      subtitle: "",
      body: "Preview",
      position: positionOf.get("instruct") ?? { x: 0, y: 0 },
      targets: [],
      sources: [{ id: "right", side: "right" }],
    },
  ];
  if (input.memory) {
    cards.push({
      id: "memory",
      kind: "memory",
      title: "Memory",
      subtitle: "",
      body: "",
      position: positionOf.get("memory") ?? { x: 0, y: 0 },
      targets: [],
      sources: [{ id: "right", side: "right" }],
    });
  }
  const links: FlowLink[] = upstreamIds.map((id) => ({ id: `flow:${id}`, source: id, target: "agent", sourceHandle: "right", targetHandle: `from-${id}` }));

  for (const { branch } of visible) {
    const id = `branch:${branch.id}`;
    const items = branch.groups.reduce((sum, group) => sum + group.items, 0);
    cards.push({
      id,
      kind: "branch",
      title: branch.title,
      subtitle: String(items),
      body: "",
      position: positionOf.get(id) ?? { x: AGENT_W + GAP_X, y: 0 },
      targets: [{ id: "left", side: "left" }],
      sources: [],
    });
    links.push({ id: `hub:${branch.id}`, source: "agent", target: id, sourceHandle: "right", targetHandle: "left" });
  }

  return { cards, links };
}
