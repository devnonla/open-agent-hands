# KV

Plain, non-sensitive settings for tools, jobs and sites: base URLs, feature flags, counters, last-run markers.

Every key belongs to one **project**, so different tools, jobs and sites do not clash. The project `default` always exists and cannot be changed or deleted; calls that name no project use it. The same key name can exist once in each project.

- `kv_list_projects` lists projects with their key counts.
- `kv_list(project?)`: one project, or omit to list every key with its `project`.
- `kv_get(key, project?)`, `kv_set(key, value, project?)`, `kv_delete(key, project?)`. Omit `project` for `default`.
- `kv_set` creates the project if it does not exist. `kv_get` and `kv_delete` on a missing project return an error.
- `kv_delete_project(project, confirm=true)` deletes the project and every key in it.
- Keys match `[A-Z][A-Z0-9_]*`, for example `BASE_URL`. Project names match `[a-z0-9][a-z0-9_-]*`, for example `crm` or `daily-report`.
- Values are strings. `kv_set` stringifies non-strings as JSON.
- In code: `agenthands.kv.project("crm").get(KEY, default?)` and `.set(KEY, value)`; plain `agenthands.kv.get(KEY)` uses `default`. See [runtime.md](runtime.md).
- Pick one project per tool, job or site (or per integration they share) and say which one in the code.
- KV values are visible to agents. Never store tokens or passwords here, use [secrets.md](secrets.md).
- People can edit KV values and projects in the UI, so treat a value as input that may have changed.
