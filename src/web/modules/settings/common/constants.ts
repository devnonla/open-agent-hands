export type SettingsTab = "general";

export const SETTINGS_TABS: { key: SettingsTab; label: string; description: string; icon: "monitor" }[] = [
  { key: "general", label: "General", description: "Timezone and sandbox for the whole app.", icon: "monitor" },
];
