CREATE TABLE IF NOT EXISTS tool_folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agent_tools (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  description  TEXT NOT NULL,
  icon         TEXT,
  parameters   TEXT NOT NULL DEFAULT '{"type":"object","properties":{},"required":[]}',
  code_content TEXT NOT NULL,
  draft_code   TEXT,
  folder_id    TEXT REFERENCES tool_folders(id) ON DELETE SET NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS configurations (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  avatar        TEXT,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at  INTEGER
);

CREATE TABLE IF NOT EXISTS kv_store (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS secrets (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS datatable_projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS datatable_tables (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES datatable_projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS datatable_columns (
  id         TEXT PRIMARY KEY,
  table_id   TEXT NOT NULL REFERENCES datatable_tables(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  options    TEXT,
  required   INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (table_id, name)
);

CREATE TABLE IF NOT EXISTS datatable_rows (
  id         TEXT PRIMARY KEY,
  table_id   TEXT NOT NULL REFERENCES datatable_tables(id) ON DELETE CASCADE,
  data       TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  code        TEXT NOT NULL DEFAULT '',
  draft_code  TEXT,
  cron        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,
  timeout_ms  INTEGER NOT NULL DEFAULT 300000,
  next_run_at INTEGER,
  last_run_at INTEGER,
  lease_owner TEXT,
  lease_until INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS job_runs (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'running',
  trigger     TEXT NOT NULL DEFAULT 'cron',
  logs        TEXT NOT NULL DEFAULT '',
  error       TEXT,
  instance_id TEXT,
  started_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS api_keys (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  key_prefix               TEXT NOT NULL,
  key_hash                 TEXT NOT NULL UNIQUE,
  created_by               TEXT NOT NULL,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at             INTEGER,
  revoked_at               INTEGER,
  datatables_unrestricted  INTEGER NOT NULL DEFAULT 0,
  kv_unrestricted          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_key_datatable_projects (
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES datatable_projects(id) ON DELETE CASCADE,
  PRIMARY KEY (api_key_id, project_id)
);

CREATE TABLE IF NOT EXISTS api_key_kv_entries (
  api_key_id  TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  kv_entry_id TEXT NOT NULL REFERENCES kv_store(id) ON DELETE CASCADE,
  PRIMARY KEY (api_key_id, kv_entry_id)
);

CREATE TABLE IF NOT EXISTS my_mcp_servers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  key_prefix   TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS my_mcp_server_tools (
  server_id TEXT NOT NULL REFERENCES my_mcp_servers(id) ON DELETE CASCADE,
  tool_id   TEXT NOT NULL REFERENCES agent_tools(id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

CREATE INDEX IF NOT EXISTS idx_datatable_tables_project ON datatable_tables(project_id);

CREATE INDEX IF NOT EXISTS idx_datatable_columns_table ON datatable_columns(table_id);

CREATE INDEX IF NOT EXISTS idx_datatable_rows_table ON datatable_rows(table_id);

CREATE INDEX IF NOT EXISTS idx_jobs_enabled_next_run ON jobs(enabled, next_run_at);

CREATE INDEX IF NOT EXISTS idx_jobs_lease_until ON jobs(lease_until);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs(job_id);

CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

CREATE INDEX IF NOT EXISTS idx_api_key_datatable_projects_project ON api_key_datatable_projects(project_id);

CREATE INDEX IF NOT EXISTS idx_api_key_kv_entries_kv ON api_key_kv_entries(kv_entry_id);

CREATE INDEX IF NOT EXISTS idx_my_mcp_servers_key_hash ON my_mcp_servers(key_hash);

CREATE INDEX IF NOT EXISTS idx_my_mcp_server_tools_tool ON my_mcp_server_tools(tool_id);
