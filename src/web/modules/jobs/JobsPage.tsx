import { Empty, message } from "devnonla-ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { wsClient } from "src/common/api/wsClient";
import { useNow } from "src/common/hooks/useNow";
import type { Job } from "src/common/types";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fetchJobs, removeJobLocal, updateJobLocal, upsertJobLocal } from "./common/jobsSlice";
import { jobIsScheduled } from "./common/schedule";
import { JobsTree } from "./components/JobCard";

function JobsSkeleton() {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <div className="h-4 w-28 animate-pulse rounded bg-muted" />
      {["a", "b", "c", "d"].map((key) => (
        <div key={key} className="ml-8 h-9 animate-pulse rounded-lg bg-muted/60" />
      ))}
    </div>
  );
}

function hasUpcomingNextRun(items: Job[]): boolean {
  const now = Date.now();
  return items.some((j) => {
    if (!j.nextRunAt || !jobIsScheduled(j.cron)) return false;
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
    <PageShell>
      <PageHeader title="Jobs" icon="jobs" description="Scheduled jobs run on their own. Off jobs stay idle until a schedule is added." />

      <RenderIf
        condition={items.length > 0 || loading}
        fallback={
          <Empty className="rounded-2xl border border-dashed border-border px-5 py-16" description="No jobs yet">
            <AskClaudeHint what="job" tool="create_job" />
          </Empty>
        }
      >
        <RenderIf condition={loading && items.length === 0}>
          <JobsSkeleton />
        </RenderIf>
        <RenderIf condition={items.length > 0}>
          <JobsTree jobs={items} now={now} onOpen={(job) => navigate(`/jobs/${job.id}`)} />
        </RenderIf>
      </RenderIf>
    </PageShell>
  );
}
