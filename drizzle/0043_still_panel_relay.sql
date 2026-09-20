CREATE TABLE `still_panel_commands` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_still_panel_commands` ON `still_panel_commands` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `still_panel_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`heartbeat` integer NOT NULL,
	`scope` text NOT NULL,
	`revision` integer NOT NULL,
	`payload` text
);
--> statement-breakpoint
CREATE INDEX `idx_still_panel_owner` ON `still_panel_sessions` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_still_panel_expiry` ON `still_panel_sessions` (`expires_at`);