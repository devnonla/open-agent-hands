import { asc, eq, inArray, sql } from "drizzle-orm";
import { clampCalibration, estimateTokens, loadModelContext } from "../../../../common/ai/model-context.js";
import type { NormalizedUsage } from "../../../../common/ai/usage.js";
import { type ContextAnchor, type McpCatalogTool, agentConversations, agentMessages, agentToolAssignments, agentTools, agentUsageEvents, getDb, getDbDialect, llmProviders, mcpServers } from "../../../../common/db/client.js";
import { qall, qone, qrun } from "../../../../common/db/query.js";
import { parseMcpToolId } from "../../../mcp-servers/mcp-tool-id.js";
import { resolvePromptSections } from "./buildSystemPrompt.js";

export type ContextUsageView = {
  used: number;
  max: number;
  percent: number;
  source: "provider_usage" | "provider_usage_plus_estimate" | "local_estimate";
  categories: {
    system: number;
    tools: number;
    skills: number;
    summary: number;
    conversation: number;
  };
  summaryUpdatedAt: string | null;
  compacted: boolean;
};

export type CapturedUsage = {
  calls: NormalizedUsage[];
  providerId: string;
  providerType: string;
  modelId: string;
  estimatedInputTokens: number;
  contextMax: number;
};

const CATEGORY_KEYS = ["system", "tools", "skills", "summary", "conversation"] as const;

function fitCategories(raw: ContextUsageView["categories"], used: number): ContextUsageView["categories"] {
  const sum = CATEGORY_KEYS.reduce((total, key) => total + raw[key], 0);
  if (sum <= 0) return { ...raw, conversation: used };
  const fitted = { ...raw };
  let spent = 0;
  for (const key of CATEGORY_KEYS) {
    if (key === "conversation") {
      fitted.conversation = Math.max(0, used - spent);
      break;
    }
    const share = Math.round((raw[key] / sum) * used);
    fitted[key] = share;
    spent += share;
  }
  return fitted;
}

async function toolCatalogText(agentId: string): Promise<string> {
  const db = getDb();
  const assigned = await qall(db.select({ toolId: agentToolAssignments.toolId }).from(agentToolAssignments).where(eq(agentToolAssignments.agentId, agentId)));
  const lines = ["nonla_agent_task", "nonla_get_current_time", "nonla_memory", "nonla_background_tasks", "nonla_read_skill", "nonla_openui"];
  const customIds: string[] = [];
  const mcpRefs: { serverId: string; toolName: string }[] = [];
  for (const row of assigned) {
    const mcp = parseMcpToolId(row.toolId);
    if (mcp) {
      mcpRefs.push(mcp);
      continue;
    }
    if (row.toolId.startsWith("builtin:")) {
      lines.push(row.toolId.slice("builtin:".length));
      continue;
    }
    customIds.push(row.toolId);
  }
  if (customIds.length > 0) {
    const rows = await qall(db.select({ name: agentTools.name, description: agentTools.description }).from(agentTools).where(inArray(agentTools.id, customIds)));
    for (const tool of rows) lines.push(`${tool.name} ${tool.description}`);
  }
  if (mcpRefs.length > 0) {
    const serverIds = [...new Set(mcpRefs.map((ref) => ref.serverId))];
    const servers = await qall(db.select({ id: mcpServers.id, name: mcpServers.name, tools: mcpServers.tools }).from(mcpServers).where(inArray(mcpServers.id, serverIds)));
    const byServer = new Map(servers.map((server) => [server.id, server]));
    for (const ref of mcpRefs) {
      const server = byServer.get(ref.serverId);
      const catalog = (server?.tools ?? []) as McpCatalogTool[];
      const tool = catalog.find((item) => item.name === ref.toolName);
      lines.push(`${server?.name ?? "mcp"} ${ref.toolName} ${tool?.description ?? ""}`);
    }
  }
  return lines.join("\n");
}

function percentOf(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / max) * 100)));
}

function messageOrder() {
  const tiebreak = getDbDialect() === "postgres" ? sql`ctid` : sql`rowid`;
  return [asc(agentMessages.createdAt), tiebreak] as const;
}

export async function listConversationRows(conversationId: string) {
  return qall(
    getDb()
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, conversationId))
      .orderBy(...messageOrder()),
  );
}

