import { Background, type Node, type NodeChange, type NodeProps, ReactFlow, applyNodeChanges, useReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNonlaDark } from "src/common/hooks/useNonlaDark";
import type { DatatableColumn, DatatableColumnType, DatatableTable } from "src/common/types";
import { propertyTypeLabel } from "../common/columnUtils";

const NODE_W = 240;
const GAP_X = 72;
const GAP_Y = 48;
const HEADER_H = 40;
const ROW_H = 32;

type SchemaColumn = {
  id: string;
  name: string;
  type: DatatableColumnType;
  required: boolean;
};

type TableNodeData = {
  name: string;
  columns: SchemaColumn[];
};

type TableFlowNode = Node<TableNodeData, "table">;

const OpenTableContext = createContext<(tableId: string) => void>(() => {});

function nodeHeight(columnCount: number): number {
  return HEADER_H + Math.max(columnCount, 1) * ROW_H;
}

function buildSchemaNodes(tables: DatatableTable[], columnsMap: Record<string, DatatableColumn[]>): TableFlowNode[] {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const columnsByTable = new Map(sorted.map((table) => [table.id, [...(columnsMap[table.id] ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)]));
  const perRow = Math.min(3, Math.max(sorted.length, 1));
  const rowCount = Math.ceil(sorted.length / perRow) || 1;
  const rowHeights: number[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    let max = 0;
    for (let col = 0; col < perRow; col += 1) {
      const table = sorted[row * perRow + col];
      if (!table) break;
      max = Math.max(max, nodeHeight((columnsByTable.get(table.id) ?? []).length));
    }
    rowHeights.push(max);
  }
  const rowY: number[] = [];
  let cursor = 0;
  for (const height of rowHeights) {
    rowY.push(cursor);
    cursor += height + GAP_Y;
  }

  return sorted.map((table, index) => {
    const columns = columnsByTable.get(table.id) ?? [];
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    return {
      id: table.id,
      type: "table",
      position: { x: col * (NODE_W + GAP_X), y: rowY[row] ?? 0 },
      data: {
        name: table.name,
        columns: columns.map((column) => ({
          id: column.id,
          name: column.name,
          type: column.type,
          required: column.required,
        })),
      },
    };
  });
}

function schemaSignature(tables: DatatableTable[], columnsMap: Record<string, DatatableColumn[]>): string {
  return tables
    .map((table) => {
      const columns = columnsMap[table.id] ?? [];
      return `${table.id}:${table.name}:${columns.map((column) => `${column.id},${column.name},${column.type},${column.required},${column.sortOrder}`).join(";")}`;
    })
    .join("|");
}

function TableSchemaNode({ id, data }: NodeProps<TableFlowNode>) {
  const openTable = useContext(OpenTableContext);

  return (
    <div className="w-60 rounded-lg border border-border-subtle bg-card shadow-sm">
      <div className="rounded-t-lg border-b border-border-subtle bg-foreground/4 px-3 py-2">
        <button
          type="button"
          title={data.name}
          className="nodrag nopan block w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-sm font-semibold text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            openTable(id);
          }}
        >
          {data.name}
        </button>
      </div>
      {data.columns.length === 0 ? (
        <p className="m-0 px-3 py-2 text-xs text-muted-foreground">No columns</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {data.columns.map((column) => (
            <li key={column.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={column.name}>
                {column.name}
                {column.required ? <span className="text-brand-700"> *</span> : null}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{propertyTypeLabel(column.type)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const nodeTypes = { table: TableSchemaNode };

function FitSchema({ tableKey }: { tableKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.28, duration: 180, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [tableKey, fitView]);
  return null;
}

function useFlowColorMode(): "light" | "dark" {
  return useNonlaDark() ? "dark" : "light";
}

export function SchemaFlow({ tables, columnsMap, onOpenTable }: { tables: DatatableTable[]; columnsMap: Record<string, DatatableColumn[]>; onOpenTable: (tableId: string) => void }) {
  const signature = useMemo(() => schemaSignature(tables, columnsMap), [tables, columnsMap]);
  const tableKey = useMemo(() => tables.map((table) => table.id).join(","), [tables]);
  const colorMode = useFlowColorMode();
  const [nodes, setNodes] = useState<TableFlowNode[]>(() => buildSchemaNodes(tables, columnsMap));
  const skipSync = useRef(true);

  useEffect(() => {
    if (skipSync.current) {
      skipSync.current = false;
      return;
    }
    const next = buildSchemaNodes(tables, columnsMap);
    setNodes((prev) =>
      next.map((node) => {
        const kept = prev.find((item) => item.id === node.id);
        return kept ? { ...node, position: kept.position } : node;
      }),
    );
  }, [signature]);

  const onNodesChange = useCallback((changes: NodeChange<TableFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  return (
    <OpenTableContext.Provider value={onOpenTable}>
      <div className="schema-flow h-full min-h-0 w-full flex-1" aria-label="Table schema">
        <ReactFlow
          nodes={nodes}
          edges={[]}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          colorMode={colorMode}
          fitView
          fitViewOptions={{ padding: 0.28, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.5}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
          zoomOnDoubleClick={false}
        >
          <Background gap={18} size={1.2} />
          <FitSchema tableKey={tableKey} />
        </ReactFlow>
      </div>
    </OpenTableContext.Provider>
  );
}
