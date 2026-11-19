import { asc, eq, sql } from "drizzle-orm";
import { agentConversations, agentMessages, getDb, getDbDialect } from "../../../../common/db/client.js";
import { qall, qone } from "../../../../common/db/query.js";
import type { MessageParam } from "./agentRunner.js";
import { clipToolOutput } from "./history-window.js";

type HistoryRow = {
  id?: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
};

function parseToolRow(row: HistoryRow): {
  toolCall: { id: string; name: string; args: unknown };
  toolResult: Extract<MessageParam, { role: "tool-result" }>;
} | null {
  const meta = row.metadata;
  if (!meta?.toolCallId || !meta?.toolName) return null;
  const toolCallId = meta.toolCallId as string;
  const toolName = meta.toolName as string;
  const raw = (meta.toolOutput as string) ?? (meta.result != null ? JSON.stringify(meta.result) : row.content);
  const output = clipToolOutput(raw, row.id);
  return {
    toolCall: { id: toolCallId, name: toolName, args: meta.toolInput ?? {} },
    toolResult: { role: "tool-result", toolCallId, toolName, result: output },
  };
}

function collectToolGroup(
  rows: HistoryRow[],
  start: number,
): {
  toolCalls: Array<{ id: string; name: string; args: unknown }>;
  toolResults: Extract<MessageParam, { role: "tool-result" }>[];
  nextIndex: number;
} {
  const toolCalls: Array<{ id: string; name: string; args: unknown }> = [];
  const toolResults: Extract<MessageParam, { role: "tool-result" }>[] = [];
  let j = start;
  while (j < rows.length) {
    if (rows[j].role === "thinking") {
      j++;
      continue;
    }
    if (rows[j].role !== "tool") break;
    const parsed = parseToolRow(rows[j]);
    if (parsed) {
      toolCalls.push(parsed.toolCall);
      toolResults.push(parsed.toolResult);
    }
    j++;
  }
  return { toolCalls, toolResults, nextIndex: j };
}

export function rebuildHistoryFromRows(rows: HistoryRow[]): MessageParam[] {
  const result: MessageParam[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];

    if (row.role === "thinking") {
      i++;
      continue;
    }

    if (row.role === "user") {
      result.push({ role: "user", content: row.content });
      i++;
      continue;
    }

    if (row.role === "assistant") {
      const { toolCalls, toolResults, nextIndex } = collectToolGroup(rows, i + 1);
      if (toolCalls.length > 0) {
        result.push({ role: "assistant", content: row.content || "", toolCalls });
        result.push(...toolResults);
        i = nextIndex;
      } else {
        result.push({ role: "assistant", content: row.content });
        i++;
      }
      continue;
    }

    if (row.role === "tool") {
      const { toolCalls, toolResults, nextIndex } = collectToolGroup(rows, i);
      if (toolCalls.length > 0) {
        result.push({ role: "assistant", content: "", toolCalls });
        result.push(...toolResults);
      }
      i = nextIndex;
      continue;
    }

    i++;
  }

  return result;
}

export async function loadHistory(conversationId: string): Promise<MessageParam[]> {
  const db = getDb();
  const tiebreak = getDbDialect() === "postgres" ? sql`ctid` : sql`rowid`;
  const [conv, rows] = await Promise.all([qone(db.select().from(agentConversations).where(eq(agentConversations.id, conversationId))), qall(db.select().from(agentMessages).where(eq(agentMessages.conversationId, conversationId)).orderBy(asc(agentMessages.createdAt), tiebreak))]);

  const mapped = rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    metadata: row.metadata as Record<string, unknown> | null,
  }));

  const cutIndex = conv?.summaryCutMessageId ? mapped.findIndex((row) => row.id === conv.summaryCutMessageId) : -1;
  const tail = cutIndex > 0 ? mapped.slice(cutIndex) : mapped;
  const history = rebuildHistoryFromRows(tail);
  if (cutIndex > 0 && conv?.summary) {
    return [{ role: "system", content: conv.summary }, ...history];
  }
  return history;
}
