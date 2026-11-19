import { Icon, type IconName, Popover } from "devnonla-ui";
import { useState } from "react";
import { apiClient } from "src/common/api";
import { cn } from "src/common/lib/cn";
import { FeatureIcon, type FeatureIconName } from "src/components/FeatureIcon";
import { ConfigTreeGroup, ConfigTreeRow } from "src/modules/agents/[id]/components/config/ConfigTree";

interface ToolUse {
  id: string;
  label: string;
}

interface ToolGroup {
  id: string;
  name: string;
  kind?: "builtin" | "subagent";
  tools: { id: string; label: string; uses?: ToolUse[] }[];
}

function groupIcon(groupId: string): IconName {
  if (groupId === "tools" || groupId === "jobs" || groupId === "skills") return "code";
  if (groupId === "sites" || groupId === "mcp") return "globe";
  if (groupId === "datatables" || groupId === "kv" || groupId === "secrets") return "document";
  return "stars";
}

function rowIcon(toolId: string): IconName {
  if (toolId.includes("datatable") || toolId === "kv_store") return "document";
  if (toolId === "web_fetch" || toolId.includes("mcp") || toolId.includes("site")) return "globe";
  return "code";
}

function subAgentIcon(toolId: string): FeatureIconName {
  if (toolId.includes("prompt")) return "agents";
  if (toolId.includes("skill")) return "skills";
  if (toolId.includes("site")) return "sites";
  if (toolId.includes("job")) return "jobs";
  if (toolId.includes("datatable")) return "datatables";
  if (toolId.includes("tool")) return "tools";
  return "agents";
}

export function NonlaBotToolsButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [groups, setGroups] = useState<ToolGroup[] | null>(null);

  const load = () => {
    if (groups) return;
    setLoading(true);
    setFailed(false);
    apiClient
      .get<ToolGroup[]>("/api/nonla-bot/tools")
      .then((rows) => {
        setGroups(rows);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  const toolGroups = (groups ?? []).filter((group) => group.kind !== "subagent" && group.tools.length > 0);
  const subAgents = (groups ?? []).find((group) => group.kind === "subagent")?.tools ?? [];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
      trigger="click"
      placement="topLeft"
      arrow
      styles={{ root: { width: 360, maxWidth: 360, padding: 0 }, container: { width: 360, maxWidth: 360, padding: 0 } }}
      content={
        <div className="max-h-112 w-full overflow-y-auto p-2.5" onWheel={(e) => e.stopPropagation()}>
          {loading ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground">Loading…</div>
          ) : failed ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground">Could not load</div>
          ) : toolGroups.length === 0 && subAgents.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-muted-foreground">No tools</div>
          ) : (
            <div className="flex flex-col gap-4">
              {toolGroups.map((group) => (
                <ConfigTreeGroup key={group.id} icon={groupIcon(group.id)} title={group.name}>
                  {group.tools.map((tool, index) => {
                    const uses = tool.uses ?? [];
                    const lastTool = index === group.tools.length - 1;
                    return (
                      <div key={tool.id}>
                        <ConfigTreeRow icon={rowIcon(tool.id)} label={tool.label} isLast={lastTool && uses.length === 0} />
                        {uses.length > 0 ? (
                          <div className="pl-4">
                            {uses.map((use, useIndex) => (
                              <ConfigTreeRow key={use.id} icon={rowIcon(use.id)} label={use.label} isLast={useIndex === uses.length - 1} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </ConfigTreeGroup>
              ))}
              {subAgents.length > 0 ? (
                <div className="flex flex-col gap-0.5 border-t border-border pt-3">
                  <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Sub agents</div>
                  {subAgents.map((tool) => {
                    const uses = tool.uses ?? [];
                    return (
                      <div key={tool.id} className="flex flex-col">
                        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                          <FeatureIcon name={subAgentIcon(tool.id)} size={18} variant="sticker" />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{tool.label}</span>
                        </div>
                        {uses.length > 0 ? (
                          <div className="pl-1">
                            {uses.map((use, index) => (
                              <ConfigTreeRow key={use.id} icon={rowIcon(use.id)} label={use.label} isLast={index === uses.length - 1} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}
        </div>
      }
    >
      <button type="button" className={cn("flex h-5.5 cursor-pointer items-center gap-1 rounded-full px-1.5 outline-none transition-all duration-150", open ? "bg-border/70 text-foreground" : "text-foreground/90 hover:bg-border/60")} title="Tools" aria-label="Tools" aria-expanded={open}>
        <Icon name="code" size={14} />
        <span className="text-[12px] leading-none">Tools</span>
      </button>
    </Popover>
  );
}
