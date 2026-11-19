import { useMemo } from "react";
import type { McpServer } from "src/common/types";
import { useAppSelector } from "src/store/store";
import { useAgentDetailContext } from "../../common/agentDetailContext";
import { buildMcpGroups } from "../../common/configGroups";
import { ConfigTreeGroup, ConfigTreeRow, toggleGroupItems } from "./ConfigTree";

const MCP_TOOL_ICON = "globe";

export function McpToggleList() {
  const { toolAssignments, onToggleTool, readonly } = useAgentDetailContext();
  const mcpServers = useAppSelector((s) => s.mcpServers.items) as McpServer[];

  const groups = useMemo(() => {
    const built = buildMcpGroups({ mcpServers, toolAssignments });
    if (!readonly) return built;
    return built.map((group) => ({ ...group, tools: group.tools.filter((tool) => tool.connected) })).filter((group) => group.tools.length > 0);
  }, [mcpServers, toolAssignments, readonly]);
  const totalCount = useMemo(() => groups.flatMap((g) => g.tools).length, [groups]);

  if (totalCount === 0) {
    return <div className="py-10 text-center text-[12px] text-muted-foreground">{readonly ? "No MCP tools attached" : "No MCP tools available"}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <ConfigTreeGroup key={group.id} icon="stars" title={group.name} allChecked={group.tools.length > 0 && group.tools.every((t) => t.connected)} onToggleAll={readonly ? undefined : (checked) => toggleGroupItems(group.tools, checked, onToggleTool)}>
          {group.tools.map((tool, index) => (
            <ConfigTreeRow key={tool.id} icon={MCP_TOOL_ICON} label={tool.label} checked={tool.connected} disabled={readonly} onToggle={readonly ? undefined : (checked) => onToggleTool(tool.id, checked)} isLast={index === group.tools.length - 1} />
          ))}
        </ConfigTreeGroup>
      ))}
    </div>
  );
}
