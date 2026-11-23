import { and, asc, desc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { type Job, type JobRun, type JobRunTrigger, type NewJob, type NewJobRun, getDb, jobRuns, jobs } from "../../common/db/client.js";
import { type RawQuery, listQuery } from "../../common/db/list-query.util.js";
import { qall, qone, qrun } from "../../common/db/query.js";
import { BadRequestException } from "../../common/exceptions/http.exception.js";
import { cronNextDateMulti, parseJobCrons } from "../../common/utils/cronHelper.js";
import { wsHub } from "../../common/ws/wsHub.js";
import { type JobLogEntry, parseJobLogs, serializeJobLogs } from "./common/job-logs.js";
import { getInstanceId, wakeScheduler } from "./jobs-events.js";

export type { JobLogEntry };
export type PublicJobRun = Omit<JobRun, "logs" | "input" | "output"> & { logs: JobLogEntry[]; input: unknown; output: unknown };

const ACTIVE_RUN_STATUSES: JobRun["status"][] = ["queued", "running"];
const MAX_INPUT_BYTES = 64_000;
export const MAX_RETRIES = 5;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

function parseJson(text: string | null): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function toPublicJobRun(run: JobRun): PublicJobRun {
  return { ...run, logs: parseJobLogs(run.logs), input: parseJson(run.input), output: parseJson(run.output) };
}

export function retryDelayMs(failedAttempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failedAttempt - 1));
}

export function runBudgetMs(job: Pick<Job, "timeoutMs" | "maxRetries">): number {
  let total = job.timeoutMs * (job.maxRetries + 1);
  for (let attempt = 1; attempt <= job.maxRetries; attempt++) total += retryDelayMs(attempt);
  return total + 60_000;
}

function normalizeMaxRetries(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_RETRIES) throw new BadRequestException(`maxRetries must be a whole number from 0 to ${MAX_RETRIES}`);
  return value;
}

function asDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type JobStatus = "scheduled" | "paused" | "manual";
export type PublicJob = Job & { status: JobStatus; nextRuns: Date[] };

