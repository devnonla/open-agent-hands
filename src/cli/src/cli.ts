import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { describeTool, parseToolArgs } from "./args.js";
import { type FetchFn, type RemoteTool, callOrThrow, callRemoteTool, listRemoteTools } from "./client.js";
import { type CliEnv, CliError, LOCAL_URL, PROJECT_FILE, type ResolvedServer, assertServerName, configPath, defaultServerName, findProjectFile, loadConfig, normalizeUrl, resolveServer, saveConfig } from "./config.js";

export type CliIo = {
  fetch: FetchFn;
  env: CliEnv;
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stdoutIsTty: boolean;
  stdinIsTty: boolean;
  readStdin: () => Promise<string>;
  readSecret: (prompt: string) => Promise<string>;
  version: string;
};

const USAGE = `oahctl — command line for Agent Hands servers

Usage:
  oahctl <command> [args] [-s <server>]

Servers:
  login [url] [key] [--name <name>]           save a server (default ${LOCAL_URL} as "local").
                                              key: the Core MCP key from <url>/connect;
                                              asked for (hidden) when left out
  logout <name>                               forget a server
  servers                                     list saved servers and which one applies here
  use <name>                                  set the default server
  pin <name>                                  use <name> in this folder and below (.agenthands.json)
  unpin                                       remove this folder's .agenthands.json

Calls:
  <tool> [args]                               call a Core MCP tool, e.g. oahctl list_tools
  <group> <verb> [args]                       same, e.g. oahctl tools list, oahctl kv set A=1
  call <tool> ['{json}']                      call a tool with a JSON object of arguments
  help <tool>                                 a tool's arguments
  upload <space> <path...> [--prefix <dir/>]  upload files or folders to storage, any size
  download <space> <key...> [--out <dir>]     save storage files to disk

Arguments: required ones can be positional, in order; --<name> <value> for the rest;
--<name>-file <path> (or - for stdin) reads a value from a file; --json '{...}' passes an object.
Output is JSON on stdout. Errors go to stderr with exit code 1.

Which server: -s/--server <name>, then AGENTHANDS_SERVER, then AGENTHANDS_URL + AGENTHANDS_KEY,
then the nearest .agenthands.json, then the default. Every call names its server on stderr.`;

function out(io: CliIo, value: unknown): void {
  io.stdout(typeof value === "string" ? value : JSON.stringify(value, null, io.stdoutIsTty ? 2 : undefined));
}

function takeServerFlag(argv: string[]): { rest: string[]; server?: string } {
  const rest: string[] = [];
  let server: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      rest.push(...argv.slice(i));
      break;
    }
    if (token === "-s" || token === "--server") {
      server = argv[++i];
      if (!server) throw new CliError(`${token} needs a server name. Saved servers: oahctl servers`);
      continue;
    }
    if (token.startsWith("--server=")) {
      server = token.slice(9);
      continue;
    }
    rest.push(token);
  }
  return { rest, server };
}

function takeFlag(argv: string[], name: string): { rest: string[]; value?: string } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === `--${name}`) {
      value = argv[++i];
      if (value === undefined) throw new CliError(`--${name} needs a value`);
    } else if (token.startsWith(`--${name}=`)) value = token.slice(name.length + 3);
    else rest.push(token);
  }
  return { rest, value };
}

function noExtra(argv: string[], usage: string): void {
  if (argv.length) throw new CliError(`Unexpected argument: ${argv.join(" ")}. Usage: ${usage}`);
}

async function readText(io: CliIo, path: string): Promise<string> {
  if (path === "-") return io.readStdin();
  const full = resolve(io.cwd, path);
  if (!existsSync(full)) throw new CliError(`File not found: ${full}`);
  return readFileSync(full, "utf8");
}

async function login(io: CliIo, argv: string[]): Promise<void> {
  const name = takeFlag(argv, "name");
  const key = takeFlag(name.rest, "key");
  const isKey = (arg: string) => /^(ah_core_|ra_mcp_)/.test(arg);
  const keys = key.rest.filter(isKey);
  const urls = key.rest.filter((arg) => !isKey(arg));
  if (urls.length > 1 || keys.length > 1 || (keys.length && key.value)) throw new CliError(`Unexpected argument: ${key.rest.join(" ")}. Usage: oahctl login [url] [key] [--name <name>]`);
  const url = normalizeUrl(urls[0] ?? LOCAL_URL);
  const serverName = assertServerName(name.value ?? defaultServerName(url));
  let secret = keys[0] ?? key.value ?? io.env.AGENTHANDS_KEY;
  if (!secret) {
    if (io.stdinIsTty) {
      io.stderr(`Open ${url}/connect and copy the Core MCP key.`);
      secret = await io.readSecret("Core MCP key: ");
    } else secret = await io.readStdin();
  }
  secret = secret.trim();
  if (!secret) throw new CliError("No key given. Pass --key, set AGENTHANDS_KEY, or pipe it on stdin.");
  if (secret.startsWith("ra_mcp_")) throw new CliError(`That is a hosted MCP server key. The CLI needs the Core MCP key (ah_core_…) from ${url}/connect.`);
  const tools = await listRemoteTools(io.fetch, { name: serverName, url, key: secret });
  const config = loadConfig(io.env);
  const replaced = serverName in config.servers;
  config.servers[serverName] = { url, key: secret };
  if (!config.default || !config.servers[config.default]) config.default = serverName;
  saveConfig(io.env, config);
  out(io, { ok: true, server: serverName, url, tools: tools.length, replaced, default: config.default, config: configPath(io.env) });
}

