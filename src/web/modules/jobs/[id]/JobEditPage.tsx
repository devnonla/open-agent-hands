import { Button, Icon, Segmented, message } from "devnonla-ui";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { wsClient } from "src/common/api/wsClient";
import { cn } from "src/common/lib/cn";
import type { Job, JobRun } from "src/common/types";
import { DraftReviewBar } from "src/components/DraftReviewBar";
import { FeatureIcon } from "src/components/FeatureIcon";
import { type EditorInstance, MonacoDiffEditor, MonacoEditor } from "src/components/MonacoEditor";
import { WindowHeaderBackButton } from "src/components/WindowHeaderBackButton";
import { AgentsContentHeader, ContentBreadcrumb } from "src/modules/agents/components/ContentBreadcrumb";
import { jobsApi } from "../common/jobsApi";
import { type JobSchedule, buildJobCrons, formatJobSchedulesLabel, jobIsScheduled, parseJobSchedules, validateJobSchedules } from "../common/schedule";
import { type JobSettingsSection, JobSettingsView } from "./components/JobSettingsView";

const JOB_TABS = [
  { value: "code", label: "Code", icon: "code" },
  { value: "schedules", label: "Schedules", icon: "clock" },
  { value: "activities", label: "Activities", icon: "clock" },
  { value: "settings", label: "Settings", icon: "pen" },
] as const;

type JobTab = (typeof JOB_TABS)[number]["value"];

function jobTabFromParam(section: string | undefined): JobTab {
  if (section === "schedules" || section === "activities" || section === "settings") return section;
  return "code";
}

