import { eq } from "drizzle-orm";
import { type ModelMetaMap, getDb, llmProviders } from "../db/client.js";
import { qone } from "../db/query.js";

export const DEFAULT_CONTEXT_LENGTH = 128_000;

const CONTEXT_TABLE: [string, number][] = [
  ["gpt-4.1-nano", 1_047_576],
  ["gpt-4.1-mini", 1_047_576],
  ["gpt-4.1", 1_047_576],
  ["gpt-4o-mini", 128_000],
  ["gpt-4o", 128_000],
  ["gpt-5", 400_000],
  ["o4-mini", 200_000],
  ["o3-mini", 200_000],
  ["o3", 200_000],
  ["o1-mini", 128_000],
  ["o1", 200_000],
  ["claude-opus-4", 200_000],
  ["claude-sonnet-4-6", 200_000],
  ["claude-sonnet-4-5", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku-4", 200_000],
  ["claude-3-7-sonnet", 200_000],
  ["claude-3-5-sonnet", 200_000],
  ["claude-3-5-haiku", 200_000],
  ["claude-3-opus", 200_000],
  ["gemini-2.5-pro", 1_048_576],
  ["gemini-2.5-flash", 1_048_576],
  ["gemini-2.0-flash", 1_048_576],
  ["gemini-1.5-pro", 2_097_152],
  ["gemini-1.5-flash", 1_048_576],
];

export function modelLookupKey(modelId: string): string {
  const leaf = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
  return leaf.replace(/:(?:free|nitro|thinking|extended|floor)$/i, "").toLowerCase();
}

export function lookupContextTable(modelId: string): number | null {
  const key = modelLookupKey(modelId);
  let best: { name: string; length: number } | null = null;
  for (const [name, length] of CONTEXT_TABLE) {
    if (!key.includes(name)) continue;
    if (!best || name.length > best.name.length) best = { name, length };
  }
  return best?.length ?? null;
}

export function resolveContextLength(input: { modelId: string; storedLength?: number | null }): { max: number; source: "meta" | "table" | "default" } {
  if (input.storedLength != null && input.storedLength > 0) return { max: input.storedLength, source: "meta" };
  const table = lookupContextTable(input.modelId);
  if (table) return { max: table, source: "table" };
  return { max: DEFAULT_CONTEXT_LENGTH, source: "default" };
}

export type ModelContextInfo = { max: number; source: "api" | "manual" | "learned" | "table" };

export function describeModelContexts(models: string[], meta: ModelMetaMap | null | undefined): Record<string, ModelContextInfo> {
  const out: Record<string, ModelContextInfo> = {};
  for (const modelId of models) {
    const entry = meta?.[modelId];
    if (entry?.contextLength && entry.contextLength > 0) {
      out[modelId] = { max: entry.contextLength, source: entry.source === "table" || !entry.source ? "api" : entry.source };
      continue;
    }
    const table = lookupContextTable(modelId);
    if (table) out[modelId] = { max: table, source: "table" };
  }
  return out;
}

export function clampCalibration(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(3, Math.max(0.5, value));
}

export function estimateTokens(text: string, calibration = 1): number {
  if (!text) return 0;
  const factor = clampCalibration(calibration);
  return Math.max(1, Math.ceil((text.length / 4) * factor));
}

export async function loadModelContext(providerId: string, modelId: string): Promise<{ max: number; source: "meta" | "table" | "default"; calibration: number; providerType: string }> {
  const row = await qone(getDb().select().from(llmProviders).where(eq(llmProviders.id, providerId)));
  const entry = row?.modelMeta?.[modelId];
  const resolved = resolveContextLength({ modelId, storedLength: entry?.contextLength });
  return {
    max: resolved.max,
    source: resolved.source,
    calibration: clampCalibration(entry?.calibration ?? 1),
    providerType: row?.provider ?? "custom",
  };
}

export function compactThresholds(contextMax: number): { background: number; safety: number } {
  if (contextMax <= 8_192) return { background: 0.85, safety: 0.92 };
  if (contextMax <= 32_768) return { background: 0.7, safety: 0.85 };
  return { background: 0.5, safety: 0.85 };
}

export function isContextOverflow(message: string): boolean {
  return /context length|context window|maximum context|too many tokens|prompt is too long|input is too long|exceeds the context|token limit/i.test(message);
}

export function learnedContextLimit(message: string): number | null {
  const match = message.match(/(?:maximum|max(?:imum)? context|limit)[^0-9]{0,40}(\d{4,7})/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 1024 || n > 2_000_000) return null;
  return n;
}
