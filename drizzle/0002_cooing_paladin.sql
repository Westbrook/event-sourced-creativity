CREATE TABLE `budget_counters` (
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`period` text NOT NULL,
	`used_tokens` integer DEFAULT 0 NOT NULL,
	`reserved_tokens` integer DEFAULT 0 NOT NULL,
	`hard_limit_tokens` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`scope`, `scope_id`, `period`)
);
--> statement-breakpoint
CREATE TABLE `private_content` (
	`content_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`redacted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_private_content_owner_expiry` ON `private_content` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `shares` (
	`share_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`owner_id` text NOT NULL,
	`stream_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shares_token_hash` ON `shares` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_shares_owner` ON `shares` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'creator' NOT NULL,
	`consent_version` text,
	`consented_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_role` ON `users` (`role`);