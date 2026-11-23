import { Button, Card, Popconfirm, Switch, Table, Tooltip, Icon, type IconName } from "devnonla-ui";
import { CircleCheck, CircleX, Fingerprint, Hand, Layers, LoaderCircle, type LucideIcon } from "lucide-react";
import { RUN_STATUS_LABEL, RunStatusTag } from "../../components/RunStatusTag";
import type { ReactNode } from "react";
import { cn } from "src/common/lib/cn";
import type { Job, JobRun } from "src/common/types";
import { formatDateTime, relativeTime } from "src/common/utils/date";
import RenderIf from "src/components/RenderIf";
import { formatDuration, isActiveRun, runDurationMs, runHeadline } from "../../common/runLogs";
import { describeCron, parseJobCronExpressions } from "../../common/schedule";

const TABLE_ROWS = 8;
const CHART_BARS = 40;

const timeFormat = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayTimeFormat = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function formatTimeout(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms % 1_000 === 0) return `${ms / 1_000} s`;
  return `${ms} ms`;
}

function ItemLabel({ icon: ItemIcon, children }: { icon: LucideIcon | IconName; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      {typeof ItemIcon === "string" ? <Icon name={ItemIcon} size={14} className="text-tertiary-foreground" /> : <ItemIcon size={14} className="text-tertiary-foreground" />}
      {children}
    </span>
  );
}

function Stat({ label, value, hint, tone, visual }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad"; visual: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <div className="flex size-11 shrink-0 items-center justify-center">{visual}</div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn("truncate text-lg leading-tight tabular-nums", tone === "bad" ? "text-red-500" : tone === "good" ? "text-green-600" : "text-foreground")}>{value}</span>
        <span className="truncate text-xs tabular-nums text-muted-foreground">{hint ?? " "}</span>
      </div>
    </div>
  );
}

function IconTile({ icon: TileIcon, tone, spin }: { icon: LucideIcon | IconName; tone: string; spin?: boolean }) {
  return (
    <span className={cn("flex size-11 items-center justify-center rounded-xl", tone)}>
      {typeof TileIcon === "string" ? <Icon name={TileIcon} size={20} className={cn(spin && "motion-safe:animate-spin")} /> : <TileIcon size={20} strokeWidth={2} className={cn(spin && "motion-safe:animate-spin")} />}
    </span>
  );
}

