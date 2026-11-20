import { Switch, message } from "devnonla-ui";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import { SettingKey } from "src/common/enum";
import { SectionCard } from "src/components/SectionCard";
import { saveSettingValues } from "src/modules/settings/common/settingsApi";

type SandboxStatus = { enabled: boolean; available: boolean; backend: string | null; platform: string };

export function SandboxSection() {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get<SandboxStatus>("/api/settings/sandbox")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const toggle = async (enabled: boolean) => {
    if (!status) return;
    setSaving(true);
    try {
      await saveSettingValues({ [SettingKey.SandboxEnabled]: enabled ? "true" : "false" });
      setStatus({ ...status, enabled });
      message.success(enabled ? "Sandbox enabled" : "Sandbox disabled");
    } catch {
      message.error("Failed to save sandbox setting");
    } finally {
      setSaving(false);
    }
  };

  const hint = !status
    ? "Loading…"
    : status.available
      ? `Uses ${status.backend} on ${status.platform}. Tools and site backends can only write inside their own folder.`
      : `No sandbox backend available on ${status.platform}${status.backend ? ` (${status.backend} not found)` : ""}. Code runs unsandboxed even when enabled.`;

  return (
    <SectionCard title="Sandbox" description="Run tool and site backend code inside an OS sandbox. Off by default: code runs as your user with full file access.">
      <div className="flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
          <ShieldCheck size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-medium text-foreground">{status?.enabled ? "Sandbox on" : "Sandbox off"}</p>
          <p className="mt-0.5 mb-0 text-[11px] text-tertiary-foreground">{hint}</p>
        </div>
        <Switch checked={!!status?.enabled} disabled={!status || saving} onChange={(checked: boolean) => void toggle(checked)} aria-label="Enable sandbox" />
      </div>
    </SectionCard>
  );
}
