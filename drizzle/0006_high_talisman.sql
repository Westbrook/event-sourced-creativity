CREATE TABLE `budget_reservations` (
	`reservation_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`stream_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`operation` text NOT NULL,
	`period` text NOT NULL,
	`reserved_tokens` integer NOT NULL,
	`used_tokens` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`settlement_reason` text,
	`created_at` text NOT NULL,
	`settled_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_budget_reservations_owner_status` ON `budget_reservations` (`owner_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_budget_reservations_correlation` ON `budget_reservations` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `canvas_governance_requirements` (
	`requirement_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`approved_by_user_id` text,
	`approved_by_name` text,
	`approved_at` text,
	`evidence_ref` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
