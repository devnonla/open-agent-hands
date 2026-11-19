import type { StructuredToolInterface } from "@langchain/core/tools";
import { createMiddleware } from "langchain";
import { makeGetToolSchemaTool } from "../llm-tools/get-tool-schema.tool.js";

const GET_TOOL_SCHEMA_NAME = "get_tool_schema";

const EAGER_TOOL_NAMES = new Set(["nonla_agent_task", "nonla_memory", "nonla_get_current_time", "nonla_read_skill", "nonla_background_tasks", "nonla_read_message", "nonla_search_compacted"]);

const EAGER_PREFIXES = ["nonla_call_agent__", "call_agent__"];

export function isEagerTool(name: string): boolean {
  return EAGER_TOOL_NAMES.has(name) || EAGER_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function fullToolDescription(description: string): string {
  return description.trim().replace(/\n/g, "\n  ");
}

function collectNamesFromToolCall(out: Set<string>, name: string, args: unknown): void {
  if (!name) return;
  if (name === GET_TOOL_SCHEMA_NAME) {
    const names = (args as { names?: unknown } | null)?.names;
    if (!Array.isArray(names)) return;
    for (const n of names) {
      if (typeof n === "string" && n.trim()) out.add(n.trim());
    }
    return;
  }
  out.add(name);
}

export function collectLoadedToolNamesFromMessages(messages: unknown[]): string[] {
  const out = new Set<string>();

  for (const raw of messages ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;

    const toolCalls = m.toolCalls ?? m.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        if (!tc || typeof tc !== "object") continue;
        const call = tc as { name?: unknown; args?: unknown; arguments?: unknown };
        const name = typeof call.name === "string" ? call.name : "";
        collectNamesFromToolCall(out, name, call.args ?? call.arguments);
      }
    }

    const role = typeof m.role === "string" ? m.role : undefined;
    const msgType = typeof (m as { getType?: () => string }).getType === "function" ? (m as { getType: () => string }).getType() : undefined;

    if (role === "tool-result" || role === "tool" || msgType === "tool") {
      const toolName = m.toolName ?? m.name;
      if (typeof toolName === "string" && toolName && toolName !== GET_TOOL_SCHEMA_NAME) {
        out.add(toolName);
      }
    }
  }

  return [...out];
}

function seedLoaded(loaded: Set<string>, names: Iterable<string>, registry: Map<string, StructuredToolInterface>): void {
  for (const name of names) {
    if (registry.has(name)) loaded.add(name);
  }
}

export type LazyToolsBundle = {
  getToolSchema: StructuredToolInterface;
  middleware: ReturnType<typeof createMiddleware>;
  catalogPromptSection: string;
  allToolsForAgent: StructuredToolInterface[];
  loadedToolNames: () => string[];
};

export type BuildLazyToolsBundleOptions = {
  messages?: unknown[];
};

export function buildLazyToolsBundle(resolvedTools: StructuredToolInterface[], options: BuildLazyToolsBundleOptions = {}): LazyToolsBundle {
  const registry = new Map<string, StructuredToolInterface>();
  for (const t of resolvedTools) {
    if (t.name && t.name !== GET_TOOL_SCHEMA_NAME) registry.set(t.name, t);
  }

  const loaded = new Set<string>();
  for (const name of registry.keys()) {
    if (isEagerTool(name)) loaded.add(name);
  }
  if (options.messages?.length) {
    seedLoaded(loaded, collectLoadedToolNamesFromMessages(options.messages), registry);
  }

  const getToolSchema = makeGetToolSchemaTool(registry, (names) => {
    seedLoaded(loaded, names, registry);
  });

  const middleware = createMiddleware({
    name: "LazyToolSchemas",
    wrapModelCall: (request, handler) => {
      const stateMessages = (request as { state?: { messages?: unknown[] } }).state?.messages;
      if (Array.isArray(stateMessages) && stateMessages.length > 0) {
        seedLoaded(loaded, collectLoadedToolNamesFromMessages(stateMessages), registry);
      }
      const visible: StructuredToolInterface[] = [getToolSchema, ...resolvedTools.filter((t) => t.name && loaded.has(t.name))];
      return handler({ ...request, tools: visible });
    },
  });

  const readyLines: string[] = [];
  const lazyLines: string[] = [];
  for (const t of registry.values()) {
    const desc = fullToolDescription(t.description ?? "");
    const line = desc ? `- \`${t.name}\` — ${desc}` : `- \`${t.name}\``;
    if (isEagerTool(t.name)) readyLines.push(line);
    else lazyLines.push(line);
  }

  const catalogParts: string[] = [];
  if (readyLines.length > 0) {
    catalogParts.push(`Ready to call. The parameter schema is already loaded. Do not call get_tool_schema for these.\n\n${readyLines.join("\n")}`);
  }
  if (lazyLines.length > 0) {
    catalogParts.push(`Load the schema before calling. Use \`get_tool_schema({ names: ["tool_a", "tool_b"] })\` and batch every tool you need in one call.\n\n${lazyLines.join("\n")}`);
  }

  const catalogPromptSection = catalogParts.length === 0 ? "" : `<available_tools>\n${catalogParts.join("\n\n")}\n</available_tools>`;

  return {
    getToolSchema,
    middleware,
    catalogPromptSection,
    allToolsForAgent: [getToolSchema, ...resolvedTools],
    loadedToolNames: () => [...loaded],
  };
}

export function appendToolsCatalog(systemPrompt: string, catalogPromptSection: string): string {
  if (!catalogPromptSection) return systemPrompt;
  return systemPrompt ? `${systemPrompt}\n\n${catalogPromptSection}` : catalogPromptSection;
}