function upcomingRuns(cron: string, count: number): Date[] {
  const runs: Date[] = [];
  let from = new Date();
  while (runs.length < count) {
    const next = cronNextDateMulti(cron, from);
    if (!next || next.getTime() <= from.getTime()) break;
    runs.push(next);
    from = next;
  }
  return runs;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAY_RUNS = 1_440;

export function runsInNextDay(job: Job): Date[] {
  if (!job.enabled || parseJobCrons(job.cron).length === 0) return [];
  const until = Date.now() + DAY_MS;
  const runs: Date[] = [];
  let from = new Date();
  while (runs.length < MAX_DAY_RUNS) {
    const next = cronNextDateMulti(job.cron, from);
    if (!next || next.getTime() > until || next.getTime() <= from.getTime()) break;
    runs.push(next);
    from = next;
  }
  return runs;
}

export function toPublicJob(job: Job): PublicJob {
  if (parseJobCrons(job.cron).length === 0) return { ...job, status: "manual", nextRuns: [] };
  if (!job.enabled) return { ...job, status: "paused", nextRuns: [] };
  const nextRuns = upcomingRuns(job.cron, 3);
  const current = asDate(job.nextRunAt);
  const nextRunAt = current && current.getTime() > Date.now() ? current : (nextRuns[0] ?? job.nextRunAt);
  return { ...job, nextRunAt, status: "scheduled", nextRuns };
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_CODE = `import agenthands from "@agenthands/runtime";

await agenthands.step("Main", async () => {
  agenthands.log.info("Job started");
});
`;

function normalizeCronField(cron: string): string {
  return parseJobCrons(cron).join("\n");
}

/** Empty cron = off. Non-empty must be valid; returns next run or null when off. */
function resolveSchedule(cron: string, requestedEnabled?: boolean): { enabled: boolean; nextRunAt: Date | null } {
  const expressions = parseJobCrons(cron);
  if (expressions.length === 0) {
    if (requestedEnabled === true) throw new BadRequestException("Job has no cron schedule. Set cron before enabling it.");
    return { enabled: false, nextRunAt: null };
  }
  const next = cronNextDateMulti(expressions.join("\n"), new Date());
  if (!next) throw new BadRequestException("Invalid cron expression (5-field: min hour dom month dow)");
  if (requestedEnabled === false) return { enabled: false, nextRunAt: null };
  return { enabled: true, nextRunAt: next };
}

export type FinishedRunStatus = Exclude<JobRun["status"], "running" | "queued">;

export function isActiveRunStatus(status: JobRun["status"]): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

const RECENT_RUNS = 12;

async function recentRunStatuses(jobIds: string[]): Promise<Map<string, FinishedRunStatus[]>> {
  const map = new Map<string, FinishedRunStatus[]>();
  if (jobIds.length === 0) return map;
  const db = getDb();
  const ranked = db
    .select({
      jobId: jobRuns.jobId,
      status: jobRuns.status,
      rn: sql<number>`row_number() over (partition by ${jobRuns.jobId} order by ${jobRuns.startedAt} desc)`.as("rn"),
    })
    .from(jobRuns)
    .where(and(inArray(jobRuns.jobId, jobIds), notInArray(jobRuns.status, ACTIVE_RUN_STATUSES)))
    .as("ranked");
  const rows = await qall(db.select({ jobId: ranked.jobId, status: ranked.status }).from(ranked).where(lte(ranked.rn, RECENT_RUNS)).orderBy(asc(ranked.jobId), asc(ranked.rn)));
  for (const r of rows) {
    const list = map.get(r.jobId) ?? [];
    list.push(r.status as FinishedRunStatus);
    map.set(r.jobId, list);
  }
  return map;
}

export async function listJobs(query?: RawQuery) {
  const result = await listQuery({ table: jobs, searchColumns: ["name", "description"] }, query);
  const recent = await recentRunStatuses(result.items.map((j) => j.id));
  return {
    ...result,
    items: result.items.map((j) => {
      const runs = recent.get(j.id) ?? [];
      return { ...toPublicJob(j), lastRunStatus: runs[0] ?? null, recentRuns: runs };
    }),
  };
}

export async function getJob(id: string): Promise<Job | undefined> {
  return await qone(
    getDb()
      .select()
      .from(jobs)
      .where(eq(jobs.id, id)),
  );
}

export async function createJob(body: {
  name?: string;
  description?: string | null;
  code?: string;
  cron?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}) {
  const name = String(body.name ?? "").trim();
  if (!name) throw new BadRequestException("Name is required");
  const cron = normalizeCronField(String(body.cron ?? ""));
  const { enabled, nextRunAt } = resolveSchedule(cron, body.enabled);

  const timeoutMs = typeof body.timeoutMs === "number" && body.timeoutMs > 0 ? Math.floor(body.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const now = new Date();
  const code = typeof body.code === "string" ? body.code : DEFAULT_CODE;

  const entry: NewJob = {
    id: crypto.randomUUID(),
    name,
    description: body.description?.trim() || null,
    code,
    cron,
    enabled,
    timeoutMs,
    maxRetries: body.maxRetries === undefined ? 0 : normalizeMaxRetries(body.maxRetries),
    nextRunAt,
    lastRunAt: null,
    leaseOwner: null,
    leaseUntil: null,
    createdAt: now,
    updatedAt: now,
  };

  await qrun(getDb().insert(jobs).values(entry));
  const created = toPublicJob((await getJob(entry.id as string))!);
  wsHub.emit("jobs:created", created);
  wakeScheduler();
  return created;
}

export async function updateJob(
  id: string,
  body: {
    name?: string;
    description?: string | null;
    code?: string;
    cron?: string;
    enabled?: boolean;
    timeoutMs?: number;
    maxRetries?: number;
  },
) {
  const existing = await getJob(id);
  if (!existing) throw new BadRequestException("Job not found");

  const now = new Date();
  const patch: Partial<Job> = { updatedAt: now };

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new BadRequestException("Name is required");
    patch.name = name;
  }
  if (body.description !== undefined) {
    patch.description = body.description?.trim() || null;
  }
  if (typeof body.code === "string") {
    patch.code = body.code;
    patch.draftCode = body.code;
  }
  if (body.timeoutMs !== undefined) {
    if (typeof body.timeoutMs !== "number" || body.timeoutMs <= 0) {
      throw new BadRequestException("timeoutMs must be a positive number");
    }
    patch.timeoutMs = Math.floor(body.timeoutMs);
  }
  if (body.maxRetries !== undefined) patch.maxRetries = normalizeMaxRetries(body.maxRetries);

  let cron = existing.cron;
  if (body.cron !== undefined) {
    cron = normalizeCronField(String(body.cron));
    patch.cron = cron;
  }

  const cronChanged = body.cron !== undefined && cron !== existing.cron;
  const wasPaused = !existing.enabled && parseJobCrons(existing.cron).length > 0;
  const requestedEnabled = typeof body.enabled === "boolean" ? body.enabled : wasPaused ? false : undefined;
  const schedule = resolveSchedule(cron, requestedEnabled);
  if (cronChanged || schedule.enabled !== existing.enabled || (schedule.enabled && !existing.nextRunAt)) {
    patch.enabled = schedule.enabled;
    patch.nextRunAt = schedule.nextRunAt;
    if (!schedule.enabled) {
      patch.leaseOwner = null;
      patch.leaseUntil = null;
    }
  }

  await qrun(
    getDb()
      .update(jobs)
      .set(patch)
      .where(eq(jobs.id, id)),
  );
  const updated = toPublicJob((await getJob(id))!);
  wsHub.emit("jobs:updated", updated);
  wakeScheduler();
  return updated;
}

export async function deleteJob(id: string) {
  const existing = await getJob(id);
  if (!existing) throw new BadRequestException("Job not found");
  await qrun(
    getDb()
      .delete(jobs)
      .where(eq(jobs.id, id)),
  );
  wsHub.emit("jobs:deleted", { id });
  wakeScheduler();
}

export async function clearJobRuns(jobId: string): Promise<{ deleted: number; kept: number }> {
  const job = await getJob(jobId);
  if (!job) throw new BadRequestException("Job not found");
  const db = getDb();
  const deleted = await qall(
    db
      .delete(jobRuns)
      .where(and(eq(jobRuns.jobId, jobId), notInArray(jobRuns.status, ACTIVE_RUN_STATUSES)))
      .returning({ id: jobRuns.id }),
  );
  const keptRow = await qone(db.select({ count: sql<number>`count(*)` }).from(jobRuns).where(eq(jobRuns.jobId, jobId)));
  wsHub.emit("job_runs:cleared", { jobId });
  wsHub.emit("jobs:updated", { id: jobId, lastRunStatus: null, recentRuns: [] });
  return { deleted: deleted.length, kept: Number(keptRow?.count ?? 0) };
}

export async function listJobRuns(jobId: string, query?: RawQuery) {
  const job = await getJob(jobId);
  if (!job) throw new BadRequestException("Job not found");

  const page = Math.max(1, Number(query?.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(query?.limit ?? 20) || 20));
  const offset = (page - 1) * limit;

  const db = getDb();
  const rows = await qall(db.select().from(jobRuns).where(eq(jobRuns.jobId, jobId)).orderBy(desc(jobRuns.startedAt)).limit(limit).offset(offset));
  const totalRow = await qone(db.select({ count: sql<number>`count(*)` }).from(jobRuns).where(eq(jobRuns.jobId, jobId)));
  const total = Number(totalRow?.count ?? 0);

  return { items: rows.map(toPublicJobRun), total, page, limit };
}

async function getJobRow(id: string): Promise<Job | undefined> {
  return await qone(getDb().select().from(jobs).where(eq(jobs.id, id)));
}

export async function getJobRun(runId: string): Promise<JobRun | undefined> {
  return await qone(getDb().select().from(jobRuns).where(eq(jobRuns.id, runId)));
}

/** Recalculate next_run_at for all enabled jobs (e.g. timezone change). */
export async function recalculateAllJobSchedules() {
  const db = getDb();
  const enabledJobs = await qall(
    db
      .select()
      .from(jobs)
      .where(eq(jobs.enabled, true)),
  );
  const now = new Date();
  for (const job of enabledJobs) {
    const next = cronNextDateMulti(job.cron, now);
    await qrun(
      db
        .update(jobs)
        .set({ nextRunAt: next, updatedAt: now })
        .where(eq(jobs.id, job.id)),
    );
  }
  wakeScheduler();
}

export async function listDueJobs(now: Date = new Date()): Promise<Job[]> {
  return await qall(
    getDb()
      .select()
      .from(jobs)
      .where(and(eq(jobs.enabled, true), lte(jobs.nextRunAt, now), or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, now)))),
  );
}

