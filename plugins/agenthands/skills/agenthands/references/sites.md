# Sites

A site is a small React app with a backend. You edit a draft, check it with `preview_site`, promote it with `approve_site`, then publish it.

## Files
`create_site(name, slug)` creates starter files. Read them with `get_site_files` and change them, rather than starting from nothing. The slug is lowercase letters, digits and hyphens, up to 80 characters, and globally unique. The site is served at `/public/sites/<slug>`.

- `app.tsx`: `export default function App()`. React is available. Import data helpers from `"./site-api.js"`:
  - `loadSiteData(query?)` calls the backend GET and returns its value. `query` is an object that becomes query-string params.
  - `siteAction(body)` POSTs `body` (an object or `FormData`) to the backend and returns its value.
  - Both throw an Error with the backend's message when the call fails, so show it.
- `backend.ts`: runs on the server in a subprocess.

```ts
export async function handle({ request, params, query, agenthands }) {
  if (request.method === "GET") {
    const rows = await agenthands.datatable.query("crm", "leads", { limit: 20 });
    return { leads: rows.items.map((r) => ({ id: r.id, ...r.data })) };
  }
  const body = await request.json();
  await agenthands.datatable.insert("crm", "leads", [{ name: body.name }]);
  return { ok: true };
}
```

- Return plain JSON. A returned `Response` is not sent as-is, so don't use one. Throw an Error to send a failure: the page sees "handle(GET) failed: ..." or "handle(POST) failed: ...".
- `agenthands` gives kv, secrets and datatables, see [runtime.md](runtime.md). Anyone who can open a published site can trigger the backend, so validate input and never return secret values.
- `styles.css`: plain CSS, applied automatically.
- `package.json` is generated from imports. Do not edit dependencies by hand. npm imports are installed automatically.

## Workflow
1. `create_site`, then `get_site_files`.
2. `write_site_file` for each of `app.tsx`, `backend.ts`, `styles.css`. Each call writes the full file.
3. `preview_site` bundles the draft and runs the backend GET. It returns the data or the build error. Fix errors and preview again. It does not exercise POST actions, so reason through those carefully.
4. `approve_site` copies the draft to production. Until then visitors see the old version. `get_site_files tree=prod` shows what is live.
5. `publish_site(site, published=true, password?)` makes it public. A password asks visitors to enter it. `password=""` removes it. `published=false` takes the site down.
6. Tell the user the URL.

Everything you write is read-only for people in the UI, who can only watch and unpublish.