function logout(io: CliIo, argv: string[]): void {
  const [name, ...extra] = argv;
  if (!name) throw new CliError("Usage: oahctl logout <name>");
  noExtra(extra, "oahctl logout <name>");
  const config = loadConfig(io.env);
  if (!config.servers[name]) throw new CliError(`No saved server "${name}". Saved: ${Object.keys(config.servers).join(", ") || "none"}`);
  delete config.servers[name];
  const remaining = Object.keys(config.servers);
  if (config.default === name) config.default = remaining.length === 1 ? remaining[0] : undefined;
  saveConfig(io.env, config);
  out(io, { ok: true, removed: name, default: config.default ?? null, servers: remaining });
}

function servers(io: CliIo, argv: string[], flag?: string): void {
  noExtra(argv, "oahctl servers");
  const config = loadConfig(io.env);
  let active: { name: string; url: string; source: string } | null = null;
  let problem: string | undefined;
  try {
    const resolved = resolveServer(config, { flag, env: io.env, cwd: io.cwd });
    active = { name: resolved.name, url: resolved.url, source: resolved.source };
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }
  out(io, { servers: Object.entries(config.servers).map(([name, profile]) => ({ name, url: profile.url, default: config.default === name })), active, ...(problem ? { problem } : {}) });
}

function use(io: CliIo, argv: string[]): void {
  const [name, ...extra] = argv;
  if (!name) throw new CliError("Usage: oahctl use <name>");
  noExtra(extra, "oahctl use <name>");
  const config = loadConfig(io.env);
  if (!config.servers[name]) throw new CliError(`No saved server "${name}". Saved: ${Object.keys(config.servers).join(", ") || "none"}. Run oahctl login <url> --name ${name}.`);
  config.default = name;
  saveConfig(io.env, config);
  const pinned = findProjectFile(io.cwd);
  out(io, { ok: true, default: name, ...(pinned ? { note: `${pinned} still pins this folder to its own server` } : {}) });
}

function pin(io: CliIo, argv: string[]): void {
  const [name, ...extra] = argv;
  if (!name) throw new CliError("Usage: oahctl pin <name>");
  noExtra(extra, "oahctl pin <name>");
  const config = loadConfig(io.env);
  if (!config.servers[name]) throw new CliError(`No saved server "${name}". Saved: ${Object.keys(config.servers).join(", ") || "none"}.`);
  const path = join(io.cwd, PROJECT_FILE);
  writeFileSync(path, `${JSON.stringify({ server: name }, null, 2)}\n`);
  out(io, { ok: true, server: name, file: path });
}

function unpin(io: CliIo, argv: string[]): void {
  noExtra(argv, "oahctl unpin");
  const path = join(io.cwd, PROJECT_FILE);
  if (!existsSync(path)) {
    const inherited = findProjectFile(io.cwd);
    throw new CliError(inherited ? `This folder has no ${PROJECT_FILE}; the pin comes from ${inherited}. Run oahctl unpin there.` : `No ${PROJECT_FILE} here.`);
  }
  rmSync(path);
  out(io, { ok: true, removed: path });
}

function connect(io: CliIo, flag?: string): ResolvedServer {
  const server = resolveServer(loadConfig(io.env), { flag, env: io.env, cwd: io.cwd });
  io.stderr(`→ ${server.name} (${server.url})`);
  return server;
}

