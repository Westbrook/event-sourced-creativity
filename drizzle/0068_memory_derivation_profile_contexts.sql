-- Private reference-only aggregate. No enrollment, source copies or provider work.
CREATE TABLE memory_derivation_profile_contexts (
 target_enrollment_id text NOT NULL REFERENCES memory_derivation_contexts(target_enrollment_id) ON DELETE CASCADE,
 context_revision text NOT NULL,
 job_id text NOT NULL REFERENCES memory_derivation_jobs(job_id) ON DELETE CASCADE,
 output_sha256 text NOT NULL,
 source_enrollment_id text NOT NULL REFERENCES memory_live_enrollments(enrollment_id) ON DELETE CASCADE,
 source_revision integer NOT NULL,
 boundary_revision text,
 hierarchy_revision text,
 expires_at text NOT NULL,
 PRIMARY KEY(target_enrollment_id,job_id),
 UNIQUE(target_enrollment_id,source_enrollment_id),
 CONSTRAINT memory_profile_context_identity CHECK(length(context_revision)=36 AND length(output_sha256)=64 AND output_sha256 NOT GLOB '*[^0-9a-f]*'),
 CONSTRAINT memory_profile_context_revision CHECK(typeof(source_revision)='integer' AND source_revision>=1),
 CONSTRAINT memory_profile_context_expiry CHECK(length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at),
 CONSTRAINT memory_profile_context_range CHECK((target_enrollment_id=source_enrollment_id AND boundary_revision IS NULL AND hierarchy_revision IS NULL)
  OR (target_enrollment_id<>source_enrollment_id AND length(boundary_revision)=36 AND length(hierarchy_revision)=71))
);
--> statement-breakpoint
CREATE INDEX idx_memory_derivation_profile_context_job ON memory_derivation_profile_contexts(job_id);
--> statement-breakpoint
CREATE TRIGGER memory_derivation_profile_context_insert BEFORE INSERT ON memory_derivation_profile_contexts
WHEN (SELECT COUNT(*) FROM memory_derivation_profile_contexts WHERE target_enrollment_id=NEW.target_enrollment_id)>=2
 OR EXISTS(SELECT 1 FROM memory_derivation_profile_contexts WHERE target_enrollment_id=NEW.target_enrollment_id AND (job_id=NEW.job_id OR source_enrollment_id=NEW.source_enrollment_id))
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_contexts c JOIN memory_live_enrollments e ON e.enrollment_id=NEW.source_enrollment_id
 JOIN memory_live_enrollments target ON target.enrollment_id=c.target_enrollment_id
 JOIN memory_derivation_jobs j ON j.job_id=NEW.job_id JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
 JOIN memory_derivation_results r ON r.job_id=j.job_id
 WHERE c.target_enrollment_id=NEW.target_enrollment_id AND c.revision=NEW.context_revision AND c.state='accepted'
  AND c.source_enrollment_id<>NEW.source_enrollment_id AND c.job_id<>NEW.job_id AND c.actor_user_id=e.actor_user_id
  AND e.actor_user_id=target.actor_user_id AND e.organization_id IS target.organization_id
  AND e.revision=NEW.source_revision AND e.learn_enabled=1 AND e.recall_enabled=1
  AND g.enrollment_id=e.enrollment_id AND g.enrollment_revision=e.revision AND g.purpose='profile' AND g.revoked_at IS NULL
  AND r.state='active' AND r.output_sha256=NEW.output_sha256 AND NEW.expires_at=MIN(target.expires_at,r.expires_at)
  AND c.expires_at<=NEW.expires_at AND NEW.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'memory_profile_context_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_profile_context_update BEFORE UPDATE ON memory_derivation_profile_contexts
BEGIN SELECT RAISE(ABORT,'memory_profile_context_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_profile_context_delete AFTER DELETE ON memory_derivation_profile_contexts
BEGIN DELETE FROM memory_derivation_contexts WHERE target_enrollment_id=OLD.target_enrollment_id AND revision=OLD.context_revision; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_profile_context_replaced AFTER UPDATE ON memory_derivation_contexts
BEGIN DELETE FROM memory_derivation_profile_contexts WHERE target_enrollment_id=OLD.target_enrollment_id AND context_revision<>NEW.revision; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_profile_context_result_update AFTER UPDATE ON memory_derivation_results
WHEN NEW.state<>'active' OR NEW.output_sha256 IS NOT OLD.output_sha256 OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256
BEGIN DELETE FROM memory_derivation_contexts WHERE target_enrollment_id IN(SELECT target_enrollment_id FROM memory_derivation_profile_contexts WHERE job_id=OLD.job_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_profile_context_result_delete BEFORE DELETE ON memory_derivation_results
BEGIN DELETE FROM memory_derivation_contexts WHERE target_enrollment_id IN(SELECT target_enrollment_id FROM memory_derivation_profile_contexts WHERE job_id=OLD.job_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_profile_context_enrollment_update AFTER UPDATE ON memory_live_enrollments
WHEN NEW.revision IS NOT OLD.revision OR NEW.learn_enabled<>1 OR NEW.recall_enabled<>1 OR NEW.expires_at IS NOT OLD.expires_at
BEGIN DELETE FROM memory_derivation_contexts WHERE target_enrollment_id IN(SELECT target_enrollment_id FROM memory_derivation_profile_contexts WHERE source_enrollment_id=OLD.enrollment_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_profile_context_boundary_update AFTER UPDATE ON memory_recall_boundaries
BEGIN DELETE FROM memory_derivation_contexts WHERE target_enrollment_id IN(SELECT target_enrollment_id FROM memory_derivation_profile_contexts WHERE source_enrollment_id=OLD.enrollment_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_profile_context_boundary_delete BEFORE DELETE ON memory_recall_boundaries
BEGIN DELETE FROM memory_derivation_contexts WHERE target_enrollment_id IN(SELECT target_enrollment_id FROM memory_derivation_profile_contexts WHERE source_enrollment_id=OLD.enrollment_id); END;
