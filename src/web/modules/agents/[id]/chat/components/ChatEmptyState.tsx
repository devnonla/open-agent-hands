import { Alert, Button, Icon } from "devnonla-ui";
import type { Agent } from "src/common/types";
import { AgentFace } from "src/components/AgentFace";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";

const STARTERS = ["What can you help me with?", "Brainstorm a few ideas with me", "Walk me through how you work"] as const;

interface ChatEmptyStateProps {
  agent: Agent;
  onStarter?: (text: string) => void;
  disabled?: boolean;
  missingInstruct?: boolean;
  onAddInstruct?: () => void;
}

export function ChatEmptyState({ agent, onStarter, disabled, missingInstruct, onAddInstruct }: ChatEmptyStateProps) {
  const description = agent.description?.trim() || null;

  return (
    <div className="flex flex-col items-center justify-center min-h-full w-full px-6 py-10 text-center animate-[fadeIn_0.35s_ease-out_both]">
      <div className="relative mb-5">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: "radial-gradient(circle, color-mix(in oklab, var(--brand) 28%, transparent) 0%, transparent 70%)",
          }}
        />
        <AgentFace config={parseAgentAvatar(agent.avatar)} label={agent.name} size={64} className="relative shrink-0" motion="idle" />
      </div>

      <h2 className="m-0 text-[22px] font-semibold tracking-tight text-foreground leading-snug">Hi, I&apos;m {agent.name}</h2>

      {description ? <p className="mt-2 mb-0 max-w-90 text-[13px] leading-relaxed text-tertiary-foreground line-clamp-2">{description}</p> : <p className="mt-2 mb-0 max-w-[320px] text-[13px] leading-relaxed text-tertiary-foreground">Send a message to start working together.</p>}

      {missingInstruct ? (
        <div className="mt-6 w-full max-w-md text-left">
          <Alert type="warning" showIcon title="No system prompt yet" description="Add a system prompt so this agent knows its personality, rules, and what to do.">
            {onAddInstruct ? (
              <Button size="small" className="mt-2" icon={<Icon name="book" size={14} />} onClick={onAddInstruct}>
                Add system prompt
              </Button>
            ) : null}
          </Alert>
        </div>
      ) : onStarter ? (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2 max-w-130">
          {STARTERS.map((text) => (
            <Button type="default" key={text} size="small" disabled={disabled} onClick={() => onStarter(text)}>
              {text}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
