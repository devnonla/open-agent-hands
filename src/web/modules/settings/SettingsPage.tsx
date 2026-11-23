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
    if (pathname === "/settings" || pathname === "/settings/") navigate("/settings/general", { replace: true });
  }, [pathname, navigate]);

  if (!activeTab) return <Navigate to="/settings/general" replace />;

  const tab = SETTINGS_TABS.find((t) => t.key === activeTab) ?? SETTINGS_TABS[0];
  const Panel = TAB_COMPONENTS[tab.key];

  return (
    <PageShell
      className="h-full min-h-0 overflow-y-auto"
      header={<PageHeader title="Settings" icon="settings" className="mb-0 pb-0" bordered={false} />}
      tabs={<Tabs aria-label="Settings sections" activeKey={tab.key} onChange={(key) => navigate(`/settings/${key}`)} items={SETTINGS_TABS.map((item) => ({ key: item.key, label: item.label, icon: item.icon }))} />}
    >
      <section className="flex min-w-0 max-w-3xl flex-col gap-6 pt-1">
        <Panel />
      </section>
    </PageShell>
  );
}
