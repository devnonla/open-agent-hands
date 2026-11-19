import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readCapturedOutput, spawnCaptured, unlinkCaptured } from "../../sandbox/index.js";
import { getDataDir } from "../../utils/data-dir.js";

const DEFAULT_MAX_CHARS = 8_000;
const HARD_MAX_CHARS = 16_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const HARD_MAX_TIMEOUT_MS = 60_000;

export type WebFetchOutput = "md" | "html" | "snapshot";
export type WebFetchEngine = "browser";

const outputEnum = z.enum(["md", "html", "snapshot"]);

const RELEASE_BASE = "https://github.com/h4ckf0r0day/obscura/releases/latest/download";

export type WebFetchResult = Record<string, unknown>;

export type ObscuraRunResult = { code: number; stdout: string; stderr: string };

export type ObscuraRunner = {
  resolveBin: () => string | null | Promise<string | null>;
  run: (bin: string, args: string[], timeoutMs: number) => Promise<ObscuraRunResult>;
};

export function obscuraReleaseAsset(): string | null {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "obscura-aarch64-macos.tar.gz";
  if (platform === "darwin" && arch === "x64") return "obscura-x86_64-macos.tar.gz";
  if (platform === "linux" && arch === "arm64") return "obscura-aarch64-linux.tar.gz";
  if (platform === "linux" && arch === "x64") return "obscura-x86_64-linux.tar.gz";
  return null;
}

function cachedObscuraPath(): string {
  return join(getDataDir(), "bin", "obscura");
}

function existingObscuraBin(): string | null {
  const which = Bun.which("obscura");
  if (which) return which;
  const cached = cachedObscuraPath();
  return existsSync(cached) ? cached : null;
}

let obscuraDownload: Promise<string | null> | null = null;

