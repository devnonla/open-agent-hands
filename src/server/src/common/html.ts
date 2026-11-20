export const OG_IMAGE_WIDTH = "1200";
export const OG_IMAGE_HEIGHT = "630";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Resolve public origin, honouring reverse-proxy forwarded headers. */
export function requestOrigin(req: Request): string {
  const xfProto = req.headers.get("x-forwarded-proto");
  const xfHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (xfHost) {
    const proto = (xfProto?.split(",")[0]?.trim() || "https").replace(/:$/, "");
    return `${proto}://${xfHost.split(",")[0].trim()}`;
  }
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

export function ogMetaTags(opts: { title: string; description: string; pageUrl: string; imageUrl: string }): string {
  const t = escapeHtml(opts.title);
  const d = escapeHtml(opts.description);
  const u = escapeHtml(opts.pageUrl);
  const img = escapeHtml(opts.imageUrl);
  return [
    `<meta name="description" content="${d}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Agent Hands" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${u}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${t}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${img}" />`,
  ].join("\n    ");
}
