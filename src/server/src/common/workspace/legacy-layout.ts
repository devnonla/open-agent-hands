import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentTools, getDb, sites } from "../db/client.js";
import { qall } from "../db/query.js";
import { getDataDir } from "../utils/data-dir.js";
import { siteDir, toolSandboxDir } from "./workspace-paths.js";

function moveIfPresent(from: string, to: string): boolean {
  if (!existsSync(from) || existsSync(to)) return false;
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return true;
}

function removeIfEmpty(dir: string): void {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {}
}

export async function migrateLegacyDataLayout(): Promise<void> {
  const root = getDataDir();
  const legacySites = join(root, "sites");
  const legacyTools = join(root, "tool_envs");
  const legacyJobs = join(root, "job_workspaces");
  if (!existsSync(legacySites) && !existsSync(legacyTools) && !existsSync(legacyJobs)) return;

  const db = getDb();
  let moved = 0;

  if (existsSync(legacySites)) {
    for (const row of await qall(db.select({ id: sites.id, workspaceId: sites.workspaceId }).from(sites))) {
      if (moveIfPresent(join(legacySites, row.id), siteDir(row.id, row.workspaceId))) moved++;
    }
    removeIfEmpty(legacySites);
  }

  if (existsSync(legacyTools)) {
    for (const row of await qall(db.select({ id: agentTools.id, workspaceId: agentTools.workspaceId }).from(agentTools))) {
      if (moveIfPresent(join(legacyTools, row.id), toolSandboxDir(row.id, row.workspaceId))) moved++;
    }
    rmSync(legacyTools, { recursive: true, force: true });
  }

  if (existsSync(legacyJobs)) rmSync(legacyJobs, { recursive: true, force: true });

  if (moved > 0) console.log(`[data] moved ${moved} folder(s) into ${join(root, "workspaces")}`);
}
