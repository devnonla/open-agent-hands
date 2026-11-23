import { type NonlaColorPreference, Segmented, message, setColorPreference, useColorPreference, Icon } from "devnonla-ui";
import { useState } from "react";
import { apiClient } from "src/common/api";
import { setUserTheme } from "src/common/authSlice";
import { SectionCard } from "src/components/SectionCard";
import { useAppDispatch } from "src/store/store";

const OPTIONS: { value: NonlaColorPreference; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "System", icon: <Icon name="monitor" size={14} /> },
  { value: "light", label: "Light", icon: <Icon name="sun" size={14} /> },
  { value: "dark", label: "Dark", icon: <Icon name="moon" size={14} /> },
];

export function AppearanceSection() {
  const dispatch = useAppDispatch();
  const preference = useColorPreference();
  const [saving, setSaving] = useState(false);

  const change = async (next: NonlaColorPreference) => {
    const previous = preference;
    setColorPreference(next);
    setSaving(true);
    try {
      await apiClient.patch("/api/auth/update-profile", { theme: next });
      dispatch(setUserTheme(next));
    } catch (err) {
      setColorPreference(previous);
      message.error(err instanceof Error ? err.message : "Failed to save theme");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Theme" description="Saved to your account, so every browser you sign in from uses it. System follows your OS.">
      <Segmented
        value={preference}
        disabled={saving}
        onChange={(value) => void change(value as NonlaColorPreference)}
        options={OPTIONS.map((option) => ({
          value: option.value,
          label: (
            <span className="inline-flex items-center gap-1.5">
              {option.icon}
              {option.label}
            </span>
          ),
        }))}
      />
    </SectionCard>
  );
}
