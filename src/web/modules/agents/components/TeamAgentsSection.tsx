import { useDroppable } from "@dnd-kit/core";
import { EditableInput, message } from "devnonla-ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "src/common/lib/cn";
import type { AgentListItem } from "src/common/types";
import RenderIf from "src/components/RenderIf";
import { BUILTIN_TEAM_ID } from "src/modules/agents/common/builtinAgents";
import { type TeamWithMembers, updateTeam } from "src/modules/agents/common/teamsSlice";
import { useAppDispatch } from "src/store/store";
import { AgentCardGrid } from "./AgentCardGrid";
import { AgentsSectionHeader } from "./AgentsSectionHeader";
import { NewAgentDialog } from "./NewAgentDialog";

interface TeamAgentsSectionProps {
  team: TeamWithMembers;
  agents: AgentListItem[];
  onNavigate: (id: string) => void;
}

function TeamNameEditable({ team }: { team: TeamWithMembers }) {
  const dispatch = useAppDispatch();
  const [editing, setEditing] = useState(false);

  return (
    <EditableInput
      display={<span className="text-[15px] font-semibold leading-5 text-foreground">{team.name}</span>}
      editing={editing}
      onStartEdit={() => setEditing(true)}
      onCancelEdit={() => setEditing(false)}
      initialValue={team.name}
      editLabel="Edit team name"
      placeholder="Team name"
      onSave={async (name) => {
        const next = name.trim();
        if (!next) {
          message.error("Team name is required");
          throw new Error("empty");
        }
        if (next === team.name) return;
        try {
          await dispatch(updateTeam({ id: team.id, name: next })).unwrap();
        } catch {
          message.error("Failed to rename team");
          throw new Error("rename failed");
        }
      }}
    />
  );
}

export function TeamAgentsSection({ team, agents, onNavigate }: TeamAgentsSectionProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: team.id,
    data: { type: "team", teamId: team.id },
  });

  const isBuiltin = team.id === BUILTIN_TEAM_ID;

  return (
    <section ref={setNodeRef} className={cn("rounded-2xl transition-colors", isOver && "bg-muted/35 ring-1 ring-border/80")}>
      <AgentsSectionHeader title={isBuiltin ? team.name : <TeamNameEditable team={team} />} />

      <RenderIf
        condition={agents.length > 0}
        fallback={
          isBuiltin ? (
            <p className="m-0 px-2 py-4 text-[13px] text-muted-foreground">No built-in agents yet. Restart the server.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NewAgentDialog defaultTeamId={team.id} className="block w-full">
                <button
                  type="button"
                  className="group flex min-h-56 w-full cursor-pointer flex-col items-center justify-center gap-5 overflow-hidden rounded-2xl border border-border-subtle bg-card px-6 py-10 text-center transition-[border-color,background-color,box-shadow] duration-200 hover:border-brand/35 hover:bg-secondary"
                >
                  <div className="rounded-full bg-border p-0.75 transition-colors duration-200 group-hover:bg-brand/25">
                    <div className="rounded-full bg-card p-0.5">
                      <div className="flex size-22 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors duration-200 group-hover:text-foreground">
                        <Plus size={32} strokeWidth={1.75} />
                      </div>
                    </div>
                  </div>
                  <div className="flex min-w-0 w-full flex-col items-center gap-1.5">
                    <span className="w-full truncate text-[15px] font-semibold leading-5 text-foreground">Add agent</span>
                    <span aria-hidden="true" className="invisible truncate font-mono text-xs">
                      model
                    </span>
                  </div>
                </button>
              </NewAgentDialog>
            </div>
          )
        }
      >
        <AgentCardGrid agents={agents} onNavigate={onNavigate} />
      </RenderIf>
    </section>
  );
}
