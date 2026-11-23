import type { JobLogEntry, JobLogLevel, JobRun } from "src/common/types";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`, "g");
const LINE_BURST_MS = 50;

export type LineLevel = Exclude<JobLogLevel, "step" | "system">;

export type LogBlock =
  | { type: "system"; key: string; t: number; message: string; level: "info" | "warn" | "error" }
  | { type: "lines"; key: string; t: number; level: LineLevel; source: "log" | "console"; lines: string[]; data?: unknown }
  | { type: "step"; key: string; t: number; name: string; duration: number | null; failed: boolean; error: string | null; attempts: number; children: LogBlock[] };

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function normalizeLogs(logs: JobRun["logs"] | string | null | undefined): JobLogEntry[] {
  if (!logs) return [];
  if (Array.isArray(logs)) return logs;
  const trimmed = logs.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as JobLogEntry[];
    } catch {
      return [{ t: 0, level: "info", message: logs, kind: "console" }];
    }
  }
  return [{ t: 0, level: "info", message: logs, kind: "console" }];
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const TIMESTAMP_PRECISION_MS = 1000;

export function runDurationMs(run: JobRun, now = Date.now()): number | null {
  const start = new Date(run.startedAt).getTime();
  if (!Number.isFinite(start)) return null;
  if (run.status === "queued") return 0;
  if (!run.finishedAt) return Math.max(0, now - start);
  const wall = Math.max(0, new Date(run.finishedAt).getTime() - start);
  const fromLogs = normalizeLogs(run.logs).reduce((max, e) => Math.max(max, e.t + (e.duration ?? 0)), 0);
  return fromLogs > 0 && Math.abs(wall - fromLogs) <= TIMESTAMP_PRECISION_MS ? fromLogs : wall;
}

function isStep(e: JobLogEntry) {
  return e.kind === "step" || e.level === "step";
}

function isSystem(e: JobLogEntry) {
  return e.kind === "system" || e.level === "system";
}

function lineLevel(e: JobLogEntry): LineLevel {
  return e.level === "error" || e.level === "warn" ? e.level : "info";
}

function groupLines(entries: JobLogEntry[], keyPrefix: string): LogBlock[] {
  const blocks: LogBlock[] = [];
  let lastT = Number.NEGATIVE_INFINITY;
  entries.forEach((e, i) => {
    const gap = e.t - lastT;
    lastT = e.t;
    const message = stripAnsi(e.message).replace(/\s+$/, "");
    if (isSystem(e)) {
      blocks.push({ type: "system", key: `${keyPrefix}s${i}`, t: e.t, message, level: e.level === "error" || e.level === "warn" ? e.level : "info" });
      return;
    }
    const level = lineLevel(e);
    const source = e.kind === "log" ? "log" : "console";
    const last = blocks[blocks.length - 1];
    if (last?.type === "lines" && last.level === level && last.source === source && last.data === undefined && e.data === undefined && gap <= LINE_BURST_MS) {
      last.lines.push(message);
      return;
    }
    blocks.push({ type: "lines", key: `${keyPrefix}l${i}`, t: e.t, level, source, lines: [message], ...(e.data !== undefined ? { data: e.data } : {}) });
  });
  return blocks;
}

const STEP_PAIR_WINDOW_MS = 5_000;

function pairSteps(entries: Array<{ e: JobLogEntry; i: number }>): Array<{ i: number; e: JobLogEntry; consumed: number[] }> {
  const starts = entries.filter(({ e }) => isStep(e) && e.duration == null);
  const ends = entries.filter(({ e }) => isStep(e) && e.duration != null);
  const used = new Set<number>();
  const steps: Array<{ i: number; e: JobLogEntry; consumed: number[] }> = [];
  for (const end of ends) {
    const start = starts.find(({ e, i }) => !used.has(i) && e.message === end.e.message && e.t <= end.e.t + STEP_PAIR_WINDOW_MS);
    if (!start) {
      steps.push({ i: end.i, e: end.e, consumed: [] });
      continue;
    }
    used.add(start.i);
    steps.push({ i: start.i, e: { ...end.e, t: start.e.t }, consumed: [end.i] });
  }
  for (const start of starts) if (!used.has(start.i)) steps.push({ i: start.i, e: start.e, consumed: [] });
  return steps;
}

export function buildLogBlocks(raw: JobLogEntry[]): LogBlock[] {
  const entries = raw.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i);
  const steps = pairSteps(entries);
  const stepAt = new Map(steps.map((step) => [step.i, step]));
  const hidden = new Set(steps.flatMap((step) => step.consumed));

  const ownerOf = (log: JobLogEntry): number | null => {
    let best: { i: number; start: number; span: number } | null = null;
    for (const { e, i } of steps) {
      const span = e.duration ?? Number.POSITIVE_INFINITY;
      if (log.t < e.t || log.t > e.t + span) continue;
      if (!best || e.t > best.start || (e.t === best.start && span < best.span)) best = { i, start: e.t, span };
    }
    return best?.i ?? null;
  };

  const children = new Map<number, JobLogEntry[]>();
  const top: Array<{ kind: "step"; i: number; e: JobLogEntry } | { kind: "entry"; e: JobLogEntry }> = [];
  for (const { e, i } of entries) {
    if (isStep(e)) {
      const step = stepAt.get(i);
      if (step && !hidden.has(i)) top.push({ kind: "step", i, e: step.e });
      continue;
    }
    const owner = isSystem(e) ? null : ownerOf(e);
    if (owner == null) {
      top.push({ kind: "entry", e });
      continue;
    }
    const list = children.get(owner) ?? [];
    list.push(e);
    children.set(owner, list);
  }

  const blocks: LogBlock[] = [];
  let pending: JobLogEntry[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    blocks.push(...groupLines(pending, `t${blocks.length}-`));
    pending = [];
  };
  for (const item of top) {
    if (item.kind === "entry") {
      pending.push(item.e);
      continue;
    }
    flush();
    blocks.push({ type: "step", key: `step${item.i}`, t: item.e.t, name: stripAnsi(item.e.message), duration: item.e.duration ?? null, failed: item.e.level === "error", error: item.e.error ?? null, attempts: item.e.attempts ?? 1, children: groupLines(children.get(item.i) ?? [], `c${item.i}-`) });
  }
  flush();
  return mergeSplitOutput(blocks);
}

function mergeSplitOutput(blocks: LogBlock[]): LogBlock[] {
  for (let i = 0; i < blocks.length - 1; i++) {
    const step = blocks[i];
    const next = blocks[i + 1];
    if (step.type !== "step" || next.type !== "lines" || next.source !== "console" || next.data !== undefined) continue;
    const tail = step.children[step.children.length - 1];
    if (tail?.type !== "lines" || tail.data !== undefined || tail.source !== "console" || tail.level !== next.level || next.t - tail.t > LINE_BURST_MS) continue;
    step.children = step.children.slice(0, -1);
    blocks[i + 1] = { ...next, t: tail.t, lines: [...tail.lines, ...next.lines] };
  }
  return blocks;
}

const ERROR_LINE = /^\s*(?:[A-Za-z]*Error|error)(?:\s*\[[^\]]*\])?:\s*\S/;

export function isActiveRun(run: Pick<JobRun, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

export function runHeadline(run: JobRun): { title: string; detail: string | null } | null {
  if (run.status !== "failed") return null;
  const entries = normalizeLogs(run.logs);
  const failedStep = entries.find((e) => isStep(e) && e.level === "error" && e.error);
  const lines = entries.filter((e) => !isStep(e) && !isSystem(e) && e.level === "error").flatMap((e) => stripAnsi(e.message).split("\n"));
  const thrown = lines.find((line) => ERROR_LINE.test(line));
  const logged = entries.find((e) => e.kind === "log" && e.level === "error");
  const title = thrown?.trim() ?? (failedStep ? `${stripAnsi(failedStep.message)}: ${failedStep.error}` : null) ?? (logged ? stripAnsi(logged.message) : null) ?? run.error ?? "Run failed";
  const detail = run.error && run.error !== title ? run.error : null;
  return { title, detail };
}

export function linesLabel(lines: string[]): string {
  const thrown = lines.find((line) => ERROR_LINE.test(line));
  return (thrown ?? lines.find((line) => line.trim()) ?? "").trim();
}
