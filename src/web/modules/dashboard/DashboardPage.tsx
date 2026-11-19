import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentListItem } from "src/common/types";
import { MissingProviderCallout } from "src/components/MissingProviderCallout";
import { PageShell } from "src/components/PageShell";
import { fetchAgents } from "src/modules/agents/common/agentsSlice";
import { DashboardHero } from "src/modules/dashboard/components/DashboardHero";
import { type QuickLink, QuickLinks } from "src/modules/dashboard/components/QuickLinks";
import { RecentAgents } from "src/modules/dashboard/components/RecentAgents";
import { useAppDispatch, useAppSelector } from "src/store/store";

const RECENT_LIMIT = 5;

const QUICK_LINKS: QuickLink[] = [
  { to: "/tools", title: "Tools", blurb: "Custom JS tools your agents can call.", icon: "tools" },
  { to: "/skills", title: "Skills", blurb: "Reusable instructions your agents can load.", icon: "skills" },
  { to: "/sites", title: "Sites", blurb: "Publish pages built by your agents.", icon: "sites" },
  { to: "/datatables", title: "Datatables", blurb: "Structured data your agents can read and write.", icon: "datatables" },
];

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const user = useAppSelector((s) => s.auth.user);
  const agents = useAppSelector((s) => s.agents.items) as (AgentListItem & { runStatus?: string })[];
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    dispatch(fetchAgents()).finally(() => setLoaded(true));
  }, [dispatch]);

  const displayName = user?.name || user?.username || "there";
  const greeting = greetingForHour(new Date().getHours());

  const recentAgents = useMemo(() => [...agents].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, RECENT_LIMIT), [agents]);

  return (
    <PageShell>
      <MissingProviderCallout />

      <DashboardHero greeting={greeting} name={displayName} agentCount={agents.length} loaded={loaded} onOpenAgents={() => navigate("/agents")} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RecentAgents agents={recentAgents} loaded={loaded} onOpenAgent={(id) => navigate(`/agents/${id}`)} onOpenAll={() => navigate("/agents")} />
        </div>
        <div className="lg:col-span-2">
          <QuickLinks links={QUICK_LINKS} onNavigate={navigate} />
        </div>
      </div>
    </PageShell>
  );
}
