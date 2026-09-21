-- An additional explicit actor-private range. Existing partition consent is unchanged.
CREATE TABLE memory_recall_organization_ranges (
 enrollment_id text PRIMARY KEY NOT NULL REFERENCES memory_recall_boundaries(enrollment_id) ON DELETE CASCADE,
 enrollment_revision integer NOT NULL CHECK(typeof(enrollment_revision)='integer' AND enrollment_revision>=1),
 boundary_revision text NOT NULL CHECK(length(boundary_revision)=36),
 actor_user_id text NOT NULL,
 organization_id text NOT NULL,
 consented_at text NOT NULL CHECK(length(consented_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',consented_at) IS consented_at)
);
--> statement-breakpoint
CREATE TRIGGER memory_recall_organization_ranges_insert BEFORE INSERT ON memory_recall_organization_ranges
WHEN NOT EXISTS(SELECT 1 FROM memory_recall_boundaries b JOIN memory_live_enrollments e USING(enrollment_id)
 WHERE b.enrollment_id=NEW.enrollment_id AND b.boundary='partition' AND b.revision=NEW.boundary_revision
 AND b.enrollment_revision=NEW.enrollment_revision AND e.revision=NEW.enrollment_revision
 AND e.actor_user_id=NEW.actor_user_id AND e.organization_id=NEW.organization_id
 AND e.learn_enabled=1 AND e.recall_enabled=1 AND e.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND COALESCE(e.failure_code,'') NOT IN('forgotten','erased','access-changed','revoked'))
BEGIN SELECT RAISE(ABORT,'memory_organization_consent_changed'); END;
--> statement-breakpoint
CREATE TRIGGER memory_recall_organization_ranges_immutable BEFORE UPDATE ON memory_recall_organization_ranges
BEGIN SELECT RAISE(ABORT,'memory_organization_consent_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_recall_organization_ranges_boundary AFTER UPDATE ON memory_recall_boundaries
BEGIN DELETE FROM memory_recall_organization_ranges WHERE enrollment_id=OLD.enrollment_id; END;
--> statement-breakpoint
CREATE TRIGGER memory_recall_organization_ranges_retire AFTER DELETE ON memory_recall_organization_ranges
BEGIN
 UPDATE memory_derivation_contexts SET state='dismissed'
 WHERE source_enrollment_id=OLD.enrollment_id AND actor_user_id=OLD.actor_user_id
 AND source_revision=OLD.enrollment_revision AND boundary_revision=OLD.boundary_revision
 AND target_enrollment_id<>source_enrollment_id AND state='accepted';
END;
