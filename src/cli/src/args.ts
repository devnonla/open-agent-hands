import { CliError } from "./config.js";

type JsonSchema = { type?: string | string[]; items?: JsonSchema; properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[]; description?: string };

export type ToolSchema = { properties?: Record<string, JsonSchema>; required?: string[] };

export type ReadText = (path: string) => Promise<string>;

function types(schema: JsonSchema): string[] {
  if (Array.isArray(schema.type)) return schema.type;
  return schema.type ? [schema.type] : [];
}

function isKeyValueList(schema: JsonSchema): boolean {
  const req = schema.items?.required ?? [];
  return types(schema).includes("array") && types(schema.items ?? {}).includes("object") && req.includes("key") && req.includes("value");
}

function parseJson(raw: string, flag: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CliError(`--${flag} expects JSON (${err instanceof Error ? err.message : String(err)}). Quote it, e.g. --${flag} '{"a":1}'`);
  }
}

function coerceScalar(raw: string, schema: JsonSchema, flag: string): unknown {
  const t = types(schema);
  if (t.includes("number") || t.includes("integer")) {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) throw new CliError(`--${flag} expects a number, got "${raw}"`);
    return n;
  }
  if (t.includes("boolean")) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new CliError(`--${flag} expects true or false, got "${raw}"`);
  }
  if (t.includes("object") && !t.includes("string")) return parseJson(raw, flag);
  if (t.length === 0) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (schema.enum && !schema.enum.includes(raw)) throw new CliError(`--${flag} must be one of ${schema.enum.join(", ")}, got "${raw}"`);
  return raw;
}

function keyValueItem(raw: string, flag: string): { key: string; value: string } {
  const at = raw.indexOf("=");
  if (at <= 0) throw new CliError(`--${flag} items look like KEY=VALUE, got "${raw}". Or pass JSON: --${flag} '[{"key":"K","value":"V"}]'`);
  return { key: raw.slice(0, at), value: raw.slice(at + 1) };
}

function addValue(args: Record<string, unknown>, prop: string, schema: JsonSchema, raw: string, flag: string): void {
  if (types(schema).includes("array") && types(schema).includes("object")) {
    if (prop in args) throw new CliError(`--${flag} is given twice`);
    args[prop] = parseJson(raw, flag);
    return;
  }
  if (types(schema).includes("array")) {
    if (raw.trimStart().startsWith("[")) {
      const parsed = parseJson(raw, flag);
      if (!Array.isArray(parsed)) throw new CliError(`--${flag} expects a JSON array`);
      args[prop] = [...((args[prop] as unknown[]) ?? []), ...parsed];
      return;
    }
    const item = isKeyValueList(schema) ? keyValueItem(raw, flag) : types(schema.items ?? {}).includes("object") ? parseJson(raw, flag) : coerceScalar(raw, schema.items ?? { type: "string" }, flag);
    args[prop] = [...((args[prop] as unknown[]) ?? []), item];
    return;
  }
  if (prop in args) throw new CliError(`--${flag} is given twice`);
  args[prop] = coerceScalar(raw, schema, flag);
}

function toProp(flag: string, props: Record<string, JsonSchema>): string | null {
  const snake = flag.replace(/-/g, "_");
  return snake in props ? snake : null;
}

export function flagName(prop: string): string {
  return prop.replace(/_/g, "-");
}

