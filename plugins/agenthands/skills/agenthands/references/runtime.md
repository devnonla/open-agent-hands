# Runtime SDK

Tools, jobs and site backends can use the workspace's kv, secrets and datatables through one import. All calls are async and scoped to the workspace that owns the tool, job or site.

```ts
import agenthands from "@agenthands/runtime";
```

A failed call throws an `AgenthandsError` with the server's message. Let it propagate, or catch it and return something useful.

## kv
- `agenthands.kv.get(KEY, default?)` returns the string, or `default` (null if omitted) when the key does not exist.
- `agenthands.kv.set(KEY, value)`. `value` must be a string, so stringify objects yourself.
- `agenthands.kv.list()` returns `{ key, value }[]` (first 1000).
- `agenthands.kv.delete(KEY)`.
- Keys match `[A-Z][A-Z0-9_]*`. `get` and `delete` upper-case the key for you.

## secrets
- `agenthands.secrets.get(KEY, default?)` returns the decrypted string or `default`.
- `agenthands.secrets.list()` returns the key names.
- There is no set. Secrets are created with `secret_set` or in the UI. Never log or return a secret value.

## datatable
Project and table are names or ids. See [datatables.md](datatables.md) for column types, errors and the full `where` syntax.
- `agenthands.datatable.list_projects()` returns `{ id, name }[]`.
- `agenthands.datatable.get_schema(project)` returns `{ project, tables: [{ id, name, columns: [{ name, type, options, required }] }] }`.
- `agenthands.datatable.query(project, table, { where?, order_by?, limit?, offset? })` returns `{ items: [{ id, tableId, data, createdAt, updatedAt }], total, limit, offset }`. Column values are under `item.data`. Default limit is 50, maximum 500. Page with `offset`. Default order is newest first.
- `agenthands.datatable.insert(project, table, rows[])` with objects keyed by column name.
- `agenthands.datatable.update(project, table, rowId, data)` changes only the given fields. `rowId` is `item.id` from a query.
- `agenthands.datatable.delete(project, table, rowIds[])`.
- Each of these also accepts one options object: `query({ project, table, where })`, `insert({ project, table, rows })`, `update({ project, table, row_id, data })`, `delete({ project, table, row_ids })`.
