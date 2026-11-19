/**
 * Builtin tool names all use the nonla_ prefix.
 * Old names stay as aliases so saved assignments and old ids still resolve.
 */

const RENAMES: Record<string, string> = {
  web_fetch: "nonla_web_fetch",
  fetch_url: "nonla_web_fetch",
  browser: "nonla_web_fetch",
  run_js: "nonla_run_js",
  get_current_time: "nonla_get_current_time",
  kv_store: "nonla_kv_store",
  datatable: "nonla_datatable",
  memory: "nonla_memory",
  user_memory: "nonla_memory",
  manage_memory: "nonla_memory",
  read_skill: "nonla_read_skill",
  background_tasks: "nonla_background_tasks",
  read_current_code: "nonla_read_current_code",
  edit_code: "nonla_edit_code",
  run_current_script: "nonla_run_current_script",
  call_agent: "nonla_call_agent",
  nonla_get_instruct: "nonla_get_system_prompt",
  nonla_edit_instruct: "nonla_edit_system_prompt",
};

/** Older virtual ids that pointed at web_fetch before the prefix. */
const ID_ALIASES: Record<string, string> = {
  "builtin:browser": "builtin:web_fetch",
  "builtin:fetch_url": "builtin:web_fetch",
};

export function canonicalBuiltinToolName(name: string): string {
  return RENAMES[name] ?? name;
}

/** Map builtin:web_fetch and builtin:browser to builtin:nonla_web_fetch. Other ids pass through. */
export function canonicalBuiltinToolId(id: string): string {
  const aliased = ID_ALIASES[id] ?? id;
  if (!aliased.startsWith("builtin:")) return aliased;
  const name = aliased.slice("builtin:".length);
  return `builtin:${canonicalBuiltinToolName(name)}`;
}
