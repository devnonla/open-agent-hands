import { Empty, Select, Skeleton, Tabs, message } from "devnonla-ui";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { wsClient } from "src/common/api/wsClient";
import { useNow } from "src/common/hooks/useNow";
import type { Job } from "src/common/types";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import { PageHeader } from "src/components/PageHeader";
import { PageBand } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fetchJobs, removeJobLocal, updateJobLocal, upsertJobLocal } from "./common/jobsSlice";
import { jobIsScheduled } from "./common/schedule";
import { JOB_FILTERS, JOB_SORTS, type JobFilter, type JobSort, JobsList, groupJobs } from "./components/JobsList";

function JobsSkeleton() {
  return (
    <div className="px-10 pb-6">
      <Skeleton active title={false} paragraph={{ rows: 6 }} />
    </div>
  );
}

function isJobFilter(value: string | null): value is JobFilter {
  return JOB_FILTERS.some((f) => f.key === value);
}

function isJobSort(value: string | null): value is JobSort {
  return JOB_SORTS.some((s) => s.key === value);
}

function hasUpcomingNextRun(items: Job[]): boolean {
  const now = Date.now();
  return items.some((j) => {
    if (!j.nextRunAt || !j.enabled || !jobIsScheduled(j.cron)) return false;
    const at = j.nextRunAt instanceof Date ? j.nextRunAt.getTime() : new Date(j.nextRunAt).getTime();
    const diff = at - now;
    return diff > 0;
  });
}

export default function JobsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const items = useAppSelector((s) => s.jobs.items) as Job[];
  const [loading, setLoading] = useState(items.length === 0);
  const now = useNow(hasUpcomingNextRun(items) ? 1_000 : 15_000);
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get("status");
  const filter: JobFilter = isJobFilter(statusParam) ? statusParam : "all";
  const sortParam = searchParams.get("sort");
  const sort: JobSort = isJobSort(sortParam) ? sortParam : "next";
  const setParam = (key: string, value: string, fallback: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const groups = useMemo(() => groupJobs(items, now), [items, now]);
  const counts: Record<JobFilter, number> = { all: items.length, upcoming: groups.upcoming.length, running: groups.running.length, idle: groups.idle.length };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await dispatch(fetchJobs({ limit: 100, sorts: "-updatedAt" })).unwrap();
      } catch (err: unknown) {
        if (!cancelled) message.error(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  useEffect(() => {
    const unsubUpdated = wsClient.on<Partial<Job> & { id: string }>("jobs:updated", (payload) => {
      dispatch(updateJobLocal(payload));
    });
    const unsubCreated = wsClient.on<Job>("jobs:created", (payload) => {
      dispatch(upsertJobLocal(payload));
    });
    const unsubDeleted = wsClient.on<{ id: string }>("jobs:deleted", (payload) => {
      dispatch(removeJobLocal(payload.id));
    });
    return () => {
      unsubUpdated();
      unsubCreated();
      unsubDeleted();
    };
  }, [dispatch]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageBand
        header={
          <PageHeader
            title="Jobs"
            icon="jobs"
            className="mb-0 pb-0"
            bordered={false}
            actions={items.length > 0 ? <Select value={sort} onChange={(next: JobSort) => setParam("sort", next, "next")} options={JOB_SORTS.map((s) => ({ value: s.key, label: `Sort: ${s.label}` }))} className="w-48" /> : undefined}
          />
        }
        tabs={
          items.length > 0 ? (
            <Tabs
              aria-label="Filter jobs"
              activeKey={filter}
              onChange={(next) => setParam("status", next, "all")}
              items={JOB_FILTERS.map((f) => ({
                key: f.key,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    {f.label}
                    <span className="text-xs tabular-nums text-muted-foreground">{counts[f.key]}</span>
                  </span>
                ),
              }))}
            />
          ) : undefined
        }
      />

      <RenderIf
        condition={items.length > 0 || loading}
        fallback={
          <div className="px-10 pb-8">
            <Empty className="rounded-2xl border border-dashed border-border px-5 py-16" description="No jobs yet">
              <AskClaudeHint what="job" tool="create_job" />
            </Empty>
          </div>
        }
      >
        <RenderIf condition={loading && items.length === 0}>
          <JobsSkeleton />
        </RenderIf>
        <RenderIf condition={items.length > 0}>
          <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-5 pb-6">
            <div className="mx-auto w-full max-w-5xl">
              <JobsList groups={groups} filter={filter} sort={sort} now={now} onOpen={(job) => navigate(`/jobs/${job.id}`)} />
            </div>
          </div>
        </RenderIf>
      </RenderIf>
    </div>
  );
}
