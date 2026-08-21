CREATE TABLE `share_scopes` (
	`share_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`project_id` text NOT NULL,
	`media_keys_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_share_scopes_owner_resource` ON `share_scopes` (`owner_id`,`resource_kind`,`resource_id`);