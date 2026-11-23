import { Card, Icon, Tooltip } from "devnonla-ui";
import { Activity, Ban, Pause } from "lucide-react";
import { useId, useMemo } from "react";
import { cn } from "src/common/lib/cn";
import type { Job } from "src/common/types";
import { formatDateTime, relativeTime } from "src/common/utils/date";
import { describeCron, jobIsScheduled, parseJobCronExpressions } from "../common/schedule";

export type JobGroup = "running" | "upcoming" | "idle";
export type JobFilter = "all" | JobGroup;
type ScheduleState = "active" | "paused" | "none";

export const JOB_FILTERS: { key: JobFilter; label: string; empty: string }[] = [
  { key: "all", label: "All", empty: "No jobs" },
  { key: "upcoming", label: "Up next", empty: "No job is scheduled" },
  { key: "running", label: "Running", empty: "Nothing is running right now" },
  { key: "idle", label: "Idle", empty: "Every job is on a schedule" },
];

export type JobSort = "next" | "name" | "last" | "updated";

export const JOB_SORTS: { key: JobSort; label: string }[] = [
  { key: "next", label: "Next run" },
  { key: "name", label: "Name" },
  { key: "last", label: "Last run" },
  { key: "updated", label: "Recently updated" },
];

const GROUP_ORDER: JobGroup[] = ["running", "upcoming", "idle"];
const IMMINENT_MS = 120_000;

export function jobIsRunning(job: Job, now: number): boolean {
  return job.leaseUntil != null && new Date(job.leaseUntil).getTime() > now;
}

function scheduleState(job: Job): ScheduleState {
  if (!jobIsScheduled(job.cron)) return "none";
  return job.enabled ? "active" : "paused";
}

export function jobGroup(job: Job, now: number): JobGroup {
  if (jobIsRunning(job, now)) return "running";
  return scheduleState(job) === "active" ? "upcoming" : "idle";
}

function formatCountdown(diffMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(diffMs / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function scheduleSummary(job: Job): { text: string; full: string } {
  const lines = parseJobCronExpressions(job.cron).map(describeCron);
  const extra = lines.length - 1;
  return { text: extra > 0 ? `${lines[0]} +${extra}` : (lines[0] ?? ""), full: lines.join("\n") };
}

function LastRun({ job }: { job: Job }) {
  if (!job.lastRunAt && !job.lastRunStatus) return <span className="text-xs text-tertiary-foreground">Never ran</span>;
  const failed = job.lastRunStatus === "failed";
  return (
    <Tooltip title={job.lastRunAt ? `Last run ${formatDateTime(job.lastRunAt)}` : undefined}>
      <span className={cn("inline-flex items-center gap-1.5 text-xs tabular-nums", failed ? "text-destructive" : "text-muted-foreground")}>
        <span className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-destructive" : "bg-success")} aria-hidden />
        {failed ? "Failed" : ""}
        {job.lastRunAt ? `${failed ? " " : ""}${relativeTime(job.lastRunAt)}` : ""}
      </span>
    </Tooltip>
  );
}

function NextRun({ job, now }: { job: Job; now: number }) {
  const next = scheduleState(job) === "active" ? toMs(job.nextRunAt) : null;
  if (next == null) return <span className="text-xs text-tertiary-foreground">–</span>;
  if (next <= now) return <span className="text-xs text-muted-foreground">now</span>;
  return (
    <Tooltip title={`Next run ${formatDateTime(new Date(next))}`}>
      <span className={cn("text-xs tabular-nums", next - now < IMMINENT_MS ? "text-brand-700" : "text-foreground")}>in {formatCountdown(next - now)}</span>
    </Tooltip>
  );
}

function JobStateIcon({ job, now }: { job: Job; now: number }) {
  const running = jobIsRunning(job, now);
  const state = scheduleState(job);
  const stroke = 1.875;
  const icon = running ? (
    <Activity size={16} strokeWidth={stroke} className="text-green-500 motion-safe:animate-pulse" />
  ) : state === "active" ? (
    <Icon name="clock" size={16} className="text-violet-500" />
  ) : state === "paused" ? (
    <Pause size={16} strokeWidth={stroke} className="text-amber-500" />
  ) : (
    <Ban size={16} strokeWidth={stroke} className="text-zinc-400" />
  );
  return (
    <Tooltip title={running ? "Running" : state === "active" ? "Scheduled" : state === "paused" ? "Paused" : "Disabled"}>
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
    </Tooltip>
  );
}

function Schedule({ job }: { job: Job }) {
  const state = scheduleState(job);
  if (state === "none") return <span className="text-xs text-tertiary-foreground">No schedule</span>;
  const schedule = scheduleSummary(job);
  return (
    <Tooltip title={schedule.full.includes("\n") ? <span className="whitespace-pre-line">{schedule.full}</span> : undefined}>
      <span className={cn("block truncate text-xs text-muted-foreground", state === "paused" && "line-through decoration-muted-foreground/40")}>{schedule.text}</span>
    </Tooltip>
  );
}

const BEAM_TAIL = 24;
const BEAM_LAYERS = [
  { length: 24, opacity: 0.15 },
  { length: 14, opacity: 0.4 },
  { length: 6, opacity: 1 },
];

function RunningBorder() {
  const gradientId = `beam-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--color-green-500)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--color-emerald-400)" }} />
          <stop offset="1" style={{ stopColor: "var(--color-lime-400)" }} />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" rx="12" fill="none" strokeWidth="1" className="stroke-green-500/20" />
      {BEAM_LAYERS.map((layer) => (
        <rect
          key={layer.length}
          width="100%"
          height="100%"
          rx="12"
          fill="none"
          pathLength="100"
          strokeWidth="1"
          stroke={`url(#${gradientId})`}
          strokeOpacity={layer.opacity}
          strokeDasharray={`0 ${BEAM_TAIL - layer.length} ${layer.length} ${100 - BEAM_TAIL}`}
          className="motion-safe:animate-border-run motion-reduce:hidden"
        />
      ))}
    </svg>
  );
}

