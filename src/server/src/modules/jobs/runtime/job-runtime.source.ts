import { readFileSync } from "node:fs";

const url = process.env.AGENTHANDS_URL ?? "";
const token = process.env.AGENTHANDS_TOKEN ?? "";
const EVENT_PREFIX = "__RA_EVENT__";
const MAX_OUTPUT_BYTES = 256_000;
const MAX_STEP_RETRIES = 10;
const DEFAULT_STEP_BACKOFF_MS = 1_000;
const MAX_STEP_BACKOFF_MS = 60_000;

export type RunTrigger = "cron" | "manual";

export interface RunContext {
  id: string;
  jobId: string;
  jobName: string;
  trigger: RunTrigger;
  attempt: number;
  maxAttempts: number;
  scheduledFor: string | null;
  lastSuccessAt: string | null;
  input: unknown;
}

export interface StepOptions {
  retries?: number;
  backoffMs?: number;
}

export interface QueryOptions {
  where?: Record<string, unknown> | Record<string, unknown>[];
  order_by?: { key: string; dir?: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
}

export type Row = Record<string, unknown>;

class AgenthandsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgenthandsError";
  }
}

function loadRun(): RunContext {
  const fallback: RunContext = { id: "", jobId: "", jobName: "", trigger: "manual", attempt: 1, maxAttempts: 1, scheduledFor: null, lastSuccessAt: null, input: null };
  const file = process.env.AGENTHANDS_RUN_FILE;
  if (!file) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<RunContext>) };
  } catch {
    return fallback;
  }
}

