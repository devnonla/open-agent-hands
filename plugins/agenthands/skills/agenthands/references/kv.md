# KV

Plain, non-sensitive settings for tools, jobs and sites: base URLs, feature flags, counters, last-run markers.

Every key belongs to one **project**, so different tools, jobs and sites do not clash. The project `default` always exists and cannot be changed or deleted; calls that name no project use it. The same key name can exist once in each project.

- `kv_list_projects` lists projects with their key counts.
- `kv_list(project?)`: one project, or omit to list every key with its `project`. Values over 200 characters are cut and carry `valueChars` (the full length); read those with `kv_get`.
- `kv_get(keys: [...], project?)` returns `{ project, values: { KEY: value } }`, with `null` for a key that is not set.
- `kv_set(entries: [{ key, value }], project?)` returns `{ project, saved }`. All keys are checked first, so one bad key writes none.
- `kv_delete(keys: [...], project?, confirm=true)`. If any key is missing, nothing is deleted.
- Each call takes up to 100 keys from one project; omit `project` for `default`. Pass a list even for one key.
- `kv_set` creates the project if it does not exist. `kv_get` and `kv_delete` on a missing project return an error.
- `kv_delete_project(project, confirm=true)` deletes the project and every key in it.
- Keys match `[A-Z][A-Z0-9_]*`, for example `BASE_URL`. Project names match `[a-z0-9][a-z0-9_-]*`, for example `crm` or `daily-report`.
- Values are strings. `kv_set` stringifies non-strings as JSON.
- In code: `agenthands.kv.project("crm").get(KEY, default?)` and `.set(KEY, value)`; plain `agenthands.kv.get(KEY)` uses `default`. See [runtime.md](runtime.md).
- Pick one project per tool, job or site (or per integration they share) and say which one in the code.
- KV values are visible to agents. Never store tokens or passwords here, use [secrets.md](secrets.md).
- People can edit KV values and projects in the UI, so treat a value as input that may have changed.
