-- Operational state. The Obsidian vault is the source of truth for
-- tasks, decisions, and briefs. This DB holds only transient state:
-- pending approvals, recent message history for context, and cron logs.

CREATE TABLE IF NOT EXISTS approvals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  summary       TEXT NOT NULL,
  operation     TEXT NOT NULL,     -- e.g. 'delete_task', 'overwrite_file', 'bulk_update'
  payload_json  TEXT NOT NULL,     -- JSON of the pending operation
  diff_preview  TEXT,              -- human-readable diff
  resolved_at   TEXT,
  resolved_by   TEXT               -- 'user' | 'system' | 'expired'
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL,
  channel       TEXT NOT NULL,     -- 'cli' | 'http' | 'whatsapp'
  direction     TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  role          TEXT NOT NULL,     -- 'user' | 'assistant' | 'system'
  content       TEXT NOT NULL,
  meta_json     TEXT               -- arbitrary per-message metadata
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS cron_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name      TEXT NOT NULL,     -- 'daily_brief' | 'weekly_review' | 'deadline_sweep'
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_job ON cron_runs(job_name, started_at);

CREATE TABLE IF NOT EXISTS kv (
  k             TEXT PRIMARY KEY,
  v             TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Idempotency for inbound webhooks. Meta retries delivery if it doesn't
-- get a 200 within seconds; without dedup we'd run the agent loop twice
-- (or more) on the same message. INSERT OR IGNORE on the external_id PK
-- gives us a cheap "already processed" check.
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  external_id   TEXT PRIMARY KEY,    -- Meta's wamid for the message
  source        TEXT NOT NULL,       -- 'whatsapp' for now
  created_at    TEXT NOT NULL
);
