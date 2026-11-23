import { Button, MenuItem, Popconfirm, Segmented, SearchInput, Tooltip, Icon } from "devnonla-ui";
import { CircleCheck, CircleDot, CircleX, LoaderCircle, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "src/common/lib/cn";
import type { JobRun } from "src/common/types";
import { formatDayHeader, getDayKey, relativeTime } from "src/common/utils/date";
import RenderIf from "src/components/RenderIf";
import { RunStatusTag } from "../../components/RunStatusTag";
import { buildLogBlocks, formatDuration, isActiveRun, type LogBlock, linesLabel, normalizeLogs, runDurationMs, runHeadline } from "../../common/runLogs";

const STATUS_META: Record<JobRun["status"], { label: string; dot: string; pill: string; bar: string }> = {
  success: { label: "Completed", dot: "bg-green-500", pill: "bg-green-500/10 text-green-600", bar: "bg-green-500" },
  failed: { label: "Failed", dot: "bg-red-500", pill: "bg-red-500/10 text-red-500", bar: "bg-red-500" },
  running: { label: "Executing", dot: "bg-violet-500 motion-safe:animate-pulse", pill: "bg-violet-500/10 text-violet-500", bar: "bg-violet-500 motion-safe:animate-pulse" },
  queued: { label: "Queued", dot: "bg-muted-foreground/50", pill: "bg-ink-active text-muted-foreground", bar: "bg-muted-foreground/40" },
};

const TICKS = [0, 0.25, 0.5, 0.75, 1];
const ROW = "h-8";

const timeFormat = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fullFormat = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

type TraceRow = {
  id: string;
  depth: number;
  kind: "run" | "step" | "lines" | "system";
  label: string;
  t: number;
  end: number | null;
  tone: "neutral" | "success" | "error" | "warn" | "running";
  block: LogBlock | null;
  hasChildren: boolean;
};

function RunList({ runs, selectedId, onSelect, onClearHistory, now }: { runs: JobRun[]; selectedId: string | null; onSelect: (id: string) => void; onClearHistory?: () => void; now: number }) {
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; runs: JobRun[] }>();
    for (const run of runs) {
      const key = getDayKey(run.startedAt);
      const group = map.get(key) ?? { label: formatDayHeader(run.startedAt), runs: [] };
      group.runs.push(run);
      map.set(key, group);
    }
    return [...map.entries()];
  }, [runs]);

  return (
    <nav aria-label="Runs" className="flex w-52 shrink-0 xl:w-60 flex-col overflow-y-auto border-r border-border-secondary px-2 py-3">
      <RenderIf condition={!!onClearHistory && runs.some((r) => !isActiveRun(r))}>
        <div className="mb-2 flex items-center justify-between px-2.5">
          <span className="text-xs text-muted-foreground">
            {runs.length} {runs.length === 1 ? "run" : "runs"}
          </span>
          <Popconfirm title="Clear run history?" description="This deletes the logs, input and output of every finished run. Running and queued runs stay. It cannot be undone." okText="Clear history" okType="danger" onConfirm={() => onClearHistory?.()}>
            <Button size="small" type="text" danger icon={<Icon name="eraser" size={12} />}>
              Clear
            </Button>
          </Popconfirm>
        </div>
      </RenderIf>
      <RenderIf condition={runs.length === 0}>
        <p className="m-0 px-3 py-10 text-center text-sm text-muted-foreground">No runs yet</p>
      </RenderIf>
      {groups.map(([key, group]) => (
        <section key={key} className="mb-3">
          <h3 className="m-0 px-2.5 pb-1 text-xs font-medium text-muted-foreground">{group.label}</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {group.runs.map((run) => {
              const active = run.id === selectedId;
              const duration = runDurationMs(run, now);
              return (
                <li key={run.id}>
                  <MenuItem
                    selected={active}
                    onClick={() => onSelect(run.id)}
                    icon={<span className={cn("size-2 rounded-full", STATUS_META[run.status].dot)} aria-label={STATUS_META[run.status].label} />}
                    label={
                      <span className="tabular-nums">
                        {timeFormat.format(new Date(run.startedAt))}
                        <span className="ml-2 text-2xs text-muted-foreground">{run.trigger === "cron" ? "cron" : "manual"}</span>
                      </span>
                    }
                    extra={duration != null ? formatDuration(duration) : ""}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function blockToRows(block: LogBlock, depth: number, total: number, running: boolean, collapsed: Set<string>, out: TraceRow[]) {
  if (block.type === "step") {
    const open = block.duration == null;
    out.push({
      id: block.key,
      depth,
      kind: "step",
      label: block.attempts > 1 ? `${block.name} · ${block.attempts} tries` : block.name,
      t: block.t,
      end: open ? (running ? total : block.t) : block.t + (block.duration ?? 0),
      tone: block.failed ? "error" : open && running ? "running" : "success",
      block,
      hasChildren: block.children.length > 0,
    });
    if (!collapsed.has(block.key)) for (const child of block.children) blockToRows(child, depth + 1, total, running, collapsed, out);
    return;
  }
  if (block.type === "system") {
    out.push({ id: block.key, depth, kind: "system", label: block.message, t: block.t, end: null, tone: block.level === "error" ? "error" : block.level === "warn" ? "warn" : "neutral", block, hasChildren: false });
    return;
  }
  out.push({ id: block.key, depth, kind: "lines", label: linesLabel(block.lines), t: block.t, end: null, tone: block.level === "error" ? "error" : block.level === "warn" ? "warn" : "neutral", block, hasChildren: false });
}

function RowIcon({ row }: { row: TraceRow }) {
  if (row.kind === "run" || row.kind === "step") {
    if (row.tone === "running") return <LoaderCircle size={14} className="shrink-0 text-violet-500 motion-safe:animate-spin" />;
    if (row.tone === "error") return <CircleX size={14} className="shrink-0 text-red-500" />;
    return <CircleCheck size={14} className="shrink-0 text-green-600" />;
  }
  if (row.tone === "error") return <Icon name="error" size={14} className="shrink-0 text-red-500" />;
  if (row.tone === "warn") return <TriangleAlert size={14} className="shrink-0 text-amber-500" />;
  if (row.kind === "system") return <CircleDot size={14} className="shrink-0 text-tertiary-foreground" />;
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
      <span className="size-1 rounded-full bg-muted-foreground/50" />
    </span>
  );
}

const BAR_TONE: Record<TraceRow["tone"], string> = {
  neutral: "bg-muted-foreground/45",
  success: "bg-green-500",
  error: "bg-red-500",
  warn: "bg-amber-500",
  running: "bg-violet-500 motion-safe:animate-pulse",
};

function TimelineCell({ row, total }: { row: TraceRow; total: number }) {
  const left = Math.min(100, Math.max(0, (row.t / total) * 100));
  return (
    <div className="relative h-full bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px)] bg-[length:25%_100%]">
      {row.end != null ? (
        <span className={cn("absolute top-1/2 h-2.5 min-w-[3px] -translate-y-1/2 rounded-[3px]", BAR_TONE[row.tone])} style={{ left: `${left}%`, width: `${Math.max(0, Math.min(100 - left, ((row.end - row.t) / total) * 100))}%` }} />
      ) : (
        <Tooltip title={`Logged at +${formatDuration(row.t)}`}>
          <span className={cn("absolute top-1/2 h-3.5 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full", row.tone === "neutral" ? "bg-muted-foreground/35" : BAR_TONE[row.tone])} style={{ left: `${left}%` }} />
        </Tooltip>
      )}
    </div>
  );
}

function TraceView({ run, jobName, rows, total, selectedRowId, collapsed, onSelectRow, onToggle }: { run: JobRun; jobName: string; rows: TraceRow[]; total: number; selectedRowId: string; collapsed: Set<string>; onSelectRow: (id: string) => void; onToggle: (id: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const running = isActiveRun(run);

  useEffect(() => {
    if (!running || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [running, rows.length]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div className="grid min-w-[640px] grid-cols-[minmax(260px,1.1fr)_minmax(240px,1fr)]">
        <div className="sticky top-0 z-10 col-span-2 grid grid-cols-subgrid border-b border-border bg-background">
          <div className="flex h-8 items-center px-4 text-xs text-muted-foreground">{jobName}</div>
          <div className="relative mr-6 h-8">
            {TICKS.map((tick) => (
              <span key={tick} className={cn("absolute top-1/2 -translate-y-1/2 text-2xs tabular-nums text-muted-foreground", tick === 0 ? "" : tick === 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${tick * 100}%` }}>
                {formatDuration(total * tick)}
              </span>
            ))}
          </div>
        </div>
        {rows.map((row) => {
          const selected = row.id === selectedRowId;
          const duration = row.end != null ? row.end - row.t : null;
          return (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectRow(row.id)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onSelectRow(row.id);
              }}
              className={cn("group col-span-2 grid cursor-pointer grid-cols-subgrid", selected ? "bg-violet-500/10" : "hover:bg-ink-hover focus-visible:bg-ink-hover")}
            >
              <div className={cn("flex min-w-0 items-center gap-1.5 pr-3", ROW)} style={{ paddingLeft: `${16 + row.depth * 18}px` }}>
                {row.hasChildren ? (
                  <Button
                    type="text"
                    size="small"
                    aria-label={collapsed.has(row.id) ? "Expand" : "Collapse"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(row.id);
                    }}
                    className="size-4! min-w-0! p-0!"
                    icon={<Icon name="arrow-right" size={12} className={cn("transition-transform duration-150", !collapsed.has(row.id) && "rotate-90")} />}
                  />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <RowIcon row={row} />
                <span className={cn("min-w-0 flex-1 truncate text-sm", row.kind === "lines" ? "font-mono text-xs" : "", row.tone === "error" ? "text-red-500" : row.kind === "system" ? "text-muted-foreground" : "text-foreground", row.kind === "run" && "font-medium")}>{row.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{duration != null ? formatDuration(duration) : ""}</span>
              </div>
              <div className={cn("mr-6", ROW)}>
                <TimelineCell row={row} total={total} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 font-mono text-xs leading-[1.6] text-foreground">{text}</pre>;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border-secondary py-3 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-sm text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Inspector({ run, row, total, onCancel }: { run: JobRun; row: TraceRow | null; total: number; onCancel?: (runId: string) => void }) {
  const headline = runHeadline(run);
  const block = row?.block ?? null;

  if (!row || row.kind === "run") {
    return (
      <>
        <div className="flex items-center gap-3">
          <RunStatusTag status={run.status} />
          <RenderIf condition={isActiveRun(run) && !!onCancel}>
            <Button size="small" danger icon={<Icon name="stop" size={12} />} className="ml-auto" onClick={() => onCancel?.(run.id)}>
              Stop run
            </Button>
          </RenderIf>
        </div>
        <RenderIf condition={!!headline}>
          <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/[0.05] px-3.5 py-3">
            <p className="m-0 font-mono text-xs leading-relaxed text-red-500 [overflow-wrap:anywhere]">{headline?.title}</p>
            <RenderIf condition={!!headline?.detail}>
              <p className="m-0 mt-1 text-xs text-red-500">{headline?.detail}</p>
            </RenderIf>
          </div>
        </RenderIf>
        <dl className="m-0 mt-3">
          <Field label="Started">
            <span className="tabular-nums">{fullFormat.format(new Date(run.startedAt))}</span> <span className="text-muted-foreground">{relativeTime(run.startedAt)}</span>
          </Field>
          <Field label="Duration">{run.status === "queued" ? "Waiting for a free slot" : formatDuration(total)}</Field>
          <Field label="Started by">{run.trigger === "cron" ? "Schedule" : "A person or an agent"}</Field>
          <RenderIf condition={!!run.scheduledFor}>
            <Field label="Scheduled for">
              <span className="tabular-nums">{run.scheduledFor ? fullFormat.format(new Date(run.scheduledFor)) : ""}</span>
            </Field>
          </RenderIf>
          <RenderIf condition={(run.attempts ?? 1) > 1}>
            <Field label="Attempts">{run.attempts}</Field>
          </RenderIf>
          <RenderIf condition={hasValue(run.input)}>
            <Field label="Input">
              <JsonBlock value={run.input} />
            </Field>
          </RenderIf>
          <RenderIf condition={hasValue(run.output)}>
            <Field label="Output">
              <JsonBlock value={run.output} />
            </Field>
          </RenderIf>
          <Field label="Run id">
            <code className="font-mono text-xs text-muted-foreground">{run.id}</code>
          </Field>
        </dl>
      </>
    );
  }

  const title = row.kind === "step" ? "Step" : row.kind === "system" ? "Event" : row.tone === "error" ? "Error output" : row.tone === "warn" ? "Warning" : "Log";
  return (
    <>
      <p className="m-0 text-xs text-muted-foreground">{title}</p>
      <h3 className={cn("m-0 mt-1 text-base font-medium [overflow-wrap:anywhere]", row.tone === "error" ? "text-red-500" : "text-foreground", row.kind === "lines" && "font-mono text-sm")}>{row.label}</h3>
      <dl className="m-0 mt-3">
        <Field label="At">+{formatDuration(row.t)} after start</Field>
        <RenderIf condition={row.end != null}>
          <Field label="Duration">{formatDuration((row.end ?? row.t) - row.t)}</Field>
        </RenderIf>
        <RenderIf condition={block?.type === "step"}>
          <Field label="Result">{row.tone === "error" ? "Failed" : row.tone === "running" ? "Still running" : "Completed"}</Field>
        </RenderIf>
        <RenderIf condition={block?.type === "step" && block.attempts > 1}>
          <Field label="Tries">{block?.type === "step" ? block.attempts : 1}</Field>
        </RenderIf>
        <RenderIf condition={block?.type === "step" && !!block.error}>
          <Field label="Error">
            <span className="font-mono text-xs text-red-500">{block?.type === "step" ? block.error : ""}</span>
          </Field>
        </RenderIf>
        <RenderIf condition={block?.type === "lines" && hasValue(block.data)}>
          <Field label="Data">
            <JsonBlock value={block?.type === "lines" ? block.data : null} />
          </Field>
        </RenderIf>
      </dl>
      <RenderIf condition={block?.type === "lines"}>
        <pre className={cn("m-0 mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg px-3.5 py-3 font-mono text-xs leading-[1.65]", row.tone === "error" ? "bg-red-500/[0.06] text-red-500" : row.tone === "warn" ? "bg-warn-bg text-amber-500" : "bg-muted text-foreground")}>
          {block?.type === "lines" ? block.lines.join("\n") : ""}
        </pre>
      </RenderIf>
    </>
  );
}

function matchesFilter(block: LogBlock, q: string, errorsOnly: boolean): boolean {
  if (block.type === "step") return block.children.some((c) => matchesFilter(c, q, errorsOnly)) || ((!errorsOnly || block.failed) && (!q || block.name.toLowerCase().includes(q)));
  if (block.type === "system") return (!errorsOnly || block.level !== "info") && (!q || block.message.toLowerCase().includes(q));
  return (!errorsOnly || block.level !== "info") && (!q || block.lines.some((l) => l.toLowerCase().includes(q)));
}

function filterBlocks(blocks: LogBlock[], q: string, errorsOnly: boolean): LogBlock[] {
  if (!q && !errorsOnly) return blocks;
  return blocks.filter((b) => matchesFilter(b, q, errorsOnly)).map((b) => (b.type === "step" ? { ...b, children: filterBlocks(b.children, q, errorsOnly) } : b));
}

function RunDetail({ run, jobName, now, onCancel }: { run: JobRun; jobName: string; now: number; onCancel?: (runId: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "errors">("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedRowId, setSelectedRowId] = useState("run");
  const running = isActiveRun(run);
  const entries = useMemo(() => normalizeLogs(run.logs), [run.logs]);
  const blocks = useMemo(() => filterBlocks(buildLogBlocks(entries), query.trim().toLowerCase(), filter === "errors"), [entries, query, filter]);
  const total = Math.max(1, runDurationMs(run, now) ?? 1);

  const rows = useMemo(() => {
    const out: TraceRow[] = [
      { id: "run", depth: 0, kind: "run", label: run.status === "queued" ? "Waiting for a free slot" : running ? "Run in progress" : run.status === "failed" ? "Run failed" : "Run completed", t: 0, end: total, tone: run.status === "failed" ? "error" : running ? "running" : "success", block: null, hasChildren: false },
    ];
    for (const block of blocks) blockToRows(block, 1, total, running, collapsed, out);
    return out;
  }, [blocks, collapsed, total, running, run.status]);

  const selectedRow = rows.find((r) => r.id === selectedRowId) ?? rows[0];

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden bg-card">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-secondary px-4 py-2.5">
          <RunStatusTag status={run.status} />
          <span className="text-sm tabular-nums text-foreground">{timeFormat.format(new Date(run.startedAt))}</span>
          <span className="text-sm tabular-nums text-muted-foreground">{formatDuration(total)}</span>
          <Segmented
            size="small"
            className="ml-auto"
            value={filter}
            onChange={(v) => setFilter(v as "all" | "errors")}
            options={[
              { value: "all", label: "All" },
              { value: "errors", label: "Problems" },
            ]}
          />
          <SearchInput size="small" placeholder="Search log" onChange={setQuery} wait={150} className="w-48" />
        </div>
        <RenderIf condition={rows.length > 1 || (!query && filter === "all")} fallback={<p className="m-0 py-10 text-center text-sm text-muted-foreground">Nothing matches this filter.</p>}>
          <TraceView
            run={run}
            jobName={jobName}
            rows={rows}
            total={total}
            selectedRowId={selectedRow.id}
            collapsed={collapsed}
            onSelectRow={setSelectedRowId}
            onToggle={(id) =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        </RenderIf>
      </div>
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-border-secondary px-5 py-4 xl:w-[360px]">
        <Inspector run={run} row={selectedRow} total={total} onCancel={onCancel} />
      </aside>
    </div>
  );
}

export function JobRunsView({
  jobName,
  runs,
  selectedId,
  onSelect,
  activeRunId,
  onCancelRun,
  onClearHistory,
  now,
}: { jobName: string; runs: JobRun[]; selectedId: string | null; onSelect: (id: string) => void; activeRunId: string | null; onCancelRun?: (runId: string) => void; onClearHistory?: () => void; now: number }) {
  const selected = runs.find((r) => r.id === (selectedId ?? activeRunId ?? runs[0]?.id)) ?? null;
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <RunList runs={runs} selectedId={selected?.id ?? null} onSelect={onSelect} onClearHistory={onClearHistory} now={now} />
      {selected ? (
        <RunDetail key={selected.id} run={selected} jobName={jobName} now={now} onCancel={onCancelRun} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{runs.length === 0 ? "Run history is empty. Runs appear here as they start." : "Pick a run on the left to see what happened."}</div>
      )}
    </div>
  );
}
