import { Button, Drawer } from "devnonla-ui";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import { AppLogo } from "src/components/AppLogo";
import { AppSidebar } from "src/components/AppSidebar";
import { PublicUrlSetupDialog } from "src/modules/settings/general/components/PublicUrlSetupDialog";

const COLLAPSED_KEY = "agenthands_sidebar_collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function MobileTopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-2 md:hidden">
      <Button type="icon" aria-label="Open menu" icon={<Menu size={18} />} onClick={onOpenMenu} />
      <AppLogo size={24} className="min-w-0" />
    </div>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  const ownSidebar = pathname.startsWith("/datatables/") || pathname.startsWith("/jobs/") || pathname.startsWith("/sites/");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const railWidth = collapsed ? "w-14" : "w-56";
  const motion = "duration-300 ease-(--nonla-ease-out) motion-reduce:transition-none";

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background">
      <div aria-hidden={ownSidebar} inert={ownSidebar} className={cn("hidden h-full shrink-0 overflow-hidden transition-[width] md:block", motion, ownSidebar ? "w-0" : railWidth)}>
        <div className={cn("relative h-full overflow-hidden border-r border-border bg-sidebar transition-[width,transform]", motion, railWidth, ownSidebar ? "-translate-x-full" : "translate-x-0")}>
          <div inert={collapsed} className={cn("absolute inset-y-0 left-0 w-56 transition-opacity", motion, collapsed ? "pointer-events-none opacity-0" : "opacity-100")}>
            <AppSidebar onToggleCollapsed={toggleCollapsed} />
          </div>
          <div inert={!collapsed} className={cn("absolute inset-y-0 left-0 w-14 transition-opacity", motion, collapsed ? "opacity-100" : "pointer-events-none opacity-0")}>
            <AppSidebar collapsed onToggleCollapsed={toggleCollapsed} />
          </div>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {ownSidebar ? null : <MobileTopBar onOpenMenu={() => setMenuOpen(true)} />}
        <main className={cn("min-h-0 min-w-0 flex-1", ownSidebar ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden")}>
          <Outlet />
        </main>
      </div>
      <Drawer placement="left" open={menuOpen} onClose={() => setMenuOpen(false)} width={256} title="Navigation" closable={false} styles={{ header: { display: "none" }, body: { padding: 0 } }}>
        <AppSidebar onNavigate={() => setMenuOpen(false)} />
      </Drawer>
      <PublicUrlSetupDialog />
    </div>
  );
}
