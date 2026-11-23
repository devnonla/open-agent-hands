import { jobRunDir } from "../../common/utils/data-paths.js";
import { rmSync } from "node:fs";
import { BadRequestException } from "../../common/exceptions/http.exception.js";
import { followCaptureFile, rewriteSandboxTs, spawnCaptured, unlinkCaptured } from "../../common/sandbox/index.js";
import { startRuntimeProxy } from "../tools/common/runtime-proxy.js";
import { type JobLogEntry, createLineBuffer } from "./common/job-logs.js";
import { writeRuntimePackages } from "../tools/common/runtime-sdk.js";
import { JOBS_RUNTIME_INDEX_TS } from "./jobs-runtime-sdk.js";
import { appendRunLogEntries, extendJobLease, finishJobRun, getDraftCode, getJob, getJobRun, isActiveRunStatus, lastSuccessAt, markRunStarted, retryDelayMs, runBudgetMs, setRunAttempts, toPublicJobRun, tryClaimJob } from "./jobs.service.js";

const MAX_CONCURRENT = 3;
let activeRuns = 0;
const queue: Array<() => void> = [];

/** In-flight run abort controllers — keyed by runId. */
const runAborts = new Map<string, AbortController>();

function acquireSlot(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (activeRuns < MAX_CONCURRENT) {
    activeRuns += 1;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const take = () => {
      signal.removeEventListener("abort", onAbort);
      activeRuns += 1;
      resolve(true);
    };
    const onAbort = () => {
      const index = queue.indexOf(take);
      if (index >= 0) queue.splice(index, 1);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    queue.push(take);
  });
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export interface RunContextFile {
  id: string;
  jobId: string;
  jobName: string;
  trigger: "cron" | "manual";
  attempt: number;
  maxAttempts: number;
  scheduledFor: string | null;
  lastSuccessAt: string | null;
  input: unknown;
}

function formatMs(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

function releaseSlot() {
  activeRuns = Math.max(0, activeRuns - 1);
  const next = queue.shift();
  if (next) next();
}

async function writeRunDir(runId: string, code: string, context: RunContextFile | undefined): Promise<string> {
  const dir = jobRunDir(runId);
  await writeRuntimePackages(dir, JOBS_RUNTIME_INDEX_TS);

  await Bun.write(`${dir}/package.json`, JSON.stringify({ name: `job-run-${runId}`, type: "module" }));
  await Bun.write(`${dir}/main.ts`, rewriteSandboxTs(code));
  if (context) await Bun.write(`${dir}/run.json`, JSON.stringify(context));
  return dir;
}

function cleanupRunDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export async function runBunScript(opts: {
  code: string;
  runId: string;
  timeoutMs: number;
  startedAtMs?: number;
  onLogEntries?: (entries: JobLogEntry[]) => void;
  onOutput?: (value: unknown) => void;
  abortSignal?: AbortSignal;
  context?: RunContextFile;
}): Promise<{ exitCode: number; entries: JobLogEntry[]; timedOut: boolean; cancelled: boolean }> {
  const proxy = startRuntimeProxy();
  const runDir = await writeRunDir(opts.runId, opts.code, opts.context);
  const startedAtMs = opts.startedAtMs ?? Date.now();
  const entries: JobLogEntry[] = [];
  const onLogEntries = opts.onLogEntries ?? (() => {});

  const pushEntries = (batch: JobLogEntry[]) => {
    entries.push(...batch);
    onLogEntries(batch);
  };

  try {
    if (opts.abortSignal?.aborted) {
      return { exitCode: 1, entries, timedOut: false, cancelled: true };
    }

    const captured = await spawnCaptured([process.execPath, "run", "main.ts"], {
      cwd: runDir,
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
        ...proxy.env,
        ...(opts.context ? { AGENTHANDS_RUN_FILE: `${runDir}/run.json` } : {}),
      },
    });

    try {
      let timedOut = false;
      let cancelled = false;

      const killer = setTimeout(() => {
        timedOut = true;
        captured.kill();
      }, opts.timeoutMs);

      const onAbort = () => {
        cancelled = true;
        captured.kill();
      };
      opts.abortSignal?.addEventListener("abort", onAbort, { once: true });
      if (opts.abortSignal?.aborted) onAbort();

      const stdoutBuf = createLineBuffer("stdout", startedAtMs, pushEntries, opts.onOutput);
      const stderrBuf = createLineBuffer("stderr", startedAtMs, pushEntries, opts.onOutput);

      const [, , exitCode] = await Promise.all([followCaptureFile(captured.stdoutPath, (chunk) => stdoutBuf.push(chunk), captured.exited), followCaptureFile(captured.stderrPath, (chunk) => stderrBuf.push(chunk), captured.exited), captured.exited]);
      clearTimeout(killer);
      opts.abortSignal?.removeEventListener("abort", onAbort);
      stdoutBuf.flush();
      stderrBuf.flush();

      return { exitCode, entries, timedOut, cancelled };
    } finally {
      await unlinkCaptured(captured);
    }
  } finally {
    proxy.stop();
    cleanupRunDir(runDir);
  }
}

export async function executeJobRun(opts: { jobId: string; runId: string; advanceSchedule: boolean; codeOverride?: string }): Promise<void> {
  const abort = new AbortController();
  runAborts.set(opts.runId, abort);
  const finish = (fields: { status: "success" | "failed"; error: string | null; output?: unknown; attempts?: number; logs?: JobLogEntry[] }) => finishJobRun({ jobId: opts.jobId, runId: opts.runId, advanceSchedule: opts.advanceSchedule, ...fields });

  const acquired = await acquireSlot(abort.signal);
  try {
    if (!acquired || abort.signal.aborted) {
      await finish({ status: "failed", error: "Cancelled", logs: [{ t: 0, level: "system", message: "Cancelled before it started", kind: "system" }] });
      return;
    }

    const job = await getJob(opts.jobId);
    const run = await getJobRun(opts.runId);
    if (!job || !run) {
      await finish({ status: "failed", error: "Job not found", logs: [] });
      return;
    }

    const startedAtMs = Date.now();
    const maxAttempts = job.maxRetries + 1;
    await markRunStarted(opts.runId, new Date(startedAtMs), 1);
    await extendJobLease(opts.jobId, new Date(startedAtMs + runBudgetMs(job)));

    const code = opts.codeOverride ?? job.code;
    const timeoutMs = job.timeoutMs > 0 ? job.timeoutMs : 300_000;
    const previousSuccess = await lastSuccessAt(opts.jobId);
    const baseContext = {
      id: run.id,
      jobId: job.id,
      jobName: job.name,
      trigger: run.trigger,
      maxAttempts,
      scheduledFor: run.scheduledFor ? new Date(run.scheduledFor).toISOString() : null,
      lastSuccessAt: previousSuccess ? new Date(previousSuccess).toISOString() : null,
      input: toPublicJobRun(run).input,
    };

    let logChain: Promise<void> = Promise.resolve();
    const appendLogs = (batch: JobLogEntry[]) => {
      logChain = logChain.then(() => appendRunLogEntries(opts.runId, batch)).catch((err) => console.error("[jobs] append logs failed", err));
    };
    const since = () => Date.now() - startedAtMs;

    appendLogs([{ t: 0, level: "system", message: "Run started", kind: "system" }]);

    let output: unknown;
    let failure = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        await setRunAttempts(opts.runId, attempt);
        appendLogs([{ t: since(), level: "system", message: `Attempt ${attempt} of ${maxAttempts}`, kind: "system" }]);
      }
      output = undefined;
      const result = await runBunScript({
        code,
        runId: opts.runId,
        timeoutMs,
        startedAtMs,
        abortSignal: abort.signal,
        context: { ...baseContext, attempt },
        onLogEntries: appendLogs,
        onOutput: (value) => {
          output = value;
        },
      });
      await logChain;

      if (result.cancelled || abort.signal.aborted) {
        await finish({ status: "failed", error: "Cancelled", attempts: attempt });
        return;
      }
      failure = result.timedOut ? `Timed out after ${formatMs(timeoutMs)} (timeout_ms=${timeoutMs})` : result.exitCode !== 0 ? `Exited with code ${result.exitCode}` : "";
      if (!failure) {
        await finish({ status: "success", error: null, output: output ?? null, attempts: attempt });
        return;
      }
      if (attempt < maxAttempts) {
        const wait = retryDelayMs(attempt);
        appendLogs([{ t: since(), level: "warn", message: `Attempt ${attempt} failed: ${failure}. Retrying in ${formatMs(wait)}`, kind: "system" }]);
        await logChain;
        await sleepUnlessAborted(wait, abort.signal);
        if (abort.signal.aborted) {
          await finish({ status: "failed", error: "Cancelled", attempts: attempt });
          return;
        }
      }
    }
    await finish({ status: "failed", error: maxAttempts > 1 ? `${failure} (after ${maxAttempts} attempts)` : failure, output: output ?? undefined, attempts: maxAttempts });
  } catch (err) {
    await finish({ status: "failed", error: abort.signal.aborted ? "Cancelled" : err instanceof Error ? err.message : String(err) });
  } finally {
    runAborts.delete(opts.runId);
    if (acquired) releaseSlot();
  }
}