export async function parseToolArgs(schema: ToolSchema, argv: string[], readText: ReadText): Promise<Record<string, unknown>> {
  const props = schema.properties ?? {};
  const args: Record<string, unknown> = {};
  const positionals: string[] = [];
  const valid = () => (Object.keys(props).length ? `Valid flags: ${Object.keys(props).map((p) => `--${flagName(p)}`).join(", ")}` : "This command takes no arguments");

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("--") || token === "-") {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const flag = token.slice(2, eq === -1 ? undefined : eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    const next = () => {
      if (inline !== undefined) return inline;
      const value = argv[++i];
      if (value === undefined) throw new CliError(`--${flag} needs a value`);
      return value;
    };

    if (flag === "json") {
      const parsed = parseJson(next(), "json");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CliError("--json expects a JSON object of arguments");
      Object.assign(args, parsed);
      continue;
    }

    const direct = toProp(flag, props);
    if (direct) {
      const schemaFor = props[direct];
      if (types(schemaFor).includes("boolean") && inline === undefined && argv[i + 1] !== "true" && argv[i + 1] !== "false") {
        args[direct] = true;
        continue;
      }
      addValue(args, direct, schemaFor, next(), flag);
      continue;
    }

    if (flag.endsWith("-file") || flag.endsWith("_file")) {
      const base = toProp(flag.slice(0, -5), props);
      if (base) {
        const content = await readText(next());
        const schemaFor = props[base];
        if (types(schemaFor).includes("string") || types(schemaFor).length === 0) {
          if (base in args) throw new CliError(`--${flagName(base)} is given twice`);
          args[base] = content;
        } else addValue(args, base, schemaFor, content, flag);
        continue;
      }
    }

    if (flag.startsWith("no-")) {
      const base = toProp(flag.slice(3), props);
      if (base && types(props[base]).includes("boolean")) {
        args[base] = false;
        continue;
      }
    }

    throw new CliError(`Unknown flag --${flag}. ${valid()}`);
  }

  const slots = positionalSlots(schema).filter((p) => !(p in args));
  for (const prop of slots) {
    if (!positionals.length) break;
    const schemaFor = props[prop];
    if (types(schemaFor).includes("array")) {
      for (const raw of positionals.splice(0)) addValue(args, prop, schemaFor, raw, flagName(prop));
    } else addValue(args, prop, schemaFor, positionals.shift() as string, flagName(prop));
  }
  if (positionals.length) throw new CliError(`Unexpected argument${positionals.length > 1 ? "s" : ""}: ${positionals.join(" ")}. ${valid()}`);

  const missing = (schema.required ?? []).filter((p) => !(p in args));
  if (missing.length) throw new CliError(`Missing ${missing.map((p) => `--${flagName(p)}`).join(", ")}`);
  return args;
}

export function positionalSlots(schema: ToolSchema): string[] {
  const props = schema.properties ?? {};
  return (schema.required ?? []).filter((p) => props[p] && !types(props[p]).includes("boolean"));
}

function typeLabel(schema: JsonSchema): string {
  const t = types(schema);
  if (schema.enum) return schema.enum.join("|");
  if (t.includes("array")) return isKeyValueList(schema) ? "KEY=VALUE..." : types(schema.items ?? {}).includes("object") ? "json[]" : `${types(schema.items ?? {})[0] ?? "value"}...`;
  if (t.includes("object")) return "json";
  return t[0] ?? "json";
}

export function describeTool(name: string, description: string, schema: ToolSchema): string {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const slots = positionalSlots(schema);
  const usage = [`oahctl ${name}`, ...slots.map((p) => `<${p}${types(props[p]).includes("array") ? "..." : ""}>`), ...Object.keys(props).filter((p) => !slots.includes(p)).map((p) => (required.has(p) ? `--${flagName(p)}` : `[--${flagName(p)}]`))].join(" ");
  const lines = [usage, "", description];
  if (Object.keys(props).length) {
    lines.push("", "Arguments:");
    for (const [prop, s] of Object.entries(props)) {
      const label = prop === "server" && slots.includes(prop) ? `<server> (positional)` : types(s).includes("boolean") ? `--${flagName(prop)}` : `--${flagName(prop)} <${typeLabel(s)}>`;
      lines.push(`  ${label.padEnd(34)} ${required.has(prop) ? "(required) " : ""}${(s.description ?? "").replace(/\s+/g, " ")}`);
    }
    lines.push("", "Any string argument also takes --<name>-file <path> (or - for stdin). --json '{...}' passes arguments as one object.");
  }
  return lines.join("\n");
}
