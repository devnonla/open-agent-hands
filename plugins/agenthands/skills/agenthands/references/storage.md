# Storage

Files for tools, jobs and sites: generated reports, exports, images, downloads to keep. Files live in **spaces**; a key is a path inside the space like `reports/2026-11.csv` (`/` makes folders).

- `storage_list_spaces` lists spaces with `fileCount`, `totalBytes` and `public`.
- `storage_create_space(name, description?, public?)`. Names are 2-63 lowercase letters, digits or `-`, for example `reports` or `user-uploads`. Spaces are private unless `public=true`.
- `storage_update_space(space, description?, public?)`. Only make a space public when the user asked: every file in it becomes readable by anyone who has its link. Turning public off stops every link; turning it on again brings back the same links.
- `storage_delete_space(space, confirm=true)` deletes the space and every file in it.
- `storage_list_files(space, prefix?, folders?, limit?, offset?)` lists files sorted by key. Pass `prefix` like `reports/2026/` for one folder. With `folders=true` it lists one level: `folders` (sub-folder prefixes with `fileCount` and `totalBytes`) plus the files directly under `prefix`.
- `storage_put_file(space, key, content | url, encoding?, content_type?)` writes a file and replaces one with the same key.
  - `content` is utf8 text by default; send binary as base64 with `encoding="base64"`.
  - `url` (http/https) makes the server stream the file to disk instead, any size. Use it for anything large or binary; big downloads take a while.
  - The space is created (private) if it does not exist. `content_type` is guessed from the key's extension when omitted.
- `storage_get_file(space, key, encoding?)` returns the file with `content`. Text types come back as utf8, others as base64. Files over 5 MB are refused; read them in code.
- `storage_delete_file(space, key)`.
- There is no size limit; uploads stream to disk. For big files use `url` here, or write them from code with a stream or `Bun.file(path)`.
- In a public space each file has its own full link, `publicUrl`: `<public URL>/public/storage/<random token>/<file name>`. The public URL is set in Settings → General; until then it is the local listen address. The token is random per file, so links cannot be guessed from the space or key, and nothing lists them. Search engines are told not to index them. Give the user the `publicUrl` exactly; never build a link from the space and key.
- `storage_reset_public_link(space, key)` gives a file a new link when the old one was shared too widely. The old link stops working at once.
- Private files are only reachable through the tools, code, or the web UI.
- In code: `agenthands.storage.space("reports").put(key, data)`, `.get(key)`, `.getText(key)`, `.getJson(key)`, `.list(prefix?)`, `.delete(key)`. See [runtime.md](runtime.md).
- People can upload, download and delete files and switch a space public in the UI, so a file you wrote may have changed or gone.
- Do not store secrets in files. Use [secrets.md](secrets.md).

