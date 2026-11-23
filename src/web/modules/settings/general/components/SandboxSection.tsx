import { Card, Skeleton, Switch, Tag, message } from "devnonla-ui";
import { useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import { SettingKey } from "src/common/enum";
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
      message.success(enabled ? "Sandbox on" : "Sandbox off");
    } catch {
      message.error("Failed to save sandbox setting");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Security" caption="Off by default: tool and site backend code runs as your user with full file access.">
      <Card.Item
        label={
          <span className="inline-flex items-center gap-2">
            Sandbox
            {status ? <Tag color={status.enabled ? "success" : "default"}>{status.enabled ? "On" : "Off"}</Tag> : null}
          </span>
        }
        description="Run tool and site backend code inside an OS sandbox. They can only write inside their own folder."
        align="center"
      >
        <Switch checked={!!status?.enabled} disabled={!status || saving} onChange={(checked: boolean) => void toggle(checked)} aria-label="Enable sandbox" />
      </Card.Item>
      <Card.Item label="Backend" description={status && !status.available ? "Code runs unsandboxed even when the switch is on." : undefined} align="center">
        {status ? <Tag color={status.available ? "success" : "warning"}>{status.available ? `${status.backend} on ${status.platform}` : `Not available on ${status.platform}`}</Tag> : <Skeleton.Input active />}
      </Card.Item>
    </Card>
  );
}
