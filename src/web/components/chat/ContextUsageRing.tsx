import { Popover } from "devnonla-ui";
import { useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import { formatTokens } from "src/common/utils/formatTokens";

export type ContextCategories = {
  system?: number;
  tools?: number;
  skills?: number;
  summary?: number;
  conversation?: number;
};

export type ContextUsage = {
  used: number;
  max: number;
  percent: number;
  source: string;
  categories?: ContextCategories;
  compacted?: boolean;
};

const CATEGORY_ROWS: { key: keyof ContextCategories; label: string; color: string }[] = [
  { key: "system", label: "System prompt", color: "#8a847c" },
  { key: "tools", label: "Tool definitions", color: "#8b6bb8" },
  { key: "skills", label: "Skills", color: "#c4a035" },
  { key: "summary", label: "Summarized conversation", color: "#d46a5c" },
  { key: "conversation", label: "Conversation", color: "var(--brand)" },
];

const RING_SIZE = 14;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function ringColor(percent: number): string {
  if (percent >= 85) return "var(--destructive)";
  if (percent >= 60) return "var(--warn)";
  return "var(--brand)";
}

function Ring({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.max(clamped > 0 ? 1.5 : 0, (clamped / 100) * RING_LENGTH);
  return (
    <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="-rotate-90" aria-hidden>
      <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="currentColor" strokeWidth={RING_STROKE} className="opacity-15" />
      <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke={ringColor(clamped)} strokeWidth={RING_STROKE} strokeLinecap="round" strokeDasharray={`${filled} ${RING_LENGTH}`} className="brightness-110" />
    </svg>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 shrink-0 rounded-[3px]" style={{ background: color }} />
      <span className="flex-1 text-foreground">{label}</span>
      <span className="tabular-nums text-muted-foreground">{formatTokens(value)}</span>
    </div>
  );
}

function categoryValue(categories: ContextCategories | undefined, key: keyof ContextCategories, usage: ContextUsage): number {
  const value = categories?.[key];
  if (typeof value === "number") return value;
  if (key === "conversation") return Math.max(0, usage.used - (categories?.summary ?? 0));
  if (key === "summary") return 0;
  return 0;
}

function UsageCard({ usage }: { usage: ContextUsage }) {
  const total = Math.max(1, usage.max);
  const rows = CATEGORY_ROWS.map((row) => ({ ...row, value: categoryValue(usage.categories, row.key, usage) })).filter((row) => row.value > 0);

  return (
    <div className="w-60 text-xs leading-4 font-normal">
      <div className="text-muted-foreground">Context Usage</div>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <span className="text-foreground">{usage.percent}% full</span>
        <span className="tabular-nums text-muted-foreground">
          ~{formatTokens(usage.used)} / {formatTokens(usage.max)} tokens
        </span>
      </div>
      <div className="mt-2.5 flex h-1 overflow-hidden rounded-full bg-border">
        {rows.map((row) => (
          <div key={row.key} className="h-full" style={{ width: `${(row.value / total) * 100}%`, background: row.color }} />
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <Legend key={row.key} color={row.color} label={row.label} value={row.value} />
        ))}
      </div>
    </div>
  );
}

export function ContextUsageRing({ conversationId, refreshKey = 0 }: { conversationId: string | null; refreshKey?: number }) {
  const [usage, setUsage] = useState<ContextUsage | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    apiClient
      .get<ContextUsage>(`/api/conversations/${conversationId}/context`)
      .then((row) => {
        if (!cancelled) setUsage(row);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshKey]);

  useEffect(() => {
    const onUsage = (event: Event) => {
      const detail = (event as CustomEvent<ContextUsage>).detail;
      if (!detail || typeof detail.percent !== "number") return;
      setUsage((prev) => {
        if (detail.categories || !prev?.categories) return detail;
        const categories = { ...prev.categories };
        const reserved = (categories.system ?? 0) + (categories.tools ?? 0) + (categories.skills ?? 0) + (categories.summary ?? 0);
        categories.conversation = Math.max(0, detail.used - reserved);
        return { ...detail, categories, compacted: detail.compacted ?? prev.compacted };
      });
    };
    window.addEventListener("nonla-context-usage", onUsage);
    return () => window.removeEventListener("nonla-context-usage", onUsage);
  }, []);

  if (!conversationId || !usage) return null;

  return (
    <Popover trigger="click" placement="top" arrow content={<UsageCard usage={usage} />}>
      <button type="button" aria-label={`Context ${usage.percent}% full`} className="absolute right-9.5 bottom-2 z-10 flex size-5.5 cursor-pointer items-center justify-center rounded-full bg-transparent text-foreground outline-none">
        <Ring percent={usage.percent} />
      </button>
    </Popover>
  );
}
