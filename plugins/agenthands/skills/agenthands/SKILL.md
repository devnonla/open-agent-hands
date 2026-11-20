---
name: agenthands
description: Work with an Agent Hands server through its Core MCP (tools mcp__agenthands__*). Covers writing tools (// @name, // @description, // @param header), cron jobs, sites, datatables, hosted MCP servers, KV, secrets, workspaces and the @agenthands/runtime SDK. Use before calling create_tool, update_tool, create_job, create_site, write_site_file, datatable_*, create_mcp_server, kv_set, secret_set or create_workspace, or when writing code that imports @agenthands/runtime.
---

# Agent Hands

Agent Hands is a local server that agents control through the Core MCP. Every resource tool takes an optional `workspace` (id or name, default `default`); call `list_workspaces` when unsure.

Read the reference for what you are about to do, before the first call. Each one has the exact format.

| You want to | Read |
|---|---|
| Write or change a tool (a TypeScript function agents can call) | [references/tools.md](references/tools.md) |
| Run a script on a schedule | [references/jobs.md](references/jobs.md) |
| Build a web page with a backend | [references/sites.md](references/sites.md) |
| Store structured rows, query them | [references/datatables.md](references/datatables.md) |
| Expose tools to an MCP client | [references/mcp-servers.md](references/mcp-servers.md) |
| Store a plain setting | [references/kv.md](references/kv.md) |
| Store a token or password | [references/secrets.md](references/secrets.md) |
| Create, pick or delete a workspace | [references/workspaces.md](references/workspaces.md) |
| Use kv, secrets or datatables inside tool, job or site code | [references/runtime.md](references/runtime.md) |

How to work:
- Look first (`list_tools`, `list_jobs`, `datatable_get_schema`, `get_site_files`), then create or change. Reuse what exists.
- Test before you report done: `run_tool`, `run_job wait=true`, `preview_site`. Read the logs and fix failures.
- Errors name the problem and the fix. Read them before retrying, and don't retry the same call.
- After creating something, say in one line what you made and how to use it.

Rules everywhere:
- Destructive tools need `confirm=true`. Ask the user before deleting.
- Errors say how to fix the call. Read them before retrying.
- Never put secret values through chat. Ask the user to add them in the web UI and reference the key.
- The web UI is for people to watch and correct what you build. Create and change things with the tools.
