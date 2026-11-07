PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS subscribers (
  chat_id TEXT PRIMARY KEY,
  joined_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_codes (
  code_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 20),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS invite_codes_active
  ON invite_codes (expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS notices (
  notice_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT '',
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  notice_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  sent_at TEXT,
  last_error TEXT,
  PRIMARY KEY (notice_id, chat_id),
  FOREIGN KEY (notice_id) REFERENCES notices (notice_id) ON DELETE CASCADE,
  FOREIGN KEY (chat_id) REFERENCES subscribers (chat_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS deliveries_pending
  ON deliveries (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
