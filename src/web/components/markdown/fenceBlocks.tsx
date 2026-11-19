import type { MarkdownComponents, MarkdownFenceProps } from "devnonla-ui/markdown";
import { useMemo } from "react";
import type { AgentListItem } from "src/common/types";
import { AgentFace } from "src/components/AgentFace";
import { parseAgentAvatar } from "src/components/agentAvatarConfig";
import { OpenUiFence } from "src/components/markdown/OpenUiFence";
import { useAppSelector } from "src/store/store";

function parseSteps(code: string): string[] {
  return code
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(?:\d+[.)]|[-*])\s+/, ""));
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  let cursor = 0;
  return (
    <>
      {parts.map((part) => {
        const start = cursor;
        cursor += part.length;
        return part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={start} className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={start}>{part}</span>
        );
      })}
    </>
  );
}

function StepFence({ code }: MarkdownFenceProps) {
  const items = parseSteps(code);
  if (items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Steps</div>
      <ol className="m-0 flex list-none flex-col px-3 py-3">
        {items.map((item, index) => (
          <li key={`${index}:${item}`} className="relative flex gap-3 pb-3 last:pb-0">
            {index < items.length - 1 ? <span className="absolute top-6 bottom-0 left-3 w-px -translate-x-1/2 bg-border" aria-hidden /> : null}
            <span className="relative z-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/12 text-[12px] font-semibold text-brand-700">{index + 1}</span>
            <span className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed text-foreground">
              <Inline text={item} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

type RouteNode = { if: string; call: string; do: string; branches: RouteNode[] };
type RouteGraph = { from: string; via: string; nodes: RouteNode[]; after: string };

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseBranch(item: unknown): RouteNode | null {
  if (!item || typeof item !== "object") return null;
  const branch = item as { if?: unknown; call?: unknown; do?: unknown; branches?: unknown };
  const condition = textField(branch.if);
  const call = textField(branch.call);
  const action = textField(branch.do);
  const children = Array.isArray(branch.branches) ? branch.branches.map(parseBranch).filter((node): node is RouteNode => node != null) : [];
  if (!condition) return null;
  return { if: condition, call, do: action, branches: children };
}

function parseRoute(code: string): RouteGraph | null {
  let data: unknown;
  try {
    data = JSON.parse(code);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const row = data as { when?: unknown; caller?: unknown; branches?: unknown; after?: unknown };
  if (!Array.isArray(row.branches)) return null;
  const nodes = row.branches.map(parseBranch).filter((node): node is RouteNode => node != null);
  const from = textField(row.when);
  if (!from || nodes.length === 0) return null;
  return { from, via: textField(row.caller), nodes, after: textField(row.after) };
}

function RouteLabel({ children }: { children: string }) {
  return <span className="mr-1.5 shrink-0 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">{children}</span>;
}

function AgentMark({ name, agents }: { name: string; agents: Map<string, AgentListItem> }) {
  const agent = agents.get(name);
  if (!agent) return null;
  return <AgentFace config={parseAgentAvatar(agent.avatar)} label={agent.name} size={20} className="shrink-0" />;
}

function RouteBranches({ nodes, agents }: { nodes: RouteNode[]; agents: Map<string, AgentListItem> }) {
  return (
    <div className="flex flex-col gap-2">
      {nodes.map((node, index) => (
        <div key={`${index}:${node.if}`} className="min-w-0 rounded-lg border border-border bg-background">
          <div className="px-3 py-2.5">
            <p className="m-0 text-[13px] leading-relaxed text-foreground">
              <RouteLabel>if</RouteLabel>
              {node.if}
            </p>
            {node.call ? (
              <p className="m-0 mt-1.5 flex items-center text-[13px] leading-relaxed text-foreground">
                <RouteLabel>then</RouteLabel>
                <span className="inline-flex items-center gap-1.5">
                  Call
                  <AgentMark name={node.call} agents={agents} />
                  <span className="font-medium">{node.call}</span>
                </span>
              </p>
            ) : null}
            {node.do ? (
              <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-foreground">
                <RouteLabel>then</RouteLabel>
                {node.do}
              </p>
            ) : null}
          </div>
          {node.branches.length > 0 ? (
            <div className="border-t border-border px-3 py-2">
              <div className="ml-3 border-l border-border pl-3">
                <RouteBranches nodes={node.branches} agents={agents} />
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RouteFence({ code }: MarkdownFenceProps) {
  const graph = parseRoute(code);
  const items = useAppSelector((state) => state.agents.items) as AgentListItem[];
  const agents = useMemo(() => {
    const map = new Map<string, AgentListItem>();
    for (const agent of items) map.set(agent.name, agent);
    return map;
  }, [items]);
  if (!graph) return null;
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-card">
      <div className="px-4 pt-4 pb-3">
        <p className="m-0 text-[13px] leading-relaxed text-foreground">
          <RouteLabel>when</RouteLabel>
          {graph.from}
        </p>
        {graph.via ? (
          <p className="m-0 mt-1.5 flex items-center gap-1.5 text-[13px] leading-relaxed text-foreground">
            <RouteLabel>do</RouteLabel>
            <AgentMark name={graph.via} agents={agents} />
            {graph.via}
          </p>
        ) : null}
      </div>
      <div className="px-4 pb-4">
        <RouteBranches nodes={graph.nodes} agents={agents} />
      </div>
      {graph.after ? (
        <div className="border-t border-border px-4 py-3">
          <p className="m-0 text-[13px] leading-relaxed text-foreground">
            <RouteLabel>after</RouteLabel>
            {graph.after}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export const markdownFenceComponents: MarkdownComponents = {
  step: StepFence,
  route: RouteFence,
  openui: OpenUiFence,
};
