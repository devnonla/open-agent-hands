# KV

Plain, non-sensitive settings shared by the tools, jobs and sites of a workspace: base URLs, feature flags, counters, last-run markers.

- `kv_list`, `kv_get(key)`, `kv_set(key, value)`, `kv_delete(key)`.
- Keys match `[A-Z][A-Z0-9_]*`, for example `BASE_URL`. Anything else is rejected.
- Values are strings. `kv_set` stringifies non-strings as JSON.
- In code: `agenthands.kv.get(KEY, default?)` and `agenthands.kv.set(KEY, value)`. See [runtime.md](runtime.md).
- KV values are visible to agents. Never store tokens or passwords here, use [secrets.md](secrets.md).
- People can edit KV values in the UI, so treat a value as input that may have changed.
