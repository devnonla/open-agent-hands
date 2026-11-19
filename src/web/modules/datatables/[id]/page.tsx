import { Button, Icon, Splitter, message } from "devnonla-ui";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useMatch, useNavigate, useParams } from "react-router-dom";
import type { DatatableColumn, DatatableProject, DatatableTable } from "src/common/types";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { type DatatableProjectListItem, fetchDatatableProjects, setDatatableProjectTables } from "../common/datatableProjectsSlice";
import { datatablesApi } from "../common/datatablesApi";
import { DatatableProjectHeader } from "../components/DatatableProjectHeader";
import { DatatablesSidebar } from "../components/DatatablesSidebar";
import { NewTablePopover } from "../components/NewTablePopover";
import { ProjectSettingsPage } from "../components/ProjectSettingsPage";
import { SchemaFlow } from "../components/SchemaFlow";
import { TableRowsPanel } from "../components/TableRowsPanel";

const RAIL_KEY = "datatables-rail-width";
const RAIL_MIN = 240;
const RAIL_MAX = 420;
const RAIL_DEFAULT = 260;

function storedRailWidth() {
  try {
    const width = Number(localStorage.getItem(RAIL_KEY));
    if (Number.isFinite(width) && width >= RAIL_MIN && width <= RAIL_MAX) return width;
  } catch {
    return RAIL_DEFAULT;
  }
  return RAIL_DEFAULT;
}

function sortTablesByName(tables: DatatableTable[]) {
  return [...tables].sort((a, b) => a.name.localeCompare(b.name));
}

