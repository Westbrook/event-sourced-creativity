CREATE TABLE IF NOT EXISTS `event_private_payloads` (
	`private_event_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text,
	`document_id` text,
	`private_json` text NOT NULL,
	`created_at` text NOT NULL,
	`redacted_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_event_private_payloads_owner_scope` ON `event_private_payloads` (`owner_id`,`project_id`,`document_id`,`redacted_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_write_stage` (
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
	`schema_version` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text,
	`document_id` text,
	`private_json` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_notifications` (
	`notification_id` text PRIMARY KEY NOT NULL,
	`project_access_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`artifact_id` text,
	`document_id` text,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_project_notifications_recipient_event` ON `project_notifications` (`project_access_id`,`recipient_user_id`,`event_id`,`kind`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_notifications_recipient_time` ON `project_notifications` (`recipient_user_id`,`project_access_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_private_content_pending_expiry` ON `private_content` (`expires_at`) WHERE "private_content"."redacted_at" IS NULL AND "private_content"."kind"!='document-artifact';