function emit(event: Record<string, unknown>) {
  process.stdout.write(`${EVENT_PREFIX}${JSON.stringify({ v: 2, ts: Date.now(), ...event })}\n`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

async function rpc<T = unknown>(ns: string, action: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!url || !token) throw new AgenthandsError("agenthands runtime is not configured");
  const res = await fetch(`${url.replace(/\/$/, "")}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agenthands-Token": token },
    body: JSON.stringify({ ns, action, args }),
  });
  let data: { ok?: boolean; result?: unknown; error?: string };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new AgenthandsError(`agenthands RPC failed: HTTP ${res.status}`);
  }
  if (!data.ok) throw new AgenthandsError(data.error || "agenthands call failed");
  return data.result as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function projectTable(projectOrBag: unknown, table?: unknown): { project: string; table: string; bag: Record<string, unknown> | null } {
  const bag = asRecord(projectOrBag);
  if (bag && ("project" in bag || "table" in bag)) return { project: String(bag.project ?? "").trim(), table: String(bag.table ?? "").trim(), bag };
  return { project: String(projectOrBag ?? "").trim(), table: String(table ?? "").trim(), bag: null };
}

function log(level: "info" | "warn" | "error", message: string, data?: unknown) {
  emit({ kind: "log", level, message: String(message ?? ""), ...(data === undefined ? {} : { data: toJson(data) }) });
}

let outputWritten = false;

type StorageData = string | Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>;

function storageUrl(space: string, key: string): string {
  const base = (process.env.AGENTHANDS_URL ?? "").replace(/\/$/, "");
  if (!base || !process.env.AGENTHANDS_TOKEN) throw new AgenthandsError("agenthands runtime is not configured");
  return base + "/storage/" + encodeURIComponent(space) + "/" + String(key).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

async function storageFailure(res: Response): Promise<never> {
  let message = "storage call failed: HTTP " + res.status;
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) message = data.error;
  } catch {}
  throw new AgenthandsError(message);
}

function storageSpace(name: string) {
  if (typeof name !== "string" || !name.trim()) throw new AgenthandsError("storage.space(name) needs a space name");
  const space = name.trim();
  const auth = () => ({ "X-Agenthands-Token": process.env.AGENTHANDS_TOKEN ?? "" });
  async function get(key: string): Promise<Uint8Array | null> {
    const res = await fetch(storageUrl(space, key), { headers: auth() });
    if (res.status === 404) return null;
    if (!res.ok) await storageFailure(res);
    return new Uint8Array(await res.arrayBuffer());
  }
  async function getText(key: string): Promise<string | null> {
    const bytes = await get(key);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }
  return {
    async put(key: string, data: StorageData, opts: { contentType?: string } = {}) {
      const headers: Record<string, string> = { ...auth() };
      if (opts.contentType) headers["Content-Type"] = opts.contentType;
      const res = await fetch(storageUrl(space, key), { method: "PUT", headers, body: data as BodyInit });
      if (!res.ok) await storageFailure(res);
      return ((await res.json()) as { result: unknown }).result;
    },
    get,
    getText,
    async getJson(key: string): Promise<unknown> {
      const text = await getText(key);
      return text === null ? null : JSON.parse(text);
    },
    async stream(key: string): Promise<ReadableStream<Uint8Array> | null> {
      const res = await fetch(storageUrl(space, key), { headers: auth() });
      if (res.status === 404) return null;
      if (!res.ok) await storageFailure(res);
      return res.body;
    },
    async list(prefix?: string) {
      return rpc("storage", "list", { space, prefix });
    },
    async delete(key: string) {
      return rpc("storage", "delete", { space, key });
    },
  };
}

function kvClient(project?: string) {
  return {
    async get<T = string | null>(key: string, defaultValue: T | null = null): Promise<string | T | null> {
      const result = await rpc<string | null>("kv", "get", { key, project });
      return result ?? defaultValue;
    },
    async set(key: string, value: string) {
      if (typeof value !== "string") throw new AgenthandsError("value must be a string. Use JSON.stringify for objects.");
      return rpc("kv", "set", { key, value, project });
    },
    async list() {
      return rpc<{ key: string; value: string }[]>("kv", "list", { project });
    },
    async delete(key: string) {
      return rpc("kv", "delete", { key, project });
    },
  };
}

const agenthands = {
  run: loadRun(),

  output(value: unknown) {
    const json = JSON.stringify(value === undefined ? null : value);
    if (json.length > MAX_OUTPUT_BYTES) throw new AgenthandsError(`output is ${json.length} bytes; the limit is ${MAX_OUTPUT_BYTES}. Store large data in a datatable and output a summary.`);
    outputWritten = true;
    emit({ kind: "output", value: JSON.parse(json) });
  },

  get hasOutput() {
    return outputWritten;
  },

  kv: {
    ...kvClient(),
    project(name: string) {
      if (typeof name !== "string" || !name.trim()) throw new AgenthandsError("kv.project(name) needs a project name");
      return kvClient(name.trim());
    },
  },

  storage: {
    space: storageSpace,
    async list_spaces() {
      return rpc("storage", "list_spaces");
    },
  },

  secrets: {
    async get<T = string | null>(key: string, defaultValue: T | null = null): Promise<string | T | null> {
      const result = await rpc<string | null>("secrets", "get", { key });
      return result ?? defaultValue;
    },
    async list() {
      return rpc<string[]>("secrets", "list");
    },
  },

  datatable: {
    async list_projects() {
      return rpc("datatable", "list_projects");
    },
    async get_schema(project: string) {
      return rpc("datatable", "get_schema", { project });
    },
    async query(project: string | ({ project: string; table: string } & QueryOptions), table?: string, opts: QueryOptions = {}) {
      const ref = projectTable(project, table);
      const o = (ref.bag ?? opts) as QueryOptions;
      return rpc("datatable", "query", { project: ref.project, table: ref.table, where: o.where, order_by: o.order_by, limit: o.limit ?? 50, offset: o.offset ?? 0 });
    },
    async insert(project: string | { project: string; table: string; rows: Row[] }, table?: string, rows: Row[] = []) {
      const ref = projectTable(project, table);
      return rpc("datatable", "insert", { project: ref.project, table: ref.table, rows: ref.bag ? (ref.bag.rows ?? []) : rows });
    },
    async update(project: string | { project: string; table: string; row_id: string; data: Row }, table?: string, rowId?: string, data: Row = {}) {
      const ref = projectTable(project, table);
      return rpc("datatable", "update", { project: ref.project, table: ref.table, row_id: String(ref.bag ? (ref.bag.row_id ?? "") : (rowId ?? "")), data: ref.bag ? (ref.bag.data ?? {}) : data });
    },
    async delete(project: string | { project: string; table: string; row_ids: string[] }, table?: string, rowIds: string[] = []) {
      const ref = projectTable(project, table);
      return rpc("datatable", "delete", { project: ref.project, table: ref.table, row_ids: ref.bag ? (ref.bag.row_ids ?? []) : rowIds });
    },
  },

  log: {
    info(message: string, data?: unknown) {
      log("info", message, data);
    },
    warn(message: string, data?: unknown) {
      log("warn", message, data);
    },
    error(message: string, data?: unknown) {
      log("error", message, data);
    },
  },

  async step<T>(name: string, fn: () => T | Promise<T>, opts: StepOptions = {}): Promise<T> {
    const label = String(name ?? "step").trim() || "step";
    const retries = Math.min(MAX_STEP_RETRIES, Math.max(0, Math.floor(opts.retries ?? 0)));
    const baseBackoff = Math.max(0, opts.backoffMs ?? DEFAULT_STEP_BACKOFF_MS);
    const startedAt = Date.now();
    emit({ kind: "step", name: label, phase: "start" });
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await fn();
        emit({ kind: "step", name: label, phase: "end", ok: true, startTs: startedAt, duration: Date.now() - startedAt, attempts: attempt });
        return result;
      } catch (err) {
        if (attempt > retries) {
          emit({ kind: "step", name: label, phase: "end", ok: false, startTs: startedAt, duration: Date.now() - startedAt, attempts: attempt, error: errorMessage(err) });
          throw err;
        }
        const wait = Math.min(MAX_STEP_BACKOFF_MS, baseBackoff * 2 ** (attempt - 1));
        log("warn", `${label} failed (try ${attempt} of ${retries + 1}): ${errorMessage(err)}. Retrying in ${wait}ms`);
        await Bun.sleep(wait);
      }
    }
  },
};

export default agenthands;
