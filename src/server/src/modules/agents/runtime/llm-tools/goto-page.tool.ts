/**
 * goto_page — Nonla Bot asks the browser to open an app screen.
 * The tool only returns the path. The panel navigates.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { appPathForGoto } from "../../../nonla-bot/nonla-page.js";

export function makeGotoPageTool(): StructuredToolInterface {
  return tool(
    async (input: { path?: string }) => {
      const path = appPathForGoto(input.path ?? "");
      if (!path) {
        return JSON.stringify({
          ok: false,
          error: "That path is not a screen in this app.",
          hint: "Use a path like /tools/{id}, /agents/{id}/canvas, /agents/{id}/chat, /skills/{id}, /sites/{id}, /jobs/{id}, or /datatables/{id}.",
        });
      }
      return JSON.stringify({ ok: true, path });
    },
    {
      name: "nonla_goto_page",
      description: `Use when a tool or manager result has a page path and the user is not on that page. Opens that screen in the app.
Pass path, an in-app route. Examples: /tools/{id} (tool editor), /agents/{id}/canvas, /agents/{id}/chat, /skills/{id}, /sites/{id}, /jobs/{id}, /datatables/{id}, /datatables/{id}/schema, /kvstore, /secrets.
Use a real id from a previous tool result.`,
      schema: z.object({
        path: z.string().describe("App path to open, starting with /."),
      }),
    },
  );
}
