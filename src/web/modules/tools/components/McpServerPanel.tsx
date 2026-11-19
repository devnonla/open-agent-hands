import { Button, Dropdown, Switch, Tooltip } from "devnonla-ui";
import type { MenuProps } from "devnonla-ui";
import { Ellipsis, RefreshCw, Settings2, Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "src/common/lib/cn";
import type { McpServer, McpServerTool } from "src/common/types";
import { relativeTime } from "src/common/utils/date";
import { FeatureIcon } from "src/components/FeatureIcon";
import RenderIf from "src/components/RenderIf";
import { getServerStatus, toolCountOf } from "src/modules/mcp-servers/components/McpServerListItem";
import { STATUS_META, hostOf, matchingTools } from "../common/mcpStatus";

const PAGE_SIZE = 30;

function paramCountOf(tool: McpServerTool): number {
  const props = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  return props ? Object.keys(props).length : 0;
}

function ToolRow({ tool }: { tool: McpServerTool }) {
  const params = paramCountOf(tool);
  return (
    <li className="flex flex-col gap-0.5 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-[13px] font-medium text-foreground" title={tool.name}>
          {tool.name}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{params > 0 ? `${params} param${params === 1 ? "" : "s"}` : "No params"}</span>
      </div>
      <p className="m-0 line-clamp-1 text-xs text-muted-foreground" title={tool.description || undefined}>
        {tool.description || "No description"}
      </p>
    </li>
  );
}

/** Detail panel for the selected server: status, actions, and a paged tool list. */
export function McpServerPanel({
  server,
  query,
  toggling,
  syncing,
  onToggleActive,
  onSync,
  onManage,
  onDisconnect,
}: {
  server: McpServer;
  query: string;
  toggling: boolean;
  syncing: boolean;
  onToggleActive: (checked: boolean) => void;
  onSync: () => void;
  onManage: () => void;
  onDisconnect: () => void;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [menuOpen, setMenuOpen] = useState(false);

  const tone = getServerStatus(server);
  const status = STATUS_META[tone];
  const total = toolCountOf(server);
  const q = query.trim().toLowerCase();
  const tools = useMemo(() => matchingTools(server, q), [server, q]);
  const shown = tools.slice(0, limit);
  const remaining = tools.length - shown.length;

  const menuItems: MenuProps["items"] = [
    { key: "manage", label: "Manage settings", icon: <Settings2 size={14} />, onClick: onManage },
    { key: "disconnect", label: "Disconnect", icon: <Unplug size={14} />, danger: true, onClick: onDisconnect },
  ];

  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-xs", tone === "error" ? "border-destructive/30" : "border-border")}>
      <header className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted ring-1 ring-border-subtle", !server.isActive && "opacity-60")}>
          <FeatureIcon name="mcp" size={24} variant="sticker" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="m-0 truncate text-[15px] font-semibold leading-5 text-foreground">{server.name}</h2>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none", status.pill)}>{status.label}</span>
          </div>
          <p className="m-0 mt-0.5 truncate font-mono text-xs text-muted-foreground" title={server.url}>
            {hostOf(server.url)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip title={server.isActive ? "Disable server" : "Enable server"}>
            <span className="mr-1 inline-flex">
              <Switch size="small" className="data-[state=checked]:bg-success!" checked={server.isActive} disabled={toggling} onChange={onToggleActive} aria-label={server.isActive ? "Disable" : "Enable"} />
            </span>
          </Tooltip>
          <Tooltip title="Re-discover tools">
            <Button type="text" size="small" loading={syncing} icon={<RefreshCw size={14} />} onClick={onSync} aria-label={`Sync ${server.name}`}>
              Sync
            </Button>
          </Tooltip>
          <Dropdown menu={{ items: menuItems, style: { minWidth: 170 } }} trigger={["click"]} placement="bottomRight" open={menuOpen} onOpenChange={setMenuOpen}>
            <Button type="text" size="small" aria-label={`${server.name} actions`} className={cn("text-muted-foreground hover:text-foreground", menuOpen && "bg-muted text-foreground")} icon={<Ellipsis size={16} />} />
          </Dropdown>
        </div>
      </header>

      <RenderIf condition={tone === "error" && !!server.lastSyncError}>
        <div className="mx-5 mb-3 flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
          <p className="m-0 min-w-0 wrap-break-word text-xs text-destructive">{server.lastSyncError}</p>
          <button type="button" onClick={onManage} className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-destructive underline-offset-2 hover:underline">
            Fix settings
          </button>
        </div>
      </RenderIf>

      <div className="flex items-center justify-between gap-2 border-t border-border-subtle bg-muted/30 px-5 py-2.5">
        <p className="m-0 text-xs font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{q ? `${tools.length} of ${total}` : total}</span> tool{total === 1 ? "" : "s"}
          <RenderIf condition={!!server.lastSyncedAt}>
            <span> · synced {server.lastSyncedAt ? relativeTime(server.lastSyncedAt) : ""}</span>
          </RenderIf>
        </p>
      </div>

      <RenderIf
        condition={shown.length > 0}
        fallback={<p className="m-0 border-t border-border-subtle px-5 py-8 text-center text-[13px] text-muted-foreground">{q ? "No tools match your search." : server.lastSyncError ? "No tools loaded — fix the connection, then sync." : "No tools yet — press Sync to pull the catalog."}</p>}
      >
        <ul className="m-0 max-h-[60vh] list-none divide-y divide-border-subtle overflow-y-auto border-t border-border-subtle p-0">
          {shown.map((tool) => (
            <ToolRow key={tool.name} tool={tool} />
          ))}
          <RenderIf condition={remaining > 0}>
            <li className="px-4 py-2.5 text-center">
              <Button type="text" size="small" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                Show {Math.min(remaining, PAGE_SIZE)} more ({remaining} left)
              </Button>
            </li>
          </RenderIf>
        </ul>
      </RenderIf>
    </section>
  );
}
