CREATE TABLE `event_private_payloads` (
	`private_event_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text,
	`document_id` text,
	`private_json` text NOT NULL,
	`created_at` text NOT NULL,
	`redacted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_event_private_payloads_owner_scope` ON `event_private_payloads` (`owner_id`,`project_id`,`document_id`,`redacted_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`stream_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`actor` text NOT NULL,
	`client_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`causation_id` text,
	`compensates_event_id` text,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_events_stream_sequence` ON `events` (`stream_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_events_stream_type` ON `events` (`stream_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_events_correlation` ON `events` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `idx_events_stream_actor` ON `events` (`stream_id`,`actor`);--> statement-breakpoint
CREATE INDEX `idx_events_nonphantom_stream_sequence` ON `events` (`stream_id`,`sequence`) WHERE NOT (
  type='AttentionEpisodeObserved'
  AND COALESCE(json_extract(payload,'$.capture_version'),'') IN ('attention-v1','attention-v2')
  AND COALESCE(json_extract(payload,'$.terminal_type'),'')='idle_timeout'
  AND COALESCE(json_extract(payload,'$.terminal_ref'),'')=''
  AND COALESCE(CAST(json_extract(payload,'$.active_ms') AS REAL),-1)=30000
  AND COALESCE(CAST(json_extract(payload,'$.idle_ms') AS REAL),-1)>=30000
  AND COALESCE(json_extract(payload,'$.surface'),'')<>''
  AND COALESCE(json_extract(payload,'$.context'),'')=COALESCE(json_extract(payload,'$.surface'),'')||'-overview'
  AND COALESCE(json_type(payload,'$.visible_refs'),'')='array'
  AND json_array_length(payload,'$.visible_refs')=0
  AND COALESCE(CAST(json_extract(payload,'$.friction_score') AS REAL),0)<.45
  AND COALESCE(CAST(json_extract(payload,'$.outcome_weight') AS REAL),0)<.18
);--> statement-breakpoint
CREATE INDEX `idx_events_type_occurred_stream` ON `events` (`type`,`occurred_at`,`stream_id`);--> statement-breakpoint
CREATE TABLE `n10h_guard` (
	`ok` integer NOT NULL,
	CONSTRAINT "one_change" CHECK(ok=1)
);
--> statement-breakpoint
CREATE TABLE `organization_projects` (
	`project_access_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_organization_projects_owner_project` ON `organization_projects` (`owner_user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_organization_projects_organization` ON `organization_projects` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_organization_projects_owner` ON `organization_projects` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `pilot_cohorts` (
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
CREATE UNIQUE INDEX `idx_pilot_cohorts_active_organization` ON `pilot_cohorts` (`organization_id`) WHERE "pilot_cohorts"."status"='active';--> statement-breakpoint
CREATE INDEX `idx_pilot_cohorts_organization_status` ON `pilot_cohorts` (`organization_id`,`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `pilot_participants` (
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
CREATE UNIQUE INDEX `idx_pilot_participants_cohort_email` ON `pilot_participants` (`cohort_id`,`email_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pilot_participants_cohort_user` ON `pilot_participants` (`cohort_id`,`user_id`) WHERE "pilot_participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_pilot_participants_organization_status` ON `pilot_participants` (`organization_id`,`status`,`user_id`);--> statement-breakpoint
CREATE TABLE `project_event_scopes` (
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
CREATE UNIQUE INDEX `idx_project_event_scopes_sequence` ON `project_event_scopes` (`project_access_id`,`project_sequence`);--> statement-breakpoint
CREATE INDEX `idx_project_event_scopes_owner` ON `project_event_scopes` (`owner_user_id`,`source_sequence`);--> statement-breakpoint
CREATE TABLE `project_resource_scopes` (
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
CREATE INDEX `idx_project_resource_scopes_resource` ON `project_resource_scopes` (`resource_kind`,`resource_id`,`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_project_resource_scopes_owner_kind_actor` ON `project_resource_scopes` (`owner_user_id`,`resource_kind`,`resource_id`,`actor_user_id`);--> statement-breakpoint
CREATE TABLE `n10h_run` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`phase` text NOT NULL,
	`next` integer NOT NULL,
	`started` integer NOT NULL,
	`cleanup` integer NOT NULL,
	`reads` integer NOT NULL,
	`writes` integer NOT NULL,
	`report` text
);
