import { Button, EFormItemType, SchemaForm, type TFormItemProps } from "devnonla-ui";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { apiClient, clearAuthToken, getAuthToken, setAuthToken } from "src/common/api";
import type { User } from "src/common/types";
import { AuthError, AuthShell } from "./components/AuthShell";
type LoginValues = {
  username: string;
  password: string;
};

const ITEMS: TFormItemProps[] = [
  {
    type: EFormItemType.Input,
    name: "username",
    label: "Username",
    colSpan: 12,
    rules: {
      required: "Username is required",
      validate: (value) => (typeof value === "string" && value.trim() ? true : "Username is required"),
    },
    options: { placeholder: "Enter your username", autoComplete: "username", autoFocus: true },
  },
  {
    type: EFormItemType.Input,
    name: "password",
    label: "Password",
    colSpan: 12,
    rules: { required: "Password is required" },
    options: { type: "password", placeholder: "Enter your password", autoComplete: "current-password" },
  },
];

const EMPTY: LoginValues = { username: "", password: "" };

export default function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const form = useForm<LoginValues>({ defaultValues: EMPTY, mode: "onSubmit" });
  const rootError = form.formState.errors.root?.message;

  useEffect(() => {
    const check = async () => {
      try {
        const status = await apiClient.get<{ needsSetup: boolean }>("/api/auth/setup-status");
        if (status.needsSetup) {
          navigate("/setup", { replace: true });
          return;
        }

        const token = getAuthToken();
        if (token) {
          try {
            await apiClient.get("/api/auth/me");
            navigate("/", { replace: true });
            return;
          } catch {
            clearAuthToken();
          }
        }
      } catch {
        /* show login form */
      } finally {
        setChecking(false);
      }
    };
    check();
  }, [navigate]);

  const onSubmit = form.handleSubmit(async ({ username, password }) => {
    setLoading(true);
    try {
      const result = await apiClient.post<{ token: string; refreshToken: string; user: User }>("/api/auth/login", {
        username,
        password,
      });
      setAuthToken(result.token, result.refreshToken);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      form.setError("root", { message: err instanceof Error ? err.message : "Login failed" });
    } finally {
      setLoading(false);
    }
  });

  if (checking) return null;

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to watch what your agents build.">
      <form onSubmit={onSubmit}>
        <SchemaForm form={form} items={ITEMS} />
        <AuthError message={rootError} />
        <Button htmlType="submit" type="primary" size="large" block loading={loading}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
