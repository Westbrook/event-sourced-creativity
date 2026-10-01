CREATE TABLE `document_job_terminal_recovery_scan` (
	`cursor_key` text PRIMARY KEY NOT NULL,
	`last_requested_at` text NOT NULL,
	`last_job_id` text NOT NULL,
	`version` integer NOT NULL,
	CONSTRAINT "document_job_terminal_recovery_scan_check_1" CHECK(cursor_key='image-terminal-v1'),
	CONSTRAINT "document_job_terminal_recovery_scan_check_2" CHECK(version>=0 AND version<=9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `idx_document_jobs_image_terminal_recovery_scan` ON `document_jobs` (`requested_at`,`job_id`) WHERE kind='generate' AND status IN('committing','failed');