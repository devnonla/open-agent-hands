import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Step = { id: string; kind: "user" | "tool" | "result" | "say"; text: string; detail?: string };

const TYPE_MS = 18;
const DELAY: Record<Step["kind"], number> = { user: 450, tool: 650, result: 300, say: 0 };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function usePlayback(steps: Step[]) {
  const [pos, setPos] = useState(() => (prefersReducedMotion() ? { line: steps.length, chars: 0 } : { line: 0, chars: 0 }));

  useEffect(() => {
    if (pos.line >= steps.length) return;
    const step = steps[pos.line];
    const typing = step.kind === "user" && pos.chars < step.text.length;
    const timer = window.setTimeout(() => setPos((p) => (typing ? { line: p.line, chars: p.chars + 1 } : { line: p.line + 1, chars: 0 })), typing ? TYPE_MS : DELAY[step.kind]);
    return () => window.clearTimeout(timer);
  }, [pos, steps]);

  return { pos, done: pos.line >= steps.length, replay: () => setPos({ line: 0, chars: 0 }) };
}

function Caret() {
  return <span aria-hidden className="inline-block h-[1.05em] w-[0.55em] translate-y-[0.18em] animate-pulse bg-foreground motion-reduce:animate-none" />;
}

function serverName(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "local";
    return host.split(".")[0] || host;
  } catch {
    return "local";
  }
}

export function TerminalDemo({ server, maskedKey }: { server: string; maskedKey: string }) {
  const name = serverName(server);
  const steps = useMemo<Step[]>(
    () => [
      { id: "u1", kind: "user", text: "Connect to Agent Hands and make it my default server" },
      { id: "t1", kind: "tool", text: "Bash", detail: `oahctl login ${server} ${maskedKey}` },
      { id: "r1", kind: "result", text: `{"ok":true,"server":"${name}","tools":61}` },
      { id: "t2", kind: "tool", text: "Bash", detail: `oahctl use ${name}` },
      { id: "r2", kind: "result", text: `{"ok":true,"default":"${name}"}` },
      { id: "t3", kind: "tool", text: "Bash", detail: "oahctl servers" },
      { id: "r3", kind: "result", text: `{"servers":[{"name":"${name}","url":"${server}","default":true}]}` },
      { id: "s1", kind: "say", text: `Connected. ${name} is now your default server, with 61 tools ready.` },
    ],
    [server, maskedKey, name],
  );
  const { pos, done, replay } = usePlayback(steps);

  return (
    <figure className="m-0 overflow-hidden rounded-xl border border-border bg-card" aria-label="Example: an agent using oahctl in its terminal">
      <div className="relative flex items-center border-b border-border bg-muted px-3 py-1.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="pointer-events-none absolute inset-x-0 text-center font-mono text-[10.5px] text-muted-foreground">~/my-project</span>
        <button
          type="button"
          onClick={replay}
          disabled={!done}
          aria-label="Replay"
          className="ml-auto inline-flex size-5 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground disabled:cursor-default disabled:opacity-0"
        >
          <RotateCcw size={11} />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-4 py-4 font-mono text-[12.5px] leading-[1.6] text-foreground">
        {steps.map((step, i) => {
          const shown = i < pos.line || (i === pos.line && step.kind === "user");
          const running = step.kind === "tool" && i === pos.line - 1 && !done && steps[pos.line]?.kind === "result";
          const hidden = shown ? "" : "invisible";

          if (step.kind === "user") {
            const typing = i === pos.line;
            return (
              <div key={step.id} className={`flex gap-2 rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground ${hidden}`}>
                <span className="select-none text-tertiary-foreground">&gt;</span>
                <span className="min-w-0 whitespace-pre-wrap">
                  {typing ? step.text.slice(0, pos.chars) : step.text}
                  {typing ? <Caret /> : null}
                </span>
              </div>
            );
          }
          if (step.kind === "tool") {
            return (
              <div key={step.id} className={`-mb-2 flex gap-2 ${hidden}`}>
                <span className={running ? "animate-pulse text-brand motion-reduce:animate-none" : "text-green-600"}>⏺</span>
                <span className="min-w-0 break-all">
                  <span className="font-semibold text-foreground">{step.text}</span>
                  <span className="text-muted-foreground">({step.detail})</span>
                </span>
              </div>
            );
          }
          if (step.kind === "result") {
            return (
              <div key={step.id} className={`flex gap-2 pl-4 text-tertiary-foreground ${hidden}`}>
                <span className="select-none">⎿</span>
                <span className="min-w-0 break-all">{step.text}</span>
              </div>
            );
          }
          return (
            <div key={step.id} className={`flex gap-2 ${hidden}`}>
              <span className="text-foreground">⏺</span>
              <span className="min-w-0">{step.text}</span>
            </div>
          );
        })}

        <div className="mt-1 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-tertiary-foreground">
          <span className="select-none">&gt;</span>
          {done ? <Caret /> : <span className="text-brand">✻ Working…</span>}
        </div>
      </div>
    </figure>
  );
}
