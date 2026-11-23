import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDataDir } from "./data-dir.js";

function moveIfPresent(from: string, to: string): boolean {
  if (!existsSync(from) || existsSync(to)) return false;
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return true;
}

function childDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function migrateLegacyDataLayout(): void {
  const root = getDataDir();
  rmSync(join(root, "tool_envs"), { recursive: true, force: true });
  rmSync(join(root, "job_workspaces"), { recursive: true, force: true });

  const workspacesRoot = join(root, "workspaces");
  if (!existsSync(workspacesRoot)) return;

  let moved = 0;
  let kept = 0;
  for (const workspace of childDirs(workspacesRoot)) {
    const base = join(workspacesRoot, workspace);
    for (const siteId of childDirs(join(base, "sites"))) {
      if (moveIfPresent(join(base, "sites", siteId), join(root, "sites", siteId))) moved++;
      else kept++;
    }
  }

  if (kept > 0) {
    console.warn(`[data] ${kept} site folder(s) could not be moved out of ${workspacesRoot}; left in place`);
    return;
  }
  rmSync(workspacesRoot, { recursive: true, force: true });
  if (moved > 0) console.log(`[data] moved ${moved} site folder(s) out of ${workspacesRoot}`);
}
