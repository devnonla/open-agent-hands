import { Button, Icon, Popconfirm, message } from "devnonla-ui";
import { RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { apiClient } from "src/common/api";
import type { MyMcpServer } from "src/common/types";
import { useAppDispatch } from "src/store/store";
import { copyText } from "../common/copy";
import { toMyMcpServerListItem, upsertMyMcpServerLocal } from "../common/myMcpServersSlice";
import { mcpEndpointUrl } from "../common/snippets";
import { ConnectSnippet } from "./ConnectSnippet";

const TOKEN_PLACEHOLDER = "YOUR_TOKEN";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {children}
      </div>
    </div>
  );
}

export function McpConnectPanel({ server, onRotated }: { server: MyMcpServer; onRotated: (server: MyMcpServer) => void }) {
  const dispatch = useAppDispatch();
  const [urlCopied, setUrlCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const url = mcpEndpointUrl(server.id);

  const handleCopyUrl = async () => {
    if (!(await copyText(url, "URL copied"))) return;
    setUrlCopied(true);
    window.setTimeout(() => setUrlCopied(false), 1500);
  };

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

  return (
    <div className="flex flex-col gap-5">
      <Step n={1} title="Endpoint URL">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card py-1 pr-1 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{url}</span>
          <Button type="text" size="small" icon={<Icon name={urlCopied ? "check" : "copy"} size={13} />} onClick={() => void handleCopyUrl()}>
            {urlCopied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Step>

      <Step n={2} title="Token">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card py-1.5 pr-1.5 pl-3">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{server.keyPrefix}…</span>
          <Popconfirm title="Rotate token?" description="The current token stops working immediately. You will get a new one to copy." okText="Rotate" onConfirm={() => void handleRotate()} styles={{ root: { width: 300 } }}>
            <Button size="small" icon={<RefreshCw size={13} />} loading={rotating}>
              Rotate
            </Button>
          </Popconfirm>
        </div>
        <p className="m-0 text-[11px] text-tertiary-foreground">Each server has its own token, shown once when it is created. Lost it? Rotate to get a new one.</p>
      </Step>

      <Step n={3} title="Add to your client">
        <ConnectSnippet name={server.name} url={url} token={TOKEN_PLACEHOLDER} defaultClient="claude-cli" />
        <p className="m-0 text-[11px] text-tertiary-foreground">
          Replace <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{TOKEN_PLACEHOLDER}</code> with your token and keep it private.
        </p>
      </Step>
    </div>
  );
}
