import type { StorageKind } from "src/common/types";

export const STORAGE_KINDS: { key: StorageKind; label: string; color: string }[] = [
  { key: "images", label: "Images", color: "var(--viz-1)" },
  { key: "documents", label: "Documents", color: "var(--viz-2)" },
  { key: "data", label: "Data", color: "var(--viz-3)" },
  { key: "media", label: "Media", color: "var(--viz-4)" },
  { key: "other", label: "Other", color: "var(--viz-other)" },
];
