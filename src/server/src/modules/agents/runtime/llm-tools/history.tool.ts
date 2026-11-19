import { tool } from "@langchain/core/tools";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { agentConversations, agentMessages, getDb } from "../../../../common/db/client.js";
import { qone } from "../../../../common/db/query.js";
import { listConversationRows } from "../utils/context-usage.js";

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 240 ? `${flat.slice(0, 240)}…` : flat;
}

export function makeHistoryTools(conversationId: string) {
  const readMessage = tool(
    async ({ messageId }) => {
      const row = await qone(getDb().select().from(agentMessages).where(eq(agentMessages.id, messageId)));
      if (!row || row.conversationId !== conversationId) {
        return JSON.stringify({ ok: false, error: "Message not in this conversation" });
      }
      const meta = (row.metadata as Record<string, unknown> | null) ?? {};
      const output = typeof meta.toolOutput === "string" ? meta.toolOutput : row.content;
      return JSON.stringify({ ok: true, id: row.id, role: row.role, content: output });
    },
    {
      name: "nonla_read_message",
      description: "Read the full stored text of one message in the current conversation. Use this when a tool result was shortened in the prompt.",
      schema: z.object({
        messageId: z.string(),
      }),
    },
  );

  const searchCompacted = tool(
    async ({ query }) => {
      const conv = await qone(getDb().select().from(agentConversations).where(eq(agentConversations.id, conversationId)));
      if (!conv?.summaryCutMessageId) return JSON.stringify({ ok: true, matches: [] });
      const needle = query.trim().toLowerCase();
      if (!needle) return JSON.stringify({ ok: true, matches: [] });
      const rows = await listConversationRows(conversationId);
      const cutIndex = rows.findIndex((row) => row.id === conv.summaryCutMessageId);
      const older = cutIndex > 0 ? rows.slice(0, cutIndex) : [];
      const matches = older
        .filter((row) => {
          const blob = `${row.content} ${row.metadata ? JSON.stringify(row.metadata) : ""}`.toLowerCase();
          return blob.includes(needle);
        })
        .slice(-8)
        .map((row) => ({ messageId: row.id, role: row.role, snippet: snippet(row.content) }));
      return JSON.stringify({ ok: true, matches });
    },
    {
      name: "nonla_search_compacted",
      description: "Search messages that were summarized out of the current conversation. Returns short snippets and message ids. Does not search the live tail.",
      schema: z.object({
        query: z.string(),
      }),
    },
  );

  return [readMessage, searchCompacted];
}
