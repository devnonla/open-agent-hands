import { Popover } from "devnonla-ui";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { FeatureIcon, type FeatureIconName } from "src/components/FeatureIcon";
import type { HiddenTool } from "src/modules/tools/common/toolsSlice";
import { useAppSelector } from "src/store/store";

const SVG_NS = "http://www.w3.org/2000/svg";
const TOKEN = /[A-Za-z_][A-Za-z0-9_]*/g;

type MentionTool = HiddenTool;
type Hit = { start: number; end: number; tool: MentionTool };
type Mounted = { host: Element; root: Root };

function toolIcon(name: string): FeatureIconName {
  if (name.startsWith("nonla_manage_datatable")) return "datatables";
  if (name.includes("agent")) return "agents";
  if (name.includes("tool")) return "tools";
  if (name.includes("skill")) return "skills";
  if (name.includes("site")) return "sites";
  if (name.includes("job")) return "jobs";
  if (name.includes("mcp")) return "mcp";
  if (name.includes("kv")) return "kv-store";
  if (name.includes("secret")) return "secrets";
  return "tools";
}

function toolPopupContainer(anchor: HTMLElement | null): HTMLElement {
  const host = anchor?.closest("[role=dialog]") ?? document.querySelector(".nonla-ui");
  return host instanceof HTMLElement ? host : document.body;
}

function ToolChip({ tool }: { tool: MentionTool }) {
  const chipRef = useRef<HTMLButtonElement>(null);
  return (
    <Popover
      trigger="hover"
      arrow
      placement="top"
      getPopupContainer={() => toolPopupContainer(chipRef.current)}
      contentClassName="max-w-sm px-3 py-2.5"
      content={
        <span className="flex flex-col gap-2.5 text-left">
          <span className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Name</span>
            <span className="text-[13px] font-semibold text-foreground">{tool.label}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{tool.name}</span>
          </span>
          {tool.description ? (
            <span className="flex flex-col gap-0.5 border-t border-border pt-2.5">
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Description</span>
              <span className="text-xs font-normal leading-relaxed text-foreground">{tool.description}</span>
            </span>
          ) : null}
        </span>
      }
    >
      <button ref={chipRef} type="button" className="mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-muted/70 px-1.5 py-0 align-middle text-[12px] font-medium leading-4.5 text-foreground">
        <FeatureIcon name={toolIcon(tool.name)} size={14} />
        <span>{tool.label}</span>
      </button>
    </Popover>
  );
}

function MentionParts({ value, hits }: { value: string; hits: Hit[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [index, hit] of hits.entries()) {
    if (hit.start > cursor) parts.push(value.slice(cursor, hit.start));
    parts.push(<ToolChip key={`${hit.tool.id}-${hit.start}-${index}`} tool={hit.tool} />);
    cursor = hit.end;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return <>{parts}</>;
}

function collectHits(value: string, byName: Map<string, MentionTool>): Hit[] {
  const hits: Hit[] = [];
  for (const match of value.matchAll(TOKEN)) {
    const tool = byName.get(match[0]);
    if (!tool || match.index == null) continue;
    hits.push({ start: match.index, end: match.index + match[0].length, tool });
  }
  return hits;
}

function mount(host: HTMLElement, node: ReactNode, mounted: Mounted[], marker: Element = host) {
  marker.setAttribute("data-tool-chip", "1");
  const root = createRoot(host);
  root.render(node);
  mounted.push({ host: marker, root });
}

function replaceSvg(text: Text, value: string, hits: Hit[], mounted: Mounted[]) {
  const parent = text.parentElement;
  const textEl = parent?.closest("text");
  if (!parent || !(textEl instanceof SVGTextElement) || (textEl.textContent ?? "") !== value) {
    const label = hits.reduce((next, hit) => next.replace(hit.tool.name, hit.tool.label), value);
    text.nodeValue = label;
    const title = hits.map((hit) => (hit.tool.description ? `${hit.tool.label}: ${hit.tool.description}` : hit.tool.label)).join("\n");
    const owner = parent?.closest("text, g");
    if (owner && !owner.querySelector("title")) {
      const node = document.createElementNS(SVG_NS, "title");
      node.textContent = title;
      owner.prepend(node);
    }
    return;
  }

  let box = { x: 0, y: 0, width: 160, height: 22 };
  try {
    const b = textEl.getBBox();
    if (b.width > 0) box = { x: b.x, y: b.y - 1, width: b.width + 28, height: Math.max(b.height + 6, 20) };
  } catch {
    box.width = 160;
  }
  const fo = document.createElementNS(SVG_NS, "foreignObject");
  fo.setAttribute("x", String(box.x));
  fo.setAttribute("y", String(box.y));
  fo.setAttribute("width", String(box.width));
  fo.setAttribute("height", String(box.height));
  const host = document.createElement("div");
  host.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  fo.append(host);
  textEl.replaceWith(fo);
  mount(host, <MentionParts value={value} hits={hits} />, mounted, fo);
}

function replaceText(text: Text, byName: Map<string, MentionTool>, mounted: Mounted[]) {
  const value = text.nodeValue ?? "";
  if (!value.includes("_")) return;
  const hits = collectHits(value, byName);
  if (hits.length === 0) return;
  const parent = text.parentNode;
  if (!parent) return;
  if (parent instanceof Element && parent.namespaceURI === SVG_NS) {
    replaceSvg(text, value, hits, mounted);
    return;
  }
  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) frag.append(value.slice(cursor, hit.start));
    const host = document.createElement("span");
    frag.append(host);
    mount(host, <ToolChip tool={hit.tool} />, mounted);
    cursor = hit.end;
  }
  if (cursor < value.length) frag.append(value.slice(cursor));
  parent.replaceChild(frag, text);
}

function prune(mounted: Mounted[]) {
  for (let i = mounted.length - 1; i >= 0; i--) {
    if (mounted[i].host.isConnected) continue;
    mounted[i].root.unmount();
    mounted.splice(i, 1);
  }
}

function decorate(root: HTMLElement, byName: Map<string, MentionTool>, mounted: Mounted[]) {
  prune(mounted);
  const texts: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.nodeValue;
      if (!value?.includes("_")) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-tool-chip], textarea, [data-md-editor]")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) replaceText(text, byName, mounted);
}

export function useToolMentions(ref: RefObject<HTMLElement | null>) {
  const tools = useAppSelector((state) => state.tools.items);
  const hiddenTools = useAppSelector((state) => state.tools.hiddenTools);
  const byName = useMemo(() => {
    const map = new Map<string, MentionTool>();
    for (const tool of [...hiddenTools, ...tools]) {
      if (tool.name.includes("_")) map.set(tool.name, tool);
    }
    return map;
  }, [tools, hiddenTools]);

  useEffect(() => {
    const root = ref.current;
    if (!root || byName.size === 0) return;
    const mounted: Mounted[] = [];
    let timer = 0;
    let observer: MutationObserver | null = null;
    const run = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        observer?.disconnect();
        decorate(root, byName, mounted);
        observer?.observe(root, { childList: true, subtree: true, characterData: true });
      }, 0);
    };
    observer = new MutationObserver(run);
    run();
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      for (const item of mounted) item.root.unmount();
    };
  }, [byName, ref]);
}
