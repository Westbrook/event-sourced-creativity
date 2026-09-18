CREATE TABLE `memory_derivation_cursors` (
	`consent_id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`grant_revision` integer NOT NULL,
	`purpose` text NOT NULL,
	`registered_through_sequence` integer NOT NULL,
	`generation` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`grant_id`,`grant_revision`) REFERENCES `memory_derivation_grants`(`grant_id`,`revision`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_derivation_cursor_bounds" CHECK(length(consent_id)=36 AND purpose IN('rolling-summary','profile','suggestion') AND typeof(grant_revision)='integer' AND grant_revision>0 AND typeof(registered_through_sequence)='integer' AND registered_through_sequence BETWEEN 0 AND 9007199254740991 AND typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "memory_derivation_cursor_time" CHECK(length(created_at)=24 AND length(updated_at)=24 AND length(expires_at)=24 AND created_at<=updated_at AND updated_at<expires_at)
);

--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_cursor_expiry` ON `memory_derivation_cursors` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `memory_derivation_job_sources` (
	`job_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`event_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`job_id`, `event_id`),
	FOREIGN KEY (`job_id`) REFERENCES `memory_derivation_jobs`(`job_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enrollment_id`,`event_id`) REFERENCES `memory_live_sources`(`enrollment_id`,`event_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_derivation_source_bounds" CHECK(typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991 AND length(expires_at)=24)
);

--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_derivation_source_sequence` ON `memory_derivation_job_sources` (`job_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_source_inverse` ON `memory_derivation_job_sources` (`enrollment_id`,`event_id`);
--> statement-breakpoint
CREATE TABLE `memory_derivation_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`consent_id` text NOT NULL,
	`purpose` text NOT NULL,
	`after_sequence` integer NOT NULL,
	`through_sequence` integer NOT NULL,
	`source_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`state` text NOT NULL,
	`lease_token` text,
	`lease_expires_at` text,
	`attempts` integer NOT NULL,
	`not_before` text NOT NULL,
	`failure_code` text,
	FOREIGN KEY (`consent_id`) REFERENCES `memory_derivation_cursors`(`consent_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_derivation_job_bounds" CHECK(length(job_id)=64 AND job_id NOT GLOB '*[^0-9a-f]*' AND length(consent_id)=36 AND purpose IN('rolling-summary','profile','suggestion') AND typeof(after_sequence)='integer' AND after_sequence>=0 AND typeof(through_sequence)='integer' AND through_sequence>after_sequence AND through_sequence<=9007199254740991 AND typeof(source_count)='integer' AND source_count BETWEEN 1 AND 128 AND typeof(attempts)='integer' AND attempts BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "memory_derivation_job_lease" CHECK((state='waiting' AND lease_token IS NULL AND lease_expires_at IS NULL) OR (state='leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND length(lease_token)=36 AND length(lease_expires_at)=24 AND lease_expires_at<=expires_at)),
	CONSTRAINT "memory_derivation_job_time" CHECK(length(created_at)=24 AND length(expires_at)=24 AND length(not_before)=24 AND created_at<expires_at AND not_before>=created_at AND (failure_code IS NULL OR failure_code IN('native-proof-unavailable','provider-unavailable','interrupted','budget-unavailable')))
);

--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_job_due` ON `memory_derivation_jobs` (`not_before`,`created_at`,`job_id`);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_job_consent` ON `memory_derivation_jobs` (`consent_id`,`after_sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_derivation_job_interval` ON `memory_derivation_jobs` (`consent_id`,`after_sequence`);

--> statement-breakpoint
CREATE TRIGGER memory_derivation_cursor_insert BEFORE INSERT ON memory_derivation_cursors WHEN EXISTS(SELECT 1 FROM memory_derivation_cursors WHERE consent_id=NEW.consent_id) OR NEW.generation!=0 OR NOT EXISTS(SELECT 1 FROM memory_derivation_grants g WHERE (g.consent_id,g.grant_id,g.revision,g.purpose,g.source_after_sequence,g.expires_at)=(NEW.consent_id,NEW.grant_id,NEW.grant_revision,NEW.purpose,NEW.registered_through_sequence,NEW.expires_at) AND g.revoked_at IS NULL AND g.background_enabled=1 AND g.consented_at<=NEW.created_at AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) BEGIN SELECT RAISE(ABORT,'memory_derivation_cursor_insert'); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_cursor_update BEFORE UPDATE ON memory_derivation_cursors WHEN NEW.consent_id IS NOT OLD.consent_id OR NEW.grant_id IS NOT OLD.grant_id OR NEW.grant_revision IS NOT OLD.grant_revision OR NEW.purpose IS NOT OLD.purpose OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.registered_through_sequence<=OLD.registered_through_sequence OR NEW.generation!=OLD.generation+1 OR NEW.updated_at<OLD.updated_at BEGIN SELECT RAISE(ABORT,'memory_derivation_cursor_update'); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_cursor_delete BEFORE DELETE ON memory_derivation_cursors WHEN EXISTS(SELECT 1 FROM memory_derivation_grants g WHERE (g.consent_id,g.grant_id,g.revision)=(OLD.consent_id,OLD.grant_id,OLD.grant_revision) AND g.revoked_at IS NULL AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) BEGIN SELECT RAISE(ABORT,'memory_derivation_cursor_delete'); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_job_insert BEFORE INSERT ON memory_derivation_jobs WHEN EXISTS(SELECT 1 FROM memory_derivation_jobs WHERE job_id=NEW.job_id OR (consent_id,after_sequence)=(NEW.consent_id,NEW.after_sequence)) OR NEW.state!='waiting' OR NEW.attempts!=0 OR NEW.failure_code IS NOT NULL OR NEW.not_before!=NEW.created_at OR NOT EXISTS(SELECT 1 FROM memory_derivation_cursors c JOIN memory_derivation_grants g ON (g.grant_id,g.revision,g.consent_id)=(c.grant_id,c.grant_revision,c.consent_id) WHERE (c.consent_id,c.purpose,c.registered_through_sequence)=(NEW.consent_id,NEW.purpose,NEW.after_sequence) AND NEW.expires_at<=c.expires_at AND g.revoked_at IS NULL AND g.background_enabled=1 AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) BEGIN SELECT RAISE(ABORT,'memory_derivation_job_insert'); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_job_update BEFORE UPDATE ON memory_derivation_jobs WHEN NEW.job_id IS NOT OLD.job_id OR NEW.consent_id IS NOT OLD.consent_id OR NEW.purpose IS NOT OLD.purpose OR NEW.after_sequence IS NOT OLD.after_sequence OR NEW.through_sequence IS NOT OLD.through_sequence OR NEW.source_count IS NOT OLD.source_count OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.not_before<OLD.not_before OR NOT ((OLD.state='waiting' AND NEW.state='leased' AND NEW.attempts=OLD.attempts+1) OR (OLD.state='leased' AND NEW.state='waiting' AND NEW.attempts=OLD.attempts) OR (OLD.state='waiting' AND NEW.state='waiting' AND NEW.attempts=OLD.attempts)) BEGIN SELECT RAISE(ABORT,'memory_derivation_job_update'); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_source_insert BEFORE INSERT ON memory_derivation_job_sources WHEN EXISTS(SELECT 1 FROM memory_derivation_job_sources WHERE job_id=NEW.job_id AND (event_id=NEW.event_id OR sequence=NEW.sequence)) OR NOT EXISTS(SELECT 1 FROM memory_derivation_jobs j JOIN memory_derivation_cursors c ON c.consent_id=j.consent_id JOIN memory_derivation_grants g ON (g.grant_id,g.revision,g.consent_id)=(c.grant_id,c.grant_revision,c.consent_id) JOIN memory_live_sources s ON (s.enrollment_id,s.event_id,s.sequence,s.expires_at)=(NEW.enrollment_id,NEW.event_id,NEW.sequence,NEW.expires_at) WHERE j.job_id=NEW.job_id AND j.state='waiting' AND j.attempts=0 AND g.enrollment_id=NEW.enrollment_id AND j.after_sequence<NEW.sequence AND j.through_sequence>=NEW.sequence AND j.expires_at<=NEW.expires_at AND g.revoked_at IS NULL AND (SELECT COUNT(*) FROM memory_derivation_job_sources WHERE job_id=NEW.job_id)<j.source_count) BEGIN SELECT RAISE(ABORT,'memory_derivation_source_insert'); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_source_immutable BEFORE UPDATE ON memory_derivation_job_sources BEGIN SELECT RAISE(ABORT,'memory_derivation_source_immutable'); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_source_delete BEFORE DELETE ON memory_live_sources BEGIN DELETE FROM memory_derivation_jobs WHERE job_id IN(SELECT job_id FROM memory_derivation_job_sources WHERE enrollment_id=OLD.enrollment_id AND event_id=OLD.event_id); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_source_changed BEFORE UPDATE OF enrollment_id,event_id,sequence,expires_at ON memory_live_sources WHEN NEW.enrollment_id IS NOT OLD.enrollment_id OR NEW.event_id IS NOT OLD.event_id OR NEW.sequence IS NOT OLD.sequence OR NEW.expires_at IS NOT OLD.expires_at BEGIN DELETE FROM memory_derivation_jobs WHERE job_id IN(SELECT job_id FROM memory_derivation_job_sources WHERE enrollment_id=OLD.enrollment_id AND event_id=OLD.event_id); END;

--> statement-breakpoint
CREATE TRIGGER memory_derivation_jobs_revoked AFTER UPDATE OF revoked_at ON memory_derivation_grants WHEN NEW.revoked_at IS NOT NULL BEGIN DELETE FROM memory_derivation_cursors WHERE consent_id=OLD.consent_id AND grant_id=OLD.grant_id AND grant_revision=OLD.revision; END;

--> statement-breakpoint
-- REPLACE's implicit source deletion need not run DELETE triggers when recursive
-- triggers are off. Its FK cascade still deletes the dependency, so close the
-- entire job here too. A parent-job cascade already removed the parent (no-op).
CREATE TRIGGER memory_derivation_dependency_deleted AFTER DELETE ON memory_derivation_job_sources BEGIN DELETE FROM memory_derivation_jobs WHERE job_id=OLD.job_id; END;
