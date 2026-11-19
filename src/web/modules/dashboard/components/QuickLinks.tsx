import { FeatureIcon, type FeatureIconName } from "src/components/FeatureIcon";

export interface QuickLink {
  to: string;
  title: string;
  blurb: string;
  icon: FeatureIconName;
}

/** Shortcuts to the other areas of the workspace. */
export function QuickLinks({ links, onNavigate }: { links: QuickLink[]; onNavigate: (to: string) => void }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border-subtle px-6 py-4">
        <h2 className="m-0 text-sm font-semibold text-foreground">Explore</h2>
        <p className="mt-0.5 mb-0 text-xs text-muted-foreground">Everything your agents can use.</p>
      </header>
      <div className="flex flex-col p-2">
        {links.map(({ to, title, blurb, icon }) => (
          <button key={to} type="button" onClick={() => onNavigate(to)} className="group flex cursor-pointer items-center gap-3 rounded-lg border-none bg-transparent px-4 py-2.5 text-left transition-colors duration-150 hover:bg-secondary">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-brand/10">
              <FeatureIcon name={icon} size={20} variant="sticker" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-foreground">{title}</span>
              <span className="truncate text-xs text-muted-foreground">{blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
