/**
 * HTTP runtime client for the site backend worker process.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

/** Accept query({ project, table, ... }) or query(project, table, opts). */
function parseProjectTableCall(projectOrOpts: unknown, tableArg?: unknown, optsArg?: unknown): { project: string; table: string; opts: Record<string, unknown> } {
  const bag = asRecord(projectOrOpts);
  if (bag && ("project" in bag || "table" in bag)) {
    return {
      project: String(bag.project ?? "").trim(),
      table: String(bag.table ?? "").trim(),
      opts: bag,
    };
  }
  return {
    project: String(projectOrOpts ?? "").trim(),
    table: String(tableArg ?? "").trim(),
    opts: asRecord(optsArg) ?? {},
  };
}

async function rpc(ns: string, action: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const url = process.env.AGENTHANDS_URL ?? "";
  const token = process.env.AGENTHANDS_TOKEN ?? "";
  if (!url || !token) throw new Error("agenthands runtime is not configured");

  const res = await fetch(`${url.replace(/\/$/, "")}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agenthands-Token": token,
    },
    body: JSON.stringify({ ns, action, args }),
  });

  let data: { ok?: boolean; result?: unknown; error?: string };
  try {
    data = (await res.json()) as { ok?: boolean; result?: unknown; error?: string };
  } catch {
    throw new Error(`agenthands RPC failed: HTTP ${res.status}`);
  }
  if (!data.ok) throw new Error(data.error || "agenthands call failed");
  return data.result;
}

type StorageData = string | Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>;

function storageUrl(space: string, key: string): string {
  const base = (process.env.AGENTHANDS_URL ?? "").replace(/\/$/, "");
  if (!base || !process.env.AGENTHANDS_TOKEN) throw new Error("agenthands runtime is not configured");
  return base + "/storage/" + encodeURIComponent(space) + "/" + String(key).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

async function storageFailure(res: Response): Promise<never> {
  let message = "storage call failed: HTTP " + res.status;
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) message = data.error;
  } catch {}
  throw new Error(message);
}

function storageSpace(name: string) {
  if (typeof name !== "string" || !name.trim()) throw new Error("storage.space(name) needs a space name");
  const space = name.trim();
  const auth = () => ({ "X-Agenthands-Token": process.env.AGENTHANDS_TOKEN ?? "" });
  async function get(key: string): Promise<Uint8Array | null> {
    const res = await fetch(storageUrl(space, key), { headers: auth() });
    if (res.status === 404) return null;
    if (!res.ok) await storageFailure(res);
    return new Uint8Array(await res.arrayBuffer());
  }
  async function getText(key: string): Promise<string | null> {
    const bytes = await get(key);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }
  return {
    async put(key: string, data: StorageData, opts: { contentType?: string } = {}) {
      const headers: Record<string, string> = { ...auth() };
      if (opts.contentType) headers["Content-Type"] = opts.contentType;
      const res = await fetch(storageUrl(space, key), { method: "PUT", headers, body: data as BodyInit });
      if (!res.ok) await storageFailure(res);
      return ((await res.json()) as { result: unknown }).result;
    },
    get,
    getText,
    async getJson(key: string): Promise<unknown> {
      const text = await getText(key);
      return text === null ? null : JSON.parse(text);
    },
    async stream(key: string): Promise<ReadableStream<Uint8Array> | null> {
      const res = await fetch(storageUrl(space, key), { headers: auth() });
      if (res.status === 404) return null;
      if (!res.ok) await storageFailure(res);
      return res.body;
    },
    async list(prefix?: string) {
      return rpc("storage", "list", { space, prefix });
    },
    async delete(key: string) {
      return rpc("storage", "delete", { space, key });
    },
  };
}

function kvClient(project?: string) {
  return {
    async get(key: string, defaultValue: unknown = null) {
      const result = await rpc("kv", "get", { key, project });
      return result ?? defaultValue;
    },
    async set(key: string, value: string) {
      if (typeof value !== "string") throw new Error("value must be a string");
      return rpc("kv", "set", { key, value, project });
    },
    async list() {
      return rpc("kv", "list", { project });
    },
    async delete(key: string) {
      return rpc("kv", "delete", { key, project });
    },
  };
}

export function createSiteRuntimeHttpClient() {
  return {
    kv: {
      ...kvClient(),
      project(name: string) {
        if (typeof name !== "string" || !name.trim()) throw new Error("kv.project(name) needs a project name");
        return kvClient(name.trim());
      },
    },
    storage: {
      space: storageSpace,
      async list_spaces() {
        return rpc("storage", "list_spaces");
      },
    },
    secrets: {
      async get(key: string) {
        return rpc("secrets", "get", { key });
      },
      async list() {
        return rpc("secrets", "list");
      },
    },
    datatable: {
      async list_projects() {
        return rpc("datatable", "list_projects");
      },
      async get_schema(projectRef: string | { project?: string }) {
        const ref = typeof projectRef === "object" && projectRef ? String(projectRef.project ?? "").trim() : String(projectRef ?? "").trim();
        return rpc("datatable", "get_schema", { project: ref });
      },
      async query(projectOrOpts: unknown, table?: unknown, opts?: unknown) {
        const { project, table: tableRef, opts: o } = parseProjectTableCall(projectOrOpts, table, opts);
        if (!project || !tableRef) throw new Error("'project' and 'table' are required (id or name)");
        const result = (await rpc("datatable", "query", {
          project,
          table: tableRef,
          where: o.where,
          order_by: o.order_by,
          limit: typeof o.limit === "number" ? o.limit : undefined,
          offset: typeof o.offset === "number" ? o.offset : undefined,
        })) as Record<string, unknown>;
        return { ...result, rows: result.items };
      },
      async insert(projectOrOpts: unknown, table?: unknown, rows?: unknown) {
        const bag = asRecord(projectOrOpts);
        if (bag && ("project" in bag || "table" in bag)) {
          const project = String(bag.project ?? "").trim();
          const tableRef = String(bag.table ?? "").trim();
          if (!project || !tableRef) throw new Error("'project' and 'table' are required (id or name)");
          return rpc("datatable", "insert", { project, table: tableRef, rows: (bag.rows as Record<string, unknown>[]) ?? [] });
        }
        const project = String(projectOrOpts ?? "").trim();
        const tableRef = String(table ?? "").trim();
        if (!project || !tableRef) throw new Error("'project' and 'table' are required (id or name)");
        return rpc("datatable", "insert", { project, table: tableRef, rows: (rows as Record<string, unknown>[]) ?? [] });
      },
      async update(projectOrOpts: unknown, table?: unknown, rowId?: unknown, data?: unknown) {
        const bag = asRecord(projectOrOpts);
        if (bag && ("project" in bag || "table" in bag)) {
          const project = String(bag.project ?? "").trim();
          const tableRef = String(bag.table ?? "").trim();
          const id = String(bag.row_id ?? bag.rowId ?? "").trim();
          if (!project || !tableRef || !id) throw new Error("'project', 'table', and 'row_id' are required");
          return rpc("datatable", "update", { project, table: tableRef, row_id: id, data: (bag.data as Record<string, unknown>) ?? {} });
        }
        const project = String(projectOrOpts ?? "").trim();
        const tableRef = String(table ?? "").trim();
        const id = String(rowId ?? "").trim();
        if (!project || !tableRef || !id) throw new Error("'project', 'table', and 'row_id' are required");
        return rpc("datatable", "update", { project, table: tableRef, row_id: id, data: (data as Record<string, unknown>) ?? {} });
      },
      async delete(projectOrOpts: unknown, table?: unknown, rowIds?: unknown) {
        const bag = asRecord(projectOrOpts);
        if (bag && ("project" in bag || "table" in bag)) {
          const project = String(bag.project ?? "").trim();
          const tableRef = String(bag.table ?? "").trim();
          if (!project || !tableRef) throw new Error("'project' and 'table' are required (id or name)");
          return rpc("datatable", "delete", {
            project,
            table: tableRef,
            row_ids: (bag.row_ids as string[]) ?? (bag.rowIds as string[]) ?? [],
          });
        }
        const project = String(projectOrOpts ?? "").trim();
        const tableRef = String(table ?? "").trim();
        if (!project || !tableRef) throw new Error("'project' and 'table' are required (id or name)");
        return rpc("datatable", "delete", { project, table: tableRef, row_ids: (rowIds as string[]) ?? [] });
      },
    },
  };
}

export type SiteRuntimeHttp = ReturnType<typeof createSiteRuntimeHttpClient>;
