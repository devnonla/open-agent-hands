import { Button, Icon } from "devnonla-ui";
import { Plus } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentListItem } from "src/common/types";
import { MissingProviderCallout } from "src/components/MissingProviderCallout";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { fetchAgents } from "src/modules/agents/common/agentsSlice";
import { fetchTeams } from "src/modules/agents/common/teamsSlice";
import type { TeamWithMembers } from "src/modules/agents/common/teamsSlice";
import { AgentsBoard } from "src/modules/agents/components/AgentsBoard";
import { NewAgentDialog } from "src/modules/agents/components/NewAgentDialog";
import { NewTeamDialog } from "src/modules/agents/components/NewTeamDialog";
import { useAppDispatch, useAppSelector } from "src/store/store";

export default function AgentsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const agents = useAppSelector((s) => s.agents.items) as AgentListItem[];
  const teams = useAppSelector((s) => s.teams.teams) as TeamWithMembers[];

  useEffect(() => {
    dispatch(fetchAgents());
    dispatch(fetchTeams());
  }, [dispatch]);

  return (
    <PageShell>
      <MissingProviderCallout />
      <PageHeader
        title="Agents"
        icon="agents"
        actions={
          <>
            <NewTeamDialog>
              <Button type="default" icon={<Icon name="dialog" size={14} />}>
                New Team
              </Button>
            </NewTeamDialog>
            <NewAgentDialog onCreated={(agent) => navigate(`/agents/${agent.id}`)}>
              <Button type="primary" icon={<Plus size={14} />}>
                New Agent
              </Button>
            </NewAgentDialog>
          </>
        }
      />

      <AgentsBoard teams={teams} agents={agents} onNavigate={(id) => navigate(`/agents/${id}`)} />
    </PageShell>
  );
}
