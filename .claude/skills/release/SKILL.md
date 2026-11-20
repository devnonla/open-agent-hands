---
name: release
description: Cut a release of Open Agent Hands (binaries, install.sh and the macOS app) with every gate run before tagging. Use when the user asks to release, ship, publish or tag a version (e.g. "release đi", "ra bản 0.3.0").
---

# Release Open Agent Hands

A release is a `vX.Y.Z` tag on `main`. Pushing it runs `.github/workflows/release.yml`, which does two things:

- **`release` (ubuntu):** builds `agenthands-{darwin,linux}-{arm64,x64}` and uploads them with `install.sh`. This job creates the GitHub release.
- **`desktop` (macos-14):** builds `OpenAgentHands-darwin-{arm64,x64}.app.tar.gz` and adds them to the same release.

People install with `curl -fsSL …/releases/latest/download/install.sh | sh`, so a broken release reaches users immediately. **Run every step in order. Stop and report on the first failure. Never skip a gate to "save time".**

## Rules

- Release only from `main`, with a clean tree that matches `origin/main`.
- Never move or delete a tag that already has a published GitHub release. Fix forward with a patch version. A tag whose workflow failed before any release existed may be deleted and recreated, but say so.
- Don't use `--no-verify` and don't force-push `main`.
- Choose the version with semver. We are on 0.x: new features bump the minor (`0.1.0 → 0.2.0`), fixes only bump the patch. If the user named a version, use it. If the choice is unclear, ask.
- Use scratch dirs for every smoke test, with `--data-dir` / `AGENTHANDS_INSTALL_DIR` / `AGENTHANDS_APP_DIR` pointing at them. Never touch `~/.open-agent-hands`, `/Applications` or `~/.local/bin`.
- Report each gate's result honestly, and include failing output.

## 1. Preflight

```bash
git branch --show-current            # must be main
git fetch origin && git status -sb   # nothing behind origin
gh auth status                       # logged in, can push
git tag -l 'v*'                      # new version must not exist
```

Uncommitted work belongs in this release only if the user asked for it. Commit it first, as Conventional Commits split by topic, and show the user the list.

## 2. Quality gates (same as CI)

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run typecheck:server
bun run test
```

All must pass with 0 failures.

## 3. Version and changelog

Set the same version in all four places:

- `package.json` (this drives the UI's `__APP_VERSION__` and `/api/health`)
- `desktop/package.json`
- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/tauri.conf.json`

`desktop/src-tauri/Cargo.lock` updates on the next desktop build. Commit it.

**Plugin version (only if it changed):** run `git diff --stat vPREV..HEAD -- plugins .claude-plugin` (PREV is the last tag). If it is empty, leave `plugins/agenthands/.claude-plugin/plugin.json` alone. If the skill or its references changed, set its `version` to the new release version, so Claude Code sees an update. Also check that the references still match the Core MCP tools and their arguments, and run `claude plugin validate .`.

In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (today's date) and keep the Added / Changed / Removed / Fixed groups. Leave a fresh empty `## [Unreleased]` above it. The release body is taken from this section, so write it for users.

Check `README.md` and `CONTRIBUTING.md` for anything this release made stale, such as flags, ports, steps or tool counts. If the tool count changed, verify it with Core MCP `tools/list`.

## 4. Build and smoke-test (with the new version)

**Binary:**

```bash
bun run build
./dist/agenthands --version
```

Start it on a spare port with scratch data, then check it:

- `GET /api/health` returns `"app":"agenthands"` and the new version.
- `GET /` serves the SPA HTML, which proves the web assets are embedded.
- Stop it.

**Cross-compile:** `bun run build:binary:all`. All four `dist/agenthands-*` files must exist.

**Mac app** (only on macOS with Rust): `bun scripts/build-desktop.ts --skip-binary --archive`. Then check:

- `codesign --verify --deep --strict "<bundle>/macos/Open Agent Hands.app"` passes.
- `"<app>/Contents/MacOS/agenthands" --version` prints the new version.

**install.sh:**

- `sh -n scripts/install.sh` passes.
- Install from local files with `AGENTHANDS_DOWNLOAD_URL="file://$PWD/dist"`, `AGENTHANDS_APP=0` and a scratch `AGENTHANDS_INSTALL_DIR`. The installed `agenthands --version` must work.
- Testing the app path quits the user's running "Open Agent Hands", so only do it if the user agrees.

## 5. Commit, push, CI

```bash
git add -A
git commit -m "chore(release): vX.Y.Z"
git push origin main
gh run watch "$(gh run list --branch main --workflow CI --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

CI must be green before you tag.

### Dry-run the release workflow

CI does not run the release jobs, and runner images change (for example, `macos-14` was retired). Before tagging, run the release workflow on `main` without publishing:

```bash
gh workflow run Release --ref main
gh run watch "$(gh run list --workflow Release --event workflow_dispatch --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

Both jobs must pass. In this mode the `desktop` job checks the signatures and architectures of both bundles and keeps the archives, their `.sig` files and `latest.json` as a `macos-app` artifact instead of uploading them. The log must show `Updater on:` for both builds. Do not tag until the dry run is green.

## 6. Tag and watch the release

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
gh run watch "$(gh run list --workflow Release --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
gh release view vX.Y.Z --json assets -q '.assets[].name'
```

The release must have exactly these assets:

- `agenthands-darwin-arm64`
- `agenthands-darwin-x64`
- `agenthands-linux-arm64`
- `agenthands-linux-x64`
- `install.sh`
- `OpenAgentHands-darwin-arm64.app.tar.gz`
- `OpenAgentHands-darwin-arm64.app.tar.gz.sig`
- `OpenAgentHands-darwin-x64.app.tar.gz`
- `OpenAgentHands-darwin-x64.app.tar.gz.sig`
- `latest.json`

If the `desktop` job failed after `release` succeeded, the release exists without the app. `install.sh` falls back to the CLI, so users are not broken. Fix the job and publish X.Y.Z+1. Don't retag.

## 7. Post-release check

Run against the real GitHub release, into scratch dirs:

```bash
curl -fsSL https://github.com/devnonla/open-agent-hands/releases/download/vX.Y.Z/install.sh \
  | AGENTHANDS_VERSION=vX.Y.Z AGENTHANDS_APP=0 AGENTHANDS_INSTALL_DIR="$SCRATCH/bin" sh
"$SCRATCH/bin/agenthands" --version
```

Then download `OpenAgentHands-darwin-<arch>.app.tar.gz` into scratch, extract it, and check:

- `codesign --verify --deep --strict` passes.
- The bundled `agenthands --version` prints the new version.

Check the updater manifest: `curl -fsSL https://github.com/devnonla/open-agent-hands/releases/latest/download/latest.json` must show the new `version`, and both `platforms` URLs must point at this release's archives.

Finally confirm `gh release list --limit 3` marks it as Latest. The README's release badge follows that.

## 8. Report

Tell the user:

- the version and the release URL;
- each gate and its result;
- the asset list;
- what the post-release check showed;
- anything skipped and why.

Mention that the Mac app is ad-hoc signed and not notarized, and that `install.sh` clears quarantine.
