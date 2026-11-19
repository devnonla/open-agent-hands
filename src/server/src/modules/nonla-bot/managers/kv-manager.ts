import type { StructuredToolInterface } from "@langchain/core/tools";
import { deleteKvByKey, deleteKvEntry, getKvByKey, getKvEntry, listKvEntries, updateKvEntry, upsertKvByKey } from "../../kvstore/kvstore.service.js";
import { deleteSecretByKey, getSecretValueByKey, listSecrets, updateSecret, upsertSecretByKey } from "../../secrets/secrets.service.js";
import { type Fields, makeManageTool, requireId, text } from "./helpers.js";

async function handleSecrets(action: string, fields: Fields): Promise<unknown> {
  if (action === "list") {
    const result = await listSecrets({ limit: "200" });
    return result.items.map((item) => ({ id: item.id, key: item.key, description: item.description }));
  }
  if (action === "get") {
    const key = text(fields.key).toUpperCase();
    if (!key) throw new Error("'key' is required");
    const value = await getSecretValueByKey(key);
    if (value == null) throw new Error(`Secret "${key}" not found`);
    return { key, value };
  }
  if (action === "set") {
    const key = text(fields.key).toUpperCase();
    if (!key) throw new Error("'key' is required");
    if (typeof fields.value !== "string" || !fields.value) throw new Error("'value' is required");
    const saved = await upsertSecretByKey({ key, value: fields.value });
    if (!saved) throw new Error("Failed to save secret");
    if (typeof fields.description === "string") {
      await updateSecret(saved.id, { description: text(fields.description) || null });
    }
    return { id: saved.id, key: saved.key };
  }
  if (action === "delete") {
    const key = text(fields.key).toUpperCase();
    if (!key) throw new Error("'key' is required");
    await deleteSecretByKey(key);
    return { deleted: key };
  }
  throw new Error(`Unknown secrets action "${action}". Use list, get, set, delete.`);
}

async function handleKv(action: string, fields: Fields): Promise<unknown> {
  if (action === "list") {
    const result = await listKvEntries({ limit: "200" });
    return result.items.map((item: { id: string; key: string; value: string; description?: string | null }) => ({
      id: item.id,
      key: item.key,
      value: item.value,
      description: item.description ?? "",
    }));
  }
  if (action === "get") {
    const key = text(fields.key).toUpperCase();
    const row = key ? await getKvByKey(key) : await getKvEntry(requireId(fields));
    if (!row) throw new Error(key ? `Key "${key}" not found` : "KV entry not found");
    return { id: row.id, key: row.key, value: row.value, description: row.description ?? "" };
  }
  if (action === "set") {
    const key = text(fields.key).toUpperCase();
    if (!key) throw new Error("'key' is required");
    if (typeof fields.value !== "string") throw new Error("'value' is required");
    const saved = await upsertKvByKey({ key, value: fields.value });
    if (!saved?.id) throw new Error("Failed to save KV entry");
    if (typeof fields.description === "string") {
      await updateKvEntry(saved.id, { description: text(fields.description) || null });
    }
    return { id: saved.id, key: saved.key };
  }
  if (action === "delete") {
    const key = text(fields.key).toUpperCase();
    if (key) {
      await deleteKvByKey(key);
      return { deleted: key };
    }
    const id = requireId(fields);
    await deleteKvEntry(id);
    return { deleted: id };
  }
  throw new Error(`Unknown kv action "${action}". Use list, get, set, delete.`);
}

export function makeManageKvTool(): StructuredToolInterface {
  return makeManageTool(
    "nonla_manage_kv_entries",
    `Add, edit, and delete KV entries.
Actions: list, get, set, delete.
key is UPPER_SNAKE, like BASE_URL.
set needs body.key and body.value. Optional body.description. set creates or updates.
get and delete accept body.key, or id.
List does return values.`,
    handleKv,
  );
}

export function makeManageSecretsTool(): StructuredToolInterface {
  return makeManageTool(
    "nonla_manage_secrets",
    `Add, edit, and delete secrets.
Actions: list, get, set, delete.
key is UPPER_SNAKE.
set needs body.key and body.value. Optional body.description.
list does not return values. get returns the value.
List before delete.`,
    handleSecrets,
  );
}

export function makeKvManagerTools(): StructuredToolInterface[] {
  return [makeManageKvTool(), makeManageSecretsTool()];
}