export async function getMinNextRunAt(): Promise<Date | null> {
  const row = await qone(
    getDb()
      .select({ nextRunAt: jobs.nextRunAt })
      .from(jobs)
      .where(and(eq(jobs.enabled, true), sql`${jobs.nextRunAt} IS NOT NULL`))
      .orderBy(asc(jobs.nextRunAt))
      .limit(1),
  );
  return row?.nextRunAt ?? null;
}

async function hasActiveRun(jobId: string): Promise<boolean> {
  const row = await qone(
    getDb()
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(and(eq(jobRuns.jobId, jobId), inArray(jobRuns.status, ACTIVE_RUN_STATUSES))),
  );
  return !!row;
}

/**
 * Atomically claim a due job for this instance.
 * Returns job_run id if won, null if lost / overlap.
 */
export function serializeRunInput(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  const json = JSON.stringify(input);
  if (json.length > MAX_INPUT_BYTES) throw new BadRequestException(`input is ${json.length} bytes; the limit is ${MAX_INPUT_BYTES}. Pass ids or a datatable reference instead of the data itself.`);
  return json;
}

export async function tryClaimJob(jobId: string, trigger: JobRunTrigger = "cron", opts: { input?: unknown } = {}): Promise<{ job: Job; run: PublicJobRun } | null> {
  const input = serializeRunInput(opts.input);
  const db = getDb();
  const now = new Date();
  const instanceId = getInstanceId();

  const job = await getJob(jobId);
  if (!job) return null;
  if (!job.enabled && trigger === "cron") return null;
  if (await hasActiveRun(jobId)) return null;

  const leaseUntil = new Date(now.getTime() + runBudgetMs(job));

  if (trigger === "cron") {
    if (!job.nextRunAt || job.nextRunAt.getTime() > now.getTime()) return null;
    if (job.leaseUntil && job.leaseUntil.getTime() > now.getTime()) return null;
  } else if (job.leaseUntil && job.leaseUntil.getTime() > now.getTime()) {
    return null;
  }

  const claimWhere = trigger === "cron" ? and(eq(jobs.id, jobId), eq(jobs.enabled, true), lte(jobs.nextRunAt, now), or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, now))) : and(eq(jobs.id, jobId), or(isNull(jobs.leaseUntil), lte(jobs.leaseUntil, now)));

  const nextAfterClaim = trigger === "cron" && job.enabled ? cronNextDateMulti(job.cron, now) : undefined;

  const updated = await qall(
    db
      .update(jobs)
      .set({
        leaseOwner: instanceId,
        leaseUntil,
        ...(nextAfterClaim && nextAfterClaim.getTime() > now.getTime() ? { nextRunAt: nextAfterClaim } : {}),
        updatedAt: now,
      })
      .where(claimWhere)
      .returning({ id: jobs.id }),
  );

  if (updated.length === 0) return null;

  const runId = crypto.randomUUID();
  const run: NewJobRun = {
    id: runId,
    jobId,
    status: "queued",
    trigger,
    logs: "[]",
    error: null,
    input,
    scheduledFor: trigger === "cron" ? job.nextRunAt : null,
    instanceId,
    startedAt: now,
    finishedAt: null,
  };
  await qrun(db.insert(jobRuns).values(run));

  const claimed = toPublicJob((await getJob(jobId))!);
  const createdRun = (await getJobRun(runId))!;
  const publicRun = toPublicJobRun(createdRun);
  wsHub.emit("jobs:updated", claimed);
  wsHub.emit("job_runs:created", publicRun);
  return { job: claimed, run: publicRun };
}

