import { Hono } from "hono";
import { UnauthorizedException } from "../../common/exceptions/http.exception.js";
import { handleMcpRequest, methodNotAllowed, readBearer } from "../../common/mcp/json-rpc.js";
import { requireAuth } from "../../common/middleware/auth.middleware.js";
import { getCoreMcpKey, rotateCoreMcpKey, verifyCoreMcpKey } from "./core-mcp-key.service.js";
import { coreMcpServer, listCoreToolGroups } from "./core-mcp.tools.js";

export const CORE_MCP_PATH = "/mcp/core";

export const coreMcpEndpoint = new Hono();

coreMcpEndpoint.get("/", () => methodNotAllowed());
coreMcpEndpoint.delete("/", () => methodNotAllowed());

coreMcpEndpoint.post("/", async (c) => {
  const token = readBearer(c.req.header("authorization"));
  if (!token || !(await verifyCoreMcpKey(token))) throw new UnauthorizedException("Invalid core MCP key");
  return handleMcpRequest(c.req.raw, coreMcpServer);
});

export const coreMcpAdmin = new Hono();

coreMcpAdmin.use("*", requireAuth);

coreMcpAdmin.get("/", async (c) => {
  const groups = listCoreToolGroups();
  return c.json({ path: CORE_MCP_PATH, key: await getCoreMcpKey(), toolCount: groups.reduce((sum, g) => sum + g.tools.length, 0), groups });
});

coreMcpAdmin.post("/rotate", async (c) => c.json({ path: CORE_MCP_PATH, key: await rotateCoreMcpKey() }));
