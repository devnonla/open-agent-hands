import { afterEach, describe, expect, test } from "bun:test";
import { describeModelContexts } from "../common/ai/model-context.js";
import { fetchModelCatalog, pickContextLength } from "../modules/llm-providers/fetchModels.js";
import { mergeFetchedContext } from "../modules/llm-providers/llm-providers.service.js";

const realFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = handler(String(input), init);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("model catalog", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("openrouter keeps context_length per model", async () => {
    mockFetch(() => ({ data: [{ id: "a/model-1", context_length: 256000 }, { id: "b/model-2" }] }));
    const out = await fetchModelCatalog({ provider: "openrouter", apiKey: "k", customBaseUrl: "" });
    expect(out.models).toEqual(["a/model-1", "b/model-2"]);
    expect(out.contextLengths).toEqual({ "a/model-1": 256000 });
  });

  test("google reads inputTokenLimit", async () => {
    mockFetch(() => ({ models: [{ name: "models/gemini-x", inputTokenLimit: 1048576 }] }));
    const out = await fetchModelCatalog({ provider: "google", apiKey: "k", customBaseUrl: "" });
    expect(out.contextLengths).toEqual({ "gemini-x": 1048576 });
  });

  test("anthropic reads max_input_tokens", async () => {
    mockFetch(() => ({ data: [{ id: "claude-x", max_input_tokens: 200000 }], has_more: false }));
    const out = await fetchModelCatalog({ provider: "anthropic", apiKey: "k", customBaseUrl: "" });
    expect(out.contextLengths).toEqual({ "claude-x": 200000 });
  });

  test("ollama reads context length from /api/show", async () => {
    mockFetch((url) => (url.endsWith("/api/tags") ? { models: [{ name: "llama3:8b" }] } : { model_info: { "llama.context_length": 8192 } }));
    const out = await fetchModelCatalog({ provider: "ollama", apiKey: "", customBaseUrl: "http://localhost:11434" });
    expect(out.contextLengths).toEqual({ "llama3:8b": 8192 });
  });

  test("openai-compatible servers that report max_model_len are read", async () => {
    mockFetch(() => ({ data: [{ id: "local", max_model_len: 32768 }, { id: "plain" }] }));
    const out = await fetchModelCatalog({ provider: "custom", apiKey: "k", customBaseUrl: "http://x/v1" });
    expect(out.contextLengths).toEqual({ local: 32768 });
  });

  test("rejects nonsense values", () => {
    expect(pickContextLength({ context_length: 12 })).toBeNull();
    expect(pickContextLength({ context_length: "big" })).toBeNull();
    expect(pickContextLength({ top_provider: { context_length: 65536 } })).toBe(65536);
  });

  test("merge keeps manual values and calibration", () => {
    const merged = mergeFetchedContext({ a: { contextLength: 1000, source: "manual" }, b: { calibration: 1.2 } }, { a: 5000, b: 64000, c: 8000 });
    expect(merged.a).toEqual({ contextLength: 1000, source: "manual" });
    expect(merged.b).toEqual({ calibration: 1.2, contextLength: 64000, source: "api" });
    expect(merged.c).toEqual({ contextLength: 8000, source: "api" });
  });

  test("describe prefers stored length, then table, then nothing", () => {
    const out = describeModelContexts(["m1", "gpt-4.1", "unknown-model"], { m1: { contextLength: 256000, source: "api" } });
    expect(out.m1).toEqual({ max: 256000, source: "api" });
    expect(out["gpt-4.1"]?.source).toBe("table");
    expect(out["unknown-model"]).toBeUndefined();
  });
});
