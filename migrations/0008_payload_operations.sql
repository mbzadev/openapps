PRAGMA foreign_keys = ON;

-- These operational tables are managed by Payload in production. They are also
-- declared here with the same columns so Worker-only test databases and
-- disaster-recovery restores can apply the SQL migration chain independently.
-- Payload adds the staff relations in its own baseline migration.
CREATE TABLE IF NOT EXISTS payload_connector_configs (
  id INTEGER PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  transport TEXT NOT NULL,
  countries TEXT DEFAULT '[]',
  requests_per_minute NUMERIC DEFAULT 2,
  concurrency NUMERIC DEFAULT 2,
  health TEXT DEFAULT 'unknown',
  last_health_code TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  circuit_open_until TEXT,
  secret_status TEXT DEFAULT 'not-required',
  notes TEXT,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS payload_connector_configs_source_idx ON payload_connector_configs(source);
CREATE INDEX IF NOT EXISTS payload_connector_configs_enabled_idx ON payload_connector_configs(enabled);
CREATE INDEX IF NOT EXISTS payload_connector_configs_health_idx ON payload_connector_configs(health);
CREATE INDEX IF NOT EXISTS payload_connector_configs_updated_at_idx ON payload_connector_configs(updated_at);
CREATE INDEX IF NOT EXISTS payload_connector_configs_created_at_idx ON payload_connector_configs(created_at);

CREATE TABLE IF NOT EXISTS payload_connector_configs_capabilities (
  "order" INTEGER NOT NULL,
  parent_id INTEGER NOT NULL,
  value TEXT,
  id INTEGER PRIMARY KEY NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES payload_connector_configs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS payload_connector_configs_capabilities_order_idx ON payload_connector_configs_capabilities("order");
CREATE INDEX IF NOT EXISTS payload_connector_configs_capabilities_parent_idx ON payload_connector_configs_capabilities(parent_id);

CREATE TABLE IF NOT EXISTS payload_task_attempts (
  id INTEGER PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  attempt NUMERIC NOT NULL,
  status TEXT NOT NULL,
  source TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms NUMERIC,
  result_count NUMERIC,
  error_code TEXT,
  error_message TEXT,
  raw_r2_key TEXT,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE INDEX IF NOT EXISTS payload_task_attempts_task_id_idx ON payload_task_attempts(task_id);
CREATE INDEX IF NOT EXISTS payload_task_attempts_status_idx ON payload_task_attempts(status);
CREATE INDEX IF NOT EXISTS payload_task_attempts_source_idx ON payload_task_attempts(source);
CREATE INDEX IF NOT EXISTS payload_task_attempts_started_at_idx ON payload_task_attempts(started_at);
CREATE INDEX IF NOT EXISTS payload_task_attempts_updated_at_idx ON payload_task_attempts(updated_at);
CREATE INDEX IF NOT EXISTS payload_task_attempts_created_at_idx ON payload_task_attempts(created_at);

CREATE TABLE IF NOT EXISTS payload_dead_letters (
  id INTEGER PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT,
  status TEXT DEFAULT 'open',
  attempt_count NUMERIC NOT NULL,
  error_code TEXT,
  error_message TEXT NOT NULL,
  payload TEXT NOT NULL,
  raw_r2_key TEXT,
  failed_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by_id INTEGER,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS payload_dead_letters_task_id_idx ON payload_dead_letters(task_id);
CREATE INDEX IF NOT EXISTS payload_dead_letters_kind_idx ON payload_dead_letters(kind);
CREATE INDEX IF NOT EXISTS payload_dead_letters_source_idx ON payload_dead_letters(source);
CREATE INDEX IF NOT EXISTS payload_dead_letters_status_idx ON payload_dead_letters(status);
CREATE INDEX IF NOT EXISTS payload_dead_letters_failed_at_idx ON payload_dead_letters(failed_at);
CREATE INDEX IF NOT EXISTS payload_dead_letters_resolved_by_idx ON payload_dead_letters(resolved_by_id);
CREATE INDEX IF NOT EXISTS payload_dead_letters_updated_at_idx ON payload_dead_letters(updated_at);
CREATE INDEX IF NOT EXISTS payload_dead_letters_created_at_idx ON payload_dead_letters(created_at);

ALTER TABLE ad_app_links ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ad_app_links ADD COLUMN verified_by_id INTEGER;

INSERT OR IGNORE INTO payload_connector_configs
  (label,source,enabled,transport,countries,requests_per_minute,concurrency,health,secret_status,created_at,updated_at)
VALUES
  ('Apple Store','apple',1,'fetch','[]',20,10,'unknown','not-required',datetime('now'),datetime('now')),
  ('Google Play','google-play',1,'fetch','[]',10,5,'unknown','not-required',datetime('now'),datetime('now')),
  ('Meta Ads','meta',1,'api','[]',5,2,'unknown','missing',datetime('now'),datetime('now')),
  ('Google Ads','google',1,'browser-rendering','[]',2,2,'unknown','not-required',datetime('now'),datetime('now')),
  ('TikTok Ads','tiktok',1,'api','[]',2,2,'unknown','missing',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO payload_connector_configs_capabilities ("order",parent_id,value)
SELECT 1,id,'lookup' FROM payload_connector_configs WHERE source IN ('apple','google-play');
INSERT OR IGNORE INTO payload_connector_configs_capabilities ("order",parent_id,value)
SELECT 2,id,'search' FROM payload_connector_configs WHERE source IN ('apple','google-play');
INSERT OR IGNORE INTO payload_connector_configs_capabilities ("order",parent_id,value)
SELECT 3,id,'charts' FROM payload_connector_configs WHERE source IN ('apple','google-play');
INSERT OR IGNORE INTO payload_connector_configs_capabilities ("order",parent_id,value)
SELECT 1,id,'creatives' FROM payload_connector_configs WHERE source IN ('meta','google','tiktok');
INSERT OR IGNORE INTO payload_connector_configs_capabilities ("order",parent_id,value)
SELECT 2,id,'media' FROM payload_connector_configs WHERE source IN ('meta','google','tiktok');