function singular(word: string): string {
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

function findTool(tools: RemoteTool[], argv: string[]): { tool: RemoteTool; rest: string[] } | null {
  const names = new Map(tools.map((t) => [t.name, t]));
  const norm = (w: string) => w.replace(/-/g, "_");
  const first = norm(argv[0] ?? "");
  if (names.has(first)) return { tool: names.get(first)!, rest: argv.slice(1) };
  const second = argv[1] && !argv[1].startsWith("-") ? norm(argv[1]) : null;
  if (!second) return null;
  for (const candidate of [`${first}_${second}`, `${second}_${first}`, `${second}_${singular(first)}`, `${singular(first)}_${second}`]) {
    if (names.has(candidate)) return { tool: names.get(candidate)!, rest: argv.slice(2) };
  }
  return null;
}

function unknownCommand(tools: RemoteTool[], argv: string[]): CliError {
  const words = argv.slice(0, 2).filter((w) => !w.startsWith("-")).map((w) => singular(w.replace(/-/g, "_")));
  const close = tools.filter((t) => words.some((w) => w.length > 1 && t.name.includes(w))).map((t) => t.name).slice(0, 8);
  return new CliError(`Unknown command: ${argv.slice(0, 2).join(" ")}.${close.length ? ` Did you mean: ${close.join(", ")}?` : ""} Run oahctl help for every command.`);
}

async function runTool(io: CliIo, server: ResolvedServer, tool: RemoteTool, args: Record<string, unknown>): Promise<number> {
  const result = await callRemoteTool(io.fetch, server, tool.name, args);
  if (result.isError) {
    io.stderr(result.text);
    return 1;
  }
  try {
    out(io, JSON.parse(result.text));
  } catch {
    out(io, result.text);
  }
  return 0;
}

async function call(io: CliIo, argv: string[], flag?: string): Promise<number> {
  const [name, ...rest] = argv;
  if (!name) throw new CliError("Usage: oahctl call <tool> ['{json}']");
  const server = connect(io, flag);
  if (rest.length <= 1 && (rest.length === 0 || rest[0].trimStart().startsWith("{"))) {
    let args: Record<string, unknown> = {};
    if (rest[0]) {
      try {
        args = JSON.parse(rest[0]);
      } catch (err) {
        throw new CliError(`Arguments must be a JSON object: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const result = await callRemoteTool(io.fetch, server, name.replace(/-/g, "_"), args);
    if (result.isError) {
      io.stderr(result.text);
      return 1;
    }
    try {
      out(io, JSON.parse(result.text));
    } catch {
      out(io, result.text);
    }
    return 0;
  }
  return toolCommand(io, [name, ...rest], server);
}

async function toolCommand(io: CliIo, argv: string[], server: ResolvedServer): Promise<number> {
  const tools = await listRemoteTools(io.fetch, server);
  const found = findTool(tools, argv);
  if (!found) throw unknownCommand(tools, argv);
  if (found.rest.includes("--help") || found.rest.includes("-h")) {
    out(io, describeTool(found.tool.name, found.tool.description, found.tool.inputSchema));
    return 0;
  }
  const args = await parseToolArgs(found.tool.inputSchema ?? {}, found.rest, (path) => readText(io, path));
  return runTool(io, server, found.tool, args);
}

function groupByServer(tools: RemoteTool[]): { group: string; tools: RemoteTool[] }[] {
  const groups = new Map<string, RemoteTool[]>();
  for (const tool of tools) {
    const group = typeof tool._meta?.["agenthands/group"] === "string" ? (tool._meta["agenthands/group"] as string) : "Other";
    groups.set(group, [...(groups.get(group) ?? []), tool]);
  }
  return [...groups].map(([group, list]) => ({ group, tools: list }));
}

async function help(io: CliIo, argv: string[], flag?: string): Promise<number> {
  if (!argv.length) {
    let server: ResolvedServer | null = null;
    try {
      server = resolveServer(loadConfig(io.env), { flag, env: io.env, cwd: io.cwd });
    } catch {}
    if (!server) {
      out(io, `${USAGE}\n\nRun oahctl login to list the tools of a server here.`);
      return 0;
    }
    let tools: RemoteTool[];
    try {
      tools = await listRemoteTools(io.fetch, server);
    } catch (err) {
      out(io, `${USAGE}\n\nTools: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
    const groups = groupByServer(tools).map(({ group, tools: list }) => `  ${`${group}:`.padEnd(13)} ${list.map((t) => t.name).join(", ")}`);
    out(io, `${USAGE}\n\nTools on ${server.name} (${server.url}) — oahctl help <tool> for arguments:\n${groups.join("\n")}`);
    return 0;
  }
  const server = connect(io, flag);
  const tools = await listRemoteTools(io.fetch, server);
  const found = findTool(tools, argv);
  if (!found) throw unknownCommand(tools, argv);
  out(io, describeTool(found.tool.name, found.tool.description, found.tool.inputSchema));
  return 0;
}

function collectFiles(io: CliIo, paths: string[], prefix: string): { path: string; key: string }[] {
  const files: { path: string; key: string }[] = [];
  const walk = (dir: string, root: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, root);
      else if (entry.isFile()) files.push({ path: full, key: `${prefix}${basename(root)}/${relative(root, full).split(sep).join("/")}` });
    }
  };
  for (const raw of paths) {
    const full = resolve(io.cwd, raw);
    if (!existsSync(full)) throw new CliError(`File not found: ${full}. Nothing was uploaded.`);
    if (statSync(full).isDirectory()) walk(full, full);
    else files.push({ path: full, key: `${prefix}${basename(full)}` });
  }
  return files;
}

async function upload(io: CliIo, argv: string[], flag?: string): Promise<number> {
  const prefixed = takeFlag(argv, "prefix");
  const [space, ...paths] = prefixed.rest;
  if (!space || !paths.length) throw new CliError("Usage: oahctl upload <space> <path...> [--prefix <dir/>]");
  const prefix = prefixed.value ? `${prefixed.value.replace(/^\/+|\/+$/g, "")}/` : "";
  const files = collectFiles(io, paths, prefix);
  if (!files.length) throw new CliError("No files to upload (hidden files are skipped).");
  const server = connect(io, flag);
  const saved: unknown[] = [];
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100);
    const result = (await callOrThrow(io.fetch, server, "storage_upload_link", { space, files: chunk.map((f) => ({ key: f.key })) })) as { links: { key: string; uploadUrl: string }[] };
    for (const file of chunk) {
      const link = result.links.find((l) => l.key === file.key);
      if (!link) throw new CliError(`The server returned no upload link for ${file.key}. Uploaded so far: ${saved.length}.`);
      const body = Readable.toWeb(createReadStream(file.path)) as unknown as ReadableStream;
      const res = await io.fetch(link.uploadUrl, { method: "PUT", body, headers: { "Content-Length": String(statSync(file.path).size) }, duplex: "half" } as RequestInit);
      const text = await res.text();
      if (!res.ok) throw new CliError(`Upload of ${file.path} as ${file.key} failed (HTTP ${res.status}): ${text}. Uploaded so far: ${saved.length}.`);
      try {
        saved.push(JSON.parse(text));
      } catch {
        saved.push({ key: file.key });
      }
    }
  }
  out(io, { ok: true, space, uploaded: saved });
  return 0;
}

