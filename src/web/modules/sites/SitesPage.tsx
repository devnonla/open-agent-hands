import { Card, Empty, Skeleton, Tabs, message } from "devnonla-ui";
import { LayoutGrid } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Site } from "src/common/types";
import { ConnectAgentEmpty } from "src/components/ConnectAgentEmpty";
import { PageHeader } from "src/components/PageHeader";
import { TabCount } from "src/components/TabCount";
import { PageShell } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fetchSites } from "./common/sitesSlice";
import { SITE_VISIBILITY_META, SiteCard, type SiteVisibility, siteVisibility } from "./components/SiteCard";

type VisibilityFilter = "all" | SiteVisibility;

const FILTERS: { label: string; value: VisibilityFilter }[] = [
  { label: "All", value: "all" },
  { label: "Public", value: "public" },
  { label: "Protected", value: "protected" },
  { label: "Private", value: "unpublished" },
];

function VisibilityIcon({ filter }: { filter: VisibilityFilter }) {
  if (filter === "all") return <LayoutGrid size={15} className="text-muted-foreground" />;
  const { icon: Glyph, tone } = SITE_VISIBILITY_META[filter];
  return <Glyph size={15} className={tone} />;
}

export default function SitesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const items = useAppSelector((s) => s.sites.items) as Site[];
  const [loading, setLoading] = useState(items.length === 0);
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await dispatch(fetchSites({ limit: 100, sorts: "-updatedAt" })).unwrap();
      } catch (err: unknown) {
        if (!cancelled) message.error(err instanceof Error ? err.message : "Failed to load sites");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const counts = useMemo(() => {
    const byVisibility: Record<VisibilityFilter, number> = { all: items.length, public: 0, protected: 0, unpublished: 0 };
    for (const site of items) byVisibility[siteVisibility(site)] += 1;
    return byVisibility;
  }, [items]);

  const filtered = useMemo(() => {
    if (visibilityFilter === "all") return items;
    return items.filter((site) => siteVisibility(site) === visibilityFilter);
  }, [items, visibilityFilter]);

  return (
    <PageShell
      header={<PageHeader title="Sites" icon="sites" className="mb-0 pb-0" bordered={false} />}
      tabs={
        items.length > 0 ? (
          <Tabs
            aria-label="Filter sites"
            className="min-w-0"
            activeKey={visibilityFilter}
            onChange={(key) => setVisibilityFilter(key as VisibilityFilter)}
            items={FILTERS.map((filter) => ({
              key: filter.value,
              icon: <VisibilityIcon filter={filter.value} />,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {filter.label}
                  <TabCount value={counts[filter.value]} />
                </span>
              ),
            }))}
          />
        ) : undefined
      }
    >

      <RenderIf
        condition={items.length > 0 || loading}
        fallback={
          <ConnectAgentEmpty title="No sites yet" what="site" tool="create_site" />
        }
      >
        <RenderIf condition={loading && items.length === 0}>
          <div className="@container">
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 @min-[480px]:grid-cols-2 @min-[700px]:grid-cols-3 @min-[960px]:grid-cols-4 @min-[1200px]:grid-cols-5">
              {["a", "b"].map((key) => (
                <Card key={key}>
                  <Skeleton.Input className="mx-2 mt-2 aspect-16/10 h-auto w-auto rounded-lg" />
                  <Skeleton title paragraph={false} className="px-3 py-4" />
                </Card>
              ))}
            </div>
          </div>
        </RenderIf>
        <RenderIf condition={filtered.length > 0}>
          <div className="@container">
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 @min-[480px]:grid-cols-2 @min-[700px]:grid-cols-3 @min-[960px]:grid-cols-4 @min-[1200px]:grid-cols-5">
              {filtered.map((site) => (
                <SiteCard key={site.id} site={site} onOpen={() => navigate(`/sites/${site.id}`)} />
              ))}
            </div>
          </div>
        </RenderIf>
        <RenderIf condition={!loading && items.length > 0 && filtered.length === 0}>
          <Empty bordered={false} icon={null} className="py-8" description={`No ${SITE_VISIBILITY_META[visibilityFilter as SiteVisibility]?.label.toLowerCase() ?? ""} sites`} />
        </RenderIf>
      </RenderIf>
    </PageShell>
  );
}
