CREATE TABLE IF NOT EXISTS `assistant_action_commits` (
	`commit_id` text PRIMARY KEY NOT NULL,
	`verified` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "assistant_action_commits_verified" CHECK("assistant_action_commits"."verified"=1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assistant_action_proposals` (
	`proposal_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`turn_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`action_kind` text NOT NULL,
	`action_content_ref` text NOT NULL,
	`source_versions_json` text NOT NULL,
	`expected_head` integer NOT NULL,
	`permission_epoch` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assistant_proposals_actor_scope` ON `assistant_action_proposals` (`actor_user_id`,`scope_key`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assistant_billing_reconciliations` (
	`reconciliation_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`evidence_classification` text NOT NULL,
	`occurred_at` text NOT NULL,
	CONSTRAINT "assistant_billing_reconciliations_evidence" CHECK("assistant_billing_reconciliations"."evidence_classification"='verified-no-provider-charge'),
	CONSTRAINT "assistant_billing_reconciliations_task_id_reviewer_user_id_unique" UNIQUE (`task_id`,`reviewer_user_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assistant_billing_reconciliations_actor_scope` ON `assistant_billing_reconciliations` (`actor_user_id`,`organization_id`,`project_access_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assistant_specialist_tasks` (
	`task_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`turn_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text,
	`document_id` text,
	`route_family` text NOT NULL,
	`task_kind` text NOT NULL,
	`selected_model` text NOT NULL,
	`token_reservation_id` text NOT NULL,
	`cost_reservation_id` text NOT NULL,
	`estimated_microusd` integer NOT NULL,
	`maximum_input_tokens` integer NOT NULL,
	`maximum_output_tokens` integer NOT NULL,
	`locale` text NOT NULL,
	`permission_epoch` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`lease_expires_at` text,
	`provider_submitted` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assistant_specialist_tasks_actor_user_id_scope_key_turn_id_task_kind_unique" UNIQUE (`actor_user_id`,`scope_key`,`turn_id`,`task_kind`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assistant_tasks_actor_scope` ON `assistant_specialist_tasks` (`actor_user_id`,`scope_key`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assistant_turns` (
	`turn_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text,
	`document_id` text,
	`route_family` text NOT NULL,
	`user_content_ref` text NOT NULL,
	`assistant_content_ref` text NOT NULL,
	`proposal_json` text,
	`permission_epoch` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text NOT NULL,
	PRIMARY KEY(`actor_user_id`, `scope_key`, `turn_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assistant_turns_actor_scope` ON `assistant_turns` (`actor_user_id`,`scope_key`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS assistant_billing_reconciliation_block_update BEFORE UPDATE ON assistant_billing_reconciliations BEGIN SELECT RAISE(ABORT,'assistant billing audit is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS assistant_billing_reconciliation_block_delete BEFORE DELETE ON assistant_billing_reconciliations BEGIN SELECT RAISE(ABORT,'assistant billing audit is append-only'); END;
