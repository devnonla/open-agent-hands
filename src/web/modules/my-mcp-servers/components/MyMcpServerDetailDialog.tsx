import { Alert, Button, Empty, Icon, Input, Modal, Popconfirm, Switch, message } from "devnonla-ui";
import { ChevronDown, ChevronRight, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { apiClient } from "src/common/api";
import { cn } from "src/common/lib/cn";
import type { MyMcpServer } from "src/common/types";
import { relativeTime } from "src/common/utils/date";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch } from "src/store/store";
import { copyText } from "../common/copy";
import { deleteMyMcpServer, toMyMcpServerListItem, updateMyMcpServer, upsertMyMcpServerLocal } from "../common/myMcpServersSlice";
import { mcpEndpointUrl } from "../common/snippets";
import { ConnectSnippet } from "./ConnectSnippet";

const TOKEN_PLACEHOLDER = "YOUR_TOKEN";

export function MyMcpServerDetailDialog({
  serverId,
  listItem,
  onClose,
  onEdit,
  onRotated,
}: {
  serverId: string | null;
  listItem: MyMcpServer | null;
  onClose: () => void;
  onEdit: (server: MyMcpServer) => void;
  onRotated: (server: MyMcpServer) => void;
}) {
  const dispatch = useAppDispatch();
  const [toolQuery, setToolQuery] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!serverId) return;
    setToolQuery("");
    setConnectOpen(false);
    setUrlCopied(false);
  }, [serverId]);

  const server = listItem;
  const tools = server?.tools ?? [];
  const url = server ? mcpEndpointUrl(server.id) : "";

  const filteredTools = useMemo(() => {
    const q = toolQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((tool) => tool.name.toLowerCase().includes(q) || tool.label.toLowerCase().includes(q) || (tool.description ?? "").toLowerCase().includes(q));
  }, [tools, toolQuery]);

  const handleCopyUrl = async () => {
    if (!(await copyText(url, "URL copied"))) return;
    setUrlCopied(true);
    window.setTimeout(() => setUrlCopied(false), 1500);
  };

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

  const handleRotate = async () => {
    if (!server) return;
    setRotating(true);
    try {
      const rotated = await apiClient.post<MyMcpServer>(`/api/my-mcp-servers/${server.id}/rotate-key`);
      dispatch(upsertMyMcpServerLocal(toMyMcpServerListItem(rotated)));
      onRotated(rotated);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
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
                <Button className="ml-auto" size="small" icon={<Pencil size={13} />} onClick={() => onEdit(s)}>
                  Edit tools
                </Button>
              </div>

              <RenderIf
                condition={tools.length > 0}
                fallback={
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
                    <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Icon name="stars" size={18} />
                    </div>
                    <p className="m-0 text-sm font-medium text-foreground">No tools exposed yet</p>
                    <p className="mt-1 mb-3 text-xs text-muted-foreground">Clients can connect, but they will see an empty tool list.</p>
                    <Button type="primary" size="small" icon={<Pencil size={13} />} onClick={() => onEdit(s)}>
                      Pick tools
                    </Button>
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
                <div className="flex flex-col gap-5 border-t border-border-subtle px-3.5 py-4">
                  <Step n={1} title="Endpoint URL">
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-card py-1 pr-1 pl-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{url}</span>
                      <Button type="text" size="small" icon={<Icon name={urlCopied ? "check" : "copy"} size={13} />} onClick={() => void handleCopyUrl()}>
                        {urlCopied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </Step>

                  <Step n={2} title="Token">
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-card py-1.5 pr-1.5 pl-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{s.keyPrefix}…</span>
                      <Popconfirm title="Rotate token?" description="The current token stops working immediately. You will get a new one to copy." okText="Rotate" onConfirm={() => void handleRotate()} styles={{ root: { width: 300 } }}>
                        <Button size="small" icon={<RefreshCw size={13} />} loading={rotating}>
                          Rotate
                        </Button>
                      </Popconfirm>
                    </div>
                    <p className="m-0 text-[11px] text-tertiary-foreground">The full token is only shown once when the server is created. Lost it? Rotate to get a new one.</p>
                  </Step>

                  <Step n={3} title="Add to your client">
                    <ConnectSnippet name={s.name} url={url} token={TOKEN_PLACEHOLDER} />
                    <p className="m-0 text-[11px] text-tertiary-foreground">
                      Replace <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{TOKEN_PLACEHOLDER}</code> with your token and keep the file private.
                    </p>
                  </Step>
                </div>
              </RenderIf>
            </section>
          </div>
        )}
      </RenderIf>
    </Modal>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        {children}
      </div>
    </div>
  );
}
