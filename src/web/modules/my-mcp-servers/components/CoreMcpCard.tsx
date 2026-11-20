import { Button, Icon, Modal, Tag, Tooltip, message } from "devnonla-ui";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import { AppMark } from "src/components/AppLogo";
import { copyText } from "../common/copy";
import { ConnectSnippet } from "./ConnectSnippet";

type CoreMcpInfo = { path: string; key: string; toolCount: number; groups: { group: string; tools: { name: string; description: string }[] }[] };

function maskKey(key: string): string {
  return `${key.slice(0, 12)}${"•".repeat(16)}${key.slice(-4)}`;
}

export function CoreMcpCard() {
  const [info, setInfo] = useState<CoreMcpInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showTools, setShowTools] = useState(false);

  useEffect(() => {
    apiClient
      .get<CoreMcpInfo>("/api/core-mcp")
      .then(setInfo)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load core MCP"));
  }, []);

  const rotate = () => {
    Modal.confirm({
      title: "Rotate core MCP key?",
      content: "Clients using the current key will stop working until you update them with the new key.",
      okText: "Rotate",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        try {
          const next = await apiClient.post<{ path: string; key: string }>("/api/core-mcp/rotate");
          setInfo((prev) => (prev ? { ...prev, key: next.key } : prev));
          setRevealed(true);
          message.success("Core MCP key rotated");
        } catch (err) {
          message.error(err instanceof Error ? err.message : "Failed to rotate key");
        }
      },
    });
  };

  if (error) {
    return (
      <div role="alert" className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
        <p className="m-0 text-xs font-medium text-destructive">{error}</p>
      </div>
    );
  }
  if (!info) return null;

  const url = `${window.location.origin}${info.path}`;

  return (
    <section className="mb-8 overflow-hidden rounded-lg border border-primary/30 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <AppMark size={32} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h2 className="m-0 text-[15px] font-semibold text-foreground">Core MCP</h2>
              <Tag className="m-0! rounded-md text-[10px] leading-none">Built-in</Tag>
            </div>
            <p className="m-0 text-xs text-muted-foreground">Lets Claude Code or Codex manage every workspace: tools, MCP servers, KV, secrets, datatables, sites and jobs ({info.toolCount} tools).</p>
          </div>
        </div>
        <Tooltip title="Rotate key">
          <Button type="text" size="small" icon={<RefreshCw size={14} />} onClick={rotate}>
            Rotate key
          </Button>
        </Tooltip>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Endpoint</span>
            <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{url}</code>
              <Button type="text" size="small" icon={<Icon name="copy" size={13} />} aria-label="Copy endpoint" onClick={() => void copyText(url, "Endpoint copied")} />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Bearer key</span>
            <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{revealed ? info.key : maskKey(info.key)}</code>
              <Button type="text" size="small" icon={revealed ? <EyeOff size={13} /> : <Eye size={13} />} aria-label={revealed ? "Hide key" : "Show key"} onClick={() => setRevealed((v) => !v)} />
              <Button type="text" size="small" icon={<Icon name="copy" size={13} />} aria-label="Copy key" onClick={() => void copyText(info.key, "Key copied")} />
            </div>
          </div>
        </div>

        <ConnectSnippet name="agenthands" url={url} token={info.key} defaultClient="claude-cli" maxHeightClass="max-h-40" />

        <div>
          <Button type="link" size="small" className="px-0!" onClick={() => setShowTools((v) => !v)}>
            {showTools ? "Hide tools" : `Show ${info.toolCount} tools`}
          </Button>
          {showTools ? (
            <dl className="m-0 mt-2 flex flex-col divide-y divide-border rounded-md border border-border bg-background">
              {info.groups.map(({ group, tools }) => (
                <div key={group} className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
                  <dt className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group} <span className="font-normal">({tools.length})</span>
                  </dt>
                  <dd className="m-0 flex min-w-0 flex-wrap gap-1">
                    {tools.map((tool) => (
                      <Tooltip key={tool.name} title={tool.description}>
                        <code className="cursor-default rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:border-primary/40">{tool.name}</code>
                      </Tooltip>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </section>
  );
}
