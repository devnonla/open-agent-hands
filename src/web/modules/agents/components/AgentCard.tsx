import type { MenuProps } from "devnonla-ui";
import { ContextMenu, Icon } from "devnonla-ui";
import { useMemo } from "react";
import type { AgentListItem } from "src/common/types";
import { AgentFace } from "src/components/AgentFace";
import RenderIf from "src/components/RenderIf";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";
import { agentModelLabel, isBuiltinAgentId } from "src/modules/agents/common/builtinAgents";
import type { TeamWithMembers } from "src/modules/agents/common/teamsSlice";
import { agentMenuItems } from "src/modules/agents/components/agentMenuItems";
import { useAppDispatch, useAppSelector } from "src/store/store";

export interface AgentCardProps {
  agent: AgentListItem;
  onOpen: () => void;
  dragging?: boolean;
}

export function AgentCard({ agent, onOpen, dragging }: AgentCardProps) {
  const dispatch = useAppDispatch();
  const teams = useAppSelector((s) => s.teams.teams) as TeamWithMembers[];
  const builtin = isBuiltinAgentId(agent.id);

  const menuItems: MenuProps["items"] = useMemo(() => agentMenuItems({ agent, teams, dispatch, onOpen }), [agent, dispatch, onOpen, teams]);

  const card = (
    <div
      role="button"
      tabIndex={0}
      onClick={dragging ? undefined : onOpen}
      onKeyDown={(e) => {
        if (dragging) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group relative flex min-h-56 flex-col items-center justify-center gap-5 overflow-hidden rounded-2xl border border-border-subtle bg-card px-6 py-10 text-center transition-[border-color,background-color,box-shadow] duration-200 hover:border-brand/35 hover:bg-secondary cursor-grab active:cursor-grabbing ${
        dragging ? "cursor-grabbing shadow-xl ring-1 ring-brand/35" : ""
      }`}
    >
      <RenderIf condition={agent.isPublic}>
        <span title="Published" className="absolute left-2 top-2 z-10 flex size-7 items-center justify-center rounded-md bg-success/15 text-success">
          <Icon name="globe" size={14} />
        </span>
      </RenderIf>

      <AgentFace config={parseAgentAvatar(agent.avatar)} label={agent.name} size={88} motion="idle" />

      <div className="flex min-w-0 w-full flex-col items-center gap-1.5">
        <span className="w-full truncate text-[15px] font-semibold leading-5 text-foreground">{agent.name}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{agentModelLabel(agent)}</span>
      </div>
    </div>
  );

  if (builtin) return card;

  return (
    <ContextMenu disabled={dragging} menu={{ items: menuItems, style: { minWidth: 160 } }}>
      {card}
    </ContextMenu>
  );
}
