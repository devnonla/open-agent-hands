import { Button, DatePicker, Dropdown, Input, InputNumber, Tooltip, Icon } from "devnonla-ui";
import type { MenuProps } from "devnonla-ui";
import { type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject, createContext, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { DatatableColumn } from "src/common/types";
import { DATETIME_PICKER_FORMAT, fromPickerDate, toPickerDate } from "src/common/utils/date";
import { parseNumberValue } from "../common/cellValueUtils";
import { formatCellValue } from "../common/columnUtils";
import { SelectPill } from "./SelectPill";

export interface NewDatatableRowHandle {
  focusFirst: () => void;
}

interface NewDatatableRowProps {
  columns: DatatableColumn[];
  timeZone: string;
  onCreate: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  active: boolean;
  handleRef: RefObject<NewDatatableRowHandle | null>;
  children: ReactNode;
}

interface NewDatatableApi {
  columns: DatatableColumn[];
  timeZone: string;
  data: Record<string, unknown>;
  setField: (name: string, value: unknown) => void;
  submitting: boolean;
  canSubmit: boolean;
  rowRef: RefObject<HTMLDivElement | null>;
  onTextKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  submit: () => void;
  cancel: () => void;
}

const NewDatatableContext = createContext<NewDatatableApi | null>(null);

function useNewDatatable() {
  const api = useContext(NewDatatableContext);
  if (!api) throw new Error("New datatable cells must render inside NewDatatableProvider");
  return api;
}

function initialDraft(columns: DatatableColumn[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const col of columns) {
    if (col.type === "boolean") data[col.name] = false;
  }
  return data;
}

function isRequiredFilled(col: DatatableColumn, data: Record<string, unknown>): boolean {
  if (!col.required) return true;
  const v = data[col.name];
  if (v === undefined || v === null) return false;
  switch (col.type) {
    case "text":
    case "select":
      return typeof v === "string" && v.trim().length > 0;
    case "number":
      return typeof v === "number" && !Number.isNaN(v);
    case "boolean":
      return typeof v === "boolean";
    case "datetime":
      return typeof v === "string" && v.length > 0;
    case "json":
      return true;
    default:
      return true;
  }
}

export function NewDatatableProvider({ columns, timeZone, onCreate, onCancel, active, handleRef, children }: NewDatatableRowProps) {
  const [data, setData] = useState<Record<string, unknown>>(() => initialDraft(columns));
  const [submitting, setSubmitting] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const columnsKey = columns.map((c) => `${c.id}:${c.type}:${c.required ? 1 : 0}`).join(",");

  const focusFirst = () => {
    const root = rowRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>("input:not([type=hidden]), textarea") ?? root.querySelector<HTMLElement>("button");
    el?.focus();
    root.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  useImperativeHandle(handleRef, () => ({ focusFirst }));

  useEffect(() => {
    if (!active) return;
    setData(initialDraft(columns));
    setSubmitting(false);
    // Double rAF: wait until the draft row is painted and the Add button has released focus.
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) focusFirst();
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
    // columnsKey tracks schema identity for draft reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, columnsKey]);

  const canSubmit = useMemo(() => !submitting && columns.every((col) => isRequiredFilled(col, data)), [columns, data, submitting]);

  const setField = (name: string, value: unknown) => {
    setData((prev) => ({ ...prev, [name]: value }));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onCreate(data);
    } finally {
      setSubmitting(false);
    }
  };

  const onTextKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <NewDatatableContext.Provider
      value={{
        columns,
        timeZone,
        data,
        setField,
        submitting,
        canSubmit,
        rowRef,
        onTextKeyDown,
        submit: () => void submit(),
        cancel: onCancel,
      }}
    >
      {children}
    </NewDatatableContext.Provider>
  );
}

/** Wrap the draft grid row so focusFirst / Esc can target it. */
export function NewDatatableRowShell({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  const { rowRef, cancel, submitting } = useNewDatatable();
  return (
    <div
      ref={rowRef}
      className={className}
      style={style}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !submitting) {
          e.preventDefault();
          cancel();
        }
      }}
    >
      {children}
    </div>
  );
}

