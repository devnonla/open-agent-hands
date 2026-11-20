import { EFormItemType, Modal, SchemaForm, type TFormItemProps } from "devnonla-ui";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { apiClient } from "src/common/api";
import type { ApiKey, DatatableProject, KvStoreEntry } from "src/common/types";
import { ScopePicker } from "./ScopePicker";

interface ApiKeyFormDialogProps {
  edit?: ApiKey | null;
  datatableProjects: DatatableProject[];
  kvEntries: KvStoreEntry[];
  onClose: () => void;
  onCreated: (key: ApiKey) => void;
  onUpdated: (key: ApiKey) => void;
}

type ApiKeyValues = {
  name: string;
  datatableProjectIds: string[];
  datatablesUnrestricted: boolean;
  kvEntryIds: string[];
  kvUnrestricted: boolean;
};

export function ApiKeyFormDialog({ edit, datatableProjects, kvEntries, onClose, onCreated, onUpdated }: ApiKeyFormDialogProps) {
  const isEdit = !!edit;
  const form = useForm<ApiKeyValues>({
    defaultValues: {
      name: edit?.name ?? "",
      datatableProjectIds: edit?.datatableProjectIds ?? [],
      datatablesUnrestricted: edit?.datatablesUnrestricted ?? false,
      kvEntryIds: edit?.kvEntryIds ?? [],
      kvUnrestricted: edit?.kvUnrestricted ?? false,
    },
    mode: "onSubmit",
  });
  const [saving, setSaving] = useState(false);
  const rootError = form.formState.errors.root?.message;
  const datatableProjectIds = form.watch("datatableProjectIds");
  const datatablesUnrestricted = form.watch("datatablesUnrestricted");
  const kvEntryIds = form.watch("kvEntryIds");
  const kvUnrestricted = form.watch("kvUnrestricted");

  useEffect(() => {
    form.reset({
      name: edit?.name ?? "",
      datatableProjectIds: edit?.datatableProjectIds ?? [],
      datatablesUnrestricted: edit?.datatablesUnrestricted ?? false,
      kvEntryIds: edit?.kvEntryIds ?? [],
      kvUnrestricted: edit?.kvUnrestricted ?? false,
    });
  }, [edit, form]);

  const items: TFormItemProps[] = useMemo(
    () => [
      {
        type: EFormItemType.Input,
        name: "name",
        label: "Name",
        colSpan: 12,
        rules: {
          required: "Please enter a name",
          validate: (value) => (typeof value === "string" && value.trim() ? true : "Please enter a name"),
        },
        options: { placeholder: "e.g. Production bot", autoComplete: "off" },
      },
      {
        type: EFormItemType.Custom,
        name: "datatableProjectIds",
        label: "Datatables",
        colSpan: 12,
        render: () => (
          <ScopePicker
            unrestricted={datatablesUnrestricted}
            onUnrestrictedChange={(checked) => form.setValue("datatablesUnrestricted", checked)}
            items={datatableProjects}
            selectedIds={datatableProjectIds}
            onChange={(ids) => form.setValue("datatableProjectIds", ids)}
            getId={(item) => item.id}
            getLabel={(item) => item.name}
            searchPlaceholder="Search projects"
            emptyText="No datatable projects yet"
            unrestrictedHint="This key can read and write every datatable project, including ones created later."
          />
        ),
      },
      {
        type: EFormItemType.Custom,
        name: "kvEntryIds",
        label: "KV store",
        colSpan: 12,
        render: () => (
          <ScopePicker
            unrestricted={kvUnrestricted}
            onUnrestrictedChange={(checked) => form.setValue("kvUnrestricted", checked)}
            items={kvEntries}
            selectedIds={kvEntryIds}
            onChange={(ids) => form.setValue("kvEntryIds", ids)}
            getId={(item) => item.id}
            getLabel={(item) => item.key}
            searchPlaceholder="Search keys"
            emptyText="No KV entries yet"
            unrestrictedHint="This key can read and write every KV entry, including ones created later."
            renderItem={(item) => <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-foreground">{item.key}</span>}
          />
        ),
      },
    ],
    [datatableProjectIds, datatableProjects, datatablesUnrestricted, form, kvEntries, kvEntryIds, kvUnrestricted],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    setSaving(true);
    const payload = {
      name: values.name.trim(),
      datatablesUnrestricted: values.datatablesUnrestricted,
      datatableProjectIds: values.datatableProjectIds,
      kvUnrestricted: values.kvUnrestricted,
      kvEntryIds: values.kvEntryIds,
    };
    try {
      if (isEdit && edit) {
        const updated = await apiClient.put<ApiKey>(`/api/api-keys/${edit.id}`, payload);
        onUpdated(updated);
      } else {
        const created = await apiClient.post<ApiKey>("/api/api-keys", payload);
        onCreated(created);
      }
    } catch (err: unknown) {
      form.setError("root", { message: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Modal open title={isEdit ? "Edit API key" : "New API key"} onCancel={onClose} onOk={() => void onSubmit()} okText={isEdit ? "Save" : "Create"} confirmLoading={saving} destroyOnHidden width={560} styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}>
      <form onSubmit={onSubmit} className="pt-2">
        <SchemaForm form={form} items={items} />
        {rootError ? <div className="text-[12px] font-medium text-destructive">{rootError}</div> : null}
      </form>
    </Modal>
  );
}
