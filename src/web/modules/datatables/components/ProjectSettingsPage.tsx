import { Button, EFormItemType, Modal, SchemaForm, type TFormItemProps, message } from "devnonla-ui";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "src/store/store";
import { type DatatableProjectListItem, deleteDatatableProject, updateDatatableProject } from "../common/datatableProjectsSlice";

type SettingsValues = { name: string };

const ITEMS: TFormItemProps[] = [
  {
    type: EFormItemType.Input,
    name: "name",
    label: "Name",
    colSpan: 12,
    rules: {
      required: "Name is required",
      validate: (value) => (typeof value === "string" && value.trim() ? true : "Name is required"),
    },
    options: { placeholder: "Project name", autoComplete: "off" },
  },
];

export function ProjectSettingsPage({ projectId, loading }: { projectId: string; loading: boolean }) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const projects = useAppSelector((s) => s.datatableProjects.items) as DatatableProjectListItem[];
  const project = projects.find((item) => item.id === projectId) ?? null;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const form = useForm<SettingsValues>({ defaultValues: { name: "" }, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;

  useEffect(() => {
    if (!project) return;
    form.reset({ name: project.name });
  }, [project, form]);

  const onSubmit = form.handleSubmit(async ({ name }) => {
    if (!project) return;
    setSaving(true);
    try {
      await dispatch(updateDatatableProject({ id: project.id, name: name.trim() })).unwrap();
      message.success("Saved");
    } catch (err: unknown) {
      form.setError("root", { message: typeof err === "string" ? err : err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  });

  const handleDelete = async () => {
    if (!project) return;
    setDeleting(true);
    try {
      await dispatch(deleteDatatableProject(project.id)).unwrap();
      message.success("Deleted");
      navigate("/datatables", { replace: true });
    } catch (err: unknown) {
      message.error(typeof err === "string" ? err : err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  if (!project && loading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Project not found</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
        <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-6">
          <SchemaForm form={form} items={ITEMS} />
          {rootError ? <div className="mt-4 text-xs leading-snug text-destructive">{rootError}</div> : null}
          <div className="mt-4 flex justify-end">
            <Button type="primary" htmlType="submit" loading={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>

        <section className="rounded-2xl border border-destructive/30 bg-card p-6">
          <h2 className="m-0 text-sm font-semibold text-foreground">Delete project</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">All tables and rows in this project will be deleted.</p>
          <Button
            danger
            disabled={deleting || saving}
            icon={<Trash2 size={14} />}
            onClick={() => {
              Modal.confirm({
                title: "Delete project?",
                content: `Delete "${project.name}"? All tables and rows in this project will be deleted.`,
                okText: "Delete",
                okType: "danger",
                onOk: handleDelete,
              });
            }}
          >
            Delete
          </Button>
        </section>
      </div>
    </div>
  );
}
