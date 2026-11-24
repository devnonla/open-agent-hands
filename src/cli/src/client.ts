import type { ToolSchema } from "./args.js";
import { CliError, type ResolvedServer } from "./config.js";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type RemoteTool = { name: string; description: string; inputSchema: ToolSchema; _meta?: Record<string, unknown> };

export type ToolCallResult = { text: string; isError: boolean };

let rpcId = 0;

export function coreEndpoint(url: string): string {
  return `${url}/mcp/core`;
}

async function rpc<T>(fetchFn: FetchFn, server: Pick<ResolvedServer, "name" | "url" | "key">, method: string, params: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(coreEndpoint(server.url), {
      method: "POST",
      headers: { Authorization: `Bearer ${server.key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
  } catch (err) {
    throw new CliError(`Cannot reach ${server.name} at ${server.url}: ${err instanceof Error ? err.message : String(err)}. Is the server running?`);
  }
  if (res.status === 401) throw new CliError(`${server.name} (${server.url}) rejected the key. It may have been rotated: copy the Core MCP key again from ${server.url}/connect and run oahctl login ${server.url} --name ${server.name}.`);
  const body = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
  if (!res.ok || !body) throw new CliError(`${server.name} (${server.url}) answered HTTP ${res.status} at ${coreEndpoint(server.url)}. Is this an Agent Hands server?`);
  if (body.error) throw new CliError(`${server.name}: ${body.error.message ?? "JSON-RPC error"}`);
  return body.result as T;
}

export async function listRemoteTools(fetchFn: FetchFn, server: Pick<ResolvedServer, "name" | "url" | "key">): Promise<RemoteTool[]> {
  return (await rpc<{ tools: RemoteTool[] }>(fetchFn, server, "tools/list", {})).tools;
}

export async function callRemoteTool(fetchFn: FetchFn, server: Pick<ResolvedServer, "name" | "url" | "key">, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const result = await rpc<{ content?: { text?: string }[]; isError?: boolean }>(fetchFn, server, "tools/call", { name, arguments: args });
  return { text: (result.content ?? []).map((c) => c.text ?? "").join("\n"), isError: result.isError === true };
}

export async function callOrThrow(fetchFn: FetchFn, server: Pick<ResolvedServer, "name" | "url" | "key">, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await callRemoteTool(fetchFn, server, name, args);
  if (result.isError) throw new CliError(result.text);
  try {
    return JSON.parse(result.text);
  } catch {
    return result.text;
  }
}
