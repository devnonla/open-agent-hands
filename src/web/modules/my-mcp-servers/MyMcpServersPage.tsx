import { Card, Empty, SearchInput, Skeleton, Tag } from "devnonla-ui";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "src/common/api";
import { nameAccent } from "src/common/lib/accent";
import { cn } from "src/common/lib/cn";
import type { MyMcpServer } from "src/common/types";
import { AppMark } from "src/components/AppLogo";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { CORE_KEY } from "./common/constants";
import { fetchMyMcpServers } from "./common/myMcpServersSlice";
import { McpLogo } from "./components/McpLogo";
import { McpServerCard, OffTag } from "./components/McpServerCard";

const GRID = "grid grid-cols-1 gap-4 @min-[560px]:grid-cols-2 @min-[880px]:grid-cols-3";

function toolCountLabel(count: number) {
  return `${count} ${count === 1 ? "tool" : "tools"}`;
}

export default function MyMcpServersPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const servers = useAppSelector((s) => s.myMcpServers.items) as MyMcpServer[];
  const [loading, setLoading] = useState(servers.length === 0);
  const [coreToolCount, setCoreToolCount] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void Promise.resolve(dispatch(fetchMyMcpServers())).finally(() => setLoading(false));
    apiClient
      .get<{ toolCount: number }>("/api/core-mcp")
      .then((info) => setCoreToolCount(info.toolCount))
      .catch(() => setCoreToolCount(null));
  }, [dispatch]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...servers].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q) || (s.tools ?? []).some((t) => t.name.toLowerCase().includes(q) || t.label.toLowerCase().includes(q)));
  }, [servers, query]);

  const open = (id: string) => navigate(`/mcp-servers/${id}`);

  return (
    <PageShell
      header={
        <PageHeader
          title="MCP servers"
          icon="mcp"
          description={servers.length > 6 ? undefined : "Expose your tools to AI apps."}
          className="mb-0 pb-0"
          bordered={false}
          actions={servers.length > 6 ? <SearchInput placeholder="Find a server or tool" onChange={setQuery} wait={120} className="w-60" /> : undefined}
        />
      }
    >

      <div className="@container flex flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h2 className="m-0 text-sm font-medium text-muted-foreground">Built in</h2>
          <div className={GRID}>
            <McpServerCard
              icon={<AppMark size={40} />}
              name="Core MCP"
              meta={coreToolCount != null ? toolCountLabel(coreToolCount) : "Admin server"}
              description="Lets your agent create and manage tools, jobs, sites, data and secrets."
              tag={<Tag color="brand">Admin</Tag>}
              onOpen={() => open(CORE_KEY)}
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="m-0 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            Your servers
            <span className="tabular-nums text-tertiary-foreground">{servers.length}</span>
          </h2>
          <RenderIf condition={!loading || servers.length > 0} fallback={<div className={GRID}>{["a", "b", "c"].map((key) => <Card key={key}><Skeleton active className="p-4" paragraph={{ rows: 2 }} /></Card>)}</div>}>
            <RenderIf
              condition={servers.length > 0}
              fallback={
                <Empty className="py-10" description="No servers yet">
                  <AskClaudeHint what="MCP server" tool="create_mcp_server" />
                </Empty>
              }
            >
              <RenderIf condition={visible.length > 0} fallback={<Empty className="py-10" description={`Nothing matches "${query}".`} />}>
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
                        tag={server.isActive ? undefined : <OffTag />}
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
