import { eq } from "drizzle-orm";
import { appSettings, getDb, isDbReady } from "../db/client.js";
import { qone } from "../db/query.js";
import { BadRequestException } from "../exceptions/http.exception.js";

export const PUBLIC_URL_SETTING_KEY = "public_url";

let configured = "";
let listenUrl = "http://127.0.0.1:8429";

export function normalizePublicUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException(`Public URL must be a full address like https://hands.example.com (got "${value}")`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadRequestException("Public URL must start with http:// or https://");
  if (url.search || url.hash || url.username || url.password) throw new BadRequestException("Public URL must not contain a query, a fragment or credentials");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function setListenAddress(host: string, port: number): void {
  const name = host === "0.0.0.0" || host === "::" || host === "" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host;
  listenUrl = `http://${name}:${port}`;
}

export function setConfiguredPublicUrl(value: string): void {
  configured = normalizePublicUrl(value);
}

export async function loadPublicUrlSetting(): Promise<void> {
  if (!isDbReady()) return;
  const row = await qone(getDb().select().from(appSettings).where(eq(appSettings.key, PUBLIC_URL_SETTING_KEY)));
  try {
    configured = normalizePublicUrl(row?.value ?? "");
  } catch {
    configured = "";
  }
}

export function publicUrlInfo() {
  return { configured, listen: listenUrl, effective: configured || listenUrl, source: configured ? "setting" : "listen" };
}

export function publicBaseUrl(): string {
  return configured || listenUrl;
}

export function absoluteUrl(path: string): string {
  return `${publicBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  return `${proto === "http" || proto === "https" ? proto : url.protocol.slice(0, -1)}://${host}`;
}
