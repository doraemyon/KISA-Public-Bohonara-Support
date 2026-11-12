ALTER TABLE applications ADD COLUMN solution_account TEXT;

CREATE TABLE application_prompts (
  chat_id TEXT PRIMARY KEY,
  prompted_at TEXT NOT NULL
);

CREATE INDEX application_prompts_by_time ON application_prompts (prompted_at);
