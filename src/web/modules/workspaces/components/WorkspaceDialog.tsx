import { Button, EFormItemType, Modal, SchemaForm, type TFormItemProps } from "devnonla-ui";
import { Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { type Workspace, createWorkspace, updateWorkspace } from "../common/workspacesApi";

type WorkspaceValues = { name: string; description: string };

const ITEMS: TFormItemProps[] = [
  {
    type: EFormItemType.Input,
    name: "name",
    label: "Name",
    colSpan: 12,
    rules: {
      required: "Please enter a workspace name",
      validate: (value) => (typeof value === "string" && value.trim() ? true : "Please enter a workspace name"),
    },
    options: { placeholder: "e.g. Personal, Client A…", autoComplete: "off" },
  },
  {
    type: EFormItemType.Input,
    name: "description",
    label: "Description",
    colSpan: 12,
    options: { placeholder: "Optional", autoComplete: "off" },
  },
];

export function WorkspaceDialog({ open, workspace, onClose, onSaved }: { open: boolean; workspace?: Workspace | null; onClose: () => void; onSaved: (workspace: Workspace) => void }) {
  const isEdit = !!workspace;
  const [saving, setSaving] = useState(false);
  const form = useForm<WorkspaceValues>({ defaultValues: { name: "", description: "" }, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;

  useEffect(() => {
    if (!open) return;
    form.reset({ name: workspace?.name ?? "", description: workspace?.description ?? "" });
    setSaving(false);
    const t = window.setTimeout(() => form.setFocus("name"), 150);
    return () => window.clearTimeout(t);
  }, [open, workspace, form]);

  const onSubmit = form.handleSubmit(async ({ name, description }) => {
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null };
      const saved = isEdit && workspace ? await updateWorkspace(workspace.id, body) : await createWorkspace(body);
      onSaved(saved);
      onClose();
    } catch (err) {
      form.setError("root", { message: err instanceof Error ? err.message : "Failed to save workspace" });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-field-sm w-field-sm shrink-0 items-center justify-center rounded-lg bg-muted/60">
            <div className="text-[14px] leading-none text-muted-foreground">{isEdit ? <Pencil size={16} /> : <Plus size={16} />}</div>
          </div>
          <span className="truncate font-semibold text-foreground">{isEdit ? "Edit workspace" : "New workspace"}</span>
        </div>
      }
      width={420}
      centered
      destroyOnHidden
      footer={
        <div className="flex justify-end gap-2.5">
          <Button type="text" size="medium" onClick={onClose}>
            Cancel
          </Button>
          <Button type="primary" size="medium" htmlType="submit" form="workspace-form" loading={saving}>
            {isEdit ? "Save" : "Create workspace"}
          </Button>
        </div>
      }
    >
      <form id="workspace-form" onSubmit={onSubmit}>
        <SchemaForm form={form} items={ITEMS} />
        {rootError ? (
          <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
            <p className="text-xs font-medium text-destructive">{rootError}</p>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
