import type { StorageKind } from "src/common/types";
import { formatBytes } from "../common/format";
import { STORAGE_KINDS } from "../common/kinds";

const SIZE = 56;
const R = SIZE / 2;

function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const value = (part / whole) * 100;
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

function point(angle: number): [number, number] {
  return [R + R * Math.sin(angle), R - R * Math.cos(angle)];
}

function slicePath(start: number, end: number): string {
  const [x1, y1] = point(start);
  const [x2, y2] = point(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${R} ${R} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
}

export function KindPie({ bytesByKind, totalBytes }: { bytesByKind?: Record<StorageKind, number>; totalBytes: number }) {
  const parts = STORAGE_KINDS.map((kind) => ({ ...kind, bytes: bytesByKind?.[kind.key] ?? 0 })).filter((part) => part.bytes > 0);
  const label = parts.length ? parts.map((part) => `${part.label} ${formatBytes(part.bytes)} (${percent(part.bytes, totalBytes)})`).join(", ") : "Empty";

  if (parts.length === 0) {
    return (
      <svg role="img" aria-label={label} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0">
        <circle cx={R} cy={R} r={R} fill="var(--muted)" />
      </svg>
    );
  }

  let angle = 0;
  return (
    <svg role="img" aria-label={label} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0">
      {parts.map((part) => {
        const title = `${part.label} · ${formatBytes(part.bytes)} · ${percent(part.bytes, totalBytes)}`;
        if (parts.length === 1) {
          return (
            <circle key={part.key} cx={R} cy={R} r={R} fill={part.color}>
              <title>{title}</title>
            </circle>
          );
        }
        const start = angle;
        angle += (part.bytes / totalBytes) * Math.PI * 2;
        return (
          <path key={part.key} d={slicePath(start, angle)} fill={part.color} stroke="var(--card)" strokeWidth={2} strokeLinejoin="round">
            <title>{title}</title>
          </path>
        );
      })}
    </svg>
  );
}
