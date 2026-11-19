import type { ReactNode } from "react";

interface AgentsSectionHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
}

export function AgentsSectionHeader({ title, actions }: AgentsSectionHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">{typeof title === "string" ? <h2 className="m-0 truncate text-[15px] font-semibold leading-5 text-foreground">{title}</h2> : title}</div>
      {actions}
    </div>
  );
}
