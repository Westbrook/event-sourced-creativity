CREATE TABLE `events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`stream_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`actor` text NOT NULL,
	`client_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`causation_id` text,
	`compensates_event_id` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_stream_sequence` ON `events` (`stream_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_events_stream_type` ON `events` (`stream_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_events_correlation` ON `events` (`correlation_id`);--> statement-breakpoint
CREATE TRIGGER `events_block_update`
BEFORE UPDATE ON `events` BEGIN
	SELECT RAISE(ABORT, 'events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `events_block_delete`
BEFORE DELETE ON `events` BEGIN
	SELECT RAISE(ABORT, 'events are append-only');
END;--> statement-breakpoint
CREATE TABLE `external_content` (
	`content_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_external_content_owner` ON `external_content` (`owner_id`);
