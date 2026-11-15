CREATE TABLE IF NOT EXISTS notice_documents (
  notice_id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  ko_html TEXT NOT NULL,
  en_html TEXT NOT NULL,
  ko_text TEXT NOT NULL,
  en_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notice_archive_index (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  digest TEXT NOT NULL,
  html TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notice_dispatch_attempts (
  notice_id TEXT PRIMARY KEY,
  retry_at TEXT NOT NULL
);
