<p align="center">
  <img src=".github/assets/logo.svg" width="96" height="96" alt="Open Agent Hands logo" />
</p>

<h1 align="center">Open Agent Hands</h1>

<p align="center">
  <strong>The hands your AI agents build with.</strong><br />
  A local app where Claude Code and Codex create and run tools, MCP servers, sites, jobs and data over MCP, while you watch.
</p>

<p align="center">
  <a href="https://github.com/devnonla/open-agent-hands/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/devnonla/open-agent-hands?color=E5600F&label=release" /></a>
  <a href="https://github.com/devnonla/open-agent-hands/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/devnonla/open-agent-hands/ci.yml?branch=main&label=ci" /></a>
  <img alt="Platforms" src="https://img.shields.io/badge/macOS%20%7C%20Linux-arm64%20%7C%20x64-1a1815" />
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-1a1815" /></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#connect-your-agent">Connect your agent</a> ·
  <a href="#day-to-day">Day to day</a> ·
  <a href="#update-and-uninstall">Update</a> ·
  <a href="#troubleshooting">Troubleshooting</a> ·
  <a href="CONTRIBUTING.md">Develop</a>
</p>

<p align="center">
  <img src=".github/assets/mcp-servers.jpg" alt="MCP servers page with the built-in Core MCP and two hosted servers" width="900" />
</p>

---

## Why

Coding agents are great at writing code, but they have nowhere to *keep* what they build. Open Agent Hands gives them a place to work:

