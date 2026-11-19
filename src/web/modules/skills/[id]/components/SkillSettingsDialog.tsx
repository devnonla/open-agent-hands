import { Button, EFormItemType, Modal, Popconfirm, SchemaForm, type TFormItemProps, message } from "devnonla-ui";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { Skill } from "src/common/types";
import { useAppDispatch } from "src/store/store";
import { updateSkill } from "../../common/skillsSlice";

type SkillSettingsValues = {
  name: string;
  description: string;
};

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
    options: { placeholder: "Code Review", autoComplete: "off" },
  },
  {
    type: EFormItemType.Textarea,
    name: "description",
    label: "Description",
    colSpan: 12,
    rules: {
      required: "Description is required",
      validate: (value) => (typeof value === "string" && value.trim() ? true : "Description is required"),
    },
    options: { placeholder: "When to use this skill (injected into the agent prompt)", rows: 3 },
  },
];

interface SkillSettingsDialogProps {
  skill: Skill;
  onClose: () => void;
  onSaved: (updated: Skill) => void;
  onDelete: () => Promise<void>;
}

export function SkillSettingsDialog({ skill, onClose, onSaved, onDelete }: SkillSettingsDialogProps) {
  const dispatch = useAppDispatch();
  const [saving, setSaving] = useState(false);
  const form = useForm<SkillSettingsValues>({ defaultValues: { name: skill.name, description: skill.description }, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;

  const onSubmit = form.handleSubmit(async ({ name, description }) => {
    setSaving(true);
    try {
      const updated = (await dispatch(updateSkill({ id: skill.id, name: name.trim(), description: description.trim() })).unwrap()) as Skill;
      message.success("Saved");
      onSaved(updated);
      onClose();
    } catch (err: unknown) {
      form.setError("root", { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Modal open title="Skill settings" onCancel={onClose} onOk={() => void onSubmit()} confirmLoading={saving} okText="Save" destroyOnHidden>
      <form onSubmit={onSubmit}>
        <SchemaForm form={form} items={ITEMS} />
        {rootError ? <p className="mb-0 mt-2 text-sm text-destructive">{rootError}</p> : null}
      </form>

      <div className="mt-6 border-t border-border-subtle pt-4">
        <p className="m-0 text-[11px] font-medium text-muted-foreground">Danger zone</p>
        <p className="mb-3 mt-1 text-xs text-tertiary-foreground">Permanently delete this skill and all its references. This cannot be undone.</p>
        <Popconfirm title={`Delete "${skill.name}"?`} description="This action cannot be undone." okText="Delete" okType="danger" cancelText="Cancel" onConfirm={() => void onDelete()}>
          <Button size="small" danger icon={<Trash2 size={14} />}>
            Delete skill
          </Button>
        </Popconfirm>
      </div>
    </Modal>
  );
}
