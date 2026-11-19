import { Icon, Shimmer } from "devnonla-ui";
import { type ToolUIProps, ToolUiTrailing, isToolRunning, prettyJson } from "devnonla-ui/chat";
import { useState } from "react";
import { cn } from "src/common/lib/cn";

type ToolRow = { id?: string; name?: string; label?: string; deleted?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const ACTION_ASIDE: Record<string, { run: string; done: string; fail: string }> = {
  list: { run: "Listing tools", done: "Listed tools", fail: "List failed" },
  get: { run: "Getting", done: "Got", fail: "Get failed" },
  create: { run: "Creating", done: "Created", fail: "Create failed" },
  update: { run: "Updating", done: "Updated", fail: "Update failed" },
  delete: { run: "Deleting", done: "Deleted", fail: "Delete failed" },
};

/** One-line aside for a Manage Tools call: what the action did, plus the tool it touched. */
export function manageToolsAside(input: unknown, output: unknown, state: "run" | "done" | "fail"): string {
  const fields = asRecord(parseMaybe(input));
  const action = text(fields?.action);
  if (!action) return "";

  const phrase = ACTION_ASIDE[action]?.[state] ?? action;
  const result = asRecord(parseMaybe(output))?.result;
  if (action === "list") {
    if (state === "done" && Array.isArray(result)) return `Listed ${result.length} tools`;
    return phrase;
  }

  const row = asRecord(result) as ToolRow | null;
  const body = asRecord(fields?.body);
  const target = text(row?.label) || text(row?.name) || text(fields?.name) || text(body?.label) || text(fields?.id) || text(row?.deleted);
  return target ? `${phrase} ${target}` : phrase;
}

export function ManageToolsToolUI({ msg, generating = false }: ToolUIProps) {
  const output = parseMaybe(msg.toolOutput);
  const outputRecord = asRecord(output);
  const failed = Boolean(msg.toolError) || outputRecord?.ok === false;
  const running = isToolRunning(msg, generating);
  const aside = manageToolsAside(msg.toolInput, output, running ? "run" : failed ? "fail" : "done");
  const label = msg.toolLabel || "Manage Tools";
  const hasInput = msg.toolInput != null && msg.toolInput !== "";
  const hasOutput = msg.toolOutput != null;
  const expandable = hasInput || hasOutput || failed || running;
  const [open, setOpen] = useState(false);

  const header = (
    <>
      <Icon name="code" size={13} className="shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 items-center gap-1">
        <Shimmer active={running} className={cn("min-w-0 truncate text-left font-normal", !running && "text-muted-foreground")}>
          {label}
          {aside ? <span className="text-tertiary-foreground"> {aside}</span> : null}
        </Shimmer>
        <ToolUiTrailing failed={failed && !running} chevron={expandable} chevronClassName={cn("text-muted-foreground group-hover:opacity-100", open && "opacity-100 rotate-90")} />
      </span>
    </>
  );

  const errorText = typeof msg.toolError === "string" ? msg.toolError : text(outputRecord?.error) || "Tool execution failed";

  return (
    <div className="nonla-chat-tool mt-1">
      <div className="px-4">
        {expandable ? (
          <button type="button" onClick={() => setOpen((value) => !value)} className="group flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-1 text-sm leading-5.5 outline-none">
            {header}
          </button>
        ) : (
          <div className="flex w-full items-center gap-2 py-1 text-sm leading-5.5">{header}</div>
        )}
        {open && expandable ? (
          <div className={cn("mt-1.5 mb-1 overflow-hidden rounded-lg border font-mono text-sm", failed ? "border-destructive/35 bg-destructive/6" : "border-border bg-card")}>
            {hasInput ? <pre className="m-0 max-h-27.5 overflow-y-auto px-3 py-1.5 break-all whitespace-pre-wrap font-normal leading-[1.65] text-muted-foreground">{prettyJson(msg.toolInput)}</pre> : null}
            {running ? (
              <div className={cn("px-3 py-1.5 text-muted-foreground", hasInput && "border-t border-border")}>
                <Shimmer className="italic">Running…</Shimmer>
              </div>
            ) : null}
            {!running && (hasOutput || failed) ? (
              <pre className={cn("m-0 max-h-75 overflow-y-auto px-3 py-1.5 break-all whitespace-pre-wrap font-normal leading-[1.65]", hasInput && "border-t", failed ? "border-destructive/35 text-destructive" : "border-border text-muted-foreground")}>{hasOutput ? prettyJson(msg.toolOutput) : errorText}</pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