export function NewDatatableCell({ col }: { col: DatatableColumn }) {
  const { data, setField, submitting, timeZone, onTextKeyDown, submit, cancel } = useNewDatatable();
  const value = data[col.name];

  if (col.type === "boolean") {
    return (
      <button type="button" disabled={submitting} className="flex h-9 w-full min-w-0 cursor-pointer items-center justify-center border-0 border-r border-border-secondary bg-transparent px-2.5" onClick={() => setField(col.name, !value)}>
        <span className="inline-flex items-center justify-center leading-none">{formatCellValue(col, value, timeZone)}</span>
      </button>
    );
  }

  if (col.type === "select") {
    const items: MenuProps["items"] = [
      ...(col.options ?? []).map((opt) => ({
        key: opt,
        label: <SelectPill value={opt} />,
        onClick: () => setField(col.name, opt),
      })),
      ...(col.options?.length ? [{ type: "divider" as const }] : []),
      {
        key: "__clear",
        label: <span className="text-muted-foreground">Clear</span>,
        onClick: () => setField(col.name, null),
      },
    ];
    return (
      <Dropdown menu={{ items }} trigger={["click"]} placement="bottomLeft" destroyOnHidden classNames={{ root: "dt-select-dropdown" }}>
        <button type="button" disabled={submitting} className="flex h-9 w-full min-w-0 cursor-pointer items-center border-0 border-r border-border-secondary bg-transparent px-2 text-left text-sm">
          <span className="inline-flex max-w-full min-w-0">{formatCellValue(col, value, timeZone)}</span>
        </button>
      </Dropdown>
    );
  }

  if (col.type === "datetime") {
    return (
      <div className="flex h-9 min-w-0 items-center border-r border-border-secondary px-1">
        <DatePicker
          showTime
          allowClear
          needConfirm
          disabled={submitting}
          value={toPickerDate(typeof value === "string" ? value : null, timeZone)}
          format={DATETIME_PICKER_FORMAT}
          className="h-7! w-full min-w-0 rounded! border-border/60! bg-background/80! text-xs!"
          onChange={(d) => setField(col.name, fromPickerDate(d, timeZone))}
        />
      </div>
    );
  }

  if (col.type === "number") {
    return (
      <div
        className="flex h-9 min-w-0 items-center border-r border-border-secondary px-1"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
      >
        <InputNumber size="small" disabled={submitting} value={parseNumberValue(value)} parser={(raw) => parseNumberValue(raw) ?? Number.NaN} className="w-full" onChange={(v) => setField(col.name, v)} />
      </div>
    );
  }

  if (col.type === "json") {
    const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    return (
      <div className="flex h-9 min-w-0 items-center border-r border-border-secondary px-1">
        <Input
          size="small"
          value={text}
          disabled={submitting}
          placeholder="{}"
          onChange={(e) => {
            const next = e.target.value;
            if (next.trim() === "") {
              setField(col.name, null);
              return;
            }
            try {
              setField(col.name, JSON.parse(next));
            } catch {
              setField(col.name, next);
            }
          }}
          onKeyDown={onTextKeyDown}
        />
      </div>
    );
  }

  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return (
    <div className="flex h-9 min-w-0 items-center border-r border-border-secondary px-1">
      <Input size="small" value={text} disabled={submitting} placeholder={col.name} onChange={(e) => setField(col.name, e.target.value)} onKeyDown={onTextKeyDown} />
    </div>
  );
}

export function NewDatatableActions() {
  const { canSubmit, submitting, submit, cancel } = useNewDatatable();
  return (
    <div className="flex h-9 items-center justify-end gap-1 px-1">
      <Tooltip title="Cancel (Esc)">
        <Button type="icon" size="small" onClick={cancel} disabled={submitting} aria-label="Cancel" className="text-muted-foreground hover:text-foreground" icon={<Icon name="close" />} />
      </Tooltip>
      <Tooltip title={canSubmit ? "Add row (Enter)" : "Fill required fields to add"}>
        <Button type="primary" size="small" onClick={submit} disabled={!canSubmit} loading={submitting} icon={submitting ? undefined : <Icon name="add" size={12} />}>
          Add
        </Button>
      </Tooltip>
    </div>
  );
}
