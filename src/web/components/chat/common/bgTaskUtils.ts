import { formatBgElapsed, formatToolName, parseBgTaskRef } from "devnonla-ui/chat";
import type { BgTaskView } from "../hooks/useBgTask";

export { parseBgTaskRef };

export const DEFAULT_AWAIT_MS = 60_000;

export function timeMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

export function formatDuration(ms: number): string {
  return formatBgElapsed(0, Math.max(0, ms));
}

export function taskTitle(task: Pick<BgTaskView, "toolName" | "label"> | null | undefined, fallback = "Task"): string {
  const name = task?.toolName?.trim();
  if (!name) return fallback;
  const base = name.includes(" ") ? name : formatToolName(name);
  if (task?.label && base === "Agent Task") return `${base} · ${task.label}`;
  return base;
}

function clip(text: string, max = 90): string {
  const line =
    text
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function latestLine(task: BgTaskView | null | undefined): string | null {
  if (!task) return null;
  const last = task.activity?.at(-1);
  if (last?.kind === "tool" && last.output == null && last.name) return `Running ${formatToolName(last.name)}`;
  if (last?.kind === "text" && last.text?.trim()) return clip(last.text);
  const tail = clip(task.console ?? "");
  return tail || null;
}

export function statusLabel(status: BgTaskView["status"] | undefined): string {
  if (status === "completed") return "Finished";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "expired") return "Finished earlier";
  return "Running";
}

export function parseObject(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
