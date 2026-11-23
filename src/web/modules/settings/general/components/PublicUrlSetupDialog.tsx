import { Button, Icon, Input, Modal, message } from "devnonla-ui";
import { useEffect, useState } from "react";
import { SettingKey } from "src/common/enum";
import { loadPublicUrl, usePublicUrl } from "src/common/hooks/usePublicUrl";
import { saveSettingValues } from "src/modules/settings/common/settingsApi";

export function PublicUrlSetupDialog() {
  const info = usePublicUrl();
  const [value, setValue] = useState(window.location.origin);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const open = info?.source === "listen";

  useEffect(() => {
    if (open) setValue(window.location.origin);
  }, [open]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveSettingValues({ [SettingKey.PublicUrl]: value.trim() });
      await loadPublicUrl(true);
      message.success("Setup finished");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save public URL");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} closable={false} maskClosable={false} width={440} centered footer={null}>
      <div className="flex flex-col items-center px-2 pt-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-link-bg text-link">
          <Icon name="globe" size={24} />
        </span>
        <h2 className="mt-4 mb-0 text-lg font-semibold text-foreground">One more setup step</h2>
        <p className="mt-1 mb-0 text-sm text-muted-foreground">Set the address people use to reach this server. Links to public files and sites start with it.</p>
      </div>
      <div className="mt-6 flex flex-col gap-1.5">
        <label htmlFor="public-url-setup" className="text-sm font-medium text-foreground">
          Public URL
        </label>
        <Input id="public-url-setup" size="large" value={value} onChange={(e) => setValue(e.target.value)} onPressEnter={() => void save()} status={error ? "error" : undefined} autoFocus />
        <p className={error ? "m-0 text-xs text-destructive" : "m-0 text-xs text-muted-foreground"}>{error ?? "Filled in with the address you opened this page from."}</p>
      </div>
      <Button type="primary" size="large" block loading={saving} disabled={!value.trim()} onClick={() => void save()} className="mt-6">
        Finish setup
      </Button>
    </Modal>
  );
}