export default function DatatableProjectPage() {
  const { projectId } = useParams();
  const settingsMatch = useMatch("/datatables/:projectId/settings");
  const schemaMatch = useMatch("/datatables/:projectId/schema");
  const settingsProjectId = settingsMatch?.params.projectId ?? null;
  const schemaProjectId = schemaMatch?.params.projectId ?? null;
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const items = useAppSelector((s) => s.datatableProjects.items) as DatatableProjectListItem[];
  const [projectsLoading, setProjectsLoading] = useState(items.length === 0);
  const [project, setProject] = useState<DatatableProject | null>(null);
  const [tables, setTables] = useState<DatatableTable[]>([]);
  const [columnsMap, setColumnsMap] = useState<Record<string, DatatableColumn[]>>({});
  const [schemaFor, setSchemaFor] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState("");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [railWidth] = useState(storedRailWidth);

  const schemaReady = schemaFor === projectId && !!projectId;
  const visibleTables = schemaReady ? tables : [];
  const resolvedTableId = visibleTables.some((table) => table.id === selectedTableId) ? selectedTableId : (visibleTables[0]?.id ?? null);
  const listProject = items.find((item) => item.id === projectId) ?? null;
  const currentTableName = visibleTables.find((table) => table.id === resolvedTableId)?.name ?? listProject?.tables?.find((table) => table.id === selectedTableId)?.name ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await dispatch(fetchDatatableProjects()).unwrap();
      } catch (err: unknown) {
        if (!cancelled) message.error(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  const applySchema = useCallback(
    (id: string, schema: Awaited<ReturnType<typeof datatablesApi.getProjectSchema>>) => {
      const nextTables = schema.tables.map(({ columns: _columns, ...table }) => table);
      const sorted = sortTablesByName(nextTables);
      setProject(schema.project);
      setTables(nextTables);
      setColumnsMap(Object.fromEntries(schema.tables.map((table) => [table.id, table.columns])));
      setSchemaFor(id);
      setSelectedTableId((prev) => (prev && sorted.some((table) => table.id === prev) ? prev : (sorted[0]?.id ?? null)));
      dispatch(setDatatableProjectTables({ projectId: id, tables: sorted.map((table) => ({ id: table.id, name: table.name })) }));
    },
    [dispatch],
  );

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      setTables([]);
      setColumnsMap({});
      setSchemaFor(null);
      setSchemaError("");
      setSelectedTableId(null);
      return;
    }
    let cancelled = false;
    setSchemaFor(null);
    setSchemaError("");
    void (async () => {
      try {
        const schema = await datatablesApi.getProjectSchema(projectId);
        if (!cancelled) applySchema(projectId, schema);
      } catch (err: unknown) {
        if (cancelled) return;
        const text = err instanceof Error ? err.message : String(err);
        setSchemaError(text);
        message.error(text);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, applySchema]);

  const rememberTables = (ownerId: string, next: { id: string; name: string }[]) => {
    dispatch(setDatatableProjectTables({ projectId: ownerId, tables: next }));
  };

  const handleTableCreated = (table: DatatableTable) => {
    if (!projectId) return;
    const owner = items.find((item) => item.id === projectId);
    rememberTables(projectId, [...(owner?.tables ?? []), { id: table.id, name: table.name }]);
    setSelectedTableId(table.id);
    setTables((prev) => sortTablesByName([...prev, table]));
    setColumnsMap((prev) => ({ ...prev, [table.id]: [] }));
  };

  return (
    <>
      <Splitter
        className="h-full w-full overflow-hidden"
        onResize={(sizes) => {
          const width = sizes[0];
          if (width == null || width <= 0) return;
          try {
            localStorage.setItem(RAIL_KEY, String(Math.round(width)));
          } catch {
            // Width still applies for this session.
          }
        }}
      >
        <Splitter.Panel defaultSize={railWidth} min={RAIL_MIN} max={RAIL_MAX} className="min-h-0 overflow-hidden border-r border-border">
          <DatatablesSidebar
            project={listProject}
            projectsLoading={projectsLoading}
            selectedTableId={settingsProjectId || schemaProjectId ? null : selectedTableId}
            onSelectTable={(tableId) => {
              setSelectedTableId(tableId);
              if ((settingsProjectId || schemaProjectId) && projectId) navigate(`/datatables/${projectId}`);
            }}
            settingsActive={!!settingsProjectId}
            schemaActive={!!schemaProjectId}
            onTableCreated={handleTableCreated}
          />
        </Splitter.Panel>
        <Splitter.Panel min="40%" className="min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
              {projectId ? (
                <>
                  <DatatableProjectHeader projectName={listProject?.name ?? project?.name ?? "…"} projectTo={`/datatables/${projectId}`} tableName={currentTableName} settings={!!settingsProjectId} schema={!!schemaProjectId} />
                  {settingsProjectId ? (
                    <ProjectSettingsPage projectId={settingsProjectId} loading={projectsLoading} />
                  ) : (
                    <div className="relative flex min-h-0 flex-1 flex-col">
                      {schemaError ? (
                        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">{schemaError}</div>
                      ) : !schemaReady ? (
                        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>
                      ) : visibleTables.length === 0 ? (
                        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
                          <span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                            <Icon name="document" size={24} />
                          </span>
                          <p className="m-0 text-sm font-medium text-foreground">No tables yet</p>
                          <p className="mt-1 mb-4 text-sm text-muted-foreground">Create a table to start adding rows</p>
                          <NewTablePopover projectId={projectId} onSaved={handleTableCreated}>
                            <Button type="primary" icon={<Plus size={16} />}>
                              Add table
                            </Button>
                          </NewTablePopover>
                        </div>
                      ) : schemaProjectId ? (
                        <SchemaFlow
                          tables={visibleTables}
                          columnsMap={columnsMap}
                          onOpenTable={(tableId) => {
                            setSelectedTableId(tableId);
                            navigate(`/datatables/${projectId}`);
                          }}
                        />
                      ) : resolvedTableId ? (
                        <div className="relative min-h-0 flex-1">
                          <TableRowsPanel key={resolvedTableId} tableId={resolvedTableId} columns={columnsMap[resolvedTableId] ?? []} />
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Project not found</div>
              )}
            </div>
          </div>
        </Splitter.Panel>
      </Splitter>
    </>
  );
}