- **Agents do the work.** Over one MCP connection, Claude Code or Codex can write a tool, test it, publish it as its own MCP server, schedule a job, store data or ship a small site.
- **You watch and correct.** The app is for seeing what agents built, reading code and logs, pausing a job or fixing a row. You don't build things in it.
- **It runs on your machine.** It's one app with a local SQLite database. There's no cloud and no account to sign up for. To run it on a server instead, see [Run on a server with Docker](#run-on-a-server-with-docker).

<p align="center">
  <img src=".github/assets/how-it-works.svg" alt="Claude Code and Codex manage Open Agent Hands through /mcp/core; hosted MCP servers expose selected tools to any client" width="900" />
</p>

## Install

```bash
curl -fsSL https://github.com/devnonla/open-agent-hands/releases/latest/download/install.sh | sh
```

- **macOS:** installs **Open Agent Hands.app** into `/Applications` and opens it. The app sits in the menu bar and runs the server for you. It also adds the `agenthands` command to your terminal.
- **Linux:** installs the `agenthands` binary into `~/.local/bin`. Start it with `agenthands`.

Then open **http://127.0.0.1:8429**, create your account. Everything stays on your machine.

## Connect your agent

1. In the app, open **Connect**.
2. On the **CLI** tab (recommended), click **Copy setup prompt** and paste it into your agent. It installs `oahctl`, logs in to this server and checks that it works. Agents that can't run shell commands use the **MCP** tab instead, which has the endpoint, the key and an MCP setup prompt.
3. The prompt also installs the skill in Claude Code, so it knows the exact formats for tools, jobs, sites and datatables. To do it by hand:

   ```bash
   claude plugin marketplace add devnonla/open-agent-hands
   claude plugin install agenthands@agenthands
   ```

4. Ask your agent for something, for example:

   > Create a tool that fetches YouTube transcripts and put it on a new MCP server called "Research kit".

The agent reads the built-in guide, writes the tool, runs it until it works and publishes it. You see each step appear in the app.

To use those tools from **another** client (Cursor, Claude Desktop, another agent), click **Connect** on the server card. You get the URL, a private token and a ready-to-paste config. Each server exposes only the tools assigned to it.

## Use it from the command line

`oahctl` is a small command line client (about 20 KB, runs on Node 18+ or Bun), separate from the server. `install.sh` installs it next to the app. Any agent that can run shell commands can use it with no MCP setup, and one `oahctl` can talk to several servers.

On a machine that only needs the client:

```bash
curl -fsSL https://github.com/devnonla/open-agent-hands/releases/latest/download/install.sh | AGENTHANDS_CLI_ONLY=1 sh
```

```bash
oahctl login                                           # the local app; asks for the Core MCP key
oahctl login ah_core_…                                 # or pass the key right away
oahctl login https://hands.example.com ah_core_… --name vps
oahctl servers                                          # saved servers and which one applies here
```

The **Connect** page in the app has a setup prompt to paste into your agent, plus the server address, key and login command.

Every Core MCP tool is a command, with the same name and arguments:

```bash
oahctl list_tools
oahctl tools create --code-file ./weather.ts            # --<arg>-file reads a value from a file
oahctl run_tool weather --input '{"city":"Hanoi"}'
oahctl kv set BASE_URL=https://api.example.com
oahctl upload reports ./q3.pdf ./charts/                # files or folders, any size
oahctl download reports q3.pdf --out ./tmp
oahctl help kv_set                                      # a command's arguments
```

Pick the server with `-s vps`, `AGENTHANDS_SERVER=vps`, or pin a project folder with `oahctl pin vps` (writes `.agenthands.json`). Otherwise the default is used, set with `oahctl use <name>`. Each call prints the server it talks to on stderr, and results are JSON on stdout. Keys are kept in `~/.config/agenthands/credentials.json` (mode 600). In CI, set `AGENTHANDS_URL` and `AGENTHANDS_KEY` instead of logging in.

In Claude Code, allow the commands once so it does not ask every time: add `"Bash(oahctl:*)"` to `permissions.allow` in `~/.claude/settings.json`.

## Day to day

Agents create things. You mostly look, and step in when needed.

| Area | What you do here |
| --- | --- |
| **Connect** | Copy the setup prompt for your agent (CLI or MCP), see the key, rotate it |
| **MCP Servers** | Copy connect info, turn a server on or off, rotate its token |
| **Tools** | Read and fix code, group tools into folders |
| **Jobs** | See the schedule in plain words and the next runs, pause or resume, run now, read the logs |
| **Sites** | Preview, publish, set a password |
| **Datatables** | Browse and edit rows |
| **Storage** | Browse files by folder, preview, upload or download them, make a space public, reset a file's link |
| **KV Store / Secrets** | Enter values that agents should use but never see in chat, such as API keys |

Things you might ask an agent:

- *"Every weekday at 8am, save the top Hacker News stories to a datatable."*
- *"Make a small site that lists my leads from the crm datatable, with a password."*
- *"Add a tool that converts text to a URL slug and put it on the Everyday server."*

<details>
<summary><b>Everything the Core MCP can do</b> (59 tools)</summary>

| Group | Tools |
| --- | --- |
| Guide | `get_guide` |
| Tools | `list_tools` `get_tool_schema` `get_tool` `create_tool` `edit_tool_code` `update_tool` `run_tool` `delete_tool` `manage_tool_folder` `move_tool` |
| MCP servers | `list_mcp_servers` `create_mcp_server` `update_mcp_server` `add_tools_to_mcp_server` `remove_tools_from_mcp_server` `delete_mcp_server` |
| KV & secrets | `kv_list_projects` `kv_list` `kv_get` `kv_set` `kv_delete` `kv_delete_project` `secret_list` `secret_set` `secret_delete` |
| Datatables | `datatable_list_projects` `datatable_create_project` `datatable_get_schema` `datatable_create_table` `datatable_add_columns` `datatable_query` `datatable_insert_rows` `datatable_update_rows` `datatable_delete_rows` `datatable_delete_project` |
| Storage | `storage_list_spaces` `storage_create_space` `storage_update_space` `storage_delete_space` `storage_list_files` `storage_upload_link` `storage_download_link` `storage_get_file` `storage_delete_file` `storage_reset_public_link` |
| Sites | `list_sites` `create_site` `get_site_files` `edit_site_file` `preview_site` `publish_site` `delete_site` |
| Jobs | `list_jobs` `get_job` `create_job` `update_job` `run_job` `get_job_runs` `clear_job_runs` `delete_job` |

The code agents write uses a small runtime SDK:

```ts
import agenthands from "@agenthands/runtime";

const city = await agenthands.kv.get("DEFAULT_CITY", "Hanoi");
const token = await agenthands.secrets.get("OPENWEATHER_API_KEY");
const leads = await agenthands.datatable.query("crm", "leads", { where: { score: { $gt: 80 } } });
await agenthands.storage.space("reports").put("leads.json", JSON.stringify(leads));
```

</details>

## A look inside

<table>
  <tr>
    <td width="50%"><img src=".github/assets/tool-editor.jpg" alt="Tool editor" /><br /><sub><b>Tools</b>: TypeScript with <code>@param</code> annotations. npm imports install automatically.</sub></td>
    <td width="50%"><img src=".github/assets/job-activity.jpg" alt="Job run activity" /><br /><sub><b>Jobs</b>: scheduled scripts with step timings and logs.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src=".github/assets/datatables.jpg" alt="Datatables" /><br /><sub><b>Datatables</b>: typed tables that agents and people both read and write.</sub></td>
    <td width="50%"><img src=".github/assets/site-preview.jpg" alt="Site preview" /><br /><sub><b>Sites</b>: small React apps with a backend, published at <code>/public/sites/&lt;slug&gt;</code>.</sub></td>
  </tr>
</table>

## The Mac app

The app is a thin shell around the same server:

- The menu bar icon has **Open**, **Open in Browser**, **Start at Login**, **Check for Updates…** and **Quit**.
- The app checks for a new version when it starts and every few hours. When one is out, it asks before installing, then restarts itself. Your data stays where it is.
- Closing the window keeps the server running, so your agents can still connect. **Quit** stops it.
- If the server is already running (for example, started from a terminal), the app uses that one.

## Run from the terminal

On Linux, or on macOS without the app:

```bash
agenthands                       # http://127.0.0.1:8429
agenthands --port 9000           # another port
agenthands --data-dir ~/work-ah  # a separate set of data
```

| Option | Default |
| --- | --- |
| `-p, --port` | `8429` (env `PORT`) |
| `-H, --host` | `127.0.0.1` (env `HOST`) |
| `-d, --data-dir` | `~/.open-agent-hands` (env `DATA_DIR`) |

The server checks GitHub for a newer release at most every 6 hours and shows it in the app. Set `AGENTHANDS_UPDATE_REPO=off` to turn that off.

## Run on a server with Docker

Each release publishes an image for `amd64` and `arm64` to `ghcr.io/devnonla/open-agent-hands`. Save [`docker-compose.yml`](docker-compose.yml) on your VPS and start it. Data lives in the `agenthands-data` volume.

```bash
curl -fsSLO https://raw.githubusercontent.com/devnonla/open-agent-hands/main/docker-compose.yml
docker compose up -d
```

The port is bound to `127.0.0.1:8429`, so put a reverse proxy with HTTPS in front. With Caddy:

```
agenthands.example.com {
  reverse_proxy 127.0.0.1:8429
}
```

- **Create your account right away.** The first visit to `/setup` creates the only account, and it has full access. Do this before anyone else finds the URL.
- **Sandbox.** Tools and jobs run in bubblewrap, which Docker's default seccomp profile blocks. The compose file sets `seccomp:unconfined` for that reason. Without it, they run unsandboxed.
- **Public URL.** Links to public files and sites that tools and agents get start with this address. The app asks you to confirm it after you sign in, filled in with the address you opened it from. Change it in **Settings → General**.
- **Connect your agent** to `https://agenthands.example.com/mcp/core` with the key from the app, as in "Connect your agent".

### Update

When a new version is out, the sidebar shows **Update available** and **Settings → General** gives the command. Next to your `docker-compose.yml`, run:

```bash
docker compose pull && docker compose up -d
```

Your data stays in the volume, and the new version upgrades the database when it starts. You can't go back to an older version after that, so back up the volume first:

```bash
docker run --rm -v agenthands-data:/data -v "$PWD":/backup debian tar czf /backup/agenthands-data.tgz -C /data .
```

To stay on one version, replace `latest` with a version such as `0.5.0` in `docker-compose.yml`. To build the image from source instead, run `docker build -t ghcr.io/devnonla/open-agent-hands:latest .` in a clone of this repo.

## Your data

Everything lives in `~/.open-agent-hands`:

```
data.db               tools, jobs, KV, secrets, datatables and file metadata (SQLite)
storage/<id>/         storage files
sites/<id>/           site files
tools/<id>/           generated tool folders (safe to delete)
logs/server.log       server log when started by the Mac app
```

- **Back up:** quit the app, then copy the whole folder.
- **Secrets:** encrypted at rest.
- **Sandbox:** tools and site backends can run in an OS sandbox (Seatbelt on macOS, bubblewrap on Linux). Turn it on in **Settings → Sandbox**.

## Update and uninstall

**Update:** on macOS, the app offers new versions itself, or use **Check for Updates…** in the menu bar. Versions before 0.4.0 can't update themselves, so run the install command once more. On Linux, run the install command again. Either way, your data stays.

**Uninstall:**

1. **macOS:** turn off **Start at Login** in the menu bar, quit the app, and delete `/Applications/Open Agent Hands.app`.
2. **macOS and Linux:** remove the command line link or binary with `rm ~/.local/bin/agenthands`.
3. **Only if you also want to delete all your data:** `rm -rf ~/.open-agent-hands`. This cannot be undone.

## Troubleshooting

<details>
<summary><b>macOS says the app is damaged or from an unidentified developer</b></summary>

The app is not notarized by Apple. The install command clears the download flag for you. If you downloaded the app in a browser instead, run:

```bash
xattr -dr com.apple.quarantine "/Applications/Open Agent Hands.app"
```

</details>

<details>
<summary><b>"Port 8429 is used by another app"</b></summary>

Something else is listening on 8429. Find it with `lsof -nP -iTCP:8429 -sTCP:LISTEN`, stop it, then reopen the app. Or run the server on another port with `agenthands --port 9000`.

</details>

<details>
<summary><b>My agent can't connect</b></summary>

- Check that the app (or `agenthands`) is running: open http://127.0.0.1:8429.
- Copy the setup prompt again from **Connect**. If you rotated the key, the old one stops working.
- For a hosted server, check it is turned **on** and use its own token from **Connect**.

</details>

<details>
<summary><b>Where are the logs?</b></summary>

If the Mac app started the server, logs are in `~/.open-agent-hands/logs/server.log`. If you ran `agenthands` yourself, they are in that terminal. Job and tool run logs are in the app, under each job or tool.

</details>

Still stuck? [Open an issue](https://github.com/devnonla/open-agent-hands/issues/new?template=01-bug.yml).

## Contributing

Want to change Open Agent Hands itself, or run your own fork? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
