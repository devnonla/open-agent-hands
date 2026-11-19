import { Button, Input, Modal, Popconfirm, SearchInput, Skeleton, message } from "devnonla-ui";
import { RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "src/common/api";
import type { LlmProvider } from "src/common/types";
import { formatTokens } from "src/common/utils/formatTokens";
import { ProviderIcon } from "src/components/ProviderIcon";
import RenderIf from "src/components/RenderIf";
import { deleteLlmProvider, getProviderMeta, refreshModels, updateLlmProvider } from "src/modules/llm-providers/common/llmProvidersSlice";
import { useAppDispatch } from "src/store/store";

interface ProviderDetailDialogProps {
  provider: LlmProvider;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-tertiary-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Detail of one provider. Fields are editable in place; Save lights up only after a change. Sync belongs to the model list. */
export function ProviderDetailDialog({ provider, onClose }: ProviderDetailDialogProps) {
  const dispatch = useAppDispatch();
  const meta = getProviderMeta(provider.provider);

  const [label, setLabel] = useState(provider.label);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.customBaseUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [contexts, setContexts] = useState<NonNullable<LlmProvider["modelContext"]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLabel(provider.label);
    setApiKey("");
    setBaseUrl(provider.customBaseUrl ?? "");
    setError(null);
  }, [provider.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([apiClient.get(`/api/providers/${provider.id}/models`), apiClient.get(`/api/providers/${provider.id}/model-context`).catch(() => ({}))])
      .then(([list, context]) => {
        if (cancelled) return;
        setModels(Array.isArray(list) ? (list as string[]) : []);
        setContexts((context ?? {}) as NonNullable<LlmProvider["modelContext"]>);
      })
      .catch(() => {
        if (!cancelled) {
          message.error("Failed to load models");
          setModels([]);
          setContexts({});
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, search]);

  const trimmedLabel = label.trim();
  const trimmedKey = apiKey.trim();
  const trimmedUrl = baseUrl.trim();
  const urlDirty = meta.supportsCustomBaseUrl && trimmedUrl !== (provider.customBaseUrl ?? "");
  const dirty = trimmedLabel !== provider.label || trimmedKey.length > 0 || urlDirty;
  const canSave = dirty && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    if (!trimmedLabel) {
      setError("Please fill in all required fields");
      return;
    }
    setSaving(true);
    setError(null);
    const customBaseUrl = meta.supportsCustomBaseUrl ? trimmedUrl : "";
    const payload: { id: string; label: string; customBaseUrl: string; apiKey?: string } = {
      id: provider.id,
      label: trimmedLabel,
      customBaseUrl,
    };
    if (trimmedKey) payload.apiKey = trimmedKey;
    try {
      await dispatch(updateLlmProvider(payload)).unwrap();
      setLabel(trimmedLabel);
      setBaseUrl(customBaseUrl);
      setApiKey("");
      message.success(`Provider "${trimmedLabel}" updated`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update provider");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await dispatch(deleteLlmProvider(provider.id)).unwrap();
      message.success(`Deleted provider "${provider.label}"`);
      onClose();
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : "Failed to delete provider");
      setDeleting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await dispatch(refreshModels(provider.id)).unwrap();
      setModels(Array.isArray(updated.models) ? updated.models : []);
      setContexts(updated.modelContext ?? {});
      message.success("Models refreshed");
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : "Failed to refresh models");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title={
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-field-sm w-field-sm shrink-0 items-center justify-center rounded-lg bg-muted/60">
            <div className="text-[14px] leading-none text-muted-foreground">
              <ProviderIcon provider={provider.provider} size={16} />
            </div>
          </div>
          <span className="truncate font-semibold text-foreground">{provider.label}</span>
        </div>
      }
      width={520}
      centered
      destroyOnHidden
      styles={{ body: { padding: 0 } }}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Popconfirm title={`Delete "${provider.label}"?`} description="This removes the provider and its configuration. This cannot be undone." okText="Delete" okType="danger" cancelText="Cancel" onConfirm={() => void handleDelete()} styles={{ root: { width: 280 } }}>
            <Button type="text" size="medium" icon={<Trash2 size={16} />} loading={deleting} className="text-destructive! hover:text-destructive!">
              Delete
            </Button>
          </Popconfirm>
          <div className="flex items-center gap-2">
            <Button type="text" size="medium" onClick={onClose}>
              Cancel
            </Button>
            <Button type="primary" size="medium" disabled={!canSave} loading={saving} onClick={() => void handleSave()}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Label">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. My OpenAI Key" />
          </Field>
          <Field label="API key">
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider.maskedApiKey || "Leave blank to keep the current key"} autoComplete="new-password" />
          </Field>
          {meta.supportsCustomBaseUrl ? (
            <div className="sm:col-span-2">
              <Field label="Base URL">
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={meta.defaultBase || "https://…"} />
              </Field>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
            <p className="m-0 text-xs font-medium text-destructive">{error}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-tertiary-foreground">Models</span>
            <span className="text-xs text-muted-foreground tabular-nums">{loading ? "…" : `${filtered.length}${search.trim() ? ` / ${models.length}` : ""}`}</span>
          </div>
          <div className="flex items-center gap-2">
            <SearchInput placeholder="Search models…" className="min-w-0 flex-1" wait={0} onChange={setSearch} />
            <Button type="default" size="medium" loading={refreshing} icon={<RefreshCw size={16} />} onClick={() => void handleRefresh()}>
              Sync
            </Button>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-border-subtle bg-muted/40">
            <RenderIf condition={loading}>
              <div className="flex flex-col gap-2 p-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton.Input key={i} active block className="h-7!" />
                ))}
              </div>
            </RenderIf>

            <RenderIf condition={!loading && filtered.length === 0}>
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">{models.length === 0 ? "No models synced yet — click Sync to fetch." : "No models match your search."}</div>
            </RenderIf>

            <RenderIf condition={!loading && filtered.length > 0}>
              {() => (
                <ul className="m-0 list-none divide-y divide-border-subtle p-0">
                  {filtered.map((model) => (
                    <li key={model} className="flex items-center gap-3 px-3 py-2 text-xs" title={contexts[model] ? `${model} · ${contexts[model].max.toLocaleString("en-US")} tokens${contexts[model].source === "table" ? " (estimated)" : ""}` : model}>
                      <span className="min-w-0 flex-1 truncate font-mono text-foreground">{model}</span>
                      {contexts[model] ? (
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {contexts[model].source === "table" ? "~" : ""}
                          {formatTokens(contexts[model].max)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </RenderIf>
          </div>
        </div>
      </div>
    </Modal>
  );
}