export async function finishJobRun(opts: {
  jobId: string;
  runId: string;
  status: "success" | "failed";
  logs?: JobLogEntry[] | string;
  error?: string | null;
  output?: unknown;
  attempts?: number;
  advanceSchedule: boolean;
}) {
  const db = getDb();
  const now = new Date();
  const job = await getJobRow(opts.jobId);
  const existing = await getJobRun(opts.runId);
  const baseEntries = opts.logs !== undefined ? (typeof opts.logs === "string" ? parseJobLogs(opts.logs) : opts.logs) : parseJobLogs(existing?.logs);
  const startedMs = existing?.startedAt ? new Date(existing.startedAt).getTime() : now.getTime();
  const t = Math.max(0, now.getTime() - startedMs);
  const entries = [...baseEntries];
  if (opts.error) {
    entries.push({ t, level: "error", message: opts.error, kind: "system" });
  } else if (opts.status === "success") {
    entries.push({ t, level: "system", message: "Completed successfully", kind: "system" });
  }

  await qrun(
    db
      .update(jobRuns)
      .set({
        status: opts.status,
        logs: serializeJobLogs(entries),
        error: opts.error ?? null,
        finishedAt: now,
        ...(opts.output !== undefined ? { output: JSON.stringify(opts.output) } : {}),
        ...(opts.attempts !== undefined ? { attempts: opts.attempts } : {}),
      })
      .where(eq(jobRuns.id, opts.runId)),
  );

  let nextRunAt = asDate(job?.nextRunAt);
  if (job?.enabled && parseJobCrons(job.cron).length > 0) {
    const shouldAdvance = opts.advanceSchedule || !nextRunAt || nextRunAt.getTime() <= now.getTime();
    if (shouldAdvance) {
      nextRunAt = cronNextDateMulti(job.cron, now);
    }
  } else if (!job?.enabled) {
    nextRunAt = null;
  }

  await qrun(
    db
      .update(jobs)
      .set({
        leaseOwner: null,
        leaseUntil: null,
        lastRunAt: now,
        nextRunAt: nextRunAt ?? null,
        updatedAt: now,
      })
      .where(eq(jobs.id, opts.jobId)),
  );

  const updatedJob = await getJobRow(opts.jobId);
  const updatedRun = await getJobRun(opts.runId);
  if (updatedJob) {
    const recentRuns = (await recentRunStatuses([updatedJob.id])).get(updatedJob.id) ?? [];
    wsHub.emit("jobs:updated", { ...toPublicJob(updatedJob), lastRunStatus: recentRuns[0] ?? null, recentRuns });
    if (updatedRun) wsHub.emit("job_runs:updated", toPublicJobRun(updatedRun));
  }
  wakeScheduler();
}

