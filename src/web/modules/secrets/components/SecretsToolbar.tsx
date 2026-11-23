import { Button, Popconfirm, SearchInput, Icon } from "devnonla-ui";

interface SecretsToolbarProps {
  search: string;
  onSearchChange: (q: string) => void;
  onAddClick: () => void;
  selectedCount: number;
  onDeleteSelected: () => void | Promise<void>;
}

export function SecretsToolbar({ search, onSearchChange, onAddClick, selectedCount, onDeleteSelected }: SecretsToolbarProps) {
  return (
    <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
      <SearchInput defaultValue={search} onChange={onSearchChange} placeholder="Search keys..." className="w-64 max-w-full" />
      <div className="ml-auto flex items-center gap-2">
      {selectedCount > 0 ? (
        <Popconfirm title={selectedCount === 1 ? "Delete 1 secret?" : `Delete ${selectedCount} secrets?`} description="This cannot be undone. Tools using these secrets will no longer receive a value." okText="Delete" okType="danger" onConfirm={onDeleteSelected} styles={{ root: { width: 280 } }}>
          <Button danger icon={<Icon name="trash" size={14} />}>
            Delete ({selectedCount})
          </Button>
        </Popconfirm>
      ) : null}
      <Button type="primary" icon={<Icon name="add" size={14} />} onClick={onAddClick}>
        Add secret
      </Button>
      </div>
    </div>
  );
}
