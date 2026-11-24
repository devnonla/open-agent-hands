# Storage

Files for tools, jobs and sites: generated reports, exports, images, downloads to keep. Files live in **spaces**; a key is a path inside the space like `reports/2026-11.csv` (`/` makes folders).

- `storage_list_spaces` lists spaces with `fileCount`, `totalBytes` and `public`.
- `storage_create_space(name, description?, public?)`. Names are 2-63 lowercase letters, digits or `-`, for example `reports` or `user-uploads`. Spaces are private unless `public=true`.
- `storage_update_space(space, description?, public?)`. Only make a space public when the user asked: every file in it becomes readable by anyone who has its link. Turning public off stops every link; turning it on again brings back the same links.
- `storage_delete_space(space, confirm=true)` deletes the space and every file in it.
- `storage_list_files(space, prefix?, folders?, limit?, offset?)` lists files sorted by key, default 200, max 1000. Pass `prefix` like `reports/2026/` for one folder. With `folders=true` it lists one level: `folders` (sub-folder prefixes with `fileCount` and `totalBytes`) plus the files directly under `prefix`.
- `storage_upload_link(space, files: [{ key, content_type? }])` is the only way to write files, any size, up to 100 per call. It returns `links: [{ key, uploadUrl }]` (one one-time link per key) and a `command` template. Run curl once per file in your shell; it streams the bytes and prints the saved file as JSON:
  - a file on your disk: `curl -fsS -T '<local path>' '<uploadUrl>'`
  - text you made: `printf '%s' '...' | curl -fsS -T - '<uploadUrl>'`
  - a file on the web: `curl -fsSL '<source url>' | curl -fsS -T - '<uploadUrl>'`
  - The link writes only that space and key, works once and expires in 1 hour; on a 404 ask for a new link. It replaces a file with the same key, and creates the space (private) if it does not exist.
  - The stored type is detected from the bytes, not trusted from the key's extension or `content_type`; those are kept only when the bytes agree (e.g. a `.docx` that is really a zip). When `content_type` does not match, the JSON has a `contentTypeNote`.
- `storage_get_file(space, keys: [...], encoding?)` (encoding is `utf8` or `base64`) returns `{ space, files: [{ key, ..., encoding, content }] }`, at most 256 KB in total per call. Text types come back as utf8, others as base64.
- `storage_download_link(space, keys: [...])` saves files to your disk, any size. It returns `links: [{ key, size, contentType, downloadUrl }]` (one one-time link per key) and a `command`; run `curl -fsS -o '<local path>' '<downloadUrl>'`. Use it for binary files and anything over 256 KB. The link reads only that file, works once and expires in 1 hour.
- `storage_delete_file(space, keys: [...], confirm=true)` deletes files. If any key is missing, nothing is deleted and the error names it.
- There is no size limit; uploads stream to disk. Code writes with a stream or `Bun.file(path)`.
- In a public space each file has its own full link, `publicUrl`: `<public URL>/public/storage/<random token>/<file name>`. The public URL is set in Settings → General; until then it is the local listen address. The token is random per file, so links cannot be guessed from the space or key, and nothing lists them. Search engines are told not to index them. Give the user the `publicUrl` exactly; never build a link from the space and key.
- `storage_reset_public_link(space, key)` gives a file a new link when the old one was shared too widely. The old link stops working at once.
- Private files are only reachable through the tools, code, or the web UI.
- In code: `agenthands.storage.space("reports").put(key, data)`, `.get(key)`, `.getText(key)`, `.getJson(key)`, `.list(prefix?)`, `.delete(key)`. See [runtime.md](runtime.md).
- People can upload, download and delete files and switch a space public in the UI, so a file you wrote may have changed or gone.
- Do not store secrets in files. Use [secrets.md](secrets.md).

