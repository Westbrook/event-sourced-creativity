ALTER TABLE `assistant_specialist_tasks` ADD `result_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assistant_single_consented_turn` ON `assistant_specialist_tasks` (`actor_user_id`,`scope_key`,`turn_id`) WHERE "assistant_specialist_tasks"."result_json" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `assistant_turns` ADD `request_json` text;