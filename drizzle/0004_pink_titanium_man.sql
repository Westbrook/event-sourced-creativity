CREATE TABLE `document_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`stream_id` text NOT NULL,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`source_surface` text NOT NULL,
	`correlation_id` text NOT NULL,
	`requested_sequence` integer NOT NULL,
	`request_json` text NOT NULL,
	`result_json` text,
	`error_message` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`requested_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`lease_expires_at` text,
	`notified_at` text,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_document_jobs_owner_status` ON `document_jobs` (`owner_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_document_jobs_stream_document` ON `document_jobs` (`stream_id`,`document_id`,`requested_at`);