import { BadRequestException } from "../../../common/exceptions/http.exception.js";

export const TOOL_ICON_MAX_LENGTH = 8000;

const UNSAFE = [/<script/i, /<foreignObject/i, /\son\w+\s*=/i, /javascript:/i, /<iframe/i, /<!ENTITY/i, /<style/i, /<image[\s>]/i, /\s(?:xlink:)?href\s*=\s*["']?(?!#)/i];

export function normalizeToolIcon(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new BadRequestException("icon must be an SVG string, or an empty string to remove it");
  const svg = raw.trim();
  if (!svg) return null;
  if (svg.length > TOOL_ICON_MAX_LENGTH) throw new BadRequestException(`icon is ${svg.length} characters; keep the SVG under ${TOOL_ICON_MAX_LENGTH}`);
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) throw new BadRequestException('icon must be inline SVG markup that starts with "<svg" and ends with "</svg>"');
  const hit = UNSAFE.find((re) => re.test(svg));
  if (hit) throw new BadRequestException("icon must be plain SVG: no scripts, event handlers, external links, iframes or foreignObject");
  if (!/\sviewBox\s*=/i.test(svg.slice(0, svg.indexOf(">")))) throw new BadRequestException('icon needs a viewBox on the <svg> tag, e.g. viewBox="0 0 24 24"');
  return svg;
}
