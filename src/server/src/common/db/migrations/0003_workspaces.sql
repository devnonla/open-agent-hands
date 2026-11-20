CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO workspaces (id, name) VALUES ('default', 'Default');

ALTER TABLE tool_folders ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE my_mcp_servers ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE jobs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE sites ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE api_keys ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';

CREATE TABLE agent_tools_new (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name         TEXT NOT NULL,
  label        TEXT NOT NULL,
  description  TEXT NOT NULL,
  icon         TEXT,
  parameters   TEXT NOT NULL DEFAULT '{"type":"object","properties":{},"required":[]}',
  code_content TEXT NOT NULL,
  draft_code   TEXT,
  folder_id    TEXT REFERENCES tool_folders(id) ON DELETE SET NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (workspace_id, name)
);
INSERT INTO agent_tools_new (id, name, label, description, icon, parameters, code_content, draft_code, folder_id, sort_order, is_active, created_at)
  SELECT id, name, label, description, icon, parameters, code_content, draft_code, folder_id, sort_order, is_active, created_at FROM agent_tools;
DROP TABLE agent_tools;
ALTER TABLE agent_tools_new RENAME TO agent_tools;

CREATE TABLE kv_store_new (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  description  TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (workspace_id, key)
);
INSERT INTO kv_store_new (id, key, value, description, created_at, updated_at)
  SELECT id, key, value, description, created_at, updated_at FROM kv_store;
DROP TABLE kv_store;
ALTER TABLE kv_store_new RENAME TO kv_store;

CREATE TABLE secrets_new (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  description  TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (workspace_id, key)
);
INSERT INTO secrets_new (id, key, value, description, created_at, updated_at)
  SELECT id, key, value, description, created_at, updated_at FROM secrets;
DROP TABLE secrets;
ALTER TABLE secrets_new RENAME TO secrets;

CREATE TABLE datatable_projects_new (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (workspace_id, name)
);
INSERT INTO datatable_projects_new (id, name, created_at, updated_at)
  SELECT id, name, created_at, updated_at FROM datatable_projects;
DROP TABLE datatable_projects;
ALTER TABLE datatable_projects_new RENAME TO datatable_projects;

CREATE INDEX IF NOT EXISTS idx_tool_folders_workspace ON tool_folders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_tools_workspace ON agent_tools(workspace_id);
CREATE INDEX IF NOT EXISTS idx_my_mcp_servers_workspace ON my_mcp_servers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_kv_store_workspace ON kv_store(workspace_id);
CREATE INDEX IF NOT EXISTS idx_secrets_workspace ON secrets(workspace_id);
CREATE INDEX IF NOT EXISTS idx_datatable_projects_workspace ON datatable_projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sites_workspace ON sites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);
