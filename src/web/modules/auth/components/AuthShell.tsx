import type { CSSProperties, ReactNode } from "react";
import meadowWallpaper from "src/assets/bg.jpg";
import { cn } from "src/common/lib/cn";
import { AppMark, DevBadge } from "src/components/AppLogo";

const SUNSET_THEME = {
  "--nonla-bg": "#fffaf3",
  "--nonla-surface": "#fffdf9",
  "--nonla-text-main": "#3a2716",
  "--nonla-text-secondary": "#7b5d44",
  "--nonla-text-tertiary": "#97785e",
  "--nonla-border": "rgb(146 92 44 / 16%)",
  "--nonla-input": "rgb(146 92 44 / 22%)",
  "--nonla-brand": "#ec7f1c",
  "--nonla-danger": "#c8432f",
} as CSSProperties;

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  className?: string;
};

export function AuthShell({ title, subtitle, children, className }: AuthShellProps) {
  return (
    <div className="relative h-dvh w-screen overflow-hidden bg-[#f6c28b]">
      <img src={meadowWallpaper} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full select-none object-cover object-center" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(255_244_228/45%)_0%,rgb(255_244_228/0%)_60%)]" />
      <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto p-6">
        <div style={SUNSET_THEME} className={cn("nonla-ui light relative w-full max-w-sm animate-fadeIn rounded-2xl border border-white/80 bg-[#fffaf3]/80 px-7 pb-7 pt-8 shadow-[0_30px_80px_-20px_rgb(150_72_16/45%),0_2px_6px_rgb(150_72_16/12%)] backdrop-blur-xl", className)}>
          <DevBadge className="absolute right-4 top-4" />
          <div className="flex flex-col items-center pb-7 text-center">
            <AppMark size={48} className="drop-shadow-[0_6px_14px_rgb(229_96_15/35%)]" />
            <h1 className="mt-4 text-lg font-semibold tracking-tight text-[#3a2716]">{title}</h1>
            <p className="mt-1 text-sm text-[#7b5d44]">{subtitle}</p>
          </div>
          {children}
          <p className="mt-6 text-center text-xs text-[#97785e]">Runs on this machine. Your data stays here.</p>
        </div>
      </div>
    </div>
  );
}

export function AuthError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-[#c8432f]/25 bg-[#c8432f]/8 px-3 py-2">
      <p className="text-xs font-medium text-[#c8432f]">{message}</p>
    </div>
  );
}
