-- Chat Studio delivery has its own consent-bound frontier. Existing Creator
-- frontiers are neither reset nor misrepresented as coverage of another producer.
CREATE TABLE memory_derivation_producer_cursors (
 consent_id TEXT PRIMARY KEY NOT NULL REFERENCES memory_derivation_cursors(consent_id) ON DELETE CASCADE,
 registered_through_sequence INTEGER NOT NULL,
 completed_through_sequence INTEGER NOT NULL,
 generation INTEGER NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK(typeof(registered_through_sequence)='integer' AND registered_through_sequence BETWEEN 0 AND 9007199254740991),
 CHECK(typeof(completed_through_sequence)='integer' AND completed_through_sequence BETWEEN 0 AND registered_through_sequence),
 CHECK(typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991),
 CHECK(length(updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS updated_at)
);
--> statement-breakpoint
CREATE TABLE memory_derivation_producer_jobs (
 job_id TEXT PRIMARY KEY NOT NULL REFERENCES memory_derivation_jobs(job_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 consent_id TEXT NOT NULL REFERENCES memory_derivation_producer_cursors(consent_id) ON DELETE CASCADE,
 after_sequence INTEGER NOT NULL,
 through_sequence INTEGER NOT NULL,
 CHECK(length(job_id)=64 AND job_id NOT GLOB '*[^0-9a-f]*'),
 CHECK(typeof(after_sequence)='integer' AND typeof(through_sequence)='integer' AND after_sequence>=0 AND through_sequence>after_sequence AND through_sequence<=9007199254740991),
 UNIQUE(consent_id,after_sequence)
);
--> statement-breakpoint
CREATE TRIGGER memory_derivation_producer_cursor_insert BEFORE INSERT ON memory_derivation_producer_cursors
WHEN EXISTS(SELECT 1 FROM memory_derivation_producer_cursors WHERE consent_id=NEW.consent_id) OR NEW.generation!=0
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_grants g WHERE g.consent_id=NEW.consent_id AND g.revoked_at IS NULL AND g.background_enabled=1
  AND NEW.registered_through_sequence=g.source_after_sequence AND NEW.completed_through_sequence=g.source_after_sequence
  AND NEW.updated_at>=g.consented_at AND NEW.updated_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NEW.updated_at<g.expires_at)
BEGIN SELECT RAISE(ABORT,'memory_producer_cursor_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_producer_cursor_update BEFORE UPDATE ON memory_derivation_producer_cursors
WHEN NEW.consent_id IS NOT OLD.consent_id OR NEW.generation!=OLD.generation+1 OR NEW.updated_at<OLD.updated_at
 OR NEW.updated_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 OR NOT ((NEW.registered_through_sequence>OLD.registered_through_sequence AND NEW.completed_through_sequence=OLD.completed_through_sequence)
  OR (NEW.registered_through_sequence=OLD.registered_through_sequence AND NEW.completed_through_sequence>OLD.completed_through_sequence
   AND NOT EXISTS(SELECT 1 FROM memory_derivation_producer_jobs p JOIN memory_derivation_jobs j ON j.job_id=p.job_id
    WHERE p.consent_id=NEW.consent_id AND p.after_sequence<NEW.completed_through_sequence
     AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=j.job_id))))
BEGIN SELECT RAISE(ABORT,'memory_producer_cursor_gap'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_producer_cursor_delete BEFORE DELETE ON memory_derivation_producer_cursors
WHEN EXISTS(SELECT 1 FROM memory_derivation_cursors WHERE consent_id=OLD.consent_id)
 AND EXISTS(SELECT 1 FROM memory_derivation_grants WHERE consent_id=OLD.consent_id AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'memory_producer_cursor_cannot_reset'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_producer_job_insert BEFORE INSERT ON memory_derivation_producer_jobs
WHEN EXISTS(SELECT 1 FROM memory_derivation_producer_jobs WHERE job_id=NEW.job_id OR (consent_id,after_sequence)=(NEW.consent_id,NEW.after_sequence))
 OR EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id=NEW.job_id)
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_producer_cursors c JOIN memory_derivation_grants g ON g.consent_id=c.consent_id
  WHERE c.consent_id=NEW.consent_id AND c.registered_through_sequence=NEW.after_sequence AND g.revoked_at IS NULL AND g.background_enabled=1
   AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'memory_producer_job_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_producer_job_update BEFORE UPDATE ON memory_derivation_producer_jobs
BEGIN SELECT RAISE(ABORT,'memory_producer_job_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_producer_job_delete BEFORE DELETE ON memory_derivation_producer_jobs
WHEN EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id=OLD.job_id)
 AND EXISTS(SELECT 1 FROM memory_derivation_grants WHERE consent_id=OLD.consent_id AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'memory_producer_job_cannot_reset'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_producer_split BEFORE INSERT ON memory_derivation_split_commands
WHEN EXISTS(SELECT 1 FROM memory_derivation_producer_jobs WHERE job_id=NEW.parent_job_id)
BEGIN SELECT RAISE(ABORT,'memory_producer_split_unavailable'); END;
--> statement-breakpoint
DROP TRIGGER memory_derivation_job_insert;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_job_insert BEFORE INSERT ON memory_derivation_jobs WHEN EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id=NEW.job_id OR ((consent_id,after_sequence)=(NEW.consent_id,NEW.after_sequence)
 AND EXISTS(SELECT 1 FROM memory_derivation_producer_jobs p WHERE p.job_id=memory_derivation_jobs.job_id)
   =EXISTS(SELECT 1 FROM memory_derivation_producer_jobs p WHERE p.job_id=NEW.job_id))) OR NEW.state!='waiting' OR NEW.attempts!=0 OR NEW.failure_code IS NOT NULL OR NEW.not_before!=NEW.created_at OR NOT EXISTS(SELECT 1 FROM memory_derivation_cursors c JOIN memory_derivation_grants g ON (g.grant_id,g.revision,g.consent_id)=(c.grant_id,c.grant_revision,c.consent_id) WHERE (c.consent_id,c.purpose)=(NEW.consent_id,NEW.purpose) AND ((EXISTS(SELECT 1 FROM memory_derivation_producer_jobs p JOIN memory_derivation_producer_cursors pc ON pc.consent_id=p.consent_id
 WHERE (p.job_id,p.consent_id,p.after_sequence,p.through_sequence)=(NEW.job_id,NEW.consent_id,NEW.after_sequence,NEW.through_sequence)
 AND pc.registered_through_sequence=p.after_sequence AND NEW.source_count=1)) OR
 (NOT EXISTS(SELECT 1 FROM memory_derivation_producer_jobs WHERE job_id=NEW.job_id) AND (c.registered_through_sequence=NEW.after_sequence OR EXISTS(
 SELECT 1 FROM memory_derivation_split_commands split WHERE NEW.job_id IN(split.left_job_id,split.right_job_id)
 AND NEW.consent_id=json_extract(split.parent_json,'$[1]') AND NEW.purpose=json_extract(split.parent_json,'$[2]')
 AND NEW.after_sequence=CASE WHEN NEW.job_id=split.left_job_id THEN json_extract(split.parent_json,'$[3]') ELSE split.split_sequence END
 AND NEW.through_sequence=CASE WHEN NEW.job_id=split.left_job_id THEN split.split_sequence ELSE json_extract(split.parent_json,'$[4]') END
 AND NEW.created_at=json_extract(split.parent_json,'$[6]') AND NEW.expires_at=json_extract(split.parent_json,'$[7]')
 AND NEW.source_count=(SELECT COUNT(*) FROM json_each(split.references_json) WHERE
  json_extract(value,'$[3]')>NEW.after_sequence AND json_extract(value,'$[3]')<=NEW.through_sequence))))) AND NEW.expires_at<=c.expires_at AND g.revoked_at IS NULL AND g.background_enabled=1 AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) BEGIN SELECT RAISE(ABORT,'memory_derivation_job_insert'); END;
--> statement-breakpoint
DROP INDEX idx_memory_derivation_job_interval;
--> statement-breakpoint
CREATE INDEX idx_memory_derivation_job_interval ON memory_derivation_jobs(consent_id,after_sequence);
--> statement-breakpoint
DROP TRIGGER memory_derivation_completion_cursor_update;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_completion_cursor_update BEFORE UPDATE ON memory_derivation_completion_cursors
WHEN NEW.consent_id IS NOT OLD.consent_id OR NEW.generation!=OLD.generation+1 OR NEW.through_sequence<=OLD.through_sequence
 OR NEW.updated_at<OLD.updated_at OR NEW.updated_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_cursors WHERE consent_id=NEW.consent_id AND registered_through_sequence>=NEW.through_sequence)
 OR EXISTS(SELECT 1 FROM memory_derivation_jobs j WHERE j.consent_id=NEW.consent_id AND j.after_sequence<NEW.through_sequence
  AND NOT EXISTS(SELECT 1 FROM memory_derivation_producer_jobs p WHERE p.job_id=j.job_id)
  AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=j.job_id))
BEGIN SELECT RAISE(ABORT,'memory_completion_cursor_gap'); END;
