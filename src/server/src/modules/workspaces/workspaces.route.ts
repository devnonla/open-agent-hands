import { Hono } from "hono";
import { NotFoundException } from "../../common/exceptions/http.exception.js";
import { requireAuth } from "../../common/middleware/auth.middleware.js";
import { createWorkspace, deleteWorkspace, getWorkspace, listWorkspaces, updateWorkspace } from "./workspaces.service.js";

const app = new Hono();

app.use("*", requireAuth);

app.get("/", async (c) => c.json({ items: await listWorkspaces() }));

app.get("/:id", async (c) => {
  const workspace = await getWorkspace(c.req.param("id"));
  if (!workspace) throw new NotFoundException("Workspace not found");
  return c.json(workspace);
});

app.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await createWorkspace(body), 201);
});

app.put("/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await updateWorkspace(c.req.param("id"), body));
});

app.delete("/:id", async (c) => {
  await deleteWorkspace(c.req.param("id"));
  return c.json({ ok: true });
});

export default app;
