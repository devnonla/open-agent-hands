import { useId } from "react";
import { cn } from "src/common/lib/cn";

function swirlArm(index: number): string {
  const base = ((-90 + 120 * index) * Math.PI) / 180;
  const sweep = (200 * Math.PI) / 180;
  const points: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const f = i / 60;
    const angle = base + sweep * f;
    const radius = 8 + 12 * f;
    points.push(`${(32 + radius * Math.cos(angle)).toFixed(2)} ${(32 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join(" L")}`;
}

const SWIRL_ARMS = [0, 1, 2].map(swirlArm);

export function AppMark({ size = 28, className }: { size?: number; className?: string }) {
  const gradientId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={gradientId} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFA640" />
          <stop offset="1" stopColor="#E5600F" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${gradientId})`} />
      <g stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round">
        {SWIRL_ARMS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <circle cx="32" cy="32" r="3.2" fill="#FFFFFF" />
    </svg>
  );
}

export const IS_DEV_BUILD = import.meta.env.DEV;

export function DevBadge({ className }: { className?: string }) {
  if (!IS_DEV_BUILD) return null;
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none tracking-wider text-white bg-violet-600", className)} title="Development build: bun run dev, data in ~/.open-agent-hands-dev">
      DEV
    </span>
  );
}

export function AppLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-3 text-foreground", className)} role="img" aria-label={IS_DEV_BUILD ? "Open Agent Hands (development)" : "Open Agent Hands"}>
      <AppMark size={size} />
      <span className="truncate text-[15px] font-semibold tracking-tight">Open Agent Hands</span>
      <DevBadge className="-ml-1" />
    </span>
  );
}
