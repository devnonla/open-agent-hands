import { Button, Card, Empty, Icon, Popconfirm, Table, Tag, message } from "devnonla-ui";
import type { ColumnsType } from "devnonla-ui";
import { useCallback, useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import type { ApiKey, DatatableProject, KvProject, KvStoreEntry } from "src/common/types";
import RenderIf from "src/components/RenderIf";
import { useNavigate } from "react-router-dom";
import { ApiKeyFormDialog } from "./ApiKeyFormDialog";

function scopeLabel(unrestricted: boolean, count: number, singular: string, plural: string): string | null {
  if (unrestricted) return `All ${plural}`;
  if (count <= 0) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

function AccessTags({ row }: { row: ApiKey }) {
  const tags = [scopeLabel(row.datatablesUnrestricted, (row.datatableProjectIds ?? []).length, "datatable", "datatables"), scopeLabel(row.kvUnrestricted, (row.kvEntryIds ?? []).length, "KV key", "KV keys")].filter((label): label is string => !!label);

  if (tags.length === 0) return <span className="text-xs text-muted-foreground">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((label) => (
        <Tag key={label}>{label}</Tag>
      ))}
    </div>
  );
}

export function ApiKeysCard() {
  const navigate = useNavigate();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [datatableProjects, setDatatableProjects] = useState<DatatableProject[]>([]);
  const [kvEntries, setKvEntries] = useState<KvStoreEntry[]>([]);
  const [kvProjectNames, setKvProjectNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editKey, setEditKey] = useState<ApiKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [keyResult, projectResult, kvResult, kvProjectResult] = await Promise.all([
        apiClient.get<{ items: ApiKey[] }>("/api/api-keys"),
        apiClient.get<DatatableProject[]>("/api/datatables/projects"),
        apiClient.get<{ items: KvStoreEntry[] }>("/api/kvstore", { sorts: "key" }),
        apiClient.get<{ items: KvProject[] }>("/api/kvstore/projects"),
      ]);
      setKeys(keyResult.items);
      setDatatableProjects(projectResult);
      setKvEntries(kvResult.items);
      setKvProjectNames(Object.fromEntries(kvProjectResult.items.map((p) => [p.id, p.name === "default" ? "Default" : p.name])));
    } catch {
      message.error("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreated = (key: ApiKey) => {
    setShowCreate(false);
    navigate(`/connect/api/${key.id}`, { state: { secret: key.key } });
  };

  const handleUpdated = (key: ApiKey) => {
    setKeys((prev) => prev.map((item) => (item.id === key.id ? { ...item, ...key, key: undefined } : item)));
    setEditKey(null);
    message.success("Updated");
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/api/api-keys/${id}`);
      setKeys((prev) => prev.filter((item) => item.id !== id));
      message.success("Deleted");
    } catch {
      message.error("Failed to delete");
    }
  };

  const columns: ColumnsType<ApiKey> = [
    {
      title: "Name",
      key: "name",
      render: (_, row) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{row.name}</div>
          <div className="truncate font-mono text-2xs text-tertiary-foreground">{row.keyPrefix}…</div>
        </div>
      ),
    },
    {
      title: "Permissions",
      key: "access",
      render: (_, row) => <AccessTags row={row} />,
    },
    {
      title: "",
      key: "actions",
      width: 84,
      align: "right",
      render: (_, row) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button type="icon" size="small" icon={<Icon name="pen" />} onClick={() => setEditKey(row)} aria-label={`Edit ${row.name}`} />
          <Popconfirm title="Delete this key?" okText="Delete" okType="danger" onConfirm={() => void handleDelete(row.id)}>
            <Button type="icon" size="small" icon={<Icon name="trash" />} aria-label={`Delete ${row.name}`} />
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="text-sm leading-5 font-medium text-foreground">
            API keys <span className="tabular-nums text-xs font-normal text-tertiary-foreground">{keys.length}</span>
          </span>
          <Button type="primary" size="small" icon={<Icon name="add" size={12} />} onClick={() => setShowCreate(true)}>
            New API key
          </Button>
        </div>
        <Card caption="Each key reaches only the datatables and KV keys you pick. Open a key for its prompt.">
          <Table
            className="rounded-xl [&_th]:bg-card!"
            rowKey="id"
            columns={columns}
            dataSource={keys}
            loading={loading}
            pagination={false}
            rowClassName="cursor-pointer"
            onRow={(row) => ({ onClick: () => navigate(`/connect/api/${row.id}`) })}
            locale={{
              emptyText: <Empty bordered={false} icon="shield-check" title="No API keys yet" description="Create a key to call the HTTP API." className="py-8" />,
            }}
          />
        </Card>
      </section>

      <RenderIf condition={showCreate}>
        <ApiKeyFormDialog datatableProjects={datatableProjects} kvEntries={kvEntries} kvProjectNames={kvProjectNames} onClose={() => setShowCreate(false)} onCreated={handleCreated} onUpdated={handleUpdated} />
      </RenderIf>
      <RenderIf condition={!!editKey}>
        <ApiKeyFormDialog edit={editKey} datatableProjects={datatableProjects} kvEntries={kvEntries} kvProjectNames={kvProjectNames} onClose={() => setEditKey(null)} onCreated={handleCreated} onUpdated={handleUpdated} />
      </RenderIf>
    </>
  );
}
