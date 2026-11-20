import type { Context, Next } from "hono";
import { DEFAULT_WORKSPACE_ID } from "../db/schema.js";
import { NotFoundException } from "../exceptions/http.exception.js";
import { parseCookieValue } from "../middleware/auth.middleware.js";
import { workspaceExists } from "../../modules/workspaces/workspaces.service.js";
import { runInWorkspace, workspaceIdOrNull } from "./workspace-context.js";

export const WORKSPACE_HEADER = "x-workspace-id";
export const WORKSPACE_COOKIE = "agenthands_workspace";

export async function resolveWorkspace(c: Context, next: Next) {
  if (workspaceIdOrNull()) return next();
  const requested = c.req.header(WORKSPACE_HEADER)?.trim() || c.req.query("workspaceId")?.trim() || parseCookieValue(c.req.header("Cookie"), WORKSPACE_COOKIE)?.trim() || DEFAULT_WORKSPACE_ID;
  if (!(await workspaceExists(requested))) throw new NotFoundException("Workspace not found");
  await runInWorkspace(requested, () => next());
}
