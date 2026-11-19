import { describe, expect, test } from "bun:test";
import { openuiTool } from "../modules/agents/runtime/llm-tools/openui.tool.js";

describe("nonla_openui", () => {
  test("guide returns syntax help", async () => {
    const raw = await openuiTool.invoke({ action: "guide" });
    const data = JSON.parse(String(raw)) as { ok: boolean; guide?: string };
    expect(data.ok).toBe(true);
    expect(data.guide).toContain("root = Stack");
  });

  test("render wraps OpenUI Lang in an openui fence", async () => {
    const source = `root = Stack([title])\ntitle = TextContent("Hi", "large-heavy")`;
    const raw = await openuiTool.invoke({ action: "render", source });
    const data = JSON.parse(String(raw)) as { ok: boolean; markdown?: string };
    expect(data.ok).toBe(true);
    expect(data.markdown).toBe(`\`\`\`openui\n${source}\n\`\`\``);
  });

  test("render rejects missing root", async () => {
    const raw = await openuiTool.invoke({ action: "render", source: 'title = TextContent("Hi")' });
    const data = JSON.parse(String(raw)) as { ok: boolean };
    expect(data.ok).toBe(false);
  });

  test("render repairs TabItem content that is a bare Card", async () => {
    const source = `root = Stack([tabs])\ntabs = Tabs([t1])\nt1 = TabItem("w", "Weather", Card([TextContent("Hi")]))`;
    const raw = await openuiTool.invoke({ action: "render", source });
    const data = JSON.parse(String(raw)) as { ok: boolean; markdown?: string };
    expect(data.ok).toBe(true);
    expect(data.markdown).toContain('TabItem("w", "Weather", [Card([TextContent("Hi")])])');
  });
});
