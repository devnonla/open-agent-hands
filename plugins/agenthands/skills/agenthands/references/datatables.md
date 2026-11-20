# Datatables

Structured storage. A project holds tables, a table holds typed columns, and rows are objects keyed by column name. Every tool takes project and table by name or id.

## Set up
1. `datatable_list_projects` to see what exists. Reuse a project when one fits.
2. `datatable_create_project(name)`.
3. `datatable_create_table(project, name, columns)` with columns like `{ name: "email", type: "text", required: true }` or `{ name: "status", type: "select", options: ["new", "won"] }`. Column names are used as keys in `where` and rows, so choose short names without spaces (letters, digits, underscore, not starting with a digit).
4. `datatable_add_column(project, table, name, type, options?, required?)` extends a table later.
5. `datatable_get_schema(project)` shows tables and columns. Check it before inserting.

Column types and what a value must be:
- `text`: a string. A number is rejected.
- `number`: a number, or a numeric string.
- `boolean`: `true` or `false` only.
- `datetime`: an ISO 8601 string, for example `2026-11-20T09:00:00Z`.
- `select`: a string that is one of `options`.
- `json`: any JSON value.

Table structure is written by agents. In the UI it is read-only, and people edit rows there.

## Rows
- `datatable_insert_rows(project, table, rows[])`. An unknown column, a missing required column or a wrong type fails the call with a message naming the column. Nothing is guessed.
- `datatable_update_row(project, table, row_id, data)` changes only the fields in `data`. `row_id` comes from a query result's `id`.
- `datatable_delete_rows(project, table, row_ids[])`.
- `datatable_delete_project` removes all tables and rows and needs `confirm=true`. Ask the user first.

## Query
`datatable_query(project, table, { where?, order_by?, limit?, offset? })` returns `{ items: [{ id, data, createdAt, updatedAt }], total, limit, offset }`. `total` counts all matches, so page with `offset` until you have them all.
- Default limit 50, maximum 500. Default order is newest first.
- `order_by: [{ key: "column", dir: "asc" | "desc" }]`. `key` can also be `created_at` or `updated_at`.
- `where`: an object means AND of fields. An array of objects means OR of those groups. A field value is a literal (equality) or an operator object:
  - `$eq`, `$neq` (also matches empty values), `$gt`, `$gte`, `$lt`, `$lte`
  - `$in`, `$nin` (non-empty array)
  - `$contains`: case-insensitive substring for text, array membership for a `json` column holding an array
  - `$exists`: true or false

```json
{ "where": [{ "status": "new", "score": { "$gte": 50 } }, { "owner": { "$in": ["ann", "bo"] } }], "order_by": [{ "key": "score", "dir": "desc" }], "limit": 20 }
```

- An unknown column in `where` or `order_by` is an error, not an empty result.
- Datatables are also reachable from tool, job and site code through `agenthands.datatable`, see [runtime.md](runtime.md).
