# Tools

A tool is one TypeScript module run by Bun. The name, description and input schema are read from the comment header, so the header must be exact.

```ts
// @name Weather Lookup
// @description Current weather for a city
// @param {string} city (required) - City name
// @param {integer} days (optional) - Days ahead
// @param {enum:c|f} unit (optional) - Temperature unit
// @param {string[]} tags (optional) - Free tags
export default async function main(input: { city: string; days?: number; unit?: "c" | "f"; tags?: string[] }) {
  const res = await fetch(`https://wttr.in/${encodeURIComponent(input.city)}?format=j1`);
  return { ok: res.ok, data: await res.json() };
}
```

## Header rules
- Each line starts with `// ` at the very top of the file. The header ends at the first line that is not a comment or blank, so never put code between the header lines.
- `// @name` and `// @description` are both required for `create_tool`. Without them it fails.
- The tool name is `@name` turned into snake_case (`Weather Lookup` becomes `weather_lookup`). It must be unique ("Tool name already exists"). This is the name MCP clients see. To rename a tool, change its `@name` line with `edit_tool_code`.
- `@param {type} name (required|optional) - description`. A param with no `(optional)` is required, and a call missing it fails with "Missing required: ...". A `@param` line in any other shape (for example without `{type}`) makes `create_tool` / `edit_tool_code` fail with "Malformed @param line".
- Types: `string`, `number`, `integer`, `boolean`, `string[]`, `number[]`, `boolean[]`, `object`, `object[]`, `enum:a|b|c`. `enum:` has no spaces.
- Nested fields use dots: `// @param {object} filter (optional) - Filters` then `// @param {string} filter.status (optional) - Status`. For arrays of objects use `items[].sku`.
- Describe every param well. The description is what the calling agent reads.
- The server rewrites the header into this canonical form whenever the tool is saved, so what you wrote can be reformatted.

## The function
- `export default async function main(input)` is required. It receives the params as one object.
- Return any JSON-serializable value. Throw an Error to fail: the caller sees `{ ok: false, error }`.
- Default timeout is 120 seconds per run. Keep a tool short; use a job for long work.
- npm packages are installed automatically from import specifiers. If the npm name differs from the import path, add a trailing comment: `import x from "x/sub" // bun: real-package`.
- For kv, secrets and datatables inside the code, read [runtime.md](runtime.md). Never hardcode a token; read it with `agenthands.secrets.get("API_TOKEN")` and tell the user which secret key to add.

## Icon (optional)
Give a tool an icon so people can spot it in the UI. Pass `icon` to `create_tool` as one inline SVG string, or change it later with `update_tool { tool, icon }`, which only touches the icon; `icon: ""` removes it. Without an icon (or if it cannot be drawn) the UI shows the default Tools icon.

How it is shown:
- As-is, with no background box and no tint. You design everything: shape, colors, background.
- 18px in the list view and 28px in the card view. Draw for 18px: few, bold shapes, no thin hairlines or small text.
- `currentColor` becomes the UI text color (grey, and it follows light/dark mode). Use it for a neutral line icon. For a colored icon, set explicit `fill` / `stroke` colors.

Rules (the call fails with the reason otherwise):
- Starts with `<svg` and ends with `</svg>`, has a `viewBox` (use a square one, `0 0 24 24` or `0 0 48 48`), under 8000 characters.
- Plain SVG elements only: `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `g`, `defs`, `linearGradient`, `radialGradient`, `stop`, `clipPath`, `mask`.
- Not allowed: `<script>`, `<style>` (use attributes instead of CSS classes), `<image>`, `<foreignObject>`, `<iframe>`, `on…=` handlers, `javascript:`, and `href` pointing anywhere but `#id` inside the icon.
- `xmlns` is optional. `id`s are fine and do not clash with other icons on the page.

Neutral line icon (Lucide style):
```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
```

Colored icon with a gradient and its own background:
```svg
<svg viewBox="0 0 48 48"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4e45"/><stop offset="1" stop-color="#c4120b"/></linearGradient></defs><rect x="3" y="9" width="42" height="30" rx="9" fill="url(#bg)"/><path d="M20 17v14l12-7z" fill="#fff"/></svg>
```

Pick an icon that says what the tool does or which service it talks to. Keep one style across related tools (all line icons, or all colored).

## Workflow
1. `list_tools` to avoid duplicates.
2. Save it with `create_tool`, then `run_tool` with a sample `input`. To try a change before saving it, pass the new code as `code` to `run_tool` on the existing tool. `run_tool` really runs the code, so side effects happen. Its `result` is cut at 20000 characters of JSON (`resultTruncated` says so) and `console` keeps the last 4000 characters; a tool with big output should put it in storage and return the key.
3. A failed run returns `{ ok: false, error, console }`. Fix and run again. Only syntax and runtime errors are caught, not type errors.
4. Change saved code with `edit_tool_code`. Read the current code with `get_tool { tools: [...] }` first (it takes several tools at once), since the stored header is normalized.
   - `edits: [{ old_string, new_string, replace_all? }]` replaces exact text, like a file edit. Edits run in order and all or nothing; each `old_string` must match exactly one place (copy it with its indentation) unless `replace_all: true`. A miss or an ambiguous match fails with nothing changed. The result has `replacements` and the new `parameters`.
   - `code` replaces the whole module. Use it for rewrites.
   - The header is re-read on every change, so removing a `@param` line removes that input. The change is live at once on every MCP server that exposes the tool.
5. To call any saved tool, even one created in this session, use `run_tool`. No MCP reconnect is needed. Saved tools are not MCP tools of the session, so never call them by name. `get_tool_schema { tools: [...] }` takes many ids or names at once and returns `{ callWith: "run_tool", tools: [{ tool, description, input }] }`, where `input` is the JSON schema of `run_tool`'s `input`.
6. To use the tool from another MCP client, put it on a hosted server: [mcp-servers.md](mcp-servers.md).
7. `manage_tool_folder` and `move_tool { tools: [...], folder? }` only organize tools. `delete_tool { tools: [...], confirm: true }` deletes several at once and none if any is missing. Tool results show the folder by name (`folder`), and `manage_tool_folder list` lists each folder's tool names.
