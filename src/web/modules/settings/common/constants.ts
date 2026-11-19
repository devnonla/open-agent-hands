export type SettingsTab = "general" | "providers" | "api-keys" | "users";

export const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "providers", label: "Providers" },
  { key: "api-keys", label: "API Keys" },
  { key: "users", label: "Users" },
];
