import { describe, expect, test } from "bun:test";
import { lookupContextTable, modelLookupKey, resolveContextLength } from "../common/ai/model-context.js";
import { normalizeUsage } from "../common/ai/usage.js";
import { chooseCut, clipToolOutput } from "../modules/agents/runtime/utils/history-window.js";

describe("normalizeUsage", () => {
  test("reads merged langchain usage and drops reasoning from context", () => {
    const usage = normalizeUsage({
      usage_metadata: {
        input_tokens: 1000,
        output_tokens: 400,
        total_tokens: 1400,
        input_token_details: { cache_read: 200 },
        output_token_details: { reasoning: 100 },
      },
    });
    expect(usage.inputTokens).toBe(1000);
    expect(usage.cacheReadTokens).toBe(200);
    expect(usage.contextTokens).toBe(1300);
    expect(usage.valid).toBe(true);
  });

  test("marks cumulative usage as suspicious", () => {
    const usage = normalizeUsage({ usage_metadata: { input_tokens: 9000, output_tokens: 10 } }, { estimatedInputTokens: 1000 });
    expect(usage.suspicious).toBe(true);
    expect(usage.valid).toBe(false);
  });

  test("missing usage is not valid", () => {
    expect(normalizeUsage(null).valid).toBe(false);
    expect(normalizeUsage({ usage_metadata: { input_tokens: 0, output_tokens: 0 } }).valid).toBe(false);
  });
});

describe("resolveContextLength", () => {
  test("longest model key wins", () => {
    expect(modelLookupKey("anthropic/claude-sonnet-4-6:free")).toBe("claude-sonnet-4-6");
    expect(lookupContextTable("claude-sonnet-4-6")).toBe(200_000);
    expect(lookupContextTable("claude-sonnet-4")).toBe(200_000);
  });

  test("stored length beats the table", () => {
    expect(resolveContextLength({ modelId: "gpt-4o", storedLength: 32000 })).toEqual({ max: 32000, source: "meta" });
  });

  test("unknown model falls back", () => {
    expect(resolveContextLength({ modelId: "my-local-model" })).toEqual({ max: 128_000, source: "default" });
  });
});

describe("chooseCut", () => {
  test("keeps the latest user turn and cuts on a user boundary", () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(20_000),
      metadata: null,
    }));
    const cut = chooseCut(rows, 100_000, 1);
    expect("cutMessageId" in cut).toBe(true);
    if ("cutMessageId" in cut) {
      const row = rows.find((item) => item.id === cut.cutMessageId);
      expect(row?.role).toBe("user");
      expect(cut.cutMessageId).not.toBe("m0");
    }
  });

  test("skips when the whole history fits the tail", () => {
    const rows = [
      { id: "a", role: "user", content: "hi", metadata: null },
      { id: "b", role: "assistant", content: "ok", metadata: null },
    ];
    expect(chooseCut(rows, 128_000, 1)).toEqual({ skip: true });
  });
});

describe("clipToolOutput", () => {
  test("keeps short output and stamps the message id on long output", () => {
    expect(clipToolOutput("short", "id-1")).toBe("short");
    const long = "a".repeat(7000);
    const clipped = clipToolOutput(long, "id-1");
    expect(clipped).toContain("messageId = id-1");
    expect(clipped).toContain("nonla_read_message");
    expect(clipped.length).toBeLessThan(long.length);
  });
});
