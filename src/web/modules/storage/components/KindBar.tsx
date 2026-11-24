import type { StorageKind } from "src/common/types";
import { formatBytes } from "../common/format";
import { STORAGE_KINDS } from "../common/kinds";

const LEGEND_LIMIT = 3;

function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const value = (part / whole) * 100;
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

export function KindBar({ bytesByKind, totalBytes }: { bytesByKind?: Record<StorageKind, number>; totalBytes: number }) {
  const parts = STORAGE_KINDS.map((kind) => ({ ...kind, bytes: bytesByKind?.[kind.key] ?? 0 }))
    .filter((part) => part.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
  const label = parts.length ? parts.map((part) => `${part.label} ${formatBytes(part.bytes)} (${percent(part.bytes, totalBytes)})`).join(", ") : "Empty";
  const shown = parts.slice(0, LEGEND_LIMIT);
  const hidden = parts.slice(LEGEND_LIMIT);

  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={label} className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
        {parts.map((part) => (
          <span key={part.key} title={`${part.label} · ${formatBytes(part.bytes)} · ${percent(part.bytes, totalBytes)}`} className="h-full min-w-1 first:rounded-l-full last:rounded-r-full" style={{ flexGrow: part.bytes, flexBasis: 0, background: part.color }} />
        ))}
      </div>
      <ul className="m-0 flex h-4 list-none items-center gap-x-3 overflow-hidden p-0 text-xs">
        {shown.length ? (
          shown.map((part) => (
            <li key={part.key} title={formatBytes(part.bytes)} className="flex shrink-0 items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: part.color }} />
              <span className="text-muted-foreground">{part.label}</span>
              <span className="text-foreground tabular-nums">{percent(part.bytes, totalBytes)}</span>
            </li>
          ))
        ) : (
          <li className="text-muted-foreground">Empty</li>
        )}
        {hidden.length ? (
          <li title={hidden.map((part) => `${part.label} ${percent(part.bytes, totalBytes)}`).join(", ")} className="shrink-0 text-muted-foreground">
            +{hidden.length}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
