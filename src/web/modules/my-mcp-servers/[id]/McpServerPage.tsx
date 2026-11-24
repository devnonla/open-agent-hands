import { Empty, Spin } from "devnonla-ui";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { MyMcpServer } from "src/common/types";
import { ContentBreadcrumb, ContentHeader } from "src/components/ContentBreadcrumb";
import { FeatureIcon } from "src/components/FeatureIcon";
import RenderIf from "src/components/RenderIf";
import { WindowHeaderBackButton } from "src/components/WindowHeaderBackButton";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { CORE_KEY } from "../common/constants";
import { fetchOneMyMcpServer, toMyMcpServerListItem, upsertMyMcpServerLocal } from "../common/myMcpServersSlice";
import { McpServerDetail } from "../components/McpServerDetail";
import { MyMcpTokenDialog } from "../components/MyMcpTokenDialog";

const LIST_PATH = "/mcp-servers";

function ServerPanel({ id }: { id: string }) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const server = useAppSelector((s) => (s.myMcpServers.items as MyMcpServer[]).find((item) => item.id === id) ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">(server ? "ready" : "loading");
  const [tokenServer, setTokenServer] = useState<MyMcpServer | null>(null);

  useEffect(() => {
    let cancelled = false;
    dispatch(fetchOneMyMcpServer(id))
      .unwrap()
      .then((row: MyMcpServer) => {
        if (cancelled) return;
        dispatch(upsertMyMcpServerLocal(toMyMcpServerListItem(row)));
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, id]);

  if (!server) {
    if (status === "loading") return <Spin className="flex justify-center py-16" />;
    return <Empty className="py-16" description="This MCP server no longer exists." />;
  }

  return (
    <>
      <McpServerDetail key={server.id} server={server} onRotated={setTokenServer} onDeleted={() => navigate(LIST_PATH)} />
      <RenderIf condition={!!tokenServer?.key}>
        <MyMcpTokenDialog server={tokenServer!} onClose={() => setTokenServer(null)} />
      </RenderIf>
    </>
  );
}

export default function McpServerPage() {
  const { id = CORE_KEY } = useParams<{ id: string }>();
  const name = useAppSelector((s) => (s.myMcpServers.items as MyMcpServer[]).find((item) => item.id === id)?.name ?? "MCP server");

  if (id === CORE_KEY) return <Navigate to="/connect/mcp" replace />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ContentHeader
        left={
          <div className="flex min-w-0 items-center gap-2">
            <WindowHeaderBackButton to={LIST_PATH} label="Back to MCP servers" />
            <ContentBreadcrumb items={[{ label: "MCP servers", to: LIST_PATH, icon: <FeatureIcon name="mcp" size={16} variant="sticker" /> }, { label: name }]} />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col"><ServerPanel id={id} /></div>
    </div>
  );
}
