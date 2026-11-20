# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Agent Hands (`agenthands`) is a local, single-binary server for **tools, MCP, KV, secrets, datatables and cron jobs**. AI coding agents (Claude Code, Codex) connect to it over MCP. Stack: Bun + Hono API, React 19/Vite UI, SQLite via Drizzle. Bun workspaces are `src/server` and `src/web`. Requires Bun ≥ 1.4.3.

It has no in-app LLM agents. The agent, chat, provider, skill and team features, the outbound remote MCP client, multi-user management and roles, plus Postgres and Docker, were removed on purpose. It is single-user: one account created at `/setup`, and every authenticated request has full access. Don't reintroduce them.

## Product principle: agent-first, human-observes

Agent Hands is built **for AI agents to use, not for people to operate**. Agents (Claude Code, Codex) create and change things through the Core MCP (`/mcp/core`). The web UI is mainly for people to **watch, inspect and correct**. Apply this to every feature:

- **Every capability is an MCP tool first.** A new feature is not done until the Core MCP can do it (`modules/core-mcp/core-mcp.tools.ts`). The UI is optional.
- **The UI does not create agent-authored resources.** There are no "New tool / New site / New job / New MCP server" buttons. Empty states point to the matching Core MCP tool (`AskClaudeHint`). The UI keeps view, inspect, edit, toggle and delete.
- **Config agents write is read-only in the UI.** This covers job schedules, datatable structure and the tools on a hosted MCP server. Show it in plain words, with switches to pause or resume (for example a job's `enabled`), never an editor for it.
- **Humans still enter things an agent should not see or invent.** Secrets, KV values, datatable rows, workspaces, folders and settings stay editable in the UI. Never require secret values to pass through chat.
- **Optimize the agent's experience.** Tool names are predictable (`verb_noun`, grouped by prefix). Arguments accept names as well as ids. Results are compact JSON. Errors are explicit, set `isError`, and say how to fix the call. `get_guide` documents how to write tools, jobs and sites. Long or side-effecting actions say so in their description.
- **Fail loudly and safely.** Destructive tools need `confirm=true`. Agents must never silently fall back to something they did not ask for (e.g. `requestedLanguageMatched`).

## Commands

```bash
bun install
bun run dev                    # server :18429 (data ~/.open-agent-hands-dev, bun --watch) + Vite HMR http://localhost:18430 (proxies /api, /ws, /mcp). Port 8429 (the binary default) and ~/.open-agent-hands stay free for the installed binary.
bun run build                  # vite build web, then compile single binary → dist/agenthands
bun run build:binary:all       # cross-compile dist/agenthands-{darwin,linux}-{arm64,x64}
bun run build:desktop          # binary + Tauri app → desktop/src-tauri/target/release/bundle/{macos,dmg} (needs Rust; --skip-binary, --debug)
bun run start                  # run server from source
bun run test                   # bun test src/server/src/__tests__/
bun test src/server/src/__tests__/tools.test.ts -t "name"   # single file / test
bun run lint                   # biome lint (web only)
bun run typecheck              # web (cd src/web && bun check)
bun run typecheck:server       # server (cd src/server && bun check)
```

CI (`.github/workflows/ci.yml`) runs lint, both typechecks and tests. Use Conventional Commits (`feat(scope): …`) and branches named `feat/`, `fix/`, `docs/`, `refactor/` or `chore/`.

**Releasing:** always follow the `release` skill (`.claude/skills/release/SKILL.md`), every gate, in order. Pushing a `v*` tag runs `release.yml`:
- an ubuntu job builds the 4 binaries and `install.sh`, and creates the release with notes taken from the matching `CHANGELOG.md` section;
- a `macos-latest` job reuses the darwin binaries from that job and adds `OpenAgentHands-darwin-{arm64,x64}.app.tar.gz`.

Dry-run with `gh workflow run Release --ref main` before tagging. Never retag a published release; fix forward with a patch.

**This machine runs the official install:** `/Applications/Open Agent Hands.app` on 8429 with real data in `~/.open-agent-hands`, plus `~/.local/bin/agenthands` symlinked into the app. Never smoke-test against those; use a spare port and `--data-dir` in the scratchpad. `bun run build` briefly rewrites `embedded-assets.ts`, which can kill a running `bun run dev`, so restart dev afterwards. Dev builds show a purple DEV badge and a `[DEV]` title (`IS_DEV_BUILD` in `components/AppLogo.tsx`).

## Architecture

### Server (`src/server/src`)
- `index.ts` is the CLI entry (`--port/--host/--data-dir`). It runs `initDb` (applies migrations), then `startJobsScheduler`, then `createAppServer` (`common/ws/create-app-server.ts`: Bun HTTP + `/ws` WebSocket for UI live updates via `wsHub`). `app.ts` mounts the routers and serves the SPA.
- Feature code lives in `modules/<feature>/*.route.ts` + `*.service.ts`. The features are tools, tool-folders, my-mcp-servers (hosted MCP), sites, kvstore, secrets, datatables, jobs, settings, auth, api-keys and v1.
- **Core MCP** (`modules/core-mcp/`): a built-in admin MCP server at `POST /mcp/core`, authenticated with a single `ah_core_…` Bearer key. The key is generated on first use and stored encrypted in `configurations.core_mcp_key`; `/api/core-mcp` shows it and `/api/core-mcp/rotate` replaces it. `core-mcp.tools.ts` is the tool catalog. Each tool takes an optional `workspace` (id or name, default `default`) and runs the existing services inside `runInWorkspace`. `core-mcp-guide.ts` holds the authoring guide that `get_guide` returns. When you add a feature, add matching core tools.
- **MCP plumbing**: `common/mcp/json-rpc.ts` is the shared stateless JSON-RPC/Streamable-HTTP handler used by both Core MCP and hosted MCP servers.
- **Hosted MCP**: `modules/my-mcp-servers/mcp-http.route.ts` is a stateless JSON-RPC Streamable HTTP endpoint at `POST /mcp/:id`, authenticated with a per-server `ra_mcp_…` Bearer key. It exposes the tools assigned to that server and runs them through `executeTool`.
- **Tool execution**: `modules/tools/common/tool-runner.ts` writes the tool code into a per-tool sandbox dir under `DATA_DIR`. It `bun add`s any detected imports, then spawns `process.execPath` wrapped by `common/sandbox` (bubblewrap on Linux, Seatbelt on macOS, otherwise unsandboxed). Tool metadata and the JSON schema come from `// @name`, `// @description` and `// @param` annotations (`common/code-annotations.ts`).
- **Runtime SDK**: tools and jobs import `@agenthands/runtime` (`tools/common/runtime-sdk.ts`, `jobs/jobs-runtime-sdk.ts`); `@nonla-agents/runtime` and `nonlaagents` are written as legacy aliases. It's generated into the sandbox's `node_modules` and talks to a localhost RPC proxy (`runtime-proxy.ts`) for kv, secrets and datatable access.
- **Sites** (`modules/sites/`): React sites made of `app.tsx`, `backend.ts`, `styles.css` and `package.json`, edited as a draft tree and promoted to prod with approve. `sites-bundle.ts` bundles `app.tsx` with `Bun.build`; `sites-deps.ts` installs npm imports. `backend.ts` exports `handle({ request, params, query, agenthands, nonlaagents })` and runs in a subprocess (`sites-backend-runner.ts` → `sites-backend-worker.ts`). A compiled binary runs that worker by re-invoking itself with `__sites-backend-worker` (see `index.ts`). Published sites are served at `/public/sites/:slug`, optionally behind a password, with data and actions under `/api/public/sites/:slug`. Files live in `{DATA_DIR}/sites/<id>/`, with the draft tree in `draft/`.
- **Jobs**: cron scripts run by `jobs-runner.ts` with `process.execPath run main.ts`. `jobs-scheduler.ts` claims due jobs through lease columns.

### Workspaces
- Resources (tools, tool folders, hosted MCP servers, KV, secrets, datatable projects, jobs, sites, API keys) carry `workspace_id`. Users and settings are global. The `default` workspace always exists and cannot be deleted. Names and keys are unique per workspace, but site slugs are global because public URLs have no workspace.
- The current workspace lives in an `AsyncLocalStorage` context (`common/workspace/workspace-context.ts`). Services read it via `currentWorkspaceId()` and filter with `inWorkspace(table.workspaceId)` (`common/workspace/scope.ts`). New scoped queries and inserts must do the same.
- How each entry point picks the workspace:
  - UI routes use `resolveWorkspace`, which reads `X-Workspace-Id`, then `?workspaceId`, then the `agenthands_workspace` cookie, then `default`.
  - `/api/v1` uses the API key's workspace.
  - `/mcp/:id` uses the MCP server's workspace.
  - Public sites look up the slug globally (`runInSiteWorkspace`).
  - The runtime proxy records the workspace when it starts.
  - The jobs scheduler runs each due job inside its own workspace.
- WebSocket events are tagged with the emitting workspace, and clients only receive their own (`workspace:select` message). The web app stores the selection in localStorage and the cookie (`src/web/common/workspace.ts`), and `WorkspaceGuard` redirects to `/workspaces` until one is chosen.

### Single binary
- `scripts/build-binary.ts` generates `src/server/src/embedded-assets.ts`, which imports every `src/web/dist` file with `{ type: "file" }`. It then runs `bun build --compile` and restores the empty stub. Keep the stub committed as an empty map; `app.ts` falls back to `src/web/dist` on disk when the map is empty.
- Child processes run the binary itself as Bun by setting `BUN_BE_BUN=1` (`common/sandbox/env.ts`, `jobs-runner.ts`). Always spawn `process.execPath`, never a bare `bun`.
- Migrations are embedded via `import … with { type: "text" }` in `common/db/migrations/index.ts`. A new migration needs a new `00NN_name.sql` **and** an entry in that index.

### Desktop app (`desktop/`)
- Tauri v2 shell in Rust (`desktop/src-tauri/src/main.rs`). It is not a Bun workspace. It bundles `dist/agenthands` as a sidecar (`externalBin`, copied to `src-tauri/binaries/agenthands-<rust-triple>` by `scripts/build-desktop.ts`).
- On launch it checks `GET /api/health` on 8429. It reuses a running agenthands, refuses if another app holds the port, and otherwise spawns the sidecar with stdout/stderr going to `~/.open-agent-hands/logs/server.log`. The window shows `desktop/ui/index.html` until the server is healthy, then navigates to `http://127.0.0.1:8429`.
- There is a menu bar tray with Open, Open in Browser, Start at Login (`tauri-plugin-autostart`) and Quit, plus single-instance. Closing the window hides it. Quit sends SIGTERM to the sidecar only if the app started it.
- Keep it thin: features belong in the server and web UI, not in the shell.

### Database
SQLite only (`bun:sqlite`, `{DATA_DIR}/data.db`, WAL). The schema is in `common/db/schema.ts`, using the helpers in `common/db/columns.ts`: timestamps as unix-second integers, JSON as TEXT, booleans as integers. Tests run the real migrations on an in-memory DB (`__tests__/test-helpers.ts`). Datatable filtering uses SQLite `json_extract` / `json_each` (`datatable-where.util.ts`).

### Web (`src/web`)
Feature modules live in `modules/<feature>/` and mirror the server. Shared API client, types and hooks are in `common/`; the Redux Toolkit store is in `store/` (`BaseReducer` CRUD slices). The UI uses `devnonla-ui` + Tailwind. Biome uses 2-space indent and a 320-column line width, and runs only on `src/web`.

## Conventions
- Don't write code comments; the code is the source of truth.
- Web UI: `devnonla-ui` + Tailwind utilities only, with no custom `.css` files beyond `index.css`.
- Web data fetching:
  - List pages make one list request. Counts come from `*Count` fields aggregated server-side, never from per-item child GETs.
  - List DTOs stay lean, and detail views fetch their own `GET /:id`.
  - After a create, update or delete, patch the Redux list from the response or WS event instead of refetching.
  - Handle loading, empty and error states.
- Web structure: a thin page container in `modules/<feature>/`, with `common/` (slice, api, types), feature-only `components/`, and an `[id]/` detail subtree. `src/web/src/components/` holds only components shared across features.

## Data dir
`DATA_DIR` defaults to `~/.open-agent-hands`. Layout:
- `data.db`: SQLite. Tool and job code lives here.
- `workspaces/<workspace-id>/`:
  - `tools/<tool-id>/`: tool sandbox (generated, can be deleted)
  - `sites/<site-id>/`: site source with a `draft/` subfolder; this is the only code stored on disk
  - `job_runs/<run-id>/`: temporary, removed after each run

Build paths with `common/workspace/workspace-paths.ts`, never by hand. Deleting a workspace removes its folder. `legacy-layout.ts` moves the pre-workspace `sites/` and `tool_envs/` folders at startup. `bunfig.toml` preloads `__tests__/preload.ts`, which points `DATA_DIR` at a temp folder so tests never write to the real data dir.
