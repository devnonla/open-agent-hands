export type SettingsTab = "general" | "api-keys";

export const SETTINGS_TABS: { key: SettingsTab; label: string; description: string; icon: "monitor" | "shield-check" }[] = [
  { key: "general", label: "General", description: "Timezone and sandbox for the whole app.", icon: "monitor" },
  { key: "api-keys", label: "API keys", description: "Keys that read and write datatables and KV over HTTP.", icon: "shield-check" },
];
