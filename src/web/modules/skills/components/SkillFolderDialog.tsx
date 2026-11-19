import { Button, EFormItemType, Modal, Popover, SchemaForm, type TFormItemProps, message } from "devnonla-ui";
import { FolderPlus, Pencil } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useAppDispatch } from "src/store/store";
import { createSkillFolder, updateSkillFolder } from "../common/skillFoldersSlice";
import type { SkillFolderWithSkills } from "../common/skillFoldersSlice";

interface SkillFolderDialogProps {
  open: boolean;
  onClose: () => void;
  folder?: SkillFolderWithSkills | null;
}

type FolderValues = {
  name: string;
};

const ITEMS: TFormItemProps[] = [
  {
    type: EFormItemType.Input,
    name: "name",
    label: "Folder name",
    colSpan: 12,
    rules: {
      required: "Please enter a folder name",
      validate: (value) => (typeof value === "string" && value.trim() ? true : "Please enter a folder name"),
    },
    options: { placeholder: "e.g. Research, Writing…", autoComplete: "off" },
  },
];

export function NewFolderPopover({ children }: { children?: ReactNode }) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const form = useForm<FolderValues>({ defaultValues: { name: "" }, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;

  useEffect(() => {
    if (!open) return;
    form.reset({ name: "" });
    setSaving(false);
    const t = window.setTimeout(() => form.setFocus("name"), 150);
    return () => window.clearTimeout(t);
  }, [open, form]);

  const onSubmit = form.handleSubmit(async ({ name }) => {
    setSaving(true);
    try {
      await dispatch(createSkillFolder({ name: name.trim() })).unwrap();
      message.success("Folder created");
      setOpen(false);
    } catch (err: unknown) {
      form.setError("root", { message: err instanceof Error ? err.message : "Failed to create folder" });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      arrow
      contentClassName="w-96 max-w-none p-0"
      content={
        <form className="flex flex-col gap-3 p-4" onSubmit={onSubmit}>
          <SchemaForm form={form} items={ITEMS} />
          {rootError ? <div className="pl-0.5 text-xs leading-snug text-destructive">{rootError}</div> : null}
          <div className="flex justify-end gap-2">
            <Button type="text" size="medium" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="primary" size="medium" htmlType="submit" loading={saving}>
              {saving ? "Creating…" : "Create folder"}
            </Button>
          </div>
        </form>
      }
    >
      {children ?? (
        <Button type="default" icon={<FolderPlus size={16} />}>
          New folder
        </Button>
      )}
    </Popover>
  );
}

export function SkillFolderDialog({ open, onClose, folder }: SkillFolderDialogProps) {
  const dispatch = useAppDispatch();
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
    if (!folder) return;
    setSaving(true);
    try {
      await dispatch(updateSkillFolder({ id: folder.id, name: name.trim() })).unwrap();
      message.success("Folder updated");
      onClose();
    } catch (err: unknown) {
      form.setError("root", { message: err instanceof Error ? err.message : "Failed to update folder" });
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
            <div className="text-[14px] leading-none text-muted-foreground">
              <Pencil size={16} />
            </div>
          </div>
          <span className="truncate font-semibold text-foreground">Rename folder</span>
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
          <Button type="primary" size="medium" htmlType="submit" form="skill-folder-form" loading={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <form id="skill-folder-form" className="pt-4" onSubmit={onSubmit}>
        <SchemaForm form={form} items={ITEMS} />
        {rootError ? <div className="mt-4 pl-2.75 text-xs leading-snug text-destructive">{rootError}</div> : null}
      </form>
    </Modal>
  );
}
