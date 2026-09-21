-- Explicit resource-to-assistant context selection, not enrollment or purchase.
-- Exact metadata snapshot only; no linked content or historical backfill.
CREATE TABLE memory_resource_contexts (
 context_id text PRIMARY KEY NOT NULL CHECK(length(context_id)=36),
 actor_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 enrollment_id text NOT NULL REFERENCES memory_resource_enrollments(enrollment_id) ON DELETE CASCADE,
 enrollment_revision integer NOT NULL CHECK(typeof(enrollment_revision)='integer' AND enrollment_revision>0),
 policy_version text NOT NULL CHECK(policy_version='resource-assistant-context-v1'),
 snapshot_sha256 text NOT NULL CHECK(length(snapshot_sha256)=64 AND snapshot_sha256 NOT GLOB '*[^a-f0-9]*'),
 snapshot_json text CHECK(snapshot_json IS NULL OR (json_valid(snapshot_json) AND length(CAST(snapshot_json AS BLOB))<=196608 AND json_extract(snapshot_json,'$.version')=1 AND json_extract(snapshot_json,'$.enrollmentId')=enrollment_id AND json_extract(snapshot_json,'$.revision')=enrollment_revision)),
 state text NOT NULL CHECK(state IN('active','retired')),
 created_at text NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
 expires_at text NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND expires_at>created_at),
 retired_at text,
 CHECK((state='active' AND snapshot_json IS NOT NULL AND retired_at IS NULL) OR (state='retired' AND snapshot_json IS NULL AND retired_at>=created_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_memory_resource_context_active ON memory_resource_contexts(enrollment_id) WHERE state='active';
--> statement-breakpoint
CREATE INDEX idx_memory_resource_context_expiry ON memory_resource_contexts(state,expires_at);
--> statement-breakpoint
CREATE TRIGGER memory_resource_context_no_replace BEFORE INSERT ON memory_resource_contexts
WHEN EXISTS(SELECT 1 FROM memory_resource_contexts WHERE context_id=NEW.context_id)
BEGIN SELECT RAISE(ABORT,'memory_resource_context_no_replace'); END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_context_immutable BEFORE UPDATE ON memory_resource_contexts
WHEN OLD.state<>'active' OR NEW.state<>'retired' OR NEW.snapshot_json IS NOT NULL
 OR (NEW.context_id,NEW.actor_user_id,NEW.enrollment_id,NEW.enrollment_revision,NEW.policy_version,NEW.snapshot_sha256,NEW.created_at,NEW.expires_at)
 IS NOT (OLD.context_id,OLD.actor_user_id,OLD.enrollment_id,OLD.enrollment_revision,OLD.policy_version,OLD.snapshot_sha256,OLD.created_at,OLD.expires_at)
BEGIN SELECT RAISE(ABORT,'memory_resource_context_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_context_settings_retirement BEFORE UPDATE ON memory_resource_enrollments
WHEN (NEW.revision,NEW.permission_epoch,NEW.policy_version,NEW.learn_enabled,NEW.recall_enabled,NEW.retention_days,NEW.enrolled_at,NEW.expires_at,NEW.source_after_sequence)
 IS NOT (OLD.revision,OLD.permission_epoch,OLD.policy_version,OLD.learn_enabled,OLD.recall_enabled,OLD.retention_days,OLD.enrolled_at,OLD.expires_at,OLD.source_after_sequence)
BEGIN
 UPDATE memory_resource_contexts SET state='retired',snapshot_json=NULL,retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE enrollment_id=OLD.enrollment_id AND state='active';
END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_context_history_retirement BEFORE DELETE ON memory_resource_history
BEGIN
 UPDATE memory_resource_contexts SET state='retired',snapshot_json=NULL,retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE enrollment_id=OLD.enrollment_id AND state='active' AND EXISTS(SELECT 1 FROM json_each(snapshot_json,'$.sources') WHERE json_extract(value,'$.event_id')=OLD.event_id);
END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_context_opening_retirement BEFORE DELETE ON memory_resource_openings
BEGIN
 UPDATE memory_resource_contexts SET state='retired',snapshot_json=NULL,retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE enrollment_id=OLD.enrollment_id AND state='active' AND EXISTS(SELECT 1 FROM json_each(snapshot_json,'$.openings') WHERE json_extract(value,'$.opening_id')=OLD.opening_id);
END;
