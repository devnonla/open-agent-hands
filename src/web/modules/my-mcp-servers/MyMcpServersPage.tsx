import { Card, Empty, SearchInput, Skeleton, Tabs } from "devnonla-ui";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { nameAccent } from "src/common/lib/accent";
import { cn } from "src/common/lib/cn";
import type { MyMcpServer } from "src/common/types";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { TabCount } from "src/components/TabCount";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fetchMyMcpServers } from "./common/myMcpServersSlice";
import { McpLogo } from "./components/McpLogo";
import { McpServerCard, DisabledTag } from "./components/McpServerCard";

const GRID = "grid grid-cols-1 gap-4 @min-[560px]:grid-cols-2 @min-[880px]:grid-cols-3";

type ServerFilter = "all" | "active" | "disabled";

const SERVER_FILTERS: { key: ServerFilter; label: string; empty: string }[] = [
  { key: "all", label: "All", empty: "No servers" },
  { key: "active", label: "Active", empty: "No server is active" },
  { key: "disabled", label: "Disabled", empty: "Every server is active" },
];

function isServerFilter(value: string | null): value is ServerFilter {
  return SERVER_FILTERS.some((f) => f.key === value);
}

function matchesFilter(server: MyMcpServer, filter: ServerFilter) {
  if (filter === "active") return server.isActive;
  if (filter === "disabled") return !server.isActive;
  return true;
}

function toolCountLabel(count: number) {
  return `${count} ${count === 1 ? "tool" : "tools"}`;
}

export default function MyMcpServersPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const servers = useAppSelector((s) => s.myMcpServers.items) as MyMcpServer[];
  const [loading, setLoading] = useState(servers.length === 0);
  const [query, setQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get("status");
  const filter: ServerFilter = isServerFilter(statusParam) ? statusParam : "all";

  useEffect(() => {
    void Promise.resolve(dispatch(fetchMyMcpServers())).finally(() => setLoading(false));
  }, [dispatch]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = servers.filter((s) => matchesFilter(s, filter)).sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q) || (s.tools ?? []).some((t) => t.name.toLowerCase().includes(q) || t.label.toLowerCase().includes(q)));
  }, [servers, query, filter]);

  const counts = useMemo(() => {
    const active = servers.filter((s) => s.isActive).length;
    return { all: servers.length, active, disabled: servers.length - active };
  }, [servers]);

  const setFilter = (next: string) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "all") params.delete("status");
        else params.set("status", next);
        return params;
      },
      { replace: true },
    );

  const open = (id: string) => navigate(`/mcp-servers/${id}`);

  return (
    <PageShell
      header={
        <PageHeader
          title="MCP servers"
          icon="mcp"
          description={servers.length > 0 ? undefined : "Expose your tools to AI apps."}
          className="mb-0 pb-0"
          bordered={false}
          actions={servers.length > 6 ? <SearchInput placeholder="Find a server or tool" onChange={setQuery} wait={120} className="w-60" /> : undefined}
        />
      }
      tabs={
        servers.length > 0 ? (
          <Tabs
            aria-label="Filter servers"
            activeKey={filter}
            onChange={setFilter}
            items={SERVER_FILTERS.map((f) => ({
              key: f.key,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {f.label}
                  <TabCount value={counts[f.key]} />
                </span>
              ),
            }))}
          />
        ) : undefined
      }
    >
      <div className="@container flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <RenderIf condition={!loading || servers.length > 0} fallback={<div className={GRID}>{["a", "b", "c"].map((key) => <Card key={key}><Skeleton active className="p-4" paragraph={{ rows: 2 }} /></Card>)}</div>}>
            <RenderIf
              condition={servers.length > 0}
              fallback={
                <Empty className="py-10" description="No servers yet">
                  <AskClaudeHint what="MCP server" tool="create_mcp_server" />
                </Empty>
              }
            >
              <RenderIf condition={visible.length > 0} fallback={<Empty className="py-10" description={query.trim() ? `Nothing matches "${query}".` : SERVER_FILTERS.find((f) => f.key === filter)?.empty} />}>
                <div className={GRID}>
                  {visible.map((server) => {
                    const accent = nameAccent(server.name);
                    return (
                      <McpServerCard
                        key={server.id}
                        icon={
                          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", !server.isActive && "grayscale")} style={{ background: `color-mix(in oklab, ${accent} 15%, transparent)`, color: accent }}>
                            <McpLogo size={20} />
                          </span>
                        }
                        name={server.name}
                        meta={toolCountLabel(server.tools?.length ?? server.toolCount ?? 0)}
                        description={server.description?.trim() || ""}
                        tag={server.isActive ? undefined : <DisabledTag />}
                        onOpen={() => open(server.id)}
                      />
                    );
                  })}
                </div>
              </RenderIf>
            </RenderIf>
          </RenderIf>
        </section>
      </div>
    </PageShell>
  );
}
