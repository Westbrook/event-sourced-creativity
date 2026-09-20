CREATE TABLE `memory_derivation_contexts` (
	`target_enrollment_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`job_id` text NOT NULL,
	`output_sha256` text NOT NULL,
	`source_enrollment_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`boundary_revision` text,
	`hierarchy_revision` text,
	`revision` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`target_enrollment_id`) REFERENCES `memory_live_enrollments`(`enrollment_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `memory_derivation_jobs`(`job_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_context_revisions" CHECK(typeof(target_revision)='integer' AND target_revision>=1 AND typeof(source_revision)='integer' AND source_revision>=1 AND length(revision)=36),
	CONSTRAINT "memory_context_output" CHECK(length(output_sha256)=64 AND output_sha256 NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_context_state" CHECK(state IN('accepted','dismissed')),
	CONSTRAINT "memory_context_time" CHECK(length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at AND length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND expires_at>created_at),
	CONSTRAINT "memory_context_scope" CHECK((target_enrollment_id=source_enrollment_id AND boundary_revision IS NULL AND hierarchy_revision IS NULL) OR (target_enrollment_id<>source_enrollment_id AND length(boundary_revision)=36 AND length(hierarchy_revision)=71))
);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_contexts_source` ON `memory_derivation_contexts` (`job_id`);