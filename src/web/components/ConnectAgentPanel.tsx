import { Button, Icon } from "devnonla-ui";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import { FeatureIcon } from "src/components/FeatureIcon";
import { useCopySetupPrompt } from "src/modules/connect/common/useCopySetupPrompt";

export function ConnectAgentPanel({ title, description, via = "cli", showDetails = true, className }: { title: ReactNode; description: ReactNode; via?: "cli" | "mcp"; showDetails?: boolean; className?: string }) {
  const navigate = useNavigate();
  const { copy, copied } = useCopySetupPrompt(via);

  return (
    <div className={cn("@container", className)}>
      <section className="flex flex-col items-center gap-3 rounded-xl border border-brand/40 bg-[linear-gradient(120deg,color-mix(in_srgb,var(--brand)_12%,transparent),transparent_65%)] px-4 py-4 text-center @xl:flex-row @xl:py-3 @xl:text-left">
        <FeatureIcon name="connect" size={32} variant="sticker" />
        <div className="min-w-0 @xl:flex-1">
          <h2 className="m-0 text-[15px] font-medium leading-snug text-foreground">{title}</h2>
          <p className="m-0 mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
          <Button type="primary" icon={<Icon name={copied ? "check" : "copy"} size={14} />} onClick={() => void copy()}>
            {copied ? "Copied" : "Copy setup prompt"}
          </Button>
          {showDetails ? <Button onClick={() => navigate("/connect")}>Details</Button> : null}
        </div>
      </section>
    </div>
  );
}
