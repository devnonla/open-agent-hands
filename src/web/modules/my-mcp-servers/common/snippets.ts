export function slugifyMcpName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mcp-server";
}

export function mcpEndpointUrl(serverId: string): string {
  return `${window.location.origin}/mcp/${serverId}`;
}

export const TOKEN_PLACEHOLDER = "YOUR_TOKEN";

export function mcpServerAgentPrompt(name: string, url: string, token: string, toolNames: string[]): string {
  const slug = slugifyMcpName(name);
  const tools = toolNames.length > 0 ? toolNames.join(", ") : "none yet";
  const tokenNote = token === TOKEN_PLACEHOLDER ? `\n\nBefore you start, ask me for the token and use it in place of ${TOKEN_PLACEHOLDER}. Don't guess it.` : "";
  return `Connect yourself to the "${name}" MCP server from Agent Hands. It gives you these tools: ${tools}.

MCP server
- Name: ${slug}
- Transport: Streamable HTTP
- URL: ${url}
- Header: Authorization: Bearer ${token}

Do this:
1. Add the server to your own MCP config, the way your client normally does it. If you are Claude Code, run:
   claude mcp add --transport http ${slug} ${url} --header "Authorization: Bearer ${token}"
2. Check it works by listing the tools of the ${slug} server. If your client must restart to load a new MCP server, tell me to restart and check again after.
3. Tell me in one line what you set up, or what failed and why.

The token works like a password. Keep it only in your MCP config, and don't repeat it back to me.${tokenNote}`;
}
