import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { CoreMcpCard } from "./components/CoreMcpCard";
import { MyMcpServersBoard } from "./components/MyMcpServersBoard";

export default function MyMcpServersPage() {
  return (
    <PageShell>
      <PageHeader title="MCP servers" icon="mcp" description="Connect Claude Code, Codex or Cursor. Core MCP manages everything; workspace servers expose selected tools." />
      <CoreMcpCard />
      <MyMcpServersBoard />
    </PageShell>
  );
}