async function download(io: CliIo, argv: string[], flag?: string): Promise<number> {
  const outFlag = takeFlag(argv, "out");
  const [space, ...keys] = outFlag.rest;
  if (!space || !keys.length) throw new CliError("Usage: oahctl download <space> <key...> [--out <dir>]");
  const dir = resolve(io.cwd, outFlag.value ?? ".");
  const server = connect(io, flag);
  const saved: { key: string; path: string; size: number }[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const result = (await callOrThrow(io.fetch, server, "storage_download_link", { space, keys: keys.slice(i, i + 100) })) as { links: { key: string; downloadUrl: string }[] };
    for (const link of result.links) {
      const target = resolve(dir, link.key);
      if (!target.startsWith(dir + sep)) throw new CliError(`Refusing to write ${link.key} outside ${dir}`);
      const res = await io.fetch(link.downloadUrl);
      if (!res.ok) throw new CliError(`Download of ${link.key} failed (HTTP ${res.status}). Saved so far: ${saved.length}.`);
      mkdirSync(dirname(target), { recursive: true });
      if (!res.body) throw new CliError(`Download of ${link.key} returned no body. Saved so far: ${saved.length}.`);
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(target));
      const size = statSync(target).size;
      saved.push({ key: link.key, path: target, size });
    }
  }
  out(io, { ok: true, space, saved });
  return 0;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    const { rest, server } = takeServerFlag(argv);
    const [command, ...args] = rest;
    switch (command) {
      case "--version":
      case "-v":
        out(io, io.version);
        return 0;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        return await help(io, args, server);
      case "login":
        await login(io, args);
        return 0;
      case "logout":
        logout(io, args);
        return 0;
      case "servers":
        servers(io, args, server);
        return 0;
      case "use":
        use(io, args);
        return 0;
      case "pin":
        pin(io, args);
        return 0;
      case "unpin":
        unpin(io, args);
        return 0;
      case "call":
        return await call(io, args, server);
      case "upload":
        return await upload(io, args, server);
      case "download":
        return await download(io, args, server);
      default:
        return await toolCommand(io, rest, connect(io, server));
    }
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function readSecretFromTty(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stderr.write(prompt);
  if (!stdin.isTTY) return readAllStdin();
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolvePromise) => {
    let value = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish();
          resolvePromise(value);
          return;
        }
        if (ch === "\u0003") {
          finish();
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export function processIo(version: string): CliIo {
  return {
    version,
    fetch: (input, init) => fetch(input, init),
    env: process.env,
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    stdoutIsTty: process.stdout.isTTY === true,
    stdinIsTty: process.stdin.isTTY === true,
    readStdin: readAllStdin,
    readSecret: readSecretFromTty,
  };
}
