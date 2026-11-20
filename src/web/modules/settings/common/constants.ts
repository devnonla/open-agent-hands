export type SettingsTab = "general" | "workspace" | "api-keys";

export const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "workspace", label: "Workspace" },
  { key: "api-keys", label: "API Keys" },
];
