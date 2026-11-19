ALTER TABLE llm_providers ADD COLUMN model_meta TEXT NOT NULL DEFAULT '{}';

ALTER TABLE agent_conversations ADD COLUMN summary_cut_message_id TEXT;
ALTER TABLE agent_conversations ADD COLUMN summary_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_conversations ADD COLUMN summary_tokens INTEGER;
ALTER TABLE agent_conversations ADD COLUMN compact_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_conversations ADD COLUMN compact_retry_at INTEGER;
ALTER TABLE agent_conversations ADD COLUMN compacting_since INTEGER;
ALTER TABLE agent_conversations ADD COLUMN context_anchor TEXT;

CREATE TABLE IF NOT EXISTS agent_usage_events (
  id                      TEXT PRIMARY KEY,
  conversation_id         TEXT,
  run_id                  TEXT,
  agent_id                TEXT,
  provider_id             TEXT,
  provider_type           TEXT,
  model_id                TEXT,
  purpose                 TEXT NOT NULL DEFAULT 'chat',
  input_tokens            INTEGER NOT NULL DEFAULT 0,
  output_tokens           INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens      INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens        INTEGER NOT NULL DEFAULT 0,
  estimated_input_tokens  INTEGER,
  suspicious              INTEGER NOT NULL DEFAULT 0,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch())
);
