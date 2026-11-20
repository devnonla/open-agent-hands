import { Empty, Segmented, message } from "devnonla-ui";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Site } from "src/common/types";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fetchSites } from "./common/sitesSlice";
import { SITE_VISIBILITY_META, SiteCard, type SiteVisibility, siteVisibility } from "./components/SiteCard";

type VisibilityFilter = "all" | SiteVisibility;

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

  const filtered = useMemo(() => {
    if (visibilityFilter === "all") return items;
    return items.filter((site) => siteVisibility(site) === visibilityFilter);
  }, [items, visibilityFilter]);

  return (
    <PageShell>
      <PageHeader title="Sites" icon="sites">
        {items.length > 0 ? (
          <Segmented
            value={visibilityFilter}
            onChange={setVisibilityFilter}
            options={[
              { label: "All", value: "all" },
              { label: "Public", value: "public" },
              { label: "Protected", value: "protected" },
              { label: "Unpublished", value: "unpublished" },
            ]}
          />
        ) : null}
      </PageHeader>

      <RenderIf
        condition={items.length > 0 || loading}
        fallback={
          <Empty className="rounded-2xl border border-dashed border-border px-5 py-16" description="No sites yet">
            <AskClaudeHint what="site" tool="create_site" />
          </Empty>
        }
      >
        <RenderIf condition={loading && items.length === 0}>
          <div className="@container">
            <div className="grid grid-cols-2 gap-3 @min-[900px]:grid-cols-3">
              {["a", "b"].map((key) => (
                <div key={key} className="overflow-hidden rounded-xl border border-border-subtle bg-card">
                  <div className="mx-2 mt-2 aspect-16/10 animate-pulse rounded-lg border border-border bg-muted shadow-[0_1px_2px_rgb(0_0_0/0.05)]" />
                  <div className="h-12" />
                </div>
              ))}
            </div>
          </div>
        </RenderIf>
        <RenderIf condition={filtered.length > 0}>
          <div className="@container">
            <div className="grid grid-cols-2 gap-3 @min-[900px]:grid-cols-3">
              {filtered.map((site) => (
                <SiteCard key={site.id} site={site} onOpen={() => navigate(`/sites/${site.id}`)} />
              ))}
            </div>
          </div>
        </RenderIf>
        <RenderIf condition={!loading && items.length > 0 && filtered.length === 0}>
          <div className="py-8 text-center text-sm text-muted-foreground">No {SITE_VISIBILITY_META[visibilityFilter as SiteVisibility]?.label.toLowerCase() ?? ""} sites</div>
        </RenderIf>
      </RenderIf>
    </PageShell>
  );
}
