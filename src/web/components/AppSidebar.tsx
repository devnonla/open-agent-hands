import { Button, Icon, Sidebar, type SidebarItemType, type SidebarSelectInfo, Tooltip } from "devnonla-ui";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useUpdateInfo } from "src/common/hooks/useUpdateInfo";
import { cn } from "src/common/lib/cn";
import type { User } from "src/common/types";
import { AppLogo, AppMark } from "src/components/AppLogo";
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
    key: "start",
    label: "Start",
    items: [{ to: "/connect", label: "Connect", icon: "connect" }],
  },
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

const PROFILE_LINK = "flex h-10 cursor-pointer items-center rounded-(--nonla-radius) text-foreground no-underline transition-colors duration-(--nonla-dur-fast) hover:not-aria-[current=page]:bg-ink-hover aria-[current=page]:bg-ink-active";

function SidebarProfileLink({ user, active, onNavigate, trailing }: { user: User | null; active: boolean; onNavigate?: () => void; trailing?: ReactNode }) {
  if (!user) return null;
  return (
    <div className="flex items-center gap-1">
      <Link to="/profile" onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn(PROFILE_LINK, "min-w-0 flex-1 gap-2.5 px-2")}>
        <UserAvatar size={26} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{user.name || user.username}</span>
      </Link>
      {trailing}
    </div>
  );
}

function UpdateNotice({ compact = false }: { compact?: boolean }) {
  const update = useUpdateInfo();
  if (!update?.updateAvailable || !update.latest) return null;
  if (compact) {
    return (
      <Tooltip title={`Update available: v${update.latest}`} placement="right">
        <Link to="/settings/general" aria-label={`Update available: v${update.latest}`} className="mx-auto mb-1.5 flex size-10 items-center justify-center rounded-lg bg-linear-to-r from-[#FFA640] to-[#F2701A] text-white no-underline shadow-sm shadow-[#F2701A]/30 transition hover:brightness-105">
          <Icon name="download" size={16} />
        </Link>
      </Tooltip>
    );
  }
  return (
    <Link to="/settings/general" className="mb-1.5 flex items-center gap-2 rounded-lg bg-linear-to-r from-[#FFA640] to-[#F2701A] px-2.5 py-2 text-xs font-semibold text-white no-underline shadow-sm shadow-[#F2701A]/30 transition hover:brightness-105">
      <Icon name="download" size={14} />
      <span className="min-w-0 flex-1 truncate">Update available: v{update.latest}</span>
    </Link>
  );
}

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <Tooltip title={label} placement="right">
      <Button type="icon" aria-label={label} icon={collapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />} onClick={onToggle} className="shrink-0 text-muted-foreground" />
    </Tooltip>
  );
}

function RailLink({ item, active, onSelect }: { item: SidebarItemType; active: boolean; onSelect: (info: SidebarSelectInfo) => void }) {
  return (
    <Tooltip title={item.label} placement="right">
      <a
        href={item.href}
        aria-label={typeof item.label === "string" ? item.label : undefined}
        aria-current={active ? "page" : undefined}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onSelect({ key: item.key ?? "", item });
        }}
        className="mx-auto flex size-10 items-center justify-center rounded-(--nonla-radius) text-foreground no-underline transition-colors duration-(--nonla-dur-fast) hover:not-aria-[current=page]:bg-ink-hover aria-[current=page]:bg-ink-active"
      >
        {item.icon}
      </a>
    </Tooltip>
  );
}

function SidebarRail({ items, selectedKey, onSelect, user, onToggle }: { items: SidebarItemType[]; selectedKey: string; onSelect: (info: SidebarSelectInfo) => void; user: User | null; onToggle: () => void }) {
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar text-foreground">
      <div className="flex shrink-0 justify-center border-b border-border pt-3.5 pb-3">
        <Link to="/tools" aria-label="Open Agent Hands" className="flex size-7 items-center justify-center">
          <AppMark size={28} />
        </Link>
      </div>
      <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 pb-6">
        <div className="flex flex-col gap-1">{items.map((item, i) => (item.type === "group" ? i === 0 ? null : <div key={item.key} aria-hidden className="mx-2 my-2 h-px bg-border" /> : <RailLink key={item.key} item={item} active={item.key === selectedKey} onSelect={onSelect} />))}</div>
      </nav>
      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-border px-2 py-2">
        <UpdateNotice compact />
        {user ? (
          <Tooltip title={user.name || user.username} placement="right">
            <Link to="/profile" aria-label="Profile" aria-current={selectedKey === "profile" ? "page" : undefined} className={cn(PROFILE_LINK, "size-10 justify-center")}>
              <UserAvatar size={26} />
            </Link>
          </Tooltip>
        ) : null}
        <CollapseToggle collapsed onToggle={onToggle} />
      </div>
    </aside>
  );
}

export function AppSidebar({ collapsed = false, onToggleCollapsed, onNavigate }: { collapsed?: boolean; onToggleCollapsed?: () => void; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentUser = useAppSelector((s) => s.auth.user);

  const selectedKey = useMemo(() => {
    if (pathname.startsWith("/settings")) return "settings";
    if (pathname.startsWith("/profile")) return "profile";
    return NAV_ROUTES.find((to) => pathname === to || pathname.startsWith(`${to}/`)) ?? "";
  }, [pathname]);

  const items = useMemo<SidebarItemType[]>(() => {
    const next: SidebarItemType[] = NAV_GROUPS.flatMap((group) => [{ type: "group" as const, key: group.key, label: group.label }, ...visibleLinks(group.items)]);
    next.push({ key: "settings", label: "Settings", icon: <NavIcon name="settings" />, href: "/settings/general" });
    return next;
  }, []);

  const onSelect = ({ item }: SidebarSelectInfo) => {
    if (item.href) navigate(item.href);
    onNavigate?.();
  };

  if (collapsed && onToggleCollapsed) {
    return <SidebarRail items={items} selectedKey={selectedKey} onSelect={onSelect} user={currentUser} onToggle={onToggleCollapsed} />;
  }

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar text-foreground">
      <Sidebar
        aria-label="Main navigation"
        className="min-h-0 flex-1"
        header={
          <div className="flex min-w-0 items-center border-b border-border px-4 pt-3.5 pb-3">
            <AppLogo className="flex-1" />
          </div>
        }
        items={items}
        selectedKey={selectedKey}
        onSelect={onSelect}
        footer={
          <div className="shrink-0 border-t border-border px-2 py-2">
            <UpdateNotice />
            <SidebarProfileLink user={currentUser} active={selectedKey === "profile"} onNavigate={onNavigate} trailing={onToggleCollapsed ? <CollapseToggle collapsed={false} onToggle={onToggleCollapsed} /> : null} />
          </div>
        }
      />
    </aside>
  );
}
