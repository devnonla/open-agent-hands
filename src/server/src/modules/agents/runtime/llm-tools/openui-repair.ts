const WRAP_AT: Record<string, number[]> = {
  TabItem: [2],
  AccordionItem: [2],
  Stack: [0],
  Card: [0],
  Tabs: [0],
  Buttons: [0],
};

function matchingClose(source: string, openIdx: number, openCh: string, closeCh: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last) args.push(last);
  return args;
}

function needsArrayWrap(arg: string): boolean {
  const value = arg.trim();
  if (!value || value.startsWith("[") || value === "null" || value === "true" || value === "false") return false;
  if (/^-?\d/.test(value)) return false;
  if (value.startsWith('"') || value.startsWith("'")) return false;
  if (value.startsWith("{")) return false;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(value)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return true;
  return false;
}

export function repairOpenUiSource(source: string): string {
  const names = Object.keys(WRAP_AT);
  let result = "";
  let cursor = 0;
  const pattern = new RegExp(`\\b(${names.join("|")})\\s*\\(`, "g");
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (!name) continue;
    const openIdx = match.index ?? -1;
    if (openIdx < 0) continue;
    if (openIdx < cursor) continue;
    const closeIdx = matchingClose(source, openIdx + match[0].length - 1, "(", ")");
    if (closeIdx < 0) continue;
    result += source.slice(cursor, openIdx);
    const inner = repairOpenUiSource(source.slice(openIdx + match[0].length, closeIdx));
    const args = splitArgs(inner);
    const indexes = WRAP_AT[name] ?? [];
    const nextArgs = args.map((arg, index) => (indexes.includes(index) && needsArrayWrap(arg) ? `[${arg}]` : arg));
    result += `${name}(${nextArgs.join(", ")})`;
    cursor = closeIdx + 1;
  }
  result += source.slice(cursor);
  return result;
}
