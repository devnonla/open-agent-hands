import { Button, Card, EFormItemType, Icon, Input, Modal, Popover, SchemaForm, Spin, Switch, Tag, type TFormItemProps, message } from "devnonla-ui";
import { Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "src/common/api";
import { wsClient } from "src/common/api/wsClient";
import { usePublicUrl } from "src/common/hooks/usePublicUrl";
import type { Site } from "src/common/types";
import { normalizeSlugInput, slugify } from "src/common/utils/slug";
import RenderIf from "src/components/RenderIf";
import { capturePreviewIframe } from "../common/capturePreviewIframe";
import { sitesApi } from "../common/sitesApi";
import { SiteCodeEditor, type SiteCodeEditorHandle } from "./components/SiteCodeEditor";
import { SiteEditorHeader, type SiteViewMode } from "./components/SiteEditorHeader";

type SiteSettingsValues = { name: string; slug: string };

const siteDraftKey = (s: Site) => JSON.stringify([s.draftUpdatedAt, s.draftDepsStatus, s.draftDepsError]);

const SITE_SETTINGS_ITEMS: TFormItemProps[] = [
  {
    type: EFormItemType.Input,
    name: "name",
    label: "Name",
    colSpan: 12,
    rules: {
      required: "Name is required",
      validate: (value) => (typeof value === "string" && value.trim() ? true : "Name is required"),
    },
  },
  {
    type: EFormItemType.Input,
    name: "slug",
    label: "Slug",
    colSpan: 12,
    rules: {
      required: "Slug is required",
      pattern: { value: "^[a-z0-9]+(?:-[a-z0-9]+)*$", message: "Slug must be lowercase alphanumeric with hyphens" },
    },
  },
];

function SiteSettingsModal({
  site,
  onClose,
  onSaved,
  onDelete,
}: {
  site: Site;
  onClose: () => void;
  onSaved: (site: Site) => void;
  onDelete: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const form = useForm<SiteSettingsValues>({ defaultValues: { name: site.name, slug: site.slug }, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;
  const slugValue = form.watch("slug");
  const base = usePublicUrl()?.effective ?? window.location.origin;

  const onSubmit = form.handleSubmit(async ({ name, slug }) => {
    const n = name.trim();
    const s = slugify(slug);
    setSaving(true);
    try {
      const updated = await sitesApi.update(site.id, { name: n, slug: s });
      message.success("Site updated");
      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      form.setError("root", { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Modal open title="Site settings" onCancel={onClose} onOk={() => void onSubmit()} okText="Save" confirmLoading={saving} destroyOnHidden>
      <form onSubmit={onSubmit}>
        <SchemaForm
          form={form}
          items={SITE_SETTINGS_ITEMS}
          valuesChangeDebounce={0}
          onValuesChange={(all) => {
            const normalized = normalizeSlugInput(all.slug);
            if (normalized !== all.slug) form.setValue("slug", normalized);
          }}
        />
        <p className="-mt-2 mb-3 text-xs text-muted-foreground">Public URL: {base}/public/sites/{slugValue || "…"}</p>
        {rootError ? <p className="mb-0 text-sm text-destructive">{rootError}</p> : null}
      </form>
      <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-destructive/30 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Delete this site</div>
          <div className="text-xs text-muted-foreground">Draft and production files are removed. This cannot be undone.</div>
        </div>
        <Button danger size="small" icon={<Icon name="trash" size={14} />} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </Modal>
  );
}

export default function SiteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const publicBase = usePublicUrl()?.effective;
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [localPassword, setLocalPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const [previewAuthReady, setPreviewAuthReady] = useState(false);
  const [viewMode, setViewMode] = useState<SiteViewMode>("preview");
  const [filesEpoch, setFilesEpoch] = useState(0);
  const codeEditorRef = useRef<SiteCodeEditorHandle>(null);
  const draftKeyRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const s = await sitesApi.get(id);
    draftKeyRef.current = siteDraftKey(s);
    setSite(s);
    setLocalPassword("");
    setPasswordTouched(false);
  }, [id]);

  const mintPreviewSession = useCallback(async () => {
    if (!id) return;
    await apiClient.post(`/api/sites/${id}/live/session`, {});
  }, [id]);

  const runPreview = useCallback(() => {
    setPreviewLoading(true);
    void mintPreviewSession()
      .catch(() => undefined)
      .finally(() => setPreviewEpoch((n) => n + 1));
  }, [mintPreviewSession]);

  const capturingRef = useRef(false);
  const captureAndUploadThumbnail = useCallback(async () => {
    if (!id || capturingRef.current) return;
    const iframe = previewIframeRef.current;
    if (!iframe) return;
    capturingRef.current = true;
    try {
      const blob = await capturePreviewIframe(iframe);
      if (blob) await sitesApi.uploadThumbnail(id, blob);
    } catch {
      return;
    } finally {
      capturingRef.current = false;
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    return wsClient.on<Site>("sites:updated", (payload) => {
      if (payload.id !== id) return;
      setSite((prev) => (prev ? { ...prev, ...payload } : payload));
      const key = siteDraftKey(payload);
      if (key === draftKeyRef.current) return;
      draftKeyRef.current = key;
      setFilesEpoch((n) => n + 1);
      runPreview();
    });
  }, [id, runPreview]);

  const onPreviewLoad = useCallback(() => {
    setPreviewLoading(false);
    void captureAndUploadThumbnail();
  }, [captureAndUploadThumbnail]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setPreviewAuthReady(false);
    void mintPreviewSession()
      .then(() => {
        if (!cancelled) setPreviewAuthReady(true);
      })
      .catch(() => {
        if (!cancelled) setPreviewAuthReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, mintPreviewSession]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    void reload()
      .then(() => {
        if (cancelled) return;
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        message.error(err instanceof Error ? err.message : "Failed to load site");
        navigate("/sites");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, navigate, reload]);

  const handleViewModeChange = async (next: SiteViewMode) => {
    if (next === viewMode) return;
    if (viewMode === "editor") {
      try {
        await codeEditorRef.current?.flush();
      } catch {
        return;
      }
      runPreview();
    }
    setViewMode(next);
  };

  if (loading || !site) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  const publicPath = `/public/sites/${site.slug}`;
  const publicLink = `${publicBase ?? window.location.origin}${publicPath}`;
  const previewSrc = previewAuthReady ? `/api/sites/${id}/live?t=${previewEpoch}` : undefined;
  const passwordDirty = passwordTouched;
  const hasPassword = !!site.hasPublicPassword;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      message.success("Public link copied");
    } catch {
      message.error("Copy failed");
    }
  };

  const handleSavePassword = async () => {
    setSavingPassword(true);
    try {
      const updated = await sitesApi.update(site.id, { publicPassword: localPassword || null });
      setSite(updated);
      setLocalPassword("");
      setPasswordTouched(false);
      message.success(localPassword ? "Password saved" : "Password removed");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : "Failed to save password");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDelete = () => {
    Modal.confirm({
      title: `Delete "${site.name}"?`,
      content: "This cannot be undone. Draft and production files will be removed.",
      okText: "Delete",
      okType: "danger",
      cancelText: "Cancel",
      onOk: async () => {
        await sitesApi.remove(site.id);
        message.success("Site deleted");
        navigate("/sites");
      },
    });
  };

  const publicAccessControl = (
    <Popover
      trigger="click"
      placement="bottomRight"
      arrow={{ pointAtCenter: true }}
      contentClassName="w-[26rem] max-w-[calc(100vw-2rem)] p-3"
      content={
        <Card>
          <Card.Item label="Public access" description={site.isPublished ? "Anyone with the link can view this site." : "Publish this site to make it available at a public URL."}>
            <Switch
              size="small"
              checked={site.isPublished}
              onChange={async (checked) => {
                const updated = await sitesApi.update(site.id, { isPublished: checked });
                setSite(updated);
              }}
            />
          </Card.Item>
          <RenderIf condition={site.isPublished}>
            <Card.Item className="flex-col items-stretch gap-2">
              <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Live URL</span>
              <div className="flex items-center gap-2">
                <Icon name="transfer" size={14} className="shrink-0 text-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{publicLink}</span>
                <Button size="small" icon={<Icon name="copy" size={13} />} onClick={() => void handleCopyLink()} className="shrink-0">
                  Copy URL
                </Button>
              </div>
            </Card.Item>
          </RenderIf>
          <Card.Item className="flex-col items-stretch gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">Password protection</span>
              <Tag color={hasPassword ? "success" : "default"}>{hasPassword ? "Enabled" : "Off"}</Tag>
            </div>
            <Input.Password
              visibilityToggle={{ visible: showPassword, onVisibleChange: setShowPassword }}
              placeholder={hasPassword ? "Password is set — type to change" : "Leave blank for open access"}
              value={localPassword}
              onChange={(e) => {
                setLocalPassword(e.target.value);
                setPasswordTouched(true);
              }}
            />
            <p className="m-0 text-2xs leading-4 text-muted-foreground">{hasPassword ? "Clear the field and save to remove password protection." : "Visitors must enter this password to view the public site."}</p>
            <div className="flex justify-end">
              <Button size="small" type="primary" disabled={!passwordDirty} loading={savingPassword} onClick={() => void handleSavePassword()}>
                Save password
              </Button>
            </div>
          </Card.Item>
        </Card>
      }
    >
      <Button
        size="small"
        icon={<Share2 size={14} />}
        {...(site.isPublished ? { color: "green" as const, variant: "filled" as const, style: { "--nonla-btn": "var(--nonla-success)" } as React.CSSProperties } : {})}
        aria-label={site.isPublished ? (hasPassword ? "Share settings, shared with a password" : "Share settings, public") : "Share settings, private"}
      >
        {site.isPublished ? "Shared" : "Share"}
      </Button>
    </Popover>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <RenderIf condition={settingsOpen}>
        <SiteSettingsModal
          site={site}
          onClose={() => setSettingsOpen(false)}
          onSaved={setSite}
          onDelete={() => {
            setSettingsOpen(false);
            handleDelete();
          }}
        />
      </RenderIf>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SiteEditorHeader
            title={site.name}
            actions={
              <>
                <RenderIf condition={site.isPublished}>
                  <Button size="small" icon={<Icon name="copy" size={13} />} onClick={() => void handleCopyLink()}>
                    Copy URL
                  </Button>
                </RenderIf>
                {publicAccessControl}
              </>
            }
            viewMode={viewMode}
            onViewModeChange={(v) => void handleViewModeChange(v)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {viewMode === "preview" ? (
              <Spin spinning={previewLoading} tip="Loading preview…" className="flex min-h-0 flex-1 flex-col">
                <iframe ref={previewIframeRef} key={previewEpoch} title="preview" className="min-h-0 w-full flex-1 border-0 bg-white" src={previewSrc} onLoad={onPreviewLoad} />
              </Spin>
            ) : (
              <SiteCodeEditor ref={codeEditorRef} siteId={site.id} reloadToken={filesEpoch} onSiteUpdated={setSite} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
