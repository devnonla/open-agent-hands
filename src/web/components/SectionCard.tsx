import type { FormEventHandler, ReactNode } from "react";
import { cn } from "src/common/lib/cn";

interface SectionCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Action row pinned to the bottom (e.g. Save button). */
  footer?: ReactNode;
  /** When set, the card renders as a `<form>` so the footer button can submit it. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  className?: string;
}

/** Card with a titled header, a body, and an optional footer for actions. */
export function SectionCard({ title, description, children, footer, onSubmit, className }: SectionCardProps) {
  const Root = onSubmit ? "form" : "section";

  return (
    <Root onSubmit={onSubmit} className={cn("flex flex-col overflow-hidden rounded-xl border border-border bg-card", className)}>
      <header className="border-b border-border-subtle px-6 py-4">
        <h2 className="m-0 text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 mb-0 text-xs text-muted-foreground">{description}</p> : null}
      </header>
      <div className="flex flex-1 flex-col gap-4 px-6 py-5">{children}</div>
      {footer ? <footer className="flex items-center justify-end gap-2 border-t border-border-subtle bg-secondary/40 px-6 py-3">{footer}</footer> : null}
    </Root>
  );
}
