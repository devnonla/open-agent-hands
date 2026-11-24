import { Card, Skeleton, Tree, type TreeNode } from "devnonla-ui";
import { Folder, Wrench } from "lucide-react";
import { ConnectAgentPanel } from "src/components/ConnectAgentPanel";
import { McpLogo } from "src/modules/my-mcp-servers/components/McpLogo";
import type { ConnectInfo, CoreToolGroup } from "../common/useConnectInfo";
import { CopyValue, RESPONSIVE_ROW } from "./CopyValue";
import { KeyLabel } from "./KeyLabel";
import { KeyValue } from "./KeyValue";

function toolTree(groups: CoreToolGroup[], toolCount: number): TreeNode[] {
  return [
    {
      key: "core",
      icon: <McpLogo size={14} />,
      title: (
        <span className="flex items-center gap-2">
          Core MCP
          <span className="tabular-nums text-xs text-tertiary-foreground">{toolCount}</span>
        </span>
      ),
      children: groupNodes(groups),
    },
  ];
}

function groupNodes(groups: CoreToolGroup[]): TreeNode[] {
  return groups.map(({ group, tools }) => ({
    key: `group:${group}`,
    icon: <Folder size={14} className="text-muted-foreground" />,
    title: (
      <span className="flex items-center gap-2">
        {group}
        <span className="tabular-nums text-xs text-tertiary-foreground">{tools.length}</span>
      </span>
    ),
    children: tools.map((tool) => ({
      key: tool.name,
      icon: <Wrench size={14} className="text-muted-foreground" />,
      title: <code className="font-mono text-xs text-foreground">{tool.name}</code>,
    })),
  }));
}

export function McpTab({ info }: { info: ConnectInfo }) {
  const { server, key, groups, toolCount, error, setKey } = info;
  const pending = error ? <span className="text-xs text-destructive">{error}</span> : <Skeleton.Input active />;
  const endpoint = `${server}/mcp/core`;

  return (
    <>
      <ConnectAgentPanel via="mcp" showDetails={false} title="Connect over MCP" description="For clients that can't run shell commands. Some clients must restart before they see new tools." />

      <Card title="MCP">
        <Card.Item label="Endpoint" description="Streamable HTTP." align="center" className={RESPONSIVE_ROW}>
          <CopyValue shown={endpoint} value={endpoint} label="Copy endpoint" toast="Endpoint copied" />
        </Card.Item>
        <Card.Item label={<KeyLabel />} description="Sent as Authorization: Bearer <key>." align="center" className={RESPONSIVE_ROW}>
          {key ? <KeyValue apiKey={key} onRotated={setKey} /> : pending}
        </Card.Item>
      </Card>

      {groups.length > 0 ? (
        <Card title={`Tools (${toolCount})`} caption="The same tools are oahctl commands.">
          <div className="p-2">
            <Tree aria-label="Core MCP tools" selectable={false} defaultExpandAll treeData={toolTree(groups, toolCount)} />
          </div>
        </Card>
      ) : null}
    </>
  );
}
