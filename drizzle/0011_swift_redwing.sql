CREATE TABLE IF NOT EXISTS `capability_grants` (
	`grant_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`capability` text NOT NULL,
	`scope_type` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_capability_grants_user_status` ON `capability_grants` (`user_id`,`status`,`capability`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_capability_grants_organization` ON `capability_grants` (`organization_id`,`capability`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_memberships` (
	`membership_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`accepted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_organization_memberships_org_user` ON `organization_memberships` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_organization_memberships_user_status` ON `organization_memberships` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_projects` (
	`project_access_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_organization_projects_owner_project` ON `organization_projects` (`owner_user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_organization_projects_organization` ON `organization_projects` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_organization_projects_owner` ON `organization_projects` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizations` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_organizations_owner` ON `organizations` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_memberships` (
	`membership_id` text PRIMARY KEY NOT NULL,
	`project_access_id` text NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_project_memberships_access_user` ON `project_memberships` (`project_access_id`,`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_memberships_user_status` ON `project_memberships` (`user_id`,`status`);
