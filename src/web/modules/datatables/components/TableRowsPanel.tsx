import { Button, Icon, Modal, message } from "devnonla-ui";
import { Plus, Trash2 } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { useAppTimezone } from "src/common/hooks/useAppTimezone";
import { cn } from "src/common/lib/cn";
import type { DatatableColumn, DatatableRow } from "src/common/types";
import RenderIf from "src/components/RenderIf";
import { cellValuesEqual } from "../common/cellValueUtils";
import { clampColWidth, columnTrackSize, defaultColumnWidthPx, fitColumnWidthPx } from "../common/columnUtils";
import { PAGE_SIZE } from "../common/constants";
import { datatablesApi } from "../common/datatablesApi";
import { EditableCell } from "./EditableCell";
import { NewDatatableActions, NewDatatableCell, NewDatatableProvider, type NewDatatableRowHandle, NewDatatableRowShell } from "./NewDatatableRow";
import { PropertyHeader } from "./PropertyHeader";

type EditingCell = { rowId: string; colId: string };

function RowCheck({ checked, indeterminate, label, disabled, onChange }: { checked: boolean; indeterminate?: boolean; label: string; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-3.5 cursor-pointer accent-foreground disabled:cursor-default disabled:opacity-40" />;
}

type TableRowsPanelProps = {
  tableId: string;
  /** Schema already loaded on the project page — don't refetch here. */
  columns: DatatableColumn[];
};

export function TableRowsPanel({ tableId, columns }: TableRowsPanelProps) {
  const timeZone = useAppTimezone();
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<DatatableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const newRowRef = useRef<NewDatatableRowHandle>(null);
  const loadingMoreRef = useRef(false);
  const rowsLenRef = useRef(0);
  const totalRef = useRef(0);
  const suppressNextCellActionRef = useRef(false);

  rowsLenRef.current = rows.length;
  totalRef.current = total;

  const armSuppressNextCellAction = () => {
    suppressNextCellActionRef.current = true;
    window.setTimeout(() => {
      suppressNextCellActionRef.current = false;
    }, 0);
  };

  const tryCellAction = () => {
    if (!suppressNextCellActionRef.current) return true;
    suppressNextCellActionRef.current = false;
    return false;
  };

  const stopEditing = () => {
    armSuppressNextCellAction();
    setEditingCell(null);
  };

  const hasMore = rows.length < total;

  const syncColumnWidths = (list: DatatableColumn[]) => {
    setColumnWidths((prev) => {
      const next: Record<string, number> = {};
      for (const col of list) {
        next[col.id] = prev[col.id] ?? defaultColumnWidthPx(col);
      }
      return next;
    });
  };

  const fetchRows = async (offset: number, append: boolean) => {
    const result = await datatablesApi.queryRows(tableId, { limit: PAGE_SIZE, offset });
    setTotal(result.total);
    setRows((prev) => (append ? [...prev, ...result.items] : result.items));
    return result;
  };

  const loadInitial = async () => {
    setLoading(true);
    try {
      await fetchRows(0, false);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMoreRef.current || rowsLenRef.current >= totalRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await fetchRows(rowsLenRef.current, true);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const saveCell = async (row: DatatableRow, col: DatatableColumn, nextValue: unknown) => {
    const prevValue = row.data?.[col.name];
    const keepOpen = col.type === "text" || col.type === "json";
    if (cellValuesEqual(prevValue, nextValue)) {
      if (!keepOpen) stopEditing();
      return;
    }
    const optimistic: DatatableRow = {
      ...row,
      data: { ...row.data, [col.name]: nextValue },
    };
    setRows((prev) => prev.map((r) => (r.id === row.id ? optimistic : r)));
    if (!keepOpen) stopEditing();
    try {
      const updated = await datatablesApi.updateRow(row.id, { [col.name]: nextValue });
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      if (keepOpen) stopEditing();
    } catch (err: unknown) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      message.error(err instanceof Error ? err.message : String(err));
      if (keepOpen) throw err;
    }
  };

  useEffect(() => {
    setEditingCell(null);
    setAdding(false);
    setSelectedIds(new Set());
    setConfirmDelete(false);
    setRows([]);
    setTotal(0);
    void loadInitial();
  }, [tableId]);

  const handleAddClick = () => {
    if (columns.length === 0) return;
    if (adding) {
      newRowRef.current?.focusFirst();
      return;
    }
    setEditingCell(null);
    setAdding(true);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const handleCreateRow = async (data: Record<string, unknown>) => {
    try {
      const created = await datatablesApi.insertRows(tableId, [data]);
      setRows((prev) => [...created, ...prev]);
      setTotal((prev) => prev + created.length);
      setAdding(false);
      message.success("Created");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  useEffect(() => {
    syncColumnWidths(columns);
  }, [columns]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root, rootMargin: "120px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [tableId, hasMore, rows.length]);

  const startColumnResize = (colId: string, startWidth: number, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      setColumnWidths((prev) => ({
        ...prev,
        [colId]: clampColWidth(startWidth + (ev.clientX - startX)),
      }));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const selectedCount = rows.reduce((count, row) => count + (selectedIds.has(row.id) ? 1 : 0), 0);
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const selecting = selectedCount > 0;

  useEffect(() => {
    if (!selecting) return;
    setEditingCell(null);
    setAdding(false);
  }, [selecting]);

  const toggleRow = (rowId: string, on: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  };

  const toggleAll = (on: boolean) => {
    setSelectedIds(on ? new Set(rows.map((row) => row.id)) : new Set());
  };

  const deleteSelected = async () => {
    const ids = rows.filter((row) => selectedIds.has(row.id)).map((row) => row.id);
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const result = await datatablesApi.bulkDeleteRows(tableId, ids);
      const removed = new Set(ids);
      setRows((prev) => prev.filter((row) => !removed.has(row.id)));
      setTotal((prev) => Math.max(0, prev - result.deleted));
      setSelectedIds(new Set());
      setConfirmDelete(false);
      message.success(result.deleted === 1 ? "Deleted 1 row" : `Deleted ${result.deleted} rows`);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };
  const fitColumn = (col: DatatableColumn) => {
    setColumnWidths((prev) => ({
      ...prev,
      [col.id]: fitColumnWidthPx(col, rows, timeZone),
    }));
  };

  const lastColumnId = columns[columns.length - 1]?.id;
  // Trailing gutter so the last column's edit popover is not clipped by the panel edge.
  const gridTemplate = ["36px", "40px", ...columns.map((col) => columnTrackSize(col, columnWidths[col.id])), ...(adding ? ["88px"] : []), "200px"].join(" ");

  useEffect(() => {
    if (!editingCell || editingCell.colId !== lastColumnId) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  }, [editingCell, lastColumnId]);
  // Bottom status bar sits outside the scroll area so the count stays pinned.
  const showStatusBar = !loading && columns.length > 0;
  const loadedCount = rows.length;

  return (
    // Parent must be a sized flex/absolute container (drawer body or page shell).
    // Absolute fill pins both scrollbars to the visible viewport — horizontal bar
    // stays at the bottom of the panel instead of the bottom of the row list.
    <NewDatatableProvider columns={columns} timeZone={timeZone} onCreate={handleCreateRow} onCancel={() => setAdding(false)} active={adding} handleRef={newRowRef}>
      <div className="relative h-full min-h-0 w-full flex-1">
        <div ref={scrollRef} className={cn("absolute inset-x-0 top-0 overflow-auto overscroll-contain", showStatusBar ? "bottom-8" : "bottom-0")}>
          <RenderIf
            condition={!loading && columns.length === 0}
            fallback={
              <div className={cn("min-w-max", loading && "opacity-60")}>
                <div className="sticky top-0 z-10 grid border-b border-border-subtle bg-card" style={{ gridTemplateColumns: gridTemplate }}>
                  <div className="flex h-9 items-center justify-center border-r border-border-subtle">
                    <RowCheck checked={allSelected} indeterminate={selectedCount > 0 && !allSelected} label={allSelected ? "Clear selection" : "Select all rows"} disabled={rows.length === 0} onChange={toggleAll} />
                  </div>
                  <div className="flex h-9 items-center justify-center border-r border-border-subtle px-1 text-[11px] font-medium tabular-nums text-quaternary-foreground">#</div>
                  {columns.map((col) => {
                    const width = columnWidths[col.id] ?? defaultColumnWidthPx(col);
                    return (
                      <div key={col.id} className="relative h-9 border-r border-border-subtle">
                        <PropertyHeader col={col} timeZone={timeZone} />
                        <button
                          type="button"
                          aria-label={`Resize ${col.name}`}
                          title="Drag to resize · Double-click to fit"
                          className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0 hover:bg-brand/30 active:bg-brand/40"
                          onMouseDown={(e) => startColumnResize(col.id, width, e)}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            fitColumn(col);
                          }}
                        />
                      </div>
                    );
                  })}
                  {adding ? <div /> : null}
                </div>

                <RenderIf condition={adding}>
                  <NewDatatableRowShell className="grid border-b border-border-subtle bg-muted/30" style={{ gridTemplateColumns: gridTemplate }}>
                    <div className="border-r border-border-subtle" />
                    <div className="flex h-9 items-center justify-center border-r border-border-subtle text-[11px] tabular-nums text-quaternary-foreground">+</div>
                    {columns.map((col) => (
                      <NewDatatableCell key={col.id} col={col} />
                    ))}
                    <NewDatatableActions />
                  </NewDatatableRowShell>
                </RenderIf>

                {rows.map((row, idx) => {
                  const selected = selectedIds.has(row.id);
                  return (
                    <div
                      key={row.id}
                      className={cn("grid border-b border-border-subtle transition-colors", selecting && "cursor-pointer", selected ? "bg-muted/50" : "hover:bg-muted/35")}
                      style={{ gridTemplateColumns: gridTemplate }}
                      onClick={
                        selecting
                          ? () => {
                              toggleRow(row.id, !selected);
                            }
                          : undefined
                      }
                    >
                      <div className="flex h-9 items-center justify-center border-r border-border-subtle" onClick={(event) => event.stopPropagation()}>
                        <RowCheck checked={selected} label={`Select row ${idx + 1}`} onChange={(on) => toggleRow(row.id, on)} />
                      </div>
                      <div className="flex h-9 items-center justify-center border-r border-border-subtle text-[11px] tabular-nums text-quaternary-foreground">{idx + 1}</div>
                      {columns.map((col) => (
                        <EditableCell
                          key={col.id}
                          col={col}
                          value={row.data?.[col.name]}
                          editing={!selecting && editingCell?.rowId === row.id && editingCell?.colId === col.id}
                          selecting={selecting}
                          timeZone={timeZone}
                          onStartEdit={() => setEditingCell({ rowId: row.id, colId: col.id })}
                          onCommit={(next) => saveCell(row, col, next)}
                          onCancel={stopEditing}
                          tryCellAction={tryCellAction}
                        />
                      ))}
                    </div>
                  );
                })}

                <div ref={sentinelRef} className="h-px w-full" />
                <RenderIf condition={loadingMore}>
                  <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
                </RenderIf>
              </div>
            }
          >
            <div className="flex h-full min-h-60 flex-col items-center justify-center px-8 py-16">
              <span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Icon name="document" size={24} />
              </span>
              <p className="m-0 text-sm font-medium text-foreground">No properties yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Ask your agent to add columns with <code className="font-mono text-[12px]">datatable_add_column</code>.</p>
            </div>
          </RenderIf>
        </div>

        <RenderIf condition={showStatusBar}>
          <div className="absolute inset-x-0 bottom-0 z-10 flex h-8 items-center justify-between gap-3 border-t border-border-subtle bg-card px-3">
            {selectedCount > 0 ? (
              <Button type="text" size="small" danger icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>
                Delete {selectedCount}
              </Button>
            ) : (
              <>
                <Button type="text" size="small" disabled={loading || columns.length === 0} icon={<Plus size={14} />} onClick={handleAddClick} className="text-muted-foreground">
                  Add new row
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {loadedCount === 0 && total === 0 ? "0 rows" : loadedCount >= total ? `${total.toLocaleString()} ${total === 1 ? "row" : "rows"}` : `${loadedCount.toLocaleString()} of ${total.toLocaleString()} rows`}
                  {loadingMore ? " · Loading…" : null}
                </span>
              </>
            )}
          </div>
        </RenderIf>

        <Modal
          open={confirmDelete}
          title={selectedCount === 1 ? "Delete row?" : `Delete ${selectedCount} rows?`}
          okText="Delete"
          okButtonProps={{ danger: true, loading: deleting }}
          onCancel={() => {
            if (!deleting) setConfirmDelete(false);
          }}
          onOk={() => void deleteSelected()}
        >
          <p className="m-0 text-sm text-muted-foreground">{selectedCount === 1 ? "This row will be permanently deleted." : "These rows will be permanently deleted."}</p>
        </Modal>
      </div>
    </NewDatatableProvider>
  );
}
