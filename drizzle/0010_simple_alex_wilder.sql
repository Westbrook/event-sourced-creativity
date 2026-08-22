CREATE TABLE IF NOT EXISTS `cost_budget_reservations` (
	`reservation_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workspace_id` text DEFAULT 'forma' NOT NULL,
	`stream_id` text DEFAULT '' NOT NULL,
	`correlation_id` text DEFAULT '' NOT NULL,
	`operation` text NOT NULL,
	`period` text NOT NULL,
	`reserved_microusd` integer NOT NULL,
	`used_microusd` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`allow_user_overage` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`settled_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cost_budget_reservations_owner_status_period` ON `cost_budget_reservations` (`owner_id`,`status`,`period`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cost_budget_reservations_owner_correlation` ON `cost_budget_reservations` (`owner_id`,`correlation_id`);
