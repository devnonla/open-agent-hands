/**
 * FE-side type definitions — plain TypeScript, no Drizzle ORM.
 * These mirror the server DB schema and are used for typing API responses.
 */

// ─── Tool Folders ─────────────────────────────────────────────────────────────

export interface ToolFolder {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
}

export type NewToolFolder = Omit<ToolFolder, "id" | "createdAt">;

// ─── Custom Tools ─────────────────────────────────────────────────────────────

export interface AgentTool {
  id: string;
  name: string;
  label: string;
  description: string;
  icon?: string;
  parameters: object;
  codeContent: string;
  draftCode?: string | null;
  folderId?: string | null;
  sortOrder?: number;
  /** Workspace admin builtins. Hidden from user-agent config. Still listed on Builtin Tools. */
  workspaceOnly?: boolean;
  /** Builtin that stays on for every agent. Shown in the Builtin Tools list. */
  alwaysOn?: boolean;
  createdAt: Date;
}

export type NewAgentTool = Omit<AgentTool, "id" | "createdAt">;

export interface MyMcpServerTool {
  id: string;
  name: string;
  label: string;
  description: string;
}

export interface MyMcpServer {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  toolCount: number;
  keyPrefix: string;
  lastUsedAt: Date | string | null;
  createdAt: Date;
  updatedAt: Date;
  tools: MyMcpServerTool[];
  key?: string;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  name: string;
  avatar: string | null;
  theme?: "system" | "light" | "dark" | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NewUser = Omit<User, "id" | "createdAt" | "updatedAt"> & {
  password: string;
};

// ─── KV Store ─────────────────────────────────────────────────────────────────

export interface KvStoreEntry {
  id: string;
  key: string;
  value: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Secrets ──────────────────────────────────────────────────────────────────

export interface SecretEntry {
  id: string;
  key: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Datatables ───────────────────────────────────────────────────────────────

export type DatatableColumnType = "text" | "number" | "boolean" | "datetime" | "select" | "json";

export interface DatatableProject {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatatableTable {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatatableColumn {
  id: string;
  tableId: string;
  name: string;
  type: DatatableColumnType;
  options: string[] | null;
  required: boolean;
  sortOrder: number;
  createdAt: Date;
}

export interface DatatableRow {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export type JobRunStatus = "running" | "success" | "failed";
export type JobRunTrigger = "cron" | "manual";
export type JobLogLevel = "info" | "warn" | "error" | "system" | "step";
export type JobLogKind = "step" | "log" | "system" | "console";

export interface JobLogEntry {
  t: number;
  level: JobLogLevel;
  message: string;
  duration?: number;
  kind?: JobLogKind;
}

export interface Job {
  id: string;
  name: string;
  description: string | null;
  code: string;
  draftCode?: string | null;
  cron: string;
  enabled: boolean;
  status?: "scheduled" | "paused" | "manual";
  nextRuns?: string[];
  timeoutMs: number;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobRun {
  id: string;
  jobId: string;
  status: JobRunStatus;
  trigger: JobRunTrigger;
  logs: JobLogEntry[];
  error: string | null;
  instanceId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

// ─── API Keys ────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  datatablesUnrestricted: boolean;
  datatableProjectIds: string[];
  kvUnrestricted: boolean;
  kvEntryIds: string[];
  createdBy: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  key?: string;
}

export type SiteSourceFile = "app.tsx" | "backend.ts" | "styles.css" | "package.json";

export interface Site {
  id: string;
  name: string;
  slug: string;
  isPublished: boolean;
  hasPublicPassword?: boolean;
  depsStatus: string;
  depsError: string | null;
  draftDepsStatus: string;
  draftDepsError: string | null;
  draftUpdatedAt: Date | null;
  draftDirty?: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SiteFilesResponse {
  tree: "draft" | "prod";
  files: Record<SiteSourceFile, string>;
  draftDirty: boolean;
}
