import { Button, EFormItemType, Modal, SchemaForm, type TFormItemProps, message, Icon } from "devnonla-ui";
import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { KvProject } from "src/common/types";
import { useAppDispatch } from "src/store/store";
import { updateKvProject } from "../common/kvProjectsSlice";

type ProjectValues = { name: string; description: string };

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const ITEMS: TFormItemProps[] = [
  {
    type: EFormItemType.Input,
    name: "name",
    label: "Name",
    colSpan: 12,
    rules: {
      required: "Enter a project name",
      validate: (value) => (typeof value === "string" && NAME_RE.test(value.trim()) ? true : "Use lowercase letters, digits, - or _ (e.g. crm, daily-report)"),
    },
    options: { placeholder: "crm", autoComplete: "off" },
  },
  {
    type: EFormItemType.Input,
    name: "description",
    label: "Description",
    colSpan: 12,
    options: { placeholder: "What these keys are for", autoComplete: "off" },
  },
];

export function KvProjectDialog({ project, onClose, onSaved, onDelete }: { project: KvProject | null; onClose: () => void; onSaved: (project: KvProject) => void; onDelete: (project: KvProject) => void }) {
  const dispatch = useAppDispatch();
  const open = !!project;
  const [saving, setSaving] = useState(false);
  const form = useForm<ProjectValues>({ defaultValues: { name: "", description: "" }, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;

  useEffect(() => {
    if (!open) return;
    form.reset({ name: project?.name ?? "", description: project?.description ?? "" });
    setSaving(false);
    const t = window.setTimeout(() => form.setFocus("name"), 150);
    return () => window.clearTimeout(t);
  }, [open, project, form]);

  const onSubmit = form.handleSubmit(async ({ name, description }) => {
    if (!project) return;
    setSaving(true);
    try {
      const saved = (await dispatch(updateKvProject({ id: project.id, name: name.trim(), description: description.trim() || null })).unwrap()) as KvProject;
      message.success("Project updated");
      onSaved(saved);
      onClose();
    } catch (err) {
      form.setError("root", { message: err instanceof Error ? err.message : "Failed to save the project" });
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
          <div className="flex h-field-sm w-field-sm shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
            <Settings size={16} />
          </div>
          <span className="truncate font-semibold text-foreground">Project settings</span>
        </div>
      }
      width={440}
      centered
      destroyOnHidden
      footer={
        <div className="flex w-full items-center justify-end gap-2.5">
          <Button type="text" size="medium" onClick={onClose}>
            Cancel
          </Button>
          <Button type="primary" size="medium" htmlType="submit" form="kv-project-form" loading={saving}>
            Save
          </Button>
        </div>
      }
    >
      <form id="kv-project-form" className="pt-4" onSubmit={onSubmit}>
        <SchemaForm form={form} items={ITEMS} />
        <p className="m-0 mt-3 text-xs text-tertiary-foreground">
          Code reads it with <code className="font-mono">agenthands.kv.project("{form.watch("name") || "crm"}")</code>.
        </p>
        {rootError ? <div className="mt-3 text-xs leading-snug text-destructive">{rootError}</div> : null}
      </form>
      {project ? (
        <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-destructive/30 px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Delete this project</div>
            <div className="text-xs text-muted-foreground">Its keys are deleted too. This cannot be undone.</div>
          </div>
          <Button
            danger
            size="small"
            icon={<Icon name="trash" size={14} />}
            onClick={() => {
              onClose();
              onDelete(project);
            }}
          >
            Delete
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
