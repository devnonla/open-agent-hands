import { Switch } from "devnonla-ui";
import { useMemo } from "react";
import type { AgentListItem } from "src/common/types";
import { AgentFace } from "src/components/AgentFace";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";
import { useAppSelector } from "src/store/store";
import { useAgentDetailContext } from "../../common/agentDetailContext";
import { buildCallAgentTeams } from "../../common/configGroups";

export function CallAgentsToggleList() {
  const { id, callableAgentIds, onToggleCallableAgent, readonly } = useAgentDetailContext();
  const agents = useAppSelector((s) => s.agents.items) as AgentListItem[];
  const teams = useAppSelector((s) => s.teams.teams);
  const teamGroups = useMemo(() => {
    const built = id ? buildCallAgentTeams({ agents, currentAgentId: id, teams, callableAgentIds }) : [];
    if (!readonly) return built;
    return built.map((team) => ({ ...team, agents: team.agents.filter((agent) => agent.connected) })).filter((team) => team.agents.length > 0);
  }, [agents, id, teams, callableAgentIds, readonly]);
  const totalCount = useMemo(() => teamGroups.flatMap((t) => t.agents).length, [teamGroups]);

  if (totalCount === 0) {
    return <div className="px-2 py-10 text-center text-[12px] text-muted-foreground">{readonly ? "No agents attached" : "No other agents available"}</div>;
  }

  return (
    <>
      {teamGroups.map((team) => (
        <div key={team.id ?? "__ungrouped"} className="w-full pb-1">
          <div className="px-2 pt-2 pb-1.5">
            <span className="truncate text-[10px] font-bold tracking-wider text-muted-foreground uppercase">{team.name}</span>
          </div>
          <div className="w-full">
            {team.agents.map((agent) => (
              <div key={agent.id} className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-ink-hover">
                <AgentFace config={parseAgentAvatar(agent.avatar)} label={agent.name} size={22} className="shrink-0" />
                <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{agent.name}</div>
                <Switch size="small" className="shrink-0" checked={agent.connected} disabled={readonly} onChange={(checked) => onToggleCallableAgent(agent.id, checked)} aria-label={`Toggle ${agent.name}`} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
