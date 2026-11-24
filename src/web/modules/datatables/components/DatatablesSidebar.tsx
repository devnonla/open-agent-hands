import { Button, Icon, Skeleton, Tree } from "devnonla-ui";
import { Database, Settings, Waypoints } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import { FeatureIcon } from "src/components/FeatureIcon";
import type { DatatableProjectListItem } from "../common/datatableProjectsSlice";

const TABLES_ROOT = "__tables";

export function DatatablesSidebar({
  project,
  projectsLoading,
  selectedTableId,
  onSelectTable,
  settingsActive,
  schemaActive,
}: {
  project: DatatableProjectListItem | null;
  projectsLoading: boolean;
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
  settingsActive: boolean;
  schemaActive: boolean;
}) {
  const navigate = useNavigate();
  const tables = project?.tables ?? [];
  const activeTableId = !settingsActive && !schemaActive ? selectedTableId : null;

  return (
    <aside className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex flex-col gap-3 px-2 pt-3 pb-3">
        <Button type="text" size="small" onClick={() => navigate("/datatables")} icon={<Icon name="arrow-back" />} className="self-start font-normal text-muted-foreground hover:text-foreground">
          Datatables
        </Button>
        <div className="flex min-w-0 items-center gap-3 px-2">
          <FeatureIcon name="datatables" size={36} variant="sticker" />
          <div className="min-w-0 flex-1">
            {!project && projectsLoading ? <Skeleton.Input className="h-6 w-32" /> : <h1 className="m-0 truncate text-lg leading-6 font-semibold text-foreground">{project?.name ?? "Project"}</h1>}
          </div>
        </div>
      </div>

      <nav aria-label="Tables" className="min-h-0 flex-1 overflow-y-auto border-t border-border px-1.5 pt-2 pb-3">
        {projectsLoading && !project ? (
          <Skeleton title={false} paragraph={{ rows: 4 }} className="px-2 py-2" />
        ) : !project ? (
          <p className="m-0 px-2 py-2 text-sm text-muted-foreground">Project not found</p>
        ) : tables.length === 0 ? (
          <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">No tables</p>
        ) : (
          <Tree
            aria-label="Tables"
            size="default"
            defaultExpandAll
            selectedKeys={activeTableId ? [activeTableId] : []}
            onSelect={(_, info) => {
              if (info.node.key !== TABLES_ROOT) onSelectTable(info.node.key);
            }}
            treeData={[
              {
                key: TABLES_ROOT,
                icon: <Database size={16} className="text-muted-foreground" />,
                title: (
                  <span className="flex items-center gap-2">
                    Tables
                    <span className="tabular-nums text-muted-foreground">{tables.length}</span>
                  </span>
                ),
                children: tables.map((table) => ({ key: table.id, title: table.name })),
              },
            ]}
          />
        )}
      </nav>
      <nav aria-label="Project views" className="shrink-0 border-t border-border px-1.5 py-1.5">
        <Button
          type="text"
          block
          aria-pressed={schemaActive}
          disabled={!project}
          onClick={() => {
            if (project) navigate(`/datatables/${project.id}/schema`);
          }}
          icon={<Waypoints size={15} className="text-muted-foreground" />}
          className={cn("justify-start gap-2", schemaActive ? "bg-ink-active font-medium text-foreground" : "font-normal text-foreground")}
          classNames={{ content: "block truncate" }}
        >
          Schema
        </Button>
        <Button
          type="text"
          block
          aria-pressed={settingsActive}
          disabled={!project}
          onClick={() => {
            if (project) navigate(`/datatables/${project.id}/settings`);
          }}
          icon={<Settings size={15} className="text-muted-foreground" />}
          className={cn("justify-start gap-2", settingsActive ? "bg-ink-active font-medium text-foreground" : "font-normal text-foreground")}
          classNames={{ content: "block truncate" }}
        >
          Settings
        </Button>
      </nav>
    </aside>
  );
}
