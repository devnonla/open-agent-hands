import { useMemo } from "react";
import type { AgentTool } from "src/common/types";
import { useAppSelector } from "src/store/store";
import { useAgentDetailContext } from "../../common/agentDetailContext";
import { buildToolGroups } from "../../common/configGroups";
import { ConfigTreeGroup, ConfigTreeRow, toggleGroupItems } from "./ConfigTree";

export function ToolsToggleList() {
  const { toolAssignments, onToggleTool, readonly } = useAgentDetailContext();
  const allTools = useAppSelector((s) => s.tools.items) as AgentTool[];
  const toolFolders = useAppSelector((s) => s.toolFolders.folders);

  const catalog = useMemo(() => (readonly ? allTools : allTools.filter((tool) => tool.workspaceOnly !== true)), [allTools, readonly]);

  const groups = useMemo(() => {
    const built = buildToolGroups({ allTools: catalog, toolFolders, toolAssignments, includeMemory: !readonly });
    // Builtin agents are read-only — show only attached tools, not the full catalog.
    if (!readonly) return built;
    return built.map((group) => ({ ...group, tools: group.tools.filter((tool) => tool.connected) })).filter((group) => group.tools.length > 0);
  }, [catalog, toolFolders, toolAssignments, readonly]);
  const totalCount = useMemo(() => groups.flatMap((g) => g.tools).length, [groups]);

  if (totalCount === 0) {
    return <div className="py-10 text-center text-[12px] text-muted-foreground">{readonly ? "No tools attached" : "No tools available"}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const toggleable = group.tools.filter((tool) => !tool.locked);
        return (
          <ConfigTreeGroup key={group.id ?? group.name} icon="code" title={group.name} allChecked={toggleable.length > 0 && toggleable.every((t) => t.connected)} onToggleAll={readonly || toggleable.length === 0 ? undefined : (checked) => toggleGroupItems(toggleable, checked, onToggleTool)} note={group.note}>
            {group.tools.map((tool, index) => (
              <ConfigTreeRow key={tool.id} icon="code" label={tool.label} checked={tool.connected} disabled={readonly || tool.locked === true} onToggle={readonly || tool.locked ? undefined : (checked) => onToggleTool(tool.id, checked)} isLast={index === group.tools.length - 1} />
            ))}
          </ConfigTreeGroup>
        );
      })}
    </div>
  );
}
