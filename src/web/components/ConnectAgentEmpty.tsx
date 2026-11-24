import { ConnectAgentPanel } from "./ConnectAgentPanel";

export function ConnectAgentEmpty({ title, what, tool, className }: { title: string; what: string; tool: string; className?: string }) {
  return (
    <ConnectAgentPanel
      className={className}
      title={title}
      description={
        <>
          Connect your agent, then ask it to create a {what} (<code className="font-mono text-xs">{tool}</code>).
        </>
      }
    />
  );
}
