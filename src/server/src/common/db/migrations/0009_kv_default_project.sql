INSERT OR IGNORE INTO kv_projects (id, name) VALUES ('default', 'default');

UPDATE kv_store
  SET key = key || '_' || upper(substr(id, 1, 6))
  WHERE project_id IS NULL
    AND EXISTS (SELECT 1 FROM kv_store o JOIN kv_projects p ON p.id = o.project_id WHERE p.name = 'default' AND o.key = kv_store.key);

CREATE TABLE kv_store_new (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL DEFAULT 'default' REFERENCES kv_projects(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  description TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (project_id, key)
);
INSERT INTO kv_store_new (id, project_id, key, value, description, created_at, updated_at)
  SELECT id, coalesce(project_id, (SELECT id FROM kv_projects WHERE name = 'default')), key, value, description, created_at, updated_at FROM kv_store;
DROP TABLE kv_store;
ALTER TABLE kv_store_new RENAME TO kv_store;

CREATE INDEX idx_kv_store_project ON kv_store (project_id);
