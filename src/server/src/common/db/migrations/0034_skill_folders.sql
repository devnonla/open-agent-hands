CREATE TABLE IF NOT EXISTS skill_folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

ALTER TABLE skills ADD COLUMN folder_id TEXT REFERENCES skill_folders(id) ON DELETE SET NULL;
