# Agent Hands

A local server for **tools, MCP, KV and datatables** that AI coding agents (Claude Code, Codex, …) connect to over MCP.

It ships as one binary. Data lives in SQLite, and the web UI is built in. You don't need Docker or a database server.

## Install

```bash
curl -fsSL https://github.com/devnonla/open-agent-hands/releases/latest/download/install.sh | sh
agenthands
```

Then open http://127.0.0.1:8429 and create your account (single user, no roles).

`install.sh` reads these environment variables: `AGENTHANDS_REPO` (`owner/name`), `AGENTHANDS_VERSION` (`v0.5.0`, default `latest`) and `AGENTHANDS_INSTALL_DIR` (default `~/.local/bin`).

```
agenthands [-p|--port 8429] [-H|--host 127.0.0.1] [-d|--data-dir ~/.open-agent-hands]
```

## Features

- **Workspaces**: every resource belongs to a workspace. A `Default` workspace always exists; you pick one when you open the app, and you can create, rename or delete others.
- **Tools**: TypeScript/Bun functions, grouped in folders. Each one runs in an OS sandbox (bubblewrap on Linux, Seatbelt on macOS) and installs npm packages automatically from its imports.
- **Hosted MCP**: pick a set of tools and serve them at `/mcp/<id>` (Streamable HTTP, Bearer key).
- **KV store, secrets, datatables**: workspace storage. Tools and jobs reach it through `@agenthands/runtime`; scoped API keys reach it through `/api/v1`.
- **Sites**: small React sites (`app.tsx` + `backend.ts`) with a draft/approve flow. Publish them at `/public/sites/<slug>`, optionally behind a password.
- **Jobs**: Bun/TypeScript scripts on a cron schedule, with run logs.

## Connect Claude Code

**Core MCP (recommended).** It lets Claude Code or Codex manage everything: workspaces, tools, hosted MCP servers, KV, secrets, datatables, sites and jobs. Open **MCP Servers** in the UI and copy the command from the **Core MCP** card:

```bash
claude mcp add --transport http agenthands http://127.0.0.1:8429/mcp/core --header "Authorization: Bearer <core-key>"
```

**Workspace MCP servers.** These expose only the tools you pick, which suits sharing a narrow set of tools:

In the UI, open **MCP Servers**, create a server, assign tools to it and copy its key. Then run:

```bash
claude mcp add --transport http agenthands http://127.0.0.1:8429/mcp/<server-id> --header "Authorization: Bearer <key>"
```

## Data

Everything lives under `--data-dir` (default `~/.open-agent-hands`):

```
data.db                         SQLite: workspaces, tool/job code, KV, secrets, datatables
workspaces/<id>/tools/<tool>/   tool sandboxes (regenerated on demand)
workspaces/<id>/sites/<site>/   site source (+ draft/)
```

To back up, copy `data.db` and `workspaces/`.

| Variable   | Default             |
| ---------- | ------------------- |
| `PORT`     | `8429`              |
| `HOST`     | `127.0.0.1`         |
| `DATA_DIR` | `~/.open-agent-hands`   |

## Develop

You need [Bun](https://bun.sh/) ≥ 1.4.3.

```bash
bun install
bun run dev              # API :8429 + Vite HMR http://localhost:5173
bun run build            # web + single binary → dist/agenthands
bun run test
```

`bun run build:binary:all` cross-compiles `dist/agenthands-{darwin,linux}-{arm64,x64}`. Pushing a `v*` tag runs `.github/workflows/release.yml`, which publishes those binaries and `install.sh` to a GitHub release.

## License

[MIT](LICENSE)
