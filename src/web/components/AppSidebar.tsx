import { Dropdown, Icon, type MenuProps, Sidebar, type SidebarItemType, type SidebarSelectInfo } from "devnonla-ui";
import { Ellipsis, LogOut } from "lucide-react";
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiClient, clearAuthToken, getRefreshToken } from "src/common/api";
import type { User } from "src/common/types";
import { AppLogo } from "src/components/AppLogo";
import { FeatureIcon, type FeatureIconName } from "src/components/FeatureIcon";
import { UserAvatar } from "src/components/UserAvatar";
import { WorkspaceSwitcher } from "src/modules/workspaces/components/WorkspaceSwitcher";
import { useAppSelector } from "src/store/store";

interface NavItem {
  to: string;
  label: string;
  icon: FeatureIconName;
}

const WORKSPACE_NAV: NavItem[] = [
  { to: "/my-mcp-servers", label: "MCP Servers", icon: "mcp" },
  { to: "/tools", label: "Tools", icon: "tools" },
];

const CAPABILITIES_NAV: NavItem[] = [
  { to: "/jobs", label: "Jobs", icon: "jobs" },
  { to: "/sites", label: "Sites", icon: "sites" },
];

const RESOURCES_NAV: NavItem[] = [
  { to: "/datatables", label: "Datatables", icon: "datatables" },
  { to: "/kvstore", label: "KV Store", icon: "kv-store" },
  { to: "/secrets", label: "Secrets", icon: "secrets" },
];

function NavIcon({ name }: { name: FeatureIconName }) {
  return <FeatureIcon name={name} size={18} variant="sticker" />;
}

function linkItem(item: NavItem): SidebarItemType {
  return { key: item.to, label: item.label, icon: <NavIcon name={item.icon} />, href: item.to };
}

function visibleLinks(items: NavItem[]): SidebarItemType[] {
  return items.map((item) => linkItem(item));
}

function SidebarProfileLink({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  const navigate = useNavigate();
  if (!user) return null;

  const displayName = user.name || user.username;

  const menuItems: MenuProps["items"] = [
    {
      key: "header",
      label: (
        <div className="flex items-center gap-2.5 px-1 py-1">
          <UserAvatar avatar={user.avatar} name={displayName} size={36} className="shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium leading-tight text-foreground">{displayName}</div>
            <div className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">@{user.username}</div>
          </div>
        </div>
      ),
      disabled: true,
      style: { cursor: "default", opacity: 1 },
    },
    { type: "divider" },
    {
      key: "profile",
      label: (
        <div className="flex min-h-8 items-center gap-2 rounded-md px-2 py-0 text-base text-foreground">
          <Icon name="stars" size={16} />
          Profile Settings
        </div>
      ),
      onClick: () => navigate("/profile"),
    },
    { type: "divider" },
    {
      key: "logout",
      label: (
        <div className="flex min-h-8 items-center gap-2 rounded-md px-2 py-0 text-base text-foreground">
          <LogOut size={16} />
          Log Out
        </div>
      ),
      onClick: onLogout,
    },
  ];

  return (
    <Dropdown trigger={["click"]} placement="topLeft" menu={{ items: menuItems }}>
      <button type="button" aria-label="User menu" className="flex w-full min-w-0 items-center gap-2 border-0 bg-transparent px-2 py-2 text-left text-foreground outline-none cursor-pointer">
        <UserAvatar avatar={user.avatar} name={displayName} size={32} className="shrink-0 self-center rounded-full" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium leading-tight text-foreground">{displayName}</span>
          <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground tabular-nums">v{__APP_VERSION__}</span>
        </span>
        <span className="inline-flex size-8 shrink-0 items-center justify-center self-center text-tertiary-foreground">
          <Ellipsis size={16} />
        </span>
      </button>
    </Dropdown>
  );
}

export function AppSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentUser = useAppSelector((s) => s.auth.user);

  const selectedKey = useMemo(() => {
    if (pathname.startsWith("/settings")) return "settings";
    const routes = [...WORKSPACE_NAV, ...CAPABILITIES_NAV, ...RESOURCES_NAV].map((item) => item.to).sort((a, b) => b.length - a.length);
    return routes.find((to) => pathname === to || pathname.startsWith(`${to}/`)) ?? "";
  }, [pathname]);

  const items = useMemo<SidebarItemType[]>(() => {
    const next: SidebarItemType[] = [{ type: "group", key: "build", label: "Build" }, ...visibleLinks(WORKSPACE_NAV), { type: "group", key: "capabilities", label: "Compute" }, ...visibleLinks(CAPABILITIES_NAV), { type: "group", key: "resources", label: "Storage" }, ...visibleLinks(RESOURCES_NAV)];
    next.push({ key: "settings", label: "Settings", icon: <NavIcon name="settings" />, href: "/settings/general" });
    return next;
  }, []);

  const handleLogout = () => {
    const refreshToken = getRefreshToken();
    void apiClient.post("/api/auth/logout", { refreshToken }).catch(() => {});
    clearAuthToken();
    navigate("/login", { replace: true });
  };

  const onSelect = ({ item }: SidebarSelectInfo) => {
    if (item.href) navigate(item.href);
  };

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar text-foreground">
      <Sidebar
        aria-label="Workspace"
        className="min-h-0 flex-1"
        header={
          <>
            <div className="flex min-w-0 items-center border-b border-border px-4 pt-3.5 pb-3">
              <AppLogo />
            </div>
            <div className="px-3 pt-3 pb-2">
              <WorkspaceSwitcher />
            </div>
          </>
        }
        items={items}
        selectedKey={selectedKey}
        onSelect={onSelect}
        footer={
          <div className="shrink-0 border-t border-border px-2 py-2">
            <SidebarProfileLink user={currentUser} onLogout={handleLogout} />
          </div>
        }
      />
    </aside>
  );
}
