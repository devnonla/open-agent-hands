import { eq } from "drizzle-orm";
import { compactThresholds, isContextOverflow, learnedContextLimit, loadModelContext } from "../../../../common/ai/model-context.js";
import { agentConversations, agents, getDb } from "../../../../common/db/client.js";
import { qone, qrun } from "../../../../common/db/query.js";
import { computeContextUsage, listConversationRows, rememberLearnedContext } from "./context-usage.js";
import { chooseCut } from "./history-window.js";
import type { HistoryCutRow } from "./history-window.js";
import { resolveRunModel } from "./resolve-run-model.js";
import { SUMMARY_PREFIX, summarizeRegion, summaryTokenCount } from "./summarizer.js";

const LOCK_MS = 5 * 60_000;

export function compactionEnabled(): boolean {
  return process.env.COMPACTION_ENABLED !== "0";
}

function retryDelayMs(failures: number): number {
  if (failures >= 3) return 900_000;
  if (failures >= 2) return 300_000;
  return 60_000;
}

function toCutRows(rows: Awaited<ReturnType<typeof listConversationRows>>): HistoryCutRow[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  }));
}

async function releaseLock(conversationId: string): Promise<void> {
  await qrun(getDb().update(agentConversations).set({ compactingSince: null }).where(eq(agentConversations.id, conversationId)));
}

export async function compactConversation(conversationId: string, trigger: "post_run" | "pre_run" | "overflow"): Promise<"committed" | "skipped" | "failed" | "fallback" | "busy"> {
  if (!compactionEnabled()) return "skipped";
  const started = Date.now();
  const db = getDb();
  const conv = await qone(db.select().from(agentConversations).where(eq(agentConversations.id, conversationId)));
  if (!conv?.agentId) return "skipped";

  if (trigger === "post_run" && conv.compactRetryAt && conv.compactRetryAt.getTime() > Date.now()) {
    return "skipped";
  }

  if (conv.compactingSince && Date.now() - conv.compactingSince.getTime() < LOCK_MS) {
    if (trigger !== "pre_run") return "busy";
    const version = conv.summaryVersion ?? 0;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const fresh = await qone(db.select().from(agentConversations).where(eq(agentConversations.id, conversationId)));
      if (!fresh?.compactingSince || (fresh.summaryVersion ?? 0) > version) return "skipped";
    }
    return "busy";
  }

  await qrun(db.update(agentConversations).set({ compactingSince: new Date() }).where(eq(agentConversations.id, conversationId)));

  try {
    const agent = await qone(db.select().from(agents).where(eq(agents.id, conv.agentId)));
    if (!agent) return "skipped";
    const runModel = await resolveRunModel(agent);
    const modelContext = await loadModelContext(runModel.providerId, runModel.modelId);
    const usage = await computeContextUsage(conversationId, runModel);
    const thresholds = compactThresholds(modelContext.max);
    const ratio = usage.max > 0 ? usage.used / usage.max : 0;
    if (trigger === "post_run" && ratio < thresholds.background) return "skipped";
    if (trigger === "pre_run" && ratio < thresholds.safety) return "skipped";

    const rows = toCutRows(await listConversationRows(conversationId));
    const cut = chooseCut(rows, modelContext.max, modelContext.calibration);
    if ("skip" in cut) return "skipped";

    const cutIndex = rows.findIndex((row) => row.id === cut.cutMessageId);
    const oldIndex = conv.summaryCutMessageId ? rows.findIndex((row) => row.id === conv.summaryCutMessageId) : 0;
    const from = oldIndex > 0 ? oldIndex : 0;
    const region = rows.slice(from, Math.max(from, cutIndex)).filter((row) => row.role !== "thinking");
    if (region.length === 0) return "skipped";

    const result = await summarizeRegion({
      providerId: runModel.providerId,
      modelId: runModel.modelId,
      previous: conv.summary,
      rows: region,
      conversationId,
      agentId: conv.agentId,
    });

    const failures = conv.compactFailures ?? 0;
    if (result.fallback && trigger === "post_run" && failures < 2) {
      await qrun(
        db
          .update(agentConversations)
          .set({
            compactFailures: failures + 1,
            compactRetryAt: new Date(Date.now() + retryDelayMs(failures + 1)),
          })
          .where(eq(agentConversations.id, conversationId)),
      );
      console.info(`compact conversation=${conversationId} trigger=${trigger} result=failed rows=${region.length} ms=${Date.now() - started}`);
      return "failed";
    }

    const summary = `${SUMMARY_PREFIX}\n\n${result.summary}`;
    await qrun(
      db
        .update(agentConversations)
        .set({
          summary,
          summaryUpdatedAt: new Date(),
          summaryCutMessageId: cut.cutMessageId,
          summaryVersion: (conv.summaryVersion ?? 0) + 1,
          summaryTokens: summaryTokenCount(summary, modelContext.calibration),
          compactFailures: result.fallback ? failures + 1 : 0,
          compactRetryAt: null,
        })
        .where(eq(agentConversations.id, conversationId)),
    );
    const outcome = result.fallback ? "fallback" : "committed";
    console.info(`compact conversation=${conversationId} trigger=${trigger} result=${outcome} rows=${region.length} summaryChars=${summary.length} ms=${Date.now() - started}`);
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.info(`compact conversation=${conversationId} trigger=${trigger} result=failed ms=${Date.now() - started}`);
    if (isContextOverflow(message)) {
      const learned = learnedContextLimit(message);
      const agent = await qone(db.select().from(agents).where(eq(agents.id, conv.agentId)));
      if (learned && agent) {
        const runModel = await resolveRunModel(agent);
        await rememberLearnedContext(runModel.providerId, runModel.modelId, learned);
      }
    }
    return "failed";
  } finally {
    await releaseLock(conversationId);
  }
}
