import { Button, Skeleton, Icon } from "devnonla-ui";
import { Settings, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import type { DatatableProjectListItem } from "../common/datatableProjectsSlice";

const TREE_STROKE = "text-tertiary-foreground";
const TREE_LINE_FILL = "bg-muted-foreground/40";

function TreeGuide({ isLast }: { isLast: boolean }) {
  return (
    <div className={cn("pointer-events-none relative w-5 shrink-0 self-stretch", TREE_STROKE)} aria-hidden>
      {isLast ? (
        <>
          <div className={cn("absolute top-0 left-1/2 w-px -translate-x-1/2", TREE_LINE_FILL, "h-[calc(50%-6px)]")} />
          <svg className="absolute top-[calc(50%-6px)] left-[calc(50%-0.5px)] overflow-visible" width="13" height="7" viewBox="0 0 13 7" fill="none">
            <path d="M0.5 0 V1 Q0.5 6.5 6.5 6.5 H13" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </>
      ) : (
        <>
          <div className={cn("absolute top-0 -bottom-0.5 left-1/2 w-px -translate-x-1/2", TREE_LINE_FILL)} />
          <div className={cn("absolute top-1/2 left-1/2 h-px w-2.5 -translate-y-1/2", TREE_LINE_FILL)} />
        </>
      )}
    </div>
  );
}

function TreeLeaf({ isLast, children }: { isLast: boolean; children: ReactNode }) {
  return (
    <div className="relative flex items-stretch">
      <TreeGuide isLast={isLast} />
      {children}
    </div>
  );
}

function TableRow({ name, active, onOpen }: { name: string; active: boolean; onOpen: () => void }) {
  return (
    <Button type="text" aria-current={active ? "true" : undefined} onClick={onOpen} className={cn("min-w-0 flex-1 justify-start", active ? "bg-ink-active font-medium text-foreground" : "font-normal text-foreground")} classNames={{ content: "block truncate" }}>
      {name}
    </Button>
  );
}

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

  return (
    <aside className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex min-w-0 items-center gap-1 px-2 pt-3 pb-1">
        <Button type="icon" size="small" aria-label="Back to projects" onClick={() => navigate("/datatables")} className="shrink-0 text-muted-foreground hover:text-foreground" icon={<Icon name="arrow-back" />} />
        {!project && projectsLoading ? <Skeleton.Input className="h-5 w-32" /> : <span className="truncate text-base font-semibold text-foreground">{project?.name ?? "Project"}</span>}
      </div>

      <nav aria-label="Tables" className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-2 pb-3">
        {projectsLoading && !project ? (
          <Skeleton title={false} paragraph={{ rows: 4 }} className="px-2 py-2" />
        ) : !project ? (
          <p className="m-0 px-2 py-2 text-sm text-muted-foreground">Project not found</p>
        ) : (
          <div className="relative mt-1 pl-2">
            <div className={cn("pointer-events-none absolute -top-1.5 left-2 h-4 w-5", TREE_STROKE)} aria-hidden>
              <div className={cn("absolute inset-y-0 left-1/2 w-px -translate-x-1/2", TREE_LINE_FILL)} />
            </div>
            <div className="flex flex-col gap-0.5">
              {tables.length === 0 ? <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">No tables</p> : null}
              {tables.map((table, index) => (
                <TreeLeaf key={table.id} isLast={index === tables.length - 1}>
                  <TableRow name={table.name} active={!settingsActive && !schemaActive && table.id === selectedTableId} onOpen={() => onSelectTable(table.id)} />
                </TreeLeaf>
              ))}
            </div>
          </div>
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
