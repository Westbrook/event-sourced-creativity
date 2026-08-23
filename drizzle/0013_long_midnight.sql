CREATE TABLE IF NOT EXISTS `budget_scope_policies` (
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`token_limit` integer NOT NULL,
	`microusd_limit` integer NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`scope`, `scope_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_budget_scope_policies_organization` ON `budget_scope_policies` (`organization_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_audit_events` (
	`audit_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_organization_audit_scope_time` ON `organization_audit_events` (`organization_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_invitations` (
	`invitation_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email_normalized` text NOT NULL,
	`role` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`accepted_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_organization_invitations_token` ON `organization_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_organization_invitations_email_status` ON `organization_invitations` (`email_normalized`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_organization_invitations_organization` ON `organization_invitations` (`organization_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_budget_reservation_scopes` (
	`reservation_kind` text NOT NULL,
	`reservation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_access_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`workspace_scope_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`reservation_kind`, `reservation_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_budget_scope_organization` ON `project_budget_reservation_scopes` (`organization_id`,`project_access_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_context_sessions` (
	`context_id` text PRIMARY KEY NOT NULL,
	`principal_user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_access_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_context_principal_scope` ON `project_context_sessions` (`principal_user_id`,`organization_id`,`project_access_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_event_scopes` (
	`event_id` text PRIMARY KEY NOT NULL,
	`project_access_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`source_stream_id` text NOT NULL,
	`source_sequence` integer NOT NULL,
	`project_sequence` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_project_event_scopes_sequence` ON `project_event_scopes` (`project_access_id`,`project_sequence`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_event_scopes_owner` ON `project_event_scopes` (`owner_user_id`,`source_sequence`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_migration_states` (
	`project_access_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_owner_sequence` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_migration_organization_status` ON `project_migration_states` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_resource_scopes` (
	`project_access_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`visibility` text DEFAULT 'collaborative_output' NOT NULL,
	`source_event_id` text,
	`actor_user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_access_id`, `resource_kind`, `resource_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_resource_scopes_resource` ON `project_resource_scopes` (`resource_kind`,`resource_id`,`owner_user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `route_performance_samples` (
	`sample_id` text PRIMARY KEY NOT NULL,
	`audience` text NOT NULL,
	`route_family` text NOT NULL,
	`route_surface` text NOT NULL,
	`cache_class` text NOT NULL,
	`route_latency_ms` integer NOT NULL,
	`lcp_ms` integer,
	`inp_ms` integer,
	`cls_microunits` integer,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_route_performance_surface_time` ON `route_performance_samples` (`audience`,`route_family`,`recorded_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_route_performance_recorded_at` ON `route_performance_samples` (`recorded_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cost_budget_reservations_workspace_period_status` ON `cost_budget_reservations` (`workspace_id`,`period`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_events_type_occurred_stream` ON `events` (`type`,`occurred_at`,`stream_id`);
