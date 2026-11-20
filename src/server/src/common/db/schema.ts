import { sql } from "drizzle-orm";
import { boolCol, integer, jsonCol, primaryKey, sqlNow, sqliteTable, text, tsCol } from "./columns.js";

// ─── Workspaces ───────────────────────────────────────────────────────────────

export const DEFAULT_WORKSPACE_ID = "default";

export const workspaces = sqliteTable("workspaces", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type Workspace = typeof workspaces.$inferSelect;

const workspaceIdCol = () => text("workspace_id").notNull().default(DEFAULT_WORKSPACE_ID);

// ─── Tool Folders ─────────────────────────────────────────────────────────────

export const toolFolders = sqliteTable("tool_folders", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: workspaceIdCol(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolCol("is_active").notNull().default(true),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
});

export type ToolFolder = typeof toolFolders.$inferSelect;
export type NewToolFolder = typeof toolFolders.$inferInsert;

// ─── Custom Tools ─────────────────────────────────────────────────────────────

export const agentTools = sqliteTable("agent_tools", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: workspaceIdCol(),
  name: text("name").notNull(),
  label: text("label").notNull(),
  description: text("description").notNull(),
  /** SVG markup (Iconify Lucide) shown next to the tool name in the UI */
  icon: text("icon"),
  parameters: jsonCol("parameters").$type<object>().notNull().default(sql`'{"type":"object","properties":{},"required":[]}'`),
  codeContent: text("code_content").notNull(),
  /** AI draft code — written by edit_code tool. null = no pending draft. */
  draftCode: text("draft_code"),
  /** Optional folder for grouping in the Tools UI */
  folderId: text("folder_id").references(() => toolFolders.id, {
    onDelete: "set null",
  }),
  /** Order within folder (or ungrouped when folderId is null) */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
});

export type AgentTool = typeof agentTools.$inferSelect;
export type NewAgentTool = typeof agentTools.$inferInsert;

// ─── App Settings ─────────────────────────────────────────────────────────────

export const appSettings = sqliteTable("configurations", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type AppSetting = typeof appSettings.$inferSelect;

// ─── Users ────────────────────────────────────────────────────────────────────
// User accounts for authentication and authorization.

export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull().unique(),
  name: text("name").notNull().default(""),
  avatar: text("avatar"),
  passwordHash: text("password_hash").notNull(),
  theme: text("theme"),
  isActive: boolCol("is_active").notNull().default(true),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ─── Refresh Tokens ───────────────────────────────────────────────────────────

export const refreshTokens = sqliteTable("refresh_tokens", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: tsCol("expires_at").notNull(),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  revokedAt: tsCol("revoked_at"),
});

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

// ─── KV Store ─────────────────────────────────────────────────────────────────

