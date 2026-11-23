import { Button, Card, Icon, Modal, OverlayScroll, PageHeader, Tag, Tooltip, message } from "devnonla-ui";
import { PageBand } from "src/components/PageShell";
import { useState } from "react";
import { apiClient } from "src/common/api";
import { AppMark } from "src/components/AppLogo";
import { copyText } from "../common/copy";
import { coreMcpAgentPrompt } from "../common/snippets";
import { McpLogo } from "./McpLogo";

export type CoreMcpInfo = { path: string; key: string; toolCount: number; groups: { group: string; tools: { name: string; description: string }[] }[] };

function maskKey(key: string): string {
  return `${key.slice(0, 12)}${"•".repeat(16)}${key.slice(-4)}`;
}

export function CoreMcpDetail({ info, onKeyRotated }: { info: CoreMcpInfo; onKeyRotated: (key: string) => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${info.path}`;
  const prompt = coreMcpAgentPrompt(url, info.key);

  const copyPrompt = async () => {
    if (!(await copyText(prompt, "Setup prompt copied. Paste it into your agent."))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const rotate = () => {
    Modal.confirm({
      title: "Rotate core MCP key?",
      content: "Agents using the current key stop working until you give them the new prompt.",
      okText: "Rotate",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        try {
          const next = await apiClient.post<{ path: string; key: string }>("/api/core-mcp/rotate");
          onKeyRotated(next.key);
          message.success("Core MCP key rotated");
        } catch (err) {
          message.error(err instanceof Error ? err.message : "Failed to rotate key");
        }
      },
    });
  };

  return (
    <>
      <PageBand
        width="max-w-3xl"
        header={
          <PageHeader
            bordered={false}
            className="mb-0 pb-0"
            title={
              <span className="inline-flex items-center gap-3 text-xl">
                <span className="flex items-center">
                  <AppMark size={40} />
                  <span aria-hidden className="mx-1 h-px w-4 bg-[repeating-linear-gradient(90deg,var(--brand)_0_3px,transparent_3px_6px)] opacity-60" />
                  <span className="flex size-10 items-center justify-center rounded-xl border border-border bg-card text-foreground">
                    <McpLogo size={20} />
                  </span>
                </span>
                Core MCP
              </span>
            }
            meta={<Tag color="brand">Built in</Tag>}
            description={<span className="block pl-[116px]">Lets your agent manage everything here.</span>}
          />
        }
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-10 pt-6 pb-12">

      <Card title="Connect your agent" caption="The prompt contains the key. Treat it like a password.">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="m-0 min-w-0 flex-1 text-sm text-muted-foreground">Paste this into Claude Code, Codex, Cursor or any agent. It adds the server and checks that it works.</p>
            <Button type="primary" icon={<Icon name={copied ? "check" : "copy"} size={14} />} onClick={() => void copyPrompt()}>
              {copied ? "Copied" : "Copy setup prompt"}
            </Button>
          </div>
          <OverlayScroll autoHeight className="max-h-56 rounded-lg border border-border bg-background">
            <pre className="m-0 whitespace-pre-wrap px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">{coreMcpAgentPrompt(url, maskKey(info.key))}</pre>
          </OverlayScroll>
        </div>
        <Card.Item align="center" label="Endpoint">
          <span className="flex min-w-0 items-center gap-1">
            <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">{url}</code>
            <Button type="text" size="small" icon={<Icon name="copy" size={12} />} onClick={() => void copyText(url, "URL copied")} aria-label="Copy endpoint" />
          </span>
        </Card.Item>
        <Card.Item align="center" label="Key" description="Agents using the current key stop working when you rotate it.">
          <span className="flex items-center gap-2">
            <code className="font-mono text-xs text-muted-foreground">{maskKey(info.key)}</code>
            <Tooltip title="Get a new key">
              <Button size="small" icon={<Icon name="refresh" size={12} />} onClick={rotate}>
                Rotate
              </Button>
            </Tooltip>
          </span>
        </Card.Item>
      </Card>

      <Card title={`Tools (${info.toolCount})`} caption="Hover a tool to read what it does.">
        {info.groups.map(({ group, tools }) => (
          <Card.Item key={group} label={group} description={`${tools.length} ${tools.length === 1 ? "tool" : "tools"}`} split>
            <span className="flex flex-wrap justify-end gap-1">
              {tools.map((tool) => (
                <Tooltip key={tool.name} title={tool.description}>
                  <code className="cursor-default rounded border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-foreground">{tool.name}</code>
                </Tooltip>
              ))}
            </span>
          </Card.Item>
        ))}
      </Card>
      </div>
    </>
  );
}
