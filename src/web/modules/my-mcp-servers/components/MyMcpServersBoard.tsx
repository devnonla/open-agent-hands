import { Alert } from "devnonla-ui";
import { useEffect, useState } from "react";
import type { MyMcpServer } from "src/common/types";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import { FeatureIcon } from "src/components/FeatureIcon";
import RenderIf from "src/components/RenderIf";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fetchMyMcpServers, toMyMcpServerListItem, updateMyMcpServer, upsertMyMcpServerLocal } from "../common/myMcpServersSlice";
import { MyMcpConnectDialog } from "./MyMcpConnectDialog";
import { MyMcpServerCard } from "./MyMcpServerCard";
import { MyMcpServerDetailDialog } from "./MyMcpServerDetailDialog";
import { MyMcpServerDialog } from "./MyMcpServerDialog";
import { MyMcpTokenDialog } from "./MyMcpTokenDialog";

export function MyMcpServersBoard() {
  const dispatch = useAppDispatch();
  const servers = useAppSelector((s) => s.myMcpServers.items) as MyMcpServer[];
  const [loaded, setLoaded] = useState(false);

  const [error, setError] = useState("");
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [connectId, setConnectId] = useState<string | null>(null);
  const [edit, setEdit] = useState<MyMcpServer | null>(null);
  const [tokenServer, setTokenServer] = useState<MyMcpServer | null>(null);

  useEffect(() => {
    void Promise.resolve(dispatch(fetchMyMcpServers())).finally(() => setLoaded(true));
  }, [dispatch]);

  const handleToggleActive = async (id: string, isActive: boolean) => {
    setTogglingIds((prev) => new Set(prev).add(id));
    setError("");
    try {
      const updated = (await dispatch(updateMyMcpServer({ id, isActive })).unwrap()) as MyMcpServer;
      dispatch(upsertMyMcpServerLocal(toMyMcpServerListItem(updated)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const detailListItem = servers.find((s) => s.id === detailId) ?? null;

  return (
    <>
      <RenderIf condition={!!error}>
        <Alert type="error" description={error} showIcon className="mb-4 border-destructive/30 bg-destructive/10" />
      </RenderIf>

      <RenderIf condition={servers.length > 0} fallback={<EmptyGuide loading={!loaded} />}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {servers.map((server) => (
            <MyMcpServerCard key={server.id} server={server} toggling={togglingIds.has(server.id)} onOpen={() => setDetailId(server.id)} onConnect={() => setConnectId(server.id)} onToggleActive={(checked) => void handleToggleActive(server.id, checked)} />
          ))}
        </div>
      </RenderIf>

      <MyMcpServerDetailDialog serverId={detailId} listItem={detailListItem} onClose={() => setDetailId(null)} onEdit={(server) => setEdit(server)} onRotated={setTokenServer} />

      <RenderIf condition={edit !== null}>
        <MyMcpServerDialog
          edit={edit}
          onClose={() => setEdit(null)}
          onCreated={(created) => {
            setTokenServer(created);
          }}
        />
      </RenderIf>

      <MyMcpConnectDialog
        server={servers.find((s) => s.id === connectId) ?? null}
        onClose={() => setConnectId(null)}
        onRotated={(server) => {
          setConnectId(null);
          setTokenServer(server);
        }}
      />

      <RenderIf condition={!!tokenServer?.key}>
        <MyMcpTokenDialog server={tokenServer!} onClose={() => setTokenServer(null)} />
      </RenderIf>
    </>
  );
}

const STEPS = [
  { title: "Pick your tools", body: "Choose which custom tools this server exposes. Create tools on the Tools page first." },
  { title: "Copy the token", body: "A private token is generated once. Save it somewhere safe." },
  { title: "Paste into your client", body: "Add the ready-made config to Cursor or Claude Code and the tools show up." },
];

function EmptyGuide({ loading }: { loading: boolean }) {
  if (loading) return null;
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
        <FeatureIcon name="mcp" size={28} variant="sticker" />
      </div>
      <h2 className="m-0 mt-4 text-base font-semibold text-foreground">Use your tools from Cursor or Claude Code</h2>
      <p className="m-0 mt-1 max-w-md text-[13px] text-tertiary-foreground">An MCP server gives other apps a private URL to call the custom tools you built here.</p>
      <ol className="m-0 mt-6 grid w-full max-w-2xl list-none grid-cols-1 gap-3 p-0 text-left sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="rounded-xl border border-border-subtle bg-card p-4">
            <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
            <div className="mt-2 text-[13px] font-semibold text-foreground">{step.title}</div>
            <p className="m-0 mt-1 text-[12px] leading-relaxed text-tertiary-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
      <AskClaudeHint what="hosted MCP server" tool="create_mcp_server" />
    </div>
  );
}
