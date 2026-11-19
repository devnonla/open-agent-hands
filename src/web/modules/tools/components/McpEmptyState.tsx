import { Button } from "devnonla-ui";
import { Plus } from "lucide-react";
import { FeatureIcon } from "src/components/FeatureIcon";

const STEPS = ["Paste the server URL", "Add auth headers if needed", "Tools sync automatically"];

/** First-run empty state: explains what MCP is and the one action to take. */
export function McpEmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted ring-1 ring-border-subtle">
        <FeatureIcon name="mcp" size={32} variant="sticker" />
      </div>
      <div className="max-w-md">
        <h2 className="m-0 text-base font-semibold text-foreground">Connect your first MCP server</h2>
        <p className="mt-1.5 mb-0 text-sm text-muted-foreground">MCP servers give your agents extra tools — files, databases, APIs. Connect one and assign its tools to any agent.</p>
      </div>
      <ol className="m-0 flex list-none flex-wrap items-center justify-center gap-x-6 gap-y-2 p-0">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <Button type="primary" icon={<Plus size={16} />} onClick={onConnect}>
        Connect server
      </Button>
    </div>
  );
}
