// MCP Tools tab on /tools. The route /tools/mcp opens this tab.

import { Button, Empty, Modal, Segmented, message } from "devnonla-ui";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "src/common/api";
import type { McpServer } from "src/common/types";
import RenderIf from "src/components/RenderIf";
import { deleteMcpServer, fetchMcpServers, updateMcpServer, upsertMcpServerLocal } from "src/modules/mcp-servers/common/mcpServersSlice";
import { getServerStatus } from "src/modules/mcp-servers/components/McpServerListItem";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { McpConnectDialog } from "./components/McpConnectDialog";
import { McpEmptyState } from "./components/McpEmptyState";
import { McpServerPanel } from "./components/McpServerPanel";
import { McpServerRow } from "./components/McpServerRow";

type StatusFilter = "all" | "active" | "attention";

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function addToSet(set: Set<string>, id: string) {
  return new Set(set).add(id);
}

function removeFromSet(set: Set<string>, id: string) {
  const next = new Set(set);
  next.delete(id);
  return next;
}

export default function McpToolsPanel() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const servers = useAppSelector((s) => s.mcpServers.items) as McpServer[];
  const [loading, setLoading] = useState(servers.length === 0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [togglingIds, setTogglingIds] = useState<Set<string>>(() => new Set());
  const [syncingIds, setSyncingIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await dispatch(fetchMcpServers()).unwrap();
      } catch (err) {
        if (!cancelled) message.error(errorText(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const attentionCount = useMemo(() => servers.filter((s) => getServerStatus(s) === "error").length, [servers]);
  const activeCount = useMemo(() => servers.filter((s) => getServerStatus(s) === "live").length, [servers]);

  const visible = useMemo(
    () =>
      servers.filter((server) => {
        const tone = getServerStatus(server);
        if (filter === "active" && tone !== "live") return false;
        if (filter === "attention" && tone !== "error") return false;
        return true;
      }),
    [servers, filter],
  );

  // Fall back to the first visible server when the selection is gone or filtered out.
  const selected = visible.find((s) => s.id === selectedId) ?? visible[0] ?? null;

  const handleToggle = async (id: string, isActive: boolean) => {
    setTogglingIds((prev) => addToSet(prev, id));
    try {
      await dispatch(updateMcpServer({ id, isActive })).unwrap();
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setTogglingIds((prev) => removeFromSet(prev, id));
    }
  };

  const handleSync = async (id: string) => {
    setSyncingIds((prev) => addToSet(prev, id));
    try {
      await apiClient.post(`/api/mcp-servers/${id}/sync`);
      message.success("Tools synced");
    } catch (err) {
      message.error(errorText(err));
    } finally {
      // Sync result is not a full server row — refetch to pick up tools + sync status.
      await dispatch(fetchMcpServers());
      setSyncingIds((prev) => removeFromSet(prev, id));
    }
  };

  const confirmDisconnect = (server: McpServer) => {
    Modal.confirm({
      title: `Disconnect "${server.name}"?`,
      content: "Agents using tools from this server will lose those assignments.",
      okText: "Disconnect",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await dispatch(deleteMcpServer(server.id)).unwrap();
          message.success("Disconnected");
        } catch (err) {
          message.error(errorText(err));
        }
      },
    });
  };

  const hasServers = servers.length > 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">External servers that give your agents extra tools.</p>
        <Button type="primary" icon={<Plus size={16} />} onClick={() => setConnectOpen(true)}>
          Connect
        </Button>
      </div>
      <RenderIf condition={attentionCount > 0 || servers.length > 1}>
        <div className="mb-4">
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as StatusFilter)}
            options={[
              { label: `All (${servers.length})`, value: "all" },
              { label: `Connected (${activeCount})`, value: "active" },
              { label: `Needs attention (${attentionCount})`, value: "attention" },
            ]}
          />
        </div>
      </RenderIf>

      <RenderIf condition={loading && !hasServers}>
        <div className="flex flex-col gap-4">
          {["a", "b"].map((key) => (
            <div key={key} className="h-44 animate-pulse rounded-2xl border border-border-subtle bg-card/70 p-5">
              <div className="flex gap-3">
                <div className="size-11 rounded-xl bg-muted" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 w-1/4 rounded bg-muted" />
                  <div className="h-3 w-1/3 rounded bg-muted/70" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </RenderIf>

      <RenderIf condition={!loading && !hasServers}>
        <McpEmptyState onConnect={() => setConnectOpen(true)} />
      </RenderIf>

      <RenderIf condition={hasServers && visible.length === 0}>
        <Empty className="rounded-2xl border border-dashed border-border-subtle bg-card/50 py-12" description="No servers in this view" />
      </RenderIf>

      <RenderIf condition={!!selected}>
        {() => (
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
            <nav aria-label="MCP servers" className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto md:sticky md:top-4 md:max-h-[calc(100vh-14rem)]">
              {visible.map((server) => (
                <McpServerRow key={server.id} server={server} selected={server.id === selected?.id} matchCount={null} onSelect={() => setSelectedId(server.id)} />
              ))}
            </nav>
            {selected ? (
              <McpServerPanel
                key={selected.id}
                server={selected}
                query=""
                toggling={togglingIds.has(selected.id)}
                syncing={syncingIds.has(selected.id)}
                onToggleActive={(checked) => void handleToggle(selected.id, checked)}
                onSync={() => void handleSync(selected.id)}
                onManage={() => navigate(`/tools/mcp/${selected.id}`)}
                onDisconnect={() => confirmDisconnect(selected)}
              />
            ) : null}
          </div>
        )}
      </RenderIf>

      <McpConnectDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onSaved={(server) => {
          dispatch(upsertMcpServerLocal(server));
          setConnectOpen(false);
          void dispatch(fetchMcpServers());
          navigate(`/tools/mcp/${server.id}`);
        }}
      />
    </>
  );
}
