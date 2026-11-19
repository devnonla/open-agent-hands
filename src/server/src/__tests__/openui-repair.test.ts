import { describe, expect, test } from "bun:test";
import { repairOpenUiSource } from "../modules/agents/runtime/llm-tools/openui-repair.js";

describe("repairOpenUiSource", () => {
  test("wraps lone Card in TabItem content", () => {
    const input = `t1 = TabItem("w", "Weather", Card([TextContent("Hi")]))`;
    expect(repairOpenUiSource(input)).toBe(`t1 = TabItem("w", "Weather", [Card([TextContent("Hi")])])`);
  });

  test("keeps content that is already an array", () => {
    const input = `t1 = TabItem("w", "Weather", [Card([TextContent("Hi")])])`;
    expect(repairOpenUiSource(input)).toBe(input);
  });

  test("wraps lone Stack child identifier", () => {
    expect(repairOpenUiSource("root = Stack(card)")).toBe("root = Stack([card])");
  });

  test("repairs TabItem nested inside Stack array", () => {
    const input = `root = Stack([TabItem("w", "Weather", Card([TextContent("Hi")]))])`;
    expect(repairOpenUiSource(input)).toBe(`root = Stack([TabItem("w", "Weather", [Card([TextContent("Hi")])])])`);
  });
});
