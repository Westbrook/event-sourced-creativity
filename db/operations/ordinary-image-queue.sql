-- Optional, default-off companion queue migration. No historical enrollment.
-- Rows are ownership tombstones: never delete to fall back to browser execution.
CREATE TABLE IF NOT EXISTS ordinary_image_outbox (
  job_id TEXT PRIMARY KEY REFERENCES document_jobs(job_id),
  owner_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  next_check_at TEXT NOT NULL,
  recovery_checks INTEGER NOT NULL DEFAULT 0 CHECK(recovery_checks BETWEEN 0 AND 3),
  closed_at TEXT,
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS ordinary_image_outbox_due ON ordinary_image_outbox(closed_at,next_check_at);
