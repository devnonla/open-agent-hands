# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
