import { Button, EFormItemType, Icon, Modal, SchemaForm, type TFormItemProps, message } from "devnonla-ui";
import { Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { apiClient } from "src/common/api";
import type { LlmProvider } from "src/common/types";
import RenderIf from "src/components/RenderIf";
import { PROVIDER_OPTIONS, createLlmProvider, generateLabel, getProviderMeta, refreshModels, updateLlmProvider } from "src/modules/llm-providers/common/llmProvidersSlice";
import { ProviderEmptyState } from "src/modules/llm-providers/components/ProviderEmptyState";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { ProviderCard } from "./ProviderCard";
import { ProviderDetailDialog } from "./ProviderDetailDialog";

// ─── Add / Edit Dialog ───────────────────────────────────────────────────────

interface ProviderFormDialogProps {
  editId?: string;
  onClose: () => void;
}

type ProviderFormValues = {
  provider: string;
  label: string;
  apiKey: string;
  customBaseUrl: string;
};

function ProviderFormDialog({ editId, onClose }: ProviderFormDialogProps) {
  const dispatch = useAppDispatch();
  const providers = useAppSelector((s) => s.llmProviders.items) as LlmProvider[];
  const isEdit = !!editId;
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const form = useForm<ProviderFormValues>({
    defaultValues: { provider: "openai", label: generateLabel("openai", providers), apiKey: "", customBaseUrl: "" },
    mode: "onSubmit",
  });
  const rootError = form.formState.errors.root?.message;
  const provider = form.watch("provider");
  const meta = getProviderMeta(provider);
  const prevProvider = useRef(provider);

  useEffect(() => {
    if (isEdit) return;
    if (prevProvider.current === provider) return;
    prevProvider.current = provider;
    form.setValue("label", generateLabel(provider, providers));
    if (!getProviderMeta(provider).supportsCustomBaseUrl) form.setValue("customBaseUrl", "");
  }, [provider, isEdit, form, providers]);

  useEffect(() => {
    if (!editId) return;
    setLoading(true);
    apiClient
      .get<LlmProvider>(`/api/providers/${editId}`)
      .then((detail) => {
        form.reset({
          provider: detail.provider,
          label: detail.label,
          apiKey: "",
          customBaseUrl: detail.customBaseUrl ?? "",
        });
      })
      .catch(() => {
        message.error("Failed to load provider details");
        onClose();
      })
      .finally(() => setLoading(false));
  }, [editId, onClose, form]);

  const items: TFormItemProps[] = useMemo(() => {
    const list: TFormItemProps[] = [];
    if (!isEdit) {
      list.push({
        type: EFormItemType.Select,
        name: "provider",
        label: "Provider",
        colSpan: 12,
        choices: PROVIDER_OPTIONS,
        options: { placeholder: "Provider" },
      });
    }
    list.push(
      {
        type: EFormItemType.Input,
        name: "label",
        label: "Label",
        colSpan: 12,
        rules: {
          required: "Please fill in all required fields",
          validate: (value) => (typeof value === "string" && value.trim() ? true : "Please fill in all required fields"),
        },
        options: { placeholder: "e.g. My OpenAI Key" },
      },
      {
        type: EFormItemType.Input,
        name: "apiKey",
        label: isEdit ? "New API Key" : "API Key",
        colSpan: 12,
        rules: isEdit ? undefined : { required: "Please fill in all required fields" },
        options: {
          type: "password",
          placeholder: isEdit ? "••••••••" : meta.keyPlaceholder,
          autoComplete: "new-password",
        },
      },
    );
    if (meta.supportsCustomBaseUrl) {
      list.push({
        type: EFormItemType.Input,
        name: "customBaseUrl",
        label: "Base URL",
        colSpan: 12,
        options: { placeholder: meta.defaultBase || "https://…" },
      });
    }
    return list;
  }, [isEdit, meta]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    const customBaseUrl = meta.supportsCustomBaseUrl ? values.customBaseUrl.trim() : "";
    try {
      if (isEdit && editId) {
        const payload: { id: string; label: string; customBaseUrl: string; apiKey?: string } = {
          id: editId,
          label: values.label.trim(),
          customBaseUrl,
        };
        if (values.apiKey.trim()) payload.apiKey = values.apiKey.trim();
        await dispatch(updateLlmProvider(payload)).unwrap();
        message.success(`Provider "${values.label}" updated`);
      } else {
        await dispatch(
          createLlmProvider({
            provider: values.provider,
            label: values.label.trim(),
            apiKey: values.apiKey.trim(),
            customBaseUrl,
            models: [],
          }),
        ).unwrap();
        message.success(`Provider "${values.label}" added`);
      }
      onClose();
    } catch (err: unknown) {
      form.setError("root", { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Modal
      open
      onCancel={onClose}
      title={
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-field-sm w-field-sm shrink-0 items-center justify-center rounded-lg bg-muted/60">
            <div className="text-[14px] leading-none text-muted-foreground">{isEdit ? <Pencil size={16} /> : <Icon name="document" size={16} />}</div>
          </div>
          <span className="truncate font-semibold text-foreground">{isEdit ? "Edit Provider" : "Add Provider"}</span>
        </div>
      }
      width={560}
      style={{ top: 120 }}
      destroyOnHidden
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="text" size="medium" onClick={onClose}>
            Cancel
          </Button>
          <Button type="primary" size="medium" htmlType="submit" form="provider-form" loading={saving} disabled={loading}>
            {isEdit ? "Save" : "Add Provider"}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center h-40 gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      ) : (
        <form id="provider-form" onSubmit={onSubmit}>
          <SchemaForm form={form} items={items} />
          {rootError ? (
            <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive font-medium">{rootError}</p>
            </div>
          ) : null}
        </form>
      )}
    </Modal>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function ProvidersPage() {
  const dispatch = useAppDispatch();
  const providers = useAppSelector((s) => s.llmProviders.items) as LlmProvider[];

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailProvider = providers.find((p) => p.id === detailId) ?? null;
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const handleRefreshModels = async (id: string) => {
    setRefreshingId(id);
    try {
      await dispatch(refreshModels(id)).unwrap();
      message.success("Models refreshed");
    } catch (err: any) {
      message.error(err?.message || "Failed to refresh models");
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex justify-end">
        <Button id="settings-add-provider" type="primary" icon={<Plus size={16} />} onClick={() => setShowAddDialog(true)}>
          Add Provider
        </Button>
      </div>

      <RenderIf condition={providers.length === 0}>
        <ProviderEmptyState />
      </RenderIf>

      <RenderIf condition={providers.length > 0}>
        {() => (
          <div className="flex flex-col gap-4">
            {providers.map((p) => (
              <ProviderCard key={p.id} provider={p} refreshing={refreshingId === p.id} onRefresh={() => handleRefreshModels(p.id)} onOpen={() => setDetailId(p.id)} />
            ))}
          </div>
        )}
      </RenderIf>

      <RenderIf condition={showAddDialog}>
        <ProviderFormDialog onClose={() => setShowAddDialog(false)} />
      </RenderIf>

      <RenderIf condition={!!detailProvider}>{() => <ProviderDetailDialog provider={detailProvider as LlmProvider} onClose={() => setDetailId(null)} />}</RenderIf>
    </div>
  );
}
