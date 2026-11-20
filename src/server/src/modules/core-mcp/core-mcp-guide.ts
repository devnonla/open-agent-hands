export const CORE_MCP_INSTRUCTIONS = `Agent Hands core server. Manages every workspace: tools, hosted MCP servers, KV, secrets, datatables, sites and jobs.
Every resource tool takes an optional "workspace" argument (workspace id or name). It defaults to "default". Call list_workspaces first when unsure.
Before writing tool, job or site code, call get_guide with the matching topic.`;

const RUNTIME = `## Runtime SDK (tools, jobs, site backends)

import agenthands from "@agenthands/runtime";

All calls are async and scoped to the workspace that owns the tool/job/site.
- agenthands.kv.get(KEY, default?) -> string | default
- agenthands.kv.set(KEY, value: string)
- agenthands.kv.list() -> { key, value }[]
- agenthands.kv.delete(KEY)
  KV keys match [A-Z][A-Z0-9_]*.
- agenthands.secrets.get(KEY, default?) -> decrypted string | default
- agenthands.secrets.list() -> key names
- agenthands.datatable.list_projects()
- agenthands.datatable.get_schema(project)
- agenthands.datatable.query(project, table, { where?, order_by?, limit?, offset?, ids? })
- agenthands.datatable.insert(project, table, rows[])
- agenthands.datatable.update(project, table, rowId, data)
- agenthands.datatable.delete(project, table, rowIds[])
  where: object = AND of fields, array of objects = OR of groups.
  Field value is a literal (equality) or { $eq | $neq | $gt | $gte | $lt | $lte | $in | $nin | $contains | $exists: value }.
  order_by: [{ key: "column", dir: "asc" | "desc" }].`;

const TOOLS = `## Tools

A tool is one TypeScript module run by Bun (inside an OS sandbox only when Settings → Sandbox is on). The header annotations are the source of truth for name, description and input schema:

// @name Weather Lookup
// @description Current weather for a city
// @param {string} city (required) - City name
// @param {number} days (optional) - Days ahead
// @param {string[]} tags (optional) - Free tags
export default async function main(input: { city: string; days?: number; tags?: string[] }) {
  const res = await fetch(\`https://wttr.in/\${encodeURIComponent(input.city)}?format=j1\`);
  return { ok: res.ok, data: await res.json() };
}

- The snake_case tool name comes from @name. It must be unique within the workspace.
- Param types: string, number, boolean, object, string[], number[], enum like "a"|"b".
- Return any JSON-serializable value. Throw to report an error.
- npm packages are installed automatically from import specifiers. If the npm name differs from the import path, add a trailing comment: import x from "x/sub" // bun: real-package
- Use run_tool with "code" to test a draft before saving it with update_tool.
- To expose tools to an MCP client, create a hosted MCP server with create_mcp_server and assign the tools.

${RUNTIME}`;

const JOBS = `## Jobs

A job is a Bun/TypeScript script run on a cron schedule (5-field cron, one expression per line, in the app timezone). An empty cron means manual only.

import agenthands from "@agenthands/runtime";

await agenthands.step("Fetch", async () => {
  const count = Number(await agenthands.kv.get("RUN_COUNT", "0")) + 1;
  await agenthands.kv.set("RUN_COUNT", String(count));
  agenthands.log.info(\`run #\${count}\`);
});

- agenthands.step(name, fn) groups logs. agenthands.log.info / warn / error write run logs. console.log works too.
- run_job starts a run. With wait=true it returns the logs when the run finishes (up to 120s).
- timeout_ms caps a run (default 300000).

${RUNTIME}`;

const SITES = `## Sites

A site is a small React app with a backend, edited as a draft and promoted with approve_site.

Files:
- app.tsx: export default function App() { ... }. Import data helpers from "./site-api.js":
  - loadSiteData(query?) -> the value returned by backend GET
  - siteAction(body) -> POSTs body to the backend and returns its value
- backend.ts:
  export async function handle({ request, params, query, agenthands }) {
    if (request.method === "GET") return { items: await agenthands.datatable.query("crm", "leads", { limit: 20 }) };
    const body = await request.json();
    return { ok: true };
  }
- styles.css: plain CSS, applied to the page automatically.
- package.json is generated from imports. Do not hand-edit dependencies.

Workflow: create_site -> write_site_file (app.tsx, backend.ts, styles.css) -> preview_site (checks the bundle and backend GET) -> approve_site -> publish_site. A published site is served at /public/sites/<slug>, optionally behind a password.

${RUNTIME}`;

export const GUIDES: Record<string, string> = {
  tools: TOOLS,
  jobs: JOBS,
  sites: SITES,
  runtime: RUNTIME,
};

export function getGuide(topic: string): string {
  if (topic === "all") return [TOOLS, JOBS, SITES].join("\n\n");
  return GUIDES[topic] ?? `Unknown topic "${topic}". Use one of: ${[...Object.keys(GUIDES), "all"].join(", ")}`;
}
