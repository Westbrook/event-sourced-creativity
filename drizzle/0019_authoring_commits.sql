CREATE TABLE IF NOT EXISTS `authoring_commits` (
	`preview_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`operation` text NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`block_id` text NOT NULL,
	`canvas_id` text,
	`organization_id` text,
	`project_access_id` text,
	`approval_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`last_event_id` text NOT NULL,
	`verified` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "authoring_commit_verified" CHECK("authoring_commits"."verified"=1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_authoring_commits_actor_document` ON `authoring_commits` (`actor_user_id`,`project_id`,`document_id`);
