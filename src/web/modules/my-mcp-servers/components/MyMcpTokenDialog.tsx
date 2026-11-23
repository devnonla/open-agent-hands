import { Alert, Button, Icon, Modal, OverlayScroll } from "devnonla-ui";
import { useState } from "react";
import type { MyMcpServer } from "src/common/types";
import { copyText } from "../common/copy";
import { mcpEndpointUrl, mcpServerAgentPrompt } from "../common/snippets";

export function MyMcpTokenDialog({ server, onClose }: { server: MyMcpServer; onClose: () => void }) {
  const secret = server.key?.trim() ?? "";
  const url = mcpEndpointUrl(server.id);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const prompt = mcpServerAgentPrompt(
    server.name,
    url,
    secret,
    (server.tools ?? []).map((t) => t.name),
  );

  const handleCopyPrompt = async () => {
    if (!(await copyText(prompt, "Setup prompt copied. Paste it into your agent."))) return;
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 2000);
  };

  const handleCopy = async () => {
    if (!(await copyText(secret, "Token copied"))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal
      open
      title={`Connect "${server.name}"`}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          I have saved the token
        </Button>
      }
      destroyOnHidden
      width={640}
      centered
      maskClosable={false}
    >
      <div className="flex flex-col gap-4 pt-1">
        <Alert type="warning" showIcon title="This token is shown only once" description="Copy the prompt or the token now. Anyone with it can run the tools on this server." />

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">Paste this into Claude Code, Codex, Cursor or any agent. The token is already in it.</span>
            <Button type="primary" icon={<Icon name={promptCopied ? "check" : "copy"} size={14} />} onClick={() => void handleCopyPrompt()}>
              {promptCopied ? "Copied" : "Copy setup prompt"}
            </Button>
          </div>
          <OverlayScroll autoHeight className="max-h-52 rounded-lg border border-border bg-background">
            <pre className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere] px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">{prompt}</pre>
          </OverlayScroll>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-muted/60 py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground">
          <span className="w-12 shrink-0">Token</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{secret}</code>
          <Button type="text" size="small" icon={<Icon name={copied ? "check" : "copy"} size={12} />} onClick={() => void handleCopy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
