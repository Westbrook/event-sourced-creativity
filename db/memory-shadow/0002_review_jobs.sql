-- Isolated review orchestration only. Not in the application migration journal.
CREATE TABLE memory_shadow_job_schema (
  version INTEGER PRIMARY KEY CHECK(version=1),
  migration_hash TEXT NOT NULL,
  isolation TEXT NOT NULL CHECK(isolation='synthetic-only')
);
--> statement-breakpoint
CREATE TABLE memory_shadow_schedules (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, scope_id TEXT NOT NULL, recipe_version TEXT NOT NULL,
  time_zone TEXT NOT NULL, review_enabled INTEGER NOT NULL CHECK(review_enabled IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision>0), registered_at TEXT NOT NULL,
  last_admitted_at TEXT, last_local_day TEXT,
  next_maintenance_at TEXT NOT NULL, last_maintenance_at TEXT,
  maintenance_status TEXT NOT NULL DEFAULT 'unrun' CHECK(maintenance_status IN ('unrun','complete','deferred','error')),
  maintenance_erased INTEGER NOT NULL DEFAULT 0 CHECK(maintenance_erased>=0),
  PRIMARY KEY(actor_user_id,custodian_id,scope_id,recipe_version)
);
--> statement-breakpoint
CREATE TABLE memory_shadow_jobs (
  actor_user_id TEXT NOT NULL, custodian_id TEXT NOT NULL, scope_id TEXT NOT NULL, recipe_version TEXT NOT NULL,
  job_id TEXT NOT NULL, plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND json_type(plan_json,'$.body') IS NULL),
  local_day TEXT NOT NULL, schedule_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','retry','completed','cancelled','failed')),
  max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 5),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND max_attempts),
  available_at TEXT NOT NULL, admitted_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
  lease_token TEXT, lease_expires_at TEXT,
  failure_code TEXT CHECK(failure_code IS NULL OR failure_code IN ('source-unavailable','stale-plan','worker-failed','attempt-limit','schedule-changed','policy-disabled')),
  CHECK((status='running')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  PRIMARY KEY(actor_user_id,custodian_id,scope_id,recipe_version,job_id),
  UNIQUE(actor_user_id,custodian_id,scope_id,recipe_version,local_day),
  FOREIGN KEY(actor_user_id,custodian_id,scope_id,recipe_version)
    REFERENCES memory_shadow_schedules(actor_user_id,custodian_id,scope_id,recipe_version)
);
--> statement-breakpoint
CREATE UNIQUE INDEX memory_shadow_one_active_review
  ON memory_shadow_jobs(actor_user_id,custodian_id,scope_id,recipe_version)
  WHERE status IN ('queued','running','retry');
--> statement-breakpoint
CREATE TABLE memory_shadow_review_runs (
  run_id TEXT PRIMARY KEY,
  trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('manual','synthetic-scheduled')),
  started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','completed','error')),
  registered_scopes INTEGER NOT NULL DEFAULT 0,
  maintenance_erased INTEGER NOT NULL DEFAULT 0,
  maintenance_deferred INTEGER NOT NULL DEFAULT 0,
  admitted INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  deferred INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0
);
