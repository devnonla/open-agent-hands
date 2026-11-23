import { Settings } from "lucide-react";
import { Button, EditableInput, Empty, Icon, Modal, Popconfirm, SearchInput, Table, Tabs, Tooltip, message } from "devnonla-ui";
import type { ColumnsType } from "devnonla-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "src/common/lib/cn";
import type { KvProject, KvStoreEntry } from "src/common/types";
import { PageHeader } from "src/components/PageHeader";
import { PageShell } from "src/components/PageShell";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { DEFAULT_PROJECT, deleteKvProject, fetchKvProjects } from "./common/kvProjectsSlice";
import { createKvEntry, deleteKvEntry, fetchKvStore, updateKvEntry, updateKvStoreFilter } from "./common/kvStoreSlice";
import { KvProjectDialog } from "./components/KvProjectDialog";
import { NewKvActions, NewKvKeyCell, NewKvProvider, type NewKvRowHandle, NewKvValueCell } from "./components/NewKvRow";

const PAGE_SIZE = 50;
const NEW_ROW_ID = "__new__";

type KvTableRow = KvStoreEntry | { id: typeof NEW_ROW_ID };

function isNewRow(row: KvTableRow): row is { id: typeof NEW_ROW_ID } {
  return row.id === NEW_ROW_ID;
}

function TabLabel({ name, active, menu }: { name: string; active: boolean; menu?: ReactNode }) {
  return (
    <span className={cn("inline-flex h-full items-center gap-1 transition-colors", active ? "text-foreground" : "text-muted-foreground")}>
      {name}
      {menu}
    </span>
  );
}

