CREATE TEMP TABLE ws_tag AS
  SELECT id,
         name AS label,
         lower(replace(replace(replace(replace(trim(name), ' ', '_'), '-', '_'), '.', '_'), '/', '_')) AS tag
  FROM workspaces;

UPDATE agent_tools
  SET name = name || '_' || coalesce((SELECT tag FROM ws_tag WHERE ws_tag.id = agent_tools.workspace_id), substr(workspace_id, 1, 8))
  WHERE workspace_id <> 'default'
    AND EXISTS (SELECT 1 FROM agent_tools o WHERE o.name = agent_tools.name AND o.workspace_id <> agent_tools.workspace_id);
UPDATE agent_tools
  SET name = name || '_' || substr(id, 1, 6)
  WHERE EXISTS (SELECT 1 FROM agent_tools o WHERE o.name = agent_tools.name AND o.rowid < agent_tools.rowid);

UPDATE kv_store
  SET key = key || '_' || upper(coalesce((SELECT tag FROM ws_tag WHERE ws_tag.id = kv_store.workspace_id), substr(workspace_id, 1, 8)))
  WHERE workspace_id <> 'default'
    AND EXISTS (SELECT 1 FROM kv_store o WHERE o.key = kv_store.key AND o.workspace_id <> kv_store.workspace_id);
UPDATE kv_store
  SET key = key || '_' || upper(substr(id, 1, 6))
  WHERE EXISTS (SELECT 1 FROM kv_store o WHERE o.key = kv_store.key AND o.rowid < kv_store.rowid);

UPDATE secrets
  SET key = key || '_' || upper(coalesce((SELECT tag FROM ws_tag WHERE ws_tag.id = secrets.workspace_id), substr(workspace_id, 1, 8)))
  WHERE workspace_id <> 'default'
    AND EXISTS (SELECT 1 FROM secrets o WHERE o.key = secrets.key AND o.workspace_id <> secrets.workspace_id);
UPDATE secrets
  SET key = key || '_' || upper(substr(id, 1, 6))
  WHERE EXISTS (SELECT 1 FROM secrets o WHERE o.key = secrets.key AND o.rowid < secrets.rowid);

UPDATE datatable_projects
  SET name = name || ' (' || coalesce((SELECT label FROM ws_tag WHERE ws_tag.id = datatable_projects.workspace_id), substr(workspace_id, 1, 8)) || ')'
  WHERE workspace_id <> 'default'
    AND EXISTS (SELECT 1 FROM datatable_projects o WHERE o.name = datatable_projects.name AND o.workspace_id <> datatable_projects.workspace_id);
UPDATE datatable_projects
  SET name = name || ' ' || substr(id, 1, 6)
  WHERE EXISTS (SELECT 1 FROM datatable_projects o WHERE o.name = datatable_projects.name AND o.rowid < datatable_projects.rowid);

UPDATE tool_folders
  SET name = name || ' (' || coalesce((SELECT label FROM ws_tag WHERE ws_tag.id = tool_folders.workspace_id), substr(workspace_id, 1, 8)) || ')'
  WHERE workspace_id <> 'default'
    AND EXISTS (SELECT 1 FROM tool_folders o WHERE o.name = tool_folders.name AND o.workspace_id <> tool_folders.workspace_id);

UPDATE my_mcp_servers
  SET name = name || ' (' || coalesce((SELECT label FROM ws_tag WHERE ws_tag.id = my_mcp_servers.workspace_id), substr(workspace_id, 1, 8)) || ')'
  WHERE workspace_id <> 'default'
    AND EXISTS (SELECT 1 FROM my_mcp_servers o WHERE o.name = my_mcp_servers.name AND o.workspace_id <> my_mcp_servers.workspace_id);

UPDATE jobs
  SET name = name || ' (' || coalesce((SELECT label FROM ws_tag WHERE ws_tag.id = jobs.workspace_id), substr(workspace_id, 1, 8)) || ')'
  WHERE workspace_id <> 'default'
    AND EXISTS (SELECT 1 FROM jobs o WHERE o.name = jobs.name AND o.workspace_id <> jobs.workspace_id);

UPDATE api_keys
  SET name = name || ' (' || coalesce((SELECT label FROM ws_tag WHERE ws_tag.id = api_keys.workspace_id), substr(workspace_id, 1, 8)) || ')'
  WHERE workspace_id <> 'default'
    AND EXISTS (SELECT 1 FROM api_keys o WHERE o.name = api_keys.name AND o.workspace_id <> api_keys.workspace_id);

DROP TABLE ws_tag;

CREATE TABLE agent_tools_new (
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
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO agent_tools_new (id, name, label, description, icon, parameters, code_content, draft_code, folder_id, sort_order, created_at)
  SELECT id, name, label, description, icon, parameters, code_content, draft_code, folder_id, sort_order, created_at FROM agent_tools;
DROP TABLE agent_tools;
ALTER TABLE agent_tools_new RENAME TO agent_tools;

CREATE TABLE kv_store_new (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO kv_store_new (id, key, value, description, created_at, updated_at)
  SELECT id, key, value, description, created_at, updated_at FROM kv_store;
DROP TABLE kv_store;
ALTER TABLE kv_store_new RENAME TO kv_store;

CREATE TABLE secrets_new (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO secrets_new (id, key, value, description, created_at, updated_at)
  SELECT id, key, value, description, created_at, updated_at FROM secrets;
DROP TABLE secrets;
ALTER TABLE secrets_new RENAME TO secrets;

CREATE TABLE datatable_projects_new (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO datatable_projects_new (id, name, created_at, updated_at)
  SELECT id, name, created_at, updated_at FROM datatable_projects;
DROP TABLE datatable_projects;
ALTER TABLE datatable_projects_new RENAME TO datatable_projects;

DROP INDEX IF EXISTS idx_tool_folders_workspace;
DROP INDEX IF EXISTS idx_my_mcp_servers_workspace;
DROP INDEX IF EXISTS idx_jobs_workspace;
DROP INDEX IF EXISTS idx_sites_workspace;
DROP INDEX IF EXISTS idx_api_keys_workspace;

ALTER TABLE tool_folders DROP COLUMN workspace_id;
ALTER TABLE my_mcp_servers DROP COLUMN workspace_id;
ALTER TABLE jobs DROP COLUMN workspace_id;
ALTER TABLE sites DROP COLUMN workspace_id;
ALTER TABLE api_keys DROP COLUMN workspace_id;

DROP TABLE workspaces;
