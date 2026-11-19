import { describe, expect, test } from "bun:test";
import { branchBoxHeight, buildAgentCanvas, placeMeasuredNodes } from "./buildAgentCanvas.ts";

const GAP_Y = 36;
const AGENT_W = 360;
const AGENT_H = 460;
const BRANCH_X = AGENT_W + 144;

describe("buildAgentCanvas", () => {
  test("stacks every branch on the right of the agent", () => {
    const { cards, links } = buildAgentCanvas({
      agent: { name: "Agent Manager", description: "Manages agents.", model: "gpt" },
      branches: [
        { id: "tools", title: "Tools", groups: [{ title: "Builtin", items: 8 }] },
        { id: "mcp", title: "MCP Tools", groups: [{ title: "MCP Tools", items: 2 }] },
        { id: "calls", title: "Call Agents", groups: [{ title: "Builtin", items: 1 }] },
      ],
    });

    const agent = cards.find((card) => card.id === "agent");
    const tools = cards.find((card) => card.id === "branch:tools");
    const mcp = cards.find((card) => card.id === "branch:mcp");
    const calls = cards.find((card) => card.id === "branch:calls");

    expect(cards).toHaveLength(6);
    expect(agent?.position).toEqual({ x: 0, y: 0 });
    expect(agent?.sources).toEqual([{ id: "right", side: "right" }]);
    expect(agent?.targets.map((port) => port.id)).toEqual(["from-input", "from-instruct"]);
    expect(tools?.position.x).toBe(BRANCH_X);
    expect(mcp?.position.x).toBe(tools?.position.x);
    expect(calls?.position.x).toBe(tools?.position.x);
    expect(mcp?.position.y).toBeGreaterThan((tools?.position.y ?? 0) + branchBoxHeight({ id: "tools", title: "Tools", groups: [{ title: "Builtin", items: 8 }] }));
    expect(calls?.position.y).toBeGreaterThan(mcp?.position.y ?? 0);
    expect(tools?.targets).toEqual([{ id: "left", side: "left" }]);
    expect(
      links
        .filter((link) => link.source === "agent")
        .map((link) => link.target)
        .sort(),
    ).toEqual(["branch:calls", "branch:mcp", "branch:tools"]);
    expect(links.find((link) => link.target === "branch:tools")).toMatchObject({ sourceHandle: "right", targetHandle: "left" });
    expect(links.find((link) => link.source === "input")).toMatchObject({ target: "agent", sourceHandle: "right", targetHandle: "from-input" });
    expect(links.find((link) => link.source === "instruct")).toMatchObject({ target: "agent", sourceHandle: "right", targetHandle: "from-instruct" });
    expect(cards.some((card) => card.id.startsWith("item:"))).toBe(false);
  });

  test("stacks input above instruct, both left of the agent", () => {
    const { cards, links } = buildAgentCanvas({
      agent: { name: "Nonla Bot", description: "", model: "gpt" },
      branches: [],
    });
    const input = cards.find((card) => card.id === "input");
    const instruct = cards.find((card) => card.id === "instruct");

    expect(input?.position).toEqual({ x: -216, y: 112 });
    expect(instruct?.position).toEqual({ x: -216, y: 248 });
    expect(input?.sources).toEqual([{ id: "right", side: "right" }]);
    expect(instruct?.sources).toEqual([{ id: "right", side: "right" }]);
    expect(
      links
        .filter((link) => link.target === "agent")
        .map((link) => link.targetHandle)
        .sort(),
    ).toEqual(["from-input", "from-instruct"]);
  });

  test("keeps a gap between a full card and the next one", () => {
    const tools = {
      id: "tools",
      title: "Tools",
      groups: [
        { title: "Builtin", items: 5 },
        { title: "Other", items: 6 },
      ],
    };
    const mcp = { id: "mcp", title: "MCP Tools", groups: [{ title: "MCP Tools", items: 10 }] };
    const { cards } = buildAgentCanvas({
      agent: { name: "Nonla Bot", description: "", model: "gpt" },
      branches: [tools, mcp],
    });
    const toolsCard = cards.find((card) => card.id === "branch:tools");
    const mcpCard = cards.find((card) => card.id === "branch:mcp");
    const toolsHeight = branchBoxHeight(tools);

    expect(toolsHeight).toBe(520);
    expect(branchBoxHeight(mcp)).toBe(381);
    expect((mcpCard?.position.y ?? 0) - (toolsCard?.position.y ?? 0)).toBe(toolsHeight + GAP_Y);
    expect(mcpCard?.position.x).toBe(toolsCard?.position.x);
  });

  test("places measured boxes with no overlap", () => {
    const placed = placeMeasuredNodes([
      { id: "agent", kind: "agent", position: { x: 0, y: 0 }, width: AGENT_W, height: AGENT_H },
      { id: "branch:tools", kind: "branch", position: { x: 0, y: 0 }, width: 400, height: 520 },
      { id: "branch:mcp", kind: "branch", position: { x: 0, y: 0 }, width: 400, height: 381 },
      { id: "branch:calls", kind: "branch", position: { x: 0, y: 0 }, width: 400, height: 520 },
      { id: "branch:skills", kind: "branch", position: { x: 0, y: 0 }, width: 400, height: 413 },
    ]);

    expect(placed).not.toBeNull();
    const boxes = [
      { id: "branch:tools", height: 520 },
      { id: "branch:mcp", height: 381 },
      { id: "branch:calls", height: 520 },
      { id: "branch:skills", height: 413 },
    ];
    const byId = new Map(placed?.map((item) => [item.id, item]));
    for (let index = 0; index < boxes.length - 1; index++) {
      const current = boxes[index];
      const next = boxes[index + 1];
      if (!current || !next) continue;
      const top = byId.get(current.id);
      const below = byId.get(next.id);
      expect(below && top ? below.y - (top.y + current.height) : 0).toBe(GAP_Y);
      expect(top?.x).toBe(BRANCH_X);
    }
  });

  test("skips an empty branch", () => {
    const { cards } = buildAgentCanvas({
      agent: { name: "Nonla Bot", description: "", model: "" },
      branches: [
        { id: "tools", title: "Tools", groups: [{ title: "Tools", items: 0 }] },
        { id: "skills", title: "Skills", groups: [{ title: "Skills", items: 1 }] },
      ],
    });

    expect(cards.some((card) => card.title === "Tools")).toBe(false);
    expect(cards.some((card) => card.title === "Skills")).toBe(true);
    expect(cards.find((card) => card.kind === "agent")?.subtitle).toBe("No model");
  });

  test("stacks memory under instruct on the left", () => {
    const { cards, links } = buildAgentCanvas({
      agent: { name: "Nonla Bot", description: "", model: "gpt" },
      branches: [],
      memory: true,
    });
    const input = cards.find((card) => card.id === "input");
    const instruct = cards.find((card) => card.id === "instruct");
    const memory = cards.find((card) => card.id === "memory");

    expect(input?.position).toEqual({ x: -216, y: 44 });
    expect(instruct?.position).toEqual({ x: -216, y: 180 });
    expect(memory?.position).toEqual({ x: -216, y: 316 });
    expect(memory?.kind).toBe("memory");
    expect(cards.find((card) => card.kind === "agent")?.targets.map((port) => port.id)).toEqual(["from-input", "from-instruct", "from-memory"]);
    expect(links.find((link) => link.source === "memory")).toMatchObject({ target: "agent", sourceHandle: "right", targetHandle: "from-memory" });
  });
});
