import { estimateTokens } from "../../../../common/ai/model-context.js";

export type HistoryCutRow = {
  id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | null;
};

const TOOL_HEAD = 4000;
const TOOL_TAIL = 1500;

export function clampTailBudget(contextMax: number): number {
  return Math.min(30_000, Math.max(8_000, Math.floor(contextMax * 0.1)));
}

export function rowText(row: HistoryCutRow): string {
  const meta = row.metadata ? JSON.stringify(row.metadata) : "";
  return `${row.content}\n${meta}`;
}

export function estimateRows(rows: HistoryCutRow[], calibration = 1): number {
  let total = 0;
  for (const row of rows) total += estimateTokens(rowText(row), calibration);
  return total;
}

export function chooseCut(rows: HistoryCutRow[], contextMax: number, calibration = 1): { cutMessageId: string } | { skip: true } {
  const visible = rows.filter((row) => row.role !== "thinking");
  const userIndexes: number[] = [];
  for (let i = 0; i < visible.length; i++) {
    if (visible[i]?.role === "user") userIndexes.push(i);
  }
  if (userIndexes.length === 0) return { skip: true };

  const budget = clampTailBudget(contextMax);
  let start = userIndexes[userIndexes.length - 1] ?? 0;
  for (let i = userIndexes.length - 2; i >= 0; i--) {
    const candidate = userIndexes[i] ?? start;
    const tail = visible.slice(candidate);
    if (estimateRows(tail, calibration) > budget) break;
    start = candidate;
  }
  if (start <= 0) return { skip: true };
  const cut = visible[start];
  if (!cut) return { skip: true };
  return { cutMessageId: cut.id };
}

export function clipToolOutput(output: string, messageId?: string): string {
  const limit = TOOL_HEAD + TOOL_TAIL;
  if (output.length <= limit + 80) return output;
  const omitted = output.length - limit;
  const id = messageId ? `, messageId = ${messageId}` : "";
  return `${output.slice(0, TOOL_HEAD)}\n(đã rút gọn ${omitted} ký tự${id}, đọc lại bằng nonla_read_message nếu cần)\n${output.slice(-TOOL_TAIL)}`;
}

export function redactSecrets(text: string): string {
  return text.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]").replace(/\b(api[_-]?key|secret|token|password)\b(\s*[:=]\s*)(\S+)/gi, "$1$2[redacted]");
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const URL_RE = /https?:\/\/[^\s)"']+/gi;

export function extractAnchors(rows: HistoryCutRow[], limit = 40): string[] {
  const found = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || found.size >= limit) return;
    found.add(trimmed);
  };
  for (const row of rows) {
    const blob = rowText(row);
    for (const match of blob.match(UUID_RE) ?? []) push(match);
    for (const match of blob.match(URL_RE) ?? []) push(match);
    const toolName = row.metadata?.toolName;
    if (typeof toolName === "string") push(toolName);
  }
  return [...found];
}

export function verbatimUserMessages(rows: HistoryCutRow[], maxChars = 8000): string {
  const users = rows.filter((row) => row.role === "user" && row.content.trim());
  const lines: string[] = [];
  let chars = 0;
  for (let i = users.length - 1; i >= 0; i--) {
    const text = users[i]?.content.trim() ?? "";
    if (!text) continue;
    if (chars + text.length > maxChars) break;
    lines.push(text);
    chars += text.length + 1;
  }
  return lines.join("\n---\n");
}

export function sampleRows(rows: HistoryCutRow[], maxChars: number): { rows: HistoryCutRow[]; omitted: number } {
  const size = rows.reduce((sum, row) => sum + rowText(row).length, 0);
  if (size <= maxChars || rows.length < 6) return { rows, omitted: 0 };
  const headCount = Math.max(1, Math.ceil(rows.length * 0.2));
  const tailCount = Math.max(1, Math.ceil(rows.length * 0.3));
  const head = rows.slice(0, headCount);
  const tail = rows.slice(-tailCount);
  return { rows: [...head, ...tail], omitted: rows.length - head.length - tail.length };
}
