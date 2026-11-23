import { Button, DatePicker, Dropdown, EditableInput, InputNumber, message } from "devnonla-ui";
import type { MenuProps } from "devnonla-ui";
import { useEffect, useRef, useState } from "react";
import { cn } from "src/common/lib/cn";
import type { DatatableColumn } from "src/common/types";
import { DATETIME_PICKER_FORMAT, fromPickerDate, toPickerDate } from "src/common/utils/date";
import { cellValuesEqual, draftToValue, parseNumberValue, valueToDraft } from "../common/cellValueUtils";
import { formatCellValue } from "../common/columnUtils";
import { SelectPill } from "./SelectPill";

export function EditableCell({
  col,
  value,
  editing,
  selecting,
  timeZone,
  onStartEdit,
  onCommit,
  onCancel,
  tryCellAction,
}: {
  col: DatatableColumn;
  value: unknown;
  editing: boolean;
  selecting?: boolean;
  timeZone: string;
  onStartEdit: () => void;
  onCommit: (next: unknown) => void | Promise<void>;
  onCancel: () => void;
  tryCellAction: () => boolean;
}) {
  const [selectOpen, setSelectOpen] = useState(false);
  const committedRef = useRef(false);
  const numberDraft = useRef<number | null>(null);
  const numberInit = useRef<string | null>(null);

  if (!editing) numberInit.current = null;
  if (editing && col.type === "number" && numberInit.current !== col.id) {
    numberInit.current = col.id;
    numberDraft.current = parseNumberValue(value);
  }

  useEffect(() => {
    if (!editing || (col.type !== "datetime" && col.type !== "number")) return;
    committedRef.current = false;
  }, [editing, col.type, col.id]);

  if (selecting) {
    return (
      <div className={cn("flex h-9 min-w-0 items-center border-r border-border-secondary px-2 text-sm", col.type === "boolean" && "justify-center")}>
        <span className={cn("min-w-0", col.type === "datetime" ? "whitespace-nowrap" : "truncate", col.type === "number" && "flex-1")}>{formatCellValue(col, value, timeZone)}</span>
      </div>
    );
  }

  const finish = (next: unknown) => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (cellValuesEqual(value, next)) {
      onCancel();
      return;
    }
    onCommit(next);
  };

  if (col.type === "boolean") {
    return (
      <button
        type="button"
        className="flex h-9 w-full min-w-0 cursor-pointer items-center justify-center border-0 border-r border-border-secondary bg-transparent px-2.5 transition-colors hover:bg-muted/40"
        onClick={() => {
          if (!tryCellAction()) return;
          onCommit(!value);
        }}
      >
        <span className="inline-flex items-center justify-center leading-none">{formatCellValue(col, value, timeZone)}</span>
      </button>
    );
  }

  if (col.type === "select") {
    const items: MenuProps["items"] = [
      ...(col.options ?? []).map((opt) => ({
        key: opt,
        label: <SelectPill value={opt} />,
        onClick: () => onCommit(opt),
      })),
      ...(col.options?.length ? [{ type: "divider" as const }] : []),
      {
        key: "__clear",
        label: <span className="text-muted-foreground">Clear</span>,
        onClick: () => onCommit(null),
      },
    ];
    return (
      <Dropdown
        menu={{ items }}
        trigger={["click"]}
        open={selectOpen}
        placement="bottomLeft"
        destroyOnHidden
        classNames={{ root: "dt-select-dropdown" }}
        onOpenChange={(open) => {
          if (open && !tryCellAction()) return;
          setSelectOpen(open);
        }}
      >
        <button type="button" className="flex h-9 w-full min-w-0 cursor-pointer items-center border-0 border-r border-border-secondary bg-transparent px-2 text-left text-sm transition-colors hover:bg-muted/40">
          <span className="inline-flex max-w-full min-w-0">{formatCellValue(col, value, timeZone)}</span>
        </button>
      </Dropdown>
    );
  }

  if (col.type === "datetime" && editing) {
    return (
      <div className="relative z-30 flex h-9 min-w-0 items-center border-r border-border-secondary">
        <DatePicker
          showTime
          allowClear={false}
          autoFocus
          open
          needConfirm
          value={toPickerDate(typeof value === "string" ? value : null, timeZone)}
          format={DATETIME_PICKER_FORMAT}
          className="absolute left-0 top-0 z-30 h-9! w-[calc(100%+20px)] min-w-[calc(100%+20px)] rounded-md! border-transparent! bg-muted! shadow-panel!"
          renderExtraFooter={() =>
            value == null || value === "" ? null : (
              <Button
                type="text"
                size="small"
                block
                className="text-muted-foreground hover:text-foreground"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={() => finish(null)}
              >
                Clear
              </Button>
            )
          }
          onChange={(d) => finish(fromPickerDate(d, timeZone))}
          onOpenChange={(open) => {
            if (!open && !committedRef.current) {
              committedRef.current = true;
              onCancel();
            }
          }}
        />
      </div>
    );
  }

  if (col.type === "number" && editing) {
    return (
      <div className="flex h-9 min-w-0 items-center border-r border-border-secondary px-1">
        <InputNumber
          autoFocus
          size="small"
          defaultValue={parseNumberValue(value) ?? undefined}
          parser={(raw) => parseNumberValue(raw) ?? Number.NaN}
          className="w-full"
          onChange={(next) => {
            numberDraft.current = next;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              committedRef.current = true;
              onCancel();
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              finish(numberDraft.current);
            }
          }}
          onBlur={() => finish(numberDraft.current)}
        />
      </div>
    );
  }

  if (col.type === "text" || col.type === "json") {
    return (
      <div
        className="flex h-9 min-w-0 cursor-pointer items-center border-r border-border-secondary px-2 transition-colors hover:bg-muted/40"
        onClick={() => {
          if (editing || !tryCellAction()) return;
          onStartEdit();
        }}
      >
        <EditableInput
          display={formatCellValue(col, value, timeZone)}
          editing={editing}
          onStartEdit={() => {
            if (!tryCellAction()) return;
            onStartEdit();
          }}
          onCancelEdit={onCancel}
          initialValue={valueToDraft(col, value)}
          placeholder={col.name}
          type="textarea"
          editLabel={`Edit ${col.name}`}
          minWidth={320}
          allowEmpty
          onSave={async (draft) => {
            if (col.type === "json" && draft.trim()) {
              try {
                JSON.parse(draft);
              } catch {
                message.error("Invalid JSON");
                throw new Error("Invalid JSON");
              }
            }
            const next = draftToValue(col, draft);
            if (cellValuesEqual(value, next)) return;
            await onCommit(next);
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex h-9 w-full min-w-0 cursor-pointer items-center border-0 border-r border-border-secondary bg-transparent px-2 text-left text-sm transition-colors hover:bg-muted/40"
      onClick={() => {
        if (!tryCellAction()) return;
        onStartEdit();
      }}
    >
      <span className={cn("min-w-0", col.type === "datetime" ? "whitespace-nowrap" : "truncate", col.type === "number" && "flex-1")}>{formatCellValue(col, value, timeZone)}</span>
    </button>
  );
}
