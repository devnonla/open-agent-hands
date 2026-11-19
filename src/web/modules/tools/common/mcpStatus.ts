import type { McpServer, McpServerTool } from "src/common/types";
import type { McpStatusTone } from "src/modules/mcp-servers/components/McpServerListItem";

export const STATUS_META: Record<McpStatusTone, { label: string; dot: string; pill: string }> = {
  live: { label: "Connected", dot: "bg-success", pill: "bg-success/10 text-success" },
  error: { label: "Sync failed", dot: "bg-destructive", pill: "bg-destructive/10 text-destructive" },
  off: { label: "Disabled", dot: "bg-muted-foreground", pill: "bg-muted text-muted-foreground" },
};

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function toolMatches(tool: McpServerTool, q: string): boolean {
  return tool.name.toLowerCase().includes(q) || (tool.description ?? "").toLowerCase().includes(q);
}

export function serverMatches(server: McpServer, q: string): boolean {
  return server.name.toLowerCase().includes(q) || server.url.toLowerCase().includes(q);
}

/** Tools to show for a search: all of them when the server itself matches, else only matching tools. */
export function matchingTools(server: McpServer, q: string): McpServerTool[] {
  const all = server.tools ?? [];
  if (!q || serverMatches(server, q)) return all;
  return all.filter((t) => toolMatches(t, q));
}
