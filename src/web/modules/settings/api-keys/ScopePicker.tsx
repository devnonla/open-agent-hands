import { Card, Checkbox, Empty, SearchInput, Switch } from "devnonla-ui";
import { type ReactNode, useMemo, useState } from "react";

function toggleIds(current: string[], ids: string[], checked: boolean): string[] {
  const next = new Set(current);
  for (const id of ids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return [...next];
}

export function ScopePicker<T>({
  unrestricted,
  onUnrestrictedChange,
  items,
  selectedIds,
  onChange,
  getId,
  getLabel,
  searchPlaceholder,
  emptyText,
  unrestrictedHint,
  renderItem,
}: {
  unrestricted: boolean;
  onUnrestrictedChange: (value: boolean) => void;
  items: T[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  searchPlaceholder: string;
  emptyText: string;
  unrestrictedHint: string;
  renderItem?: (item: T) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => getLabel(item).toLowerCase().includes(q));
  }, [items, query, getLabel]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleIds = visible.map(getId);
  const checkedCount = visibleIds.filter((id) => selected.has(id)).length;
  const allChecked = visibleIds.length > 0 && checkedCount === visibleIds.length;
  const someChecked = checkedCount > 0 && !allChecked;

  return (
    <Card>
      <Card.Item label="Unrestricted" description="No limit — including items created later" className="px-3 py-2">
        <Switch size="small" checked={unrestricted} onChange={onUnrestrictedChange} />
      </Card.Item>
      {unrestricted ? (
        <Card.Item className="block px-3 py-3">
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">{unrestrictedHint}</p>
        </Card.Item>
      ) : (
        <>
          <Card.Item className="gap-2 p-2">
            <SearchInput defaultValue={query} onChange={setQuery} wait={0} placeholder={searchPlaceholder} />
            <span className="shrink-0 text-2xs tabular-nums text-tertiary-foreground">{selectedIds.length} selected</span>
          </Card.Item>
          <Card.Item className="block max-h-55 overflow-y-auto px-0 py-1">
            {visible.length === 0 ? (
              <Empty bordered={false} icon={null} className="py-8" description={items.length === 0 ? emptyText : "No matches"} />
            ) : (
              <>
                <div className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/40" onClick={() => onChange(toggleIds(selectedIds, visibleIds, !allChecked))}>
                  <Checkbox checked={allChecked} indeterminate={someChecked} onClick={(e) => e.stopPropagation()} onChange={(checked) => onChange(toggleIds(selectedIds, visibleIds, checked))} />
                  <span className="text-xs text-muted-foreground">Select all</span>
                </div>
                {visible.map((item) => {
                  const id = getId(item);
                  const checked = selected.has(id);
                  return (
                    <div key={id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-muted/40" onClick={() => onChange(toggleIds(selectedIds, [id], !checked))}>
                      <Checkbox checked={checked} onClick={(e) => e.stopPropagation()} onChange={(checked) => onChange(toggleIds(selectedIds, [id], checked))} />
                      {renderItem ? renderItem(item) : <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{getLabel(item)}</span>}
                    </div>
                  );
                })}
              </>
            )}
          </Card.Item>
        </>
      )}
    </Card>
  );
}
