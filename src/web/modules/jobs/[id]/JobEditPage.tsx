import { Button, Spin, Tabs, message, Icon } from "devnonla-ui";
import { Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { wsClient } from "src/common/api/wsClient";
import { useNow } from "src/common/hooks/useNow";
import { cn } from "src/common/lib/cn";
import type { Job, JobRun } from "src/common/types";
import { ContentBreadcrumb, ContentHeader } from "src/components/ContentBreadcrumb";
import { DraftReviewBar } from "src/components/DraftReviewBar";
import { PageHeader } from "src/components/PageHeader";
import { TabCount } from "src/components/TabCount";
import { FeatureIcon } from "src/components/FeatureIcon";
import { type EditorInstance, MonacoDiffEditor, MonacoEditor } from "src/components/MonacoEditor";
import { WindowHeaderBackButton } from "src/components/WindowHeaderBackButton";
import { jobsApi } from "../common/jobsApi";
import { isActiveRun } from "../common/runLogs";
import { JobOverview } from "./components/JobOverview";
import { JobRunsView } from "./components/JobRunsView";

const JOB_TABS = [
  { value: "overview", label: "Overview", icon: "book" },
  { value: "activities", label: "Runs", icon: "clock" },
  { value: "code", label: "Code", icon: "code" },
] as const;

type JobTab = (typeof JOB_TABS)[number]["value"];

function jobTabFromParam(section: string | undefined): JobTab {
  if (section === "activities" || section === "code") return section;
  return "overview";
}

function JobSectionTabs({ value, live, runCount, onChange }: { value: JobTab; live: boolean; runCount: number; onChange: (next: JobTab) => void }) {
  return (
    <Tabs
      aria-label="Job sections"
      activeKey={value}
      onChange={(key) => onChange(key as JobTab)}
      items={JOB_TABS.map((tab) => ({
        key: tab.value,
        icon: tab.icon,
        label: (
          <span className="inline-flex items-center gap-1.5">
            {tab.label}
            {tab.value === "activities" && runCount > 0 ? <TabCount value={runCount} /> : null}
            {tab.value === "activities" && live ? <span className="size-1.5 rounded-full bg-link motion-safe:animate-pulse" aria-label="A run is in progress" /> : null}
          </span>
        ),
      }))}
    />
  );
}

export default function JobEditPage() {
  const { id, section } = useParams<{ id: string; section?: string }>();
  const navigate = useNavigate();
  const tab = jobTabFromParam(section);

  useEffect(() => {
    if (!id || !section) return;
    if (section === "activities" || section === "code") return;
    navigate(`/jobs/${id}`, { replace: true });
  }, [id, section, navigate]);

  const openTab = (next: JobTab) => {
    if (!id || next === tab) return;
    navigate(next === "overview" ? `/jobs/${id}` : `/jobs/${id}/${next}`);
  };

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);

  const [name, setName] = useState("");

  const [localCode, setLocalCode] = useState("");
  const [savedCode, setSavedCode] = useState("");
  const codeRef = useRef(localCode);
  codeRef.current = localCode;
  const savedCodeRef = useRef(savedCode);
  savedCodeRef.current = savedCode;
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  const loadedIdRef = useRef<string | null>(null);

  const [runs, setRuns] = useState<JobRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const now = useNow(1_000);

  const isDirty = localCode !== savedCode;

  const loadRuns = useCallback(async (jobId: string) => {
    const res = await jobsApi.listRuns(jobId, { limit: 40 });
    setRuns(res.items);
    const live = res.items.find((r) => isActiveRun(r));
    setActiveRunId(live?.id ?? null);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    loadedIdRef.current = null;
    void (async () => {
      try {
        const data = await jobsApi.get(id);
        setJob(data);
        setName(data.name);
        if (loadedIdRef.current !== data.id) {
          setLocalCode(data.code);
          setSavedCode(data.code);
          loadedIdRef.current = data.id;
          if (data.draftCode && data.draftCode !== data.code) {
            setCodeDraft(data.draftCode);
          } else {
            setCodeDraft(null);
          }
        }
        await loadRuns(id);
      } catch {
        setJob(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, loadRuns]);

  useEffect(() => {
    if (!id) return;
    const unsubJob = wsClient.on<Partial<Job> & { id: string }>("jobs:updated", (payload) => {
      if (payload.id !== id) return;
      if ("code" in payload && payload.code != null) {
        setSavedCode(payload.code);
        setLocalCode(payload.code);
        setCodeDraft((prev) => (prev !== null && prev === payload.code ? null : prev));
      }
      if ("draftCode" in payload && payload.draftCode != null) {
        const draft = payload.draftCode;
        const code = payload.code ?? codeRef.current;
        setCodeDraft(draft !== code ? draft : null);
      }
      if ("name" in payload && payload.name) setName(payload.name);
      setJob((prev) => (prev ? { ...prev, ...payload } : prev));
    });

    const unsubRun = wsClient.on<JobRun>("job_runs:created", (payload) => {
      if (payload.jobId !== id) return;
      setRuns((prev) => [payload, ...prev.filter((r) => r.id !== payload.id)]);
      if (isActiveRun(payload)) {
        setActiveRunId(payload.id);
      }
    });

    const unsubRunUpd = wsClient.on<JobRun>("job_runs:updated", (payload) => {
      if (payload.jobId !== id) return;
      setRuns((prev) => prev.map((r) => (r.id === payload.id ? payload : r)));
      if (!isActiveRun(payload) && activeRunId === payload.id) {
        setActiveRunId(null);
      }
    });

    const unsubCleared = wsClient.on<{ jobId: string }>("job_runs:cleared", (payload) => {
      if (payload.jobId !== id) return;
      setRuns((prev) => prev.filter((r) => isActiveRun(r)));
    });

    const unsubLog = wsClient.on<{ id: string; jobId: string; entries: JobRun["logs"]; logs: JobRun["logs"] }>("job_runs:log", (payload) => {
      if (payload.jobId !== id) return;
      setRuns((prev) => prev.map((r) => (r.id === payload.id ? { ...r, logs: payload.logs } : r)));
    });

    return () => {
      unsubJob();
      unsubRun();
      unsubRunUpd();
      unsubLog();
      unsubCleared();
    };
  }, [id, activeRunId]);

  const handleSaveCode = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const updated = await jobsApi.update(id, { code: localCode });
      setJob(updated);
      setSavedCode(updated.code);
      setLocalCode(updated.code);
      setCodeDraft(null);
      message.success("Saved");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    if (!id) return;
    setToggling(true);
    try {
      await jobsApi.update(id, { enabled });
      setJob(await jobsApi.get(id));
      message.success(enabled ? "Schedule resumed" : "Schedule paused");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  };

  const handleRun = async () => {
    if (!id) return;
    if (isDirty) {
      message.warning("Save the code before running");
      return;
    }
    setRunning(true);
    try {
      const run = await jobsApi.run(id);
      setActiveRunId(run.id);
      setSelectedRunId(run.id);
      setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
      message.success("Run started");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleCancelRun = async (runId?: string | null) => {
    if (!id) return;
    const targetId = runId ?? activeRunId;
    if (!targetId) return;
    try {
      const run = await jobsApi.cancelRun(id, targetId);
      setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));
      message.success("Cancel requested");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearHistory = async () => {
    if (!id) return;
    try {
      const result = await jobsApi.clearRuns(id);
      setRuns((prev) => prev.filter((r) => isActiveRun(r)));
      setSelectedRunId(null);
      message.success(result.deleted === 1 ? "Cleared 1 run" : `Cleared ${result.deleted} runs`);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await jobsApi.remove(id);
      message.success("Deleted");
      navigate("/jobs");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Spin />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background">
        <p className="text-sm text-foreground">Job not found</p>
        <Button onClick={() => navigate("/jobs")}>Back to Jobs</Button>
      </div>
    );
  }

  const showDiff = codeDraft !== null && codeDraft !== localCode;
  const reviewBar = showDiff ? (
    <DraftReviewBar
      onApprove={() => {
        const draft = codeDraft;
        if (!draft) return;
        setLocalCode(draft);
        setSavedCode(draft);
        setCodeDraft(null);
        if (id) void jobsApi.update(id, { code: draft });
      }}
      onDiscard={() => {
        setCodeDraft(null);
        if (id) void jobsApi.update(id, { code: localCode });
      }}
    />
  ) : isDirty ? (
    <DraftReviewBar
      approving={saving}
      onApprove={() => void handleSaveCode()}
      onDiscard={() => setLocalCode(savedCode)}
      discardConfirm={{
        title: "Discard changes?",
        description: "Reset the editor to the last saved version. Unsaved edits will be lost.",
      }}
    />
  ) : null;

  const jobTitle = name || job.name;

  const openRun = (runId: string) => {
    setSelectedRunId(runId);
    openTab("activities");
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ContentHeader
          left={
            <div className="flex min-w-0 items-center gap-2">
              <WindowHeaderBackButton to="/jobs" label="Back to Jobs" />
              <ContentBreadcrumb items={[{ label: "Jobs", to: "/jobs", icon: <FeatureIcon name="jobs" size={16} variant="sticker" /> }, { label: jobTitle }]} />
            </div>
          }
        />
        <PageHeader
          title={jobTitle}
          icon="jobs"
          bordered={false}
          className="mb-0 shrink-0 bg-card px-3 pt-5 pb-0 sm:px-6 lg:px-8"
          description={job.description || undefined}
          actions={
            activeRunId ? (
              <Button danger icon={<Icon name="close" size={14} />} onClick={() => void handleCancelRun()}>
                Stop run
              </Button>
            ) : (
              <Button type="primary" icon={<Play size={14} />} loading={running} onClick={() => void handleRun()}>
                Run now
              </Button>
            )
          }
        >
          <JobSectionTabs value={tab} live={!!activeRunId} runCount={runs.length} onChange={openTab} />
        </PageHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className={cn("relative min-h-0 min-w-0 flex-1 overflow-hidden", tab !== "code" && "hidden")}>
              {showDiff && codeDraft != null ? (
                <div className="absolute inset-0">
                  <MonacoDiffEditor
                    language="typescript"
                    original={localCode}
                    modified={codeDraft}
                    options={{ fontSize: 13, renderSideBySide: false, renderIndicators: false }}
                    onMount={(editor) => {
                      editor.getOriginalEditor().updateOptions({ lineNumbers: "off" });
                    }}
                  />
                </div>
              ) : (
                <div className="absolute inset-0">
                  <MonacoEditor
                    language="typescript"
                    value={localCode}
                    onChange={(v) => setLocalCode(v ?? "")}
                    onMount={(editor) => {
                      editorRef.current = editor;
                    }}
                    onSave={() => void handleSaveCode()}
                    options={{ fontSize: 13, tabSize: 2 }}
                    height="100%"
                  />
                </div>
              )}
              {reviewBar ? <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">{reviewBar}</div> : null}
            </div>
            {tab === "overview" ? <JobOverview job={job} runs={runs} now={now} toggling={toggling} onToggle={(enabled) => void handleToggle(enabled)} onDelete={() => void handleDelete()} onOpenRun={openRun} onOpenRuns={() => openTab("activities")} onClearHistory={() => void handleClearHistory()} /> : null}
            {tab === "activities" ? <JobRunsView jobName={jobTitle} runs={runs} selectedId={selectedRunId} onSelect={setSelectedRunId} activeRunId={activeRunId} onCancelRun={(runId) => void handleCancelRun(runId)} onClearHistory={() => void handleClearHistory()} now={now} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