function Donut({ percent }: { percent: number | null }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const value = percent ?? 0;
  const color = percent == null ? "text-tertiary-foreground" : value >= 95 ? "text-green-600" : value >= 70 ? "text-amber-500" : "text-red-500";
  return (
    <svg viewBox="0 0 44 44" className="size-11 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" className="stroke-foreground/[0.07]" />
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" strokeLinecap="round" stroke="currentColor" className={color} strokeDasharray={`${(value / 100) * c} ${c}`} />
    </svg>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <IconTile icon="clock" tone="bg-violet-500/10 text-violet-500" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 44},${36 - ((v - min) / span) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 44 40" className="h-10 w-11 text-violet-500" aria-hidden>
      <polyline points={`0,40 ${points} 44,40`} fill="currentColor" className="opacity-15" stroke="none" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const hourFormat = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" });

function DayStrip({ runs, now, paused }: { runs: string[]; now: number; paused: boolean }) {
  const times = runs.map((r) => new Date(r).getTime()).filter((t) => t > now && t <= now + DAY_MS);
  const marks = [0, 0.25, 0.5, 0.75, 1].map((f) => now + f * DAY_MS);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">Next 24 hours</span>
        <span className="text-xs tabular-nums text-foreground">{paused ? "Paused" : `${times.length} ${times.length === 1 ? "run" : "runs"}`}</span>
      </div>
      <div className="relative mt-2 h-9 overflow-hidden rounded-md bg-ink-hover">
        {marks.slice(1, -1).map((m) => (
          <span key={m} className="absolute inset-y-0 w-px bg-ink-active" style={{ left: `${((m - now) / DAY_MS) * 100}%` }} />
        ))}
        {times.map((t) => (
          <Tooltip key={t} title={hourFormat.format(new Date(t))}>
            <span className={cn("absolute top-1.5 bottom-1.5 w-[2px] -translate-x-1/2 rounded-full", paused ? "bg-muted-foreground/30" : "bg-violet-500")} style={{ left: `${((t - now) / DAY_MS) * 100}%` }} />
          </Tooltip>
        ))}
        <span className="absolute inset-y-0 left-0 w-[2px] bg-brand" aria-label="Now" />
      </div>
      <div className="mt-1 flex justify-between text-2xs tabular-nums text-muted-foreground">
        {marks.map((m, i) => (
          <span key={m}>{i === 0 ? "now" : hourFormat.format(new Date(m))}</span>
        ))}
      </div>
    </div>
  );
}

function RunHistoryChart({ runs, now, onOpenRun }: { runs: JobRun[]; now: number; onOpenRun: (id: string) => void }) {
  const bars = runs.slice(0, CHART_BARS).reverse();
  const durations = bars.map((r) => runDurationMs(r, now) ?? 0);
  const max = Math.max(1, ...durations);
  const slots = CHART_BARS - bars.length;
  return (
    <div className="px-4 pt-4 pb-3">
      <div className="flex h-28 items-end gap-[3px]" aria-label="Recent runs by duration">
        <RenderIf condition={slots > 0}>
          <span className="h-1 rounded-[2px] bg-ink-hover" style={{ flex: `${slots} ${slots} 0%` }} aria-hidden />
        </RenderIf>
        {bars.map((run, i) => {
          const height = Math.max(6, Math.round((Math.sqrt(durations[i]) / Math.sqrt(max)) * 100));
          return (
            <Tooltip key={run.id} title={`${RUN_STATUS_LABEL[run.status]} · ${dayTimeFormat.format(new Date(run.startedAt))} · ${formatDuration(durations[i])}`}>
              <button
                type="button"
                aria-label={`${RUN_STATUS_LABEL[run.status]} run at ${dayTimeFormat.format(new Date(run.startedAt))}`}
                onClick={() => onOpenRun(run.id)}
                className={cn("flex-1 cursor-pointer rounded-[2px] border-0 p-0 transition-opacity hover:opacity-70", run.status === "failed" ? "bg-red-500" : run.status === "success" ? "bg-green-500" : "bg-violet-500")}
                style={{ height: `${height}%` }}
              />
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{bars[0] ? dayTimeFormat.format(new Date(bars[0].startedAt)) : ""}</span>
        <span>Bar height is how long the run took</span>
        <span>{bars.length > 0 ? "Latest" : ""}</span>
      </div>
    </div>
  );
}

function ColumnTitle({ children }: { children: ReactNode }) {
  return <span className="text-xs font-normal text-muted-foreground">{children}</span>;
}

function RunsTable({ runs, now, onOpenRun }: { runs: JobRun[]; now: number; onOpenRun: (id: string) => void }) {
  return (
    <Table<JobRun>
      rowKey="id"
      size="large"
      bordered={false}
      pagination={false}
      dataSource={runs}
      onRow={(run) => ({ onClick: () => onOpenRun(run.id), className: "cursor-pointer" })}
      columns={[
        { key: "status", title: <ColumnTitle>Status</ColumnTitle>, width: 120, render: (_, run) => <RunStatusTag status={run.status} /> },
        {
          key: "started",
          title: <ColumnTitle>Started</ColumnTitle>,
          width: 170,
          render: (_, run) => (
            <span className="text-sm tabular-nums">
              {timeFormat.format(new Date(run.startedAt))} <span className="ml-1 text-muted-foreground">{relativeTime(run.startedAt)}</span>
            </span>
          ),
        },
        {
          key: "by",
          title: <ColumnTitle>By</ColumnTitle>,
          width: 110,
          render: (_, run) => (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              {run.trigger === "cron" ? <Icon name="datetime" size={13} /> : <Hand size={13} />}
              {run.trigger === "cron" ? "Schedule" : "Manual"}
            </span>
          ),
        },
        {
          key: "duration",
          title: <ColumnTitle>Duration</ColumnTitle>,
          width: 90,
          align: "right",
          render: (_, run) => {
            const duration = runDurationMs(run, now);
            return <span className="text-sm tabular-nums text-muted-foreground">{duration != null && run.status !== "queued" ? formatDuration(duration) : "—"}</span>;
          },
        },
        {
          key: "result",
          title: <ColumnTitle>Result</ColumnTitle>,
          ellipsis: true,
          render: (_, run) => {
            const headline = runHeadline(run);
            const result = headline?.title ?? (run.output != null ? JSON.stringify(run.output) : run.status === "success" ? "No output" : isActiveRun(run) ? "In progress" : "");
            return <span className={cn("text-sm", headline ? "font-mono text-xs text-red-500" : run.output != null ? "font-mono text-xs text-muted-foreground" : "text-muted-foreground")}>{result}</span>;
          },
        },
      ]}
    />
  );
}

interface JobOverviewProps {
  job: Job;
  runs: JobRun[];
  now: number;
  toggling: boolean;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onOpenRun: (runId: string) => void;
  onOpenRuns: () => void;
  onClearHistory: () => void;
}

export function JobOverview({ job, runs, now, toggling, onToggle, onDelete, onOpenRun, onOpenRuns, onClearHistory }: JobOverviewProps) {
  const expressions = parseJobCronExpressions(job.cron);
  const hasSchedule = expressions.length > 0;
  const nextRuns = job.enabled ? (job.nextRuns ?? []) : [];
  const nextAt = job.enabled && job.nextRunAt ? new Date(job.nextRunAt).getTime() : null;

  const finished = runs.filter((r) => !isActiveRun(r));
  const failedCount = finished.filter((r) => r.status === "failed").length;
  const durations = finished.map((r) => runDurationMs(r, now)).filter((d): d is number => d != null);
  const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const last = runs[0] ?? null;
  const successRate = finished.length > 0 ? Math.round(((finished.length - failedCount) / finished.length) * 100) : null;

  return (
    <div className="h-full overflow-y-auto overscroll-contain px-8 pt-6 pb-12">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-5 px-5 pt-5">
              <div className="flex min-w-0 flex-1 items-start gap-3.5">
                <IconTile icon={hasSchedule ? "datetime" : Hand} tone={hasSchedule && job.enabled ? "bg-violet-500/10 text-violet-500" : "bg-ink-active text-muted-foreground"} />
                <div className="min-w-0">
                  <p className="m-0 text-xs text-muted-foreground">Schedule</p>
                  {hasSchedule ? (
                    <ul className="m-0 mt-0.5 flex list-none flex-col gap-1 p-0">
                      {expressions.map((expr) => (
                        <li key={expr} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span className={cn("text-lg leading-tight font-medium text-foreground", !job.enabled && "text-muted-foreground line-through decoration-muted-foreground/40")}>{describeCron(expr)}</span>
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{expr}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 mt-0.5 text-lg leading-tight font-medium text-foreground">Runs only when started</p>
                  )}
                  <p className="m-0 mt-1.5 text-xs text-muted-foreground">
                    {hasSchedule ? (
                      job.enabled ? (
                        "Times are in the app timezone."
                      ) : (
                        "Paused. It keeps this schedule and runs again when switched on."
                      )
                    ) : (
                      <>
                        No schedule. Agents add one with <code className="font-mono text-xs">update_job</code>.
                      </>
                    )}
                  </p>
                </div>
              </div>
              <RenderIf condition={hasSchedule}>
                <div className="flex items-center gap-8">
                  <div className="text-right">
                    <p className="m-0 text-xs text-muted-foreground">Next run</p>
                    <p className={cn("m-0 mt-0.5 text-lg leading-tight tabular-nums", nextAt ? "text-foreground" : "text-muted-foreground")}>{nextAt ? (nextAt > now ? `in ${formatDuration(Math.ceil((nextAt - now) / 1000) * 1000)}` : "now") : "Paused"}</p>
                    <p className="m-0 mt-0.5 text-xs tabular-nums text-muted-foreground">{nextAt ? dayTimeFormat.format(new Date(nextAt)) : " "}</p>
                  </div>
                  <span className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
                    <Switch aria-label={job.enabled ? "Pause schedule" : "Resume schedule"} checked={job.enabled} disabled={toggling} onChange={onToggle} />
                    {job.enabled ? "On" : "Paused"}
                  </span>
                </div>
              </RenderIf>
            </div>
            <RenderIf condition={hasSchedule}>
              <div className="grid grid-cols-1 gap-x-8 gap-y-4 px-5 pt-5 pb-5 md:grid-cols-[minmax(0,1fr)_220px]">
                <DayStrip runs={job.dayRuns ?? nextRuns} now={now} paused={!job.enabled} />
                <div>
                  <p className="m-0 mb-2 text-xs text-muted-foreground">Coming up</p>
                  {nextRuns.length > 0 ? (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs tabular-nums">
                      {nextRuns.map((at) => (
                        <li key={at} className="flex justify-between gap-3">
                          <span className="text-foreground">{dayTimeFormat.format(new Date(at))}</span>
                          <span className="text-muted-foreground">{relativeTime(at)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-xs text-muted-foreground">Nothing while paused.</p>
                  )}
                </div>
              </div>
            </RenderIf>
            <RenderIf condition={!hasSchedule}>
              <div className="pb-5" />
            </RenderIf>
          </Card>

          <Card>
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-5 py-4 sm:grid-cols-3">
              <Stat
                label="Last run"
                visual={
                  <IconTile
                    icon={!last ? "clock" : last.status === "failed" ? CircleX : last.status === "success" ? CircleCheck : LoaderCircle}
                    spin={!!last && isActiveRun(last)}
                    tone={!last ? "bg-ink-active text-muted-foreground" : last.status === "failed" ? "bg-red-500/10 text-red-500" : last.status === "success" ? "bg-green-500/10 text-green-600" : "bg-violet-500/10 text-violet-500"}
                  />
                }
                value={last ? RUN_STATUS_LABEL[last.status] : "Never"}
                hint={last ? relativeTime(last.startedAt) : undefined}
                tone={last?.status === "failed" ? "bad" : last?.status === "success" ? "good" : undefined}
              />
              <Stat label="Success rate" visual={<Donut percent={successRate} />} value={successRate != null ? `${successRate}%` : "—"} hint={finished.length > 0 ? `${finished.length - failedCount} of ${finished.length} recent runs` : undefined} tone={successRate != null && successRate < 100 ? "bad" : undefined} />
              <Stat label="Average time" visual={<Sparkline values={[...durations].reverse().slice(-20)} />} value={avg != null ? formatDuration(avg) : "—"} hint={`Limit ${formatTimeout(job.timeoutMs)}`} />
            </div>
          </Card>

          <Card title="Run history" caption={runs.length > 0 ? `Last ${Math.min(runs.length, CHART_BARS)} runs. Click a bar to open the run.` : undefined}>
            <RenderIf condition={runs.length > 0} fallback={<p className="m-0 px-4 py-10 text-center text-sm text-muted-foreground">No runs yet. Start one with Run now.</p>}>
              <RunHistoryChart runs={runs} now={now} onOpenRun={onOpenRun} />
            </RenderIf>
          </Card>

          <RenderIf condition={runs.length > 0}>
            <Card
              title="Recent runs"
              caption={
                <span className="flex items-center justify-between gap-3">
                  <Button size="small" type="text" onClick={onOpenRuns}>
                    See all runs
                  </Button>
                  <Popconfirm title="Clear run history?" description="This deletes the logs, input and output of every finished run. Running and queued runs stay. It cannot be undone." okText="Clear history" okType="danger" onConfirm={onClearHistory}>
                    <Button size="small" type="text" danger icon={<Icon name="eraser" size={12} />}>
                      Clear history
                    </Button>
                  </Popconfirm>
                </span>
              }
            >
              <RunsTable runs={runs.slice(0, TABLE_ROWS)} now={now} onOpenRun={onOpenRun} />
            </Card>
          </RenderIf>
        </div>

        <aside className="flex flex-col gap-6">
          <Card title="Limits">
            <Card.Item align="center" label={<ItemLabel icon="clock">Timeout</ItemLabel>}>
              {formatTimeout(job.timeoutMs)} per attempt
            </Card.Item>
            <Card.Item align="center" label={<ItemLabel icon="refresh">Retries</ItemLabel>}>
              {job.maxRetries ? `${job.maxRetries} after a failure` : "None"}
            </Card.Item>
            <Card.Item align="center" label={<ItemLabel icon={Layers}>Overlap</ItemLabel>}>
              Skipped while running
            </Card.Item>
          </Card>

          <Card title="About">
            <Card.Item align="center" label={<ItemLabel icon="stars">Created</ItemLabel>}>
              <span className="tabular-nums">{formatDateTime(job.createdAt)}</span>
            </Card.Item>
            <Card.Item align="center" label={<ItemLabel icon="pen">Updated</ItemLabel>}>
              {relativeTime(job.updatedAt)}
            </Card.Item>
            <Card.Item align="start" label={<ItemLabel icon={Fingerprint}>Job id</ItemLabel>} description={<code className="font-mono text-2xs [overflow-wrap:anywhere]">{job.id}</code>} />
          </Card>

          <p className="m-0 text-xs leading-relaxed text-muted-foreground">Agents change the code, schedule, timeout and retries with update_job.</p>
          <Popconfirm title="Delete this job?" description="This removes the job and its run history. It cannot be undone." okText="Delete" okType="danger" onConfirm={onDelete}>
            <Button size="small" danger type="text" icon={<Icon name="trash" size={12} />} className="self-start">
              Delete job
            </Button>
          </Popconfirm>
        </aside>
      </div>
    </div>
  );
}
