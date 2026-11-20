import { Outlet, useLocation } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import { AppSidebar } from "src/components/AppSidebar";

export function AppLayout() {
  const { pathname } = useLocation();
  const ownSidebar = pathname.startsWith("/datatables/") || pathname.startsWith("/jobs/");

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background">
      <div aria-hidden={ownSidebar} inert={ownSidebar} className={cn("h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none", ownSidebar ? "w-0" : "w-56")}>
        <div className={cn("h-full w-56 transition-transform duration-300 ease-out motion-reduce:transition-none", ownSidebar ? "-translate-x-full" : "translate-x-0")}>
          <AppSidebar />
        </div>
      </div>
      <main className={cn("h-full min-h-0 min-w-0 flex-1", ownSidebar ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden")}>
        <Outlet />
      </main>
    </div>
  );
}
