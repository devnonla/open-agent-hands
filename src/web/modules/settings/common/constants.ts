export type SettingsTab = "general" | "api-keys";

export const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "api-keys", label: "API Keys" },
];
