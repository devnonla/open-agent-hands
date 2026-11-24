import { Settings } from "lucide-react";
import { cn } from "src/common/lib/cn";
import { TabCount } from "./TabCount";

export function TabCountSettings({ count, active, label, onOpen }: { count: number; active: boolean; label: string; onOpen?: () => void }) {
  const showSettings = active && !!onOpen;
  return (
    <span className="inline-grid place-items-center">
      <TabCount value={count} className={cn("[grid-area:1/1]", showSettings && "invisible")} />
      {onOpen ? (
        <span
          role="button"
          tabIndex={showSettings ? 0 : -1}
          aria-hidden={!showSettings}
          aria-label={label}
          onClick={(e) => {
            if (!showSettings) return;
            e.stopPropagation();
            onOpen();
          }}
          onKeyDown={(e) => {
            if (!showSettings || (e.key !== "Enter" && e.key !== " ")) return;
            e.preventDefault();
            e.stopPropagation();
            onOpen();
          }}
          className={cn("inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground [grid-area:1/1] hover:bg-ink-hover hover:text-foreground", !showSettings && "invisible")}
        >
          <Settings size={14} />
        </span>
      ) : null}
    </span>
  );
}
