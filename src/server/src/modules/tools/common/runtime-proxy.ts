import { HttpException } from "../../../common/exceptions/http.exception.js";
import { deleteRowsByName, getProjectSchemaByRef, insertRowsByName, listProjects, queryRowsByName, resolveProject, updateRowByName } from "../../datatables/datatables.service.js";
import { defaultKvProjectId, deleteKvByKey, ensureKvProjectId, getKvByKey, listKvEntries, resolveKvProject, upsertKvByKey } from "../../kvstore/kvstore.service.js";
import { getSecretValueByKey, listSecrets } from "../../secrets/secrets.service.js";
import { deleteFile, ensureSpace, getFileByKey, listSpaces, listFiles, normalizeKey, fileEtag, fileBlob, putFile, requireSpace, resolveSpace } from "../../storage/storage.service.js";

type RpcBody = { ns?: string; action?: string; args?: Record<string, unknown> };

function ok(result: unknown) {
  return Response.json({ ok: true, result });
}

function fail(error: string, status = 400) {
  return Response.json({ ok: false, error }, { status });
}

async function existingKvProjectId(project: string): Promise<string | undefined> {
  if (!project) return await defaultKvProjectId();
  return (await resolveKvProject(project))?.id;
}

async function handleKv(action: string, args: Record<string, unknown>) {
  const project = String(args.project ?? "").trim();
  switch (action) {
    case "get": {
      const key = String(args.key ?? "")
        .trim()
        .toUpperCase();
      const projectId = await existingKvProjectId(project);
      if (projectId === undefined) return ok(null);
      const entry = await getKvByKey(key, projectId);
      return ok(entry?.value ?? null);
    }
    case "set": {
      const key = String(args.key ?? "");
      const value = args.value;
      if (typeof value !== "string") throw new Error("value must be a string");
      const entry = await upsertKvByKey({ key, value, projectId: await ensureKvProjectId(project) });
      return ok(entry ? { key: entry.key, value: entry.value } : null);
    }
    case "list": {
      const result = await listKvEntries({ sorts: "key", project: project || (await defaultKvProjectId()) });
      return ok((result.items as { key: string; value: string }[]).map((e) => ({ key: e.key, value: e.value })));
    }
    case "delete": {
      const key = String(args.key ?? "")
        .trim()
        .toUpperCase();
      const projectId = await existingKvProjectId(project);
      if (projectId === undefined) throw new Error(`KV project "${project}" not found`);
      return ok(await deleteKvByKey(key, projectId));
    }
    default:
      throw new Error(`Unknown kv action: ${action}`);
  }
}

async function handleSecrets(action: string, args: Record<string, unknown>) {
  switch (action) {
    case "get": {
      const key = String(args.key ?? "")
        .trim()
        .toUpperCase();
      return ok(await getSecretValueByKey(key));
    }
    case "list": {
      const result = await listSecrets({ limit: "1000" });
      return ok((result.items as { key: string }[]).map((e) => e.key));
    }
    default:
      throw new Error(`Unknown secrets action: ${action}`);
  }
}

function formatProjects(projects: { id: string; name: string }[]) {
  if (projects.length === 0) return "(none)";
  return projects.map((p) => `${p.name} [id=${p.id}]`).join(", ");
}

async function handleDatatable(action: string, args: Record<string, unknown>) {
  switch (action) {
    case "list_projects":
      return ok((await listProjects()).map((p) => ({ id: p.id, name: p.name })));
    case "get_schema": {
      const projectRef = String(args.project ?? "").trim();
      const availableProjects = (await listProjects()).map((p) => ({ id: p.id, name: p.name }));
      if (!projectRef) {
        throw new Error(`'project' is required (id or name). Available projects: ${formatProjects(availableProjects)}`);
      }
      const project = await resolveProject(projectRef);
      if (!project) {
        throw new Error(`Project "${projectRef}" not found. Available projects: ${formatProjects(availableProjects)}`);
      }

      // Always full project schema (all tables + columns)
      const schema = await getProjectSchemaByRef(project.id);
      return ok({
        project: { id: schema.project.id, name: schema.project.name },
        tables: schema.tables.map((t) => ({
          id: t.id,
          name: t.name,
          columns: t.columns.map((c) => ({
            name: c.name,
            type: c.type,
            options: c.options,
            required: c.required,
          })),
        })),
      });
    }
    case "query":
      return ok(
        await queryRowsByName(String(args.project ?? ""), String(args.table ?? ""), {
          where: args.where as import("../../datatables/datatable-where.util.js").WhereFilter | undefined,
          order_by: args.order_by as { key: string; dir?: "asc" | "desc" }[] | undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
          offset: typeof args.offset === "number" ? args.offset : undefined,
        }),
      );
    case "insert":
      return ok(await insertRowsByName(String(args.project ?? ""), String(args.table ?? ""), (args.rows as Record<string, unknown>[]) ?? []));
    case "update":
      return ok(await updateRowByName(String(args.project ?? ""), String(args.table ?? ""), String(args.row_id ?? ""), (args.data as Record<string, unknown>) ?? {}));
    case "delete":
      return ok(await deleteRowsByName(String(args.project ?? ""), String(args.table ?? ""), (args.row_ids as string[]) ?? []));
    default:
      throw new Error(`Unknown datatable action: ${action}`);
  }
}

