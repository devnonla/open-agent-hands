import { join } from "node:path";
import { getDataDir } from "./data-dir.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function safe(id: string, label: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid ${label} id: ${id}`);
  return id;
}

export function toolSandboxDir(toolId: string): string {
  return join(getDataDir(), "tools", safe(toolId, "tool"));
}

export function siteDir(siteId: string): string {
  return join(getDataDir(), "sites", safe(siteId, "site"));
}

export function jobRunDir(runId: string): string {
  return join(getDataDir(), "job_runs", safe(runId, "run"));
}

export function storageSpaceDir(spaceId: string): string {
  return join(getDataDir(), "storage", safe(spaceId, "space"));
}

export function storageFilePath(spaceId: string, fileId: string): string {
  return join(storageSpaceDir(spaceId), safe(fileId, "file"));
}
