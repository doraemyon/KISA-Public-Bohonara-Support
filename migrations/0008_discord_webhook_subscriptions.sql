CREATE TABLE discord_signup_states (
  state_hash TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE discord_webhook_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL UNIQUE,
  sealed_webhook TEXT NOT NULL,
  name TEXT,
  requested_at TEXT NOT NULL,
  notify_after TEXT NOT NULL,
  notified_at TEXT,
  approved_at TEXT
);

CREATE INDEX discord_webhook_pending ON discord_webhook_subscriptions (notify_after) WHERE approved_at IS NULL;

CREATE TABLE discord_webhook_deliveries (
  subscription_id INTEGER NOT NULL REFERENCES discord_webhook_subscriptions (id) ON DELETE CASCADE,
  notice_id TEXT NOT NULL REFERENCES notices (notice_id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (subscription_id, notice_id)
);

CREATE INDEX discord_webhook_due ON discord_webhook_deliveries (next_attempt_at) WHERE sent_at IS NULL;
