import type { ApiKey, ApiKeyDetail } from "src/common/types";

type ApiKeyScopeNames = { datatables: string[]; kvKeys: string[] };

export function hasApiKeyAccess(key: ApiKey): boolean {
  return key.datatablesUnrestricted || key.datatableProjectIds.length > 0 || key.kvUnrestricted || key.kvEntryIds.length > 0;
}

export function scopeNames(key: ApiKeyDetail): ApiKeyScopeNames {
  return {
    datatables: key.datatableProjects.map((p) => p.name),
    kvKeys: key.kvEntries.map((e) => (e.projectName === "default" ? e.key : `${e.key} (project ${e.projectName})`)),
  };
}

const MAX_LISTED = 50;

function listed(names: string[]): string {
  const shown = names.slice(0, MAX_LISTED).join(", ");
  return names.length > MAX_LISTED ? `${shown} and ${names.length - MAX_LISTED} more` : shown;
}

function datatablesSection(key: ApiKey, names: string[]): string | null {
  if (!key.datatablesUnrestricted && names.length === 0) return null;
  return `Datatables (${key.datatablesUnrestricted ? "every project" : `projects: ${listed(names)}`}). :project and :table take a name or an id.
- GET /datatables: the projects you can reach.
- GET /datatables/:project/schema: tables and columns. Call this before writing rows.
- POST /datatables/:project/tables/:table/query with {"where":{"status":"new","score":{"$gte":50}},"order_by":[{"key":"score","dir":"desc"}],"limit":50}. Returns { total, limit, offset, items: [{ id, data }] }. where: an object is AND, an array of objects is OR. Operators: $eq $neq $gt $gte $lt $lte $in $nin $contains $exists. limit is at most 500; page with offset.
- POST /datatables/:project/tables/:table/rows with {"rows":[{...}]}: insert rows.
- PUT /datatables/:project/tables/:table/rows/:rowId with {"data":{...}}: update the given fields.
- DELETE /datatables/:project/tables/:table/rows with {"rowIds":["..."]}: delete rows.`;
}

function kvSection(key: ApiKey, names: string[]): string | null {
  if (!key.kvUnrestricted && names.length === 0) return null;
  const put = key.kvUnrestricted ? 'PUT /kv/:key with {"value":"...","description":"optional"}: set a value, creating the key if needed.' : 'PUT /kv/:key with {"value":"..."}: change a key listed above. This API key cannot create new keys.';
  return `KV (${key.kvUnrestricted ? "every key" : `keys: ${listed(names)}`}). Calls use the default project; add ?project=<name> for another one.
- GET /kv: the keys you can reach, with values.
- GET /kv/:key: one value.
- ${put}
- DELETE /kv/:key: delete a key.`;
}

export function apiKeyPrompt(base: string, key: ApiKey, names: ApiKeyScopeNames, secret?: string): string {
  const datatables = datatablesSection(key, names.datatables);
  const kv = kvSection(key, names.kvKeys);
  const auth = secret ? `Authorization: Bearer ${secret}` : `Authorization: Bearer <key>. Ask me for the key; it starts with ${key.keyPrefix}.`;
  return `Use my Agent Hands HTTP API with the API key "${key.name}".

Base URL: ${base}
Header: ${auth}
Bodies and responses are JSON. Errors return a non-2xx status with { code, message }. Anything outside this key's access returns 403.

${[datatables, kv].filter(Boolean).join("\n\n")}

Example:
curl -fsS "${base}${datatables ? "/datatables" : "/kv"}" -H "Authorization: Bearer $AGENTHANDS_API_KEY"

The key works like a password. Keep it in an environment variable such as AGENTHANDS_API_KEY, never in code or chat, and don't repeat it back to me.`;
}
