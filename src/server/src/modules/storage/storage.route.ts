import { Hono } from "hono";
import { BadRequestException, NotFoundException } from "../../common/exceptions/http.exception.js";
import { requireAuth } from "../../common/middleware/auth.middleware.js";
import { browseFiles, deleteSpace, deleteFile, getSpace, resetPublicLink, getFile, listSpaces, listFiles, fileBlob, putFile, updateSpace } from "./storage.service.js";

const app = new Hono();

app.use("*", requireAuth);

async function spaceOr404(id: string) {
  const space = await getSpace(id);
  if (!space) throw new NotFoundException("Space not found");
  return space;
}

async function fileOr404(id: string) {
  const file = await getFile(id);
  if (!file) throw new NotFoundException("File not found");
  return file;
}

export function contentDisposition(kind: "inline" | "attachment", key: string): string {
  const name = key.split("/").pop() || "file";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

app.get("/spaces", async (c) => c.json(await listSpaces()));

app.put("/spaces/:id", async (c) => {
  const body = await c.req.json<{ description?: string | null; isPublic?: boolean }>();
  return c.json(await updateSpace(c.req.param("id"), body));
});

app.delete("/spaces/:id", async (c) => c.json(await deleteSpace(c.req.param("id"))));

app.get("/spaces/:id/files", async (c) => {
  const space = await spaceOr404(c.req.param("id"));
  const limit = Number(c.req.query("limit") ?? 1000);
  const offset = Number(c.req.query("offset") ?? 0);
  return c.json(await listFiles(space, { prefix: c.req.query("prefix"), limit: Number.isFinite(limit) ? limit : 1000, offset: Number.isFinite(offset) ? offset : 0 }));
});

app.get("/spaces/:id/browse", async (c) => c.json(await browseFiles(await spaceOr404(c.req.param("id")), c.req.query("prefix") ?? "")));

app.put("/spaces/:id/files", async (c) => {
  const space = await spaceOr404(c.req.param("id"));
  const key = c.req.query("key")?.trim();
  if (!key) throw new BadRequestException("Pass the file key as ?key=folder/name.ext and the file as the raw request body");
  const contentType = c.req.header("content-type");
  return c.json(await putFile(space, { key, data: c.req.raw.body ?? new Uint8Array(0), contentType: contentType && contentType !== "application/octet-stream" ? contentType : null }), 201);
});

app.get("/files/:id/download", async (c) => {
  const file = await fileOr404(c.req.param("id"));
  return new Response(fileBlob(file), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": contentDisposition("attachment", file.key),
      "Content-Length": String(file.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.post("/files/:id/reset-link", async (c) => c.json(await resetPublicLink(await fileOr404(c.req.param("id")))));

app.delete("/files/:id", async (c) => {
  await deleteFile(await fileOr404(c.req.param("id")));
  return c.json({ ok: true });
});

export default app;
