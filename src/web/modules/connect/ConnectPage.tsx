import { Tabs } from "devnonla-ui";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { McpLogo } from "src/modules/my-mcp-servers/components/McpLogo";
import { useConnectInfo } from "./common/useConnectInfo";
import { ApiTab } from "./components/ApiTab";
import { CliTab } from "./components/CliTab";
import { McpTab } from "./components/McpTab";

const TABS = [
  { key: "cli", label: "CLI", icon: "code" },
  { key: "mcp", label: "MCP", icon: <McpLogo size={16} /> },
  { key: "api", label: "API", icon: "shield-check" },
] as const;

type ConnectTab = (typeof TABS)[number]["key"];

export default function ConnectPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const info = useConnectInfo();
  const segment = pathname.split("/").filter(Boolean)[1] ?? "";
  const active = TABS.find((tab) => tab.key === segment)?.key as ConnectTab | undefined;

  if (!active) return <Navigate to="/connect/cli" replace />;

  return (
    <PageShell
      header={<PageHeader title="Connect" icon="connect" description="Let your agent work here." className="mb-0 pb-0" bordered={false} />}
      tabs={<Tabs aria-label="Ways to connect" activeKey={active} onChange={(tab) => navigate(`/connect/${tab}`)} items={TABS.map((tab) => ({ key: tab.key, label: tab.label, icon: tab.icon }))} />}
    >
      <div className="@container flex w-full max-w-3xl flex-col gap-6 pt-1">{active === "cli" ? <CliTab info={info} /> : active === "mcp" ? <McpTab info={info} /> : <ApiTab />}</div>
    </PageShell>
  );
}