/** Cancel a running job run — kills the Bun process and marks the run failed. */
export async function cancelJobRun(jobId: string, runId: string) {
  const run = await getJobRun(runId);
  if (!run || run.jobId !== jobId) throw new BadRequestException("Run not found");
  if (!isActiveRunStatus(run.status)) throw new BadRequestException("Run is not running");

  const abort = runAborts.get(runId);
  if (abort) {
    abort.abort();
    await appendRunLogEntries(runId, [{ t: Math.max(0, Date.now() - new Date(run.startedAt).getTime()), level: "system", message: "Cancel requested", kind: "system" }]);
    return toPublicJobRun((await getJobRun(runId))!);
  }

  // Process not tracked (orphaned / different instance) — mark failed and clear lease
  await finishJobRun({
    jobId,
    runId,
    status: "failed",
    logs: undefined,
    error: "Cancelled",
    advanceSchedule: false,
  });
  return toPublicJobRun((await getJobRun(runId))!);
}

export async function runDraftJobCode(jobId: string): Promise<{ started: boolean; runId?: string; error?: string }> {
  const job = await getJob(jobId);
  if (!job) return { started: false, error: "Job not found" };
  const code = await getDraftCode(jobId);
  if (!code?.trim()) return { started: false, error: "No draft code available." };

  const claimed = await tryClaimJob(jobId, "manual");
  if (!claimed) {
    return { started: false, error: "Job is already running or could not be claimed" };
  }

  void executeJobRun({
    jobId,
    runId: claimed.run.id,
    advanceSchedule: false,
    codeOverride: code,
  });

  return { started: true, runId: claimed.run.id };
}

export async function runLiveJobCode(jobId: string): Promise<{ started: boolean; runId?: string; error?: string }> {
  const job = await getJob(jobId);
  if (!job) return { started: false, error: "Job not found" };
  const code = job.code;
  if (!code?.trim()) return { started: false, error: "No code to run." };

  const claimed = await tryClaimJob(jobId, "manual");
  if (!claimed) {
    return { started: false, error: "Job is already running or could not be claimed" };
  }

  void executeJobRun({
    jobId,
    runId: claimed.run.id,
    advanceSchedule: false,
    codeOverride: code,
  });

  return { started: true, runId: claimed.run.id };
}

/** Fire-and-forget run after a successful claim. */
export function startClaimedRun(jobId: string, runId: string, advanceSchedule: boolean) {
  void executeJobRun({ jobId, runId, advanceSchedule });
}