function ProjectSettingsButton({ project, active, onOpen }: { project: KvProject; active: boolean; onOpen: () => void }) {
  return (
    <span
      role="button"
      tabIndex={active ? 0 : -1}
      aria-hidden={!active}
      aria-label={`Settings for ${project.name}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      className={cn("-mr-1 inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-ink-hover hover:text-foreground", !active && "invisible")}
    >
      <Settings size={14} />
    </span>
  );
}

export default function KvStorePage() {
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.kvStore.items) as KvStoreEntry[];
  const total = useAppSelector((s) => s.kvStore.total);
  const page = useAppSelector((s) => s.kvStore.filter.page) ?? 1;
  const filterSearch = useAppSelector((s) => s.kvStore.filter.search) ?? "";
  const [adding, setAdding] = useState(false);
  const newRowRef = useRef<NewKvRowHandle>(null);
  const [editing, setEditing] = useState<{ id: string; field: "key" | "value" } | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const tableHostRef = useRef<HTMLDivElement>(null);
  const [scrollY, setScrollY] = useState(400);

  const projects = useAppSelector((s) => s.kvProjects.items) as KvProject[];
  const projectsLoaded = useAppSelector((s) => s.kvProjects.loaded);
  const [searchParams, setSearchParams] = useSearchParams();
  const [editingProject, setEditingProject] = useState<KvProject | null>(null);

  const hasSearch = filterSearch.length > 0;
  const requested = searchParams.get("project")?.trim() || DEFAULT_PROJECT;
  const activeProject = projects.find((p) => p.name === requested) ?? null;
  const activeFilter = activeProject?.id ?? null;

  const selectProject = (name: string) => {
    setSelectedRowKeys([]);
    setAdding(false);
    setSearchParams(name === DEFAULT_PROJECT ? {} : { project: name }, { replace: true });
  };

  useEffect(() => {
    dispatch(fetchKvProjects());
  }, [dispatch]);

  useEffect(() => {
    if (projectsLoaded && requested !== DEFAULT_PROJECT && !activeProject) setSearchParams({}, { replace: true });
  }, [projectsLoaded, requested, activeProject, setSearchParams]);

  useEffect(() => {
    if (!activeFilter) return;
    dispatch(updateKvStoreFilter({ project: activeFilter, page: 1 }));
    dispatch(fetchKvStore({ project: activeFilter, page: 1 }));
  }, [dispatch, activeFilter]);

  const confirmDeleteProject = (project: KvProject) => {
    Modal.confirm({
      title: `Delete project ${project.name}?`,
      content: `Its ${project.keyCount} ${project.keyCount === 1 ? "key is" : "keys are"} deleted too. Code calling agenthands.kv.project("${project.name}") gets null. This cannot be undone.`,
      okText: "Delete project",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await dispatch(deleteKvProject(project.id)).unwrap();
          message.success(`Deleted ${project.name}`);
          selectProject(DEFAULT_PROJECT);
        } catch (err) {
          message.error(err instanceof Error ? err.message : "Failed to delete the project");
        }
      },
    });
  };

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
    if (page > maxPage) {
      dispatch(updateKvStoreFilter({ page: maxPage }));
      dispatch(fetchKvStore({ page: maxPage }));
    }
  }, [dispatch, total, page]);

  useEffect(() => {
    const host = tableHostRef.current;
    if (!host) return;

    const measure = () => {
      const pager = host.querySelector("[data-slot=pagination]")?.parentElement;
      const pagerH = pager instanceof HTMLElement ? pager.offsetHeight + Number.parseFloat(getComputedStyle(pager).marginTop || "0") : 0;
      setScrollY(Math.max(120, host.clientHeight - pagerH));
    };

    const ro = new ResizeObserver(measure);
    ro.observe(host);
    measure();
    return () => ro.disconnect();
  }, [total, page]);

  const handleSearch = (q: string) => {
    if (q === filterSearch) return;
    dispatch(updateKvStoreFilter({ search: q || undefined, page: 1 }));
    dispatch(fetchKvStore({ page: 1, search: q || undefined }));
  };

  const handleClearSearch = () => {
    dispatch(updateKvStoreFilter({ search: undefined, page: 1 }));
    dispatch(fetchKvStore({ page: 1, search: undefined }));
  };

  const handlePageChange = (nextPage: number) => {
    dispatch(updateKvStoreFilter({ page: nextPage }));
    dispatch(fetchKvStore({ page: nextPage }));
  };

  const handleUpdate = async (id: string, patch: { key?: string; value?: string }) => {
    try {
      await dispatch(updateKvEntry({ id, ...patch })).unwrap();
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const handleCreate = async (payload: { key: string; value: string }) => {
    try {
      await dispatch(createKvEntry({ ...payload, project: activeProject?.id })).unwrap();
      void dispatch(fetchKvProjects());
      message.success(`Created ${payload.key}`);
      setAdding(false);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const handleAddClick = () => {
    if (adding) {
      newRowRef.current?.focusKey();
      return;
    }
    setAdding(true);
  };

  const handleDeleteSelected = async () => {
    const ids = selectedRowKeys;
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => dispatch(deleteKvEntry(id)).unwrap()));
    const failed = results.filter((r) => r.status === "rejected").length;
    setSelectedRowKeys([]);
    if (failed === 0) message.success(ids.length === 1 ? "Deleted" : `Deleted ${ids.length}`);
    else message.error(failed === ids.length ? "Delete failed" : `Deleted ${ids.length - failed}, ${failed} failed`);
    await dispatch(fetchKvStore());
    void dispatch(fetchKvProjects());
  };

  const columns: ColumnsType<KvTableRow> = [
    {
      title: "Key",
      dataIndex: "key",
      key: "key",
      flex: 1,
      render: (_, row) => {
        if (isNewRow(row)) return <NewKvKeyCell />;
        return (
          <div className="[&_code]:font-sans [&_code]:font-medium [&_code]:tracking-normal">
            <EditableInput.Key size="small" value={row.key} editing={editing?.id === row.id && editing.field === "key"} onStartEdit={() => setEditing({ id: row.id, field: "key" })} onCancelEdit={() => setEditing(null)} placeholder="BASE_URL" onSave={(key) => handleUpdate(row.id, { key })} />
          </div>
        );
      },
    },
    {
      title: "Value",
      dataIndex: "value",
      key: "value",
      flex: 2,
      render: (v: string, row) => {
        if (isNewRow(row)) return <NewKvValueCell />;
        return (
          <EditableInput
            display={
              <Tooltip title={v.length > 80 ? v : undefined}>
                <span className="block truncate font-mono text-xs text-muted-foreground">{v}</span>
              </Tooltip>
            }
            editing={editing?.id === row.id && editing.field === "value"}
            onStartEdit={() => setEditing({ id: row.id, field: "value" })}
            onCancelEdit={() => setEditing(null)}
            initialValue={v}
            placeholder="Value"
            type="textarea"
            minWidth={320}
            onSave={(value) => handleUpdate(row.id, { value })}
          />
        );
      },
    },
  ];

  if (adding) {
    columns.push({
      title: "",
      key: "actions",
      align: "right",
      render: (_, row) => (isNewRow(row) ? <NewKvActions /> : null),
    });
  }

  const dataSource: KvTableRow[] = adding ? [{ id: NEW_ROW_ID }, ...items] : items;

  return (
    <PageShell
      className="box-border h-full min-h-0 overflow-hidden"
      header={
        <PageHeader
          title="KV Store"
          icon="kv-store"
          className="mb-0 pb-0"
          bordered={false}
        />
      }
      tabs={
        <Tabs
          aria-label="KV projects"
          className="min-w-0"
          activeKey={activeProject?.name ?? DEFAULT_PROJECT}
          onChange={selectProject}
          items={projects.map((project) => ({
            key: project.name,
            label: <TabLabel name={project.name === DEFAULT_PROJECT ? "Default" : project.name} active={project.id === activeProject?.id} menu={project.name !== DEFAULT_PROJECT ? <ProjectSettingsButton project={project} active={project.id === activeProject?.id} onOpen={() => setEditingProject(project)} /> : null} />,
          }))}
        />
      }
    >
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
        <SearchInput defaultValue={filterSearch} onChange={handleSearch} placeholder="Search keys..." className="w-64 max-w-full" />
        {activeProject?.description ? <span className="min-w-0 truncate text-sm text-muted-foreground">{activeProject.description}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {selectedRowKeys.length > 0 ? (
            <Popconfirm title={selectedRowKeys.length === 1 ? "Delete 1 entry?" : `Delete ${selectedRowKeys.length} entries?`} description="Tools using these keys will get null from agenthands.kv.get." okText="Delete" okType="danger" onConfirm={handleDeleteSelected} styles={{ root: { width: 280 } }}>
              <Button danger icon={<Icon name="trash" size={14} />}>
                Delete ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ) : null}
          <Button type="primary" icon={<Icon name="add" size={14} />} onClick={handleAddClick}>
            Add entry
          </Button>
        </div>
      </div>

      <NewKvProvider onCreate={handleCreate} onCancel={() => setAdding(false)} active={adding} handleRef={newRowRef}>
        <div ref={tableHostRef} className="min-h-0 flex-1 overflow-hidden">
          <Table
            className="rounded-xl bg-card [&_th]:bg-card!"
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={dataSource}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              hideOnSinglePage: true,
              showSizeChanger: false,
              showTotal: (count, [from, to]) => `${from}–${to} of ${count}`,
              onChange: handlePageChange,
            }}
            scroll={{ y: scrollY }}
            rowSelection={{
              type: "checkbox",
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys.map(String)),
              getCheckboxProps: (row) => ({ disabled: isNewRow(row) }),
            }}
            onRow={(row) => ({ className: cn(isNewRow(row) && "bg-muted/30") })}
            locale={{
              emptyText: hasSearch ? (
                <Empty
                  bordered={false}
                  icon={null}
                  className="py-8"
                  description={
                    <>
                      No entries match &ldquo;<span className="font-medium text-foreground">{filterSearch}</span>&rdquo;
                    </>
                  }
                  action={
                    <Button type="link" size="small" onClick={handleClearSearch}>
                      Clear search filter
                    </Button>
                  }
                />
              ) : (
                <Empty bordered={false} icon={null} className="py-8" description={`No keys in ${activeProject && activeProject.name !== DEFAULT_PROJECT ? activeProject.name : "Default"} yet. Click Add entry, or have code call agenthands.kv.project("${activeProject?.name ?? DEFAULT_PROJECT}").set(KEY, value).`} />
              ),
            }}
          />
        </div>
      </NewKvProvider>

      <KvProjectDialog project={editingProject} onClose={() => setEditingProject(null)} onSaved={(project) => selectProject(project.name)} onDelete={confirmDeleteProject} />
    </PageShell>
  );
}
