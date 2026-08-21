CREATE TABLE `event_client_receipts` (
	`stream_id` text NOT NULL,
	`client_event_id` text NOT NULL,
	`event_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`stream_id`, `client_event_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_event_client_receipts_event` ON `event_client_receipts` (`event_id`);