export function tapContextUsage(res: Response): Response {
  if (!res.body) return res;
  const [watch, pass] = res.body.tee();
  void readContextUsage(watch);
  return new Response(pass, { status: res.status, statusText: res.statusText, headers: res.headers });
}

export function publishContextUsage(detail: unknown) {
  window.dispatchEvent(new CustomEvent("nonla-context-usage", { detail }));
}

async function readContextUsage(body: ReadableStream<Uint8Array>): Promise<void> {
  const text = await new Response(body).text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    try {
      const json = JSON.parse(trimmed.slice(5).trim()) as { type?: string; name?: string; value?: unknown };
      if (json.type === "CUSTOM" && json.name === "context-usage") {
        publishContextUsage(json.value);
      }
    } catch {
      /* ignore partial frames */
    }
  }
}
