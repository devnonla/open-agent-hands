import rootPkg from "../../../../../package.json" with { type: "json" };
import { EMBEDDED_WEB_ASSETS } from "../../embedded-assets.js";

export type InstallKind = "docker" | "desktop" | "binary" | "source";

export interface UpdateInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  install: InstallKind;
  command: string | null;
  checkedAt: number | null;
}

const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const RETRY_TTL_MS = 30 * 60 * 1000;

let cached: { latest: string | null; releaseUrl: string | null; checkedAt: number; expiresAt: number } | null = null;
let inFlight: Promise<void> | null = null;

function updateRepo(): string | null {
  const repo = (process.env.AGENTHANDS_UPDATE_REPO ?? "devnonla/open-agent-hands").trim();
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
}

export function installKind(): InstallKind {
  if (process.env.AGENTHANDS_INSTALL === "docker") return "docker";
  if (process.execPath.includes(".app/Contents/MacOS/")) return "desktop";
  if (Object.keys(EMBEDDED_WEB_ASSETS).length > 0) return "binary";
  return "source";
}

function updateCommand(kind: InstallKind, repo: string): string | null {
  if (kind === "docker") return "docker compose pull && docker compose up -d";
  if (kind === "binary") return `curl -fsSL https://github.com/${repo}/releases/latest/download/install.sh | sh`;
  return null;
}

function parseVersion(value: string): number[] | null {
  const m = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

async function fetchLatest(repo: string): Promise<void> {
  const now = Date.now();
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "agenthands-update-check" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = body.tag_name ? body.tag_name.replace(/^v/, "") : null;
    cached = { latest, releaseUrl: body.html_url ?? null, checkedAt: now, expiresAt: now + CHECK_TTL_MS };
  } catch (err) {
    console.warn(`[update-check] ${err instanceof Error ? err.message : String(err)}`);
    cached = { latest: cached?.latest ?? null, releaseUrl: cached?.releaseUrl ?? null, checkedAt: cached?.checkedAt ?? 0, expiresAt: now + RETRY_TTL_MS };
  }
}

export async function getUpdateInfo(): Promise<UpdateInfo> {
  const current = rootPkg.version;
  const install = installKind();
  const repo = updateRepo();
  const base: UpdateInfo = { current, latest: null, updateAvailable: false, releaseUrl: null, install, command: null, checkedAt: null };
  if (!repo || install === "desktop" || install === "source") return base;

  if (!cached || cached.expiresAt <= Date.now()) {
    inFlight ??= fetchLatest(repo).finally(() => {
      inFlight = null;
    });
    await inFlight;
  }

  const latest = cached?.latest ?? null;
  return {
    ...base,
    latest,
    updateAvailable: latest ? isNewerVersion(latest, current) : false,
    releaseUrl: cached?.releaseUrl ?? null,
    command: updateCommand(install, repo),
    checkedAt: cached?.checkedAt ? Math.floor(cached.checkedAt / 1000) : null,
  };
}
