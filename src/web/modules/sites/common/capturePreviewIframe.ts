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
  return opaqueColor(view.getComputedStyle(doc.body).backgroundColor) ?? opaqueColor(view.getComputedStyle(doc.documentElement).backgroundColor) ?? "#ffffff";
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

/** Capture the same-origin live preview iframe into a PNG blob. */
export async function capturePreviewIframe(iframe: HTMLIFrameElement): Promise<Blob | null> {
  const doc = iframe.contentDocument;
  if (!doc?.body) return null;

  const restore = prepareCapture(doc);
  try {
    const backgroundColor = pageBackground(doc);
    return await toBlob(doc.body, {
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      canvasWidth: CAPTURE_WIDTH,
      canvasHeight: CAPTURE_HEIGHT,
      pixelRatio: 1,
      cacheBust: true,
      backgroundColor,
      style: {
        width: `${CAPTURE_WIDTH}px`,
        height: `${CAPTURE_HEIGHT}px`,
        overflow: "hidden",
        backgroundColor,
      },
    });
  } finally {
    restore();
  }
}
