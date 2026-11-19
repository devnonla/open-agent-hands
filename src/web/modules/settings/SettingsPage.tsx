import { Tabs } from "devnonla-ui";
import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { fetchLlmProviders } from "src/modules/llm-providers/common/llmProvidersSlice";
import { useAppDispatch } from "src/store/store";

import { ApiKeysPage } from "./api-keys/ApiKeysPage";
import { SETTINGS_TABS, type SettingsTab } from "./common/constants";
import { GeneralPage } from "./general/GeneralPage";
import { ProvidersPage } from "./providers/ProvidersPage";
import { UsersPage } from "./users/UsersPage";

const TAB_COMPONENTS: Record<SettingsTab, React.ComponentType> = {
  general: GeneralPage,
  providers: ProvidersPage,
  "api-keys": ApiKeysPage,
  users: UsersPage,
};

const TAB_DESCRIPTION: Record<SettingsTab, string> = {
  general: "Workspace-wide preferences.",
  providers: "Connect model providers. Each one is a card with its own key and models.",
  "api-keys": "Create keys to call your agents and datatables from outside.",
  users: "Manage who can sign in to this workspace.",
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
  const dispatch = useAppDispatch();
  const { pathname } = useLocation();
  const activeTab = useActiveTab();

  useEffect(() => {
    if (pathname === "/settings" || pathname === "/settings/") {
      navigate("/settings/general", { replace: true });
    }
  }, [pathname, navigate]);

  useEffect(() => {
    if (activeTab === "providers") {
      void dispatch(fetchLlmProviders());
    }
  }, [activeTab, dispatch]);

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