/** Mark orphaned running runs as failed when lease expired or missing. */
export async function healOrphanedRuns(now: Date = new Date()) {
  const db = getDb();
  const staleJobs = await qall(
    db
      .select()
      .from(jobs)
      .where(and(sql`${jobs.leaseOwner} IS NOT NULL`, lte(jobs.leaseUntil, now))),
  );

  for (const job of staleJobs) {
    const running = await qall(
      db
        .select()
        .from(jobRuns)
        .where(and(eq(jobRuns.jobId, job.id), inArray(jobRuns.status, ACTIVE_RUN_STATUSES))),
    );
    for (const run of running) {
      await qrun(
        db
          .update(jobRuns)
          .set({
            status: "failed",
            error: "Run orphaned: lease expired (instance may have crashed)",
            finishedAt: now,
          })
          .where(eq(jobRuns.id, run.id)),
      );
      const orphan = await getJobRun(run.id);
      if (orphan) wsHub.emit("job_runs:updated", toPublicJobRun(orphan));
    }
    await qrun(
      db
        .update(jobs)
        .set({ leaseOwner: null, leaseUntil: null, updatedAt: now })
        .where(eq(jobs.id, job.id)),
    );
  }

  const stuckRuns = await qall(db.select().from(jobRuns).where(inArray(jobRuns.status, ACTIVE_RUN_STATUSES)));
  for (const run of stuckRuns) {
    const job = await getJobRow(run.jobId);
    if (!job) continue;
    const leaseUntil = asDate(job.leaseUntil);
    if (leaseUntil && leaseUntil.getTime() > now.getTime()) continue;
    await qrun(
      db
        .update(jobRuns)
        .set({
          status: "failed",
          error: "Run orphaned: no active lease",
          finishedAt: now,
        })
        .where(eq(jobRuns.id, run.id)),
    );
    await qrun(
      db
        .update(jobs)
        .set({ leaseOwner: null, leaseUntil: null, updatedAt: now })
        .where(eq(jobs.id, job.id)),
    );
    const orphan = await getJobRun(run.id);
    const refreshed = await getJobRow(job.id);
    if (orphan) wsHub.emit("job_runs:updated", toPublicJobRun(orphan));
    if (job.enabled && refreshed) wsHub.emit("jobs:updated", toPublicJob(refreshed));
  }
}

