import { Alert, Button, Icon, Modal } from "devnonla-ui";
import { useState } from "react";
import type { MyMcpServer } from "src/common/types";
import { copyText } from "../common/copy";
import { mcpEndpointUrl } from "../common/snippets";
import { ConnectSnippet } from "./ConnectSnippet";

export function MyMcpTokenDialog({ server, onClose }: { server: MyMcpServer; onClose: () => void }) {
  const secret = server.key?.trim() ?? "";
  const url = mcpEndpointUrl(server.id);
  const [copied, setCopied] = useState(false);

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
        <Alert type="warning" showIcon title="Copy your token now" description="It is shown only once. Anyone with it can run the tools on this server." />

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-foreground">Your token</span>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card py-1 pr-1 pl-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{secret}</span>
            <Button type="primary" size="small" icon={<Icon name={copied ? "check" : "copy"} size={13} />} onClick={() => void handleCopy()}>
              {copied ? "Copied" : "Copy token"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-foreground">Add to your client</span>
          <p className="m-0 text-[12px] text-tertiary-foreground">The config below already contains your token.</p>
          <ConnectSnippet name={server.name} url={url} token={secret || "YOUR_TOKEN"} maxHeightClass="max-h-44" />
        </div>
      </div>
    </Modal>
  );
}
