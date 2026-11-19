import type { DatatableColumn } from "src/common/types";

/** Integer or float. `1.5` and a comma decimal `1,5` both parse. */
export function parseNumberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let s = value.trim().replace(/\s/g, "");
  if (!s) return null;
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) {
    s = s.replace(",", ".");
  }
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function cellValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return String(a) === String(b);
}

export function valueToDraft(col: DatatableColumn, value: unknown): string {
  if (value == null || value === "") return "";
  if (col.type === "json") {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  return String(value);
}

export function draftToValue(col: DatatableColumn, draft: string): unknown {
  const trimmed = draft.trim();
  switch (col.type) {
    case "number": {
      if (trimmed === "") return null;
      const n = parseNumberValue(trimmed);
      return n == null ? draft : n;
    }
    case "json": {
      if (trimmed === "") return null;
      try {
        return JSON.parse(draft);
      } catch {
        return draft;
      }
    }
    case "datetime":
      return trimmed === "" ? null : draft;
    default:
      return draft === "" ? null : draft;
  }
}
