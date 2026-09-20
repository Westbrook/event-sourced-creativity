CREATE TABLE `still_history_cache` (
 `cache_key` text PRIMARY KEY NOT NULL,
 `owner_id` text NOT NULL,
 `created_at` integer NOT NULL,
 `expires_at` integer NOT NULL,
 `body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_still_history_cache_expiry` ON `still_history_cache` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_still_history_cache_owner` ON `still_history_cache` (`owner_id`,`created_at`);
