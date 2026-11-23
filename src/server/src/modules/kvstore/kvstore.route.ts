import { Hono } from "hono";
import { BadRequestException } from "../../common/exceptions/http.exception.js";
import { requireAuth } from "../../common/middleware/auth.middleware.js";
import { createKvEntry, createKvProject, deleteKvEntry, deleteKvProject, getKvEntry, listKvEntries, listKvProjects, requireKvProjectId, updateKvEntry, updateKvProject } from "./kvstore.service.js";

const app = new Hono();

app.use("*", requireAuth);

app.get("/projects", async (c) => c.json(await listKvProjects()));

app.post("/projects", async (c) => {
  const body = await c.req.json();
  return c.json(await createKvProject(body), 201);
});

app.put("/projects/:id", async (c) => {
  const body = await c.req.json();
  return c.json(await updateKvProject(c.req.param("id"), body));
});

app.delete("/projects/:id", async (c) => c.json(await deleteKvProject(c.req.param("id"))));

app.get("/", async (c) => c.json(await listKvEntries(c.req.query())));

app.get("/:id", async (c) => {
  const entry = await getKvEntry(c.req.param("id"));
  if (!entry) throw new BadRequestException("KV entry not found");
  return c.json(entry);
});

app.post("/", async (c) => {
  const body = await c.req.json<{ key: string; value: string; description?: string | null; project?: string | null }>();
  return c.json(await createKvEntry({ ...body, projectId: await requireKvProjectId(body.project) }), 201);
});

app.put("/:id", async (c) => {
  const body = await c.req.json();
  return c.json(await updateKvEntry(c.req.param("id"), body));
});

app.delete("/:id", async (c) => {
  await deleteKvEntry(c.req.param("id"));
  return c.json({ ok: true });
});

export default app;
