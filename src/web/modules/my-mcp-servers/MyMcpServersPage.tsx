import { Button } from "devnonla-ui";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { MyMcpServersBoard } from "./components/MyMcpServersBoard";

export default function MyMcpServersPage() {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <PageShell>
      <PageHeader
        title="MCP servers"
        icon="mcp"
        description="Let Cursor and Claude Code use your custom tools."
        actions={
          <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            New server
          </Button>
        }
      />
      <MyMcpServersBoard createOpen={createOpen} onCreateOpenChange={setCreateOpen} />
    </PageShell>
  );
}
