import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

export function bindToId(opts: { name: string; description: string; idLabel: string; inputSchema: z.ZodObject; make: (id: string) => StructuredToolInterface }): StructuredToolInterface {
  const schema = opts.inputSchema.extend({ id: z.string().describe(opts.idLabel) });
  return tool(
    async (input: Record<string, unknown>) => {
      const { id, ...rest } = input;
      const cleanId = typeof id === "string" ? id.trim() : "";
      if (!cleanId) return JSON.stringify({ ok: false, error: "'id' is required" });
      try {
        const result = await opts.make(cleanId).invoke(rest);
        return typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    },
    { name: opts.name, description: opts.description, schema },
  );
}

export function renameTool(base: StructuredToolInterface, name: string): StructuredToolInterface {
  return tool(async (input: Record<string, unknown>) => base.invoke(input), { name, description: base.description, schema: base.schema as z.ZodObject });
}
