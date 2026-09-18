-- Additive job-native memory provenance; does not enroll users or publish answers.
-- Origins deliberately have no foreign key to jobs, events or private bodies: negative
-- registrations survive cleanup. Dependency selectors discover candidates only; they
-- never replace complete private-manifest comparison and fresh native authorization.
-- The short proof lease authorizes initial creation, not the durable answer lifetime.
-- Writer/reader/privacy integrations must be qualified before any rows are activated.
CREATE TABLE `memory_document_job_answer_origins` (
  `origin_id` text PRIMARY KEY NOT NULL,
  `schema_version` integer NOT NULL,
  `recipe_version` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `scope_key` text NOT NULL,
  `job_id` text NOT NULL,
  `turn_id` text NOT NULL,
  `user_event_id` text NOT NULL,
  `user_content_id` text NOT NULL,
  `answer_event_id` text NOT NULL,
  `answer_content_id` text NOT NULL,
  `manifest_content_ref` text NOT NULL,
  `owner_user_id` text,
  `stream_id` text,
  `organization_id` text,
  `project_access_id` text,
  `project_id` text,
  `document_id` text,
  `attempt_count` integer,
  `correlation_id` text,
  `request_sha256` text,
  `claim_sha256` text,
  `input_content_ref` text,
  `input_sha256` text,
  `input_expires_at` text,
  `job_requested_at` text,
  `job_started_at` text,
  `job_lease_expires_at` text,
  `job_expires_at` text,
  `requested_sequence` integer,
  `source_head` integer,
  `project_source_head` integer,
  `user_source_sequence` integer,
  `user_sha256` text,
  `answer_source_sequence` integer,
  `answer_sha256` text,
  `answer_expires_at` text,
  `mode` text,
  `renderer_recipe` text,
  `locale` text,
  `enrollment_id` text,
  `enrollment_revision` integer,
  `permission_epoch` text,
  `policy_version` text,
  `enrolled_at` text,
  `enrollment_expires_at` text,
  `retention_days` integer,
  `selection_cursor` integer,
  `consumed_value_sha256` text,
  `source_count` integer,
  `ledger_revision_count` integer,
  `selector_count` integer,
  `selector_list_sha256` text,
  `manifest_sha256` text,
  `manifest_expires_at` text,
  `proof_valid_until` text,
  `source_retention_ceiling` text,
  `created_at` text,
  `status` text NOT NULL,
  `withdrawn_at` text,
  `withdrawal_reason` text,
  CONSTRAINT `memory_document_job_origins_version` CHECK (COALESCE((typeof(schema_version)='integer' AND schema_version=1 AND recipe_version='native-document-job-answer-origin-v1'),0)),
  CONSTRAINT `memory_document_job_origins_registrations` CHECK (COALESCE((length(origin_id)>0 AND length(actor_user_id)>0 AND length(scope_key)>0 AND length(job_id)>0 AND length(turn_id)>0 AND length(user_event_id)>0 AND length(user_content_id)>0 AND length(answer_event_id)>0 AND length(answer_content_id)>0 AND length(manifest_content_ref)>0 AND user_event_id<>answer_event_id AND user_content_id<>answer_content_id AND user_content_id<>manifest_content_ref AND answer_content_id<>manifest_content_ref),0)),
  CONSTRAINT `memory_document_job_origins_scope` CHECK (COALESCE((status='minimized' OR (length(owner_user_id)>0 AND stream_id='creative:'||owner_user_id AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND project_source_head IS NULL AND actor_user_id=owner_user_id) OR (length(organization_id)>0 AND length(project_access_id)>0 AND typeof(project_source_head)='integer' AND project_source_head BETWEEN 0 AND 9007199254740989)))),0)),
  CONSTRAINT `memory_document_job_origins_scope_key` CHECK (COALESCE((CASE WHEN json_valid(scope_key) THEN json_type(scope_key)='array' AND json_array_length(scope_key)=4 AND json_type(scope_key,'$[0]')='text' AND json_type(scope_key,'$[1]')='text' AND json_type(scope_key,'$[2]')='text' AND json_type(scope_key,'$[3]')='text' AND ((json_extract(scope_key,'$[0]')='' AND json_extract(scope_key,'$[1]')='') OR (json_extract(scope_key,'$[0]')<>'' AND json_extract(scope_key,'$[1]')<>'')) AND json_extract(scope_key,'$[2]')<>'' AND json_extract(scope_key,'$[3]')<>'' AND scope_key=json_array(json_extract(scope_key,'$[0]'),json_extract(scope_key,'$[1]'),json_extract(scope_key,'$[2]'),json_extract(scope_key,'$[3]')) AND (status='minimized' OR (json_extract(scope_key,'$[0]')=COALESCE(organization_id,'') AND json_extract(scope_key,'$[1]')=COALESCE(project_access_id,'') AND json_extract(scope_key,'$[2]')=project_id AND json_extract(scope_key,'$[3]')=document_id)) ELSE 0 END),0)),
  CONSTRAINT `memory_document_job_origins_identities` CHECK (COALESCE((status='minimized' OR (length(correlation_id)>0 AND length(input_content_ref)>0 AND renderer_recipe='document-job-evidence-answer-v1' AND length(enrollment_id)>0 AND length(permission_epoch)>0 AND length(policy_version)>0 AND typeof(attempt_count)='integer' AND attempt_count BETWEEN 1 AND 9007199254740991 AND input_content_ref<>answer_content_id AND input_content_ref<>manifest_content_ref)),0)),
  CONSTRAINT `memory_document_job_origins_hashes` CHECK (COALESCE((status='minimized' OR (length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*' AND length(claim_sha256)=64 AND claim_sha256 NOT GLOB '*[^0-9a-f]*' AND length(input_sha256)=64 AND input_sha256 NOT GLOB '*[^0-9a-f]*' AND length(user_sha256)=64 AND user_sha256 NOT GLOB '*[^0-9a-f]*' AND length(answer_sha256)=64 AND answer_sha256 NOT GLOB '*[^0-9a-f]*' AND length(consumed_value_sha256)=64 AND consumed_value_sha256 NOT GLOB '*[^0-9a-f]*' AND length(selector_list_sha256)=64 AND selector_list_sha256 NOT GLOB '*[^0-9a-f]*' AND length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),0)),
  CONSTRAINT `memory_document_job_origins_sequences` CHECK (COALESCE((status='minimized' OR (typeof(source_head)='integer' AND source_head BETWEEN 1 AND 9007199254740989 AND typeof(requested_sequence)='integer' AND requested_sequence BETWEEN 0 AND source_head AND typeof(selection_cursor)='integer' AND selection_cursor<=source_head AND ((mode='extractive' AND selection_cursor>=1) OR (mode='structured' AND selection_cursor>=0)) AND typeof(user_source_sequence)='integer' AND user_source_sequence=source_head+1 AND typeof(answer_source_sequence)='integer' AND answer_source_sequence=source_head+2)),0)),
  CONSTRAINT `memory_document_job_origins_evidence` CHECK (COALESCE((status='minimized' OR (locale IN('en','fr','ar','ja') AND typeof(source_count)='integer' AND source_count BETWEEN 1 AND 128 AND typeof(ledger_revision_count)='integer' AND ((mode='extractive' AND ledger_revision_count=0) OR (mode='structured' AND source_count>=2 AND source_count%2=0 AND ledger_revision_count BETWEEN 1 AND 64)) AND typeof(selector_count)='integer' AND selector_count BETWEEN 1 AND 513)),0)),
  CONSTRAINT `memory_document_job_origins_enrollment` CHECK (COALESCE((status='minimized' OR (typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(retention_days)='integer' AND retention_days BETWEEN 1 AND 365)),0)),
  CONSTRAINT `memory_document_job_origins_timestamps` CHECK (COALESCE((status='minimized' OR (length(input_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',input_expires_at)=input_expires_at AND length(job_requested_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_requested_at)=job_requested_at AND length(job_started_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_started_at)=job_started_at AND length(job_lease_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_lease_expires_at)=job_lease_expires_at AND length(job_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_expires_at)=job_expires_at AND length(answer_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',answer_expires_at)=answer_expires_at AND length(enrolled_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',enrolled_at)=enrolled_at AND length(enrollment_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',enrollment_expires_at)=enrollment_expires_at AND length(manifest_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',manifest_expires_at)=manifest_expires_at AND length(proof_valid_until)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',proof_valid_until)=proof_valid_until AND length(source_retention_ceiling)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',source_retention_ceiling)=source_retention_ceiling AND length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)),0)),
  CONSTRAINT `memory_document_job_origins_lifetime` CHECK (COALESCE((status='minimized' OR (job_requested_at<=job_started_at AND job_started_at<=created_at AND enrolled_at<=created_at AND created_at<proof_valid_until AND proof_valid_until<=job_lease_expires_at AND proof_valid_until<=input_expires_at AND proof_valid_until<=job_expires_at AND proof_valid_until<=source_retention_ceiling AND created_at<answer_expires_at AND answer_expires_at<=manifest_expires_at AND manifest_expires_at<=source_retention_ceiling AND source_retention_ceiling<=enrollment_expires_at AND manifest_expires_at<=input_expires_at AND manifest_expires_at<=job_expires_at)),0)),
  CONSTRAINT `memory_document_job_origins_state` CHECK (COALESCE(((status='active' AND withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR (status IN('withdrawn','minimized') AND length(withdrawn_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',withdrawn_at)=withdrawn_at AND withdrawal_reason IN('source-unavailable','source-changed','source-expired','enrollment-changed','access-withdrawn','job-changed','erased','manual') AND (status='minimized' OR created_at<=withdrawn_at))),0)),
  CONSTRAINT `memory_document_job_origins_shape` CHECK (COALESCE(((status IN('active','withdrawn') AND owner_user_id IS NOT NULL AND stream_id IS NOT NULL AND project_id IS NOT NULL AND document_id IS NOT NULL AND attempt_count IS NOT NULL AND correlation_id IS NOT NULL AND request_sha256 IS NOT NULL AND claim_sha256 IS NOT NULL AND input_content_ref IS NOT NULL AND input_sha256 IS NOT NULL AND input_expires_at IS NOT NULL AND job_requested_at IS NOT NULL AND job_started_at IS NOT NULL AND job_lease_expires_at IS NOT NULL AND job_expires_at IS NOT NULL AND requested_sequence IS NOT NULL AND source_head IS NOT NULL AND user_source_sequence IS NOT NULL AND user_sha256 IS NOT NULL AND answer_source_sequence IS NOT NULL AND answer_sha256 IS NOT NULL AND answer_expires_at IS NOT NULL AND mode IS NOT NULL AND renderer_recipe IS NOT NULL AND locale IS NOT NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND enrolled_at IS NOT NULL AND enrollment_expires_at IS NOT NULL AND retention_days IS NOT NULL AND selection_cursor IS NOT NULL AND consumed_value_sha256 IS NOT NULL AND source_count IS NOT NULL AND ledger_revision_count IS NOT NULL AND selector_count IS NOT NULL AND selector_list_sha256 IS NOT NULL AND manifest_sha256 IS NOT NULL AND manifest_expires_at IS NOT NULL AND proof_valid_until IS NOT NULL AND source_retention_ceiling IS NOT NULL AND created_at IS NOT NULL) OR (status='minimized' AND owner_user_id IS NULL AND stream_id IS NULL AND organization_id IS NULL AND project_access_id IS NULL AND project_id IS NULL AND document_id IS NULL AND attempt_count IS NULL AND correlation_id IS NULL AND request_sha256 IS NULL AND claim_sha256 IS NULL AND input_content_ref IS NULL AND input_sha256 IS NULL AND input_expires_at IS NULL AND job_requested_at IS NULL AND job_started_at IS NULL AND job_lease_expires_at IS NULL AND job_expires_at IS NULL AND requested_sequence IS NULL AND source_head IS NULL AND project_source_head IS NULL AND user_source_sequence IS NULL AND user_sha256 IS NULL AND answer_source_sequence IS NULL AND answer_sha256 IS NULL AND answer_expires_at IS NULL AND mode IS NULL AND renderer_recipe IS NULL AND locale IS NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND enrolled_at IS NULL AND enrollment_expires_at IS NULL AND retention_days IS NULL AND selection_cursor IS NULL AND consumed_value_sha256 IS NULL AND source_count IS NULL AND ledger_revision_count IS NULL AND selector_count IS NULL AND selector_list_sha256 IS NULL AND manifest_sha256 IS NULL AND manifest_expires_at IS NULL AND proof_valid_until IS NULL AND source_retention_ceiling IS NULL AND created_at IS NULL)),0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_document_job_origin_job_id` ON `memory_document_job_answer_origins` (`job_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_document_job_origin_user_event_id` ON `memory_document_job_answer_origins` (`user_event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_document_job_origin_answer_event_id` ON `memory_document_job_answer_origins` (`answer_event_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_document_job_origin_user_content_id` ON `memory_document_job_answer_origins` (`user_content_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_document_job_origin_answer_content_id` ON `memory_document_job_answer_origins` (`answer_content_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_document_job_origin_manifest_content_ref` ON `memory_document_job_answer_origins` (`manifest_content_ref`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_document_job_origin_turn` ON `memory_document_job_answer_origins` (`actor_user_id`, `scope_key`, `turn_id`);
--> statement-breakpoint
CREATE INDEX `idx_memory_document_job_origin_actor` ON `memory_document_job_answer_origins` (`actor_user_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_memory_document_job_origin_enrollment` ON `memory_document_job_answer_origins` (`enrollment_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_memory_document_job_origin_scope` ON `memory_document_job_answer_origins` (`actor_user_id`, `scope_key`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_memory_document_job_origin_expiry` ON `memory_document_job_answer_origins` (`status`, `answer_expires_at`);
--> statement-breakpoint
CREATE TABLE `memory_document_job_origin_dependencies` (
  `origin_id` text NOT NULL,
  `resource_kind` text NOT NULL,
  `resource_id` text NOT NULL,
  CONSTRAINT `memory_document_job_origin_dependencies_origin_id_resource_kind_resource_id_pk` PRIMARY KEY (`origin_id`, `resource_kind`, `resource_id`),
  CONSTRAINT `memory_document_job_origin_dependencies_origin_id_memory_document_job_answer_origins_origin_id_fk` FOREIGN KEY (`origin_id`) REFERENCES `memory_document_job_answer_origins` (`origin_id`) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT `memory_document_job_origin_dependencies_shape` CHECK (COALESCE((length(origin_id)>0 AND resource_kind IN('event','private-content','ledger','enrollment') AND length(resource_id)>0),0))
);
--> statement-breakpoint
CREATE INDEX `idx_memory_document_job_origin_dependency` ON `memory_document_job_origin_dependencies` (`resource_kind`, `resource_id`, `origin_id`);
