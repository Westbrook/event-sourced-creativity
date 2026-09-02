-- Offline-only proposal. NOT in drizzle's journal and NOT applied by the application.
-- Each breakpoint delimits one D1 prepared statement; the local harness applies all in one transaction.
CREATE TABLE memory_shadow_schema (
  version INTEGER PRIMARY KEY CHECK (version = 1),
  migration_hash TEXT NOT NULL,
  isolation TEXT NOT NULL CHECK (isolation = 'synthetic-only')
);
--> statement-breakpoint
CREATE TABLE memory_shadow_partitions (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  privacy_generation INTEGER NOT NULL DEFAULT 0 CHECK (privacy_generation >= 0),
  PRIMARY KEY (actor_user_id, custodian_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_atomic_guards (
  guard_id TEXT PRIMARY KEY NOT NULL,
  verified INTEGER NOT NULL CHECK (verified = 1)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_sources (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, source_id TEXT NOT NULL,
  document_scope_id TEXT NOT NULL,
  source_json TEXT NOT NULL, expires_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active','erased','revoked','redacted','held-only')),
  CHECK (json_valid(source_json) AND json_extract(source_json,'$.id')=source_id AND json_extract(source_json,'$.state')=state),
  PRIMARY KEY (actor_user_id, custodian_id, source_id),
  FOREIGN KEY (actor_user_id, custodian_id) REFERENCES memory_shadow_partitions(actor_user_id, custodian_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_observations (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, source_id TEXT NOT NULL,
  observation_json TEXT NOT NULL,
  PRIMARY KEY (actor_user_id, custodian_id, source_id),
  FOREIGN KEY (actor_user_id, custodian_id, source_id) REFERENCES memory_shadow_sources(actor_user_id, custodian_id, source_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_records (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, record_id TEXT NOT NULL,
  scope_id TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
  state TEXT NOT NULL CHECK (state IN ('active','superseded','erased')),
  expires_at TEXT NOT NULL, metadata_json TEXT NOT NULL,
  CHECK (json_valid(metadata_json) AND json_type(metadata_json,'$.body') IS NULL
    AND json_extract(metadata_json,'$.id')=record_id AND json_extract(metadata_json,'$.version')=version
    AND json_extract(metadata_json,'$.state')=state),
  PRIMARY KEY (actor_user_id, custodian_id, record_id),
  FOREIGN KEY (actor_user_id, custodian_id) REFERENCES memory_shadow_partitions(actor_user_id, custodian_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_private_bodies (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, record_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) BETWEEN 1 AND 8192),
  PRIMARY KEY (actor_user_id, custodian_id, record_id),
  FOREIGN KEY (actor_user_id, custodian_id, record_id) REFERENCES memory_shadow_records(actor_user_id, custodian_id, record_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_dependencies (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, record_id TEXT NOT NULL,
  source_id TEXT NOT NULL, lineage_id TEXT NOT NULL,
  PRIMARY KEY (actor_user_id, custodian_id, record_id, source_id),
  FOREIGN KEY (actor_user_id, custodian_id, record_id) REFERENCES memory_shadow_records(actor_user_id, custodian_id, record_id),
  FOREIGN KEY (actor_user_id, custodian_id, source_id) REFERENCES memory_shadow_sources(actor_user_id, custodian_id, source_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_segments (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, record_id TEXT NOT NULL,
  coverage_json TEXT NOT NULL CHECK (json_valid(coverage_json) AND json_type(coverage_json,'$.record') IS NULL AND json_type(coverage_json,'$.body') IS NULL),
  PRIMARY KEY (actor_user_id, custodian_id, record_id),
  FOREIGN KEY (actor_user_id, custodian_id, record_id) REFERENCES memory_shadow_records(actor_user_id, custodian_id, record_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_suppressions (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, suppression_id TEXT NOT NULL,
  suppression_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (actor_user_id, custodian_id, suppression_id),
  FOREIGN KEY (actor_user_id, custodian_id) REFERENCES memory_shadow_partitions(actor_user_id, custodian_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_watermarks (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, scope_id TEXT NOT NULL,
  recipe_version TEXT NOT NULL, stream_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  PRIMARY KEY (actor_user_id, custodian_id, scope_id, recipe_version, stream_id),
  FOREIGN KEY (actor_user_id, custodian_id) REFERENCES memory_shadow_partitions(actor_user_id, custodian_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_reviews (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, review_id TEXT NOT NULL,
  scope_id TEXT NOT NULL, recipe_version TEXT NOT NULL, plan_json TEXT NOT NULL,
  inventory_hash TEXT NOT NULL, output_hash TEXT NOT NULL, committed_at TEXT NOT NULL,
  PRIMARY KEY (actor_user_id, custodian_id, review_id),
  FOREIGN KEY (actor_user_id, custodian_id) REFERENCES memory_shadow_partitions(actor_user_id, custodian_id)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_index_outbox (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, intent_id TEXT NOT NULL,
  record_id TEXT NOT NULL, record_version INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  generation INTEGER NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (actor_user_id, custodian_id, intent_id),
  FOREIGN KEY (actor_user_id, custodian_id, record_id) REFERENCES memory_shadow_records(actor_user_id, custodian_id, record_id)
);
--> statement-breakpoint
CREATE TRIGGER memory_shadow_sources_no_resurrection BEFORE UPDATE ON memory_shadow_sources
WHEN (OLD.state!='active' AND NEW.state='active') OR NEW.expires_at>OLD.expires_at
BEGIN
  SELECT RAISE(ABORT,'retired_memory_source');
END;
--> statement-breakpoint
CREATE TRIGGER memory_shadow_records_no_resurrection BEFORE UPDATE ON memory_shadow_records
WHEN OLD.state='erased' AND NEW.state!='erased'
BEGIN
  SELECT RAISE(ABORT,'retired_memory_record');
END;
