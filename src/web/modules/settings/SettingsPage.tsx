import { Tabs } from "devnonla-ui";
import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";

import { ApiKeysPage } from "./api-keys/ApiKeysPage";
import { SETTINGS_TABS, type SettingsTab } from "./common/constants";
import { GeneralPage } from "./general/GeneralPage";

const TAB_COMPONENTS: Record<SettingsTab, React.ComponentType> = {
  general: GeneralPage,
  "api-keys": ApiKeysPage,
};

const TAB_DESCRIPTION: Record<SettingsTab, string> = {
  general: "Workspace-wide preferences.",
  "api-keys": "Create keys to access datatables and KV over HTTP.",
};

function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.key === value);
}

function useActiveTab(): SettingsTab | null {
  const { pathname } = useLocation();
  const segment = pathname.split("/").filter(Boolean)[1] ?? "";
  return isSettingsTab(segment) ? segment : null;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeTab = useActiveTab();

  useEffect(() => {
    if (pathname === "/settings" || pathname === "/settings/") {
      navigate("/settings/general", { replace: true });
    }
  }, [pathname, navigate]);

  if (!activeTab) {
    return <Navigate to="/settings/general" replace />;
  }

  return (
    <PageShell className="h-full min-h-0 overflow-y-auto">
      <PageHeader title="Settings" icon="settings" description={TAB_DESCRIPTION[activeTab]} className="mb-6" />
      <Tabs
        aria-label="Settings sections"
        activeKey={activeTab}
        onChange={(key) => {
          if (isSettingsTab(key)) navigate(`/settings/${key}`);
        }}
        items={SETTINGS_TABS.map((tab) => {
          const Panel = TAB_COMPONENTS[tab.key];
          return { key: tab.key, label: tab.label, children: tab.key === activeTab ? <Panel /> : null };
        })}
      />
    </PageShell>
  );
}
