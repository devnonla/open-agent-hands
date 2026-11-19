import type { StructuredToolInterface } from "@langchain/core/tools";
import { createMcpServer, deleteMcpServer, getMcpServer, listMcpServers, updateMcpServer } from "../../mcp-servers/mcp-servers.service.js";
import { type Fields, makeManageTool, requireId, requireName, text } from "./helpers.js";

async function handleMcp(action: string, fields: Fields): Promise<unknown> {
  if (action === "list") {
    const result = await listMcpServers({ limit: "100" });
    return result.items.map((server) => ({ id: server.id, name: server.name, url: server.url, isActive: server.isActive }));
  }
  if (action === "get") {
    const server = await getMcpServer(requireId(fields));
    if (!server) throw new Error("MCP server not found");
    return server;
  }
  if (action === "create") {
    const headers = fields.headers && typeof fields.headers === "object" ? (fields.headers as Record<string, string>) : {};
    const created = await createMcpServer({ name: requireName(fields), url: text(fields.url), headers });
    return { id: created.id, name: created.name, url: created.url };
  }
  if (action === "update") {
    const updated = await updateMcpServer(requireId(fields), {
      ...(typeof fields.name === "string" ? { name: fields.name } : {}),
      ...(typeof fields.url === "string" ? { url: fields.url } : {}),
      ...(typeof fields.isActive === "boolean" ? { isActive: fields.isActive } : {}),
      ...(fields.headers && typeof fields.headers === "object" ? { headers: fields.headers as Record<string, string> } : {}),
    });
    return updated ? { id: updated.id, name: updated.name } : null;
  }
  if (action === "delete") {
    const id = requireId(fields);
    await deleteMcpServer(id);
    return { deleted: id };
  }
  throw new Error(`Unknown mcp action "${action}". Use list, get, create, update, delete.`);
}

export function makeManageMcpTool(): StructuredToolInterface {
  return makeManageTool(
    "nonla_manage_mcp_servers",
    `Add, edit, and delete MCP servers.
Actions: list, get, create, update, delete.
create needs name and body.url. Optional body.headers object.
update can set name, url, isActive, headers.
List before update or delete.`,
    handleMcp,
  );
}
