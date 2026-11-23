CREATE TABLE kv_projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE kv_store_new (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES kv_projects(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT INTO kv_store_new (id, key, value, description, created_at, updated_at)
  SELECT id, key, value, description, created_at, updated_at FROM kv_store;
DROP TABLE kv_store;
ALTER TABLE kv_store_new RENAME TO kv_store;

CREATE UNIQUE INDEX idx_kv_store_project_key ON kv_store (coalesce(project_id, ''), key);
CREATE INDEX idx_kv_store_project ON kv_store (project_id);
