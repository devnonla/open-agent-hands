import { type SQL, eq } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { currentWorkspaceId } from "./workspace-context.js";

export function inWorkspace(column: SQLiteColumn): SQL {
  return eq(column, currentWorkspaceId());
}
