import type { MenuItemType, MenuProps } from "devnonla-ui";
import { Check } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import type { Agent, AgentListItem } from "src/common/types";
import { AgentFace } from "src/components/AgentFace";
import { FeatureIcon } from "src/components/FeatureIcon";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";
import { fetchConversations } from "src/modules/agents/common/chatSlice";
import type { TeamWithMembers } from "src/modules/agents/common/teamsSlice";
import { AgentsContentHeader, type BreadcrumbItem, ContentBreadcrumb } from "src/modules/agents/components/ContentBreadcrumb";
import { HistoryPopover } from "src/modules/agents/public/components/HistoryPopover";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { useAgentDetailContext } from "../common/agentDetailContext";
import { ShareAgentButton } from "./ShareAgentButton";

function createdAtTs(agent: AgentListItem): number {
  return agent.createdAt ? new Date(agent.createdAt).getTime() : 0;
}

function sortAgents(agents: AgentListItem[]) {
  return [...agents].sort((a, b) => {
    const byOrder = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (byOrder !== 0) return byOrder;
    return createdAtTs(b) - createdAtTs(a);
  });
}

function sortTeams(teams: TeamWithMembers[]) {
  return [...teams].sort((a, b) => {
    const byOrder = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    if (byOrder !== 0) return byOrder;
    return a.name.localeCompare(b.name);
  });
}

function agentMenuItem(agent: AgentListItem, activeId: string, onOpen: (id: string) => void): MenuItemType {
  const active = agent.id === activeId;
  return {
    key: agent.id,
    className: cn("w-full", active && "bg-ink-active"),
    label: (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <AgentFace config={parseAgentAvatar(agent.avatar)} label={agent.name} size={18} className="shrink-0" />
        <span className={cn("min-w-0 flex-1 truncate", active && "font-medium")}>{agent.name}</span>
        {active ? <Check size={14} className="shrink-0 text-muted-foreground" aria-hidden /> : null}
      </span>
    ),
    onClick: () => onOpen(agent.id),
  };
}

function agentSwitcherMenu(agents: AgentListItem[], teams: TeamWithMembers[], activeId: string, onOpen: (id: string) => void): MenuProps | undefined {
  if (agents.length === 0) return undefined;
  const teamIds = new Set(teams.map((team) => team.id));
  const sections = sortTeams(teams)
    .map((team) => ({ id: team.id, name: team.name, agents: sortAgents(agents.filter((agent) => agent.teamId === team.id)) }))
    .filter((section) => section.agents.length > 0);
  const ungrouped = sortAgents(agents.filter((agent) => !agent.teamId || !teamIds.has(agent.teamId)));
  const items: MenuItemType[] = sections.map((section) => ({
    type: "group" as const,
    key: section.id,
    label: section.name,
    className: "uppercase tracking-wider",
    children: section.agents.map((agent) => agentMenuItem(agent, activeId, onOpen)),
  }));
  if (ungrouped.length > 0) {
    const rows = ungrouped.map((agent) => agentMenuItem(agent, activeId, onOpen));
    if (sections.length === 0) items.push(...rows);
    else items.push({ type: "group", key: "ungrouped", label: "Ungrouped", className: "uppercase tracking-wider", children: rows });
  }
  return {
    items,
    className: "max-h-[min(70vh,28rem)] w-64 overflow-y-auto",
  };
}

interface AgentDetailHeaderProps {
  id: string;
  agent: Agent;
  avatar: string | null;
}

export function AgentDetailHeader({ id, agent, avatar }: AgentDetailHeaderProps) {
  const { teamId, chatHistory } = useAgentDetailContext();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const dispatch = useAppDispatch();
  const onCanvas = /\/canvas\/?$/.test(pathname);
  const onChat = /\/chat\/?$/.test(pathname);
  const teams = useAppSelector((s) => s.teams.teams) as TeamWithMembers[];
  const agents = useAppSelector((s) => s.agents.items) as AgentListItem[];
  const conversations = useAppSelector((s) => s.chat.conversations);
  const activeConversationId = useAppSelector((s) => s.chat.activeConversationId);
  const team = teams.find((item) => item.id === (teamId ?? agent.teamId)) ?? null;
  const section = /\/canvas\/?$/.test(pathname) ? "canvas" : "chat";

  const switcher = useMemo(() => {
    return agentSwitcherMenu(agents, teams, id, (nextId) => {
      if (nextId === id) return;
      navigate(`/agents/${nextId}/${section}`);
    });
  }, [agents, teams, id, navigate, section]);

  const processingConvIds = useMemo(() => new Set(conversations.filter((item) => item.agentId === id && item.status === "running").map((item) => item.id)), [conversations, id]);

  const loadHistoryPage = useCallback(
    async (offset: number) => {
      if (offset > 0) return { items: [], hasMore: false };
      const rows = await dispatch(fetchConversations(id)).unwrap();
      const items = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((item) => ({ id: item.id, title: item.title || "Untitled", createdAt: item.createdAt, isEmpty: false, status: item.status }));
      return { items, hasMore: false };
    },
    [dispatch, id],
  );

  const items: BreadcrumbItem[] = [{ label: "Agents", to: "/agents", icon: <FeatureIcon name="agents" size={16} variant="sticker" /> }];
  if (team) {
    items.push({ label: team.name, to: `/agents/teams/${team.id}` });
  }
  items.push({
    label: agent.name,
    icon: <AgentFace config={parseAgentAvatar(avatar ?? agent.avatar)} label={agent.name} size={18} className="shrink-0" />,
    menu: switcher,
  });

  return (
    <AgentsContentHeader
      left={<ContentBreadcrumb items={items} />}
      right={
        <div className="flex items-center gap-1">
          {chatHistory ? <HistoryPopover conversationId={activeConversationId} processingConvIds={processingConvIds} onLoadPage={loadHistoryPage} onSelect={chatHistory.onSelect} onDelete={chatHistory.onDelete} /> : null}
          <div className="mr-1 flex items-center rounded-lg bg-foreground/6 p-0.5" role="group" aria-label="Agent view">
            <button type="button" aria-pressed={onCanvas} onClick={() => navigate(`/agents/${id}/canvas`)} className={cn("h-6 rounded-md border-0 px-2 text-[12px] leading-none", onCanvas ? "bg-card font-medium text-foreground shadow-sm" : "bg-transparent text-muted-foreground hover:text-foreground")}>
              Canvas
            </button>
            <button type="button" aria-pressed={onChat} onClick={() => navigate(`/agents/${id}/chat`)} className={cn("h-6 rounded-md border-0 px-2 text-[12px] leading-none", onChat ? "bg-card font-medium text-foreground shadow-sm" : "bg-transparent text-muted-foreground hover:text-foreground")}>
              Chat
            </button>
          </div>
          <ShareAgentButton />
        </div>
      }
    />
  );
}
