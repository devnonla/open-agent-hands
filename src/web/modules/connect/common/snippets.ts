export const CLI_INSTALL_COMMAND = "curl -fsSL https://github.com/devnonla/open-agent-hands/releases/latest/download/install.sh | AGENTHANDS_CLI_ONLY=1 sh";

export function cliLoginCommand(server: string, key: string): string {
  return `oahctl login ${server} ${key}`;
}

export function cliAgentPrompt(server: string, key: string): string {
  return `Connect yourself to Agent Hands, my server for tools, hosted MCP servers, KV, secrets, datatables, storage, sites and cron jobs. You use it through the oahctl command line.

Do this:
1. If oahctl --version fails, install it:
   ${CLI_INSTALL_COMMAND}
   It needs Node 18+ (or run it with bun). If ~/.local/bin is not on PATH, call ~/.local/bin/oahctl.
2. Log in to this server:
   ${cliLoginCommand(server, key)}
3. Check it with oahctl servers, then oahctl list_tools.
4. If you are Claude Code, install the Agent Hands skill, which has the exact formats for tools, jobs and sites:
   claude plugin marketplace add devnonla/open-agent-hands
   claude plugin install agenthands@agenthands
   Then add "Bash(oahctl:*)" to permissions.allow in ~/.claude/settings.json so I am not asked for every call.
5. Tell me in one line what you set up, or what failed and why.

Using it: every Agent Hands tool is a command with the same name. oahctl help lists them and oahctl help <tool> shows the arguments. Results are JSON on stdout. If more than one server is saved, pass -s <name>, or ask me which one.

The key works like a password. Don't repeat it back to me.`;
}

export function coreMcpAgentPrompt(url: string, key: string): string {
  return `Connect yourself to Agent Hands, my local server for tools, hosted MCP servers, KV, secrets, datatables, sites and cron jobs.

MCP server
- Name: agenthands
- Transport: Streamable HTTP
- URL: ${url}
- Header: Authorization: Bearer ${key}

Do this:
1. Add the server to your own MCP config, available in all my projects, the way your client normally does it. If you are Claude Code, run:
   claude mcp add --transport http agenthands ${url} --scope user --header "Authorization: Bearer ${key}"
2. If you are Claude Code, also install the Agent Hands skill, which has the exact formats for tools, jobs and sites:
   claude plugin marketplace add devnonla/open-agent-hands
   claude plugin install agenthands@agenthands
3. Check the connection by calling the list_tools tool. If your client must restart to load a new MCP server, tell me to restart and check again after.
4. Tell me in one line what you set up, or what failed and why.

The key works like a password. Keep it only in your MCP config, and don't repeat it back to me.`;
}

export function maskKey(key: string): string {
  return `${key.slice(0, 12)}${"•".repeat(16)}${key.slice(-4)}`;
}
