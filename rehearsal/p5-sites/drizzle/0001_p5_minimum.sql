CREATE TRIGGER `events_block_update`
BEFORE UPDATE ON `events` BEGIN
	SELECT RAISE(ABORT, 'events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `events_block_delete`
BEFORE DELETE ON `events` BEGIN
	SELECT RAISE(ABORT, 'events are append-only');
END;
--> statement-breakpoint
CREATE TABLE `budget_counters` (
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`period` text NOT NULL,
	`used_tokens` integer DEFAULT 0 NOT NULL,
	`reserved_tokens` integer DEFAULT 0 NOT NULL,
	`hard_limit_tokens` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`scope`, `scope_id`, `period`)
);
--> statement-breakpoint
CREATE TABLE `private_content` (
	`content_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`redacted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_private_content_owner_expiry` ON `private_content` (`owner_id`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'creator' NOT NULL,
	`consent_version` text,
	`consented_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);
--> statement-breakpoint
CREATE INDEX `idx_users_role` ON `users` (`role`);
--> statement-breakpoint
CREATE TABLE `document_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`stream_id` text NOT NULL,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`source_surface` text NOT NULL,
	`correlation_id` text NOT NULL,
	`requested_sequence` integer NOT NULL,
	`request_json` text NOT NULL,
	`result_json` text,
	`error_message` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`requested_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`lease_expires_at` text,
	`notified_at` text,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
