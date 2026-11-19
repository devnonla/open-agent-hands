import { Button, Icon } from "devnonla-ui";
import { Plus } from "lucide-react";
import type { AgentListItem } from "src/common/types";
import { AgentFace } from "src/components/AgentFace";
import { FeatureIcon } from "src/components/FeatureIcon";
import RenderIf from "src/components/RenderIf";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";
import { agentModelLabel } from "src/modules/agents/common/builtinAgents";

interface RecentAgentsProps {
  agents: AgentListItem[];
  loaded: boolean;
  onOpenAgent: (id: string) => void;
  onOpenAll: () => void;
}

function AgentRow({ agent, onOpen }: { agent: AgentListItem; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full cursor-pointer items-center gap-3 border-none bg-transparent px-6 py-3 text-left transition-colors duration-150 hover:bg-secondary">
      <AgentFace config={parseAgentAvatar(agent.avatar)} label={agent.name} size={36} motion="idle" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{agent.name}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{agentModelLabel(agent)}</span>
      </span>
      <RenderIf condition={agent.isPublic}>
        <span title="Published" className="flex size-6 items-center justify-center rounded-md bg-success/15 text-success">
          <Icon name="globe" size={13} />
        </span>
      </RenderIf>
      <span className="hidden text-xs text-muted-foreground sm:block">{agent.toolCount} tools</span>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-6 py-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <span className="size-9 animate-pulse rounded-full bg-muted" />
          <span className="flex flex-col gap-1.5">
            <span className="h-3 w-32 animate-pulse rounded bg-muted" />
            <span className="h-2.5 w-20 animate-pulse rounded bg-muted" />
          </span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand-700">
        <FeatureIcon name="agents" size={22} variant="sticker" />
      </span>
      <div>
        <p className="m-0 text-sm font-medium text-foreground">No agents yet</p>
        <p className="mt-1 mb-0 text-xs text-muted-foreground">Create one to start chatting, add tools, and publish it.</p>
      </div>
      <Button icon={<Plus size={14} />} onClick={onCreate}>
        New agent
      </Button>
    </div>
  );
}

/** Latest updated agents. Reads the store list; no extra request. */
export function RecentAgents({ agents, loaded, onOpenAgent, onOpenAll }: RecentAgentsProps) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-6 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <FeatureIcon name="agents" size={22} variant="sticker" />
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-semibold text-foreground">Recent agents</h2>
            <p className="mt-0.5 mb-0 text-xs text-muted-foreground">Pick up where you left off.</p>
          </div>
        </div>
        <RenderIf condition={agents.length > 0}>
          <Button type="text" size="small" onClick={onOpenAll}>
            View all
          </Button>
        </RenderIf>
      </header>

      <RenderIf condition={!loaded}>
        <ListSkeleton />
      </RenderIf>
      <RenderIf condition={loaded && agents.length === 0}>
        <EmptyState onCreate={onOpenAll} />
      </RenderIf>
      <RenderIf condition={loaded && agents.length > 0}>
        <div className="flex flex-col divide-y divide-border-subtle">
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} onOpen={() => onOpenAgent(agent.id)} />
          ))}
        </div>
      </RenderIf>
    </section>
  );
}