function JobSectionTabs({ value, live, onChange }: { value: JobTab; live: boolean; onChange: (next: JobTab) => void }) {
  return (
    <Segmented
      size="small"
      value={value}
      onChange={onChange}
      options={JOB_TABS.map((tab) => ({
        value: tab.value,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <Icon name={tab.icon} size={14} />
            {tab.label}
            {tab.value === "activities" && live ? <span className="size-1.5 animate-pulse rounded-full bg-brand-700" /> : null}
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
    if (section === "schedules" || section === "activities" || section === "settings") return;
    navigate(`/jobs/${id}`, { replace: true });
  }, [id, section, navigate]);

  const openTab = (next: JobTab) => {
    if (!id || next === tab) return;
    navigate(next === "code" ? `/jobs/${id}` : `/jobs/${id}/${next}`);
  };

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSchedules, setSavingSchedules] = useState(false);
  const [running, setRunning] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schedules, setSchedules] = useState<JobSchedule[]>([]);
  const [timeoutMs, setTimeoutMs] = useState(300_000);

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

  const isDirty = localCode !== savedCode;
  const schedulesDirty = buildJobCrons(schedules) !== (job?.cron ?? "");
  const isOn = jobIsScheduled(job?.cron);
  const scheduleLabel = formatJobSchedulesLabel(job?.cron);

  const loadRuns = useCallback(async (jobId: string) => {
    const res = await jobsApi.listRuns(jobId, { limit: 40 });
    setRuns(res.items);
    const live = res.items.find((r) => r.status === "running");
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
        setDescription(data.description ?? "");
        setSchedules(parseJobSchedules(data.cron));
        setTimeoutMs(data.timeoutMs);
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
      if ("cron" in payload && typeof payload.cron === "string") {
        setSchedules((prev) => (buildJobCrons(prev) === payload.cron ? parseJobSchedules(payload.cron) : prev));
      }
      if ("timeoutMs" in payload && typeof payload.timeoutMs === "number") setTimeoutMs(payload.timeoutMs);
      setJob((prev) => (prev ? { ...prev, ...payload } : prev));
    });

    const unsubRun = wsClient.on<JobRun>("job_runs:created", (payload) => {
      if (payload.jobId !== id) return;
      setRuns((prev) => [payload, ...prev.filter((r) => r.id !== payload.id)]);
      if (payload.status === "running") {
        setActiveRunId(payload.id);
      }
    });

    const unsubRunUpd = wsClient.on<JobRun>("job_runs:updated", (payload) => {
      if (payload.jobId !== id) return;
      setRuns((prev) => prev.map((r) => (r.id === payload.id ? payload : r)));
      if (payload.status !== "running" && activeRunId === payload.id) {
        setActiveRunId(null);
      }
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

  const handleSaveSettings = async (values: { name: string; description: string; timeoutMs: number }) => {
    if (!id) return;
    setSaving(true);
    try {
      const updated = await jobsApi.update(id, {
        name: values.name.trim(),
        description: values.description.trim() || null,
        timeoutMs: Number(values.timeoutMs) || 300_000,
      });
      setJob(updated);
      setName(updated.name);
      setDescription(updated.description ?? "");
      setTimeoutMs(updated.timeoutMs);
      message.success("Saved");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSchedules = async () => {
    if (!id) return;
    const scheduleError = validateJobSchedules(schedules);
    if (scheduleError) {
      message.error(scheduleError);
      return;
    }
    setSavingSchedules(true);
    try {
      const updated = await jobsApi.update(id, { cron: buildJobCrons(schedules) });
      setJob(updated);
      setSchedules(parseJobSchedules(updated.cron));
      message.success(jobIsScheduled(updated.cron) ? "Schedules saved" : "Schedules cleared — job is off");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSchedules(false);
    }
  };

  const handleRun = async () => {
    if (!id) return;
    if (isDirty) {
      message.warning("Save before running scheduled job code");
      return;
    }
    setRunning(true);
    try {
      const run = await jobsApi.run(id);
      setActiveRunId(run.id);
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
    return <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">Loading…</div>;
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
  const panelSection: JobSettingsSection = tab === "settings" ? "general" : tab === "code" ? "schedules" : tab;

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AgentsContentHeader
          left={
            <div className="flex min-w-0 items-center gap-2">
              <WindowHeaderBackButton to="/jobs" label="Back to Jobs" />
              <ContentBreadcrumb items={[{ label: "Jobs", to: "/jobs", icon: <FeatureIcon name="jobs" size={16} variant="sticker" /> }, { label: jobTitle }]} />
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ${isOn ? "bg-success/15 text-success" : "bg-muted text-tertiary-foreground"}`}>
                <span className={`size-1.5 rounded-full ${isOn ? "bg-success" : "bg-quaternary-foreground"}`} />
                {isOn ? "On" : "Off"}
              </span>
              <span className="hidden min-w-0 truncate text-[11px] leading-none text-tertiary-foreground lg:inline">{scheduleLabel}</span>
            </div>
          }
          right={
            activeRunId ? (
              <Button size="small" danger icon={<X size={14} />} onClick={() => void handleCancelRun()}>
                Stop
              </Button>
            ) : null
          }
        />
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
          <JobSectionTabs value={tab} live={!!activeRunId} onChange={openTab} />
        </div>

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
            {tab !== "code" ? (
              <div className="min-h-0 flex-1 overflow-hidden">
                <JobSettingsView
                  section={panelSection}
                  name={name}
                  description={description}
                  timeoutMs={timeoutMs}
                  savingGeneral={saving}
                  onSaveGeneral={handleSaveSettings}
                  onDelete={() => void handleDelete()}
                  schedules={schedules}
                  onSchedulesChange={setSchedules}
                  onDiscardSchedules={() => setSchedules(parseJobSchedules(job.cron))}
                  schedulesDirty={schedulesDirty}
                  savingSchedules={savingSchedules}
                  onSaveSchedules={() => void handleSaveSchedules()}
                  runs={runs}
                  activeRunId={activeRunId}
                  running={running}
                  onRun={() => void handleRun()}
                  onCancelRun={(runId) => void handleCancelRun(runId)}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
