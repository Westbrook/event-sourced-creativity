-- Actor-private resource-surface openings, not block-content or attention evidence.
-- No source backfill, enrollment or change to authored events.
CREATE TABLE memory_resource_openings (
 enrollment_id text NOT NULL REFERENCES memory_resource_enrollments(enrollment_id) ON DELETE CASCADE,
 opening_id text NOT NULL CHECK(length(opening_id)=36),
 enrollment_revision integer NOT NULL CHECK(typeof(enrollment_revision)='integer' AND enrollment_revision>0),
 source_head integer NOT NULL CHECK(typeof(source_head)='integer' AND source_head>=0),
 recorded_at text NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at) IS recorded_at),
 expires_at text NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND expires_at>recorded_at),
 PRIMARY KEY(enrollment_id,opening_id)
);
--> statement-breakpoint
CREATE INDEX idx_memory_resource_openings_expiry ON memory_resource_openings(expires_at);
--> statement-breakpoint
CREATE TRIGGER memory_resource_openings_immutable BEFORE UPDATE ON memory_resource_openings
BEGIN SELECT RAISE(ABORT,'memory_resource_opening_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_resource_openings_settings_retirement BEFORE UPDATE ON memory_resource_enrollments
WHEN NEW.revision IS NOT OLD.revision
BEGIN DELETE FROM memory_resource_openings WHERE enrollment_id=OLD.enrollment_id; END;
