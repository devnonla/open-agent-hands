import { Hono } from "hono";
import { requireAuth } from "../../common/middleware/auth.middleware.js";
import { listNonlaBotToolGroups } from "./nonla-bot-agent.service.js";

const app = new Hono();

app.use("*", requireAuth);

app.get("/tools", async (c) => {
  return c.json(await listNonlaBotToolGroups());
});

export default app;
