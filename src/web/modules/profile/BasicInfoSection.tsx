import { Button, EFormItemType, SchemaForm, type TFormItemProps, message } from "devnonla-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { apiClient } from "src/common/api";
import { fetchCurrentUser } from "src/common/authSlice";
import type { User } from "src/common/types";
import { SectionCard } from "src/components/SectionCard";
import { useAppDispatch } from "src/store/store";

interface BasicInfoSectionProps {
  user: User;
  avatar: string;
}

type BasicInfoValues = { username: string; name: string };

const ITEMS: TFormItemProps[] = [
  {
    type: EFormItemType.Input,
    name: "username",
    label: "Username",
    colSpan: 12,
    options: { disabled: true },
    helps: [{ text: "Username cannot be changed." }],
  },
  {
    type: EFormItemType.Input,
    name: "name",
    label: "Display Name",
    colSpan: 12,
    rules: { required: "Display name is required" },
    options: { placeholder: "Your full name" },
  },
];

export function BasicInfoSection({ user, avatar }: BasicInfoSectionProps) {
  const dispatch = useAppDispatch();
  const [saving, setSaving] = useState(false);
  const form = useForm<BasicInfoValues>({
    defaultValues: { username: user.username ?? "", name: user.name || "" },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async ({ name }) => {
    setSaving(true);
    try {
      await apiClient.patch("/api/auth/update-profile", { name: name.trim(), avatar });
      await dispatch(fetchCurrentUser()).unwrap();
      message.success("Profile updated successfully");
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  });

  return (
    <SectionCard
      title="Basic information"
      description="Your account name and how it appears to others."
      onSubmit={onSubmit}
      footer={
        <Button htmlType="submit" type="primary" loading={saving}>
          Save changes
        </Button>
      }
    >
      <SchemaForm form={form} items={ITEMS} />
    </SectionCard>
  );
}