function fileMeta(file: { key: string; size: number; contentType: string; updatedAt: Date; publicUrl: string | null }) {
  return { key: file.key, size: file.size, contentType: file.contentType, updatedAt: file.updatedAt, publicUrl: file.publicUrl };
}

async function handleStorage(action: string, args: Record<string, unknown>) {
  const spaceRef = String(args.space ?? "").trim();
  if (action === "list_spaces") return ok((await listSpaces()).items.map((b) => ({ name: b.name, description: b.description, public: b.isPublic, fileCount: b.fileCount, totalBytes: b.totalBytes })));
  if (!spaceRef) throw new Error("storage.space(name) needs a space name");
  switch (action) {
    case "list": {
      const space = await resolveSpace(spaceRef);
      if (!space) return ok([]);
      const result = await listFiles(space, { prefix: typeof args.prefix === "string" ? args.prefix : undefined, limit: 1000 });
      return ok(result.items.map(fileMeta));
    }
    case "delete": {
      const space = await requireSpace(spaceRef);
      const file = await getFileByKey(space.id, normalizeKey(String(args.key ?? "")));
      if (!file) return ok({ deleted: false });
      await deleteFile(file);
      return ok({ deleted: true });
    }
    default:
      throw new Error(`Unknown storage action: ${action}`);
  }
}

function splitStoragePath(pathname: string): { space: string; key: string } | null {
  const rest = pathname.slice("/storage/".length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  try {
    return { space: decodeURIComponent(rest.slice(0, slash)), key: rest.slice(slash + 1).split("/").map(decodeURIComponent).join("/") };
  } catch {
    return null;
  }
}

async function handleStorageBytes(req: Request, pathname: string): Promise<Response> {
  const target = splitStoragePath(pathname);
  if (!target) return fail("Use /storage/<space>/<key>", 400);
  try {
    if (req.method === "PUT") {
      const space = await ensureSpace(target.space);
      const type = req.headers.get("content-type");
      const saved = await putFile(space, { key: target.key, data: req.body ?? new Uint8Array(0), contentType: type && type !== "application/octet-stream" ? type : null });
      return ok(fileMeta(saved));
    }
    if (req.method === "GET") {
      const space = await resolveSpace(target.space);
      const file = space ? await getFileByKey(space.id, normalizeKey(target.key)) : null;
      if (!file) return new Response(null, { status: 404 });
      return new Response(fileBlob(file), { headers: { "Content-Type": file.contentType, "Content-Length": String(file.size), ETag: `"${await fileEtag(file)}"` } });
    }
    return fail("Method not allowed", 405);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), err instanceof HttpException ? err.statusCode : 400);
  }
}

async function handleProxyRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") return fail("Method not allowed", 405);
  let body: RpcBody;
  try {
    body = (await req.json()) as RpcBody;
  } catch {
    return fail("Invalid JSON");
  }
  const ns = body.ns ?? "";
  const action = body.action ?? "";
  const args = body.args ?? {};
  try {
    if (ns === "kv") return await handleKv(action, args);
    if (ns === "secrets") return await handleSecrets(action, args);
    if (ns === "datatable") return await handleDatatable(action, args);
    if (ns === "storage") return await handleStorage(action, args);
    return fail(`Unknown namespace: ${ns}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof HttpException ? err.statusCode : 400;
    return fail(message, status);
  }
}

type ProxyHandle = { url: string; token: string; env: Record<string, string>; stop: () => void };

let hub: ReturnType<typeof Bun.serve> | null = null;
const liveTokens = new Set<string>();

function ensureProxyHub(): NonNullable<typeof hub> {
  if (hub) return hub;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: Number.MAX_SAFE_INTEGER,
    async fetch(req) {
      const token = req.headers.get("X-Agenthands-Token") ?? "";
      if (!liveTokens.has(token)) return new Response("Forbidden", { status: 403 });
      const pathname = new URL(req.url).pathname;
      if (pathname.startsWith("/storage/")) return handleStorageBytes(req, pathname);
      return handleProxyRequest(req);
    },
  });
  // Don't keep the process alive for the hub alone (bun test / idle). The main
  // HTTP server already pins the production process.
  server.unref();
  hub = server;
  return server;
}

/**
 * Issue a per-run token against a process-wide loopback hub.
 * `stop()` revokes the token; the listen socket is reused across runs.
 */
export function startRuntimeProxy(): ProxyHandle {
  const server = ensureProxyHub();
  const token = crypto.randomUUID();
  liveTokens.add(token);
  const url = `http://127.0.0.1:${server.port}`;
  return {
    url,
    token,
    env: { AGENTHANDS_URL: url, AGENTHANDS_TOKEN: token },
    stop: () => {
      liveTokens.delete(token);
    },
  };
}

/** Test helper — drop tokens and close the shared hub so bun test can exit. */
export function _stopProxyHubForTests(): void {
  liveTokens.clear();
  if (!hub) return;
  try {
    hub.stop(true);
  } catch {
    /* ignore */
  }
  hub = null;
}
