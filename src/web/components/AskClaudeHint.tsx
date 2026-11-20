export function AskClaudeHint({ what, tool }: { what: string; tool: string }) {
  return (
    <p className="m-0 mt-2 max-w-md text-center text-[12px] leading-relaxed text-tertiary-foreground">
      Ask Claude Code to create a {what} through the Core MCP (<code className="font-mono text-[11px]">{tool}</code>).
    </p>
  );
}