function JobCard({ job, now, onOpen }: { job: Job; now: number; onOpen: () => void }) {
  const running = jobIsRunning(job, now);
  return (
    <div className="relative min-w-0 rounded-xl transition-transform duration-150 hover:-translate-y-0.5">
      <Card
        role="link"
        tabIndex={0}
        aria-label={`Open ${job.name}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onOpen();
        }}
        className="relative min-w-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        <div className="flex min-w-0 flex-col gap-1 px-3.5 pt-3 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <JobStateIcon job={job} now={now} />
            <span className="truncate text-sm font-medium text-foreground">{job.name}</span>
          </div>
          <div className="pl-7">
            <Schedule job={job} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border-secondary pt-2.5">
            <NextRun job={job} now={now} />
            <LastRun job={job} />
          </div>
        </div>
      </Card>
      {running ? <RunningBorder /> : null}
    </div>
  );
}

function sortGroup(group: JobGroup, jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    if (group === "upcoming") {
      const diff = (toMs(a.nextRunAt) ?? Number.POSITIVE_INFINITY) - (toMs(b.nextRunAt) ?? Number.POSITIVE_INFINITY);
      if (diff !== 0) return diff;
    }
    if (group === "idle") {
      const order = { paused: 0, none: 1, active: 2 } as const;
      const diff = order[scheduleState(a)] - order[scheduleState(b)];
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });
}

export function groupJobs(jobs: Job[], now: number): Record<JobGroup, Job[]> {
  const buckets: Record<JobGroup, Job[]> = { running: [], upcoming: [], idle: [] };
  for (const job of jobs) buckets[jobGroup(job, now)].push(job);
  for (const group of GROUP_ORDER) buckets[group] = sortGroup(group, buckets[group]);
  return buckets;
}

function sortJobs(jobs: Job[], sort: JobSort): Job[] {
  if (sort === "next") return jobs;
  const desc = (a: Date | string | null | undefined, b: Date | string | null | undefined) => (toMs(b) ?? Number.NEGATIVE_INFINITY) - (toMs(a) ?? Number.NEGATIVE_INFINITY);
  return [...jobs].sort((a, b) => {
    const diff = sort === "last" ? desc(a.lastRunAt, b.lastRunAt) : sort === "updated" ? desc(a.updatedAt, b.updatedAt) : 0;
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

export function JobsList({ groups, filter, sort, now, onOpen }: { groups: Record<JobGroup, Job[]>; filter: JobFilter; sort: JobSort; now: number; onOpen: (job: Job) => void }) {
  const rows = useMemo(() => sortJobs(filter === "all" ? GROUP_ORDER.flatMap((group) => groups[group]) : groups[filter], sort), [groups, filter, sort]);
  const empty = JOB_FILTERS.find((f) => f.key === filter)?.empty ?? "No jobs";

  if (rows.length === 0) return <p className="m-0 rounded-xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">{empty}</p>;

  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @min-[560px]:grid-cols-2 @min-[860px]:grid-cols-3 @min-[1200px]:grid-cols-4">
        {rows.map((job) => (
          <JobCard key={job.id} job={job} now={now} onOpen={() => onOpen(job)} />
        ))}
      </div>
    </div>
  );
}
