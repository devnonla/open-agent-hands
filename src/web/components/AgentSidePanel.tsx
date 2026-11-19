import { Icon } from "devnonla-ui";
import { type ReactNode, type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from "react";
import { cn } from "src/common/lib/cn";

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const STORAGE_KEY = "nonla-agent-side-width";

function clampWidth(n: number) {
  const viewportCap = typeof window === "undefined" ? MAX_WIDTH : Math.max(MIN_WIDTH, window.innerWidth - 360);
  return Math.min(MAX_WIDTH, viewportCap, Math.max(MIN_WIDTH, Math.round(n)));
}

function readStoredWidth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WIDTH;
    const n = Number(raw);
    return Number.isFinite(n) ? clampWidth(n) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function persistWidth(n: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    // private mode or quota — width still applies for this session
  }
}

/** Bot toggle for `WindowHeader` right slot — shared by tools, datatables, etc. */
export function AgentToggleButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open}
      aria-label={open ? "Hide agent" : "Show agent"}
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 transition-colors", open ? "bg-brand/15 text-brand-700 hover:bg-brand/20" : "bg-transparent text-muted-foreground hover:bg-black/6 hover:text-foreground")}
    >
      <Icon name="stars" size={14} />
    </button>
  );
}

/** Right slide-in panel for agent chat — keep mounted while open so stream state survives toggle. Drag the left edge to resize. */
export function AgentSidePanel({ open, children, width: widthProp }: { open: boolean; children: ReactNode; width?: number }) {
  const [width, setWidth] = useState(() => clampWidth(widthProp ?? readStoredWidth()));
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  const panelRef = useRef<HTMLDivElement>(null);
  widthRef.current = width;

  const applyWidth = (next: number) => {
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    setWidth(clamped);
    persistWidth(clamped);
  };

  useLayoutEffect(() => {
    const el = panelRef.current;
    const root = document.documentElement;
    if (!el) return;
    const apply = () => {
      root.style.setProperty("--nonla-bot-inset", `${Math.round(el.getBoundingClientRect().width)}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--nonla-bot-inset", "0px");
    };
  }, []);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    if (panelRef.current) panelRef.current.style.transition = "none";
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const next = clampWidth(startWidth - (ev.clientX - startX));
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      if (panelRef.current) panelRef.current.style.transition = "";
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      persistWidth(widthRef.current);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  return (
    <div ref={panelRef} className={cn("relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-background", dragging ? "transition-none" : "transition-[width] duration-200 ease-out")} style={{ width: open ? width : 0 }} aria-hidden={!open}>
      {open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agent panel"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize · Double-click to reset"
          className={cn("absolute inset-y-0 -left-1 z-30 w-3 cursor-col-resize touch-none", "after:pointer-events-none after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors", dragging ? "after:bg-brand" : "after:bg-transparent hover:after:bg-brand/70 focus-visible:after:bg-brand/70")}
          onPointerDown={startResize}
          onDoubleClick={() => applyWidth(DEFAULT_WIDTH)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") applyWidth(widthRef.current + 16);
            else if (e.key === "ArrowRight") applyWidth(widthRef.current - 16);
            else if (e.key === "Home") applyWidth(MIN_WIDTH);
            else if (e.key === "Enter") applyWidth(DEFAULT_WIDTH);
            else return;
            e.preventDefault();
          }}
        />
      ) : null}
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">{children}</div>
    </div>
  );
}
