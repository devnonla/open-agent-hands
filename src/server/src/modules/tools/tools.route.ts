import { Hono } from "hono";
import { BadRequestException } from "../../common/exceptions/http.exception.js";
import { createTool, deleteTool, getTool, listTools, reorderTools, runTool, updateTool } from "./tools.service.js";

const app = new Hono();

// GET /api/tools?page=1&limit=50&sorts=-createdAt
app.get("/", async (c) => {
  return c.json(await listTools(c.req.query()));
});

// PUT /api/tools/reorder — persist kanban order within a folder (or ungrouped)
app.put("/reorder", async (c) => {
  const body = await c.req.json<{ folderId?: string | null; toolIds?: string[] }>();
  return c.json(await reorderTools(body.folderId ?? null, body.toolIds ?? []));
});

// GET /api/tools/:id
app.get("/:id", async (c) => {
  const row = await getTool(c.req.param("id"));
  if (!row) throw new BadRequestException("Not found");
  return c.json(row);
});

// POST /api/tools
app.post("/", async (c) => {
  const body = await c.req.json();
  return c.json(await createTool(body), 201);
});

// PUT /api/tools/:id
app.put("/:id", async (c) => {
  const body = await c.req.json();
  return c.json(await updateTool(c.req.param("id"), body));
});

app.post("/:id/run", async (c) => {
  const body = await c.req.json<{ input?: Record<string, unknown>; code?: string }>().catch(() => ({}) as { input?: Record<string, unknown>; code?: string });
  const result = await runTool(c.req.param("id"), JSON.stringify(body.input ?? {}), body.code);
  if (!result) throw new BadRequestException("Not found");
  return c.json(result);
});

// DELETE /api/tools/:id
app.delete("/:id", async (c) => {
  await deleteTool(c.req.param("id"));
  return c.json({ ok: true });
});

export default app;
