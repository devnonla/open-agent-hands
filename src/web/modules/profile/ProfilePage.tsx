import { Tabs } from "devnonla-ui";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiClient, clearAuthToken, getRefreshToken } from "src/common/api";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { useAppSelector } from "src/store/store";
import { BasicInfoSection } from "./BasicInfoSection";
import { IdentityCard } from "./IdentityCard";
import { SecuritySection } from "./SecuritySection";

const PROFILE_TABS = ["general", "security"] as const;
type ProfileTabKey = (typeof PROFILE_TABS)[number];

function isProfileTab(value: string | null): value is ProfileTabKey {
  return value === "general" || value === "security";
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const [avatar, setAvatar] = useState(user?.avatar || "");
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: ProfileTabKey = isProfileTab(tabParam) ? tabParam : "general";

  const handleTabChange = (key: string) => {
    if (!isProfileTab(key)) return;
    setSearchParams(key === "general" ? {} : { tab: key }, { replace: true });
  };

  if (!user) return null;

  const handleLogout = () => {
    const refreshToken = getRefreshToken();
    void apiClient.post("/api/auth/logout", { refreshToken }).catch(() => {});
    clearAuthToken();
    navigate("/login", { replace: true });
  };

  return (
    <PageShell className="h-full min-h-0 overflow-y-auto">
      <PageHeader title="Profile" description="Manage your avatar, account info, and password." />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[300px_1fr]">
        <div className="lg:sticky lg:top-0">
          <IdentityCard user={user} avatar={avatar} onAvatarChange={setAvatar} onLogout={handleLogout} />
        </div>
        <div className="min-w-0">
          <Tabs
            aria-label="Profile sections"
            activeKey={activeTab}
            onChange={handleTabChange}
            items={[
              { key: "general", label: "General", children: <BasicInfoSection user={user} avatar={avatar} /> },
              { key: "security", label: "Security", children: <SecuritySection /> },
            ]}
          />
        </div>
      </div>
    </PageShell>
  );
}
