import { Icon, Shimmer, Spin } from "devnonla-ui";
import { ChatAgentMessage, ChatUserMessage, type ToolUIProps, ToolUiTrailing, formatToolName, isToolRunning } from "devnonla-ui/chat";
import { useEffect, useRef } from "react";
import { cn } from "src/common/lib/cn";
import { ActivitySteps } from "src/components/chat/_components/tool-uis/CallAgentStepsToolUI";

type SubStep = {
  id?: string;
  kind?: string;
  name?: string;
  text?: string;
  input?: unknown;
  output?: unknown;
};

function parseObj(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
    return null;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

const AGENT_TITLES: Record<string, string> = {
  nonla_agent_instruct_writer: "Write Agent Prompt",
  nonla_agent_manager: "Agent Manager",
  nonla_tool_manager: "Tool Manager",
  nonla_skill_manager: "Skill Manager",
  nonla_site_manager: "Site Manager",
  nonla_job_manager: "Job Manager",
  nonla_storage_manager: "Nonla Storage Manager",
  nonla_datatable_manager: "Datatable Manager",
  nonla_kv_manager: "Nonla KV Manager",
  nonla_agent_instruct_reviewer: "Review Agent Prompt",
  nonla_get_skill_files: "Get Skill Files",
  nonla_edit_skill_code: "Edit Skill Code",
  nonla_delete_skill_file: "Delete Skill File",
  nonla_get_site_code: "Get Site Code",
  nonla_edit_site_code: "Edit Site Code",
  nonla_edit_job_code: "Edit Job Code",
  nonla_run_job: "Run Job",
  nonla_writer: "Writer",
  nonla_reviewer: "Reviewer",
  nonla_write_tool_draft_code: "Write Tool Draft Code",
  nonla_review_tool_draft_code: "Test Tool Draft Code",
  nonla_write_site_draft: "Write Site Draft",
  nonla_review_site_draft: "Test Site Draft",
  nonla_write_job_draft: "Write Job Draft",
  nonla_review_job_draft: "Test Job Draft",
  nonla_write_agent_instruct: "Write Agent Prompt",
  nonla_review_agent_instruct: "Prompt Reviewer",
  nonla_tools_manager: "Write Tool Draft Code",
  nonla_code_site: "Edit Site Code",
  nonla_code_job: "Edit Job Code",
  nonla_code_datatable: "Datatable Agent",
  nonla_code_prompt: "Write Agent Prompt",
};

function statusLine(activity: SubStep[], running: boolean): string | null {
  if (!running) return null;
  const last = activity[activity.length - 1];
  if (!last) return "Thinking...";
  if (last.kind === "tool" && last.output == null) return `Running ${formatToolName(last.name || "tool")}...`;
  return "Waiting for model...";
}

export function CodeToolAgentUI({ msg, generating = false }: ToolUIProps) {
  const input = parseObj(msg.toolInput);
  const output = parseObj(msg.toolOutput);
  const task = typeof input?.task === "string" ? input.task.trim() : "";
  const activity = Array.isArray(input?.activity) ? (input.activity as SubStep[]) : [];
  const summary = typeof output?.summary === "string" ? output.summary.trim() : "";
  const error = typeof output?.error === "string" ? output.error : "";
  const running = isToolRunning(msg, generating);
  const failed = Boolean(msg.toolError) || output?.ok === false;
  const tested = output?.tested === true;
  const lastText = [...activity]
    .reverse()
    .find((step) => step.kind === "text" && step.text?.trim())
    ?.text?.trim();
  const showSummary = Boolean(summary) && summary !== lastText;
  const agentTitle = AGENT_TITLES[msg.toolName ?? ""] ?? "Agent";
  const live = statusLine(activity, running);
  const doneLabel = failed ? "Failed" : tested ? "Draft tested" : "Finished";
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !running) return;
    el.scrollTop = el.scrollHeight;
  }, [running, activity.length, summary]);

  return (
    <div className="mt-1 px-4 py-1">
      <div className={cn("overflow-hidden rounded-xl border bg-card", failed ? "border-destructive/35" : "border-border")}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {running ? <Spin variant="agent" size="small" className="shrink-0" /> : <Icon name="dialog" size={13} className="shrink-0 text-muted-foreground" />}
          <Shimmer active={running} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {running ? `Calling ${agentTitle}` : `Called ${agentTitle}`}
          </Shimmer>
          {running ? null : <span className="max-w-40 truncate text-sm text-muted-foreground">{doneLabel}</span>}
          <ToolUiTrailing failed={failed && !running} />
        </div>

        <div ref={scrollerRef} className="max-h-96 overflow-y-auto pb-1">
          {task ? <ChatUserMessage content={task} className="mt-2 mb-2" /> : null}
          <ActivitySteps steps={activity} running={running} />
          {showSummary ? <ChatAgentMessage content={summary} /> : null}
          {failed && !running && !summary ? <ChatAgentMessage content={error || "Coding agent failed"} /> : null}
          {live ? (
            <div className="px-4 py-1">
              <Shimmer className="text-sm font-medium text-muted-foreground">{live}</Shimmer>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
