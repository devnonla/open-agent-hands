import { Card, Tag } from "devnonla-ui";
import type { ReactNode } from "react";
import { CARD_HOVER } from "src/components/card-hover";

export function McpServerCard({ icon, name, meta, description, tag, onOpen }: { icon: ReactNode; name: string; meta: string; description: string; tag?: ReactNode; onOpen: () => void }) {
  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={`Open ${name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onOpen();
      }}
      className={`h-full min-w-0 cursor-pointer [&>div]:flex-1 focus-visible:outline-2 focus-visible:outline-focus-ring ${CARD_HOVER}`}
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          {icon}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{name}</div>
            <div className="text-xs tabular-nums text-tertiary-foreground">{meta}</div>
          </div>
          {tag}
        </div>
        {description ? <p className="m-0 line-clamp-2 text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </Card>
  );
}

export function DisabledTag() {
  return <Tag>Disabled</Tag>;
}
