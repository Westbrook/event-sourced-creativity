CREATE TABLE `memory_scope_profile_checkpoints` (
	`target_enrollment_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`checked_at` text NOT NULL,
	`status` text NOT NULL,
	CONSTRAINT "memory_scope_profile_checkpoint_revision" CHECK(typeof(target_revision)='integer' AND target_revision>0),
	CONSTRAINT "memory_scope_profile_checkpoint_time" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',checked_at) IS checked_at),
	CONSTRAINT "memory_scope_profile_checkpoint_status" CHECK(status IN('stored','unchanged','unavailable'))
);
--> statement-breakpoint
CREATE TABLE `memory_scope_profile_snapshots` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_enrollment_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`manifest_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "memory_scope_profile_hash" CHECK(length(profile_id)=64 AND profile_id NOT GLOB '*[^a-f0-9]*'),
	CONSTRAINT "memory_scope_profile_revision" CHECK(typeof(target_revision)='integer' AND target_revision>0),
	CONSTRAINT "memory_scope_profile_manifest" CHECK(json_valid(manifest_json) AND json_type(manifest_json)='object' AND length(CAST(manifest_json AS BLOB))<=65536),
	CONSTRAINT "memory_scope_profile_created" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at),
	CONSTRAINT "memory_scope_profile_expiry" CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND expires_at>created_at)
);
--> statement-breakpoint
CREATE INDEX `idx_memory_scope_profile_target` ON `memory_scope_profile_snapshots` (`actor_user_id`,`target_enrollment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_memory_scope_profile_expiry` ON `memory_scope_profile_snapshots` (`expires_at`);
--> statement-breakpoint
CREATE TRIGGER memory_scope_profile_snapshot_immutable BEFORE UPDATE ON memory_scope_profile_snapshots
BEGIN SELECT RAISE(ABORT,'scope_profile_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_scope_profile_snapshot_no_replace BEFORE INSERT ON memory_scope_profile_snapshots
WHEN EXISTS(SELECT 1 FROM memory_scope_profile_snapshots WHERE profile_id=NEW.profile_id)
BEGIN SELECT RAISE(ABORT,'scope_profile_cannot_replace'); END;
--> statement-breakpoint
CREATE TRIGGER memory_scope_profile_checkpoint_identity BEFORE UPDATE ON memory_scope_profile_checkpoints
WHEN NEW.target_enrollment_id IS NOT OLD.target_enrollment_id OR NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.checked_at<OLD.checked_at
BEGIN SELECT RAISE(ABORT,'scope_profile_checkpoint_identity'); END;
