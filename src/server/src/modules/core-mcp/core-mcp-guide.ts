export const CORE_MCP_INSTRUCTIONS = `Agent Hands core server. Manages tools, hosted MCP servers, KV, secrets, datatables, storage, sites and jobs.
Before writing tool, job or site code, call get_guide with the matching topic.`;

const RUNTIME = `## Runtime SDK (tools, jobs, site backends)

import agenthands from "@agenthands/runtime";

All calls are async.
- agenthands.kv.get(KEY, default?) -> string | default
- agenthands.kv.set(KEY, value: string)
- agenthands.kv.list() -> { key, value }[]
- agenthands.kv.delete(KEY)
- agenthands.kv.project(name) -> the same get/set/list/delete, scoped to one KV project. set creates the project if it does not exist; get on a missing project returns the default.
  Every key belongs to one project. Plain agenthands.kv.* uses the project named "default", which always exists and cannot be deleted. Give each tool, job or site its own project so keys do not clash.
  KV keys match [A-Z][A-Z0-9_]*. Project names match [a-z0-9][a-z0-9_-]*.
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
  order_by: [{ key: "column", dir: "asc" | "desc" }].
- agenthands.storage.space(name) -> files in one storage space:
  - put(key, data: string | Uint8Array | ArrayBuffer | Blob | ReadableStream, { contentType? }) -> { key, size, contentType, updatedAt, publicUrl }. Creates the space (private) if missing and replaces a file with the same key. contentType is detected from the bytes; the one you pass (or the key's extension) is kept only when the bytes agree.
  - get(key) -> Uint8Array | null; getText(key) -> string | null; getJson(key) -> parsed JSON | null; stream(key) -> ReadableStream | null
  - list(prefix?) -> { key, size, contentType, updatedAt, publicUrl }[] (up to 1000, sorted by key)
  - delete(key) -> { deleted: boolean }
- agenthands.storage.list_spaces()
  Keys are paths like "reports/2026-11.csv". There is no size limit: bodies stream to disk, so pass Bun.file(path) or a ReadableStream for big files and read them back with stream(key). publicUrl is the file's own unguessable full link (<public URL>/public/storage/<random token>/<file name>, where the public URL is set in Settings → General) when the space is public, else null. A tool that hands out links needs the space made first with storage_create_space(public=true), since put into a missing space makes it private. Always hand out publicUrl as is; never build a link from space and key.`;

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

- The snake_case tool name comes from @name. It must be unique.
- Param types: string, number, integer, boolean, object, string[], number[], boolean[], object[], enum:a|b (no quotes, no spaces).
- Return any JSON-serializable value. Throw to report an error.
- npm packages are installed automatically from import specifiers. If the npm name differs from the import path, add a trailing comment: import x from "x/sub" // bun: real-package
- Change saved code with edit_tool_code: edits [{ old_string, new_string, replace_all? }] for exact-text replacements (in order, all or nothing; read the code with get_tool { tools } first), or code for a full rewrite. Test a draft first with run_tool { code }.
- run_tool calls any saved tool by name right away, including one created in this session; no MCP reconnect is needed. Saved tools are not MCP tools of this session, so never call them by name. Read the input schemas first with get_tool_schema, which takes many tools at once.
- Optional icon: pass "icon" to create_tool, or change it later with update_tool { tool, icon } (icon="" removes it). It is shown as-is, no background or tint, at 18px in lists and 28px in cards, so use few bold shapes. currentColor becomes the grey UI text color; set explicit fill/stroke colors for a colored icon. Needs a square viewBox, under 8000 characters, plain SVG elements only (gradients, clipPath and mask are fine; no <script>, <style>, <image>, <foreignObject>, on* handlers or external href). Without a valid icon the UI shows the default Tools icon.
- To expose tools to an MCP client, create a hosted MCP server with create_mcp_server and assign the tools.

${RUNTIME}`;

const JOBS = `## Jobs

A job is a Bun/TypeScript script run on a cron schedule (5-field cron, one expression per line, in the app timezone). An empty cron means manual only. The script runs top to bottom; there is no handler to export.

Name the job with a readable title in plain words, e.g. "Sync GitHub issues" or "Daily sales report", not "sync-github-issues". Put what it does and why in description, one short sentence. People read both in the jobs list.

import agenthands from "@agenthands/runtime";

const since = agenthands.run.lastSuccessAt ?? "2026-01-01T00:00:00Z";
const issues = await agenthands.step("Fetch", () => fetchIssues(since), { retries: 3 });
await agenthands.step("Save", () => agenthands.datatable.insert("crm", "issues", issues));
agenthands.log.info("synced", { count: issues.length });
agenthands.output({ synced: issues.length });

Steps and logs
- agenthands.step(name, fn, { retries?, backoffMs? }) runs fn, returns its value and shows as one bar in the run trace. retries re-runs only that step (0-10, waits backoffMs × 2^n, default 1000ms). An error that escapes ends the run as failed.
- agenthands.log.info / warn / error(message, data?) write run logs. data is any JSON and shows next to the line. console.log works too.
- Keep steps coarse (fetch, transform, save). Do not wrap every call.

Run context: agenthands.run
- id, jobId, jobName, trigger ("cron" | "manual"), attempt, maxAttempts
- scheduledFor: the planned cron time (ISO) for scheduled runs, else null
- lastSuccessAt: when the last successful run finished (ISO) or null. Use it to fetch only new data.
- input: the JSON passed to run_job input, else null

Output
- agenthands.output(value) records a JSON result (up to 256KB) on the run. The last call wins. run_job wait=true and get_job_runs return it. Store large data in a datatable and output a summary.

Running and limits
- run_job starts a run now, optionally with input. With wait=true it returns status, output, error and the last 50 log lines when the run finishes (up to 120s).
- get_job_runs lists runs without logs; pass run=<id> for one run with its logs, and log_offset / log_limit to page.
- timeout_ms caps one attempt (default 300000).
- clear_job_runs (confirm=true) deletes the finished run history. Only when the user asks.
- max_retries (0-5) re-runs the whole script when it fails or times out, waiting 5s, 10s, 20s… Each attempt sees agenthands.run.attempt. Use it only when the script is safe to run twice; otherwise retry inside a step.
- A job never overlaps itself: a scheduled run is skipped while the previous one is active. Up to 3 runs execute at once; the rest wait with status queued.
- The schedule is set only by agents through cron. People can pause a job in the UI. A paused job keeps its cron and stays paused when you change the cron; pass enabled=true to resume it, and only when the user asked.
- create_job, update_job, list_jobs and get_job return status (scheduled, paused or manual) and nextRuns (the next 3 run times, ISO) so you can confirm the cron does what you meant.

${RUNTIME}`;

const SITES = `## Sites

A site is a small React app with a backend. There is no draft or review step: edit_site_file changes the live site at once.

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

Workflow: create_site -> get_site_files -> edit_site_file (app.tsx, backend.ts, styles.css; edits for exact-text replacements, content for a whole file) -> preview_site (checks the bundle and backend GET; fix any error right away, since visitors already see the change) -> publish_site. A published site is served at /public/sites/<slug>, optionally behind a password; create_site and publish_site return its full url.

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
