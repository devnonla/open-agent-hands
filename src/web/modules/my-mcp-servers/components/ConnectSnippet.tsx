import { Button, Icon, Segmented } from "devnonla-ui";
import { useState } from "react";
import { copyText } from "../common/copy";
import { claudeCodeMcpSnippet, cursorMcpSnippet } from "../common/snippets";

type Client = "cursor" | "claude";

const CLIENT_HINT: Record<Client, string> = {
  cursor: "Paste into ~/.cursor/mcp.json (global) or .cursor/mcp.json (this project).",
  claude: "Paste into .mcp.json at your project root, then restart Claude Code.",
};

export function ConnectSnippet({ name, url, token, maxHeightClass = "max-h-56" }: { name: string; url: string; token: string; maxHeightClass?: string }) {
  const [client, setClient] = useState<Client>("cursor");
  const [copied, setCopied] = useState(false);
  const value = client === "cursor" ? cursorMcpSnippet(name, url, token) : claudeCodeMcpSnippet(name, url, token);

  const handleCopy = async () => {
    if (!(await copyText(value, "Config copied"))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          size="small"
          value={client}
          onChange={(v) => setClient(v as Client)}
          options={[
            { label: "Cursor", value: "cursor" },
            { label: "Claude Code", value: "claude" },
          ]}
        />
        <Button type="text" size="small" icon={<Icon name={copied ? "check" : "copy"} size={13} />} onClick={() => void handleCopy()}>
          {copied ? "Copied" : "Copy config"}
        </Button>
      </div>
      <pre className={`m-0 overflow-auto rounded-lg border border-border bg-card px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground ${maxHeightClass}`}>{value}</pre>
      <p className="m-0 text-[11px] text-tertiary-foreground">{CLIENT_HINT[client]}</p>
    </div>
  );
}
