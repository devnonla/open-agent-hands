# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The Mac app updates itself.** It checks for a new release when it starts and every 6 hours, and **Check for Updates…** in the menu bar checks right away. When a new version is out, it shows what changed and asks before installing, then restarts with the new version. Updates are signed and checked before they are installed. Apps from 0.3.0 and earlier need one last update with the install command.
- **Forks never update from this repo.** The update address and key are added when the release is built, from the fork's own repo and keys. A fork without keys builds an app with no updater. CONTRIBUTING.md explains how to set it up.

## [0.3.0] - 2026-11-20

### Added

- **Run it on a server with Docker.** The repo has a `Dockerfile` and `docker-compose.yml`. `docker compose up -d --build` builds the binary and runs it with data in a volume, bound to `127.0.0.1:8429` for a reverse proxy. The compose file allows bubblewrap so tools and jobs stay sandboxed. See "Run on a server with Docker" in the README.
- **A DEV marker for `bun run dev`.** It appears next to the logo, in the sign-in and setup cards and as `· dev` after the version, and the tab title starts with `[DEV]`. Release builds never show it.

### Removed

- **The tool on/off switch.** Tools no longer have an active state. Every tool assigned to a hosted MCP server is listed and callable. The switch on the tool page, the "Inactive" tag and the `active` argument of `update_tool` are gone, and the `agent_tools.is_active` column is dropped on upgrade. Tools that were switched off become callable again.

## [0.2.1] - 2026-11-20

### Fixed

- **The macOS app is now attached to the release.** The v0.2.0 app job was cancelled because GitHub no longer supports the `macos-14` runner, so v0.2.0 shipped binaries only. On macOS, the one-line install now sets up `Open Agent Hands.app` as intended.
- **The app job no longer rebuilds the web UI on macOS.** That build ran out of memory. The job now reuses the darwin binaries from the release job, so the app bundles exactly the released binaries.

### Changed

- **The release workflow can be dry-run.** `workflow_dispatch` builds everything without publishing and checks the app bundles first.

## [0.2.0] - 2026-11-20

### Added

- **Desktop app for macOS** (`bun run build:desktop`). It is a light Tauri wrapper that bundles the binary, starts the server on 8429 and shows the dashboard in a window. A menu bar icon offers Open, Open in Browser, Start at Login and Quit.
- **The one-line install sets up the Mac app.** On macOS, `install.sh` installs `Open Agent Hands.app`, links `agenthands` to the binary inside it and opens it. It falls back to the plain binary when a release has no app. Release builds `OpenAgentHands-darwin-{arm64,x64}.app.tar.gz` on a macOS runner.

### Changed

- **Dev runs beside the installed binary.** `bun run dev` uses API 18429 and UI 18430 with its own data in `~/.open-agent-hands-dev`. The binary keeps port 8429 and `~/.open-agent-hands`.
- **Jobs are watched, not configured.** The job page has Overview, Activities and Code tabs. Overview shows each cron in plain words, the next three runs, and a pause switch. The schedule editor and the settings form are gone, and agents set the schedule with `update_job`.
- **Pause keeps the schedule.** A paused job keeps its cron. It stays paused when an agent changes the cron, until someone resumes it or an agent passes `enabled=true`. Job results include `status` (`scheduled`, `paused` or `manual`) and `nextRuns`.
- **Datatables and hosted MCP servers.** The "New project", "Add table", "Edit tools" and "Pick tools" controls are removed. Empty states name the Core MCP tool to ask for instead. Rows stay editable.
- **Docs for two readers.** The README is now for people who use the app: install, connect, day to day, update, uninstall and troubleshooting. CONTRIBUTING.md covers developing, building and releasing a fork.
- **Release notes come from CHANGELOG.md.** The release workflow fails if the tag has no changelog section.

## [0.1.0] - 2026-11-20

Open Agent Hands is a local server where AI coding agents (Claude Code, Codex) build and run tools, hosted MCP servers, sites, jobs, KV, secrets and datatables over MCP. People mostly watch and correct through the web UI. It started as a fork of Nonla Agents, with the in-app LLM agents removed.

### Added

- **Core MCP** at `/mcp/core`. It is a built-in admin MCP server with 49 tools, grouped by area, that manage workspaces, tools, hosted MCP servers, KV, secrets, datatables, sites and jobs. It also includes `get_guide`, an authoring guide for agents. The MCP Servers page shows the key, lets you rotate it, and gives a ready-made `claude mcp add` command.
- **Workspaces.** Every resource belongs to one, and a `Default` workspace always exists. The app asks you to pick a workspace when you open it, and you can create, rename and delete workspaces. Data on disk is grouped under `workspaces/<id>/`.
- **Hosted MCP servers.** Each server has its own token, and a **Connect** dialog shows the URL, token and client config.
- **Sites.** These are React sites (`app.tsx` + `backend.ts`) with a draft/approve flow and optional password-protected publishing at `/public/sites/<slug>`.
- **A single `agenthands` binary** for macOS and Linux (arm64/x64) with the web UI and migrations embedded, a one-line `install.sh`, and the CLI flags `--port`, `--host` and `--data-dir`. Data lives in `~/.open-agent-hands`.
- **An optional OS sandbox** (bubblewrap/Seatbelt) for tools and site backends. It is off by default and can be turned on in Settings.
- **Per-account theme** in Profile → Appearance.
- **Runtime SDK `@agenthands/runtime`** for tools, jobs and site backends. The old names `@nonla-agents/runtime` and `nonlaagents` still work as aliases.
- **New name and logo**: Open Agent Hands.

### Changed

- **Agent-first UI.** Tools, sites, jobs and hosted MCP servers are created by agents through Core MCP, so the UI has no "New" buttons for them. Folders, secrets, KV values, settings and workspaces stay editable by hand.

### Removed

- In-app agents, chat, LLM providers, skills, teams, public chat sharing and Open Graph images.
- Coding-agent panels in tools, jobs, datatables and sites.
- The outbound remote MCP client. Hosted MCP servers at `/mcp/:id` remain.
- Multi-user management and roles. The app is single-user.
- PostgreSQL and Docker. The app runs on SQLite only.
