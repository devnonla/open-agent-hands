import { Button } from "devnonla-ui";
import { Plus } from "lucide-react";
import { FeatureIcon } from "src/components/FeatureIcon";

interface DashboardHeroProps {
  greeting: string;
  name: string;
  agentCount: number;
  loaded: boolean;
  onOpenAgents: () => void;
}

/** Welcome banner: glowing brand backdrop, greeting, and the primary call to action. */
export function DashboardHero({ greeting, name, agentCount, loaded, onOpenAgents }: DashboardHeroProps) {
  const hasAgents = agentCount > 0;
  const subtitle = !loaded ? "Loading your workspace…" : hasAgents ? "Here is what your crew is up to today." : "Your workspace is empty. Create your first agent to get started.";

  return (
    <section className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_-20%,color-mix(in_srgb,var(--brand)_32%,transparent),transparent_60%),linear-gradient(180deg,color-mix(in_srgb,var(--brand)_8%,transparent),transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(color-mix(in_srgb,var(--brand)_40%,transparent)_1px,transparent_1px)] bg-size-[16px_16px] mask-[linear-gradient(110deg,transparent_35%,black)] opacity-60" />

      <div className="relative flex flex-wrap items-center justify-between gap-6 px-6 py-8 sm:px-8 sm:py-10">
        <div className="min-w-0 max-w-xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <FeatureIcon name="dashboard" size={16} variant="sticker" />
            Dashboard
          </span>
          <h1 className="mt-4 mb-0 truncate text-3xl font-semibold leading-tight tracking-tight text-foreground">
            {greeting}, {name}
          </h1>
          <p className="mt-2 mb-0 text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <Button type="primary" icon={hasAgents ? undefined : <Plus size={16} />} onClick={onOpenAgents}>
          {hasAgents ? "Open agents" : "Create agent"}
        </Button>
      </div>
    </section>
  );
}
