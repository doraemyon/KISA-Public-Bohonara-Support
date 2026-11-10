CREATE TABLE IF NOT EXISTS applications (
  chat_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  admin_notified_at TEXT,
  notify_attempts INTEGER NOT NULL DEFAULT 0 CHECK (notify_attempts >= 0),
  next_notify_at TEXT NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS applications_pending_notification
  ON applications (status, admin_notified_at, next_notify_at);

CREATE INDEX IF NOT EXISTS applications_requested_at
  ON applications (requested_at);
