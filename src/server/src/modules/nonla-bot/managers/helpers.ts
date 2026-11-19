import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { HttpException } from "../../../common/exceptions/http.exception.js";

export type Fields = Record<string, unknown>;

export function ok(result: unknown): string {
  return JSON.stringify({ ok: true, result });
}

export function fail(error: string): string {
  return JSON.stringify({ ok: false, error });
}

export function errorMessage(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function fieldsOf(input: { id?: string; name?: string; description?: string; body?: Fields }): Fields {
  return {
    ...(input.body ?? {}),
    ...(input.id ? { id: input.id } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
  };
}

export function requireId(fields: Fields): string {
  const id = text(fields.id);
  if (!id) throw new Error("'id' is required");
  return id;
}

export function requireName(fields: Fields): string {
  const name = text(fields.name);
  if (!name) throw new Error("'name' is required");
  return name;
}

export const MANAGE_SCHEMA = z.object({
  action: z.string().describe("list, get, create, update, delete"),
  id: z.string().optional().describe("Id for get, update, delete"),
  name: z.string().optional().describe("Name for create or update"),
  description: z.string().optional().describe("Short description"),
  body: z.record(z.string(), z.any()).optional().describe("Extra fields. Agent create: teamId, aiProvider, aiModel."),
});

export function makeManageTool(name: string, description: string, handle: (action: string, fields: Fields) => Promise<unknown>, schema: z.ZodType = MANAGE_SCHEMA): StructuredToolInterface {
  return tool(
    async (input: { action: string; id?: string; name?: string; description?: string; body?: Fields }) => {
      try {
        const action = text(input.action);
        if (!action) return fail("'action' is required");
        return ok(await handle(action, fieldsOf(input)));
      } catch (err) {
        return fail(errorMessage(err));
      }
    },
    { name, description, schema },
  );
}
