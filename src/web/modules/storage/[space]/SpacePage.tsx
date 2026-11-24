import { Button, Dropdown, Empty, Icon, type MenuProps, Modal, SearchInput, Skeleton, Switch, Table, TextArea, Tooltip, message } from "devnonla-ui";
import type { ColumnsType } from "devnonla-ui";
import { CloudUpload, Folder, Settings, Upload } from "lucide-react";
import { type ChangeEvent, type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiClient } from "src/common/api";
import { cn } from "src/common/lib/cn";
import type { StorageFile, StorageFolder, StorageSpace } from "src/common/types";
import { formatDateTime, relativeTime } from "src/common/utils/date";
import { type BreadcrumbItem, ContentBreadcrumb, ContentHeader } from "src/components/ContentBreadcrumb";
import { FeatureIcon } from "src/components/FeatureIcon";
import { PageHeader } from "src/components/PageHeader";
import { PageBand, PageShell } from "src/components/PageShell";
import { WindowHeaderBackButton } from "src/components/WindowHeaderBackButton";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { fileKind } from "../common/fileKind";
import { formatBytes } from "../common/format";
import { deleteStorageFile, deleteStorageSpace, fetchStorageSpaces, fetchStorageView, resetStoragePublicLink, updateStorageSpace, upsertStorageFileLocal } from "../common/storageSlice";
import { uploadWithProgress } from "../common/upload";
import { FileDrawer } from "../components/FileDrawer";
import { type UploadItem, UploadTray } from "../components/UploadTray";

const NAME_BUTTON = "inline-flex max-w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";

type BrowserRow = ({ kind: "folder"; id: string } & StorageFolder) | ({ kind: "file" } & StorageFile);
type SortKey = "name" | "size" | "updatedAt";
type Sort = { key: SortKey; order: "ascend" | "descend" };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizePrefix(value: string | null): string {
  const trimmed = (value ?? "").trim().replace(/^\/+/, "");
  return trimmed && !trimmed.endsWith("/") ? `${trimmed}/` : trimmed;
}

function lastSegment(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function rowName(row: BrowserRow): string {
  return lastSegment(row.kind === "folder" ? row.prefix : row.key);
}

function rowSize(row: BrowserRow): number {
  return row.kind === "folder" ? row.totalBytes : row.size;
}

function compareRows(a: BrowserRow, b: BrowserRow, sort: Sort): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  const dir = sort.order === "ascend" ? 1 : -1;
  const byName = rowName(a).localeCompare(rowName(b), undefined, { numeric: true, sensitivity: "base" });
  if (sort.key === "size") return (rowSize(a) - rowSize(b)) * dir || byName;
  if (sort.key === "updatedAt") return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * dir || byName;
  return byName * dir;
}

async function downloadFile(file: StorageFile) {
  try {
    const blob = await apiClient.getBlob(`/api/storage/files/${file.id}/download`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = lastSegment(file.key) || "file";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    message.error(errorText(err));
  }
}

function FileMenu({ file, onDelete }: { file: StorageFile; onDelete: (file: StorageFile) => Promise<void> }) {
  const name = lastSegment(file.key);
  const items: MenuProps["items"] = [
    ...(file.publicUrl
      ? [
          {
            key: "copy",
            label: (
              <div className="flex items-center gap-2">
                <Icon name="copy" size={14} />
                Copy public link
              </div>
            ),
            onClick: () => {
              void navigator.clipboard
                .writeText(file.publicUrl as string)
                .then(() => message.success("Public link copied"))
                .catch(() => message.error("Copy failed"));
            },
          },
        ]
      : []),
    {
      key: "download",
      label: (
        <div className="flex items-center gap-2">
          <Icon name="download" size={14} />
          Download
        </div>
      ),
      onClick: () => void downloadFile(file),
    },
    { type: "divider" as const },
    {
      key: "delete",
      danger: true,
      label: (
        <div className="flex items-center gap-2">
          <Icon name="trash" size={14} />
          Delete
        </div>
      ),
      onClick: () =>
        Modal.confirm({
          title: `Delete ${name}?`,
          content: "Code reading this key gets null. This cannot be undone.",
          okText: "Delete",
          okButtonProps: { danger: true },
          cancelText: "Cancel",
          onOk: () => onDelete(file),
        }),
    },
  ];

  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items, style: { minWidth: 180 } }}>
        <Button type="icon" size="small" aria-label={`Actions for ${name}`} icon={<Icon name="more" />} />
      </Dropdown>
    </span>
  );
}

