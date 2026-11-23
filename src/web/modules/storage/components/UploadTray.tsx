import { Button, Icon } from "devnonla-ui";
import { Check } from "lucide-react";
import { formatBytes } from "../common/format";

export type UploadItem = { id: string; name: string; size: number; loaded: number; status: "uploading" | "done" | "error"; error?: string };

export function UploadTray({ items, onClear }: { items: UploadItem[]; onClear: () => void }) {
  if (items.length === 0) return null;
  const active = items.filter((item) => item.status === "uploading").length;
  const failed = items.filter((item) => item.status === "error").length;
  const title = active > 0 ? `Uploading ${active} ${active === 1 ? "file" : "files"}` : failed > 0 ? `${failed} ${failed === 1 ? "upload" : "uploads"} failed` : `Uploaded ${items.length} ${items.length === 1 ? "file" : "files"}`;

  return (
    <div role="status" aria-live="polite" className="fixed right-6 bottom-6 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {active === 0 ? <Button type="icon" size="small" aria-label="Close" icon={<Icon name="close" size={14} />} onClick={onClear} /> : null}
      </div>
      <ul className="m-0 max-h-64 list-none overflow-y-auto p-0">
        {items.map((item) => {
          const percent = item.size > 0 ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : item.status === "done" ? 100 : 0;
          return (
            <li key={item.id} className="flex flex-col gap-1.5 px-4 py-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-foreground">{item.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {item.status === "done" ? <Check size={14} className="text-green-600" /> : item.status === "error" ? <span className="text-destructive">Failed</span> : `${percent}%`}
                </span>
              </div>
              {item.status === "uploading" ? (
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
                </div>
              ) : null}
              {item.status === "error" ? <span className="text-xs text-destructive">{item.error}</span> : null}
              {item.status === "uploading" ? <span className="text-2xs text-muted-foreground tabular-nums">{`${formatBytes(item.loaded)} of ${formatBytes(item.size)}`}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