export async function updateDraftCode(id: string, draftCode: string): Promise<void> {
  await qrun(
    getDb()
      .update(jobs)
      .set({ draftCode, updatedAt: new Date() })
      .where(eq(jobs.id, id)),
  );
  wsHub.emit("jobs:updated", { id, draftCode });
}

export async function approveJobDraft(id: string): Promise<{ published: boolean }> {
  const row = await getJob(id);
  if (!row) throw new Error("Job not found");
  const draft = row.draftCode;
  if (draft == null || draft.trim() === "" || draft === row.code) return { published: false };
  await updateJob(id, { code: draft });
  return { published: true };
}

export async function getDraftCode(id: string): Promise<string | null> {
  const row = await qone(
    getDb()
      .select({ draftCode: jobs.draftCode, code: jobs.code })
      .from(jobs)
      .where(eq(jobs.id, id)),
  );
  if (!row) return null;
  return row.draftCode ?? row.code ?? null;
}

export async function getJobCode(id: string): Promise<string | null> {
  const row = await qone(
    getDb()
      .select({ code: jobs.code })
      .from(jobs)
      .where(eq(jobs.id, id)),
  );
  if (!row) return null;
  return row.code ?? "";
}

export async function saveJobCode(id: string, code: string): Promise<string> {
  const updated = await updateJob(id, { code });
  return updated?.code ?? code;
}

/** Append structured log entries while run is in progress; emit WS for live UI. */
export async function appendRunLogEntries(runId: string, entries: JobLogEntry[]) {
  if (!entries.length) return;
  const run = await getJobRun(runId);
  if (!run || !isActiveRunStatus(run.status)) return;
  const next = [...parseJobLogs(run.logs), ...entries];
  const logs = serializeJobLogs(next);
  await qrun(getDb().update(jobRuns).set({ logs }).where(eq(jobRuns.id, runId)));
  wsHub.emit("job_runs:log", { id: runId, jobId: run.jobId, entries, logs: parseJobLogs(logs) });
}

export { DEFAULT_CODE, DEFAULT_TIMEOUT_MS };

export async function markRunStarted(runId: string, startedAt: Date, attempts: number): Promise<void> {
  await qrun(getDb().update(jobRuns).set({ status: "running", startedAt, attempts }).where(eq(jobRuns.id, runId)));
  const run = await getJobRun(runId);
  if (run) wsHub.emit("job_runs:updated", toPublicJobRun(run));
}

export async function setRunAttempts(runId: string, attempts: number): Promise<void> {
  await qrun(getDb().update(jobRuns).set({ attempts }).where(eq(jobRuns.id, runId)));
}

export async function extendJobLease(jobId: string, until: Date): Promise<void> {
  await qrun(getDb().update(jobs).set({ leaseUntil: until }).where(eq(jobs.id, jobId)));
}

export async function lastSuccessAt(jobId: string): Promise<Date | null> {
  const row = await qone(
    getDb()
      .select({ finishedAt: jobRuns.finishedAt })
      .from(jobRuns)
      .where(and(eq(jobRuns.jobId, jobId), eq(jobRuns.status, "success")))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1),
  );
  return row?.finishedAt ?? null;
}
