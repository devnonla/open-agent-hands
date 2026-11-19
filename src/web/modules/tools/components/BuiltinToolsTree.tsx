import { cn } from "src/common/lib/cn";
import type { AgentTool } from "src/common/types";
import { FeatureIcon, type FeatureIconName } from "src/components/FeatureIcon";

const TREE_STROKE = "text-muted-foreground/40";
const TREE_LINE_FILL = "bg-muted-foreground/40";

const GROUPS: { id: string; title: string; icon: FeatureIconName }[] = [
  { id: "general", title: "General", icon: "tools" },
  { id: "agents", title: "Agents", icon: "agents" },
  { id: "tools", title: "Tools", icon: "tools" },
  { id: "skills", title: "Skills", icon: "skills" },
  { id: "sites", title: "Sites", icon: "sites" },
  { id: "jobs", title: "Jobs", icon: "jobs" },
  { id: "mcp", title: "MCP", icon: "mcp" },
  { id: "datatables", title: "Datatables", icon: "datatables" },
  { id: "kv", title: "KV Store", icon: "kv-store" },
  { id: "secrets", title: "Secrets", icon: "secrets" },
];

function groupId(name: string): string {
  if (name.startsWith("nonla_manage_datatable")) return "datatables";
  if (name.includes("agent")) return "agents";
  if (name.includes("tool")) return "tools";
  if (name.includes("skill")) return "skills";
  if (name.includes("site")) return "sites";
  if (name.includes("job")) return "jobs";
  if (name.includes("mcp")) return "mcp";
  if (name.includes("kv")) return "kv";
  if (name.includes("secret")) return "secrets";
  return "general";
}

function TreeGuide({ isLast }: { isLast: boolean }) {
  return (
    <div className={cn("pointer-events-none relative w-8 shrink-0 self-stretch", TREE_STROKE)} aria-hidden>
      {isLast ? (
        <>
          <div className={cn("absolute left-1/2 top-0 w-px -translate-x-1/2", TREE_LINE_FILL, "h-[calc(50%-7px)]")} />
          <svg className="absolute left-[calc(50%-0.5px)] top-[calc(50%-7px)] overflow-visible" width="17" height="8" viewBox="0 0 17 8" fill="none">
            <path d="M0.5 0 V1.5 Q0.5 7.5 8 7.5 H17" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </>
      ) : (
        <>
          <div className={cn("absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2", TREE_LINE_FILL)} />
          <div className={cn("absolute left-1/2 top-1/2 h-px w-4 -translate-y-1/2", TREE_LINE_FILL)} />
        </>
      )}
    </div>
  );
}

export function BuiltinToolsTree({ tools }: { tools: AgentTool[] }) {
  const byGroup = new Map<string, AgentTool[]>();
  for (const tool of tools) {
    const id = groupId(tool.name);
    const list = byGroup.get(id) ?? [];
    list.push(tool);
    byGroup.set(id, list);
  }

  const groups = GROUPS.map((group) => ({ ...group, tools: byGroup.get(group.id) ?? [] })).filter((group) => group.tools.length > 0);

  if (groups.length === 0) {
    return <p className="m-0 px-2 py-6 text-sm text-muted-foreground">No built-in tools</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2.5 py-1.5">
            <div className="flex w-8 shrink-0 items-center justify-center">
              <FeatureIcon name={group.icon} size={18} variant="sticker" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">{group.title}</span>
          </div>
          <div className="relative">
            <div className={cn("absolute left-4 top-0 h-2.5 w-px -translate-x-1/2", TREE_LINE_FILL)} aria-hidden />
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pt-1">
              {group.tools.map((tool, index) => (
                <li key={tool.id} className="relative flex min-h-10 items-stretch">
                  <TreeGuide isLast={index === group.tools.length - 1} />
                  <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2">
                    <span className="w-60 shrink-0 truncate font-mono text-[13px] leading-snug text-foreground">{tool.label}</span>
                    {tool.description ? <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-muted-foreground">{tool.description}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
