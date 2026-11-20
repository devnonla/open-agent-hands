/**
 * TS package injected into each tool sandbox as `import agenthands from "@agenthands/runtime"`.
 * Also written under the legacy "nonlaagents" specifier for back-compat with tools saved before the rename.
 * Talks to the localhost proxy started by tool-runner.
 */

export const TOOLS_RUNTIME_INDEX_TS = `const url = process.env.AGENTHANDS_URL ?? "";
const token = process.env.AGENTHANDS_TOKEN ?? "";

class AgenthandsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgenthandsError";
  }
}

async function rpc(ns: string, action: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!url || !token) throw new AgenthandsError("agenthands runtime is not configured");
  const res = await fetch(\`\${url.replace(/\\/$/, "")}/\`, {
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
    throw new AgenthandsError(\`agenthands RPC failed: HTTP \${res.status}\`);
  }
  if (!data.ok) throw new AgenthandsError(data.error || "agenthands call failed");
  return data.result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function parseProjectTableCall(
  projectOrOpts: unknown,
  tableArg?: unknown,
  optsArg?: unknown,
): { project: string; table: string; opts: Record<string, unknown> } {
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

const agenthands = {
  kv: {
    async get(key: string, defaultValue: unknown = null) {
      const result = await rpc("kv", "get", { key });
      return result ?? defaultValue;
    },
    async set(key: string, value: string) {
      if (typeof value !== "string") throw new AgenthandsError("value must be a string");
      return rpc("kv", "set", { key, value });
    },
    async list() {
      return rpc("kv", "list");
    },
    async delete(key: string) {
      return rpc("kv", "delete", { key });
    },
  },
  secrets: {
    async get(key: string, defaultValue: unknown = null) {
      const result = await rpc("secrets", "get", { key });
      return result ?? defaultValue;
    },
    async list() {
      return rpc("secrets", "list");
    },
  },
  datatable: {
    async list_projects() {
      return rpc("datatable", "list_projects");
    },
    async get_schema(project: string) {
      return rpc("datatable", "get_schema", { project });
    },
    async query(projectOrOpts: unknown, tableArg?: unknown, optsArg?: unknown) {
      const { project, table, opts } = parseProjectTableCall(projectOrOpts, tableArg, optsArg);
      return rpc("datatable", "query", {
        project,
        table,
        where: opts.where,
        order_by: opts.order_by,
        limit: opts.limit ?? 50,
        offset: opts.offset ?? 0,
      });
    },
    async insert(projectOrOpts: unknown, tableArg?: unknown, rowsArg?: unknown) {
      const bag = asRecord(projectOrOpts);
      if (bag && ("project" in bag || "table" in bag)) {
        return rpc("datatable", "insert", {
          project: String(bag.project ?? ""),
          table: String(bag.table ?? ""),
          rows: bag.rows ?? [],
        });
      }
      return rpc("datatable", "insert", {
        project: String(projectOrOpts ?? ""),
        table: String(tableArg ?? ""),
        rows: rowsArg ?? [],
      });
    },
    async update(projectOrOpts: unknown, tableArg?: unknown, rowIdArg?: unknown, dataArg?: unknown) {
      const bag = asRecord(projectOrOpts);
      if (bag && ("project" in bag || "table" in bag)) {
        return rpc("datatable", "update", {
          project: String(bag.project ?? ""),
          table: String(bag.table ?? ""),
          row_id: String(bag.row_id ?? ""),
          data: bag.data ?? {},
        });
      }
      return rpc("datatable", "update", {
        project: String(projectOrOpts ?? ""),
        table: String(tableArg ?? ""),
        row_id: String(rowIdArg ?? ""),
        data: dataArg ?? {},
      });
    },
    async delete(projectOrOpts: unknown, tableArg?: unknown, rowIdsArg?: unknown) {
      const bag = asRecord(projectOrOpts);
      if (bag && ("project" in bag || "table" in bag)) {
        return rpc("datatable", "delete", {
          project: String(bag.project ?? ""),
          table: String(bag.table ?? ""),
          row_ids: bag.row_ids ?? [],
        });
      }
      return rpc("datatable", "delete", {
        project: String(projectOrOpts ?? ""),
        table: String(tableArg ?? ""),
        row_ids: rowIdsArg ?? [],
      });
    },
  },
};

export default agenthands;
`;

export const RUNTIME_PACKAGE_NAMES = ["@agenthands/runtime", "@nonla-agents/runtime", "nonlaagents"] as const;

export function runtimePackageJson(name: string): string {
  return `${JSON.stringify({ name, version: "0.0.0", type: "module", main: "index.ts" }, null, 2)}\n`;
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    if ((await Bun.file(path).text()) === content) return;
  } catch {}
  await Bun.write(path, content);
}

export async function writeRuntimePackages(rootDir: string, indexTs: string) {
  for (const name of RUNTIME_PACKAGE_NAMES) {
    const dir = `${rootDir}/node_modules/${name}`;
    await writeIfChanged(`${dir}/package.json`, runtimePackageJson(name));
    await writeIfChanged(`${dir}/index.ts`, indexTs);
  }
}

export async function writeToolsRuntimePackage(sandboxDir: string) {
  await writeRuntimePackages(sandboxDir, TOOLS_RUNTIME_INDEX_TS);
}
