export type NormalizedUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  contextTokens: number;
  valid: boolean;
  suspicious: boolean;
};

const EMPTY: NormalizedUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  contextTokens: 0,
  valid: false,
  suspicious: false,
};

function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function pickUsage(source: unknown): Record<string, unknown> | null {
  const record = asRecord(source);
  if (!record) return null;
  const nested = asRecord(record.usage_metadata) ?? asRecord(record.usage);
  return nested ?? record;
}

export function normalizeUsage(source: unknown, opts: { contextMax?: number; estimatedInputTokens?: number } = {}): NormalizedUsage {
  const raw = pickUsage(source);
  if (!raw) return { ...EMPTY };

  const inputDetails = asRecord(raw.input_token_details) ?? asRecord(raw.prompt_tokens_details) ?? asRecord(raw.input_tokens_details);
  const outputDetails = asRecord(raw.output_token_details) ?? asRecord(raw.completion_tokens_details);

  const inputTokens = num(raw.input_tokens ?? raw.prompt_tokens ?? raw.promptTokenCount);
  const outputTokens = num(raw.output_tokens ?? raw.completion_tokens ?? raw.candidatesTokenCount);
  const totalTokens = num(raw.total_tokens ?? raw.totalTokenCount);
  const cacheReadTokens = num(inputDetails?.cache_read ?? inputDetails?.cached_tokens ?? raw.cache_read_input_tokens ?? raw.cachedContentTokenCount);
  const cacheWriteTokens = num(inputDetails?.cache_creation ?? inputDetails?.cache_write ?? raw.cache_creation_input_tokens);
  let reasoningTokens = num(outputDetails?.reasoning ?? outputDetails?.reasoning_tokens ?? raw.thoughtsTokenCount);
  if (reasoningTokens === 0 && totalTokens > inputTokens + outputTokens) {
    reasoningTokens = totalTokens - inputTokens - outputTokens;
  }

  const contextTokens = inputTokens + Math.max(0, outputTokens - reasoningTokens);
  const estimated = opts.estimatedInputTokens ?? 0;
  const overMax = opts.contextMax != null && opts.contextMax > 0 && contextTokens > opts.contextMax;
  const farFromEstimate = estimated >= 200 && contextTokens > estimated * 3;
  const suspicious = inputTokens > 0 && (overMax || farFromEstimate);
  const valid = inputTokens > 0 && !suspicious;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    contextTokens,
    valid,
    suspicious,
  };
}
