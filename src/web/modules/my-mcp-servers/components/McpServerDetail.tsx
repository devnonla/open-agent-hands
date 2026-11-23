import { Alert, Button, ButtonCopy, Card, CodeBlock, Icon, PageHeader, Popconfirm, Switch, message } from "devnonla-ui";
import { PageBand } from "src/components/PageShell";
import { useState } from "react";
import { apiClient } from "src/common/api";
import { nameAccent } from "src/common/lib/accent";
import { cn } from "src/common/lib/cn";
import type { MyMcpServer } from "src/common/types";
import { formatDateTime, relativeTime } from "src/common/utils/date";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch } from "src/store/store";
import { copyText } from "../common/copy";
import { deleteMyMcpServer, toMyMcpServerListItem, upsertMyMcpServerLocal } from "../common/myMcpServersSlice";
import { useToggleMcpServer } from "../common/useToggleMcpServer";
import { mcpEndpointUrl, mcpServerAgentPrompt, TOKEN_PLACEHOLDER } from "../common/snippets";
import { McpLogo } from "./McpLogo";
import { McpServerToolTree } from "./McpServerToolTree";

export function McpServerDetail({ server, onRotated, onDeleted }: { server: MyMcpServer; onRotated: (server: MyMcpServer) => void; onDeleted: () => void }) {
  const dispatch = useAppDispatch();
  const { toggle, isPending } = useToggleMcpServer();
  const [rotating, setRotating] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const accent = nameAccent(server.name);
  const tools = server.tools ?? [];
  const url = mcpEndpointUrl(server.id);
  const prompt = mcpServerAgentPrompt(
    server.name,
    url,
    TOKEN_PLACEHOLDER,
    tools.map((t) => t.name),
  );

  const handleRotate = async () => {
    setRotating(true);
    try {
      const rotated = await apiClient.post<MyMcpServer>(`/api/my-mcp-servers/${server.id}/rotate-key`);
      dispatch(upsertMyMcpServerLocal(toMyMcpServerListItem(rotated)));
      onRotated(rotated);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
    }
  };

  const handleDelete = async () => {
    try {
      await dispatch(deleteMyMcpServer(server.id)).unwrap();
      message.success(`Deleted ${server.name}`);
      onDeleted();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
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
              <span className="flex min-w-0 items-center gap-3 text-xl">
                <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", !server.isActive && "grayscale")} style={{ background: `color-mix(in oklab, ${accent} 15%, transparent)`, color: accent }}>
                  <McpLogo size={20} />
                </span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{server.name}</span>
              </span>
            }
            description={server.description?.trim() ? <span className="block pl-13">{server.description.trim()}</span> : undefined}
            extra={
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                {server.isActive ? "On" : "Off"}
                <Switch checked={server.isActive} disabled={isPending(server.id)} onChange={(checked) => void toggle(server, checked)} aria-label={server.isActive ? "Turn off" : "Turn on"} />
              </span>
            }
          />
        }
      />
      <div className="@container mx-auto flex w-full max-w-3xl flex-col gap-6 px-10 pt-6 pb-12">

      <RenderIf condition={!server.isActive}>
        <Alert type="warning" showIcon description="This server is off. Clients are rejected until you turn it on." />
      </RenderIf>

      <Card title="Connect" caption="The token is shown only once, so the agent asks you for it. Lost it? Get a new token.">
        <Card.Item label="Setup prompt" description="For Claude Code, Codex or Cursor. The agent adds the server and checks it." align="center" className="flex-col items-stretch! gap-3 @lg:flex-row @lg:items-center!">
          <span className="flex items-center justify-end gap-2">
            <Button size="small" type="text" onClick={() => setShowPrompt((v) => !v)}>
              {showPrompt ? "Hide" : "Preview"}
            </Button>
            <Button size="small" type="primary" icon={<Icon name="copy" size={13} />} onClick={() => void copyText(prompt, "Setup prompt copied. Paste it into your agent.")}>
              Copy prompt
            </Button>
          </span>
        </Card.Item>
        <RenderIf condition={showPrompt}>
          <div className="px-4 pb-3">
            <CodeBlock code={prompt} language="plaintext" title="Setup prompt" wordWrap className="max-h-64 overflow-auto" />
          </div>
        </RenderIf>
        <Card.Item label="Endpoint" description={<code className="font-mono text-xs break-all">{url}</code>} align="center">
          <ButtonCopy text={url} label="Copy endpoint" />
        </Card.Item>
        <Card.Item label="Token" description={<code className="font-mono text-xs">{server.keyPrefix}…</code>} align="center">
          <Popconfirm title="Get a new token?" description="The current token stops working right away. You get a new one, with a prompt that already includes it." okText="Get new token" onConfirm={() => void handleRotate()}>
            <Button size="small" icon={<Icon name="refresh" size={12} />} loading={rotating}>
              New token
            </Button>
          </Popconfirm>
        </Card.Item>
      </Card>

      <Card title={`Tools (${tools.length})`} caption="Switch a tool on to expose it on this server. Changes apply right away.">
        <McpServerToolTree server={server} />
      </Card>

      <Card title="Activity">
        <Card.Item label="Last used" align="center">
          <span className="text-muted-foreground">{server.lastUsedAt ? relativeTime(server.lastUsedAt) : "Never"}</span>
        </Card.Item>
        <Card.Item label="Created" align="center">
          <span className="tabular-nums text-muted-foreground">{formatDateTime(server.createdAt)}</span>
        </Card.Item>
      </Card>

      <Card title="Danger zone">
        <Card.Item label="Delete server" description="Clients using this URL and token stop working. The tools themselves are kept." align="center">
          <Popconfirm title={`Delete ${server.name}?`} description="This cannot be undone." okText="Delete" okType="danger" onConfirm={() => void handleDelete()}>
            <Button danger icon={<Icon name="trash" size={14} />}>
              Delete server
            </Button>
          </Popconfirm>
        </Card.Item>
      </Card>
      </div>
    </>
  );
}
