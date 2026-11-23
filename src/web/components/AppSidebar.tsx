import { Dropdown, Icon, type MenuProps, Sidebar, type SidebarItemType, type SidebarSelectInfo } from "devnonla-ui";
import { LogOut } from "lucide-react";
import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiClient, clearAuthToken, getRefreshToken } from "src/common/api";
import { useUpdateInfo } from "src/common/hooks/useUpdateInfo";
import type { User } from "src/common/types";
import { AppLogo, IS_DEV_BUILD } from "src/components/AppLogo";
import { FeatureIcon, type FeatureIconName } from "src/components/FeatureIcon";
import { UserAvatar } from "src/components/UserAvatar";
import { useAppSelector } from "src/store/store";

interface NavItem {
  to: string;
  label: string;
  icon: FeatureIconName;
}

const NAV_GROUPS: { key: string; label: string; items: NavItem[] }[] = [
  {
    key: "build",
    label: "Build",
    items: [
      { to: "/tools", label: "Tools", icon: "tools" },
      { to: "/mcp-servers", label: "MCP Servers", icon: "mcp" },
    ],
  },
  {
    key: "run",
    label: "Run",
    items: [
      { to: "/jobs", label: "Jobs", icon: "jobs" },
      { to: "/sites", label: "Sites", icon: "sites" },
    ],
  },
  {
    key: "data",
    label: "Data",
    items: [
      { to: "/datatables", label: "Datatables", icon: "datatables" },
      { to: "/kvstore", label: "KV Store", icon: "kv-store" },
      { to: "/storage", label: "Storage", icon: "storage" },
    ],
  },
  {
    key: "config",
    label: "Config",
    items: [{ to: "/secrets", label: "Secrets", icon: "secrets" }],
  },
];

const NAV_ROUTES = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to)).sort((a, b) => b.length - a.length);

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
    { key: "profile", label: "Profile", icon: <Icon name="stars" size={14} />, onClick: () => navigate("/profile") },
    { key: "logout", label: "Log out", icon: <LogOut size={14} />, onClick: onLogout },
  ];

  return (
    <Dropdown trigger={["click"]} placement="topLeft" menu={{ items: menuItems }}>
      <button type="button" aria-label="User menu" className="flex w-full min-w-0 items-center gap-2 border-0 bg-transparent px-2 py-2 text-left text-foreground cursor-pointer rounded-md">
        <UserAvatar avatar={user.avatar} name={displayName} size={32} className="shrink-0 self-center rounded-full" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium leading-tight text-foreground">{displayName}</span>
          <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground tabular-nums">
            v{__APP_VERSION__}
            {IS_DEV_BUILD ? " · dev" : ""}
          </span>
        </span>
        <span className="inline-flex size-8 shrink-0 items-center justify-center self-center text-tertiary-foreground">
          <Icon name="more" size={16} />
        </span>
      </button>
    </Dropdown>
  );
}

function UpdateNotice() {
  const update = useUpdateInfo();
  if (!update?.updateAvailable || !update.latest) return null;
  return (
    <Link to="/settings/general" className="mb-1.5 flex items-center gap-2 rounded-lg bg-linear-to-r from-[#FFA640] to-[#F2701A] px-2.5 py-2 text-xs font-semibold text-white no-underline shadow-sm shadow-[#F2701A]/30 transition hover:brightness-105">
      <Icon name="download" size={14} />
      <span className="min-w-0 flex-1 truncate">Update available: v{update.latest}</span>
    </Link>
  );
}

export function AppSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentUser = useAppSelector((s) => s.auth.user);

  const selectedKey = useMemo(() => {
    if (pathname.startsWith("/settings")) return "settings";
    return NAV_ROUTES.find((to) => pathname === to || pathname.startsWith(`${to}/`)) ?? "";
  }, [pathname]);

  const items = useMemo<SidebarItemType[]>(() => {
    const next: SidebarItemType[] = NAV_GROUPS.flatMap((group) => [{ type: "group" as const, key: group.key, label: group.label }, ...visibleLinks(group.items)]);
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
        aria-label="Main navigation"
        className="min-h-0 flex-1"
        header={
          <div className="flex min-w-0 items-center border-b border-border px-4 pt-3.5 pb-3">
            <AppLogo />
          </div>
        }
        items={items}
        selectedKey={selectedKey}
        onSelect={onSelect}
        footer={
          <div className="shrink-0 border-t border-border px-2 py-2">
            <UpdateNotice />
            <SidebarProfileLink user={currentUser} onLogout={handleLogout} />
          </div>
        }
      />
    </aside>
  );
}
