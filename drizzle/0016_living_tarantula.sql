CREATE TABLE IF NOT EXISTS `artifact_revisions` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`revision` integer NOT NULL,
	`content_json` text NOT NULL,
	`content_sha256` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`redacted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_artifact_revisions_owner_artifact_revision` ON `artifact_revisions` (`owner_id`,`artifact_id`,`revision`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_artifact_revisions_project_artifact` ON `artifact_revisions` (`project_access_id`,`artifact_id`,`revision`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_artifact_revisions_expiry` ON `artifact_revisions` (`expires_at`) WHERE "artifact_revisions"."redacted_at" IS NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_retention_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`transient_days` integer DEFAULT 30 NOT NULL,
	`evidence_days` integer DEFAULT 365 NOT NULL,
	`revision_days` integer DEFAULT 365 NOT NULL,
	`legal_hold` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pilot_cohorts` (
	`cohort_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`max_participants` integer DEFAULT 10 NOT NULL,
	`participant_cap_microusd` integer DEFAULT 15000000 NOT NULL,
	`organization_cap_microusd` integer DEFAULT 150000000 NOT NULL,
	`source_classification` text DEFAULT 'non-sensitive-licensed' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_pilot_cohorts_active_organization` ON `pilot_cohorts` (`organization_id`) WHERE "pilot_cohorts"."status"='active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pilot_cohorts_organization_status` ON `pilot_cohorts` (`organization_id`,`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pilot_cost_reservation_scopes` (
	`reservation_id` text PRIMARY KEY NOT NULL,
	`cohort_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pilot_cost_reservation_cohort_actor` ON `pilot_cost_reservation_scopes` (`cohort_id`,`actor_user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pilot_participants` (
	`participant_id` text PRIMARY KEY NOT NULL,
	`cohort_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`email_normalized` text NOT NULL,
	`user_id` text,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_pilot_participants_cohort_email` ON `pilot_participants` (`cohort_id`,`email_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_pilot_participants_cohort_user` ON `pilot_participants` (`cohort_id`,`user_id`) WHERE "pilot_participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pilot_participants_organization_status` ON `pilot_participants` (`organization_id`,`status`,`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `private_content_retention_scopes` (
	`content_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_access_id` text NOT NULL,
	`project_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`classification` text NOT NULL,
	`policy_version` integer NOT NULL,
	`assigned_expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_private_content_retention_organization_expiry` ON `private_content_retention_scopes` (`organization_id`,`assigned_expires_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `retention_sweep_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`trigger_kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`remaining_count` integer DEFAULT 0 NOT NULL,
	`oldest_expired_at` text,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_retention_sweep_runs_started` ON `retention_sweep_runs` (`started_at`,`status`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS pilot_project_owner_membership_guard BEFORE UPDATE OF status ON organization_memberships
  WHEN NEW.status='revoked' AND OLD.status!='revoked'
    AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS pilot_project_owner_participant_guard BEFORE UPDATE OF status,revoked_at ON pilot_participants
  WHEN (NEW.status='revoked' OR NEW.revoked_at IS NOT NULL) AND OLD.status='active' AND OLD.revoked_at IS NULL AND OLD.user_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.cohort_id=OLD.cohort_id AND cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS pilot_project_owner_membership_deletion_guard BEFORE DELETE ON organization_memberships
  WHEN EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS pilot_project_owner_participant_deletion_guard BEFORE DELETE ON pilot_participants
  WHEN OLD.status='active' AND OLD.revoked_at IS NULL AND OLD.user_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.cohort_id=OLD.cohort_id AND cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS pilot_active_cohort_deletion_guard BEFORE DELETE ON pilot_cohorts
  WHEN OLD.status IN ('active','paused')
  BEGIN
    SELECT RAISE(ABORT,'active_pilot_cannot_be_deleted');
  END;
