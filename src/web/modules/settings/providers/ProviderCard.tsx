import { Button, Icon } from "devnonla-ui";
import { ChevronRight, RefreshCw } from "lucide-react";
import type { LlmProvider } from "src/common/types";
import { ProviderIcon } from "src/components/ProviderIcon";
import { getProviderMeta } from "src/modules/llm-providers/common/llmProvidersSlice";

interface ProviderCardProps {
  provider: LlmProvider;
  refreshing: boolean;
  onRefresh: () => void;
  onOpen: () => void;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-tertiary-foreground">{label}</span>
      {children}
    </div>
  );
}

/** One LLM provider: identity header, key + endpoint details, and a footer with actions. */
export function ProviderCard({ provider, refreshing, onRefresh, onOpen }: ProviderCardProps) {
  const meta = getProviderMeta(provider.provider);
  const modelCount = Array.isArray(provider.models) ? provider.models.length : (provider as { countModels?: number }).countModels || 0;
  const masked = provider.maskedApiKey || "••••••••";
  const baseUrl = provider.customBaseUrl || meta.defaultBase;

  return (
    <section onClick={onOpen} className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-all duration-200 hover:border-brand/40 hover:shadow-md">
      <header>
        <button type="button" aria-label={`Open ${provider.label} details`} className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-4 text-left">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted ring-1 ring-border-subtle transition-transform duration-200 group-hover:scale-105">
            <ProviderIcon provider={provider.provider} size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 truncate text-sm font-semibold leading-5 text-foreground" title={provider.label}>
              {provider.label}
            </h2>
            <p className="m-0 mt-0.5 truncate text-xs text-muted-foreground">{meta.label}</p>
          </div>
          <ChevronRight size={18} className="shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 border-t border-border-subtle px-5 py-4 md:grid-cols-3">
        <InfoRow label="API key">
          <div className="flex h-9 items-center gap-2 rounded-lg bg-muted/60 px-3">
            <Icon name="shield-check" size={14} className="shrink-0 text-muted-foreground" />
            <code className="min-w-0 truncate font-mono text-xs text-tertiary-foreground">{masked}</code>
          </div>
        </InfoRow>

        <InfoRow label="Base URL">
          <div className="flex h-9 min-w-0 items-center rounded-lg bg-muted/60 px-3" title={baseUrl || undefined}>
            <code className="min-w-0 truncate font-mono text-xs text-tertiary-foreground">{baseUrl || "Default"}</code>
          </div>
        </InfoRow>

        <InfoRow label="Models">
          <div className="flex h-9 items-center justify-between gap-2 rounded-lg bg-muted/60 pr-1 pl-3">
            <span className="text-xs tabular-nums text-tertiary-foreground">
              {modelCount} model{modelCount !== 1 ? "s" : ""}
            </span>
            <Button
              type="text"
              size="small"
              loading={refreshing}
              icon={<RefreshCw size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
            >
              Sync
            </Button>
          </div>
        </InfoRow>
      </div>
    </section>
  );
}
