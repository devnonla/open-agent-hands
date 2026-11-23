import { Icon } from "devnonla-ui";
import type { ReactNode } from "react";
import { cn } from "src/common/lib/cn";
import type { DatatableColumn, DatatableColumnType } from "src/common/types";
import { formatDateTimeInTz } from "src/common/utils/date";
import { SelectPill } from "../components/SelectPill";

export { DATETIME_DISPLAY_FORMAT, DATETIME_PICKER_FORMAT } from "src/common/utils/date";

/** Format a stored ISO instant for a datetime cell in the app timezone. */
export function formatDatetimeCell(value: unknown, timeZone = "UTC"): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") return String(value);
  const formatted = formatDateTimeInTz(value, timeZone);
  return formatted || String(value);
}

export function propertyTypeIcon(type: DatatableColumnType): ReactNode {
  switch (type) {
    case "number":
      return <Icon name="code" size={16} />;
    case "boolean":
      return <Icon name="check" size={16} />;
    case "datetime":
      return <Icon name="clock" size={16} />;
    case "select":
      return <Icon name="document" size={16} />;
    case "json":
      return <Icon name="code" size={16} />;
    default:
      return <Icon name="pen" size={16} />;
  }
}

export function propertyTypeLabel(type: DatatableColumnType): string {
  switch (type) {
    case "number":
      return "Number";
    case "boolean":
      return "Checkbox";
    case "datetime":
      return "Date";
    case "select":
      return "Select";
    case "json":
      return "JSON";
    default:
      return "Text";
  }
}

/** Default column width in px — shared by header/body grids; overrides enable resize. */
export const COL_WIDTH_MIN = 64;
export const COL_WIDTH_MAX = 720;

const HEADER_FONT = '500 12px "Inter Variable", sans-serif';
const CELL_FONT = '400 14px "Inter Variable", sans-serif';

/** Header chrome: px-2.5 + icon + gap + safety — name must never be clipped by fit. */
const HEADER_CHROME_PX = 20 + 14 + 6 + 16;

export function clampColWidth(px: number): number {
  return Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, Math.round(px)));
}

let measureCanvas: HTMLCanvasElement | null = null;

function measureTextPx(text: string, font: string): number {
  if (!text) return 0;
  if (typeof document === "undefined") return text.length * 8.5;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * 8.5;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Width needed to show the full property name in the header (icon + label). */
export function headerFitWidthPx(col: Pick<DatatableColumn, "type" | "name">): number {
  const label = col.name;
  const measured = measureTextPx(label, HEADER_FONT);
  const estimated = label.length * 8.5;
  return Math.ceil(Math.max(measured, estimated) + HEADER_CHROME_PX);
}

export function defaultColumnWidthPx(col: Pick<DatatableColumn, "type" | "name">): number {
  const headerPx = headerFitWidthPx(col);
  switch (col.type) {
    case "number":
      return clampColWidth(Math.max(100, headerPx));
    case "boolean":
      return clampColWidth(Math.max(72, headerPx));
    case "datetime":
      // "23 Jul 2026 17:30" ≈ 17 chars
      return clampColWidth(Math.max(17 * 8.5 + 16, headerPx));
    case "select":
      return clampColWidth(Math.max(120, headerPx));
    case "json":
      return clampColWidth(Math.max(220, headerPx));
    default:
      return clampColWidth(Math.max(200, headerPx));
  }
}

export function columnTrackSize(col: Pick<DatatableColumn, "type" | "name">, widthPx?: number): string {
  return `${widthPx ?? defaultColumnWidthPx(col)}px`;
}

export function cellDisplayText(col: DatatableColumn, value: unknown, timeZone = "UTC"): string {
  if (value === null || value === undefined || value === "") return "";
  if (col.type === "boolean") return "";
  if (col.type === "datetime") return formatDatetimeCell(value, timeZone);
  if (col.type === "json") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Auto-fit: max(full header name, longest loaded cell). */
export function fitColumnWidthPx(col: DatatableColumn, rows: Array<{ data?: Record<string, unknown> }>, timeZone = "UTC"): number {
  let maxPx = headerFitWidthPx(col);

  if (col.type !== "boolean") {
    for (const row of rows) {
      const text = cellDisplayText(col, row.data?.[col.name], timeZone);
      if (!text) continue;
      const measured = measureTextPx(text, CELL_FONT);
      const estimated = text.length * 8.2;
      maxPx = Math.max(maxPx, Math.ceil(Math.max(measured, estimated) + 20));
    }
  }

  return clampColWidth(maxPx);
}

export function formatCellValue(col: DatatableColumn, value: unknown, timeZone = "UTC"): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="text-quaternary-foreground">&nbsp;</span>;
  }
  if (col.type === "boolean") {
    return <span className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-xs border text-2xs leading-none", value ? "border-brand/40 bg-brand/20 text-brand-700" : "border-border text-transparent")}>{value ? "✓" : null}</span>;
  }
  if (col.type === "select" && typeof value === "string") {
    return <SelectPill value={value} />;
  }
  if (col.type === "json") {
    return <span className="truncate text-foreground">{JSON.stringify(value)}</span>;
  }
  if (col.type === "number") {
    return <span className="block w-full text-right tabular-nums text-foreground">{String(value)}</span>;
  }
  if (col.type === "datetime") {
    return <span className="whitespace-nowrap text-foreground">{formatDatetimeCell(value, timeZone)}</span>;
  }
  return <span className="truncate text-foreground">{String(value)}</span>;
}
