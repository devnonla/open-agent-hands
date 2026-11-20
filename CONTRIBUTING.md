# Developing Open Agent Hands

This guide is for people who want to change Open Agent Hands, send a pull request or ship their own fork. If you only want to use it, see the [README](README.md).

## Before you start: agents first

Open Agent Hands is built **for AI agents to use**. People mostly watch. Every change follows from that:

- **A feature is an MCP tool first.** It is not done until an agent can do it through the Core MCP (`src/server/src/modules/core-mcp/core-mcp.tools.ts`). The web UI is optional.
- **The UI shows; it does not author.** There are no "New tool / New job / Edit schedule" forms. Things agents write (code, schedules, table structure, the tools on a server) are read-only in the UI, with switches to pause or turn them off. Empty states name the Core MCP tool to ask for.
- **People still type what agents should not see.** Secrets, KV values, datatable rows, workspaces, folders and settings stay editable by hand.
- **Make errors useful to agents.** Set `isError` and say how to fix the call. Destructive tools need `confirm=true`. Never quietly fall back to something the agent did not ask for.

[CLAUDE.md](CLAUDE.md) has the full rules and the architecture. It is also what Claude Code reads when you develop with it.

## Setup

You need:

- [Bun](https://bun.sh/) ≥ 1.4.3
- Git
- [Rust](https://rustup.rs) — only if you build the Mac app

Fork the repo on GitHub, then:

```bash
git clone https://github.com/<you>/open-agent-hands.git
cd open-agent-hands
bun install
bun run dev
```

Open **http://localhost:18430** and create a dev account.

### Dev and the installed app side by side

Dev uses its own ports and its own data folder, so you can keep your real install running while you work:

| | Installed app / binary | `bun run dev` |
| --- | --- | --- |
| UI | http://127.0.0.1:8429 | http://localhost:18430 (Vite with hot reload) |
| API | 8429 | 18429 |
| Data | `~/.open-agent-hands` | `~/.open-agent-hands-dev` |

To start fresh in dev, stop `bun run dev` and delete `~/.open-agent-hands-dev`. To point Claude Code at your dev server, use the Core MCP key from the dev UI with `http://127.0.0.1:18429/mcp/core`.

## Project layout

```
src/server/        Bun + Hono API, Core MCP, hosted MCP, jobs scheduler, SQLite (Drizzle)
  src/modules/     one folder per feature: *.route.ts, *.service.ts
  src/__tests__/   bun tests (real migrations on an in-memory DB)
src/web/           React 19 + Vite + Tailwind + devnonla-ui
  modules/         one folder per feature, mirrors the server
desktop/           Tauri v2 Mac app: a thin shell that runs the binary (Rust)
scripts/           build-binary.ts, build-desktop.ts, install.sh
.github/           CI, release workflow, issue templates, README assets
```

## Adding a feature

A typical change touches these places:

1. **Service:** `src/server/src/modules/<feature>/<feature>.service.ts`. Scope queries with `inWorkspace(table.workspaceId)` and inserts with `currentWorkspaceId()`.
2. **Database:** if the schema changes, add `src/server/src/common/db/migrations/00NN_name.sql` **and** register it in `migrations/index.ts`, then update `common/db/schema.ts`.
3. **Core MCP tool:** add it in `core-mcp.tools.ts`. Name it `verb_noun`, accept names as well as ids, and return compact JSON. If agents need to know how to use it, document it in `core-mcp-guide.ts`.
4. **HTTP route** for the UI, in `<feature>.route.ts`.
5. **UI**, if people need to see it, in `src/web/modules/<feature>/`. Make one list request per page and patch the Redux list from responses or WebSocket events instead of refetching.
6. **Tests** in `src/server/src/__tests__/`.

House style: no code comments, Biome formatting (2 spaces, wide lines) and Tailwind utilities instead of new CSS files.

## Checks

Run these before you push. CI runs the same ones:

```bash
bun run lint               # Biome (web)
bun run typecheck          # web
bun run typecheck:server   # server
bun run test               # all server tests
bun test src/server/src/__tests__/jobs.test.ts -t "pause"   # one file or test
```

Tests write to a temporary data folder, never to your real one.

## Building

```bash
bun run build              # web + binary → dist/agenthands
bun run build:binary:all   # dist/agenthands-{darwin,linux}-{arm64,x64}
bun run build:desktop      # binary + Mac app → desktop/src-tauri/target/release/bundle/
```

- **Try your binary without touching real data:** `./dist/agenthands --port 8431 --data-dir /tmp/ah-test`.
- **The Mac app** takes the binary from `dist/`, bundles it as a sidecar and ad-hoc signs everything. The first build compiles the Rust crates and takes a few minutes; later builds take seconds. Useful flags are `--skip-binary` (reuse `dist/agenthands`), `--debug`, `--target x86_64-apple-darwin` and `--archive` (writes `dist/OpenAgentHands-darwin-<arch>.app.tar.gz`).

## Releasing your fork

1. Set the version in `package.json`, `desktop/package.json`, `desktop/src-tauri/Cargo.toml` and `desktop/src-tauri/tauri.conf.json`, and add a `CHANGELOG.md` entry.
2. Push a tag such as `v0.2.0`. `.github/workflows/release.yml` builds:
   - the four binaries and `install.sh` on Linux;
   - the Mac app for arm64 and x64 on a macOS runner.

   It then attaches everything to a GitHub release.
3. Your users install from your fork. Either change the default `REPO` in `scripts/install.sh`, or have them run:

   ```bash
   curl -fsSL https://github.com/<you>/open-agent-hands/releases/latest/download/install.sh | AGENTHANDS_REPO=<you>/open-agent-hands sh
   ```

The Mac app is not notarized. `install.sh` clears the quarantine flag after downloading. Signing and notarizing need an Apple Developer account and are not set up.

## Pull requests

- Branch from `main` using one of these prefixes: `feat/`, `fix/`, `docs/`, `refactor/` or `chore/`.
- Write commits as [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(jobs): pause a schedule without clearing cron`.
- Keep each PR to one change. Explain what changed and why, and link the issue (`Closes #123`).
- CI must pass.

Report bugs with the [bug template](https://github.com/devnonla/open-agent-hands/issues/new?template=01-bug.yml) and ideas with the [feature template](https://github.com/devnonla/open-agent-hands/issues/new?template=02-feature.yml). For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
