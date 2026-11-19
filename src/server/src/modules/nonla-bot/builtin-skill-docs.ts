export function fence(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body.trim()}\n\`\`\``;
}

export const SDK_DOC = `Workspace SDK for code that reads or writes workspace data: kv, secrets, datatables and agents.

# Where the code runs
**Custom tool and job script.** Import it, and \`await\` every call:

${fence("ts", 'import nonlaagents from "@nonla-agents/runtime";')}

**Site \`backend.ts\`.** \`handle({ request, nonlaagents, query, params })\` receives \`nonlaagents\`. Don't import the package. Prefer the object form, such as \`query({ project, table, where })\`.

# Rules
- Find real project and table names with \`nonla_datatable\` (\`list_projects\`, \`get_schema\`).
- Never invent a key, secret, project, table, column or agent id. Use the ones the caller gave.
- Don't use \`ctx.kv\`, \`ctx.secrets\` or \`ctx.datatable\`.

# kv
Values are strings. Keys are UPPER_SNAKE_CASE, such as \`BASE_URL\`. Prefer secrets for credentials.

${fence(
  "ts",
  `await nonlaagents.kv.get(key, default?)   // value, or default
await nonlaagents.kv.set(key, value)      // value must be a string
await nonlaagents.kv.list()               // [{ key, value }, ...]
await nonlaagents.kv.delete(key)`,
)}

# secrets
Read-only from code.

${fence(
  "ts",
  `await nonlaagents.secrets.get(key, default?)   // value, or default
await nonlaagents.secrets.list()               // key names only, no values`,
)}

# datatable
\`project\` and \`table\` accept an id (preferred) or a name. Discover with \`list_projects\`, then \`get_schema\`, before you insert or update.

${fence(
  "ts",
  `await nonlaagents.datatable.list_projects()                       // [{ id, name }]
await nonlaagents.datatable.get_schema(project)                   // { tables: [{ id, name, columns: [{ name, type, options, required }] }] }
await nonlaagents.datatable.query(project, table, { where, order_by, limit, offset })
                                                                  // { items: [{ id, data, createdAt, updatedAt }], total }
await nonlaagents.datatable.insert(project, table, rows)          // rows: [{ column: value }]
await nonlaagents.datatable.update(project, table, row_id, data)  // data: partial { column: value }
await nonlaagents.datatable.delete(project, table, row_ids)       // row_ids: string[]`,
)}

Sites use the object form: \`query({ project, table, where, order_by, limit, offset })\`.

\`where\`: an object is AND, an array of objects is OR. There is no \`$or\` key. Operators: \`$eq\`, \`$neq\`, \`$gt\`, \`$gte\`, \`$lt\`, \`$lte\`, \`$in\`, \`$nin\`, \`$contains\`, \`$exists\`.

${fence(
  "ts",
  `{ status: "active", age: { $gte: 18 } }
[{ status: "active" }, { age: { $lt: 18 } }]`,
)}

\`order_by\` is a list of \`{ key, dir }\`. Pass it when sort matters. \`key\` is a schema column, \`created_at\` or \`updated_at\`. The param is \`order_by\`, not \`orderBy\`.

\`query\` returns \`items[]\`. Each item has \`.id\`, and the column values live under \`.data\`. Don't read \`result.rows\`. Only sites alias \`rows\` to \`items\`.

# agents
Job scripts only. Runs another agent and returns its final reply as a string.

${fence("ts", 'const reply = await nonlaagents.agents(agentId).run("Summarize today\'s leads");')}`;

const SHARED_CODE_RULES = `- No markdown fences in the edit tool. Never paste placeholders like \`[omitted]\`.
- Packages install from import specifiers.`;

const PACKAGES_DOC = `# Packages
If the npm name differs from the import path, add a trailing comment:

${fence("ts", 'import x from "x" // bun: actual-package')}`;

export const TOOL_CODE_RULES_DOC = `# Rules
- The source is one TypeScript module. It starts with \`// @name\`, \`// @description\` and \`// @param\` lines, then \`export default async function main(input)\`. Keep those lines. Update them in the same edit when the name, description or inputs change.
- \`input\` is a plain object. Read it as \`input.key ?? default\`.
- Always return a value. \`console.log\` is for debugging only. Don't call \`process.exit()\`.
- Use \`await\` on every fetch. Prefer global \`fetch\` for HTTP.
${SHARED_CODE_RULES}

# Param lines
One line per input, in this format:

${fence("ts", "// @param {type} name (required|optional) - description")}

Types: \`string\`, \`number\`, \`boolean\`, \`integer\`, \`string[]\`, \`number[]\`, \`boolean[]\`, \`object\`, \`object[]\`, \`enum:a|b|c\`. Nested fields use dots, like \`filters.category\`. Array items use \`[]\`, like \`items[].name\`.

${PACKAGES_DOC}

# Example
${fence(
  "ts",
  `// @name word_count
// @description Count the words in a text.
// @param {string} text (required) - The text to count.

export default async function main(input: { text?: string }) {
  const words = (input.text ?? "").trim().split(/\\s+/).filter(Boolean);
  return { words: words.length };
}`,
)}`;

export const SITE_CODE_RULES_DOC = `# Rules
- Files: \`app.tsx\` (\`export default function App\`), \`styles.css\`, and \`backend.ts\`.
- Client data goes through \`loadSiteData\` / \`siteAction\` from \`./site-api.js\`. Don't invent other API hosts.
- Put presentation in \`styles.css\`. Use \`className\` in \`app.tsx\`.
${SHARED_CODE_RULES}

# backend.ts
It exports the handler:

${fence("ts", "export async function handle({ request, nonlaagents, query, params }) { ... }")}

${PACKAGES_DOC}`;

export const JOB_CODE_RULES_DOC = `# Rules
- The source is one TypeScript job script. Keep the platform entrypoints the starter already uses.
${SHARED_CODE_RULES}

# Run timeline
Wrap each meaningful unit of work (fetch, parse, write, call an agent) in \`nonlaagents.step\`. Log details with \`nonlaagents.log\`. \`console.log\` still appears as unstructured output, so don't rely on it for the timeline.

${fence(
  "ts",
  `await nonlaagents.step("Fetch stories", async () => {
  nonlaagents.log.info("optional detail");
  // nonlaagents.log.warn(...) and nonlaagents.log.error(...) also exist
});`,
)}

${PACKAGES_DOC}`;
