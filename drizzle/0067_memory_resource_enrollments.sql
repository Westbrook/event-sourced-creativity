-- Independent, explicit Library/Canvas consent. No backfill or document alias.
CREATE TABLE memory_resource_enrollments (
 enrollment_id text PRIMARY KEY NOT NULL CHECK(length(enrollment_id)=36),
 actor_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 owner_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
 organization_id text,
 project_access_id text,
 project_id text NOT NULL CHECK(length(project_id) BETWEEN 1 AND 240),
 resource_kind text NOT NULL CHECK(resource_kind IN('library','canvas')),
 resource_id text NOT NULL CHECK(length(resource_id) BETWEEN 1 AND 240),
 resource_key text NOT NULL,
 permission_epoch text NOT NULL CHECK(length(permission_epoch)=64),
 policy_version text NOT NULL CHECK(policy_version='personal-resource-memory-v1'),
 revision integer NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
 learn_enabled integer NOT NULL CHECK(learn_enabled IN(0,1)),
 recall_enabled integer NOT NULL CHECK(recall_enabled IN(0,1)),
 background_enabled integer NOT NULL CHECK(background_enabled IN(0,1) AND background_enabled<=learn_enabled),
 retention_days integer NOT NULL CHECK(typeof(retention_days)='integer' AND retention_days BETWEEN 1 AND 30),
 time_zone text NOT NULL,
 enrolled_at text NOT NULL CHECK(length(enrolled_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',enrolled_at) IS enrolled_at),
 expires_at text NOT NULL CHECK(length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND expires_at>enrolled_at),
 source_after_sequence integer NOT NULL CHECK(typeof(source_after_sequence)='integer' AND source_after_sequence>=0),
 cursor_sequence integer NOT NULL CHECK(typeof(cursor_sequence)='integer' AND cursor_sequence>=source_after_sequence),
 next_due_at text NOT NULL CHECK(length(next_due_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',next_due_at) IS next_due_at),
 last_local_day text,
 CHECK((organization_id IS NULL AND project_access_id IS NULL AND owner_user_id=actor_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL)),
 CHECK(resource_kind<>'library' OR resource_id=project_id),
 CHECK(resource_key=json_array('memory-resource-v1',owner_user_id,organization_id,project_access_id,resource_kind,project_id,resource_id)),
 UNIQUE(actor_user_id,resource_key)
);
--> statement-breakpoint
CREATE INDEX idx_memory_resource_due ON memory_resource_enrollments(background_enabled,next_due_at,enrollment_id);
--> statement-breakpoint
CREATE TRIGGER memory_resource_enrollment_identity BEFORE UPDATE ON memory_resource_enrollments
WHEN (NEW.enrollment_id,NEW.actor_user_id,NEW.owner_user_id,NEW.organization_id,NEW.project_access_id,NEW.project_id,NEW.resource_kind,NEW.resource_id,NEW.resource_key)
 IS NOT (OLD.enrollment_id,OLD.actor_user_id,OLD.owner_user_id,OLD.organization_id,OLD.project_access_id,OLD.project_id,OLD.resource_kind,OLD.resource_id,OLD.resource_key)
BEGIN SELECT RAISE(ABORT,'memory_resource_identity_immutable'); END;
--> statement-breakpoint
CREATE TABLE memory_resource_history (
 enrollment_id text NOT NULL REFERENCES memory_resource_enrollments(enrollment_id) ON DELETE CASCADE,
 event_id text NOT NULL REFERENCES event_private_payloads(private_event_id) ON DELETE CASCADE,
 sequence integer NOT NULL CHECK(typeof(sequence)='integer' AND sequence>0),
 event_type text NOT NULL,
 action text NOT NULL CHECK(action IN('edit','reuse','remove','restore','commit','inspect')),
 recorded_at text NOT NULL,
 expires_at text NOT NULL CHECK(expires_at>recorded_at),
 PRIMARY KEY(enrollment_id,event_id),
 UNIQUE(enrollment_id,sequence)
);
--> statement-breakpoint
CREATE INDEX idx_memory_resource_history_expiry ON memory_resource_history(expires_at);
--> statement-breakpoint
CREATE TRIGGER memory_resource_history_immutable BEFORE UPDATE ON memory_resource_history
BEGIN SELECT RAISE(ABORT,'memory_resource_history_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_history_source_retirement BEFORE UPDATE ON event_private_payloads
WHEN NEW.private_event_id IS NOT OLD.private_event_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.project_id IS NOT OLD.project_id
 OR NEW.document_id IS NOT OLD.document_id OR NEW.private_json IS NOT OLD.private_json OR NEW.redacted_at IS NOT OLD.redacted_at
BEGIN
 INSERT OR IGNORE INTO memory_resource_retired_sources(enrollment_id,event_id)
 SELECT e.enrollment_id,OLD.private_event_id FROM memory_resource_enrollments e JOIN events source ON source.event_id=OLD.private_event_id
 WHERE e.owner_user_id=OLD.owner_id AND (e.project_id=OLD.project_id OR OLD.project_id IS NULL) AND source.sequence>e.cursor_sequence AND e.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND julianday(source.recorded_at)>julianday('now')-e.retention_days;
 DELETE FROM memory_resource_history WHERE event_id=OLD.private_event_id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_history_settings_retirement BEFORE UPDATE ON memory_resource_enrollments
WHEN NEW.revision IS NOT OLD.revision
BEGIN DELETE FROM memory_resource_history WHERE enrollment_id=OLD.enrollment_id; DELETE FROM memory_resource_retired_sources WHERE enrollment_id=OLD.enrollment_id; END;

--> statement-breakpoint
CREATE TABLE memory_resource_retired_sources (
 enrollment_id text NOT NULL REFERENCES memory_resource_enrollments(enrollment_id) ON DELETE CASCADE,
 event_id text NOT NULL,
 PRIMARY KEY(enrollment_id,event_id)
);
--> statement-breakpoint
CREATE TRIGGER memory_resource_history_source_deletion BEFORE DELETE ON event_private_payloads
BEGIN
 INSERT OR IGNORE INTO memory_resource_retired_sources(enrollment_id,event_id)
 SELECT e.enrollment_id,OLD.private_event_id FROM memory_resource_enrollments e JOIN events source ON source.event_id=OLD.private_event_id
 WHERE e.owner_user_id=OLD.owner_id AND (e.project_id=OLD.project_id OR OLD.project_id IS NULL) AND source.sequence>e.cursor_sequence AND e.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND julianday(source.recorded_at)>julianday('now')-e.retention_days;
END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_retired_source_immutable BEFORE UPDATE ON memory_resource_retired_sources
BEGIN SELECT RAISE(ABORT,'memory_resource_retirement_immutable'); END;
