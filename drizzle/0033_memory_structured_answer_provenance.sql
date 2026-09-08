CREATE TABLE `memory_structured_answer_origins` (
	`origin_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`recipe_version` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`owner_user_id` text,
	`organization_id` text,
	`project_access_id` text,
	`project_id` text,
	`document_id` text,
	`scope_key` text NOT NULL,
	`turn_id` text NOT NULL,
	`user_event_id` text NOT NULL,
	`user_content_id` text NOT NULL,
	`user_source_sequence` integer,
	`user_sha256` text,
	`answer_event_id` text NOT NULL,
	`answer_content_id` text NOT NULL,
	`answer_source_sequence` integer,
	`answer_sha256` text,
	`answer_expires_at` text,
	`enrollment_id` text,
	`enrollment_revision` integer,
	`permission_epoch` text,
	`policy_version` text,
	`enrolled_at` text,
	`enrollment_expires_at` text,
	`retention_days` integer,
	`source_head` integer,
	`ledger_id` text,
	`ledger_storage_revision` integer,
	`ledger_body_ref` text,
	`ledger_body_sha256` text,
	`consumed_context_sha256` text,
	`source_list_sha256` text,
	`source_count` integer,
	`ledger_history_sha256` text,
	`ledger_revision_count` integer,
	`manifest_content_ref` text NOT NULL,
	`manifest_sha256` text,
	`manifest_expires_at` text,
	`source_retention_ceiling` text,
	`created_at` text,
	`status` text NOT NULL,
	`withdrawn_at` text,
	`withdrawal_reason` text,
	CONSTRAINT "memory_structured_origins_version" CHECK(typeof(schema_version)='integer' AND schema_version=1 AND recipe_version='native-structured-answer-origin-v1'),
	CONSTRAINT "memory_structured_origins_scope" CHECK(length(origin_id)>0 AND length(actor_user_id)>0 AND length(scope_key)>0 AND length(turn_id)>0 AND (status='minimized' OR (length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))))),
	CONSTRAINT "memory_structured_origins_scope_key" CHECK(CASE WHEN json_valid(scope_key) THEN json_type(scope_key)='array' AND json_array_length(scope_key)=4 AND json_type(scope_key,'$[0]')='text' AND json_type(scope_key,'$[1]')='text' AND json_type(scope_key,'$[2]')='text' AND json_type(scope_key,'$[3]')='text' AND ((json_extract(scope_key,'$[0]')='' AND json_extract(scope_key,'$[1]')='') OR (json_extract(scope_key,'$[0]')<>'' AND json_extract(scope_key,'$[1]')<>'')) AND json_extract(scope_key,'$[2]')<>'' AND json_extract(scope_key,'$[3]')<>'' AND scope_key=json_array(json_extract(scope_key,'$[0]'),json_extract(scope_key,'$[1]'),json_extract(scope_key,'$[2]'),json_extract(scope_key,'$[3]')) AND (status='minimized' OR (json_extract(scope_key,'$[0]')=COALESCE(organization_id,'') AND json_extract(scope_key,'$[1]')=COALESCE(project_access_id,'') AND json_extract(scope_key,'$[2]')=project_id AND json_extract(scope_key,'$[3]')=document_id)) ELSE 0 END),
	CONSTRAINT "memory_structured_origins_identities" CHECK(length(user_event_id)>0 AND length(answer_event_id)>0 AND user_event_id<>answer_event_id AND length(user_content_id)>0 AND length(answer_content_id)>0 AND length(manifest_content_ref)>0 AND user_content_id<>answer_content_id AND manifest_content_ref<>user_content_id AND manifest_content_ref<>answer_content_id AND (status='minimized' OR (length(ledger_body_ref)>0 AND length(enrollment_id)>0 AND length(permission_epoch)>0 AND length(policy_version)>0))),
	CONSTRAINT "memory_structured_origins_hashes" CHECK(status='minimized' OR (length(user_sha256)=64 AND user_sha256 NOT GLOB '*[^0-9a-f]*' AND length(answer_sha256)=64 AND answer_sha256 NOT GLOB '*[^0-9a-f]*' AND length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*' AND length(ledger_body_sha256)=64 AND ledger_body_sha256 NOT GLOB '*[^0-9a-f]*' AND length(consumed_context_sha256)=64 AND consumed_context_sha256 NOT GLOB '*[^0-9a-f]*' AND length(source_list_sha256)=64 AND source_list_sha256 NOT GLOB '*[^0-9a-f]*' AND length(ledger_history_sha256)=64 AND ledger_history_sha256 NOT GLOB '*[^0-9a-f]*' AND length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "memory_structured_origins_enrollment" CHECK(status='minimized' OR (typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(retention_days)='integer' AND retention_days BETWEEN 1 AND 365)),
	CONSTRAINT "memory_structured_origins_sequences" CHECK(status='minimized' OR (typeof(source_head)='integer' AND source_head BETWEEN 1 AND 9007199254740989 AND typeof(user_source_sequence)='integer' AND user_source_sequence=source_head+1 AND typeof(answer_source_sequence)='integer' AND answer_source_sequence=source_head+2)),
	CONSTRAINT "memory_structured_origins_counts" CHECK(status='minimized' OR (typeof(source_count)='integer' AND source_count BETWEEN 2 AND 128 AND source_count%2=0 AND typeof(ledger_storage_revision)='integer' AND ledger_storage_revision BETWEEN 1 AND 64 AND typeof(ledger_revision_count)='integer' AND ledger_revision_count=ledger_storage_revision)),
	CONSTRAINT "memory_structured_origins_lifetime" CHECK(status='minimized' OR (length(enrolled_at)>0 AND enrolled_at<=created_at AND created_at<answer_expires_at AND created_at<manifest_expires_at AND answer_expires_at<=source_retention_ceiling AND manifest_expires_at<=source_retention_ceiling AND source_retention_ceiling<=enrollment_expires_at)),
	CONSTRAINT "memory_structured_origins_state" CHECK((status='active' AND withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR (status IN('withdrawn','minimized') AND withdrawn_at IS NOT NULL AND length(withdrawn_at)>0 AND withdrawal_reason IS NOT NULL AND (status='minimized' OR created_at<=withdrawn_at) AND withdrawal_reason IN('source-unavailable','source-changed','source-expired','enrollment-changed','access-withdrawn','erased','manual'))),
	CONSTRAINT "memory_structured_origins_shape" CHECK((status IN('active','withdrawn') AND owner_user_id IS NOT NULL AND project_id IS NOT NULL AND document_id IS NOT NULL AND user_source_sequence IS NOT NULL AND user_sha256 IS NOT NULL AND answer_source_sequence IS NOT NULL AND answer_sha256 IS NOT NULL AND answer_expires_at IS NOT NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND enrolled_at IS NOT NULL AND enrollment_expires_at IS NOT NULL AND retention_days IS NOT NULL AND source_head IS NOT NULL AND ledger_id IS NOT NULL AND ledger_storage_revision IS NOT NULL AND ledger_body_ref IS NOT NULL AND ledger_body_sha256 IS NOT NULL AND consumed_context_sha256 IS NOT NULL AND source_list_sha256 IS NOT NULL AND source_count IS NOT NULL AND ledger_history_sha256 IS NOT NULL AND ledger_revision_count IS NOT NULL AND manifest_sha256 IS NOT NULL AND manifest_expires_at IS NOT NULL AND source_retention_ceiling IS NOT NULL AND created_at IS NOT NULL) OR (status='minimized' AND owner_user_id IS NULL AND organization_id IS NULL AND project_access_id IS NULL AND project_id IS NULL AND document_id IS NULL AND user_source_sequence IS NULL AND user_sha256 IS NULL AND answer_source_sequence IS NULL AND answer_sha256 IS NULL AND answer_expires_at IS NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND enrolled_at IS NULL AND enrollment_expires_at IS NULL AND retention_days IS NULL AND source_head IS NULL AND ledger_id IS NULL AND ledger_storage_revision IS NULL AND ledger_body_ref IS NULL AND ledger_body_sha256 IS NULL AND consumed_context_sha256 IS NULL AND source_list_sha256 IS NULL AND source_count IS NULL AND ledger_history_sha256 IS NULL AND ledger_revision_count IS NULL AND manifest_sha256 IS NULL AND manifest_expires_at IS NULL AND source_retention_ceiling IS NULL AND created_at IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_origin_user_event` ON `memory_structured_answer_origins` (`user_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_origin_answer_event` ON `memory_structured_answer_origins` (`answer_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_origin_user_content` ON `memory_structured_answer_origins` (`user_content_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_origin_answer_content` ON `memory_structured_answer_origins` (`answer_content_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_origin_manifest` ON `memory_structured_answer_origins` (`manifest_content_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_origin_turn` ON `memory_structured_answer_origins` (`actor_user_id`,`scope_key`,`turn_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_origin_actor` ON `memory_structured_answer_origins` (`actor_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_origin_enrollment` ON `memory_structured_answer_origins` (`enrollment_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_origin_ledger` ON `memory_structured_answer_origins` (`ledger_id`,`status`);--> statement-breakpoint
CREATE TABLE `memory_structured_answer_originals` (
	`origin_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`event_stream_id` text NOT NULL,
	`event_id` text NOT NULL,
	`source_sequence` integer NOT NULL,
	`event_type` text NOT NULL,
	`role` text NOT NULL,
	`turn_id` text NOT NULL,
	`content_id` text NOT NULL,
	`content_sha256` text NOT NULL,
	`projection_sha256` text NOT NULL,
	`recorded_at` text NOT NULL,
	`source_retention_ceiling` text NOT NULL,
	`retained_by_ledger` integer NOT NULL,
	`presented_in_context` integer NOT NULL,
	PRIMARY KEY(`origin_id`, `ordinal`),
	FOREIGN KEY (`origin_id`) REFERENCES `memory_structured_answer_origins`(`origin_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_structured_originals_bounds" CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 127 AND typeof(source_sequence)='integer' AND source_sequence BETWEEN 1 AND 9007199254740991 AND typeof(retained_by_ledger)='integer' AND retained_by_ledger IN(0,1) AND typeof(presented_in_context)='integer' AND presented_in_context IN(0,1)),
	CONSTRAINT "memory_structured_originals_identity" CHECK(length(origin_id)>0 AND length(event_stream_id)>0 AND length(event_id)>0 AND length(turn_id)>0 AND length(content_id)>0 AND length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*' AND length(projection_sha256)=64 AND projection_sha256 NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_structured_originals_role" CHECK((role='user' AND event_type='ChatMessageSent') OR (role='assistant' AND event_type='AssistantReasoned')),
	CONSTRAINT "memory_structured_originals_lifetime" CHECK(length(recorded_at)>0 AND recorded_at<source_retention_ceiling)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_original_event` ON `memory_structured_answer_originals` (`origin_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_original_sequence` ON `memory_structured_answer_originals` (`origin_id`,`event_stream_id`,`source_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_original_content` ON `memory_structured_answer_originals` (`origin_id`,`content_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_original_turn_role` ON `memory_structured_answer_originals` (`origin_id`,`turn_id`,`role`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_original_source` ON `memory_structured_answer_originals` (`event_stream_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_original_body` ON `memory_structured_answer_originals` (`content_id`);--> statement-breakpoint
CREATE TABLE `memory_structured_answer_ledger_revisions` (
	`origin_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`ledger_id` text NOT NULL,
	`storage_revision` integer NOT NULL,
	`predecessor_revision` integer NOT NULL,
	`predecessor_hash` text,
	`body_ref` text NOT NULL,
	`body_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`origin_id`, `ordinal`),
	FOREIGN KEY (`origin_id`) REFERENCES `memory_structured_answer_origins`(`origin_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_structured_origin_revisions_identity" CHECK(length(origin_id)>0 AND length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_structured_origin_revisions_chain" CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 63 AND typeof(storage_revision)='integer' AND storage_revision=ordinal+1 AND typeof(predecessor_revision)='integer' AND ((storage_revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (storage_revision>1 AND predecessor_revision=storage_revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT "memory_structured_origin_revisions_lifetime" CHECK(length(created_at)>0 AND created_at<expires_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_origin_revision` ON `memory_structured_answer_ledger_revisions` (`origin_id`,`ledger_id`,`storage_revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_structured_origin_revision_body` ON `memory_structured_answer_ledger_revisions` (`origin_id`,`body_ref`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_origin_revision_content` ON `memory_structured_answer_ledger_revisions` (`body_ref`);--> statement-breakpoint
CREATE INDEX `idx_memory_structured_origin_revision_ledger` ON `memory_structured_answer_ledger_revisions` (`ledger_id`);--> statement-breakpoint
CREATE TRIGGER `memory_structured_origin_insert` BEFORE INSERT ON `memory_structured_answer_origins`
WHEN NEW.status<>'active' OR EXISTS(SELECT 1 FROM memory_structured_answer_origins origin
 WHERE origin.origin_id=NEW.origin_id
 OR origin.user_event_id IN(NEW.user_event_id,NEW.answer_event_id) OR origin.answer_event_id IN(NEW.user_event_id,NEW.answer_event_id)
 OR origin.user_content_id IN(NEW.user_content_id,NEW.answer_content_id,NEW.manifest_content_ref)
 OR origin.answer_content_id IN(NEW.user_content_id,NEW.answer_content_id,NEW.manifest_content_ref)
 OR origin.manifest_content_ref IN(NEW.user_content_id,NEW.answer_content_id,NEW.manifest_content_ref)
 OR (origin.actor_user_id=NEW.actor_user_id AND origin.scope_key=NEW.scope_key AND origin.turn_id=NEW.turn_id))
BEGIN SELECT RAISE(ABORT,'structured answer origin requires new active identities'); END;
--> statement-breakpoint
CREATE TRIGGER `memory_structured_origin_immutable` BEFORE UPDATE ON `memory_structured_answer_origins`
WHEN NEW.origin_id IS NOT OLD.origin_id
 OR NEW.schema_version IS NOT OLD.schema_version OR NEW.recipe_version IS NOT OLD.recipe_version
 OR NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.scope_key IS NOT OLD.scope_key
 OR NEW.turn_id IS NOT OLD.turn_id OR NEW.user_event_id IS NOT OLD.user_event_id OR NEW.user_content_id IS NOT OLD.user_content_id
 OR NEW.answer_event_id IS NOT OLD.answer_event_id OR NEW.answer_content_id IS NOT OLD.answer_content_id
 OR NEW.manifest_content_ref IS NOT OLD.manifest_content_ref
 OR (NEW.status IS NOT OLD.status AND NOT((OLD.status='active' AND NEW.status='withdrawn') OR (OLD.status='withdrawn' AND NEW.status='minimized')))
 OR (OLD.status IN('withdrawn','minimized') AND (NEW.withdrawn_at IS NOT OLD.withdrawn_at OR NEW.withdrawal_reason IS NOT OLD.withdrawal_reason))
 OR (NOT(OLD.status='withdrawn' AND NEW.status='minimized') AND (
  NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.project_access_id IS NOT OLD.project_access_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.document_id IS NOT OLD.document_id
  OR NEW.user_source_sequence IS NOT OLD.user_source_sequence OR NEW.user_sha256 IS NOT OLD.user_sha256
  OR NEW.answer_source_sequence IS NOT OLD.answer_source_sequence OR NEW.answer_sha256 IS NOT OLD.answer_sha256
  OR NEW.answer_expires_at IS NOT OLD.answer_expires_at OR NEW.enrollment_id IS NOT OLD.enrollment_id
  OR NEW.enrollment_revision IS NOT OLD.enrollment_revision OR NEW.permission_epoch IS NOT OLD.permission_epoch
  OR NEW.policy_version IS NOT OLD.policy_version OR NEW.enrolled_at IS NOT OLD.enrolled_at
  OR NEW.enrollment_expires_at IS NOT OLD.enrollment_expires_at OR NEW.retention_days IS NOT OLD.retention_days
  OR NEW.source_head IS NOT OLD.source_head OR NEW.ledger_id IS NOT OLD.ledger_id
  OR NEW.ledger_storage_revision IS NOT OLD.ledger_storage_revision OR NEW.ledger_body_ref IS NOT OLD.ledger_body_ref
  OR NEW.ledger_body_sha256 IS NOT OLD.ledger_body_sha256 OR NEW.consumed_context_sha256 IS NOT OLD.consumed_context_sha256
  OR NEW.source_list_sha256 IS NOT OLD.source_list_sha256 OR NEW.source_count IS NOT OLD.source_count
  OR NEW.ledger_history_sha256 IS NOT OLD.ledger_history_sha256 OR NEW.ledger_revision_count IS NOT OLD.ledger_revision_count
  OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256 OR NEW.manifest_expires_at IS NOT OLD.manifest_expires_at
  OR NEW.source_retention_ceiling IS NOT OLD.source_retention_ceiling OR NEW.created_at IS NOT OLD.created_at))
 OR (NEW.status='minimized' AND (EXISTS(SELECT 1 FROM memory_structured_answer_originals original WHERE original.origin_id=OLD.origin_id)
  OR EXISTS(SELECT 1 FROM memory_structured_answer_ledger_revisions revision WHERE revision.origin_id=OLD.origin_id)))
BEGIN SELECT RAISE(ABORT,'structured answer origin permits only first withdrawal and final minimization'); END;
--> statement-breakpoint
CREATE TRIGGER `memory_structured_origin_no_delete` BEFORE DELETE ON `memory_structured_answer_origins`
BEGIN SELECT RAISE(ABORT,'structured answer origin tombstones are retained'); END;
--> statement-breakpoint
CREATE TRIGGER `memory_structured_original_insert` BEFORE INSERT ON `memory_structured_answer_originals`
WHEN NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.origin_id=NEW.origin_id AND origin.status='active' AND NEW.ordinal<origin.source_count)
 OR EXISTS(SELECT 1 FROM memory_structured_answer_originals original WHERE original.origin_id=NEW.origin_id
  AND (original.ordinal=NEW.ordinal OR original.event_id=NEW.event_id
   OR (original.event_stream_id=NEW.event_stream_id AND original.source_sequence=NEW.source_sequence)
   OR original.content_id=NEW.content_id OR (original.turn_id=NEW.turn_id AND original.role=NEW.role)))
BEGIN SELECT RAISE(ABORT,'structured original requires active bounded origin'); END;
--> statement-breakpoint
CREATE TRIGGER `memory_structured_original_immutable` BEFORE UPDATE ON `memory_structured_answer_originals`
BEGIN SELECT RAISE(ABORT,'structured original dependency is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `memory_structured_original_withdrawn_delete` BEFORE DELETE ON `memory_structured_answer_originals`
WHEN NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.origin_id=OLD.origin_id AND origin.status='withdrawn')
BEGIN SELECT RAISE(ABORT,'structured original deletion requires withdrawn origin'); END;
--> statement-breakpoint
CREATE TRIGGER `memory_structured_origin_revision_insert` BEFORE INSERT ON `memory_structured_answer_ledger_revisions`
WHEN NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.origin_id=NEW.origin_id AND origin.status='active' AND NEW.ordinal<origin.ledger_revision_count AND NEW.ledger_id=origin.ledger_id)
 OR EXISTS(SELECT 1 FROM memory_structured_answer_ledger_revisions revision WHERE revision.origin_id=NEW.origin_id
  AND (revision.ordinal=NEW.ordinal OR (revision.ledger_id=NEW.ledger_id AND revision.storage_revision=NEW.storage_revision) OR revision.body_ref=NEW.body_ref))
BEGIN SELECT RAISE(ABORT,'structured ledger revision requires active bounded origin'); END;
--> statement-breakpoint
CREATE TRIGGER `memory_structured_origin_revision_immutable` BEFORE UPDATE ON `memory_structured_answer_ledger_revisions`
BEGIN SELECT RAISE(ABORT,'structured ledger revision dependency is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `memory_structured_origin_revision_withdrawn_delete` BEFORE DELETE ON `memory_structured_answer_ledger_revisions`
WHEN NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.origin_id=OLD.origin_id AND origin.status='withdrawn')
BEGIN SELECT RAISE(ABORT,'structured ledger revision deletion requires withdrawn origin'); END;
