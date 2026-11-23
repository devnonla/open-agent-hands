import { Button, ButtonCopy, Drawer, Icon, Popconfirm, Spin } from "devnonla-ui";
import { type ReactNode, useEffect, useState } from "react";
import { apiClient } from "src/common/api";
import type { StorageFile } from "src/common/types";
import { formatDateTime } from "src/common/utils/date";
import { formatBytes } from "../common/format";

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | null;

function previewKind(contentType: string): PreviewKind {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "image/svg+xml") return "text";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/") || /\/(json|xml|javascript|typescript|x-yaml|yaml|csv|sql|x-sh)$/.test(type) || type.endsWith("+json") || type.endsWith("+xml")) return "text";
  return null;
}

type Preview = { kind: "url"; url: string } | { kind: "text"; text: string; truncated: boolean } | { kind: "error"; message: string };

function usePreview(object: StorageFile | null) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const kind = object ? previewKind(object.contentType) : null;
  const tooBig = !!object && kind !== "text" && object.size > MAX_PREVIEW_BYTES;

  useEffect(() => {
    setPreview(null);
    if (!object || !kind || tooBig) return;
    let cancelled = false;
    let url: string | null = null;
    setLoading(true);
    apiClient
      .getBlob(`/api/storage/files/${object.id}/download`)
      .then(async (blob) => {
        if (cancelled) return;
        if (kind === "text") {
          const slice = blob.slice(0, MAX_TEXT_BYTES);
          const text = await slice.text();
          if (!cancelled) setPreview({ kind: "text", text, truncated: blob.size > MAX_TEXT_BYTES });
          return;
        }
        url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: object.contentType }));
        setPreview({ kind: "url", url });
      })
      .catch((err: unknown) => {
        if (!cancelled) setPreview({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [object?.id, object?.updatedAt, kind, tooBig]);

  return { kind, preview, loading, tooBig };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 border-b border-border py-2 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-all text-foreground">{children}</dd>
    </div>
  );
}

function PreviewBody({ kind, preview, loading, tooBig, object }: ReturnType<typeof usePreview> & { object: StorageFile }) {
  if (!kind) return <p className="m-0 text-sm text-muted-foreground">No preview for {object.contentType.split(";")[0]}. Download the file to open it.</p>;
  if (tooBig) return <p className="m-0 text-sm text-muted-foreground">Too large to preview ({formatBytes(object.size)}). Download the file to open it.</p>;
  if (loading || !preview) return <Spin />;
  if (preview.kind === "error") return <p className="m-0 text-sm text-destructive">{preview.message}</p>;
  if (preview.kind === "text") {
    return (
      <>
        <pre className="m-0 max-h-[60vh] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all text-foreground">{preview.text}</pre>
        {preview.truncated ? <p className="mt-2 mb-0 text-xs text-muted-foreground">Showing the first 1 MB.</p> : null}
      </>
    );
  }
  if (kind === "image") return <img src={preview.url} alt={object.key} className="max-h-[60vh] max-w-full rounded-lg border border-border object-contain" />;
  if (kind === "video") return (
      <video src={preview.url} controls className="max-h-[60vh] w-full rounded-lg">
        <track kind="captions" />
      </video>
    );
  if (kind === "audio") return (
      <audio src={preview.url} controls className="w-full">
        <track kind="captions" />
      </audio>
    );
  return <iframe src={preview.url} title={object.key} className="h-[60vh] w-full rounded-lg border border-border" />;
}

export function FileDrawer({ object, onClose, onDownload, onDelete, onResetLink }: { object: StorageFile | null; onClose: () => void; onDownload: (object: StorageFile) => void; onDelete: (object: StorageFile) => Promise<void>; onResetLink: (object: StorageFile) => Promise<void> }) {
  const previewState = usePreview(object);
  const publicLink = object?.publicUrl ? `${window.location.origin}${object.publicUrl}` : null;

  return (
    <Drawer
      open={!!object}
      onClose={onClose}
      width={560}
      title={object ? <span className="block truncate">{object.key.split("/").pop()}</span> : null}
      extra={
        object ? (
          <span className="inline-flex items-center gap-2">
            <Button size="small" icon={<Icon name="download" size={14} />} onClick={() => onDownload(object)}>
              Download
            </Button>
            <Popconfirm title="Delete this file?" description="Code reading this key gets null." okText="Delete" okType="danger" onConfirm={() => onDelete(object)} styles={{ root: { width: 260 } }}>
              <Button size="small" danger icon={<Icon name="trash" size={14} />}>
                Delete
              </Button>
            </Popconfirm>
          </span>
        ) : null
      }
    >
      {object ? (
        <div className="flex flex-col gap-6">
          <section>
            <h3 className="mt-0 mb-2 text-sm font-semibold text-foreground">Properties</h3>
            <dl className="m-0">
              <Row label="Key">
                <span className="inline-flex items-start gap-1 font-mono text-xs">
                  {object.key}
                  <ButtonCopy size="small" label="Copy key" text={object.key} />
                </span>
              </Row>
              <Row label="Space">{object.space}</Row>
              <Row label="Size">
                {formatBytes(object.size)} <span className="text-muted-foreground tabular-nums">({object.size.toLocaleString()} bytes)</span>
              </Row>
              <Row label="Type">{object.contentType}</Row>
              <Row label="Last modified">{formatDateTime(object.updatedAt)}</Row>
              <Row label="Created">{formatDateTime(object.createdAt)}</Row>
              <Row label="Public link">
                {publicLink ? (
                  <span className="flex flex-col items-start gap-1.5">
                    <span className="inline-flex items-start gap-1">
                      <a href={publicLink} target="_blank" rel="noreferrer noopener" className="font-mono text-xs text-link">
                        {object.publicUrl}
                      </a>
                      <ButtonCopy size="small" label="Copy public link" text={publicLink} />
                    </span>
                    <span className="text-xs text-muted-foreground">Anyone with this link can open the file. It cannot be guessed or listed.</span>
                    <Popconfirm title="Make a new link?" description="The current link stops working at once." okText="New link" onConfirm={() => onResetLink(object)} styles={{ root: { width: 260 } }}>
                      <Button size="small" icon={<Icon name="refresh" size={14} />}>
                        New link
                      </Button>
                    </Popconfirm>
                  </span>
                ) : (
                  <span className="text-muted-foreground">None. The space is private.</span>
                )}
              </Row>
            </dl>
          </section>
          <section>
            <h3 className="mt-0 mb-2 text-sm font-semibold text-foreground">Preview</h3>
            <PreviewBody {...previewState} object={object} />
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
