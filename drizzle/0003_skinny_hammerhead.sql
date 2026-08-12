CREATE TABLE `replay_approvals` (
	`approval_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`confirmation_version` text NOT NULL,
	`seed` text NOT NULL,
	`requested_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_replay_approvals_owner_expiry` ON `replay_approvals` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `replay_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`seed` text NOT NULL,
	`event_count` integer DEFAULT 0 NOT NULL,
	`image_count` integer DEFAULT 0 NOT NULL,
	`preview_media_url` text,
	`final_media_url` text,
	`events_json` text,
	`plan_json` text,
	`usage_json` text,
	`planner_model` text,
	`image_model` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_replay_sessions_owner_created` ON `replay_sessions` (`owner_id`,`created_at`);