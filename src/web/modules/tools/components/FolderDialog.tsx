import { Button, EFormItemType, Modal, SchemaForm, type TFormItemProps, message, Icon } from "devnonla-ui";
import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { useForm } from "react-hook-form";
import { useAppDispatch } from "src/store/store";
import { createToolFolder, updateToolFolder } from "../common/toolFoldersSlice";
import type { ToolFolderWithTools } from "../common/toolFoldersSlice";

interface FolderDialogProps {
  open: boolean;
  onClose: () => void;
  folder?: ToolFolderWithTools | null;
  onDelete?: (folder: ToolFolderWithTools) => void;
}

type FolderValues = {
  name: string;
};

const ITEMS: TFormItemProps[] = [
  {
    type: EFormItemType.Input,
    name: "name",
    label: "Folder Name",
    colSpan: 12,
    rules: {
      required: "Please enter a folder name",
      validate: (value) => (typeof value === "string" && value.trim() ? true : "Please enter a folder name"),
    },
    options: { placeholder: "e.g. Integrations, Scrapers…", autoComplete: "off" },
  },
];

export function FolderDialog({ open, onClose, folder, onDelete }: FolderDialogProps) {
  const dispatch = useAppDispatch();
  const isEdit = !!folder;
  const [saving, setSaving] = useState(false);
  const form = useForm<FolderValues>({ defaultValues: { name: "" }, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;

  useEffect(() => {
    if (!open) return;
    form.reset({ name: folder?.name ?? "" });
    setSaving(false);
    const t = window.setTimeout(() => form.setFocus("name"), 150);
    return () => window.clearTimeout(t);
  }, [open, folder, form]);

  const onSubmit = form.handleSubmit(async ({ name }) => {
    setSaving(true);
    try {
      if (isEdit && folder) {
        await dispatch(updateToolFolder({ id: folder.id, name: name.trim() })).unwrap();
        message.success("Folder updated");
      } else {
        await dispatch(createToolFolder({ name: name.trim() })).unwrap();
        message.success("Folder created");
      }
      onClose();
    } catch {
      form.setError("root", { message: isEdit ? "Failed to update folder" : "Failed to create folder" });
    } finally {
      setSaving(false);
    }
  });

  const icon = isEdit ? <Settings size={16} /> : <Icon name="add" size={16} />;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-field-sm w-field-sm shrink-0 items-center justify-center rounded-lg bg-muted/60">
            <div className="text-sm leading-none text-muted-foreground">{icon}</div>
          </div>
          <span className="truncate font-semibold text-foreground">{isEdit ? "Folder settings" : "New Folder"}</span>
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
          <Button type="primary" size="medium" htmlType="submit" form="folder-form" loading={saving}>
            {saving ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save" : "Create Folder"}
          </Button>
        </div>
      }
    >
      <form id="folder-form" className="pt-4" onSubmit={onSubmit}>
        <SchemaForm form={form} items={ITEMS} />
        {rootError ? <div className="mt-4 pl-2.75 text-xs leading-snug text-destructive">{rootError}</div> : null}
      </form>
      {isEdit && folder && onDelete ? (
        <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-destructive/30 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Delete this folder</div>
            <div className="text-xs text-muted-foreground">Its tools move to Ungrouped. No tool is deleted.</div>
          </div>
          <Button
            danger
            size="small"
            icon={<Icon name="trash" size={14} />}
            onClick={() =>
              Modal.confirm({
                title: `Delete folder "${folder.name}"?`,
                content: "Its tools move to Ungrouped.",
                okText: "Delete",
                okButtonProps: { danger: true },
                cancelText: "Cancel",
                onOk: () => {
                  onClose();
                  onDelete(folder);
                },
              })
            }
          >
            Delete
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
