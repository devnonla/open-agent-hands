import { Button, Card, Input, Popover, message } from "devnonla-ui";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingKey } from "src/common/enum";
import { type PublicUrlInfo, loadPublicUrl, usePublicUrl } from "src/common/hooks/usePublicUrl";
import { saveSettingValues } from "src/modules/settings/common/settingsApi";

function PublicUrlHelp({ info }: { info: PublicUrlInfo | null }) {
  return (
    <div className="flex max-w-80 flex-col gap-2 text-sm">
      <p className="m-0">Tools, jobs and agents get full links to public files and sites, for example:</p>
      <code className="block truncate rounded bg-muted px-2 py-1 text-xs">{info?.effective ?? window.location.origin}/public/storage/…</code>
    </div>
  );
}

export function PublicUrlSection() {
  const info = usePublicUrl();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (info) setValue(info.configured);
  }, [info]);

  const save = async () => {
    setSaving(true);
    try {
      await saveSettingValues({ [SettingKey.PublicUrl]: value.trim() });
      await loadPublicUrl(true);
      message.success("Public URL saved");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save public URL");
    } finally {
      setSaving(false);
    }
  };

  const dirty = !!info && !!value.trim() && value.trim().replace(/\/+$/, "") !== info.configured;

  return (
    <Card title="Links">
      <Card.Item
        label={
          <>
            Public URL
            <Popover trigger="hover" placement="bottomLeft" mouseEnterDelay={0.15} content={<PublicUrlHelp info={info} />}>
              <span className="inline-flex cursor-help text-muted-foreground hover:text-foreground">
                <Info size={14} />
              </span>
            </Popover>
          </>
        }
        description="Address used in links to public files and sites."
        align="center"
        split
      >
        <div className="flex w-full gap-2">
          <Input value={value} placeholder={window.location.origin} disabled={!info || saving} onChange={(e) => setValue(e.target.value)} onPressEnter={() => dirty && void save()} />
          <Button type="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </Card.Item>
    </Card>
  );
}