function PublicSwitch({ space }: { space: StorageSpace }) {
  const dispatch = useAppDispatch();
  const [saving, setSaving] = useState(false);

  const setPublic = async (isPublic: boolean) => {
    setSaving(true);
    try {
      await dispatch(updateStorageSpace({ id: space.id, isPublic })).unwrap();
      message.success(isPublic ? `${space.name} is public` : `${space.name} is private`);
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tooltip title={space.isPublic ? "Each file has its own unguessable link. Turn off to stop every link." : "Turn on to give each file its own unguessable link."}>
      <label htmlFor="space-public-switch" className="inline-flex cursor-pointer items-center gap-2 py-1 text-sm text-muted-foreground">
        <Switch id="space-public-switch" size="small" checked={space.isPublic} disabled={saving} onChange={(checked: boolean) => void setPublic(checked)} aria-label="Public space" />
        {space.isPublic ? "Public" : "Private"}
      </label>
    </Tooltip>
  );
}

function SpaceSettings({ space, onDeleted }: { space: StorageSpace; onDeleted: () => void }) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState(space.description ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDescription(space.description ?? "");
  }, [open, space.description]);

  const save = async () => {
    if (description.trim() === (space.description ?? "")) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await dispatch(updateStorageSpace({ id: space.id, description: description.trim() || null })).unwrap();
      message.success("Space updated");
      setOpen(false);
    } catch (err) {
      message.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Modal.confirm({
      title: `Delete space ${space.name}?`,
      content: `Its ${space.fileCount} ${space.fileCount === 1 ? "file is" : "files are"} deleted too. Code calling agenthands.storage.space("${space.name}") gets null. This cannot be undone.`,
      okText: "Delete space",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await dispatch(deleteStorageSpace(space.id)).unwrap();
          message.success(`Deleted ${space.name}`);
          setOpen(false);
          onDeleted();
        } catch (err) {
          message.error(errorText(err));
        }
      },
    });
  };

  return (
    <>
      <Tooltip title="Space settings">
        <Button type="icon" size="small" aria-label="Space settings" icon={<Settings size={16} />} onClick={() => setOpen(true)} />
      </Tooltip>
      <Modal open={open} title="Space settings" onCancel={() => setOpen(false)} onOk={() => void save()} okText="Save" confirmLoading={saving} destroyOnHidden width={480}>
        <div className="flex flex-col gap-5 pt-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Description</span>
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this space holds" autoSize={{ minRows: 2, maxRows: 5 }} />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/30 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">Delete this space</div>
              <div className="text-xs text-muted-foreground">
                Its {space.fileCount} {space.fileCount === 1 ? "file is" : "files are"} deleted too. This cannot be undone.
              </div>
            </div>
            <Button danger size="small" icon={<Icon name="trash" size={14} />} onClick={confirmDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default function SpacePage() {
  const dispatch = useAppDispatch();
  const routerNavigate = useNavigate();
  const { space: spaceParam = "" } = useParams<{ space: string }>();
  const spaces = useAppSelector((s) => s.storage.spaces);
  const spacesLoaded = useAppSelector((s) => s.storage.spacesLoaded);
  const folders = useAppSelector((s) => s.storage.folders);
  const files = useAppSelector((s) => s.storage.files);
  const filesLoading = useAppSelector((s) => s.storage.filesLoading);
  const filesError = useAppSelector((s) => s.storage.filesError);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "name", order: "ascend" });
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [spacesError, setSpacesError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [tableWidth, setTableWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const tableHostRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setTableWidth(entry.contentRect.width));
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const activeSpace = spaces.find((s) => s.name === spaceParam) ?? null;
  const activeId = activeSpace?.id ?? null;
  const prefix = normalizePrefix(searchParams.get("prefix"));
  const openFile = files.find((file) => file.id === openId) ?? null;
  const uploading = uploads.some((item) => item.status === "uploading");

  useEffect(() => {
    dispatch(fetchStorageSpaces())
      .unwrap()
      .catch((err) => setSpacesError(errorText(err)));
  }, [dispatch]);

  useEffect(() => {
    if (activeId) void dispatch(fetchStorageView({ spaceId: activeId, prefix }));
  }, [dispatch, activeId, prefix]);

  useEffect(() => {
    if (uploads.length === 0 || uploads.some((item) => item.status !== "done")) return;
    const timer = setTimeout(() => setUploads([]), 4000);
    return () => clearTimeout(timer);
  }, [uploads]);

  const openFolder = (nextPrefix: string) => {
    setSearch("");
    setOpenId(null);
    setSearchParams(nextPrefix ? { prefix: nextPrefix } : {});
  };

  const rows = useMemo<BrowserRow[]>(() => {
    const q = search.trim().toLowerCase();
    const all: BrowserRow[] = [...folders.map((f) => ({ kind: "folder" as const, id: `folder:${f.prefix}`, ...f })), ...files.map((f) => ({ kind: "file" as const, ...f }))];
    return all.filter((row) => !q || rowName(row).toLowerCase().includes(q)).sort((a, b) => compareRows(a, b, sort));
  }, [folders, files, search, sort]);

  const startUploads = async (picked: File[]) => {
    if (!activeSpace || picked.length === 0) return;
    const batch = picked.map((file) => ({ file, item: { id: crypto.randomUUID(), name: file.name, size: file.size, loaded: 0, status: "uploading" as const } }));
    setUploads((prev) => [...prev.filter((item) => item.status === "uploading"), ...batch.map((b) => b.item)]);
    const update = (id: string, patch: Partial<UploadItem>) => setUploads((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    await Promise.all(
      batch.map(async ({ file, item }) => {
        try {
          const saved = await uploadWithProgress(activeSpace.id, `${prefix}${file.name}`, file, (loaded) => update(item.id, { loaded }));
          dispatch(upsertStorageFileLocal(saved));
          update(item.id, { loaded: file.size, status: "done" });
        } catch (err) {
          update(item.id, { status: "error", error: errorText(err) });
        }
      }),
    );
  };

  const handlePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    void startUploads(picked);
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e) || !activeSpace) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e) || !activeSpace) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e) || !activeSpace) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void startUploads(Array.from(e.dataTransfer.files));
    },
  };

  const handleDelete = async (file: StorageFile) => {
    try {
      await dispatch(deleteStorageFile(file)).unwrap();
      if (openId === file.id) setOpenId(null);
      message.success(`Deleted ${lastSegment(file.key)}`);
    } catch (err) {
      message.error(errorText(err));
    }
  };

  const handleResetLink = async (file: StorageFile) => {
    try {
      await dispatch(resetStoragePublicLink(file.id)).unwrap();
      message.success("New link made. The old link no longer works.");
    } catch (err) {
      message.error(errorText(err));
    }
  };

  const sortOrderFor = (key: SortKey) => (sort.key === key ? sort.order : undefined);

  const allColumns: ColumnsType<BrowserRow> = [
    {
      title: "Name",
      key: "name",
      flex: 3,
      sorter: () => 0,
      sortOrder: sortOrderFor("name"),
      render: (_, row) => {
        if (row.kind === "folder") {
          return (
            <button type="button" onClick={(e) => { e.stopPropagation(); openFolder(row.prefix); }} className={NAME_BUTTON}>
              <Folder size={18} className="shrink-0 text-amber-500" fill="currentColor" fillOpacity={0.25} />
              <span className="truncate text-sm font-medium text-foreground">{rowName(row)}</span>
            </button>
          );
        }
        const kind = fileKind(row.key, row.contentType);
        const KindIcon = kind.icon;
        return (
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpenId(row.id); }} className={NAME_BUTTON}>
            <KindIcon size={18} className={cn("shrink-0", kind.className)} />
            <span className="truncate text-sm text-foreground">{rowName(row)}</span>
            {row.publicUrl ? (
              <Tooltip title="Has a public link">
                <span className="inline-flex shrink-0 text-muted-foreground">
                  <Icon name="globe" size={12} />
                </span>
              </Tooltip>
            ) : null}
          </button>
        );
      },
    },
    {
      title: "Kind",
      key: "kind",
      width: 130,
      render: (_, row) => <span className="block truncate text-xs text-muted-foreground">{row.kind === "folder" ? `Folder · ${row.fileCount} ${row.fileCount === 1 ? "file" : "files"}` : fileKind(row.key, row.contentType).label}</span>,
    },
    {
      title: "Size",
      key: "size",
      width: 96,
      align: "right",
      sorter: () => 0,
      sortOrder: sortOrderFor("size"),
      render: (_, row) => <span className="text-xs tabular-nums text-muted-foreground">{formatBytes(rowSize(row))}</span>,
    },
    {
      title: "Modified",
      key: "updatedAt",
      width: 120,
      sorter: () => 0,
      sortOrder: sortOrderFor("updatedAt"),
      render: (_, row) => (
        <Tooltip title={formatDateTime(row.updatedAt)}>
          <span className="text-xs text-muted-foreground">{relativeTime(row.updatedAt)}</span>
        </Tooltip>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 48,
      align: "right",
      render: (_, row) => (row.kind === "folder" ? null : <FileMenu file={row} onDelete={handleDelete} />),
    },
  ];
  const hiddenColumns = new Set<string>([...(tableWidth && tableWidth < 640 ? ["kind"] : []), ...(tableWidth && tableWidth < 480 ? ["updatedAt"] : [])]);
  const columns = allColumns.filter((column) => !hiddenColumns.has(String(column.key)));

  const spacePath = `/storage/${encodeURIComponent(spaceParam)}`;
  const segments = prefix.split("/").filter(Boolean);
  const crumbs: BreadcrumbItem[] = [{ label: "Storage", to: "/storage", icon: <FeatureIcon name="storage" size={16} variant="sticker" /> }, { label: spaceParam }];
  const pathCrumbs: BreadcrumbItem[] = [
    { label: spaceParam, to: spacePath, icon: <Folder size={14} className="text-amber-500" fill="currentColor" fillOpacity={0.25} /> },
    ...segments.map((part, index) => {
      const target = `${segments.slice(0, index + 1).join("/")}/`;
      return { label: part, to: target !== prefix ? `${spacePath}?prefix=${encodeURIComponent(target)}` : undefined };
    }),
  ];
  const summary = [folders.length ? `${folders.length} ${folders.length === 1 ? "folder" : "folders"}` : null, `${files.length} ${files.length === 1 ? "file" : "files"}`].filter(Boolean).join(" · ");

  return (
    <div className="relative flex h-full min-h-0 flex-col" {...dropHandlers}>
      <ContentHeader
        left={
          <div className="flex min-w-0 items-center gap-2">
            <WindowHeaderBackButton to="/storage" label="Back to storage" />
            <ContentBreadcrumb items={crumbs} />
          </div>
        }
        right={activeSpace ? <SpaceSettings space={activeSpace} onDeleted={() => routerNavigate("/storage", { replace: true })} /> : undefined}
      />
      {activeSpace ? (
        <PageBand
          header={<PageHeader title={activeSpace.name} icon="storage" description={activeSpace.description ?? undefined} className="mb-0 pb-0" bordered={false} actions={<PublicSwitch space={activeSpace} />} />}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageShell className="pt-5">
          {!spacesLoaded && !spacesError ? <Skeleton paragraph={{ rows: 4 }} /> : null}
          {spacesError && !spacesLoaded ? <Empty className="py-16" description={spacesError} /> : null}
          {spacesLoaded && !activeSpace ? (
            <Empty className="py-16" description={`Space "${spaceParam}" not found`}>
              <Button type="link" onClick={() => routerNavigate("/storage")}>
                Back to storage
              </Button>
            </Empty>
          ) : null}

          {activeSpace ? (
            <>
              {prefix ? (
                <nav aria-label="Folder path" className="mb-3">
                  <ContentBreadcrumb items={pathCrumbs} />
                </nav>
              ) : null}
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <SearchInput key={`${activeSpace.id}:${prefix}`} defaultValue={search} onChange={setSearch} placeholder="Find in this folder..." className="w-64 max-w-full" />
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{summary}</span>
                <input ref={fileInputRef} type="file" multiple hidden onChange={handlePicked} />
                <Button type="primary" loading={uploading} icon={<Upload size={14} />} onClick={() => fileInputRef.current?.click()}>
                  Upload
                </Button>
              </div>

              <div ref={tableHostRef}>
              <Table
                className="rounded-xl bg-card [&_th]:bg-card!"
                rowKey="id"
                size="small"
                loading={filesLoading && rows.length === 0}
                columns={columns}
                dataSource={rows}
                pagination={false}
                onChange={(_, __, sorter) => {
                  if (sorter.columnKey && sorter.order) setSort({ key: sorter.columnKey as SortKey, order: sorter.order });
                }}
                rowClassName="group/row cursor-pointer"
                onRow={(row) => ({
                  onClick: () => (row.kind === "folder" ? openFolder(row.prefix) : setOpenId(row.id)),
                })}
                locale={{
                  emptyText: filesError ? (
                    <Empty bordered={false} icon={null} className="py-8" description={filesError} />
                  ) : search ? (
                    <Empty bordered={false} icon={null} className="py-8" description={`Nothing here matches "${search}"`} />
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <CloudUpload size={28} className="text-muted-foreground" />
                      <span className="text-sm text-foreground">{prefix ? "This folder is empty" : `No files in ${activeSpace.name} yet`}</span>
                      <span className="max-w-sm text-xs text-muted-foreground">Drop files here or click Upload. Agents write here with storage_upload_link or agenthands.storage.space("{activeSpace.name}").put(key, data).</span>
                    </div>
                  ),
                }}
              />
              </div>
            </>
          ) : null}
        </PageShell>
      </div>

      {dragging && activeSpace ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-card px-10 py-8 shadow-lg">
            <CloudUpload size={32} className="text-primary" />
            <span className="text-sm font-medium text-foreground">Drop to upload</span>
            <span className="text-xs text-muted-foreground">
              into {activeSpace.name}/{prefix}
            </span>
          </div>
        </div>
      ) : null}

      <UploadTray items={uploads} onClear={() => setUploads([])} />
      <FileDrawer object={openFile} onClose={() => setOpenId(null)} onDownload={(file) => void downloadFile(file)} onDelete={handleDelete} onResetLink={handleResetLink} />
    </div>
  );
}
