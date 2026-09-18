CREATE TABLE `memory_live_conversation_segments` (
	`enrollment_id` text NOT NULL,
	`enrollment_revision` integer NOT NULL,
	`recipe_version` text NOT NULL,
	`first_sequence` integer NOT NULL,
	`last_sequence` integer NOT NULL,
	`member_count` integer NOT NULL,
	`members_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`enrollment_id`, `enrollment_revision`, `recipe_version`, `first_sequence`),
	FOREIGN KEY (`enrollment_id`) REFERENCES `memory_live_enrollments`(`enrollment_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_live_conversation_bounds" CHECK("memory_live_conversation_segments"."enrollment_revision">0 AND "memory_live_conversation_segments"."first_sequence">0 AND "memory_live_conversation_segments"."last_sequence">="memory_live_conversation_segments"."first_sequence" AND "memory_live_conversation_segments"."member_count" BETWEEN 1 AND 8),
	CONSTRAINT "memory_live_conversation_members" CHECK(CASE WHEN json_valid("memory_live_conversation_segments"."members_json") THEN json_type("memory_live_conversation_segments"."members_json")='array' AND json_array_length("memory_live_conversation_segments"."members_json")="memory_live_conversation_segments"."member_count" AND length("memory_live_conversation_segments"."members_json")<=8192 ELSE 0 END)
);
--> statement-breakpoint
CREATE INDEX `idx_memory_live_conversation_page` ON `memory_live_conversation_segments` (`enrollment_id`,`first_sequence`);--> statement-breakpoint
ALTER TABLE `memory_live_sources` ADD `conversation_segmented` integer DEFAULT 0 NOT NULL;