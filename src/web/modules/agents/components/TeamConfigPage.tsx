import { Button, EFormItemType, Modal, SchemaForm, type TFormItemProps, message } from "devnonla-ui";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { FeatureIcon } from "src/components/FeatureIcon";
import { BUILTIN_TEAM_ID } from "src/modules/agents/common/builtinAgents";
import { type TeamWithMembers, deleteTeam, updateTeam } from "src/modules/agents/common/teamsSlice";
import { AgentsContentHeader, ContentBreadcrumb } from "src/modules/agents/components/ContentBreadcrumb";
import { useAppDispatch, useAppSelector } from "src/store/store";

type TeamValues = {
  name: string;
  description: string;
};

const ITEMS: TFormItemProps[] = [
  {
    type: EFormItemType.Input,
    name: "name",
    label: "Team name",
    colSpan: 12,
    rules: {
      required: "Please enter a team name",
      validate: (value) => (typeof value === "string" && value.trim() ? true : "Please enter a team name"),
    },
    options: { placeholder: "e.g. Backend Team, QA…", autoComplete: "off" },
  },
  {
    type: EFormItemType.Textarea,
    name: "description",
    label: "Description",
    colSpan: 12,
    options: { rows: 3, placeholder: "What this team is for" },
  },
];

export default function TeamConfigPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const teams = useAppSelector((s) => s.teams.teams) as TeamWithMembers[];
  const loading = useAppSelector((s) => s.teams.loading);
  const team = teams.find((item) => item.id === teamId) ?? null;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const form = useForm<TeamValues>({ defaultValues: { name: "", description: "" }, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;

  useEffect(() => {
    if (!team) return;
    form.reset({ name: team.name, description: team.description ?? "" });
  }, [team, form]);

  const onSubmit = form.handleSubmit(async ({ name, description }) => {
    if (!team) return;
    setSaving(true);
    try {
      await dispatch(updateTeam({ id: team.id, name: name.trim(), description: description.trim() || null })).unwrap();
      message.success("Team updated");
    } catch {
      form.setError("root", { message: "Failed to update team" });
    } finally {
      setSaving(false);
    }
  });

  const handleDelete = async () => {
    if (!team) return;
    setDeleting(true);
    try {
      await dispatch(deleteTeam(team.id)).unwrap();
      message.success("Team deleted");
      navigate("/agents");
    } catch {
      message.error("Failed to delete team");
      setDeleting(false);
    }
  };

  if (!team && loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!team) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Team not found</div>;
  }

  if (team.id === BUILTIN_TEAM_ID) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <AgentsContentHeader left={<ContentBreadcrumb items={[{ label: "Agents", to: "/agents", icon: <FeatureIcon name="agents" size={16} variant="sticker" /> }, { label: team.name }]} />} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl p-6">
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="m-0 text-sm font-semibold text-foreground">Built-in team</h2>
              <p className="mb-0 mt-1 text-sm text-muted-foreground">Name and agents come from code. A restart updates them. Chats stay.</p>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AgentsContentHeader left={<ContentBreadcrumb items={[{ label: "Agents", to: "/agents", icon: <FeatureIcon name="agents" size={16} variant="sticker" /> }, { label: team.name }]} />} />
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
            <h2 className="m-0 text-sm font-semibold text-foreground">Delete team</h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">Agents in this team stay. They just leave the team.</p>
            <Button
              danger
              disabled={deleting || saving}
              icon={<Trash2 size={14} />}
              onClick={() => {
                Modal.confirm({
                  title: "Delete team?",
                  content: `Delete "${team.name}"? Agents in this team will be unlinked.`,
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
    </div>
  );
}