export async function computeContextUsage(conversationId: string, model?: { providerId: string; modelId: string }): Promise<ContextUsageView> {
  const db = getDb();
  const conv = await qone(db.select().from(agentConversations).where(eq(agentConversations.id, conversationId)));
  const rows = await listConversationRows(conversationId);
  const anchor = conv?.contextAnchor ?? null;
  const summaryTokens = conv?.summaryTokens ?? estimateTokens(conv?.summary ?? "");
  const conversationTokens = rows.reduce((sum, row) => sum + estimateTokens(`${row.content}${row.metadata ? JSON.stringify(row.metadata) : ""}`), 0);

  let max = 128_000;
  let calibration = 1;
  if (model?.providerId && model.modelId) {
    const loaded = await loadModelContext(model.providerId, model.modelId);
    max = loaded.max;
    calibration = loaded.calibration;
  } else if (anchor?.contextMax) {
    max = anchor.contextMax;
  }

  const sections = conv?.agentId ? await resolvePromptSections(conv.agentId).catch(() => ({ system: "", skills: "", subagents: "" })) : { system: "", skills: "", subagents: "" };
  const toolsText = conv?.agentId ? await toolCatalogText(conv.agentId).catch(() => "") : "";

  const anchorMatches = anchor && model && anchor.providerId === model.providerId && anchor.modelId === model.modelId && anchor.summaryVersion === (conv?.summaryVersion ?? 0) && rows.some((row) => row.id === anchor.anchorMessageId);

  let used = Math.ceil(conversationTokens * calibration) + summaryTokens;
  let source: ContextUsageView["source"] = "local_estimate";
  if (anchorMatches && anchor) {
    const anchorIndex = rows.findIndex((row) => row.id === anchor.anchorMessageId);
    const after = anchorIndex >= 0 ? rows.slice(anchorIndex + 1) : [];
    const extra = after.reduce((sum, row) => sum + estimateTokens(`${row.content}${row.metadata ? JSON.stringify(row.metadata) : ""}`, calibration), 0);
    used = anchor.contextTokens + extra;
    source = extra > 0 ? "provider_usage_plus_estimate" : "provider_usage";
  }

  return {
    used,
    max,
    percent: percentOf(used, max),
    source,
    categories: fitCategories(
      {
        system: estimateTokens(sections.system, calibration),
        tools: estimateTokens([toolsText, sections.subagents].filter(Boolean).join("\n"), calibration),
        skills: estimateTokens(sections.skills, calibration),
        summary: estimateTokens(conv?.summary ?? "", calibration),
        conversation: Math.ceil(conversationTokens * calibration),
      },
      used,
    ),
    summaryUpdatedAt: conv?.summaryUpdatedAt ? new Date(conv.summaryUpdatedAt).toISOString() : null,
    compacted: (conv?.summaryVersion ?? 0) > 0,
  };
}

export async function recordCapturedUsage(input: { conversationId: string; agentId: string; runId?: string; anchorMessageId: string | null; captured: CapturedUsage; summaryVersion: number }): Promise<ContextUsageView | null> {
  const { captured } = input;
  if (captured.calls.length === 0) return null;
  const db = getDb();
  const now = new Date();
  for (const call of captured.calls) {
    await qrun(
      db.insert(agentUsageEvents).values({
        id: crypto.randomUUID(),
        conversationId: input.conversationId,
        runId: input.runId ?? null,
        agentId: input.agentId,
        providerId: captured.providerId,
        providerType: captured.providerType,
        modelId: captured.modelId,
        purpose: "chat",
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        cacheReadTokens: call.cacheReadTokens,
        cacheWriteTokens: call.cacheWriteTokens,
        reasoningTokens: call.reasoningTokens,
        estimatedInputTokens: captured.estimatedInputTokens,
        suspicious: call.suspicious,
        createdAt: now,
      }),
    );
  }

  const last = [...captured.calls].reverse().find((call) => call.valid) ?? null;
  if (last && input.anchorMessageId) {
    const anchor: ContextAnchor = {
      contextTokens: last.contextTokens,
      contextMax: captured.contextMax,
      anchorMessageId: input.anchorMessageId,
      providerId: captured.providerId,
      modelId: captured.modelId,
      summaryVersion: input.summaryVersion,
      source: "provider_usage",
    };
    await qrun(db.update(agentConversations).set({ contextAnchor: anchor }).where(eq(agentConversations.id, input.conversationId)));
    await updateCalibration(captured.providerId, captured.modelId, captured.estimatedInputTokens, last.inputTokens);
  }

  return computeContextUsage(input.conversationId, { providerId: captured.providerId, modelId: captured.modelId });
}

async function updateCalibration(providerId: string, modelId: string, estimated: number, measured: number): Promise<void> {
  if (estimated < 200 || measured <= 0) return;
  const db = getDb();
  const row = await qone(db.select().from(llmProviders).where(eq(llmProviders.id, providerId)));
  if (!row) return;
  const meta = { ...(row.modelMeta ?? {}) };
  const prev = meta[modelId]?.calibration ?? 1;
  const ratio = measured / estimated;
  const next = clampCalibration(prev * 0.7 + ratio * 0.3);
  meta[modelId] = { ...meta[modelId], calibration: next };
  await qrun(db.update(llmProviders).set({ modelMeta: meta, updatedAt: new Date() }).where(eq(llmProviders.id, providerId)));
}

export async function rememberLearnedContext(providerId: string, modelId: string, contextLength: number): Promise<void> {
  const db = getDb();
  const row = await qone(db.select().from(llmProviders).where(eq(llmProviders.id, providerId)));
  if (!row) return;
  const meta = { ...(row.modelMeta ?? {}) };
  const current = meta[modelId];
  if (current?.source === "manual") return;
  meta[modelId] = { ...current, contextLength, source: "learned" };
  await qrun(db.update(llmProviders).set({ modelMeta: meta, updatedAt: new Date() }).where(eq(llmProviders.id, providerId)));
}
