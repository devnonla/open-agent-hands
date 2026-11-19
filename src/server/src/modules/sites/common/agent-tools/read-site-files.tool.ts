import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { type SiteTree, readSourceFile } from "../../sites-fs.js";
import { SITE_EDITABLE_FILES, type SiteEditableFile } from "./edit-site-surface.tool.js";

export function makeReadSiteFilesTool(siteId: string) {
  return tool(
    async (input) => {
      const tree = (input.tree ?? "prod") as SiteTree;
      const file = input.file as SiteEditableFile;
      try {
        return readSourceFile(siteId, tree, file);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "read_site_files",
      description: 'Read one live site source file as plain text. Required: file ("app.tsx" | "styles.css" | "backend.ts"). Call before editing that file and whenever replace fails so old_string matches exact current text. tree defaults to "prod". npm packages auto-install from imports — do not edit package.json.',
      schema: z.object({
        file: z.enum(SITE_EDITABLE_FILES).describe('Which file to read: "app.tsx", "styles.css", or "backend.ts"'),
        tree: z.enum(["draft", "prod"]).optional(),
      }),
    },
  );
}
