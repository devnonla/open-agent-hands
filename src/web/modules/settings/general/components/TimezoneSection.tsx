import { Card, Select, message } from "devnonla-ui";
import { useCallback, useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import { SettingKey } from "src/common/enum";
import { invalidateAppTimezoneCache } from "src/common/hooks/useAppTimezone";
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
    <Card title="Time">
      <Card.Item label="Timezone" description={selected ? `Job schedules and every time in the app use it. Offset ${selected.offset}.` : "Job schedules and every time in the app use it."} align="center" split>
        <Select value={currentTz} onChange={handleTzChange} options={tzList.map(({ tz, offset }) => ({ value: tz, label: `${tz} (${offset})` }))} placeholder={loadingTz ? "Loading timezones…" : "Search timezone…"} disabled={loadingTz} showSearch={{ optionFilterProp: "label" }} className="w-full" />
      </Card.Item>
    </Card>
  );
}
