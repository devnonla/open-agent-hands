import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { agents, getDb } from "../common/db/client.js";
import { qrun } from "../common/db/query.js";
import { pickRunModel, resolveRunModel } from "../modules/agents/runtime/utils/resolve-run-model.js";
import { createTestApp } from "./test-helpers.js";

const manager = { id: "nonla_agent_manager", name: "Agent Manager", aiProvider: null, aiModel: null };

describe("pickRunModel", () => {
  test("a chosen model stays on the manager", () => {
    expect(pickRunModel({ ...manager, aiProvider: "own-provider", aiModel: "own-model" }, { providerId: "caller-provider", modelId: "caller-model" })).toEqual({
      kind: "fixed",
      providerId: "own-provider",
      modelId: "own-model",
    });
  });

  test("a manager with no model uses the caller", () => {
    expect(pickRunModel(manager, { providerId: "caller-provider", modelId: "caller-model" })).toEqual({
      kind: "fixed",
      providerId: "caller-provider",
      modelId: "caller-model",
    });
  });

  test("a manager with no caller falls through to its parent", () => {
    expect(pickRunModel(manager)).toEqual({ kind: "parent" });
    expect(pickRunModel(manager, { providerId: "caller-provider" })).toEqual({ kind: "parent" });
  });

  test("other agents still need their own model", () => {
    expect(() => pickRunModel({ id: "user-1", name: "User", aiProvider: null, aiModel: null }, { providerId: "caller-provider", modelId: "caller-model" })).toThrow("no AI provider configured");
    expect(() => pickRunModel({ id: "nonla-bot", name: "Nonla Bot", aiProvider: null, aiModel: null })).toThrow("no AI provider configured");
  });
});

describe("resolveRunModel", () => {
  test("a manager with no model uses Nonla Bot", async () => {
    const t = await createTestApp();
    try {
      await qrun(getDb().update(agents).set({ aiProvider: "provider-1", aiModel: "bot-model" }).where(eq(agents.id, "nonla-bot")));
      await expect(resolveRunModel(manager)).resolves.toEqual({ providerId: "provider-1", modelId: "bot-model" });

      await qrun(getDb().update(agents).set({ aiProvider: null, aiModel: null }).where(eq(agents.id, "nonla-bot")));
      await expect(resolveRunModel({ ...manager, id: "nonla_tool_manager", name: "Tool Manager" })).rejects.toThrow("Nonla Bot has no model set");
    } finally {
      t.cleanup();
    }
  });
});
