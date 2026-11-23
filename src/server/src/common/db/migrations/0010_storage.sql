CREATE TABLE storage_spaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_public   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE storage_files (
  id           TEXT PRIMARY KEY,
  space_id     TEXT NOT NULL REFERENCES storage_spaces(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  size         INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  etag         TEXT,
  public_token TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (space_id, key)
);
CREATE INDEX idx_storage_files_space ON storage_files (space_id, key);

