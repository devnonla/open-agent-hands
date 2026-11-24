import { useId } from "react";
import { cn } from "src/common/lib/cn";

const SKIN = "#F9C9B6";
const SKIN_SHADE = "#EDB49C";
const HAIR = "#2E2A33";
const INK = "#2E2A33";

export function UserAvatar({ className, size = 32 }: { className?: string; size?: number }) {
  const clip = `avatar${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 100 100" className={cn("shrink-0 rounded-full", className)}>
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="100" height="100" fill="#FFE3C4" />
        <g transform="translate(50 56) scale(1.12) translate(-50 -56)">
          <path d="M14 104c1-15 15-25 36-25s35 10 36 25z" fill="#7C6CF2" />
          <path d="M40 79c2 5 6 7 10 7s8-2 10-7z" fill="#6656E0" />
          <path d="M43 62h14v15c0 4-3 7-7 7s-7-3-7-7z" fill={SKIN_SHADE} />
          <circle cx="30.5" cy="50" r="4.5" fill={SKIN} />
          <circle cx="69.5" cy="50" r="4.5" fill={SKIN} />
          <ellipse cx="50" cy="48" rx="19.5" ry="21.5" fill={SKIN} />
          <path d="M29.5 49c-2-13 5-25 19-26.5 10-1 18 2.5 21.5 9.5 2.5 5 2 11 .5 17-1.5-6-4.5-10-8-12-6 4-15 5.5-24 4.5-4 1.5-7.5 4-9.5 7.5z" fill={HAIR} />
          <path d="M39 44.5c1.8-1.2 4.2-1.4 6-.4M55 44.1c1.8-1 4.2-.8 6 .4" fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
          <ellipse cx="42.5" cy="50.5" rx="2" ry="2.4" fill={INK} />
          <ellipse cx="57.5" cy="50.5" rx="2" ry="2.4" fill={INK} />
          <circle cx="38" cy="57" r="3" fill="#FF8F8F" opacity="0.35" />
          <circle cx="62" cy="57" r="3" fill="#FF8F8F" opacity="0.35" />
          <path d="M50 52.5c-.6 2-1.5 3.6-1.5 4.3 0 .7.8 1 1.8 1" fill="none" stroke={SKIN_SHADE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M45 61.5c2.8 2.8 7.2 2.8 10 0" fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}
