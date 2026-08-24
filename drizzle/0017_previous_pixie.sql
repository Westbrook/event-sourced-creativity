CREATE TABLE IF NOT EXISTS `organization_context_package_contents` (
	`version_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`content_json` text NOT NULL,
	`created_at` text NOT NULL,
	`redacted_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_context_package_contents_scope` ON `organization_context_package_contents` (`organization_id`,`redacted_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_context_package_sources` (
	`version_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`source_project_access_id` text NOT NULL,
	`source_block_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`content_sha256` text NOT NULL,
	`rights_expires_at` text,
	`position` integer NOT NULL,
	PRIMARY KEY(`version_id`, `source_block_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_context_sources_scope` ON `organization_context_package_sources` (`organization_id`,`source_project_access_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_context_package_versions` (
	`version_id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_sha256` text NOT NULL,
	`source_project_access_id` text NOT NULL,
	`source_document_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`approved_by_user_id` text,
	`published_at` text,
	`created_at` text NOT NULL,
	`redacted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_org_context_package_version` ON `organization_context_package_versions` (`package_id`,`version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_context_versions_scope` ON `organization_context_package_versions` (`organization_id`,`package_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_context_packages` (
	`package_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_context_packages_scope` ON `organization_context_packages` (`organization_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_custody_transfers` (
	`transfer_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_access_id` text,
	`source_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`status` text NOT NULL,
	`manifest_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_custody_transfer_scope` ON `organization_custody_transfers` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_deletion_items` (
	`job_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`job_id`, `resource_kind`, `resource_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_deletion_items_status` ON `organization_deletion_items` (`job_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_deletion_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`initiated_by_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`inventory_json` text DEFAULT '{}' NOT NULL,
	`receipt_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_deletion_jobs_scope` ON `organization_deletion_jobs` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_identity_bindings` (
	`binding_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`authentication_source` text NOT NULL,
	`subject` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_org_identity_binding_user` ON `organization_identity_bindings` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_identity_binding_subject` ON `organization_identity_bindings` (`organization_id`,`authentication_source`,`subject`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_identity_group_members` (
	`group_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_identity_group_members_user` ON `organization_identity_group_members` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_identity_groups` (
	`group_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`mapped_role` text DEFAULT 'member' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_org_identity_group_external` ON `organization_identity_groups` (`organization_id`,`external_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_key_versions` (
	`key_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`algorithm` text DEFAULT 'AES-GCM-256' NOT NULL,
	`wrapped_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`retired_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_org_key_version` ON `organization_key_versions` (`organization_id`,`version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_key_active` ON `organization_key_versions` (`organization_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_org_key_one_active` ON `organization_key_versions` (`organization_id`) WHERE `status`='active';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_legal_holds` (
	`hold_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`released_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_legal_holds_scope` ON `organization_legal_holds` (`organization_id`,`status`,`scope_kind`,`resource_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_provisioning_credentials` (
	`credential_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_org_provisioning_token_hash` ON `organization_provisioning_credentials` (`token_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_provisioning_scope` ON `organization_provisioning_credentials` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_recovery_drills` (
	`drill_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`restored_record_count` integer DEFAULT 0 NOT NULL,
	`verified_object_count` integer DEFAULT 0 NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_recovery_drills_scope` ON `organization_recovery_drills` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_recovery_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`key_id` text NOT NULL,
	`manifest_json` text NOT NULL,
	`encrypted_payload` text NOT NULL,
	`content_sha256` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_org_recovery_snapshots_scope` ON `organization_recovery_snapshots` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_security_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`authentication_source` text DEFAULT 'any' NOT NULL,
	`allowed_domains_json` text DEFAULT '[]' NOT NULL,
	`require_mfa` integer DEFAULT false NOT NULL,
	`encryption_mode` text DEFAULT 'platform-unverified' NOT NULL,
	`max_session_minutes` integer DEFAULT 480 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_automation_outbox` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_access_id` text NOT NULL,
	`task_id` text,
	`recipient_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`destination` text DEFAULT 'in-app' NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`available_at` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`delivered_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_project_automation_outbox_idempotency` ON `project_automation_outbox` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_automation_outbox_pending` ON `project_automation_outbox` (`organization_id`,`status`,`available_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_automation_policies` (
	`project_access_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`notify_context_changes` integer DEFAULT true NOT NULL,
	`notify_output_ready` integer DEFAULT true NOT NULL,
	`review_due_hours` integer DEFAULT 48 NOT NULL,
	`reminder_hours` integer DEFAULT 24 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_automation_policy_org` ON `project_automation_policies` (`organization_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_automation_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`project_access_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`event_id` text NOT NULL,
	`rule_kind` text NOT NULL,
	`status` text NOT NULL,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_project_automation_run_event_rule` ON `project_automation_runs` (`project_access_id`,`event_id`,`rule_kind`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_automation_runs_scope` ON `project_automation_runs` (`organization_id`,`project_access_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_context_package_bindings` (
	`binding_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_access_id` text NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`package_id` text NOT NULL,
	`version_id` text NOT NULL,
	`update_mode` text DEFAULT 'pinned' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pending_version_id` text,
	`created_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_project_context_binding_document_package` ON `project_context_package_bindings` (`project_access_id`,`document_id`,`package_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_context_binding_package` ON `project_context_package_bindings` (`organization_id`,`package_id`,`update_mode`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_context_package_members` (
	`binding_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`source_block_id` text NOT NULL,
	`target_block_id` text NOT NULL,
	`content_sha256` text NOT NULL,
	PRIMARY KEY(`binding_id`, `source_block_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_context_member_target` ON `project_context_package_members` (`organization_id`,`target_block_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_review_tasks` (
	`task_id` text PRIMARY KEY NOT NULL,
	`project_access_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`document_id` text NOT NULL,
	`request_event_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`assigned_user_id` text NOT NULL,
	`artifact_revision` integer DEFAULT 0 NOT NULL,
	`content_sha256` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_at` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_project_review_task_event_assignee` ON `project_review_tasks` (`project_access_id`,`request_event_id`,`assigned_user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_review_tasks_assigned` ON `project_review_tasks` (`assigned_user_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_review_tasks_artifact` ON `project_review_tasks` (`project_access_id`,`artifact_id`,`status`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_context_package_version_immutable`
BEFORE UPDATE ON `organization_context_package_versions`
WHEN OLD.status='published' AND (
  NEW.version_id<>OLD.version_id OR NEW.status<>OLD.status OR NEW.package_id<>OLD.package_id OR NEW.organization_id<>OLD.organization_id OR NEW.version<>OLD.version
  OR NEW.content_sha256<>OLD.content_sha256 OR NEW.source_project_access_id<>OLD.source_project_access_id
  OR NEW.source_document_id<>OLD.source_document_id OR NEW.created_by_user_id<>OLD.created_by_user_id
  OR COALESCE(NEW.approved_by_user_id,'')<>COALESCE(OLD.approved_by_user_id,'')
  OR COALESCE(NEW.published_at,'')<>COALESCE(OLD.published_at,'')
)
BEGIN SELECT RAISE(ABORT,'published_context_package_is_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_context_package_content_immutable`
BEFORE UPDATE OF content_json ON `organization_context_package_contents`
WHEN EXISTS(
  SELECT 1 FROM organization_context_package_versions version
  WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published'
) AND NEW.content_json<>OLD.content_json
BEGIN SELECT RAISE(ABORT,'published_context_package_content_is_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_audit_block_update`
BEFORE UPDATE ON `organization_audit_events`
BEGIN SELECT RAISE(ABORT,'organization audit is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_audit_block_delete`
BEFORE DELETE ON `organization_audit_events`
BEGIN SELECT RAISE(ABORT,'organization audit is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_context_package_source_immutable`
BEFORE UPDATE ON `organization_context_package_sources`
WHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published')
BEGIN SELECT RAISE(ABORT,'published_context_package_source_is_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_context_package_source_delete_guard`
BEFORE DELETE ON `organization_context_package_sources`
WHEN EXISTS(SELECT 1 FROM organization_context_package_versions version WHERE version.version_id=OLD.version_id AND version.organization_id=OLD.organization_id AND version.status='published')
  AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=OLD.organization_id AND deletion.status='processing')
BEGIN SELECT RAISE(ABORT,'published_context_package_source_is_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_context_package_version_delete_guard`
BEFORE DELETE ON `organization_context_package_versions`
WHEN OLD.status='published' AND NOT EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=OLD.organization_id AND deletion.status='processing')
BEGIN SELECT RAISE(ABORT,'published_context_package_is_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_legal_hold_during_deletion_guard`
BEFORE INSERT ON `organization_legal_holds`
WHEN NEW.status='active' AND(NOT EXISTS(SELECT 1 FROM organizations governed WHERE governed.organization_id=NEW.organization_id AND governed.status='active')
  OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing','completed')))
BEGIN SELECT RAISE(ABORT,'organization_deletion_in_progress'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_deletion_active_hold_guard`
BEFORE INSERT ON `organization_deletion_jobs`
WHEN EXISTS(SELECT 1 FROM organization_legal_holds hold WHERE hold.organization_id=NEW.organization_id AND hold.status='active')
  OR EXISTS(SELECT 1 FROM organization_retention_policies policy WHERE policy.organization_id=NEW.organization_id AND policy.legal_hold=1)
  OR EXISTS(SELECT 1 FROM organization_recovery_snapshots recovery WHERE recovery.organization_id=NEW.organization_id AND recovery.status='staging')
  OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing'))
BEGIN SELECT RAISE(ABORT,'organization_deletion_blocked'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_retention_hold_during_deletion_guard`
BEFORE UPDATE OF legal_hold ON `organization_retention_policies`
WHEN NEW.legal_hold=1 AND(NOT EXISTS(SELECT 1 FROM organizations governed WHERE governed.organization_id=NEW.organization_id AND governed.status='active')
  OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing','completed')))
BEGIN SELECT RAISE(ABORT,'organization_deletion_in_progress'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `organization_retention_hold_insert_during_deletion_guard`
BEFORE INSERT ON `organization_retention_policies`
WHEN NEW.legal_hold=1 AND(NOT EXISTS(SELECT 1 FROM organizations governed WHERE governed.organization_id=NEW.organization_id AND governed.status='active')
  OR EXISTS(SELECT 1 FROM organization_deletion_jobs deletion WHERE deletion.organization_id=NEW.organization_id AND deletion.status IN('pending','partial','processing','completed')))
BEGIN SELECT RAISE(ABORT,'organization_deletion_in_progress'); END;
