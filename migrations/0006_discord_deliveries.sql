CREATE TABLE discord_deliveries (
  notice_id TEXT PRIMARY KEY REFERENCES notices (notice_id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX discord_deliveries_due ON discord_deliveries (next_attempt_at) WHERE sent_at IS NULL;
CREATE INDEX notices_discovered_at ON notices (discovered_at);
