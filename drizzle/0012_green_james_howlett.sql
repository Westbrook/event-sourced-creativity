CREATE TABLE IF NOT EXISTS `delivery_decisions` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`audience` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`owner_user_id` text NOT NULL,
	`owner_display_name` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`dependency_ids_json` text DEFAULT '[]' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_delivery_decisions_status_updated` ON `delivery_decisions` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_delivery_decisions_owner` ON `delivery_decisions` (`owner_user_id`);
