import { cn } from "src/common/lib/cn";
import type { McpServer } from "src/common/types";
import RenderIf from "src/components/RenderIf";
import { getServerStatus, toolCountOf } from "src/modules/mcp-servers/components/McpServerListItem";
import { STATUS_META, hostOf } from "../common/mcpStatus";

/** Compact selectable row in the server list. Shows search-match count when filtering. */
export function McpServerRow({
  server,
  selected,
  matchCount,
  onSelect,
}: {
  server: McpServer;
  selected: boolean;
  /** Number of tools matching the active search, or null when not searching. */
  matchCount: number | null;
  onSelect: () => void;
}) {
  const tone = getServerStatus(server);
  const status = STATUS_META[tone];
  const total = toolCountOf(server);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn("flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors", selected ? "border-border bg-card shadow-xs" : "border-transparent bg-transparent hover:bg-muted/60", !server.isActive && !selected && "opacity-70")}
    >
      <span className={cn("size-2 shrink-0 rounded-full", status.dot)} aria-hidden title={status.label} />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm font-medium text-foreground">{server.name}</p>
        <p className="m-0 truncate font-mono text-[11px] text-muted-foreground">{hostOf(server.url)}</p>
      </div>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums", matchCount !== null ? "bg-brand/12 text-brand-700" : "bg-muted text-muted-foreground")}>{matchCount !== null ? `${matchCount}/${total}` : total}</span>
      <RenderIf condition={tone === "error"}>
        <span className="sr-only">Sync failed</span>
      </RenderIf>
    </button>
  );
}
