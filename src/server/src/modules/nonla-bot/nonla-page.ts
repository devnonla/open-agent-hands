export type NonlaPage = {
  path: string;
  title: string;
  hint: string;
  task: string;
};

function clip(value: string | undefined, max: number): string {
  return (value ?? "").slice(0, max);
}

export function normalizeNonlaPath(pathname: string): string {
  const raw = pathname.split("?")[0]?.split("#")[0]?.trim() ?? "";
  if (!raw.startsWith("/") || raw.includes("..") || raw.includes("\\")) return "/";
  const collapsed = raw.replace(/\/+/g, "/").replace(/\/$/, "");
  return clip(collapsed || "/", 300);
}

const GOTO_ID = "[A-Za-z0-9_-]+";

const GOTO_PATHS: RegExp[] = [
  /^\/$/,
  /^\/agents$/,
  new RegExp(`^/agents/teams/${GOTO_ID}$`),
  new RegExp(`^/agents/${GOTO_ID}$`),
  new RegExp(`^/agents/${GOTO_ID}/(?:canvas|chat|config|editor)$`),
  /^\/tools$/,
  /^\/tools\/mcp$/,
  new RegExp(`^/tools/mcp/${GOTO_ID}$`),
  new RegExp(`^/tools/${GOTO_ID}$`),
  /^\/skills$/,
  new RegExp(`^/skills/${GOTO_ID}$`),
  /^\/sites$/,
  new RegExp(`^/sites/${GOTO_ID}$`),
  /^\/jobs$/,
  new RegExp(`^/jobs/${GOTO_ID}$`),
  new RegExp(`^/jobs/${GOTO_ID}/(?:schedules|activities|settings)$`),
  /^\/my-mcp-servers$/,
  /^\/datatables$/,
  new RegExp(`^/datatables/${GOTO_ID}$`),
  new RegExp(`^/datatables/${GOTO_ID}/(?:schema|settings)$`),
  /^\/kvstore$/,
  /^\/secrets$/,
  /^\/settings(?:\/.*)?$/,
  /^\/profile$/,
];

export function appPathForGoto(raw: string): string | null {
  if (typeof raw !== "string" || raw.includes("..") || raw.includes("\\") || raw.includes("://")) return null;
  const path = normalizeNonlaPath(raw);
  if (!GOTO_PATHS.some((rule) => rule.test(path))) return null;
  return path;
}

function page(path: string, title: string, hint: string, task: string): NonlaPage {
  return { path, title, hint, task };
}

