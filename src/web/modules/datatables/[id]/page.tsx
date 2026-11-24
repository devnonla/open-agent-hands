import { Empty, Spin, Splitter, message } from "devnonla-ui";
import { useCallback, useEffect, useState } from "react";
import { useMatch, useNavigate, useParams } from "react-router-dom";
import type { DatatableColumn, DatatableTable } from "src/common/types";
import { AskClaudeHint } from "src/components/AskClaudeHint";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { type DatatableProjectListItem, fetchDatatableProjects, setDatatableProjectTables } from "../common/datatableProjectsSlice";
import { datatablesApi } from "../common/datatablesApi";
import { DatatablesSidebar } from "../components/DatatablesSidebar";
import { ProjectSettingsPage } from "../components/ProjectSettingsPage";
import { SchemaFlow } from "../components/SchemaFlow";
import { TableRowsPanel } from "../components/TableRowsPanel";

const RAIL_KEY = "datatables-rail-width";
const RAIL_MIN = 180;
const RAIL_MAX = 420;
const RAIL_DEFAULT = 240;

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
          />
        </Splitter.Panel>
        <Splitter.Panel min="40%" className="min-h-0 overflow-hidden">
          <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
              {projectId ? (
                <>
                  {settingsProjectId ? (
                    <ProjectSettingsPage projectId={settingsProjectId} loading={projectsLoading} />
                  ) : (
                    <div className="relative flex min-h-0 flex-1 flex-col">
                      {schemaError ? (
                        <Empty bordered={false} icon={null} description={schemaError} className="flex-1" />
                      ) : !schemaReady ? (
                        <div className="flex flex-1 items-center justify-center">
                          <Spin />
                        </div>
                      ) : visibleTables.length === 0 ? (
                        <Empty bordered={false} icon="document" title="No tables yet" className="min-h-0 flex-1">
                          <AskClaudeHint what="table" tool="datatable_create_table" />
                        </Empty>
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
                <Empty bordered={false} icon={null} description="Project not found" className="flex-1" />
              )}
            </div>
          </div>
        </Splitter.Panel>
      </Splitter>
    </>
  );
}
