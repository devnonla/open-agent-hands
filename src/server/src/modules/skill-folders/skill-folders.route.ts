import { Hono } from "hono";
import { createSkillFolder, deleteSkillFolder, listSkillFolders, reorderSkillFolders, updateSkillFolder } from "./skill-folders.service.js";

const app = new Hono();

app.get("/", async (c) => {
  return c.json(await listSkillFolders(c.req.query()));
});

app.post("/", async (c) => {
  const body = await c.req.json<{ name: string; description?: string }>();
  return c.json(await createSkillFolder(body), 201);
});

app.put("/reorder", async (c) => {
  const body = await c.req.json<{ folderIds: string[] }>();
  return c.json(await reorderSkillFolders(body.folderIds ?? []));
});

app.put("/:id", async (c) => {
  const body = await c.req.json();
  return c.json(await updateSkillFolder(c.req.param("id"), body));
});

app.delete("/:id", async (c) => {
  await deleteSkillFolder(c.req.param("id"));
  return c.json({ ok: true });
});

export default app;