, scene_source_version_json TEXT, scene_source_protocol INTEGER NOT NULL DEFAULT 0 CHECK(scene_source_protocol IN(0,1)));
--> statement-breakpoint
CREATE INDEX `idx_document_jobs_owner_status` ON `document_jobs` (`owner_id`,`status`,`requested_at`);
--> statement-breakpoint
CREATE INDEX `idx_document_jobs_stream_document` ON `document_jobs` (`stream_id`,`document_id`,`requested_at`);
--> statement-breakpoint
CREATE TABLE `cost_budget_counters` (
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`period` text NOT NULL,
	`used_microusd` integer DEFAULT 0 NOT NULL,
	`reserved_microusd` integer DEFAULT 0 NOT NULL,
	`hard_limit_microusd` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`scope`, `scope_id`, `period`)
);
--> statement-breakpoint
CREATE TABLE `budget_reservations` (
	`reservation_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`stream_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`operation` text NOT NULL,
	`period` text NOT NULL,
	`reserved_tokens` integer NOT NULL,
	`used_tokens` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`settlement_reason` text,
	`created_at` text NOT NULL,
	`settled_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_budget_reservations_owner_status` ON `budget_reservations` (`owner_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_budget_reservations_correlation` ON `budget_reservations` (`correlation_id`);
--> statement-breakpoint
CREATE TABLE `canvas_governance_requirements` (
	`requirement_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`approved_by_user_id` text,
	`approved_by_name` text,
	`approved_at` text,
	`evidence_ref` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_budget_reservations` (
	`reservation_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workspace_id` text DEFAULT 'forma' NOT NULL,
	`stream_id` text DEFAULT '' NOT NULL,
	`correlation_id` text DEFAULT '' NOT NULL,
	`operation` text NOT NULL,
	`period` text NOT NULL,
	`reserved_microusd` integer NOT NULL,
	`used_microusd` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`allow_user_overage` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`settled_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cost_budget_reservations_owner_status_period` ON `cost_budget_reservations` (`owner_id`,`status`,`period`);
--> statement-breakpoint
CREATE INDEX `idx_cost_budget_reservations_owner_correlation` ON `cost_budget_reservations` (`owner_id`,`correlation_id`);
--> statement-breakpoint
CREATE TABLE `capability_grants` (
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
CREATE INDEX `idx_capability_grants_user_status` ON `capability_grants` (`user_id`,`status`,`capability`);
--> statement-breakpoint
CREATE INDEX `idx_capability_grants_organization` ON `capability_grants` (`organization_id`,`capability`);
--> statement-breakpoint
CREATE TABLE `organization_memberships` (
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
CREATE UNIQUE INDEX `idx_organization_memberships_org_user` ON `organization_memberships` (`organization_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_organization_memberships_user_status` ON `organization_memberships` (`user_id`,`status`);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_organizations_owner` ON `organizations` (`owner_user_id`);
--> statement-breakpoint
CREATE TABLE `project_memberships` (
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
CREATE UNIQUE INDEX `idx_project_memberships_access_user` ON `project_memberships` (`project_access_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_project_memberships_user_status` ON `project_memberships` (`user_id`,`status`);
--> statement-breakpoint
CREATE TABLE `project_budget_reservation_scopes` (
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
CREATE INDEX `idx_project_budget_scope_organization` ON `project_budget_reservation_scopes` (`organization_id`,`project_access_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_cost_budget_reservations_workspace_period_status` ON `cost_budget_reservations` (`workspace_id`,`period`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_document_jobs_stream_status_requested` ON `document_jobs` (`stream_id`,`status`,`requested_at`,`job_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_jobs_stream_correlation` ON `document_jobs` (`stream_id`,`correlation_id`,`job_id`,`owner_id`);
--> statement-breakpoint
CREATE INDEX `idx_private_content_pending_expiry` ON `private_content` (`expires_at`) WHERE "private_content"."redacted_at" IS NULL AND "private_content"."kind"!='document-artifact';
--> statement-breakpoint
CREATE TABLE `pilot_cost_reservation_scopes` (
	`reservation_id` text PRIMARY KEY NOT NULL,
	`cohort_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pilot_cost_reservation_cohort_actor` ON `pilot_cost_reservation_scopes` (`cohort_id`,`actor_user_id`);
--> statement-breakpoint
CREATE TABLE `private_content_retention_scopes` (
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
CREATE INDEX `idx_private_content_retention_organization_expiry` ON `private_content_retention_scopes` (`organization_id`,`assigned_expires_at`);
--> statement-breakpoint
CREATE TRIGGER pilot_project_owner_membership_guard BEFORE UPDATE OF status ON organization_memberships
  WHEN NEW.status='revoked' AND OLD.status!='revoked'
    AND EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END;
--> statement-breakpoint
CREATE TRIGGER pilot_project_owner_membership_deletion_guard BEFORE DELETE ON organization_memberships
  WHEN EXISTS(SELECT 1 FROM pilot_cohorts cohort WHERE cohort.organization_id=OLD.organization_id AND cohort.status IN ('active','paused'))
    AND EXISTS(SELECT 1 FROM organization_projects project WHERE project.organization_id=OLD.organization_id AND project.owner_user_id=OLD.user_id AND project.status IN('indexing','active'))
  BEGIN
    SELECT RAISE(ABORT,'project_owner_transfer_required');
  END;
--> statement-breakpoint
CREATE TRIGGER pilot_active_cohort_deletion_guard BEFORE DELETE ON pilot_cohorts
  WHEN OLD.status IN ('active','paused')
  BEGIN
    SELECT RAISE(ABORT,'active_pilot_cannot_be_deleted');
  END;
--> statement-breakpoint
CREATE TABLE `organization_identity_bindings` (
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
CREATE UNIQUE INDEX `idx_org_identity_binding_user` ON `organization_identity_bindings` (`organization_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_org_identity_binding_subject` ON `organization_identity_bindings` (`organization_id`,`authentication_source`,`subject`);
--> statement-breakpoint
CREATE TABLE `organization_security_policies` (
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
CREATE TABLE `consequential_execution_steps` (
	`execution_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`token_reservation_id` text NOT NULL,
	`cost_reservation_id` text NOT NULL,
	`maximum_tokens` integer NOT NULL,
	`maximum_microusd` integer NOT NULL,
	`status` text NOT NULL,
	`provider_request_id` text,
	`verified_tokens` integer,
	`verified_microusd` integer,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`execution_id`, `step_index`)
);
--> statement-breakpoint
CREATE TABLE `consequential_executions` (
	`execution_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`stream_id` text NOT NULL,
	`project_id` text NOT NULL,
	`document_id` text NOT NULL,
	`organization_id` text,
	`project_access_id` text,
	`operation` text NOT NULL,
	`intent_hash` text NOT NULL,
	`binding_hash` text NOT NULL,
	`consent_ref` text NOT NULL,
	`result_ref` text,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_consequential_executions_actor_scope` ON `consequential_executions` (`actor_user_id`,`project_id`,`document_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE output_plan_revisions(
    scope_key TEXT NOT NULL,scope_kind TEXT NOT NULL CHECK(scope_kind IN('personal','project')),owner_user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,document_id TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,
    plan_revision_id TEXT NOT NULL,plan_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
    confirmed_event_id TEXT NOT NULL,requirements_digest TEXT NOT NULL,source_digest TEXT NOT NULL,
    resolver_version TEXT NOT NULL,source_head INTEGER NOT NULL CHECK(typeof(source_head)='integer' AND source_head>=0),target_count INTEGER NOT NULL CHECK(typeof(target_count)='integer' AND target_count>=0 AND target_count<=1000),created_at TEXT NOT NULL,
    PRIMARY KEY(scope_key,plan_revision_id),
    FOREIGN KEY(confirmed_event_id) REFERENCES events(event_id),
    CHECK((scope_kind='personal' AND organization_id IS NULL AND project_access_id IS NULL) OR (scope_kind='project' AND organization_id IS NOT NULL AND project_access_id IS NOT NULL)));
--> statement-breakpoint
CREATE INDEX idx_output_plans_document ON output_plan_revisions(scope_key,document_id,revision DESC);
--> statement-breakpoint
CREATE TABLE output_preflights(
    scope_key TEXT NOT NULL,preflight_id TEXT NOT NULL,plan_revision_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,
    terms_digest TEXT NOT NULL,event_id TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,
    PRIMARY KEY(scope_key,preflight_id),FOREIGN KEY(scope_key,plan_revision_id) REFERENCES output_plan_revisions(scope_key,plan_revision_id),
    FOREIGN KEY(event_id) REFERENCES events(event_id));
--> statement-breakpoint
CREATE TABLE output_execution_grants(
    scope_key TEXT NOT NULL,grant_id TEXT NOT NULL,plan_revision_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,payer_user_id TEXT NOT NULL,context_id TEXT,
    preflight_id TEXT NOT NULL,authorization_event_id TEXT NOT NULL,maximum_microusd INTEGER NOT NULL CHECK(typeof(maximum_microusd)='integer' AND maximum_microusd>0 AND maximum_microusd<=1000000000000),
    maximum_calls INTEGER NOT NULL CHECK(typeof(maximum_calls)='integer' AND maximum_calls>0 AND maximum_calls<=10000),
    status TEXT NOT NULL CHECK(status IN('authorized','active','completed','revoked','exceeded')),expires_at TEXT NOT NULL,created_at TEXT NOT NULL,
    PRIMARY KEY(scope_key,grant_id),
    FOREIGN KEY(scope_key,plan_revision_id) REFERENCES output_plan_revisions(scope_key,plan_revision_id),
    FOREIGN KEY(scope_key,preflight_id) REFERENCES output_preflights(scope_key,preflight_id),
    FOREIGN KEY(authorization_event_id) REFERENCES events(event_id));
--> statement-breakpoint
CREATE TABLE output_operation_slots(
    scope_key TEXT NOT NULL,slot_id TEXT NOT NULL,grant_id TEXT NOT NULL,plan_revision_id TEXT NOT NULL,target_id TEXT NOT NULL,
    target_contract_digest TEXT NOT NULL,source_digest TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,
    route_digest TEXT NOT NULL,job_id TEXT NOT NULL,cost_reservation_id TEXT NOT NULL,token_reservation_id TEXT NOT NULL,
    maximum_microusd INTEGER NOT NULL CHECK(typeof(maximum_microusd)='integer' AND maximum_microusd>0 AND maximum_microusd<=1000000000000),
    maximum_calls INTEGER NOT NULL CHECK(typeof(maximum_calls)='integer' AND maximum_calls>0 AND maximum_calls<=1000),maximum_tokens INTEGER NOT NULL CHECK(typeof(maximum_tokens)='integer' AND maximum_tokens>0),
    attempt_ordinal INTEGER NOT NULL DEFAULT 0 CHECK(typeof(attempt_ordinal)='integer' AND attempt_ordinal>=0),previous_slot_id TEXT,
    status TEXT NOT NULL CHECK(status IN('authorized','queued','running','succeeded','failed','cancelled','unavailable','uncertain')),
    outcome_event_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    PRIMARY KEY(scope_key,slot_id),
    CHECK((attempt_ordinal=0 AND previous_slot_id IS NULL) OR (attempt_ordinal>0 AND previous_slot_id IS NOT NULL)),
    FOREIGN KEY(scope_key,grant_id) REFERENCES output_execution_grants(scope_key,grant_id),
    FOREIGN KEY(scope_key,previous_slot_id) REFERENCES output_operation_slots(scope_key,slot_id),
    FOREIGN KEY(scope_key,plan_revision_id,target_id) REFERENCES output_plan_targets(scope_key,plan_revision_id,target_id));
--> statement-breakpoint
CREATE TABLE output_operation_routes(
    scope_key TEXT NOT NULL,slot_id TEXT NOT NULL,stage_key TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,
    maximum_calls INTEGER NOT NULL CHECK(typeof(maximum_calls)='integer' AND maximum_calls>0 AND maximum_calls<=1000),
    PRIMARY KEY(scope_key,slot_id,stage_key),FOREIGN KEY(scope_key,slot_id) REFERENCES output_operation_slots(scope_key,slot_id));
--> statement-breakpoint
CREATE TABLE output_provider_calls(
    scope_key TEXT NOT NULL,slot_id TEXT NOT NULL,call_key TEXT NOT NULL,client_request_id TEXT NOT NULL,request_digest TEXT NOT NULL,
    stage_key TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,
    reserved_microusd INTEGER NOT NULL CHECK(typeof(reserved_microusd)='integer' AND reserved_microusd>0),used_microusd INTEGER CHECK(used_microusd IS NULL OR typeof(used_microusd)='integer' AND used_microusd>=0),
    status TEXT NOT NULL CHECK(status IN('pending','uncertain','settled','rejected')),provider_response_id TEXT,created_at TEXT NOT NULL,settled_at TEXT,
    PRIMARY KEY(scope_key,slot_id,call_key),
    FOREIGN KEY(scope_key,slot_id,stage_key) REFERENCES output_operation_routes(scope_key,slot_id,stage_key));
--> statement-breakpoint
CREATE UNIQUE INDEX idx_output_plan_revisions_unique_1 ON output_plan_revisions(scope_key,plan_id,revision);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_output_execution_grants_unique_1 ON output_execution_grants(scope_key,preflight_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_output_operation_slots_unique_1 ON output_operation_slots(scope_key,grant_id,target_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_output_operation_slots_unique_2 ON output_operation_slots(scope_key,target_id,target_contract_digest,attempt_ordinal);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_output_operation_slots_unique_3 ON output_operation_slots(job_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_output_operation_slots_unique_4 ON output_operation_slots(cost_reservation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_output_operation_slots_unique_5 ON output_operation_slots(token_reservation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_output_provider_calls_unique_1 ON output_provider_calls(client_request_id);
--> statement-breakpoint
CREATE TABLE "output_plan_targets"(
    scope_key TEXT NOT NULL,plan_revision_id TEXT NOT NULL,target_id TEXT NOT NULL,target_contract_digest TEXT NOT NULL,
    media_kind TEXT NOT NULL CHECK(media_kind IN('image','slides','audio','video','document','model3d','unknown')),
    required INTEGER NOT NULL CHECK(required IN(0,1)),selected INTEGER NOT NULL CHECK(selected IN(0,1)),ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>=0),
    PRIMARY KEY(scope_key,plan_revision_id,target_id),
    FOREIGN KEY(scope_key,plan_revision_id) REFERENCES output_plan_revisions(scope_key,plan_revision_id));
--> statement-breakpoint
CREATE TABLE `budget_hold_dispositions` (
	`disposition_id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`job_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`token_reservation_id` text NOT NULL,
	`cost_reservation_id` text NOT NULL,
	`command_sha256` text NOT NULL,
	`record_sha256` text NOT NULL,
	`record_json` text NOT NULL,
	`event_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_hold_dispositions_token_reservation_id_unique` ON `budget_hold_dispositions` (`token_reservation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_hold_dispositions_cost_reservation_id_unique` ON `budget_hold_dispositions` (`cost_reservation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_hold_dispositions_event_id_unique` ON `budget_hold_dispositions` (`event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hold_dispositions_job_attempt` ON `budget_hold_dispositions` (`job_id`,`correlation_id`);
--> statement-breakpoint
CREATE TRIGGER budget_hold_dispositions_no_update BEFORE UPDATE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER budget_hold_dispositions_no_delete BEFORE DELETE ON budget_hold_dispositions
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER budget_hold_dispositions_no_replace BEFORE INSERT ON budget_hold_dispositions
    WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE disposition_id=NEW.disposition_id
      OR token_reservation_id=NEW.token_reservation_id OR cost_reservation_id=NEW.cost_reservation_id
      OR event_id=NEW.event_id OR (job_id=NEW.job_id AND correlation_id=NEW.correlation_id))
    BEGIN SELECT RAISE(ABORT,'hold_dispositions_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_disposition_no_insert
      BEFORE INSERT ON budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE token_reservation_id=NEW.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_disposition_no_update
      BEFORE UPDATE ON budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE token_reservation_id IN(OLD.reservation_id,NEW.reservation_id))
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_disposition_no_delete
      BEFORE DELETE ON budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE token_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_disposition_no_insert
      BEFORE INSERT ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE cost_reservation_id=NEW.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_disposition_no_update
      BEFORE UPDATE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE cost_reservation_id IN(OLD.reservation_id,NEW.reservation_id))
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_disposition_no_delete
      BEFORE DELETE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE cost_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'administrative_disposition_requires_review'); END;
--> statement-breakpoint
CREATE TABLE `managed_video_reconciliations` (
	`reconciliation_id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`job_id` text NOT NULL,
	`correlation_id` text NOT NULL,
	`token_reservation_id` text NOT NULL,
	`cost_reservation_id` text NOT NULL,
	`command_sha256` text NOT NULL,
	`treatment_sha256` text NOT NULL,
	`record_sha256` text NOT NULL,
	`record_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_video_reconciliations_token_reservation_id_unique` ON `managed_video_reconciliations` (`token_reservation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_video_reconciliations_cost_reservation_id_unique` ON `managed_video_reconciliations` (`cost_reservation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_video_reconciliations_job_attempt` ON `managed_video_reconciliations` (`job_id`,`correlation_id`);
--> statement-breakpoint
CREATE TRIGGER managed_video_reconciliations_no_update BEFORE UPDATE ON managed_video_reconciliations
    BEGIN SELECT RAISE(ABORT,'video_reconciliations_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER managed_video_reconciliations_no_delete BEFORE DELETE ON managed_video_reconciliations
    BEGIN SELECT RAISE(ABORT,'video_reconciliations_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER managed_video_reconciliations_no_replace BEFORE INSERT ON managed_video_reconciliations
    WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE reconciliation_id=NEW.reconciliation_id
      OR token_reservation_id=NEW.token_reservation_id OR cost_reservation_id=NEW.cost_reservation_id
      OR (job_id=NEW.job_id AND correlation_id=NEW.correlation_id))
    BEGIN SELECT RAISE(ABORT,'video_reconciliations_are_append_only'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_video_reconciliation_no_insert
      BEFORE INSERT ON budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE token_reservation_id=NEW.reservation_id)
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_video_reconciliation_no_update
      BEFORE UPDATE ON budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE token_reservation_id IN(OLD.reservation_id,NEW.reservation_id))
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER budget_reservations_video_reconciliation_no_delete
      BEFORE DELETE ON budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE token_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_video_reconciliation_no_insert
      BEFORE INSERT ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE cost_reservation_id=NEW.reservation_id)
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_video_reconciliation_no_update
      BEFORE UPDATE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE cost_reservation_id IN(OLD.reservation_id,NEW.reservation_id))
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TRIGGER cost_budget_reservations_video_reconciliation_no_delete
      BEFORE DELETE ON cost_budget_reservations WHEN EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE cost_reservation_id=OLD.reservation_id)
      BEGIN SELECT RAISE(ABORT,'video_reconciliation_requires_review'); END;
--> statement-breakpoint
CREATE TABLE generation_study_grants (
 grant_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id),
 plan_id TEXT NOT NULL, runtime_hash TEXT NOT NULL, source_ref TEXT NOT NULL, direction_ref TEXT NOT NULL,
 source_hash TEXT NOT NULL, direction_hash TEXT NOT NULL, authority_version TEXT NOT NULL,
 allowance_microusd INTEGER NOT NULL CHECK(allowance_microusd>0), token_allowance INTEGER NOT NULL CHECK(token_allowance>0),
 expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('authorized','revoked')), stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN(0,1))
);
--> statement-breakpoint
CREATE TABLE generation_study_operations (
 operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id), grant_id TEXT NOT NULL REFERENCES generation_study_grants(grant_id),
 plan_id TEXT NOT NULL, trial_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 token_reservation_id TEXT NOT NULL UNIQUE, cost_reservation_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN('reserved','paused','running','hold','completed')), reason TEXT,
 provider_request_id TEXT, receipt_hash TEXT, usage_json TEXT, measured_microusd INTEGER, measured_tokens INTEGER,
 artifact_ref TEXT, artifact_hash TEXT, private_bytes INTEGER NOT NULL DEFAULT 0, private_writes INTEGER NOT NULL DEFAULT 0,
 artifact_reads INTEGER NOT NULL DEFAULT 0, cleanup_attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 financial_policy_id TEXT, lifecycle_reservation_id TEXT UNIQUE
);
--> statement-breakpoint
CREATE UNIQUE INDEX generation_study_one_outstanding ON generation_study_operations(owner_id) WHERE status!='completed';
--> statement-breakpoint
CREATE TABLE generation_study_evidence (
 operation_id TEXT NOT NULL REFERENCES generation_study_operations(operation_id), slot TEXT NOT NULL,
 content_ref TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(operation_id,slot)
);
--> statement-breakpoint
CREATE TABLE generation_study_charges (
 operation_id TEXT PRIMARY KEY REFERENCES generation_study_operations(operation_id), provider_request_id TEXT NOT NULL,
 receipt_hash TEXT NOT NULL, measured_microusd INTEGER NOT NULL CHECK(measured_microusd>=0), measured_tokens INTEGER NOT NULL CHECK(measured_tokens>=0),
 authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,
 scope_hash TEXT NOT NULL, residual_exposure_microusd INTEGER CHECK(residual_exposure_microusd IS NULL OR residual_exposure_microusd>=0)
);
--> statement-breakpoint
CREATE TABLE generation_study_assertions (passed INTEGER NOT NULL CHECK(passed=1));
--> statement-breakpoint
CREATE TRIGGER generation_study_external_cost BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.cost_reservation_id!=NEW.reservation_id AND COALESCE(o.lifecycle_reservation_id,'')!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_external_tokens BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.owner_id=NEW.owner_id AND o.status!='completed' AND o.token_reservation_id!=NEW.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_outstanding_exposure'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_cost_settlement BEFORE UPDATE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.cost_reservation_id=OLD.reservation_id)
 AND (NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing','executing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)
 WHERE o.cost_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_microusd=NEW.used_microusd) OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.incurred_microusd=NEW.used_microusd AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id))))))
 BEGIN SELECT RAISE(ABORT,'generation_study_original_charge_required'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_token_settlement BEFORE UPDATE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations o WHERE o.token_reservation_id=OLD.reservation_id)
 AND (NEW.reserved_tokens!=OLD.reserved_tokens OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_charges c USING(operation_id)
 WHERE o.token_reservation_id=OLD.reservation_id AND c.provider_request_id=o.provider_request_id AND c.receipt_hash=o.receipt_hash AND ((o.financial_policy_id IS NULL AND c.measured_tokens=NEW.used_tokens) OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=o.operation_id AND r.policy_id=o.financial_policy_id AND r.provider_settled=1 AND r.incurred_tokens=NEW.used_tokens AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id))))))
 BEGIN SELECT RAISE(ABORT,'generation_study_original_usage_required'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_cost_no_delete BEFORE DELETE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE cost_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_token_no_delete BEFORE DELETE ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE token_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_operation_no_delete BEFORE DELETE ON generation_study_operations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_purchase'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_operation_identity BEFORE UPDATE ON generation_study_operations
 WHEN NEW.operation_id!=OLD.operation_id OR NEW.owner_id!=OLD.owner_id OR NEW.grant_id!=OLD.grant_id OR NEW.plan_id!=OLD.plan_id OR NEW.trial_id!=OLD.trial_id OR NEW.request_hash!=OLD.request_hash OR NEW.token_reservation_id!=OLD.token_reservation_id OR NEW.cost_reservation_id!=OLD.cost_reservation_id OR NEW.expires_at!=OLD.expires_at OR NEW.financial_policy_id IS NOT OLD.financial_policy_id OR NEW.lifecycle_reservation_id IS NOT OLD.lifecycle_reservation_id
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_identity'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_grant_identity BEFORE UPDATE ON generation_study_grants
 WHEN NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.plan_id!=OLD.plan_id OR NEW.runtime_hash!=OLD.runtime_hash OR NEW.source_ref!=OLD.source_ref OR NEW.direction_ref!=OLD.direction_ref OR NEW.source_hash!=OLD.source_hash OR NEW.direction_hash!=OLD.direction_hash OR NEW.authority_version!=OLD.authority_version OR NEW.allowance_microusd!=OLD.allowance_microusd OR NEW.token_allowance!=OLD.token_allowance OR NEW.expires_at!=OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_new_authority_version_required'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_charge_no_update BEFORE UPDATE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_charge_no_delete BEFORE DELETE ON generation_study_charges BEGIN SELECT RAISE(ABORT,'generation_study_immutable_charge'); END;
--> statement-breakpoint
CREATE TABLE generation_study_financial_grants (
 grant_id TEXT NOT NULL REFERENCES generation_study_grants(grant_id), operation_id TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES users(user_id), policy_id TEXT NOT NULL, policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
 expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('authorized','revoked')),
 PRIMARY KEY(grant_id,operation_id)
);
--> statement-breakpoint
CREATE TRIGGER generation_study_financial_grant_identity BEFORE UPDATE ON generation_study_financial_grants
 WHEN NEW.grant_id IS NOT OLD.grant_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.policy_json IS NOT OLD.policy_json OR NEW.expires_at IS NOT OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_financial_grant_no_delete BEFORE DELETE ON generation_study_financial_grants BEGIN SELECT RAISE(ABORT,'generation_study_immutable_financial_grant'); END;
--> statement-breakpoint
CREATE TABLE generation_study_reconciliations (
 evidence_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES generation_study_charges(operation_id),
 sequence INTEGER NOT NULL CHECK(sequence>0), previous_id TEXT REFERENCES generation_study_reconciliations(evidence_id),
 original_charge_hash TEXT NOT NULL, policy_id TEXT NOT NULL, evidence_kind TEXT NOT NULL CHECK(evidence_kind='verified-incurred-charge'),
 authority_version TEXT NOT NULL, evidence_ref TEXT NOT NULL, recorded_at TEXT NOT NULL,
 provider_settled INTEGER NOT NULL CHECK(provider_settled IN(0,1)),
 incurred_microusd INTEGER NOT NULL CHECK(incurred_microusd>=0), incurred_tokens INTEGER NOT NULL CHECK(incurred_tokens>=0),
 remaining_uncertainty_microusd INTEGER CHECK(remaining_uncertainty_microusd IS NULL OR remaining_uncertainty_microusd>=0),
 lifecycle_microusd INTEGER NOT NULL CHECK(lifecycle_microusd>=0), lifecycle_scope TEXT NOT NULL,
 liability_owner TEXT NOT NULL, lifecycle_through TEXT NOT NULL, lifecycle_evidence_ref TEXT NOT NULL,
 lifecycle_closed INTEGER NOT NULL DEFAULT 0 CHECK(lifecycle_closed IN(0,1)), lifecycle_incurred_microusd INTEGER,
 UNIQUE(operation_id,sequence)
);
--> statement-breakpoint
CREATE TRIGGER generation_study_reconciliation_chain BEFORE INSERT ON generation_study_reconciliations
 WHEN NEW.sequence!=COALESCE((SELECT MAX(sequence)+1 FROM generation_study_reconciliations WHERE operation_id=NEW.operation_id),1)
 OR NEW.previous_id IS NOT (SELECT evidence_id FROM generation_study_reconciliations WHERE operation_id=NEW.operation_id ORDER BY sequence DESC LIMIT 1)
 BEGIN SELECT RAISE(ABORT,'generation_study_reconciliation_chain'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_reconciliation_finality BEFORE INSERT ON generation_study_reconciliations
 WHEN EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=NEW.operation_id AND (NEW.incurred_microusd<r.incurred_microusd OR NEW.incurred_tokens<r.incurred_tokens))
 OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.provider_settled=1
 AND (NEW.provider_settled!=1 OR NEW.incurred_microusd!=r.incurred_microusd OR NEW.incurred_tokens!=r.incurred_tokens))
 OR EXISTS(SELECT 1 FROM generation_study_reconciliations r WHERE r.operation_id=NEW.operation_id AND r.lifecycle_closed=1
 AND (NEW.lifecycle_closed!=1 OR NEW.lifecycle_incurred_microusd IS NOT r.lifecycle_incurred_microusd))
 BEGIN SELECT RAISE(ABORT,'generation_study_settled_amount_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_reconciliation_no_update BEFORE UPDATE ON generation_study_reconciliations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_reconciliation'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_reconciliation_no_delete BEFORE DELETE ON generation_study_reconciliations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_reconciliation'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_lifecycle_no_delete BEFORE DELETE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE lifecycle_reservation_id=OLD.reservation_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_provision'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_lifecycle_settlement BEFORE UPDATE ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_operations WHERE lifecycle_reservation_id=OLD.reservation_id)
 AND (NEW.reservation_id!=OLD.reservation_id OR NEW.workspace_id!=OLD.workspace_id OR NEW.stream_id!=OLD.stream_id OR NEW.correlation_id!=OLD.correlation_id OR NEW.operation!=OLD.operation OR NEW.reserved_microusd!=OLD.reserved_microusd OR NEW.owner_id!=OLD.owner_id OR NEW.period!=OLD.period OR
 (NEW.status NOT IN('active','authorizing') AND NOT EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_reconciliations r USING(operation_id)
 WHERE o.lifecycle_reservation_id=OLD.reservation_id AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id)
 AND r.lifecycle_closed=1 AND r.lifecycle_microusd=0 AND r.remaining_uncertainty_microusd=0 AND r.provider_settled=1 AND r.lifecycle_incurred_microusd=NEW.used_microusd)))
 BEGIN SELECT RAISE(ABORT,'generation_study_verified_lifecycle_closure_required'); END;
--> statement-breakpoint
CREATE VIEW generation_study_lifecycle_holds AS
 SELECT o.owner_id,o.operation_id FROM generation_study_operations o
 JOIN generation_study_reconciliations r ON r.operation_id=o.operation_id
 AND r.sequence=(SELECT MAX(sequence) FROM generation_study_reconciliations WHERE operation_id=o.operation_id)
 WHERE o.financial_policy_id IS NOT NULL AND
 (r.policy_id!=o.financial_policy_id OR NOT EXISTS(SELECT 1 FROM generation_study_financial_grants g WHERE g.grant_id=o.grant_id AND g.operation_id=o.operation_id AND g.owner_id=o.owner_id AND g.policy_id=r.policy_id AND json_extract(g.policy_json,'$.lifecycle.scope')=r.lifecycle_scope AND json_extract(g.policy_json,'$.lifecycle.liabilityOwner')=r.liability_owner AND json_extract(g.policy_json,'$.lifecycle.through')=r.lifecycle_through AND json_extract(g.policy_json,'$.lifecycle.maximumMicrousd')>=r.lifecycle_microusd) OR r.provider_settled!=1 OR r.remaining_uncertainty_microusd IS NOT 0 OR
 (r.lifecycle_closed=1 AND (r.lifecycle_microusd!=0 OR r.lifecycle_incurred_microusd IS NULL OR r.lifecycle_incurred_microusd>COALESCE((SELECT reserved_microusd FROM cost_budget_reservations WHERE reservation_id=o.lifecycle_reservation_id),0))) OR
 (r.lifecycle_closed=0 AND (r.lifecycle_through<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM cost_budget_reservations c WHERE c.reservation_id=o.lifecycle_reservation_id AND c.owner_id=o.owner_id AND c.status='active' AND c.reserved_microusd>=r.lifecycle_microusd))));
--> statement-breakpoint
CREATE TRIGGER generation_study_lifecycle_cost_hold BEFORE INSERT ON cost_budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_lifecycle_exposure'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_lifecycle_token_hold BEFORE INSERT ON budget_reservations
 WHEN EXISTS(SELECT 1 FROM generation_study_lifecycle_holds WHERE owner_id=NEW.owner_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_lifecycle_exposure'); END;
--> statement-breakpoint
CREATE TABLE generation_study_stages (
 operation_id TEXT NOT NULL REFERENCES generation_study_operations(operation_id),
 stage TEXT NOT NULL CHECK(stage IN('advisory','moderation','image','storage')),
 status TEXT NOT NULL CHECK(status IN('intent','received','complete')),
 request_hash TEXT NOT NULL, receipt_hash TEXT, PRIMARY KEY(operation_id,stage)
);
--> statement-breakpoint
CREATE TABLE generation_study_supplied_reviews (
 review_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL UNIQUE REFERENCES generation_study_grants(grant_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), principal_hash TEXT NOT NULL,
 binding_json TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('authorized','revoked')),
 hard_stop TEXT
);
--> statement-breakpoint
CREATE TRIGGER generation_study_supplied_review_identity BEFORE UPDATE ON generation_study_supplied_reviews
 WHEN NEW.review_id!=OLD.review_id OR NEW.grant_id!=OLD.grant_id OR NEW.owner_id!=OLD.owner_id OR NEW.principal_hash!=OLD.principal_hash OR NEW.binding_json!=OLD.binding_json OR NEW.expires_at!=OLD.expires_at OR (OLD.status='revoked' AND NEW.status!='revoked') OR (OLD.hard_stop IS NOT NULL AND NEW.hard_stop IS NOT OLD.hard_stop)
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_review'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_supplied_review_no_delete BEFORE DELETE ON generation_study_supplied_reviews BEGIN SELECT RAISE(ABORT,'generation_study_immutable_review'); END;
--> statement-breakpoint
CREATE TABLE generation_study_supplied_observations (
 operation_id TEXT PRIMARY KEY REFERENCES generation_study_operations(operation_id),
 review_id TEXT NOT NULL REFERENCES generation_study_supplied_reviews(review_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), principal_hash TEXT NOT NULL,
 artifact_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, protocol TEXT NOT NULL,
 safety TEXT NOT NULL CHECK(safety IN('clear','unsafe')),
 fidelity TEXT NOT NULL CHECK(fidelity IN('pass','expected-failure')), finding TEXT NOT NULL,
 evidence_ref TEXT NOT NULL, resume INTEGER NOT NULL CHECK(resume IN(0,1)), recorded_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER generation_study_supplied_observation_no_update BEFORE UPDATE ON generation_study_supplied_observations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_observation'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_supplied_observation_no_delete BEFORE DELETE ON generation_study_supplied_observations BEGIN SELECT RAISE(ABORT,'generation_study_immutable_observation'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_supplied_stage_no_delete BEFORE DELETE ON generation_study_stages BEGIN SELECT RAISE(ABORT,'generation_study_immutable_intent'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_supplied_stage_identity BEFORE UPDATE ON generation_study_stages
 WHEN NEW.operation_id!=OLD.operation_id OR NEW.stage!=OLD.stage OR NEW.request_hash!=OLD.request_hash OR (OLD.receipt_hash IS NOT NULL AND NEW.receipt_hash IS NOT OLD.receipt_hash) OR (OLD.status='received' AND NEW.status='intent') OR (OLD.status='complete' AND NEW.status!='complete')
 BEGIN SELECT RAISE(ABORT,'generation_study_immutable_intent'); END;
--> statement-breakpoint
CREATE TRIGGER generation_study_supplied_grant_revocation BEFORE UPDATE ON generation_study_grants
 WHEN OLD.status='revoked' AND NEW.status!='revoked' AND EXISTS(SELECT 1 FROM generation_study_supplied_reviews WHERE grant_id=OLD.grant_id)
 BEGIN SELECT RAISE(ABORT,'generation_study_supplied_revocation_terminal'); END;
--> statement-breakpoint
CREATE TABLE authoring_study_configurations (
 proposal_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(user_id),
 configuration_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('active','revoked'))
);
--> statement-breakpoint
CREATE TRIGGER authoring_study_configuration_identity BEFORE UPDATE ON authoring_study_configurations
 WHEN NEW.proposal_id IS NOT OLD.proposal_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.configuration_hash IS NOT OLD.configuration_hash OR NEW.expires_at IS NOT OLD.expires_at OR OLD.status='revoked'
 BEGIN SELECT RAISE(ABORT,'authoring_study_configuration_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER authoring_study_configuration_no_delete BEFORE DELETE ON authoring_study_configurations BEGIN SELECT RAISE(ABORT,'authoring_study_configuration_immutable'); END;
--> statement-breakpoint
CREATE TABLE authoring_study_evidence (
 evidence_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES authoring_study_configurations(proposal_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), kind TEXT NOT NULL CHECK(kind IN('account','rate','liability','settlement','lifecycle','deletion','bound')),
 content_ref TEXT NOT NULL UNIQUE, content_hash TEXT NOT NULL,
 authority_id TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('verified','revoked'))
);
--> statement-breakpoint
CREATE TRIGGER authoring_study_evidence_identity BEFORE UPDATE ON authoring_study_evidence
 WHEN NEW.evidence_id IS NOT OLD.evidence_id OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind OR NEW.content_ref IS NOT OLD.content_ref OR NEW.content_hash IS NOT OLD.content_hash OR NEW.authority_id IS NOT OLD.authority_id OR NEW.expires_at IS NOT OLD.expires_at OR OLD.status='revoked'
 BEGIN SELECT RAISE(ABORT,'authoring_study_evidence_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER authoring_study_evidence_no_delete BEFORE DELETE ON authoring_study_evidence BEGIN SELECT RAISE(ABORT,'authoring_study_evidence_immutable'); END;
--> statement-breakpoint
CREATE TABLE authoring_study_commits (
 preview_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE REFERENCES authoring_study_configurations(proposal_id),
 owner_id TEXT NOT NULL REFERENCES users(user_id), intent_id TEXT NOT NULL UNIQUE,
 operation TEXT NOT NULL CHECK(operation='generation-supplied-study-approval'), version INTEGER NOT NULL CHECK(version=1),
 display_hash TEXT NOT NULL, configuration_hash TEXT NOT NULL, principal_hash TEXT NOT NULL,
 plan_id TEXT NOT NULL, grant_id TEXT NOT NULL UNIQUE REFERENCES generation_study_grants(grant_id),
 review_id TEXT NOT NULL UNIQUE REFERENCES generation_study_supplied_reviews(review_id),
 baseline_operation TEXT NOT NULL UNIQUE, treatment_operation TEXT NOT NULL UNIQUE,
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),
 expires_at TEXT NOT NULL, verified INTEGER NOT NULL CHECK(verified=1), created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER authoring_study_commit_no_update BEFORE UPDATE ON authoring_study_commits BEGIN SELECT RAISE(ABORT,'authoring_study_receipt_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER authoring_study_commit_no_delete BEFORE DELETE ON authoring_study_commits BEGIN SELECT RAISE(ABORT,'authoring_study_receipt_immutable'); END;
--> statement-breakpoint
CREATE TABLE p5_rehearsal_run (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, dataset TEXT NOT NULL, phase TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, started INTEGER NOT NULL, requests INTEGER NOT NULL DEFAULT 0, report TEXT, retained_hash TEXT NOT NULL, reads INTEGER NOT NULL DEFAULT 0, writes INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE p5_rehearsal_guard (ok INTEGER NOT NULL CHECK(ok=1));
