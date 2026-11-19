import { Icon, type IconName, Popover } from "devnonla-ui";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "src/common/api";
import { cn } from "src/common/lib/cn";
import type { AgentSkillAssignment, AgentToolAssignment } from "src/common/types";
import { fetchAgents } from "src/modules/agents/common/agentsSlice";
import { fetchTeams } from "src/modules/agents/common/teamsSlice";
import { fetchMcpServers } from "src/modules/mcp-servers/common/mcpServersSlice";
import { fetchSkills } from "src/modules/skills/common/skillsSlice";
import { fetchToolFolders } from "src/modules/tools/common/toolFoldersSlice";
import { fetchTools } from "src/modules/tools/common/toolsSlice";
import { useAppDispatch } from "src/store/store";
import { useAgentDetailContext } from "../../common/agentDetailContext";
import { CallAgentsToggleList } from "../../components/config/CallAgentsToggleList";
import { McpToggleList } from "../../components/config/McpToggleList";
import { SkillsToggleList } from "../../components/config/SkillsToggleList";
import { ToolsToggleList } from "../../components/config/ToolsToggleList";

type ConnectTab = "tools" | "mcp" | "skills" | "agents";

const TABS: { id: ConnectTab; label: string; icon: IconName }[] = [
  { id: "tools", label: "Tools", icon: "code" },
  { id: "mcp", label: "MCP", icon: "stars" },
  { id: "skills", label: "Skills", icon: "stars" },
  { id: "agents", label: "Agents", icon: "stars" },
];

export function ChatToolsButton() {
  const { id, setToolAssignments, setSkillAssignments } = useAgentDetailContext();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ConnectTab>("tools");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const readyIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    const firstLoad = readyIdRef.current !== id;
    if (firstLoad) {
      setLoading(true);
      setFailed(false);
    }
    void Promise.all([
      apiClient.get<AgentToolAssignment[]>(`/api/agents/${id}/tool-assignments`),
      apiClient.get<AgentSkillAssignment[]>(`/api/agents/${id}/skill-assignments`),
      dispatch(fetchTools()).unwrap(),
      dispatch(fetchToolFolders()).unwrap(),
      dispatch(fetchMcpServers()).unwrap(),
      dispatch(fetchSkills()).unwrap(),
      dispatch(fetchAgents()).unwrap(),
      dispatch(fetchTeams()).unwrap(),
    ])
      .then(([toolRows, skillRows]) => {
        if (cancelled) return;
        setToolAssignments(toolRows);
        setSkillAssignments(skillRows);
        readyIdRef.current = id;
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled && readyIdRef.current !== id) setFailed(true);
      })
      .finally(() => {
        if (!cancelled && firstLoad) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, id, dispatch, setToolAssignments, setSkillAssignments]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topLeft"
      arrow
      styles={{ root: { width: 560, maxWidth: 560, padding: 0 }, container: { width: 560, maxWidth: 560, padding: 0 } }}
      content={
        <div className="flex h-112 w-full">
          <nav aria-label="Connections" className="flex w-36 shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-1.5">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => setTab(item.id)}
                className={cn("flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 px-2 py-1.5 text-left text-[13px]", tab === item.id ? "bg-ink-active font-medium text-foreground" : "bg-transparent text-muted-foreground hover:bg-ink-hover hover:text-foreground")}
              >
                <Icon name={item.icon} size={15} />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2.5" onWheel={(e) => e.stopPropagation()}>
            {loading ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">Loading…</div>
            ) : failed ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground">Could not load</div>
            ) : tab === "tools" ? (
              <ToolsToggleList />
            ) : tab === "mcp" ? (
              <McpToggleList />
            ) : tab === "skills" ? (
              <SkillsToggleList />
            ) : (
              <CallAgentsToggleList />
            )}
          </div>
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