export function resolveNonlaPage(pathname: string): NonlaPage {
  const path = normalizeNonlaPath(pathname);
  const [a, b, c] = path
    .split("/")
    .filter(Boolean)
    .map((part) => clip(part, 80));

  if (!a) return page(path, "Dashboard", "Create or manage anything in the workspace.", "Look across the workspace. Create or manage agents, tools, skills, jobs, sites, datatables, KV, secrets, or MCP when asked.");

  if (a === "agents" && b === "teams" && c) return page(path, "Team", "Edit this team and the agents in it.", `Edit this team and the agents in it. Team id: ${c}. Call nonla_call_agent__nonla_agent_manager. Do not manage agents yourself.`);
  if (a === "agents" && b && (c === "canvas" || c === "config" || c === "editor"))
    return page(path, "Agent canvas", "Update this agent's system prompt, tools, skills, and MCP.", `Update this agent's canvas. Agent id: ${b}. Call nonla_call_agent__nonla_agent_manager. It sets tools and writes the system prompt after review. Do not manage agents yourself.`);
  if (a === "agents" && b && c === "chat") return page(path, "Agent chat", "Change this agent's system prompt or tools when asked.", `The user is chatting with this agent. Agent id: ${b}. Call nonla_call_agent__nonla_agent_manager for system prompt or tool changes. Do not manage agents yourself.`);
  if (a === "agents" && b) return page(path, "Agent chat", "Change this agent's system prompt or tools when asked.", `The user is chatting with this agent. Agent id: ${b}. Call nonla_call_agent__nonla_agent_manager for system prompt or tool changes. Do not manage agents yourself.`);
  if (a === "agents") return page(path, "Agents", "Create agents and teams, or open one to change it.", "Create agents and teams, or open one to change it. Call nonla_call_agent__nonla_agent_manager. Do not manage agents yourself.");

  if (a === "tools" && b === "mcp" && c) return page(path, "MCP server", "Inspect this MCP server.", `Inspect this MCP server. Server id: ${c}. Use nonla_manage_mcp_servers.`);
  if (a === "tools" && b === "mcp") return page(path, "MCP tools", "Connect MCP servers and see their tools.", "Connect MCP servers and see the tools they expose. Use nonla_manage_mcp_servers.");
  if (a === "tools" && b) return page(path, "Tool editor", "Edit this tool's code, then test it.", `The user is in the tool editor. Tool id: ${b}. Call nonla_call_agent__nonla_tool_manager. It writes the draft. One agent task tests it. When the test passes, the manager approves it. Do not edit the source yourself.`);
  if (a === "tools") return page(path, "Tools", "Create a tool, or open one to edit its code.", "Create or edit a custom tool. Call nonla_call_agent__nonla_tool_manager. Do not manage tools yourself. Do not edit the source yourself.");

  if (a === "skills" && b) return page(path, "Skill editor", "Update this skill's instructions.", `Update this skill. Skill id: ${b}. Call nonla_call_agent__nonla_skill_manager. It writes the draft. One agent task reviews it. When the review passes, the manager approves it. Do not write the markdown yourself.`);
  if (a === "skills") return page(path, "Skills", "Create or edit reusable instructions.", "Create or edit a skill. Call nonla_call_agent__nonla_skill_manager. Do not write the markdown yourself.");

  if (a === "sites" && b) return page(path, "Site editor", "Update this site and its files.", `Update this site. Site id: ${b}. Call nonla_call_agent__nonla_site_manager. It writes the draft. One agent task tests it. When the test passes, the manager approves it. Do not write source yourself.`);
  if (a === "sites") return page(path, "Sites", "Create or publish a site.", "Create or edit a site. Call nonla_call_agent__nonla_site_manager. Do not write source yourself.");

  if (a === "jobs" && b) {
    const focus = c === "schedules" ? "its schedule" : c === "activities" ? "its runs" : c === "settings" ? "its settings" : "this job";
    return page(path, "Job", `Edit ${focus}.`, `Edit ${focus}. Job id: ${b}. Call nonla_call_agent__nonla_job_manager. It updates the schedule and settings. It writes the script. One agent task tests it. When the test passes, the manager approves it.`);
  }
  if (a === "jobs") return page(path, "Jobs", "Create a job or check its runs.", "Create or edit a job. Call nonla_call_agent__nonla_job_manager. Do not write the script yourself.");

  if (a === "my-mcp-servers") return page(path, "My MCP servers", "Manage MCP servers in this workspace.", "Manage MCP servers in this workspace. Use nonla_manage_mcp_servers.");

  if (a === "datatables" && b && c === "schema")
    return page(path, "Datatable schema", "Change tables and columns in this project.", `Change tables and columns in this project. Project id: ${b}. Call nonla_call_agent__nonla_datatable_manager. Changes are live. There is no approve step. Do not edit the schema yourself.`);
  if (a === "datatables" && b && c === "settings") return page(path, "Datatable settings", "Rename or delete this project.", `Rename or delete this project. Project id: ${b}. Call nonla_call_agent__nonla_datatable_manager. Changes are live. There is no approve step.`);
  if (a === "datatables" && b) return page(path, "Datatable rows", "Read and write rows in this project.", `Read and write rows in this project. Project id: ${b}. Call nonla_call_agent__nonla_datatable_manager. Changes are live. There is no approve step. Do not edit rows yourself.`);
  if (a === "datatables") return page(path, "Datatables", "Create or open a datatable project.", "Create or open a datatable project. Call nonla_call_agent__nonla_datatable_manager. Changes are live. There is no approve step.");

  if (a === "kvstore") return page(path, "KV Store", "Read and write KV entries.", "Read and write KV entries with nonla_manage_kv_entries. Changes are live. There is no approve step. Do not call a manager.");
  if (a === "secrets") return page(path, "Secrets", "Store and update secrets.", "Store and update secrets with nonla_manage_secrets. Changes are live. There is no approve step. Do not call a manager. Do not repeat a secret value in chat unless the user asked to see that key.");

  if (a === "settings" || a === "profile") return page(path, "Settings", "Settings stay manual. Ask about workspace resources instead.", "This page is settings. You cannot change users, providers, or API keys. Say that, then offer a workspace resource you can manage.");

  return page(path, "This page", "Help with what is on screen.", "Help with what is on screen. Discover real ids before you change anything.");
}

export function formatNonlaPageBlock(pathname: string | undefined): string {
  if (typeof pathname !== "string" || pathname.trim().length === 0) return "";
  const page = resolveNonlaPage(pathname);
  return `\n\n<current_page>\nPath: ${page.path}\nPage: ${page.title}\nJob: ${page.task}\nDo this job unless the user asks for something else. Use ids written above. Do not invent ids.\n</current_page>`;
}
