import { Button, Popconfirm, Switch } from "devnonla-ui";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Job } from "src/common/types";
import { formatDateTime, relativeTime } from "src/common/utils/date";
import { describeCron, parseJobCronExpressions } from "../../common/schedule";

function formatTimeout(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms % 1_000 === 0) return `${ms / 1_000} s`;
  return `${ms} ms`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-border-subtle py-2.5 last:border-b-0">
      <span className="w-28 shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-[13px] text-foreground">{children}</div>
    </div>
  );
}

function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <h2 className="m-0 flex-1 text-[13px] font-semibold text-foreground">{title}</h2>
        {right}
      </header>
      <div className="px-4 py-1.5">{children}</div>
    </section>
  );
}

interface JobOverviewProps {
  job: Job;
  toggling: boolean;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}

export function JobOverview({ job, toggling, onToggle, onDelete }: JobOverviewProps) {
  const expressions = parseJobCronExpressions(job.cron);
  const hasSchedule = expressions.length > 0;
  const nextRuns = job.enabled ? (job.nextRuns ?? []) : [];

  return (
    <div className="h-full overflow-y-auto overscroll-contain px-6 pb-10 pt-5">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Card
          title="Schedule"
          right={
            hasSchedule ? (
              <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                {job.enabled ? "Active" : "Paused"}
                <Switch size="small" aria-label={job.enabled ? "Pause schedule" : "Resume schedule"} checked={job.enabled} disabled={toggling} onChange={onToggle} />
              </span>
            ) : null
          }
        >
          {hasSchedule ? (
            <>
              {expressions.map((expr) => (
                <Row key={expr} label="Runs">
                  <div className="flex flex-col gap-0.5">
                    <span className={job.enabled ? "" : "text-muted-foreground line-through"}>{describeCron(expr)}</span>
                    <code className="w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{expr}</code>
                  </div>
                </Row>
              ))}
              <Row label="Next runs">
                {nextRuns.length > 0 ? (
                  <ul className="m-0 flex list-none flex-col gap-0.5 p-0 tabular-nums">
                    {nextRuns.map((at) => (
                      <li key={at}>
                        {formatDateTime(at)} <span className="text-muted-foreground">· {relativeTime(at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">Paused. Turn the switch on to resume.</span>
                )}
              </Row>
            </>
          ) : (
            <p className="m-0 py-2.5 text-[13px] text-muted-foreground">
              Manual only. Ask your agent to add a cron with <code className="font-mono text-[12px]">update_job</code>.
            </p>
          )}
        </Card>

        <Card title="Details">
          <Row label="Description">{job.description ? job.description : <span className="text-muted-foreground">—</span>}</Row>
          <Row label="Timeout">{formatTimeout(job.timeoutMs)}</Row>
          <Row label="Last run">{job.lastRunAt ? `${formatDateTime(job.lastRunAt)} · ${relativeTime(job.lastRunAt)}` : <span className="text-muted-foreground">Never</span>}</Row>
          <Row label="Updated">{relativeTime(job.updatedAt)}</Row>
          <Row label="Id">
            <code className="font-mono text-[12px] text-muted-foreground">{job.id}</code>
          </Row>
        </Card>

        <p className="m-0 text-[12px] text-tertiary-foreground">Agents change the name, code, schedule and timeout with update_job. You can pause the schedule, start a run or fix the code by hand.</p>

        <div className="flex justify-end">
          <Popconfirm title="Delete this job?" description="This removes the job and its run history. It cannot be undone." okText="Delete" okType="danger" onConfirm={onDelete}>
            <Button size="small" danger type="text" icon={<Trash2 size={14} />}>
              Delete job
            </Button>
          </Popconfirm>
        </div>
      </div>
    </div>
  );
}
