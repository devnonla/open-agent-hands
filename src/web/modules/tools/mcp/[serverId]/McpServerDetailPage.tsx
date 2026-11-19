import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { McpServer } from "src/common/types";
import { FeatureIcon } from "src/components/FeatureIcon";
import { PageShell } from "src/components/PageShell";
import { WindowHeaderBackButton } from "src/components/WindowHeaderBackButton";
import { AgentsContentHeader, ContentBreadcrumb } from "src/modules/agents/components/ContentBreadcrumb";
import { fetchMcpServers } from "src/modules/mcp-servers/common/mcpServersSlice";
import { McpServerDetail } from "src/modules/mcp-servers/components/McpServerDetail";
import { useAppDispatch, useAppSelector } from "src/store/store";

export default function McpServerDetailPage() {
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const mcpServers = useAppSelector((s) => s.mcpServers.items) as McpServer[];

  useEffect(() => {
    void dispatch(fetchMcpServers());
  }, [dispatch]);

  const listItem = useMemo(() => (serverId ? (mcpServers.find((s) => s.id === serverId) ?? null) : null), [mcpServers, serverId]);

  const title = listItem?.name ?? "MCP server";

  if (!serverId) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <AgentsContentHeader
        left={
          <div className="flex min-w-0 items-center gap-2">
            <WindowHeaderBackButton to="/tools/mcp" label="Back to MCP tools" />
            <ContentBreadcrumb items={[{ label: "Tools", to: "/tools", icon: <FeatureIcon name="tools" size={16} variant="sticker" /> }, { label: "MCP Tools", to: "/tools/mcp" }, { label: title }]} />
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageShell>
          <McpServerDetail serverId={serverId} listItem={listItem} onDeleted={() => navigate("/tools/mcp")} />
        </PageShell>
      </div>
    </div>
  );
}
