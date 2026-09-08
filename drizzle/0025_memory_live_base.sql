CREATE TABLE `memory_live_enrollments` (
	`enrollment_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`permission_epoch` text NOT NULL,
	`policy_version` text NOT NULL,
	`revision` integer NOT NULL,
	`learn_enabled` integer NOT NULL,
	`recall_enabled` integer NOT NULL,
	`background_enabled` integer NOT NULL,
	`retention_days` integer NOT NULL,
	`time_zone` text NOT NULL,
	`enrolled_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`cursor_sequence` integer NOT NULL,
	`cutoff_sequence` integer,
	`last_local_day` text,
	`last_admitted_at` text,
	`next_due_at` text NOT NULL,
	`lease_token` text,
	`lease_expires_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`failure_code` text,
	CONSTRAINT "memory_live_revision" CHECK("memory_live_enrollments"."revision">0),
	CONSTRAINT "memory_live_flags" CHECK("memory_live_enrollments"."learn_enabled" IN(0,1) AND "memory_live_enrollments"."recall_enabled" IN(0,1) AND "memory_live_enrollments"."background_enabled" IN(0,1)),
	CONSTRAINT "memory_live_retention" CHECK("memory_live_enrollments"."retention_days" BETWEEN 1 AND 365)
);
--> statement-breakpoint
CREATE INDEX `idx_memory_live_actor` ON `memory_live_enrollments` (`actor_user_id`,`enrollment_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_live_due` ON `memory_live_enrollments` (`next_due_at`,`enrollment_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_live_organization` ON `memory_live_enrollments` (`organization_id`);--> statement-breakpoint
CREATE TABLE `memory_live_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`trigger_kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`scopes` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`erased` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memory_live_runs_started` ON `memory_live_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `memory_live_sources` (
	`enrollment_id` text NOT NULL,
	`event_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`enrollment_id`, `event_id`),
	FOREIGN KEY (`enrollment_id`) REFERENCES `memory_live_enrollments`(`enrollment_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_memory_live_source_page` ON `memory_live_sources` (`enrollment_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_memory_live_expiry` ON `memory_live_sources` (`expires_at`);