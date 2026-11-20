import { Icon, Switch } from "devnonla-ui";
import { Plug } from "lucide-react";
import { cn } from "src/common/lib/cn";
import type { MyMcpServer } from "src/common/types";
import { relativeTime } from "src/common/utils/date";
import { FeatureIcon } from "src/components/FeatureIcon";
import RenderIf from "src/components/RenderIf";

const MAX_VISIBLE_TOOLS = 4;

export function MyMcpServerCard({
  server,
  toggling,
  onOpen,
  onConnect,
  onToggleActive,
}: {
  server: MyMcpServer;
  toggling: boolean;
  onOpen: () => void;
  onConnect: () => void;
  onToggleActive: (checked: boolean) => void;
}) {
  const tools = server.tools ?? [];
  const visibleTools = tools.slice(0, MAX_VISIBLE_TOOLS);
  const hiddenCount = tools.length - visibleTools.length;
  const lastUsed = server.lastUsedAt ? `Used ${relativeTime(server.lastUsedAt)}` : "Never used";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn("group relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-border-subtle bg-card p-5 text-left", "cursor-pointer transition-[border-color,background-color] duration-200 hover:border-border hover:bg-secondary", !server.isActive && "bg-card/60")}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted", !server.isActive && "grayscale")}>
          <FeatureIcon name="mcp" size={24} variant="sticker" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={cn("m-0 truncate text-base font-semibold", server.isActive ? "text-foreground" : "text-muted-foreground")}>{server.name}</h2>
          <RenderIf condition={!!server.description?.trim()}>
            <p className="m-0 mt-0.5 line-clamp-2 text-[13px] text-tertiary-foreground">{server.description}</p>
          </RenderIf>
        </div>
        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <span className={cn("text-[11px] font-medium", server.isActive ? "text-foreground" : "text-muted-foreground")}>{server.isActive ? "On" : "Off"}</span>
          <Switch size="small" checked={server.isActive} disabled={toggling} onChange={onToggleActive} aria-label={server.isActive ? "Turn off" : "Turn on"} />
        </div>
      </div>

      <RenderIf condition={tools.length > 0} fallback={<div className="rounded-lg border border-dashed border-border px-3 py-3 text-[12px] text-amber-500">No tools exposed yet. Open this server to pick tools.</div>}>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {visibleTools.map((tool) => (
            <li key={tool.id} className="flex min-w-0 items-baseline gap-2 rounded-lg bg-muted/60 px-3 py-1.5">
              <span className="shrink-0 text-[12px] font-medium text-foreground">{tool.label || tool.name}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-tertiary-foreground">{tool.description}</span>
            </li>
          ))}
          <RenderIf condition={hiddenCount > 0}>
            <li className="px-3 py-0.5 text-[11px] text-muted-foreground">+{hiddenCount} more</li>
          </RenderIf>
        </ul>
      </RenderIf>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Icon name="stars" size={12} />
          {tools.length} tool{tools.length === 1 ? "" : "s"}
        </span>
        <span aria-hidden>·</span>
        <span>{lastUsed}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onConnect();
          }}
          className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted focus-visible:outline-none"
        >
          <Plug size={12} />
          Connect
        </button>
      </div>
    </div>
  );
}
