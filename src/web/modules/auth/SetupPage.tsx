/**
 * SetupPage — initial admin setup page.
 *
 * Shown when the app is freshly installed and no admin exists.
 * Creates the first admin account + sets system timezone.
 */

import { Button, EFormItemType, SchemaForm, type TFormItemProps, message } from "devnonla-ui";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { apiClient, setAuthToken } from "src/common/api";
import type { User } from "src/common/types";
import { AuthError, AuthShell } from "./components/AuthShell";
interface TimezoneItem {
  tz: string;
  offset: string;
}

type SetupValues = {
  name: string;
  username: string;
  password: string;
  confirmPassword: string;
  timezone: string;
};

const EMPTY: SetupValues = { name: "", username: "", password: "", confirmPassword: "", timezone: "" };

export default function SetupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [timezoneChoices, setTimezoneChoices] = useState<{ value: string; label: string }[]>([]);
  const form = useForm<SetupValues>({ defaultValues: EMPTY, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;

  useEffect(() => {
    apiClient
      .get<{ needsSetup: boolean }>("/api/auth/setup-status")
      .then((res) => {
        if (!res.needsSetup) {
          navigate("/login", { replace: true });
        }
      })
      .catch(() => {
        /* still show setup page */
      })
      .finally(() => setChecking(false));
  }, [navigate]);

  useEffect(() => {
    apiClient
      .get<TimezoneItem[]>("/api/settings/timezones")
      .then((items) => {
        setTimezoneChoices(items.map((item) => ({ value: item.tz, label: `${item.tz} (${item.offset})` })));
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (detected && items.some((i) => i.tz === detected)) {
          form.setValue("timezone", detected);
        }
      })
      .catch(() => {
        /* user can still select timezone */
      });
  }, [form]);

  const accountItems: TFormItemProps[] = useMemo(
    () => [
      {
        type: EFormItemType.Input,
        name: "name",
        label: "Name",
        colSpan: 12,
        rules: {
          required: "Name is required",
          validate: (value) => (typeof value === "string" && value.trim() ? true : "Name is required"),
        },
        options: { placeholder: "Your display name", autoComplete: "name", autoFocus: true, disabled: loading },
      },
      {
        type: EFormItemType.Input,
        name: "username",
        label: "Username",
        colSpan: 12,
        rules: {
          required: "Username is required",
          validate: (value) => (typeof value === "string" && value.trim() ? true : "Username is required"),
        },
        options: { placeholder: "Choose a username", autoComplete: "username", disabled: loading },
      },
      {
        type: EFormItemType.Input,
        name: "password",
        label: "Password",
        colSpan: 12,
        rules: {
          required: "Password is required",
          minLength: { value: 8, message: "Password must be at least 8 characters" },
        },
        options: { type: "password", placeholder: "At least 8 characters", autoComplete: "new-password", disabled: loading },
      },
      {
        type: EFormItemType.Input,
        name: "confirmPassword",
        label: "Confirm Password",
        colSpan: 12,
        rules: {
          required: "Please confirm your password",
          validate: (value, values) => value === (values as SetupValues).password || "Passwords do not match",
        },
        options: { type: "password", placeholder: "Re-enter your password", autoComplete: "new-password", disabled: loading },
      },
    ],
    [loading],
  );

  const timezoneItems: TFormItemProps[] = useMemo(
    () => [
      {
        type: EFormItemType.Select,
        name: "timezone",
        label: "Timezone",
        colSpan: 12,
        choices: timezoneChoices,
        rules: { required: "Please select a timezone" },
        options: { placeholder: "Select timezone...", searchable: true, disabled: loading },
      },
    ],
    [timezoneChoices, loading],
  );

  const onSubmit = form.handleSubmit(async ({ name, username, password, timezone }) => {
    setLoading(true);
    try {
      const result = await apiClient.post<{ token: string; refreshToken: string; user: User }>("/api/auth/setup", {
        username: username.trim(),
        name: name.trim(),
        password,
        timezone,
      });
      setAuthToken(result.token, result.refreshToken);
      message.success(`Welcome, ${result.user.name}! Setup complete.`);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      form.setError("root", { message: err instanceof Error ? err.message : "Setup failed" });
    } finally {
      setLoading(false);
    }
  });

  if (checking) return null;

  return (
    <AuthShell title="Set up Open Agent Hands" subtitle="Create your account and pick your timezone." className="max-w-110">
      <form onSubmit={onSubmit}>
        <div className="mb-1 flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">Account</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <SchemaForm form={form} items={accountItems} />

        <div className="mb-1 mt-2 flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">System</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <SchemaForm form={form} items={timezoneItems} />

        <AuthError message={rootError} />
        <Button htmlType="submit" type="primary" size="large" block loading={loading} className="mt-1">
          Complete Setup
        </Button>
      </form>
    </AuthShell>
  );
}
