import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";

export const PROJECT_FILE = ".agenthands.json";
export const LOCAL_URL = "http://127.0.0.1:8429";

export type ServerProfile = { url: string; key: string };

export type CliConfig = { default?: string; servers: Record<string, ServerProfile> };

export type ResolvedServer = { name: string; url: string; key: string; source: string };

export type CliEnv = Record<string, string | undefined>;

export class CliError extends Error {}

export function configPath(env: CliEnv): string {
  if (env.AGENTHANDS_CONFIG_DIR) return join(env.AGENTHANDS_CONFIG_DIR, "credentials.json");
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "agenthands", "credentials.json");
}

export function loadConfig(env: CliEnv): CliConfig {
  const path = configPath(env);
  if (!existsSync(path)) return { servers: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new CliError(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}. Fix or delete the file, then run oahctl login again.`);
  }
  const config = (parsed ?? {}) as Partial<CliConfig>;
  return { default: typeof config.default === "string" ? config.default : undefined, servers: config.servers && typeof config.servers === "object" ? config.servers : {} };
}

export function saveConfig(env: CliEnv, config: CliConfig): void {
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function normalizeUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `${/^(localhost|127\.|\[::1\])/.test(raw) ? "http" : "https"}://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CliError(`"${raw}" is not a valid server URL. Example: oahctl login https://hands.example.com`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function defaultServerName(url: string): string {
  const host = new URL(url).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "local";
  return host.split(".")[0] || host;
}

export function assertServerName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(name)) throw new CliError(`Server name "${name}" is not allowed. Use letters, digits, - and _ (max 40).`);
  return name;
}

export function findProjectFile(cwd: string): string | null {
  let dir = cwd;
  const root = parse(dir).root;
  while (true) {
    const candidate = join(dir, PROJECT_FILE);
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

function readProjectServer(path: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new CliError(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const server = (parsed as { server?: unknown } | null)?.server;
  if (typeof server !== "string" || !server) throw new CliError(`${path} must look like { "server": "<name>" }`);
  return server;
}

function known(config: CliConfig): string {
  const names = Object.keys(config.servers);
  return names.length ? `Known servers: ${names.join(", ")}.` : "No servers yet.";
}

function pick(config: CliConfig, name: string, source: string): ResolvedServer {
  const profile = config.servers[name];
  if (!profile) throw new CliError(`Server "${name}" (from ${source}) is not logged in. ${known(config)} Run oahctl login <url> --name ${name}.`);
  return { name, url: profile.url, key: profile.key, source };
}

export function resolveServer(config: CliConfig, opts: { flag?: string; env: CliEnv; cwd: string }): ResolvedServer {
  if (opts.flag) return pick(config, opts.flag, "--server");
  if (opts.env.AGENTHANDS_SERVER) return pick(config, opts.env.AGENTHANDS_SERVER, "AGENTHANDS_SERVER");
  if (opts.env.AGENTHANDS_URL && opts.env.AGENTHANDS_KEY) {
    const url = normalizeUrl(opts.env.AGENTHANDS_URL);
    return { name: defaultServerName(url), url, key: opts.env.AGENTHANDS_KEY, source: "AGENTHANDS_URL" };
  }
  const projectFile = findProjectFile(opts.cwd);
  if (projectFile) return pick(config, readProjectServer(projectFile), projectFile);
  const names = Object.keys(config.servers);
  if (!names.length) throw new CliError("Not logged in to any Agent Hands server. Run oahctl login (local) or oahctl login <url> --name <name>.");
  if (config.default && config.servers[config.default]) return pick(config, config.default, "default");
  if (names.length === 1) return pick(config, names[0], "only server");
  throw new CliError(`Several servers are logged in and none is the default. ${known(config)} Pass --server <name>, run oahctl use <name>, or pin this folder with oahctl pin <name>.`);
}
