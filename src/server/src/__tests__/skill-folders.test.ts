import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { authRequest, createTestApp, setupAdmin } from "./test-helpers.js";

describe("Skill Folders API", () => {
  let app: Hono;
  let cleanup: () => void;
  let token: string;
  let folderId = "";

  beforeAll(async () => {
    const t = await createTestApp();
    app = t.app;
    cleanup = t.cleanup;
    const admin = await setupAdmin(app);
    token = admin.token;
  });

  afterAll(() => cleanup());

  test("POST /api/skill-folders — create folder", async () => {
    const res = await authRequest(app, token, "POST", "/api/skill-folders", {
      name: "Research",
      description: "Lookup playbooks",
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.name).toBe("Research");
    expect(data.description).toBe("Lookup playbooks");
    expect(data.id).toBeTruthy();
    folderId = data.id as string;
  });

  test("POST /api/skill-folders — reject empty name", async () => {
    const res = await authRequest(app, token, "POST", "/api/skill-folders", { name: "   " });
    expect(res.status).toBe(400);
  });

  test("GET /api/skill-folders — list folders with skillIds", async () => {
    const res = await authRequest(app, token, "GET", "/api/skill-folders");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { items: { name: string; skillIds: unknown }[] };
    const research = data.items.find((item) => item.name === "Research");
    expect(research).toBeTruthy();
    expect(Array.isArray(research?.skillIds)).toBe(true);
  });

  test("POST /api/skills — create skill inside folder", async () => {
    const res = await authRequest(app, token, "POST", "/api/skills", {
      name: "web-research",
      description: "Look up sources before answering",
      content: "Cite sources.",
      folderId,
    });
    expect(res.status).toBe(201);
    const skill = (await res.json()) as { id: string; folderId: string };
    expect(skill.folderId).toBe(folderId);

    const listRes = await authRequest(app, token, "GET", "/api/skill-folders");
    const list = (await listRes.json()) as { items: { id: string; skillIds: string[] }[] };
    const folder = list.items.find((item) => item.id === folderId);
    expect(folder?.skillIds).toContain(skill.id);
  });

  test("POST /api/skills — reject unknown folder", async () => {
    const res = await authRequest(app, token, "POST", "/api/skills", {
      name: "missing-folder",
      description: "Should fail",
      folderId: "does-not-exist",
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/skills/:id — move skill out of folder", async () => {
    const createRes = await authRequest(app, token, "POST", "/api/skills", {
      name: "move-me",
      description: "Will leave the folder",
      folderId,
    });
    const skill = (await createRes.json()) as { id: string };
    const res = await authRequest(app, token, "PUT", `/api/skills/${skill.id}`, { folderId: null });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { folderId: string | null };
    expect(updated.folderId).toBeNull();
  });

  test("PUT /api/skill-folders/:id — rename folder", async () => {
    const res = await authRequest(app, token, "PUT", `/api/skill-folders/${folderId}`, {
      name: "Writing",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { name: string };
    expect(data.name).toBe("Writing");
  });

  test("PUT /api/skill-folders/reorder — reorder folders", async () => {
    const aRes = await authRequest(app, token, "POST", "/api/skill-folders", { name: "Alpha" });
    const bRes = await authRequest(app, token, "POST", "/api/skill-folders", { name: "Beta" });
    const a = (await aRes.json()) as { id: string };
    const b = (await bRes.json()) as { id: string };

    const reorderRes = await authRequest(app, token, "PUT", "/api/skill-folders/reorder", {
      folderIds: [b.id, a.id, folderId],
    });
    expect(reorderRes.status).toBe(200);

    const listRes = await authRequest(app, token, "GET", "/api/skill-folders");
    const list = (await listRes.json()) as { items: { id: string; sortOrder: number }[] };
    const userFolders = list.items.filter((folder) => folder.id !== "builtin");
    expect(userFolders.map((folder) => folder.id)).toEqual([b.id, a.id, folderId]);
    expect(userFolders.map((folder) => folder.sortOrder)).toEqual([0, 1, 2]);
  });

  test("DELETE /api/skill-folders/:id — delete folder clears skill folderId", async () => {
    const createRes = await authRequest(app, token, "POST", "/api/skill-folders", { name: "Temp" });
    const temp = (await createRes.json()) as { id: string };
    const skillRes = await authRequest(app, token, "POST", "/api/skills", {
      name: "temp-skill",
      description: "Leaves with the folder",
      folderId: temp.id,
    });
    const skill = (await skillRes.json()) as { id: string };

    const res = await authRequest(app, token, "DELETE", `/api/skill-folders/${temp.id}`);
    expect(res.status).toBe(200);

    const getRes = await authRequest(app, token, "GET", `/api/skills/${skill.id}`);
    const updated = (await getRes.json()) as { folderId: string | null };
    expect(updated.folderId).toBeNull();
  });
});
