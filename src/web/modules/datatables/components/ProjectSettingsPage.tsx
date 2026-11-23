import { Alert, Button, Card, EFormItemType, Empty, Modal, SchemaForm, Spin, type TFormItemProps, message, Icon } from "devnonla-ui";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { SectionCard } from "src/components/SectionCard";
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
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Empty bordered={false} icon={null} description="Project not found" />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 p-6">
        <SectionCard
          title="Project"
          onSubmit={onSubmit}
          footer={
            <Button type="primary" htmlType="submit" loading={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          }
        >
          <SchemaForm form={form} items={ITEMS} />
          {rootError ? <Alert type="error" showIcon message={rootError} /> : null}
        </SectionCard>

        <Card title="Danger zone">
          <Card.Item label="Delete project" description="All tables and rows in this project will be deleted.">
            <Button
              danger
              disabled={deleting || saving}
              icon={<Icon name="trash" size={14} />}
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
          </Card.Item>
        </Card>
      </div>
    </div>
  );
}