async function downloadObscura(): Promise<string | null> {
  const asset = obscuraReleaseAsset();
  if (!asset) return null;
  const dest = cachedObscuraPath();
  const binDir = join(getDataDir(), "bin");
  await mkdir(binDir, { recursive: true });
  const stage = await mkdtemp(join(tmpdir(), "obscura-"));
  const archive = join(stage, asset);
  try {
    const res = await fetch(`${RELEASE_BASE}/${asset}`, { redirect: "follow" });
    if (!res.ok) {
      throw new Error(`Obscura download failed (${res.status})`);
    }
    await Bun.write(archive, res);
    const extract = Bun.spawn(["tar", "-xzf", archive, "-C", stage], { stdout: "ignore", stderr: "pipe" });
    const code = await extract.exited;
    if (code !== 0) {
      const err = await new Response(extract.stderr).text();
      throw new Error(`Obscura extract failed: ${err.trim() || `exit ${code}`}`);
    }
    const extracted = join(stage, "obscura");
    if (!existsSync(extracted)) {
      throw new Error("Obscura archive did not contain an obscura binary");
    }
    const worker = join(stage, "obscura-worker");
    if (existsSync(worker)) {
      const workerDest = join(binDir, "obscura-worker");
      const workerTmp = `${workerDest}.download`;
      await rename(worker, workerTmp);
      await chmod(workerTmp, 0o755);
      await rename(workerTmp, workerDest);
    }
    const tmp = `${dest}.download`;
    await rename(extracted, tmp);
    await chmod(tmp, 0o755);
    await rename(tmp, dest);
    return dest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function ensureObscuraBin(): Promise<string | null> {
  const env = process.env.OBSCURA_BIN?.trim();
  if (env) {
    if (existsSync(env)) return env;
    throw new Error(`OBSCURA_BIN does not exist: ${env}`);
  }
  const hit = existingObscuraBin();
  if (hit) return hit;
  if (!obscuraDownload) {
    obscuraDownload = downloadObscura().finally(() => {
      obscuraDownload = null;
    });
  }
  return obscuraDownload;
}

export const defaultObscuraRunner: ObscuraRunner = {
  resolveBin: () => ensureObscuraBin(),
  async run(bin, args, timeoutMs) {
    const captured = await spawnCaptured([bin, ...args], {
      env: { ...process.env },
    });
    const killer = setTimeout(() => captured.kill(), timeoutMs);
    try {
      const code = (await captured.exited) ?? 1;
      const { stdout, stderr } = await readCapturedOutput(captured);
      return { code, stdout, stderr };
    } finally {
      clearTimeout(killer);
      await unlinkCaptured(captured);
    }
  },
};

let obscuraRunner: ObscuraRunner = defaultObscuraRunner;

export function _setObscuraRunnerForTest(runner: ObscuraRunner | null) {
  obscuraRunner = runner ?? defaultObscuraRunner;
}

function clipText(text: string, maxChars: number): { text: string; truncated?: true; length?: number } {
  if (text.length <= maxChars) return { text };
  const body = text.slice(0, maxChars);
  return {
    text: `${body}\n\n[truncated: showing ${maxChars} of ${text.length} chars]`,
    truncated: true,
    length: text.length,
  };
}

function isHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

function dumpFlag(output: WebFetchOutput): string {
  if (output === "md") return "markdown";
  if (output === "html") return "html";
  return "text";
}

async function fetchObscura(url: URL, output: WebFetchOutput, timeoutMs: number, maxChars: number): Promise<WebFetchResult> {
  let bin: string | null;
  try {
    bin = (await obscuraRunner.resolveBin()) ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, url: url.toString(), output, engine: "browser" satisfies WebFetchEngine, error: msg };
  }
  if (!bin) {
    const asset = obscuraReleaseAsset();
    const error = asset ? `Obscura is not available. Set OBSCURA_BIN or install the release archive (${asset}).` : "Obscura is not supported on this platform.";
    return { ok: false, url: url.toString(), output, engine: "browser" satisfies WebFetchEngine, error };
  }

  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const args = ["fetch", "-q", "--dump", dumpFlag(output), "--wait-until", "load", "--timeout", String(timeoutSec), url.toString()];

  try {
    const ran = await obscuraRunner.run(bin, args, timeoutMs + 5_000);
    if (ran.code !== 0) {
      const detail = (ran.stderr || ran.stdout).trim() || `exit ${ran.code}`;
      return {
        ok: false,
        url: url.toString(),
        output,
        engine: "browser" satisfies WebFetchEngine,
        error: `Obscura failed: ${detail.slice(0, 500)}`,
      };
    }

    const clipped = clipText(ran.stdout, maxChars);
    return {
      ok: true,
      url: url.toString(),
      output,
      engine: "browser" satisfies WebFetchEngine,
      text: clipped.text,
      ...(clipped.truncated ? { truncated: true as const, length: clipped.length } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, url: url.toString(), output, engine: "browser" satisfies WebFetchEngine, error: msg };
  }
}

export async function runWebFetch(input: {
  url: string;
  output?: WebFetchOutput;
  timeout_ms?: number;
  max_chars?: number;
}): Promise<WebFetchResult> {
  const parsed = isHttpUrl(input.url.trim());
  if (!parsed) {
    return { ok: false, error: "Only http:// and https:// URLs are allowed" };
  }

  const timeoutMs = Math.min(HARD_MAX_TIMEOUT_MS, Math.max(1_000, input.timeout_ms ?? DEFAULT_TIMEOUT_MS));
  const maxChars = Math.min(HARD_MAX_CHARS, Math.max(500, input.max_chars ?? DEFAULT_MAX_CHARS));
  const output: WebFetchOutput = input.output ?? "md";

  return fetchObscura(parsed, output, timeoutMs, maxChars);
}

const DESCRIPTION = `Fetch a URL and return JS-rendered page content (Obscura). GET only.

output:
- md (default) — main content as Markdown (best for reading articles/docs)
- html — full serialized DOM after JS (includes script, style, markup)
- snapshot — visible page text (no tags)

Always executes page JavaScript (SPA-safe). Response text is capped (default 8k, max 16k chars). When clipped, text ends with [truncated: showing N of M chars] and the payload includes truncated=true and length=M.`;

export const webFetchTool = tool(async (input) => JSON.stringify(await runWebFetch(input)), {
  name: "nonla_web_fetch",
  description: DESCRIPTION,
  schema: z.object({
    url: z.string().describe("http(s) URL to fetch"),
    output: outputEnum.optional().describe("md = Markdown (default, for reading); html = full DOM after JS incl. script/style; snapshot = visible page text"),
    timeout_ms: z.number().optional().describe("Timeout in ms (default 30000, max 60000)"),
    max_chars: z.number().optional().describe("Max characters of text to return (default 8000, max 16000)"),
  }),
});

export const TOOL_DEF = {
  toolName: "nonla_web_fetch",
  toolLabel: "Web Fetch",
  description: "Fetch a URL with JS rendering (Obscura). output: md (default Markdown), html, snapshot.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "http(s) URL to fetch" },
      output: {
        type: "string",
        enum: ["md", "html", "snapshot"],
        description: "md = Markdown (default, for reading); html = full DOM after JS incl. script/style; snapshot = visible page text",
      },
      timeout_ms: { type: "number", description: "Timeout in ms (default 30000, max 60000)" },
      max_chars: { type: "number", description: "Max characters of text to return (default 8000, max 16000)" },
    },
    required: ["url"],
  },
};
