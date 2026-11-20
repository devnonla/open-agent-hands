import { Hono } from "hono";
import { ForbiddenException, NotFoundException, UnauthorizedException } from "../../common/exceptions/http.exception.js";
import { type McpServerHandler, handleMcpRequest, methodNotAllowed, readBearer, textResult } from "../../common/mcp/json-rpc.js";
import { runInWorkspace } from "../../common/workspace/workspace-context.js";
import { executeTool } from "../tools/common/tool-runner.js";
import { authenticateMyMcpServer, getAssignedToolForCall, listLiveMcpTools } from "./my-mcp-servers.service.js";

const MCP_TOOL_TIMEOUT_MS = 60_000;

function hostedServer(serverId: string, serverName: string): McpServerHandler {
  return {
    name: serverName,
    listTools: async () => (await listLiveMcpTools(serverId)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    callTool: async (name, args) => {
      const tool = await getAssignedToolForCall(serverId, name);
      if (!tool) return textResult(`Tool not found: ${name}`, true);
      if (!tool.isActive) return textResult(`Tool is inactive: ${name}`, true);
      const raw = await executeTool(tool.id, tool.codeContent, JSON.stringify(args), MCP_TOOL_TIMEOUT_MS);
      try {
        const parsed = JSON.parse(raw) as { ok?: boolean };
        return textResult(JSON.stringify(parsed), parsed.ok !== true);
      } catch {
        return textResult(raw, true);
      }
    },
  };
}

const app = new Hono();

app.get("/:id", () => methodNotAllowed());
app.delete("/:id", () => methodNotAllowed());

app.post("/:id", async (c) => {
  const token = readBearer(c.req.header("authorization"));
  if (!token) throw new UnauthorizedException("Authentication required");

  const auth = await authenticateMyMcpServer(c.req.param("id"), token);
  if (auth === "missing") throw new NotFoundException("MCP server not found");
  if (auth === "unauthorized") throw new UnauthorizedException("Invalid token");
  if (auth === "inactive") throw new ForbiddenException("MCP server is inactive");

  return runInWorkspace(auth.workspaceId, () => handleMcpRequest(c.req.raw, hostedServer(auth.id, auth.name)));
});

export default app;
