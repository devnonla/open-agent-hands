# Datatables

Structured storage. A project holds tables, a table holds typed columns, and rows are objects keyed by column name. Every tool takes project and table by name or id.

## Set up
1. `datatable_list_projects` lists `{ id, name, tables }` with table names, to see what exists. Reuse a project when one fits.
2. `datatable_create_project(name)`.
3. `datatable_create_table(project, name, columns)` with columns like `{ name: "email", type: "text", required: true }` or `{ name: "status", type: "select", options: ["new", "won"] }`. Column names are used as keys in `where` and rows, so choose short names without spaces (letters, digits, underscore, not starting with a digit). All columns are checked first; one bad column creates no table.
4. `datatable_add_columns(project, table, columns: [...])` adds columns later, in the same shape as `datatable_create_table`. All are checked first; one bad column adds none.
5. `datatable_get_schema(project)` returns `{ project, tables: [{ name, columns: [{ name, type, options?, required? }] }] }`; `options` appears for select columns and `required` only when true. `datatable_create_table` returns the same shape. Check it before inserting.

Column types and what a value must be:
- `text`: a string. A number is rejected.
- `number`: a number, or a numeric string.
- `boolean`: `true` or `false` only.
- `datetime`: an ISO 8601 string, for example `2026-11-20T09:00:00Z`.
- `select`: a string that is one of `options`.
- `json`: any JSON value.

Table structure is written by agents. In the UI it is read-only, and people edit rows there.

## Rows
- `datatable_insert_rows(project, table, rows[])` takes up to 200 rows and returns `{ inserted, ids }`, the new ids in order. Every row is checked first, so one bad row inserts none and the error names it (`rows[3]: ...`). An unknown column, a missing required column or a wrong type fails the call with a message naming the column. Nothing is guessed.
- `datatable_update_rows(project, table, rows: [{ id, data }])` changes only the fields in each `data`, up to 200 rows. Every row is checked first, so one bad row changes nothing. Ids come from a query result's `id`. Returns `{ updated, ids }`.
- `datatable_delete_rows(project, table, row_ids[])`.
- `datatable_delete_project` removes all tables and rows and needs `confirm=true`. Ask the user first.

## Query
`datatable_query(project, table, { where?, order_by?, limit?, offset? })` returns `{ total, limit, offset, items: [{ id, data }] }`. The default limit is 50 and the most is 500. `total` counts all matches, so page with `offset` until you have them all.
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
