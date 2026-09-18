CREATE TABLE `memory_live_change_checkpoints` (
	`enrollment_id` text PRIMARY KEY NOT NULL,
	`enrollment_revision` integer NOT NULL,
	`generation` text NOT NULL,
	`after_sequence` integer NOT NULL,
	`through_sequence` integer NOT NULL,
	`observed_references` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`enrollment_id`) REFERENCES `memory_live_enrollments`(`enrollment_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memory_live_checkpoint_bounds" CHECK(typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(after_sequence)='integer' AND after_sequence BETWEEN 0 AND 9007199254740990 AND typeof(through_sequence)='integer' AND through_sequence BETWEEN 1 AND 9007199254740991 AND through_sequence>after_sequence AND typeof(observed_references)='integer' AND observed_references BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "memory_live_checkpoint_generation" CHECK(length(generation)=32 AND generation NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_live_checkpoint_time" CHECK(length(created_at)=24 AND length(updated_at)=24 AND length(expires_at)=24 AND created_at<=updated_at AND updated_at<expires_at)
);
--> statement-breakpoint
CREATE INDEX `idx_memory_live_checkpoint_expiry` ON `memory_live_change_checkpoints` (`expires_at`,`enrollment_id`);
--> statement-breakpoint
CREATE TRIGGER memory_live_checkpoint_enrollment_changed AFTER UPDATE OF actor_user_id,owner_user_id,organization_id,project_access_id,project_id,document_id,permission_epoch,policy_version,revision,learn_enabled,recall_enabled,background_enabled,retention_days,enrolled_at,expires_at ON memory_live_enrollments
WHEN OLD.actor_user_id IS NOT NEW.actor_user_id OR OLD.owner_user_id IS NOT NEW.owner_user_id OR OLD.organization_id IS NOT NEW.organization_id OR OLD.project_access_id IS NOT NEW.project_access_id OR OLD.project_id IS NOT NEW.project_id OR OLD.document_id IS NOT NEW.document_id OR OLD.permission_epoch IS NOT NEW.permission_epoch OR OLD.policy_version IS NOT NEW.policy_version OR OLD.revision IS NOT NEW.revision OR OLD.learn_enabled IS NOT NEW.learn_enabled OR OLD.recall_enabled IS NOT NEW.recall_enabled OR OLD.background_enabled IS NOT NEW.background_enabled OR OLD.retention_days IS NOT NEW.retention_days OR OLD.enrolled_at IS NOT NEW.enrolled_at OR OLD.expires_at IS NOT NEW.expires_at
BEGIN
  DELETE FROM memory_live_change_checkpoints WHERE enrollment_id=OLD.enrollment_id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_live_checkpoint_source_deleted AFTER DELETE ON memory_live_sources
BEGIN
  DELETE FROM memory_live_change_checkpoints WHERE enrollment_id=OLD.enrollment_id;
END;
--> statement-breakpoint
CREATE TRIGGER memory_live_checkpoint_source_changed AFTER UPDATE OF enrollment_id,event_id,sequence,expires_at ON memory_live_sources
WHEN OLD.enrollment_id IS NOT NEW.enrollment_id OR OLD.event_id IS NOT NEW.event_id OR OLD.sequence IS NOT NEW.sequence OR OLD.expires_at IS NOT NEW.expires_at
BEGIN
  DELETE FROM memory_live_change_checkpoints WHERE enrollment_id IN(OLD.enrollment_id,NEW.enrollment_id);
END;
