CREATE TABLE `memory_derivation_completion_cursors` (
	`consent_id` text PRIMARY KEY NOT NULL,
	`through_sequence` integer NOT NULL,
	`generation` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`consent_id`) REFERENCES `memory_derivation_cursors`(`consent_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_derivation_completion_cursor_bounds" CHECK(typeof(through_sequence)='integer' AND through_sequence BETWEEN 0 AND 9007199254740991 AND typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "memory_derivation_completion_cursor_time" CHECK(length(updated_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS updated_at)
);

--> statement-breakpoint
CREATE TABLE `memory_derivation_completions` (
	`job_id` text PRIMARY KEY NOT NULL,
	`outcome` text NOT NULL,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `memory_derivation_jobs`(`job_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_derivation_completion_outcome" CHECK(outcome IN('stored','no-eligible-originals')),
	CONSTRAINT "memory_derivation_completion_time" CHECK(length(completed_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',completed_at) IS completed_at)
);

--> statement-breakpoint
CREATE TRIGGER memory_derivation_completion_insert BEFORE INSERT ON memory_derivation_completions
WHEN EXISTS(SELECT 1 FROM memory_derivation_completions WHERE job_id=NEW.job_id)
 OR NEW.completed_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM memory_derivation_jobs j WHERE j.job_id=NEW.job_id
  AND j.state='leased' AND j.created_at<=NEW.completed_at AND j.expires_at>NEW.completed_at
  AND ((NEW.outcome='stored' AND EXISTS(SELECT 1 FROM memory_derivation_results r WHERE r.job_id=j.job_id AND r.state='active'))
   OR (NEW.outcome='no-eligible-originals' AND j.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM memory_derivation_job_finance f WHERE f.job_id=j.job_id))))
BEGIN SELECT RAISE(ABORT,'memory_completion_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_completion_update BEFORE UPDATE ON memory_derivation_completions
BEGIN SELECT RAISE(ABORT,'memory_completion_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_completion_delete BEFORE DELETE ON memory_derivation_completions
WHEN EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id=OLD.job_id)
BEGIN SELECT RAISE(ABORT,'memory_completion_cannot_reset'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_completion_cursor_insert BEFORE INSERT ON memory_derivation_completion_cursors
WHEN EXISTS(SELECT 1 FROM memory_derivation_completion_cursors WHERE consent_id=NEW.consent_id) OR NEW.generation!=0
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_cursors c JOIN memory_derivation_grants g ON g.consent_id=c.consent_id
 WHERE c.consent_id=NEW.consent_id AND NEW.through_sequence=g.source_after_sequence AND NEW.updated_at>=g.consented_at)
BEGIN SELECT RAISE(ABORT,'memory_completion_cursor_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_completion_cursor_update BEFORE UPDATE ON memory_derivation_completion_cursors
WHEN NEW.consent_id IS NOT OLD.consent_id OR NEW.generation!=OLD.generation+1 OR NEW.through_sequence<=OLD.through_sequence
 OR NEW.updated_at<OLD.updated_at OR NEW.updated_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_cursors WHERE consent_id=NEW.consent_id AND registered_through_sequence>=NEW.through_sequence)
 OR EXISTS(SELECT 1 FROM memory_derivation_jobs j WHERE j.consent_id=NEW.consent_id AND j.after_sequence<NEW.through_sequence
  AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=j.job_id))
BEGIN SELECT RAISE(ABORT,'memory_completion_cursor_gap'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_completion_cursor_delete BEFORE DELETE ON memory_derivation_completion_cursors
WHEN EXISTS(SELECT 1 FROM memory_derivation_cursors WHERE consent_id=OLD.consent_id)
BEGIN SELECT RAISE(ABORT,'memory_completion_cursor_cannot_reset'); END;
