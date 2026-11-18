ALTER TABLE discord_webhook_subscriptions ADD COLUMN name_state_hash TEXT;
ALTER TABLE discord_webhook_subscriptions ADD COLUMN name_expires_at TEXT;
CREATE UNIQUE INDEX discord_name_session ON discord_webhook_subscriptions (name_state_hash)
  WHERE name_state_hash IS NOT NULL;
