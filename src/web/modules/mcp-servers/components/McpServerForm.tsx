import { Button, EFormItemType, SchemaForm, type TFormItemProps, message } from "devnonla-ui";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import type { McpServer } from "src/common/types";
import { useAppDispatch } from "src/store/store";
import { createMcpServer, updateMcpServer } from "../common/mcpServersSlice";

type HeaderRow = { key: string; value: string };

function headersToRows(headers: Record<string, string> | null | undefined): HeaderRow[] {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) return [{ key: "", value: "" }];
  return entries.map(([key, value]) => ({ key, value }));
}

function rowsToHeaders(rows: HeaderRow[] | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!Array.isArray(rows)) return headers;
  for (const row of rows) {
    const key = String(row?.key ?? "").trim();
    if (!key) continue;
    headers[key] = String(row?.value ?? "");
  }
  return headers;
}

type McpValues = {
  name: string;
  url: string;
  headers: HeaderRow[];
};

export function McpServerForm({
  edit,
  onCancel,
  onSaved,
}: {
  edit?: McpServer | null;
  onCancel?: () => void;
  onSaved: (server: McpServer) => void;
}) {
  const dispatch = useAppDispatch();
  const isEdit = !!edit;
  const [saving, setSaving] = useState(false);
  const form = useForm<McpValues>({
    defaultValues: { name: edit?.name ?? "", url: edit?.url ?? "", headers: headersToRows(edit?.headers) },
    mode: "onSubmit",
  });
  const rootError = form.formState.errors.root?.message;

  const items: TFormItemProps[] = useMemo(
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
        options: { placeholder: "my-server", autoFocus: true },
      },
      {
        type: EFormItemType.Input,
        name: "url",
        label: "URL",
        colSpan: 12,
        rules: {
          required: "URL is required",
          validate: (value) => (typeof value === "string" && value.trim() ? true : "URL is required"),
        },
        options: { placeholder: "http://localhost:3000/mcp" },
      },
      {
        type: EFormItemType.Repeater,
        name: "headers",
        label: "Headers",
        colSpan: 12,
        childItems: [
          {
            type: EFormItemType.Input,
            name: "key",
            colSpan: 5,
            defaultValue: "",
            options: { placeholder: "Authorization" },
          },
          {
            type: EFormItemType.Input,
            name: "value",
            colSpan: 7,
            defaultValue: "",
            options: { placeholder: "Bearer …" },
          },
        ],
      },
    ],
    [],
  );

  const onSubmit = form.handleSubmit(async ({ name, url, headers }) => {
    setSaving(true);
    try {
      const payload = { name: name.trim(), url: url.trim(), headers: rowsToHeaders(headers) };
      const saved = isEdit && edit ? ((await dispatch(updateMcpServer({ id: edit.id, ...payload })).unwrap()) as McpServer) : ((await dispatch(createMcpServer(payload)).unwrap()) as McpServer);
      message.success(isEdit ? "Updated" : "Created");
      onSaved(saved);
    } catch (err: unknown) {
      form.setError("root", { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <p className="m-0 text-sm text-foreground/70">Connect over HTTP. Optional headers are used for auth.</p>
      <SchemaForm form={form} items={items} />
      {rootError ? <p className="m-0 text-sm text-destructive">{rootError}</p> : null}
      <div className="flex items-center gap-2">
        {onCancel ? (
          <Button type="default" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="primary" htmlType="submit" loading={saving}>
          {isEdit ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
