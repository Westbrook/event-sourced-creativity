-- Additive event-backed private controls. No activation, backfill, provider calls or enrollment.
CREATE TABLE `memory_derivation_observation_controls` (
	`control_id` text PRIMARY KEY NOT NULL,
	`enrollment_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`scope_key` text NOT NULL,
	`lineage_id` text NOT NULL,
	`claim_key` text NOT NULL,
	`source_event_ref` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`correction_text` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`enrollment_id`) REFERENCES `memory_live_enrollments`(`enrollment_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_event_ref`) REFERENCES `events`(`event_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_derivation_observation_control_shape" CHECK(length(control_id)=64 AND control_id NOT GLOB '*[^0-9a-f]*' AND length(lineage_id)=64 AND lineage_id NOT GLOB '*[^0-9a-f]*' AND length(actor_user_id) BETWEEN 1 AND 240 AND length(scope_key) BETWEEN 1 AND 8192 AND length(claim_key) BETWEEN 1 AND 240 AND purpose IN('rolling-summary','profile','suggestion') AND typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "memory_derivation_observation_control_action" CHECK((action IN('suppressed','released') AND correction_text IS NULL) OR (action='corrected' AND correction_text IS NOT NULL AND length(trim(correction_text)) BETWEEN 1 AND 1000 AND length(CAST(correction_text AS BLOB))<=4096)),
	CONSTRAINT "memory_derivation_observation_control_time" CHECK(length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at AND length(updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS updated_at AND length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND created_at<=updated_at AND updated_at<expires_at)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_derivation_observation_control_lineage` ON `memory_derivation_observation_controls` (`enrollment_id`,`purpose`,`lineage_id`);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_observation_control_source` ON `memory_derivation_observation_controls` (`source_event_ref`);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_observation_control_expiry` ON `memory_derivation_observation_controls` (`expires_at`);
--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_insert BEFORE INSERT ON memory_derivation_observation_controls
WHEN EXISTS(SELECT 1 FROM memory_derivation_observation_controls WHERE control_id=NEW.control_id OR (enrollment_id,purpose,lineage_id)=(NEW.enrollment_id,NEW.purpose,NEW.lineage_id))
 OR NEW.revision!=1 OR NEW.created_at IS NOT NEW.updated_at OR NEW.updated_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 OR NOT EXISTS(SELECT 1 FROM memory_live_enrollments e JOIN events source ON source.event_id=NEW.source_event_ref
  JOIN memory_live_sources remembered ON remembered.enrollment_id=e.enrollment_id AND remembered.event_id=source.event_id AND remembered.sequence=source.sequence
  WHERE e.enrollment_id=NEW.enrollment_id AND e.actor_user_id=NEW.actor_user_id AND source.stream_id='creative:'||e.owner_user_id AND (source.actor='user:'||e.actor_user_id OR (source.actor='user' AND e.actor_user_id=e.owner_user_id AND e.organization_id IS NULL AND e.project_access_id IS NULL))
    AND remembered.expires_at>=NEW.expires_at AND e.expires_at>=NEW.expires_at)
 OR ((SELECT COUNT(*) FROM memory_derivation_observation_controls WHERE enrollment_id=NEW.enrollment_id)+(SELECT COUNT(*) FROM memory_derivation_user_controls WHERE enrollment_id=NEW.enrollment_id))>=1024
BEGIN SELECT RAISE(ABORT,'memory_user_control_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_update BEFORE UPDATE ON memory_derivation_observation_controls
WHEN NEW.control_id IS NOT OLD.control_id OR NEW.enrollment_id IS NOT OLD.enrollment_id OR NEW.actor_user_id IS NOT OLD.actor_user_id
 OR NEW.purpose IS NOT OLD.purpose OR NEW.scope_key IS NOT OLD.scope_key OR NEW.lineage_id IS NOT OLD.lineage_id
 OR NEW.source_event_ref IS NOT OLD.source_event_ref OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision!=OLD.revision+1 OR NEW.updated_at<OLD.updated_at OR NEW.updated_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 OR NEW.expires_at>OLD.expires_at OR NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
BEGIN SELECT RAISE(ABORT,'memory_user_control_revision_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_source_update BEFORE UPDATE ON events
BEGIN DELETE FROM memory_derivation_observation_controls WHERE source_event_ref IN(OLD.event_id,NEW.event_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_insert_results AFTER INSERT ON memory_derivation_observation_controls
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state IN('staging','active') AND job_id IN(SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
 WHERE g.enrollment_id=NEW.enrollment_id AND g.purpose=NEW.purpose AND g.actor_user_id=NEW.actor_user_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_update_results AFTER UPDATE ON memory_derivation_observation_controls
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state IN('staging','active') AND job_id IN(SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
 WHERE g.enrollment_id=NEW.enrollment_id AND g.purpose=NEW.purpose AND g.actor_user_id=NEW.actor_user_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_delete_results AFTER DELETE ON memory_derivation_observation_controls
BEGIN UPDATE memory_derivation_results SET state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state IN('staging','active') AND job_id IN(SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
 WHERE g.enrollment_id=OLD.enrollment_id AND g.purpose=OLD.purpose AND g.actor_user_id=OLD.actor_user_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_parent_update BEFORE UPDATE ON memory_live_enrollments
BEGIN DELETE FROM memory_derivation_observation_controls WHERE enrollment_id=OLD.enrollment_id AND
 (NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.project_access_id IS NOT OLD.project_access_id OR NEW.project_id IS NOT OLD.project_id OR NEW.document_id IS NOT OLD.document_id
  OR NEW.failure_code IN('forgotten','erased','access-changed','revoked') OR expires_at>NEW.expires_at); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_private_update BEFORE UPDATE ON event_private_payloads
BEGIN DELETE FROM memory_derivation_observation_controls WHERE source_event_ref IN(OLD.private_event_id,NEW.private_event_id); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_private_delete BEFORE DELETE ON event_private_payloads
BEGIN DELETE FROM memory_derivation_observation_controls WHERE source_event_ref=OLD.private_event_id; END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_remembered_update BEFORE UPDATE ON memory_live_sources
WHEN NEW.enrollment_id IS NOT OLD.enrollment_id OR NEW.event_id IS NOT OLD.event_id OR NEW.sequence IS NOT OLD.sequence OR NEW.expires_at<OLD.expires_at
BEGIN DELETE FROM memory_derivation_observation_controls WHERE (enrollment_id,source_event_ref)=(OLD.enrollment_id,OLD.event_id); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_remembered_delete BEFORE DELETE ON memory_live_sources
BEGIN DELETE FROM memory_derivation_observation_controls WHERE (enrollment_id,source_event_ref)=(OLD.enrollment_id,OLD.event_id); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_compensated BEFORE INSERT ON events
BEGIN DELETE FROM memory_derivation_observation_controls WHERE source_event_ref=NEW.compensates_event_id; END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_custody_update BEFORE UPDATE ON project_event_scopes
BEGIN DELETE FROM memory_derivation_observation_controls WHERE source_event_ref IN(OLD.event_id,NEW.event_id); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_custody_delete BEFORE DELETE ON project_event_scopes
BEGIN DELETE FROM memory_derivation_observation_controls WHERE source_event_ref=OLD.event_id; END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_observation_control_custody_insert BEFORE INSERT ON project_event_scopes
BEGIN DELETE FROM memory_derivation_observation_controls WHERE source_event_ref=NEW.event_id; END;
