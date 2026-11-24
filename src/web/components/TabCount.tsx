import { cn } from "src/common/lib/cn";

export function TabCount({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-ink-hover px-1.5 text-2xs font-semibold leading-none tabular-nums text-muted-foreground transition-colors duration-(--nonla-dur-fast)",
        "in-aria-selected:bg-foreground in-aria-selected:text-background",
        value === 0 && "opacity-50",
        className,
      )}
    >
      {value}
    </span>
  );
}
