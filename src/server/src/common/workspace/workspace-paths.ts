import { join } from "node:path";
import { getDataDir } from "../utils/data-dir.js";
import { currentWorkspaceId } from "./workspace-context.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function safe(id: string, label: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid ${label} id: ${id}`);
  return id;
}

export function workspacesRootDir(): string {
  return join(getDataDir(), "workspaces");
}

export function workspaceDir(workspaceId: string = currentWorkspaceId()): string {
  return join(workspacesRootDir(), safe(workspaceId, "workspace"));
}

export function toolSandboxDir(toolId: string, workspaceId?: string): string {
  return join(workspaceDir(workspaceId), "tools", safe(toolId, "tool"));
}

export function siteDir(siteId: string, workspaceId?: string): string {
  return join(workspaceDir(workspaceId), "sites", safe(siteId, "site"));
}

export function jobRunDir(runId: string, workspaceId?: string): string {
  return join(workspaceDir(workspaceId), "job_runs", safe(runId, "run"));
}
