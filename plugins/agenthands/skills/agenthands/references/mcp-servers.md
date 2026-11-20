# Hosted MCP servers

A hosted MCP server exposes a chosen set of tools to an MCP client (Claude Code, Codex, Cursor, Claude Desktop) at `POST /mcp/<server id>`.

- `create_mcp_server(name, tools?)` returns the server and its endpoint path `/mcp/<id>`. The `ra_mcp_...` Bearer key is shown only once in that result. Tell the user to save it. Only a hash is stored, so a lost key cannot be read back; the user rotates it in the UI.
- Full URL: the server's base URL plus the endpoint, for example `http://127.0.0.1:8429/mcp/<id>`.
- Client config for Claude Code:

```bash
claude mcp add --transport http <name> http://127.0.0.1:8429/mcp/<id> --header "Authorization: Bearer <key>"
```

- The client sees each assigned tool with the name (the snake_case `@name`), description and input schema from its header. Good `@description` and `@param` text is what makes the tools usable. See [tools.md](tools.md).
- `add_tools_to_mcp_server` and `remove_tools_from_mcp_server` change the list incrementally. `update_mcp_server` with `tools` REPLACES the whole list, so use it only when you mean that.
- `update_mcp_server active=false` disables the server without deleting it.
- Removing a tool from a server never deletes the tool. Deleting a tool removes it from every server.
- Changes to a tool's code apply to the server immediately. No restart.
- Arguments accept tool names or ids.
- The tool list is configured by agents only. People see it read-only in the UI.
- Separate from this, the Core MCP at `/mcp/core` is the admin server you are using now. Do not expose it to other clients.
