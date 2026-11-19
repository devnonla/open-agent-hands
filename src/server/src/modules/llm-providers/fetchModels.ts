/**
 * Server-side model fetcher — gọi đến API endpoint của mỗi provider
 * để lấy danh sách models. Dùng trong:
 * - POST /api/providers (verify + lưu models khi add)
 * - POST /api/providers/:id/refresh-models (refresh lại danh sách)
 */

interface ProviderInfo {
  provider: string;
  apiKey: string;
  customBaseUrl: string;
}

export type FetchedModels = { models: string[]; contextLengths: Record<string, number> };

const CONTEXT_KEYS = ["context_length", "max_model_len", "context_window", "max_context_length", "max_input_tokens", "inputTokenLimit"] as const;

function validLength(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n >= 1024 && n <= 10_000_000 ? n : null;
}

export function pickContextLength(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  for (const key of CONTEXT_KEYS) {
    const n = validLength(record[key]);
    if (n) return n;
  }
  const top = record.top_provider as Record<string, unknown> | undefined;
  const fromTop = validLength(top?.context_length);
  if (fromTop) return fromTop;
  const meta = record.meta as Record<string, unknown> | undefined;
  return validLength(meta?.n_ctx_train);
}

function collect(rows: unknown[], idOf: (row: Record<string, unknown>) => string | null): FetchedModels {
  const contextLengths: Record<string, number> = {};
  const ids: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const id = idOf(record);
    if (!id) continue;
    ids.push(id);
    const length = pickContextLength(record);
    if (length) contextLengths[id] = length;
  }
  return { models: ids.sort(), contextLengths };
}

// ─── Per-provider meta (default base URLs) ─────────────────────────────────────

const DEFAULT_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434",
  google: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com",
};

// ─── Main export ────────────────────────────────────────────────────────────────

/**
 * Fetch model list from a provider.
 * Throws on network/auth errors so caller can return 4xx/5xx.
 */
export async function fetchModelsForProvider(p: ProviderInfo): Promise<string[]> {
  return (await fetchModelCatalog(p)).models;
}

export async function fetchModelCatalog(p: ProviderInfo): Promise<FetchedModels> {
  const base = p.customBaseUrl.trim();

  switch (p.provider) {
    case "openai":
    case "custom":
      return fetchOpenAiCompatibleModels(p.apiKey, base || DEFAULT_BASE.openai || "https://api.openai.com/v1");

    case "openrouter":
      return fetchOpenRouterModels(p.apiKey, base || DEFAULT_BASE.openrouter || "https://openrouter.ai/api/v1");

    case "ollama":
      return fetchOllamaModels(base || DEFAULT_BASE.ollama || "http://localhost:11434");

    case "google":
      return fetchGoogleModels(p.apiKey, base || DEFAULT_BASE.google || "https://generativelanguage.googleapis.com/v1beta");

    case "anthropic":
      return fetchAnthropicModels(p.apiKey, base || DEFAULT_BASE.anthropic || "https://api.anthropic.com");

    default:
      // Thử OpenAI-compatible nếu có base URL custom
      if (base) return fetchOpenAiCompatibleModels(p.apiKey, base);
      return { models: [], contextLengths: {} };
  }
}

// ─── Per-provider fetchers ──────────────────────────────────────────────────────

async function fetchOpenAiCompatibleModels(apiKey: string, baseUrl: string): Promise<FetchedModels> {
  const url = baseUrl.replace(/\/$/, "");
  const res = await fetch(`${url}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`/models: ${res.status} ${res.statusText}`);
  const json = await res.json();
  return collect(json.data ?? [], (row) => (typeof row.id === "string" ? row.id : null));
}

async function fetchOpenRouterModels(apiKey: string, baseUrl: string): Promise<FetchedModels> {
  const url = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "HTTP-Referer": "https://github.com/devnonla/nonla-agents",
    "X-Title": "Nonla Agents",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${url}/models`, { headers });
  if (!res.ok) throw new Error(`OpenRouter /models: ${res.status}`);
  const json = await res.json();
  return collect(json.data ?? [], (row) => (typeof row.id === "string" ? row.id : null));
}

async function ollamaContextLength(base: string, name: string): Promise<number | null> {
  try {
    const res = await fetch(`${base}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { model_info?: Record<string, unknown> };
    for (const [key, value] of Object.entries(json.model_info ?? {})) {
      if (key.endsWith(".context_length")) return validLength(value);
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchOllamaModels(endpoint: string): Promise<FetchedModels> {
  const base = endpoint.replace(/\/$/, "");
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) throw new Error(`Ollama /api/tags: ${res.status}`);
  const json = await res.json();
  const names: string[] = (json.models ?? []).map((m: { name: string }) => m.name).sort();
  const contextLengths: Record<string, number> = {};
  for (let i = 0; i < names.length; i += 6) {
    const batch = names.slice(i, i + 6);
    const lengths = await Promise.all(batch.map((name) => ollamaContextLength(base, name)));
    batch.forEach((name, index) => {
      const length = lengths[index];
      if (length) contextLengths[name] = length;
    });
  }
  return { models: names, contextLengths };
}

async function fetchGoogleModels(apiKey: string, baseUrl = "https://generativelanguage.googleapis.com/v1beta"): Promise<FetchedModels> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/v1beta/models?key=${apiKey}`);
  if (!res.ok) throw new Error(`Google /models: ${res.status}`);
  const json = await res.json();
  return collect(json.models ?? [], (row) => (typeof row.name === "string" ? row.name.replace("models/", "") : null));
}

async function fetchAnthropicModels(apiKey: string, baseUrl = "https://api.anthropic.com"): Promise<FetchedModels> {
  const root = baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "x-api-key": apiKey,
  };

  const rows: unknown[] = [];
  let afterId: string | undefined;

  for (;;) {
    const params = new URLSearchParams({ limit: "1000" });
    if (afterId) params.set("after_id", afterId);
    const res = await fetch(`${root}/v1/models?${params}`, { headers });
    if (!res.ok) throw new Error(`Anthropic /v1/models: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      data?: unknown[];
      has_more?: boolean;
      last_id?: string | null;
    };
    rows.push(...(json.data ?? []));
    if (!json.has_more || !json.last_id) break;
    afterId = json.last_id;
  }

  return collect(rows, (row) => (typeof row.id === "string" && row.id ? row.id : null));
}
