import { existsSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import rootPkg from "../../../package.json" with { type: "json" };
import { HttpException } from "./common/exceptions/http.exception.js";
import { clearSiteAccessTokenCookieHeader, parseCookieValue, resolveAuth, siteAccessTokenCookieHeader, siteTokenCookieName } from "./common/middleware/auth.middleware.js";
import { EMBEDDED_WEB_ASSETS } from "./embedded-assets.js";

import apiKeysRoute from "./modules/api-keys/api-keys.route.js";
import authRoute from "./modules/auth/auth.route.js";
import datatablesRoute from "./modules/datatables/datatables.route.js";
import jobsRoute from "./modules/jobs/jobs.route.js";
import kvstoreRoute from "./modules/kvstore/kvstore.route.js";
import mcpHttpRoute from "./modules/my-mcp-servers/mcp-http.route.js";
import myMcpServersRoute from "./modules/my-mcp-servers/my-mcp-servers.route.js";
import secretsRoute from "./modules/secrets/secrets.route.js";
import settingsRoute from "./modules/settings/settings.route.js";
import publicSitesRoute from "./modules/sites/public-sites.route.js";
import sitesRoute from "./modules/sites/sites.route.js";
import storageRoute, { contentDisposition } from "./modules/storage/storage.route.js";
import { getPublicFile, fileEtag, fileBlob } from "./modules/storage/storage.service.js";
import { getPublicSiteAsset, renderPublicSiteDocument } from "./modules/sites/sites.service.js";
import toolFoldersRoute from "./modules/tool-folders/tool-folders.route.js";
import toolsRoute from "./modules/tools/tools.route.js";
import v1Route from "./modules/v1/v1.route.js";
import { coreMcpAdmin, coreMcpEndpoint } from "./modules/core-mcp/core-mcp.route.js";

const APP_VERSION = rootPkg.version;

function assetCacheControl(reqPath: string): string {
  return reqPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}

type WebSource = { file: (reqPath: string) => string | null };

function resolveWebSource(): WebSource | null {
  if (Object.keys(EMBEDDED_WEB_ASSETS).length > 0) {
    return { file: (reqPath) => EMBEDDED_WEB_ASSETS[reqPath] ?? null };
  }
  const webDist = [`${import.meta.dir}/../../web/dist`, `${import.meta.dir}/../web/dist`].find((p) => existsSync(`${p}/index.html`));
  if (!webDist) return null;
  return { file: (reqPath) => `${webDist}${reqPath}` };
}

function siteAccessFromRequest(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } }, slug: string) {
  const auth = c.req.header("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
  const headerToken = c.req.header("x-site-access-token")?.trim();
  const queryToken = c.req.query("token")?.trim() || c.req.query("site_token")?.trim();
  const cookieToken = parseCookieValue(c.req.header("Cookie"), siteTokenCookieName(slug)) ?? undefined;
  return {
    token: bearer || headerToken || queryToken || cookieToken || undefined,
  };
}

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", logger());
  app.use(
    "/api/*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use(
    "/mcp/*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "Authorization", "MCP-Protocol-Version", "Mcp-Session-Id"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      exposeHeaders: ["Mcp-Session-Id", "MCP-Protocol-Version"],
    }),
  );

  app.use("/api/*", resolveAuth);

  app.onError((err, c) => {
    if (err instanceof HttpException) {
      return c.json({ code: err.statusCode, message: err.message }, err.statusCode as any);
    }
    console.error("[Unhandled]", err);
    return c.json({ code: 500, message: "Internal Server Error" }, 500);
  });

  app.route("/api/auth", authRoute);
  app.route("/api/core-mcp", coreMcpAdmin);


  app.route("/api/tools", toolsRoute);
  app.route("/api/tool-folders", toolFoldersRoute);
  app.route("/api/my-mcp-servers", myMcpServersRoute);
  app.route("/api/kvstore", kvstoreRoute);
  app.route("/api/datatables", datatablesRoute);
  app.route("/api/secrets", secretsRoute);
  app.route("/api/sites", sitesRoute);
  app.route("/api/public/sites", publicSitesRoute);
  app.route("/api/storage", storageRoute);
  app.route("/api/jobs", jobsRoute);
  app.route("/api/settings", settingsRoute);
  app.route("/api/api-keys", apiKeysRoute);
  app.route("/api/v1", v1Route);

  app.route("/mcp/core", coreMcpEndpoint);
  app.route("/mcp", mcpHttpRoute);

  app.get("/public/sites/:slug", async (c) => {
    const slug = c.req.param("slug");
    const legacyToken = c.req.query("site_token")?.trim() || c.req.query("token")?.trim();
    // Strip legacy ?site_token= from URL; persist via HttpOnly cookie instead.
    if (legacyToken) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/public/sites/${encodeURIComponent(slug)}`,
          "Set-Cookie": siteAccessTokenCookieHeader(slug, legacyToken),
          "Cache-Control": "no-store",
        },
      });
    }

    const access = siteAccessFromRequest(c, slug);
    try {
      const doc = await renderPublicSiteDocument(slug, c.req.raw, access);
      const headers: Record<string, string> = {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      };
      if (doc.kind === "unlock") {
        headers["Set-Cookie"] = clearSiteAccessTokenCookieHeader(slug);
      }
      return new Response(doc.html, { headers });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") || message.includes("Not found") ? 404 : 500;
      return new Response(`<!DOCTYPE html><pre style="padding:16px">${message}</pre>`, {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  });

  app.get("/public/sites/:slug/assets/:file", async (c) => {
    const slug = c.req.param("slug");
    const access = siteAccessFromRequest(c, slug);
    const file = c.req.param("file");
    if (file !== "app.js" && file !== "styles.css") return c.json({ message: "Not found" }, 404);
    try {
      const asset = await getPublicSiteAsset(slug, file, access);
      return new Response(asset.body, {
        headers: { "Content-Type": asset.contentType, "Cache-Control": "no-store" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /password|unauthorized/i.test(message) ? 401 : /not found/i.test(message) ? 404 : 500;
      return c.json({ message }, status);
    }
  });

  app.get("/public/storage/*", async (c) => {
    const token = new URL(c.req.url).pathname.slice("/public/storage/".length).split("/")[0] ?? "";
    const file = await getPublicFile(token);
    const privateHeaders = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" };
    if (!file) return new Response("Not found", { status: 404, headers: { ...privateHeaders, "Content-Type": "text/plain; charset=utf-8" } });
    const etag = `"${await fileEtag(file)}"`;
    const headers = {
      "Content-Type": file.contentType,
      "Content-Disposition": contentDisposition("inline", file.key),
      "Cache-Control": "private, max-age=60",
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "no-referrer",
      ETag: etag,
    };
    if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(fileBlob(file), { headers: { ...headers, "Content-Length": String(file.size) } });
  });

  app.get("/api/health", (c) => c.json({ ok: true, app: "agenthands", version: APP_VERSION, runtime: "bun" }));
  app.all("/api/*", (c) => c.json({ code: 404, message: "Not found" }, 404));
  app.all("/mcp/*", (c) => c.json({ code: 404, message: "Not found" }, 404));

  const web = resolveWebSource();
  if (web) {
    app.get("*", async (c) => {
      const reqPath = c.req.path;
      const assetPath = reqPath !== "/" ? web.file(reqPath) : null;
      if (assetPath && (await Bun.file(assetPath).exists())) {
        const res = new Response(Bun.file(assetPath));
        res.headers.set("Cache-Control", assetCacheControl(reqPath));
        return res;
      }
      const indexPath = web.file("/index.html");
      if (!indexPath) return c.notFound();
      return new Response(Bun.file(indexPath), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
    });
  } else {
    app.get("/", (c) => c.json({ ok: true, app: "agenthands", message: "Web UI not built yet." }));
  }

  return app;
}
