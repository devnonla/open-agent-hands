import { Icon, Select, message } from "devnonla-ui";
import { useCallback, useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import { SettingKey } from "src/common/enum";
import { invalidateAppTimezoneCache } from "src/common/hooks/useAppTimezone";
import { SectionCard } from "src/components/SectionCard";
import { getSettingValues, saveSettingValues } from "src/modules/settings/common/settingsApi";

export function TimezoneSection() {
  const [currentTz, setCurrentTz] = useState("UTC");
  const [tzList, setTzList] = useState<{ tz: string; offset: string }[]>([]);
  const [loadingTz, setLoadingTz] = useState(true);

  useEffect(() => {
    getSettingValues([SettingKey.Timezone]).then((s) => {
      if (s[SettingKey.Timezone]) setCurrentTz(s[SettingKey.Timezone]);
    });
    apiClient
      .get<{ tz: string; offset: string }[]>("/api/settings/timezones")
      .then(setTzList)
      .catch(() => setTzList([]))
      .finally(() => setLoadingTz(false));
  }, []);

  const tzOptions = tzList.map(({ tz, offset }) => ({
    value: tz,
    label: `${tz} (${offset})`,
  }));

  const selected = tzList.find((item) => item.tz === currentTz);

  const handleTzChange = useCallback(async (value: string) => {
    try {
      setCurrentTz(value);
      await saveSettingValues({ [SettingKey.Timezone]: value });
      invalidateAppTimezoneCache();
      message.success("Timezone saved");
    } catch {
      message.error("Failed to save timezone");
    }
  }, []);

  return (
    <SectionCard title="Timezone" description="Used for scheduled tasks and time display in agent system prompts.">
      <div className="flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
          <Icon name="clock" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <Select value={currentTz} onChange={handleTzChange} options={tzOptions} placeholder={loadingTz ? "Loading timezones…" : "Search timezone…"} disabled={loadingTz} showSearch={{ optionFilterProp: "label" }} className="w-full" />
          {selected ? <p className="mt-2 mb-0 text-[11px] tabular-nums text-tertiary-foreground">Offset {selected.offset}</p> : null}
        </div>
      </div>
    </SectionCard>
  );
}
