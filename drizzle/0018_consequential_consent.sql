CREATE TABLE IF NOT EXISTS `consequential_execution_steps` (
	`execution_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`token_reservation_id` text NOT NULL,
	`cost_reservation_id` text NOT NULL,
	`maximum_tokens` integer NOT NULL,
	`maximum_microusd` integer NOT NULL,
	`status` text NOT NULL,
	`provider_request_id` text,
	`verified_tokens` integer,
	`verified_microusd` integer,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`execution_id`, `step_index`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `consequential_executions` (
	`execution_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`stream_id` text NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`operation` text NOT NULL,
	`intent_hash` text NOT NULL,
	`binding_hash` text NOT NULL,
	`consent_ref` text NOT NULL,
	`result_ref` text,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_consequential_executions_actor_scope` ON `consequential_executions` (`actor_user_id`,`project_id`,`document_id`,`status`,`created_at`);
