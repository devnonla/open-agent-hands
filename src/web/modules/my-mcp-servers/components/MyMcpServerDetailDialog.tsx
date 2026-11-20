import { Alert, Button, Empty, Icon, Input, Modal, Popconfirm, Switch, message } from "devnonla-ui";
import { ChevronDown, ChevronRight, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "src/common/lib/cn";
import type { MyMcpServer } from "src/common/types";
import { relativeTime } from "src/common/utils/date";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch } from "src/store/store";
import { deleteMyMcpServer, toMyMcpServerListItem, updateMyMcpServer, upsertMyMcpServerLocal } from "../common/myMcpServersSlice";
import { McpConnectPanel } from "./McpConnectPanel";

export function MyMcpServerDetailDialog({
  serverId,
  listItem,
  onClose,
  onRotated,
}: {
  serverId: string | null;
  listItem: MyMcpServer | null;
  onClose: () => void;
  onRotated: (server: MyMcpServer) => void;
}) {
  const dispatch = useAppDispatch();
  const [toolQuery, setToolQuery] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!serverId) return;
    setToolQuery("");
    setConnectOpen(false);
  }, [serverId]);

  const server = listItem;
  const tools = server?.tools ?? [];

  const filteredTools = useMemo(() => {
    const q = toolQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((tool) => tool.name.toLowerCase().includes(q) || tool.label.toLowerCase().includes(q) || (tool.description ?? "").toLowerCase().includes(q));
  }, [tools, toolQuery]);

  const handleToggle = async (checked: boolean) => {
    if (!server) return;
    setToggling(true);
    try {
      const updated = (await dispatch(updateMyMcpServer({ id: server.id, isActive: checked })).unwrap()) as MyMcpServer;
      dispatch(upsertMyMcpServerLocal(toMyMcpServerListItem(updated)));
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!server) return;
    try {
      await dispatch(deleteMyMcpServer(server.id)).unwrap();
      message.success("Deleted");
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal open={!!serverId} onCancel={onClose} title={server?.name ?? "MCP server"} footer={null} destroyOnHidden width={640} centered styles={{ body: { maxHeight: "72vh", overflowY: "auto" } }}>
      <RenderIf value={server}>
        {(s) => (
          <div className="flex flex-col gap-4">
            <RenderIf condition={!!s.description?.trim()}>
              <p className="m-0 text-[13px] text-tertiary-foreground">{s.description}</p>
            </RenderIf>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-muted/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <Switch size="small" checked={s.isActive} disabled={toggling} onChange={(checked) => void handleToggle(checked)} aria-label={s.isActive ? "Turn off" : "Turn on"} />
                <span className={cn("text-[12px] font-medium", s.isActive ? "text-foreground" : "text-muted-foreground")}>{s.isActive ? "On" : "Off"}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">{s.lastUsedAt ? `Used ${relativeTime(s.lastUsedAt)}` : "Never used"}</span>
              <div className="ml-auto flex items-center gap-1">
                <Popconfirm title={`Delete ${s.name}?`} description="Clients using this URL and token will stop working." okText="Delete" okType="danger" onConfirm={() => void handleDelete()} styles={{ root: { width: 280 } }}>
                  <Button type="text" size="small" danger icon={<Trash2 size={14} />} aria-label="Delete server" />
                </Popconfirm>
              </div>
            </div>

            <RenderIf condition={!s.isActive}>
              <Alert type="warning" showIcon description="This server is off. Clients will be rejected until you turn it on." />
            </RenderIf>

            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h3 className="m-0 text-[13px] font-semibold text-foreground">Exposed tools</h3>
                <span className="text-[11px] tabular-nums text-muted-foreground">{tools.length}</span>
              </div>

              <RenderIf
                condition={tools.length > 0}
                fallback={
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
                    <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Icon name="stars" size={18} />
                    </div>
                    <p className="m-0 text-sm font-medium text-foreground">No tools exposed yet</p>
                    <p className="m-0 mt-1 text-xs text-muted-foreground">
                      Ask your agent to assign tools with <code className="font-mono text-[11px]">add_tools_to_mcp_server</code>.
                    </p>
                  </div>
                }
              >
                <RenderIf condition={tools.length > 6}>
                  <Input prefix={<Search size={13} className="text-muted-foreground" />} value={toolQuery} onChange={(e) => setToolQuery(e.target.value)} placeholder="Find tools…" className="h-8! text-sm" allowClear />
                </RenderIf>
                <RenderIf condition={filteredTools.length > 0} fallback={<Empty className="py-6" description={<span className="text-sm text-muted-foreground">No matching tools</span>} />}>
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {filteredTools.map((tool) => (
                      <li key={tool.id} className="rounded-xl border border-border-subtle bg-card/60 px-3.5 py-2.5">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">{tool.label || tool.name}</span>
                          <RenderIf condition={!!tool.label && tool.label !== tool.name}>
                            <code className="shrink-0 font-mono text-[11px] text-quaternary-foreground">{tool.name}</code>
                          </RenderIf>
                        </div>
                        <RenderIf condition={!!tool.description?.trim()}>
                          <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-tertiary-foreground">{tool.description}</div>
                        </RenderIf>
                      </li>
                    ))}
                  </ul>
                </RenderIf>
              </RenderIf>
            </section>

            <section className="rounded-xl border border-border-subtle">
              <button type="button" onClick={() => setConnectOpen((v) => !v)} className="flex w-full cursor-pointer items-center gap-2 rounded-xl border-0 bg-transparent px-3.5 py-2.5 text-left" aria-expanded={connectOpen}>
                {connectOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                <span className="text-[13px] font-semibold text-foreground">Connection info</span>
                <span className="text-[11px] text-muted-foreground">URL, token, client config</span>
              </button>

              <RenderIf condition={connectOpen}>
                <div className="border-t border-border-subtle px-3.5 py-4">
                  <McpConnectPanel server={s} onRotated={onRotated} />
                </div>
              </RenderIf>
            </section>
          </div>
        )}
      </RenderIf>
    </Modal>
  );
}