export const kvStore = sqliteTable("kv_store", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: workspaceIdCol(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  description: text("description"),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type KvStoreEntry = typeof kvStore.$inferSelect;
export type NewKvStoreEntry = typeof kvStore.$inferInsert;

// ─── Secrets ──────────────────────────────────────────────────────────────────

export const secrets = sqliteTable("secrets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: workspaceIdCol(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  description: text("description"),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type SecretEntry = typeof secrets.$inferSelect;
export type NewSecretEntry = typeof secrets.$inferInsert;

// ─── Datatables ───────────────────────────────────────────────────────────────

export const COLUMN_TYPES = ["text", "number", "boolean", "datetime", "select", "json"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const datatableProjects = sqliteTable("datatable_projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: workspaceIdCol(),
  name: text("name").notNull(),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type DatatableProject = typeof datatableProjects.$inferSelect;
export type NewDatatableProject = typeof datatableProjects.$inferInsert;

export const datatableTables = sqliteTable("datatable_tables", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => datatableProjects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type DatatableTable = typeof datatableTables.$inferSelect;
export type NewDatatableTable = typeof datatableTables.$inferInsert;

export const datatableColumns = sqliteTable("datatable_columns", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tableId: text("table_id")
    .notNull()
    .references(() => datatableTables.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().$type<ColumnType>(),
  options: jsonCol("options").$type<string[] | null>(),
  required: boolCol("required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
});

export type DatatableColumn = typeof datatableColumns.$inferSelect;
export type NewDatatableColumn = typeof datatableColumns.$inferInsert;

export const datatableRows = sqliteTable("datatable_rows", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tableId: text("table_id")
    .notNull()
    .references(() => datatableTables.id, { onDelete: "cascade" }),
  data: jsonCol("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type DatatableRow = typeof datatableRows.$inferSelect;
export type NewDatatableRow = typeof datatableRows.$inferInsert;

// ─── Sites ────────────────────────────────────────────────────────────────────

export const sites = sqliteTable("sites", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: workspaceIdCol(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isPublished: boolCol("is_published").notNull().default(false),
  publicPassword: text("public_password"),
  depsStatus: text("deps_status").notNull().default("ready"),
  depsError: text("deps_error"),
  draftDepsStatus: text("draft_deps_status").notNull().default("ready"),
  draftDepsError: text("draft_deps_error"),
  draftUpdatedAt: tsCol("draft_updated_at"),
  createdBy: text("created_by"),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;

// ─── Jobs (global cron + Bun/TS scripts) ──────────────────────────────────────

export const JOB_RUN_STATUSES = ["running", "success", "failed"] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

export const JOB_RUN_TRIGGERS = ["cron", "manual"] as const;
export type JobRunTrigger = (typeof JOB_RUN_TRIGGERS)[number];

export const jobs = sqliteTable("jobs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: workspaceIdCol(),
  name: text("name").notNull(),
  description: text("description"),
  code: text("code").notNull().default(""),
  draftCode: text("draft_code"),
  cron: text("cron").notNull(),
  enabled: boolCol("enabled").notNull().default(false),
  timeoutMs: integer("timeout_ms").notNull().default(300_000),
  nextRunAt: tsCol("next_run_at"),
  lastRunAt: tsCol("last_run_at"),
  leaseOwner: text("lease_owner"),
  leaseUntil: tsCol("lease_until"),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export const jobRuns = sqliteTable("job_runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  status: text("status").notNull().$type<JobRunStatus>().default("running"),
  trigger: text("trigger").notNull().$type<JobRunTrigger>().default("cron"),
  logs: text("logs").notNull().default(""),
  error: text("error"),
  instanceId: text("instance_id"),
  startedAt: tsCol("started_at").notNull().default(sqlNow),
  finishedAt: tsCol("finished_at"),
});

export type JobRun = typeof jobRuns.$inferSelect;
export type NewJobRun = typeof jobRuns.$inferInsert;

// ─── API Keys ─────────────────────────────────────────────────────────────────

export const apiKeys = sqliteTable("api_keys", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: workspaceIdCol(),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdBy: text("created_by").notNull(),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  lastUsedAt: tsCol("last_used_at"),
  revokedAt: tsCol("revoked_at"),
  datatablesUnrestricted: boolCol("datatables_unrestricted").notNull().default(false),
  kvUnrestricted: boolCol("kv_unrestricted").notNull().default(false),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export const apiKeyDatatableProjects = sqliteTable(
  "api_key_datatable_projects",
  {
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => datatableProjects.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.apiKeyId, t.projectId] })],
);

export type ApiKeyDatatableProject = typeof apiKeyDatatableProjects.$inferSelect;

export const apiKeyKvEntries = sqliteTable(
  "api_key_kv_entries",
  {
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    kvEntryId: text("kv_entry_id")
      .notNull()
      .references(() => kvStore.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.apiKeyId, t.kvEntryId] })],
);

export type ApiKeyKvEntry = typeof apiKeyKvEntries.$inferSelect;

// ─── Hosted MCP servers ──────────────────

export const myMcpServers = sqliteTable("my_mcp_servers", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workspaceId: workspaceIdCol(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolCol("is_active").notNull().default(true),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  lastUsedAt: tsCol("last_used_at"),
  createdAt: tsCol("created_at").notNull().default(sqlNow),
  updatedAt: tsCol("updated_at").notNull().default(sqlNow),
});

export type MyMcpServer = typeof myMcpServers.$inferSelect;
export type NewMyMcpServer = typeof myMcpServers.$inferInsert;

export const myMcpServerTools = sqliteTable(
  "my_mcp_server_tools",
  {
    serverId: text("server_id")
      .notNull()
      .references(() => myMcpServers.id, { onDelete: "cascade" }),
    toolId: text("tool_id")
      .notNull()
      .references(() => agentTools.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.toolId] })],
);

export type MyMcpServerTool = typeof myMcpServerTools.$inferSelect;
