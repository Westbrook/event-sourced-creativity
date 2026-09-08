CREATE TABLE `memory_native_answer_dependencies` (
	`origin_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`event_stream_id` text NOT NULL,
	`event_id` text NOT NULL,
	`source_sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`recorded_at` text NOT NULL,
	`block_id` text,
	`turn_id` text,
	`user_content_id` text,
	`assistant_content_id` text,
	`projection_sha256` text NOT NULL,
	`source_retention_ceiling` text NOT NULL,
	`consumed` integer NOT NULL,
	`segment_enrollment_id` text,
	`segment_revision` integer,
	`segment_recipe` text,
	`segment_first_sequence` integer,
	`segment_last_sequence` integer,
	`segment_member_count` integer,
	`segment_ordinal` integer,
	`segment_created_at` text,
	`segment_retention_ceiling` text,
	PRIMARY KEY(`origin_id`, `ordinal`),
	FOREIGN KEY (`origin_id`) REFERENCES `memory_native_answer_origins`(`origin_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_native_answer_dependencies_check_1" CHECK(ordinal BETWEEN 0 AND 127 AND source_sequence>0 AND consumed IN(0,1)),
	CONSTRAINT "memory_native_answer_dependencies_check_2" CHECK(event_type='AssistantReasoned' AND turn_id IS NOT NULL AND user_content_id IS NOT NULL AND assistant_content_id IS NOT NULL OR event_type!='AssistantReasoned' AND turn_id IS NULL AND user_content_id IS NULL AND assistant_content_id IS NULL),
	CONSTRAINT "memory_native_answer_dependencies_check_3" CHECK(segment_enrollment_id IS NULL AND segment_revision IS NULL AND segment_recipe IS NULL AND segment_first_sequence IS NULL AND segment_last_sequence IS NULL AND segment_member_count IS NULL AND segment_ordinal IS NULL AND segment_created_at IS NULL AND segment_retention_ceiling IS NULL OR segment_enrollment_id IS NOT NULL AND segment_revision IS NOT NULL AND segment_recipe IS NOT NULL AND segment_first_sequence IS NOT NULL AND segment_last_sequence IS NOT NULL AND segment_member_count IS NOT NULL AND segment_ordinal IS NOT NULL AND segment_created_at IS NOT NULL AND segment_retention_ceiling IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_memory_native_origin_source` ON `memory_native_answer_dependencies` (`event_stream_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_native_origin_user_content` ON `memory_native_answer_dependencies` (`user_content_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_native_origin_answer_content` ON `memory_native_answer_dependencies` (`assistant_content_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_native_answer_dependencies_origin_id_event_id_unique` ON `memory_native_answer_dependencies` (`origin_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_native_answer_dependencies_origin_id_source_sequence_unique` ON `memory_native_answer_dependencies` (`origin_id`,`source_sequence`);--> statement-breakpoint
CREATE TABLE `memory_native_answer_origins` (
	`origin_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`recipe_version` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`turn_id` text NOT NULL,
	`user_event_id` text NOT NULL,
	`user_content_id` text NOT NULL,
	`user_source_sequence` integer NOT NULL,
	`user_sha256` text NOT NULL,
	`answer_event_id` text NOT NULL,
	`answer_content_id` text NOT NULL,
	`answer_source_sequence` integer NOT NULL,
	`answer_sha256` text NOT NULL,
	`answer_expires_at` text NOT NULL,
	`consumed_value_sha256` text NOT NULL,
	`dependency_list_sha256` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`enrollment_revision` integer NOT NULL,
	`policy_version` text NOT NULL,
	`permission_epoch` text NOT NULL,
	`enrolled_at` text NOT NULL,
	`enrollment_expires_at` text NOT NULL,
	`retention_days` integer NOT NULL,
	`selection_cursor` integer NOT NULL,
	`source_retention_ceiling` text NOT NULL,
	`dependency_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`withdrawn_at` text,
	`withdrawal_reason` text,
	CONSTRAINT "memory_native_answer_origins_check_1" CHECK(schema_version=1 AND recipe_version='native-answer-origin-v1'),
	CONSTRAINT "memory_native_answer_origins_check_2" CHECK((organization_id IS NULL)=(project_access_id IS NULL)),
	CONSTRAINT "memory_native_answer_origins_check_3" CHECK(enrollment_revision>0 AND retention_days BETWEEN 1 AND 365 AND selection_cursor>0 AND user_source_sequence>selection_cursor AND answer_source_sequence=user_source_sequence+1),
	CONSTRAINT "memory_native_answer_origins_check_4" CHECK(dependency_count BETWEEN 1 AND 128),
	CONSTRAINT "memory_native_answer_origins_check_5" CHECK(created_at<answer_expires_at AND answer_expires_at<=source_retention_ceiling),
	CONSTRAINT "memory_native_answer_origins_check_6" CHECK(status='active' AND withdrawn_at IS NULL AND withdrawal_reason IS NULL OR status='withdrawn' AND withdrawn_at IS NOT NULL AND withdrawal_reason IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_memory_native_origin_actor` ON `memory_native_answer_origins` (`actor_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_memory_native_origin_enrollment` ON `memory_native_answer_origins` (`enrollment_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_native_answer_origins_answer_event_id_unique` ON `memory_native_answer_origins` (`answer_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_native_answer_origins_user_event_id_unique` ON `memory_native_answer_origins` (`user_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_native_answer_origins_user_content_id_unique` ON `memory_native_answer_origins` (`user_content_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_native_answer_origins_answer_content_id_unique` ON `memory_native_answer_origins` (`answer_content_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_native_answer_origins_actor_user_id_scope_key_turn_id_unique` ON `memory_native_answer_origins` (`actor_user_id`,`scope_key`,`turn_id`);

--> statement-breakpoint
CREATE TRIGGER memory_native_origin_immutable BEFORE UPDATE ON memory_native_answer_origins
WHEN NOT (NEW.origin_id IS OLD.origin_id AND NEW.schema_version IS OLD.schema_version AND NEW.recipe_version IS OLD.recipe_version AND NEW.actor_user_id IS OLD.actor_user_id AND NEW.owner_user_id IS OLD.owner_user_id AND NEW.organization_id IS OLD.organization_id AND NEW.project_access_id IS OLD.project_access_id AND NEW.project_id IS OLD.project_id AND NEW.document_id IS OLD.document_id AND NEW.scope_key IS OLD.scope_key AND NEW.turn_id IS OLD.turn_id AND NEW.answer_event_id IS OLD.answer_event_id AND NEW.answer_content_id IS OLD.answer_content_id AND NEW.answer_source_sequence IS OLD.answer_source_sequence AND NEW.answer_sha256 IS OLD.answer_sha256 AND NEW.consumed_value_sha256 IS OLD.consumed_value_sha256 AND NEW.dependency_list_sha256 IS OLD.dependency_list_sha256 AND NEW.enrollment_id IS OLD.enrollment_id AND NEW.enrollment_revision IS OLD.enrollment_revision AND NEW.policy_version IS OLD.policy_version AND NEW.permission_epoch IS OLD.permission_epoch AND NEW.enrolled_at IS OLD.enrolled_at AND NEW.enrollment_expires_at IS OLD.enrollment_expires_at AND NEW.retention_days IS OLD.retention_days AND NEW.selection_cursor IS OLD.selection_cursor AND NEW.source_retention_ceiling IS OLD.source_retention_ceiling AND NEW.dependency_count IS OLD.dependency_count AND NEW.created_at IS OLD.created_at)
  OR NOT ((NEW.status IS OLD.status AND NEW.withdrawn_at IS OLD.withdrawn_at AND NEW.withdrawal_reason IS OLD.withdrawal_reason)
    OR (OLD.status='active' AND NEW.status='withdrawn' AND NEW.withdrawn_at IS NOT NULL AND NEW.withdrawal_reason IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'memory_native_origin_immutable'); END;

--> statement-breakpoint
CREATE TRIGGER memory_native_origin_user_immutable BEFORE UPDATE ON memory_native_answer_origins
WHEN NEW.user_event_id IS NOT OLD.user_event_id OR NEW.user_content_id IS NOT OLD.user_content_id
  OR NEW.user_source_sequence IS NOT OLD.user_source_sequence OR NEW.user_sha256 IS NOT OLD.user_sha256
  OR NEW.answer_expires_at IS NOT OLD.answer_expires_at
BEGIN SELECT RAISE(ABORT,'memory_native_origin_immutable'); END;

--> statement-breakpoint
CREATE TRIGGER memory_native_dependency_immutable BEFORE UPDATE ON memory_native_answer_dependencies
BEGIN SELECT RAISE(ABORT,'memory_native_dependency_immutable'); END;

--> statement-breakpoint
CREATE TRIGGER memory_native_origin_delete_active BEFORE DELETE ON memory_native_answer_origins WHEN OLD.status='active'
BEGIN SELECT RAISE(ABORT,'memory_native_origin_withdraw_first'); END;

--> statement-breakpoint
CREATE TRIGGER memory_native_dependency_delete_active BEFORE DELETE ON memory_native_answer_dependencies
WHEN EXISTS(SELECT 1 FROM memory_native_answer_origins WHERE origin_id=OLD.origin_id AND status='active')
BEGIN SELECT RAISE(ABORT,'memory_native_origin_withdraw_first'); END;
