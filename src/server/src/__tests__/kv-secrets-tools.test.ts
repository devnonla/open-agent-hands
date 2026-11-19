import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { kvStoreTool } from "../modules/agents/runtime/llm-tools/kv-store.tool.js";
import { makeManageSecretsTool } from "../modules/agents/runtime/llm-tools/workspace.tool.js";
import { createTestApp, setupAdmin } from "./test-helpers.js";

describe("KV Store + Secrets builtin tools", () => {
  let cleanup: () => void;

  beforeAll(async () => {
    const t = await createTestApp();
    cleanup = t.cleanup;
    await setupAdmin(t.app);
  });

  afterAll(() => cleanup());

  test("kv_store — set / get / list / delete", async () => {
    const setRes = JSON.parse(String(await kvStoreTool.invoke({ action: "set", key: "base_url", value: "https://api.example.com" })));
    expect(setRes.ok).toBe(true);
    expect(setRes.key).toBe("BASE_URL");
    expect(setRes.value).toBe("https://api.example.com");

    const getRes = JSON.parse(String(await kvStoreTool.invoke({ action: "get", key: "BASE_URL" })));
    expect(getRes.ok).toBe(true);
    expect(getRes.value).toBe("https://api.example.com");

    const listRes = JSON.parse(String(await kvStoreTool.invoke({ action: "list" })));
    expect(listRes.ok).toBe(true);
    expect(listRes.entries.some((e: { key: string }) => e.key === "BASE_URL")).toBe(true);

    const delRes = JSON.parse(String(await kvStoreTool.invoke({ action: "delete", key: "BASE_URL" })));
    expect(delRes.ok).toBe(true);

    const missing = JSON.parse(String(await kvStoreTool.invoke({ action: "get", key: "BASE_URL" })));
    expect(missing.ok).toBe(false);
  });

  test("kv_store — preserves Vietnamese on set get update", async () => {
    const original = "khoảng 211 nghìn các kênh ấy";
    const updated = `${original} — ${"ảầẫấậ ".repeat(80)}`;

    const setRes = JSON.parse(String(await kvStoreTool.invoke({ action: "set", key: "NOTE", value: original })));
    expect(setRes.ok).toBe(true);
    expect(setRes.value).toBe(original);

    const getRes = JSON.parse(String(await kvStoreTool.invoke({ action: "get", key: "NOTE" })));
    expect(getRes.value).toBe(original);

    const again = JSON.parse(String(await kvStoreTool.invoke({ action: "set", key: "NOTE", value: updated })));
    expect(again.value).toBe(updated);

    const got = JSON.parse(String(await kvStoreTool.invoke({ action: "get", key: "NOTE" })));
    expect(got.value).toBe(updated);

    await kvStoreTool.invoke({ action: "delete", key: "NOTE" });
  });

  test("nonla_manage_secrets — set / get / list / delete (list hides values)", async () => {
    const secrets = makeManageSecretsTool();
    const setRes = JSON.parse(String(await secrets.invoke({ action: "set", body: { key: "api_token", value: "tok_123" } }))) as { ok: boolean; result: { key: string; value?: string } };
    expect(setRes.ok).toBe(true);
    expect(setRes.result.key).toBe("API_TOKEN");
    expect(setRes.result).not.toHaveProperty("value");

    const getRes = JSON.parse(String(await secrets.invoke({ action: "get", body: { key: "API_TOKEN" } }))) as { ok: boolean; result: { value: string } };
    expect(getRes.ok).toBe(true);
    expect(getRes.result.value).toBe("tok_123");

    const listRes = JSON.parse(String(await secrets.invoke({ action: "list" }))) as { ok: boolean; result: { key: string }[] };
    expect(listRes.ok).toBe(true);
    expect(listRes.result.some((item) => item.key === "API_TOKEN")).toBe(true);

    const rotate = JSON.parse(String(await secrets.invoke({ action: "set", body: { key: "API_TOKEN", value: "tok_rotated" } }))) as { ok: boolean };
    expect(rotate.ok).toBe(true);
    const afterRotate = JSON.parse(String(await secrets.invoke({ action: "get", body: { key: "API_TOKEN" } }))) as { ok: boolean; result: { value: string } };
    expect(afterRotate.result.value).toBe("tok_rotated");

    const delRes = JSON.parse(String(await secrets.invoke({ action: "delete", body: { key: "API_TOKEN" } }))) as { ok: boolean };
    expect(delRes.ok).toBe(true);
  });

  test("nonla_manage_secrets — encrypt decrypt preserves Vietnamese", async () => {
    const secrets = makeManageSecretsTool();
    const original = "khoảng 211 nghìn các kênh ấy";
    const updated = `${original} — ${"ảầẫấậ ".repeat(80)}`;

    const setRes = JSON.parse(String(await secrets.invoke({ action: "set", body: { key: "VI_SECRET", value: original } }))) as { ok: boolean };
    expect(setRes.ok).toBe(true);

    const getRes = JSON.parse(String(await secrets.invoke({ action: "get", body: { key: "VI_SECRET" } }))) as { ok: boolean; result: { value: string } };
    expect(getRes.result.value).toBe(original);

    await secrets.invoke({ action: "set", body: { key: "VI_SECRET", value: updated } });
    const after = JSON.parse(String(await secrets.invoke({ action: "get", body: { key: "VI_SECRET" } }))) as { ok: boolean; result: { value: string } };
    expect(after.result.value).toBe(updated);

    await secrets.invoke({ action: "delete", body: { key: "VI_SECRET" } });
  });
});
