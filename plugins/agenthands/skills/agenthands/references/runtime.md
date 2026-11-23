# Runtime SDK

Tools, jobs and site backends can use kv, secrets, datatables and storage through one import. All calls are async.

```ts
import agenthands from "@agenthands/runtime";
```

A failed call throws an `AgenthandsError` with the server's message. Let it propagate, or catch it and return something useful.

## kv
- `agenthands.kv.get(KEY, default?)` returns the string, or `default` (null if omitted) when the key does not exist.
- `agenthands.kv.set(KEY, value)`. `value` must be a string, so stringify objects yourself.
- `agenthands.kv.list()` returns `{ key, value }[]`.
- `agenthands.kv.delete(KEY)`.
- These read and write the `default` project. For another project use `agenthands.kv.project("crm")`, which has the same `get`, `set`, `list` and `delete`. `set` creates the project if needed; `get` on a project that does not exist returns `default`.

```ts
const crm = agenthands.kv.project("crm");
const since = await crm.get("LAST_SYNC_AT", "1970-01-01");
await crm.set("LAST_SYNC_AT", new Date().toISOString());
```
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

## storage
Files in spaces. See [storage.md](storage.md).
- `agenthands.storage.space(name)` returns a client for one space. `put` creates the space (private) if it does not exist.
- `.put(key, data, { contentType? })` with a string, `Uint8Array`, `ArrayBuffer`, `Blob`, `Bun.file(path)` or `ReadableStream`. Bytes are streamed, so any size works. Replaces a file with the same key. Returns `{ key, size, contentType, updatedAt, publicUrl }`.
- `.get(key)` returns a `Uint8Array`, `.getText(key)` a string, `.getJson(key)` parsed JSON. `.stream(key)` returns a `ReadableStream` for big files. All return `null` when the file or space does not exist.
- `.list(prefix?)` returns `{ key, size, contentType, updatedAt, publicUrl }[]`, up to 1000, sorted by key.
- `.delete(key)` returns `{ deleted }`.
- `agenthands.storage.list_spaces()` returns `{ name, description, public, fileCount, totalBytes }[]`.
- No size limit. `publicUrl` is the file's unguessable full public link when the space is public, else `null`. Code that hands out links needs the space made first with `storage_create_space(public=true)`, because `put` into a missing space makes it private.

```ts
const reports = agenthands.storage.space("reports");
await reports.put(`daily/${date}.csv`, csv, { contentType: "text/csv" });
const last = await reports.getJson("state.json");
```
