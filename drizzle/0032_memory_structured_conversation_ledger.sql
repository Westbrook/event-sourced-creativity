CREATE TABLE `memory_structured_conversation_heads` (
	`ledger_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`enrollment_id` text,
	`enrollment_revision` integer,
	`permission_epoch` text,
	`policy_version` text,
	`storage_revision` integer NOT NULL,
	`current_body_ref` text,
	`current_body_hash` text,
	`annotation_count` integer,
	`coverage_after_sequence` integer,
	`coverage_through_sequence` integer,
	`state` text NOT NULL,
	`first_terminal_at` text,
	`cleanup_turn` integer DEFAULT 0 NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "memory_structured_heads_key" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_structured_heads_scope" CHECK(length(actor_user_id)>0 AND length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))),
	CONSTRAINT "memory_structured_heads_counters" CHECK(typeof(storage_revision)='integer' AND storage_revision BETWEEN 1 AND 9007199254740991 AND typeof(cleanup_turn)='integer' AND cleanup_turn BETWEEN 0 AND 3 AND (state!='retired' OR cleanup_turn=0)),
	CONSTRAINT "memory_structured_heads_times" CHECK(length(created_at)>0 AND created_at<=updated_at AND (first_terminal_at IS NULL OR (created_at<=first_terminal_at AND first_terminal_at<=updated_at))),
	CONSTRAINT "memory_structured_heads_state" CHECK((state='active' AND first_terminal_at IS NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND current_body_ref IS NOT NULL AND current_body_hash IS NOT NULL AND annotation_count IS NOT NULL AND coverage_after_sequence IS NOT NULL AND coverage_through_sequence IS NOT NULL AND expires_at IS NOT NULL) OR (state IN('retiring','retired') AND first_terminal_at IS NOT NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND current_body_ref IS NULL AND current_body_hash IS NULL AND annotation_count IS NULL AND coverage_after_sequence IS NULL AND coverage_through_sequence IS NULL AND expires_at IS NULL)),
	CONSTRAINT "memory_structured_heads_active" CHECK(state!='active' OR (storage_revision BETWEEN 1 AND 64 AND length(enrollment_id)>0 AND typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND length(permission_epoch)>0 AND length(policy_version)>0 AND length(current_body_ref)>0 AND length(current_body_hash)=64 AND current_body_hash NOT GLOB '*[^0-9a-f]*' AND typeof(annotation_count)='integer' AND annotation_count BETWEEN 1 AND 256 AND typeof(coverage_after_sequence)='integer' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)='integer' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence AND created_at<expires_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_heads_personal` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`project_id`,`document_id`) WHERE organization_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_heads_shared` ON `memory_structured_conversation_heads` (`actor_user_id`,`owner_user_id`,`organization_id`,`project_access_id`,`project_id`,`document_id`) WHERE organization_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_memory_structured_heads_enrollment` ON `memory_structured_conversation_heads` (`enrollment_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_heads_organization` ON `memory_structured_conversation_heads` (`organization_id`,`actor_user_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_heads_cleanup` ON `memory_structured_conversation_heads` (`state`,`expires_at`,`ledger_id`);--> statement-breakpoint
CREATE TABLE `memory_structured_conversation_revisions` (
	`ledger_id` text NOT NULL,
	`revision` integer NOT NULL,
	`predecessor_revision` integer NOT NULL,
	`predecessor_hash` text,
	`body_ref` text NOT NULL,
	`body_hash` text NOT NULL,
	`schema_version` integer NOT NULL,
	`recipe_version` text NOT NULL,
	`annotation_count` integer NOT NULL,
	`coverage_after_sequence` integer NOT NULL,
	`coverage_through_sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`ledger_id`, `revision`),
	FOREIGN KEY (`ledger_id`) REFERENCES `memory_structured_conversation_heads`(`ledger_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_structured_revisions_version" CHECK(typeof(schema_version)='integer' AND schema_version=1 AND recipe_version='native-declared-ledger-v1'),
	CONSTRAINT "memory_structured_revisions_identity" CHECK(length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_structured_revisions_chain" CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 64 AND typeof(predecessor_revision)='integer' AND ((revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (revision>1 AND predecessor_revision=revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT "memory_structured_revisions_bounds" CHECK(typeof(annotation_count)='integer' AND annotation_count BETWEEN 1 AND 256 AND typeof(coverage_after_sequence)='integer' AND coverage_after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(coverage_through_sequence)='integer' AND coverage_through_sequence BETWEEN 1 AND 9007199254740991 AND coverage_through_sequence>coverage_after_sequence),
	CONSTRAINT "memory_structured_revisions_times" CHECK(length(created_at)>0 AND created_at<expires_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_revisions_body` ON `memory_structured_conversation_revisions` (`body_ref`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_revisions_expiry` ON `memory_structured_conversation_revisions` (`expires_at`,`ledger_id`,`revision`);
