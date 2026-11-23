export type JobLogLevel = "info" | "warn" | "error" | "system" | "step";
export type JobLogKind = "step" | "log" | "system" | "console";

export type JobLogEntry = {
  t: number;
  level: JobLogLevel;
  message: string;
  duration?: number;
  kind?: JobLogKind;
  error?: string;
  data?: unknown;
  attempts?: number;
};

const MAX_LOGS_BYTES = 500_000;
const RA_EVENT_PREFIX = "__RA_EVENT__";

function isValidEntry(e: unknown): e is JobLogEntry {
  if (!e || typeof e !== "object") return false;
  const row = e as Record<string, unknown>;
  return typeof row.t === "number" && typeof row.message === "string" && typeof row.level === "string";
}

export function parseJobLogs(raw: string | null | undefined): JobLogEntry[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(isValidEntry);
    } catch {
      /* legacy plain text */
    }
  }
  return [{ t: 0, level: "info", message: raw, kind: "console" }];
}

export function serializeJobLogs(entries: JobLogEntry[]): string {
  let keep = entries;
  let json = JSON.stringify(keep);
  while (keep.length > 1 && json.length > MAX_LOGS_BYTES) {
    const drop = Math.max(1, Math.floor(keep.length / 4));
    keep = keep.slice(drop);
    json = JSON.stringify(keep);
  }
  if (json.length > MAX_LOGS_BYTES) {
    json = json.slice(0, MAX_LOGS_BYTES);
  }
  return json;
}

export function inferLogLevel(message: string, stream: "stdout" | "stderr"): JobLogLevel {
  if (/warn(ing)?/i.test(message)) return "warn";
  if (stream === "stderr" || /error/i.test(message)) return "error";
  return "info";
}

export type RuntimeEvent = { type: "entry"; entry: JobLogEntry } | { type: "output"; value: unknown };

function offset(ms: number, startedAtMs: number): number {
  return Math.max(0, Math.round(ms - startedAtMs));
}

function parseRaEvent(line: string, startedAtMs: number): RuntimeEvent | null {
  if (!line.startsWith(RA_EVENT_PREFIX)) return null;
  try {
    const raw = JSON.parse(line.slice(RA_EVENT_PREFIX.length)) as Record<string, unknown>;
    const ts = typeof raw.ts === "number" ? raw.ts : Date.now();
    if (raw.kind === "output") return { type: "output", value: raw.value ?? null };
    if (raw.kind === "step") {
      const name = String(raw.name ?? "step");
      if (raw.phase === "start") return { type: "entry", entry: { t: offset(ts, startedAtMs), level: "step", kind: "step", message: name } };
      const duration = typeof raw.duration === "number" && raw.duration >= 0 ? raw.duration : 0;
      const start = typeof raw.startTs === "number" ? raw.startTs : ts - duration;
      const ok = raw.ok !== false;
      return {
        type: "entry",
        entry: {
          t: offset(start, startedAtMs),
          duration,
          level: ok ? "step" : "error",
          kind: "step",
          message: name,
          ...(typeof raw.attempts === "number" && raw.attempts > 1 ? { attempts: raw.attempts } : {}),
          ...(!ok && raw.error != null ? { error: String(raw.error) } : {}),
        },
      };
    }
    if (raw.kind === "log") {
      const levelRaw = String(raw.level ?? "info");
      const level: JobLogLevel = levelRaw === "warn" || levelRaw === "error" ? levelRaw : "info";
      return { type: "entry", entry: { t: offset(ts, startedAtMs), level, kind: "log", message: String(raw.message ?? ""), ...(raw.data !== undefined ? { data: raw.data } : {}) } };
    }
  } catch {
    return null;
  }
  return null;
}

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -\/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function createLineBuffer(stream: "stdout" | "stderr", startedAtMs: number, onLines: (entries: JobLogEntry[]) => void, onOutput: (value: unknown) => void = () => {}) {
  let buf = "";
  const emitLine = (rawLine: string) => {
    const line = stripAnsi(rawLine).replace(/\s+$/, "");
    if (!line.trim()) return;
    const event = parseRaEvent(line, startedAtMs);
    if (event?.type === "output") {
      onOutput(event.value);
      return;
    }
    if (event) {
      onLines([event.entry]);
      return;
    }
    onLines([
      {
        t: Math.max(0, Date.now() - startedAtMs),
        level: inferLogLevel(line, stream),
        message: line,
        kind: "console",
      },
    ]);
  };
  return {
    push(chunk: string) {
      if (!chunk) return;
      buf += chunk;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) emitLine(line);
    },
    flush() {
      if (!buf) return;
      emitLine(buf);
      buf = "";
    },
  };
}
