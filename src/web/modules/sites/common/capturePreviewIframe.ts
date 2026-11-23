import { toBlob } from "html-to-image";

const CAPTURE_WIDTH = 960;
const CAPTURE_HEIGHT = 600;

function opaqueColor(value: string): string | null {
  if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return null;
  return value;
}

function pageBackground(doc: Document): string {
  const view = doc.defaultView;
  if (!view) return "#ffffff";
  const probe = doc.elementFromPoint(Math.min(view.innerWidth, CAPTURE_WIDTH) / 2, Math.min(view.innerHeight, CAPTURE_HEIGHT) / 2);
  for (let el: Element | null = probe; el; el = el.parentElement) {
    const color = opaqueColor(view.getComputedStyle(el).backgroundColor);
    if (color) return color;
  }
  return opaqueColor(view.getComputedStyle(doc.documentElement).backgroundColor) ?? "#ffffff";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForStableRender(doc: Document, timeoutMs = 8000, quietMs = 600): Promise<boolean> {
  const started = Date.now();
  let lastSize = -1;
  let stableSince = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(120);
    if (!doc.defaultView) return false;
    const root = doc.getElementById("root") ?? doc.body;
    const size = root?.innerHTML.length ?? 0;
    if (size !== lastSize) {
      lastSize = size;
      stableSince = Date.now();
      continue;
    }
    if (size > 0 && Date.now() - stableSince >= quietMs) break;
  }
  if (lastSize <= 0) return false;
  await Promise.race([doc.fonts?.ready, sleep(2000)]);
  const view = doc.defaultView;
  if (view) await new Promise((resolve) => view.requestAnimationFrame(() => view.requestAnimationFrame(resolve)));
  return true;
}

/**
 * html-to-image copies computed styles into an SVG. CSS `filter: blur()` paints as a white slab there,
 * and `background-clip: text` drops the fill. Flatten those just for the snapshot, then restore.
 */
function prepareCapture(doc: Document): () => void {
  const view = doc.defaultView;
  if (!view) return () => undefined;

  const style = doc.createElement("style");
  style.setAttribute("data-thumb-capture", "");
  style.textContent = `
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
      filter: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
  `;
  doc.head.appendChild(style);

  const patched: HTMLElement[] = [];
  for (const el of doc.querySelectorAll<HTMLElement>("*")) {
    const clip = view.getComputedStyle(el).backgroundClip;
    if (clip !== "text") continue;
    patched.push(el);
    const fallback = opaqueColor(view.getComputedStyle(el.parentElement ?? doc.body).color) ?? "#111111";
    el.style.setProperty("color", fallback);
    el.style.setProperty("-webkit-text-fill-color", fallback);
  }

  return () => {
    style.remove();
    for (const el of patched) {
      el.style.removeProperty("color");
      el.style.removeProperty("-webkit-text-fill-color");
    }
  };
}

export async function capturePreviewIframe(iframe: HTMLIFrameElement): Promise<Blob | null> {
  const doc = iframe.contentDocument;
  if (!doc?.body) return null;
  if (!(await waitForStableRender(doc))) return null;
  if (iframe.contentDocument !== doc) return null;

  const restore = prepareCapture(doc);
  try {
    const backgroundColor = pageBackground(doc);
    const options = {
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      canvasWidth: CAPTURE_WIDTH,
      canvasHeight: CAPTURE_HEIGHT,
      pixelRatio: 1,
      cacheBust: true,
      backgroundColor,
      style: { width: `${CAPTURE_WIDTH}px`, height: `${CAPTURE_HEIGHT}px`, overflow: "hidden", backgroundColor },
    };
    try {
      return await toBlob(doc.body, options);
    } catch {
      return await toBlob(doc.body, { ...options, skipFonts: true });
    }
  } finally {
    restore();
  }
}
