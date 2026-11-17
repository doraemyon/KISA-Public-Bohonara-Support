CREATE TABLE discord_applications (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  name TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  approving INTEGER NOT NULL DEFAULT 0 CHECK (approving IN (0, 1)),
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX discord_applications_pending ON discord_applications (guild_id, requested_at);
