import { Hono } from "hono";
import { clearSiteAccessTokenCookieHeader, parseCookieValue, siteAccessTokenCookieHeader, siteTokenCookieName } from "../../common/middleware/auth.middleware.js";
import { loadPublicSiteData, renderPublicSite, runInSiteWorkspace, runPublicAction, verifySitePublicAccessToken, verifySitePublicPassword } from "./sites.service.js";

function siteAccessFromRequest(c: { req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined; param: (name: string) => string } }, body?: { password?: string; token?: string }) {
  const slug = c.req.param("slug");
  const auth = c.req.header("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
  const headerToken = c.req.header("x-site-access-token")?.trim();
  const queryToken = c.req.query("token")?.trim() || c.req.query("site_token")?.trim();
  const cookieToken = slug ? (parseCookieValue(c.req.header("Cookie"), siteTokenCookieName(slug)) ?? undefined) : undefined;
  return {
    password: body?.password,
    token: body?.token || bearer || headerToken || queryToken || cookieToken || undefined,
  };
}

const app = new Hono();

app.use("/:slug/*", (c, next) => runInSiteWorkspace(c.req.param("slug"), () => next()));
app.use("/:slug", (c, next) => runInSiteWorkspace(c.req.param("slug"), () => next()));

app.get("/:slug", async (c) => {
  const access = siteAccessFromRequest(c);
  const result = await renderPublicSite(c.req.param("slug"), c.req.raw, access);
  return c.json(result);
});

app.get("/:slug/data", async (c) => {
  const access = siteAccessFromRequest(c);
  const result = await loadPublicSiteData(c.req.param("slug"), c.req.raw, access);
  return c.json(result);
});

app.post("/:slug/verify", async (c) => {
  const slug = c.req.param("slug");
  const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
  const result = await verifySitePublicPassword(slug, body.password);
  const headers: Record<string, string> = {};
  if (result.token) {
    headers["Set-Cookie"] = siteAccessTokenCookieHeader(slug, result.token);
  } else {
    headers["Set-Cookie"] = clearSiteAccessTokenCookieHeader(slug);
  }
  return c.json(result, { headers });
});

app.post("/:slug/verify-token", async (c) => {
  const slug = c.req.param("slug");
  const body = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
  const result = await verifySitePublicAccessToken(slug, body.token);
  const headers: Record<string, string> = {};
  if (result.valid && body.token) {
    headers["Set-Cookie"] = siteAccessTokenCookieHeader(slug, body.token);
  } else {
    headers["Set-Cookie"] = clearSiteAccessTokenCookieHeader(slug);
  }
  return c.json(result, { headers });
});

app.post("/:slug/action", async (c) => {
  const access = siteAccessFromRequest(c);
  const result = await runPublicAction(c.req.param("slug"), c.req.raw, access);
  return c.json(result);
});

export default app;
