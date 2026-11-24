const GROUP_RULES: [string, (name: string) => boolean][] = [
  ["Guide", (n) => n === "get_guide"],
  ["Tools", (n) => /(^|_)tools?(_schema|_folder|_code)?$/.test(n)],
  ["MCP servers", (n) => n.includes("mcp_server")],
  ["KV", (n) => n.startsWith("kv_")],
  ["Secrets", (n) => n.startsWith("secret_")],
  ["Datatables", (n) => n.startsWith("datatable_")],
  ["Storage", (n) => n.startsWith("storage_")],
  ["Sites", (n) => n.includes("site")],
  ["Jobs", (n) => n.includes("job")],
];

export function groupOf(name: string): string {
  return GROUP_RULES.find(([, match]) => match(name))?.[0] ?? "Other";
}

export function groupTools<T extends { name: string }>(tools: T[]): { group: string; tools: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const [group] of GROUP_RULES) groups.set(group, []);
  for (const tool of tools) {
    const group = groupOf(tool.name);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)?.push(tool);
  }
  return [...groups].filter(([, list]) => list.length > 0).map(([group, list]) => ({ group, tools: list }));
}
