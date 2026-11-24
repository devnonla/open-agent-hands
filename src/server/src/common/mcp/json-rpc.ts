import rootPkg from "../../../../../package.json" with { type: "json" };

const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: object;
  _meta?: Record<string, unknown>;
};

export type McpToolResult = { content: { type: "text"; text: string }[]; isError: boolean };

export type McpServerHandler = {
  name: string;
  instructions?: string;
  listTools: () => Promise<McpToolDescriptor[]>;
  callTool: (name: string, args: Record<string, unknown>, request?: Request) => Promise<McpToolResult>;
};

export function textResult(text: string, isError = false): McpToolResult {
  return { content: [{ type: "text", text }], isError };
}

export function readBearer(header: string | undefined): string | null {
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined || (typeof req.method === "string" && req.method.startsWith("notifications/"));
}

async function handleMethod(server: McpServerHandler, req: JsonRpcRequest, request: Request): Promise<unknown> {
  const params = req.params ?? {};
  switch (req.method) {
    case "initialize":
      return {
        protocolVersion: typeof params.protocolVersion === "string" && SUPPORTED_PROTOCOL_VERSIONS.has(params.protocolVersion) ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: server.name, version: rootPkg.version },
        ...(server.instructions ? { instructions: server.instructions } : {}),
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: await server.listTools() };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) return textResult("Tool name is required", true);
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      return await server.callTool(name, args, request);
    }
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    default:
      return undefined;
  }
}

async function handleOne(server: McpServerHandler, req: JsonRpcRequest, request: Request): Promise<object | null> {
  if (isNotification(req)) return null;
  const id = req.id ?? null;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return rpcError(id, -32600, "Invalid Request");
  try {
    const result = await handleMethod(server, req, request);
    if (result === undefined) return rpcError(id, -32601, `Method not found: ${req.method}`);
    return rpcResult(id, result);
  } catch (err) {
    return rpcError(id, -32603, err instanceof Error ? err.message : String(err));
  }
}

export async function handleMcpRequest(request: Request, server: McpServerHandler): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  if (Array.isArray(body)) {
    const responses: object[] = [];
    for (const item of body) {
      const res = await handleOne(server, (item ?? {}) as JsonRpcRequest, request);
      if (res) responses.push(res);
    }
    return responses.length > 0 ? Response.json(responses) : new Response(null, { status: 202 });
  }
  const res = await handleOne(server, (body ?? {}) as JsonRpcRequest, request);
  return res ? Response.json(res) : new Response(null, { status: 202 });
}

export function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
