-- ppeng-agent-core cloud / hybrid DDL (run against DATABASE_URL once per environment)

CREATE TABLE IF NOT EXISTS ppeng_event_buffer_meta (
  tenant_id    TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  status       TEXT,
  task_content TEXT,
  sequence     INT NOT NULL DEFAULT 0,
  agent_id     TEXT,
  saved_at     BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, session_id)
);

CREATE TABLE IF NOT EXISTS ppeng_event_buffer_events (
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  seq         INT NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  PRIMARY KEY (tenant_id, user_id, session_id, seq)
);

CREATE INDEX IF NOT EXISTS ppeng_ebe_session ON ppeng_event_buffer_events (tenant_id, user_id, session_id);

CREATE TABLE IF NOT EXISTS ppeng_skill_catalog (
  id            TEXT PRIMARY KEY,
  version       TEXT NOT NULL DEFAULT '',
  sha256        TEXT NOT NULL DEFAULT '',
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  download_url  TEXT,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ppeng_agent_catalog (
  id          TEXT PRIMARY KEY,
  version     TEXT NOT NULL DEFAULT '',
  spec        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
