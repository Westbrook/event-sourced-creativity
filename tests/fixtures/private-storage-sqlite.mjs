import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// Dedicated source-authored storage fixture. No application imports, authority
// results, storage bodies, schema hashes or successful SQL results are supplied.
export const PAST = '2000-01-01T00:00:00.000Z';
export const FUTURE = '2999-01-01T00:00:00.000Z';
const ident = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/u); return value; };
const DDL = "  CREATE TABLE users(user_id TEXT PRIMARY KEY,email TEXT,display_name TEXT,role TEXT,consent_version TEXT,consented_at TEXT,created_at TEXT,updated_at TEXT);\n  CREATE TABLE capability_grants(grant_id TEXT PRIMARY KEY,user_id TEXT,capability TEXT,scope_type TEXT,organization_id TEXT,project_access_id TEXT,status TEXT,revoked_at TEXT,expires_at TEXT,updated_at TEXT);\n  CREATE TABLE organizations(organization_id TEXT PRIMARY KEY,name TEXT,owner_user_id TEXT,status TEXT,updated_at TEXT);\n  CREATE TABLE organization_memberships(membership_id TEXT PRIMARY KEY,organization_id TEXT,user_id TEXT,role TEXT,status TEXT,accepted_at TEXT,revoked_at TEXT,updated_at TEXT);\n  CREATE TABLE organization_projects(project_access_id TEXT PRIMARY KEY,organization_id TEXT,project_id TEXT,owner_user_id TEXT,status TEXT,updated_at TEXT);\n  CREATE TABLE project_memberships(membership_id TEXT PRIMARY KEY,project_access_id TEXT,organization_id TEXT,project_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT,updated_at TEXT);\n  CREATE TABLE pilot_cohorts(cohort_id TEXT PRIMARY KEY,organization_id TEXT,status TEXT,starts_at TEXT,ends_at TEXT,created_at TEXT,participant_cap_microusd INTEGER);\n  CREATE TABLE pilot_participants(participant_id TEXT PRIMARY KEY,cohort_id TEXT,organization_id TEXT,email_normalized TEXT,user_id TEXT,status TEXT,revoked_at TEXT,role TEXT);\n  CREATE TABLE organization_security_policies(organization_id TEXT PRIMARY KEY,authentication_source TEXT,allowed_domains_json TEXT,require_mfa INTEGER,version INTEGER,updated_at TEXT);\n  CREATE TABLE organization_identity_bindings(organization_id TEXT,user_id TEXT,status TEXT,authentication_source TEXT,subject TEXT,updated_at TEXT,PRIMARY KEY(organization_id,user_id));\n  CREATE TABLE canvas_governance_requirements(requirement_id TEXT PRIMARY KEY,status TEXT,details_json TEXT,evidence_ref TEXT);\n  CREATE TABLE project_event_scopes(project_access_id TEXT,organization_id TEXT,event_id TEXT,project_sequence INTEGER);\n  CREATE TABLE impersonation_sessions(impersonation_id TEXT PRIMARY KEY,actor_user_id TEXT,persona_id TEXT,fictional_user_id TEXT,status TEXT,expires_at TEXT,updated_at TEXT,replay_session_id TEXT,started_at TEXT);\n  CREATE TABLE replay_personas(persona_id TEXT PRIMARY KEY,display_name TEXT,status TEXT);\n  CREATE TABLE project_context_sessions(context_id TEXT PRIMARY KEY,principal_user_id TEXT,organization_id TEXT,project_access_id TEXT,expires_at TEXT,revoked_at TEXT);\n  CREATE TABLE project_migration_states(project_access_id TEXT,organization_id TEXT,status TEXT,PRIMARY KEY(project_access_id,organization_id));\n  CREATE TABLE events (\n    event_id TEXT PRIMARY KEY NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL,\n    occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL, client_id TEXT NOT NULL,\n    correlation_id TEXT NOT NULL, causation_id TEXT, compensates_event_id TEXT,\n    schema_version INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL, payload TEXT NOT NULL\n  );\n  CREATE UNIQUE INDEX idx_events_stream_sequence ON events(stream_id, sequence);\n  CREATE TABLE event_private_payloads (private_event_id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT NOT NULL,created_at TEXT NOT NULL,redacted_at TEXT);\n  CREATE INDEX idx_event_private_payloads_owner_scope ON event_private_payloads(owner_id,project_id,document_id,redacted_at);\n  CREATE TABLE event_client_receipts (stream_id TEXT NOT NULL, client_event_id TEXT NOT NULL, event_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(stream_id,client_event_id));\n  CREATE INDEX idx_event_client_receipts_event ON event_client_receipts(event_id);\n  CREATE TABLE IF NOT EXISTS private_content (content_id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, redacted_at TEXT);\n  CREATE TABLE IF NOT EXISTS project_resource_scopes (project_access_id TEXT NOT NULL,resource_kind TEXT NOT NULL,resource_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,visibility TEXT NOT NULL DEFAULT 'collaborative_output',source_event_id TEXT,actor_user_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_access_id,resource_kind,resource_id));\n  CREATE TABLE IF NOT EXISTS organization_retention_policies(organization_id TEXT PRIMARY KEY NOT NULL,transient_days INTEGER NOT NULL DEFAULT 30,evidence_days INTEGER NOT NULL DEFAULT 365,revision_days INTEGER NOT NULL DEFAULT 365,legal_hold INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,updated_by_user_id TEXT NOT NULL,updated_at TEXT NOT NULL);\n  CREATE TABLE IF NOT EXISTS private_content_retention_scopes(content_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,project_access_id TEXT NOT NULL,project_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,classification TEXT NOT NULL,policy_version INTEGER NOT NULL,assigned_expires_at TEXT NOT NULL,created_at TEXT NOT NULL);\n  CREATE TABLE IF NOT EXISTS organization_legal_holds(hold_id TEXT PRIMARY KEY NOT NULL,organization_id TEXT NOT NULL,scope_kind TEXT NOT NULL,resource_id TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,released_at TEXT);\n";
// Exact selected declarations; evidence prefixes only were removed. Keep
// embedded line breaks, quotes, breakpoint comments and trigger bodies intact.
const ADDITIVE_SCHEMA_SQL = Object.freeze({
  "structured": "CREATE TABLE `memory_structured_answer_origins` (\n\t`origin_id` text PRIMARY KEY NOT NULL,\n\t`schema_version` integer NOT NULL,\n\t`recipe_version` text NOT NULL,\n\t`actor_user_id` text NOT NULL,\n\t`owner_user_id` text,\n\t`organization_id` text,\n\t`project_access_id` text,\n\t`project_id` text,\n\t`document_id` text,\n\t`scope_key` text NOT NULL,\n\t`turn_id` text NOT NULL,\n\t`user_event_id` text NOT NULL,\n\t`user_content_id` text NOT NULL,\n\t`user_source_sequence` integer,\n\t`user_sha256` text,\n\t`answer_event_id` text NOT NULL,\n\t`answer_content_id` text NOT NULL,\n\t`answer_source_sequence` integer,\n\t`answer_sha256` text,\n\t`answer_expires_at` text,\n\t`enrollment_id` text,\n\t`enrollment_revision` integer,\n\t`permission_epoch` text,\n\t`policy_version` text,\n\t`enrolled_at` text,\n\t`enrollment_expires_at` text,\n\t`retention_days` integer,\n\t`source_head` integer,\n\t`ledger_id` text,\n\t`ledger_storage_revision` integer,\n\t`ledger_body_ref` text,\n\t`ledger_body_sha256` text,\n\t`consumed_context_sha256` text,\n\t`source_list_sha256` text,\n\t`source_count` integer,\n\t`ledger_history_sha256` text,\n\t`ledger_revision_count` integer,\n\t`manifest_content_ref` text NOT NULL,\n\t`manifest_sha256` text,\n\t`manifest_expires_at` text,\n\t`source_retention_ceiling` text,\n\t`created_at` text,\n\t`status` text NOT NULL,\n\t`withdrawn_at` text,\n\t`withdrawal_reason` text,\n\tCONSTRAINT \"memory_structured_origins_version\" CHECK(typeof(schema_version)='integer' AND schema_version=1 AND recipe_version='native-structured-answer-origin-v1'),\n\tCONSTRAINT \"memory_structured_origins_scope\" CHECK(length(origin_id)>0 AND length(actor_user_id)>0 AND length(scope_key)>0 AND length(turn_id)>0 AND (status='minimized' OR (length(owner_user_id)>0 AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND actor_user_id=owner_user_id) OR (organization_id IS NOT NULL AND project_access_id IS NOT NULL AND length(organization_id)>0 AND length(project_access_id)>0))))),\n\tCONSTRAINT \"memory_structured_origins_scope_key\" CHECK(CASE WHEN json_valid(scope_key) THEN json_type(scope_key)='array' AND json_array_length(scope_key)=4 AND json_type(scope_key,'$[0]')='text' AND json_type(scope_key,'$[1]')='text' AND json_type(scope_key,'$[2]')='text' AND json_type(scope_key,'$[3]')='text' AND ((json_extract(scope_key,'$[0]')='' AND json_extract(scope_key,'$[1]')='') OR (json_extract(scope_key,'$[0]')<>'' AND json_extract(scope_key,'$[1]')<>'')) AND json_extract(scope_key,'$[2]')<>'' AND json_extract(scope_key,'$[3]')<>'' AND scope_key=json_array(json_extract(scope_key,'$[0]'),json_extract(scope_key,'$[1]'),json_extract(scope_key,'$[2]'),json_extract(scope_key,'$[3]')) AND (status='minimized' OR (json_extract(scope_key,'$[0]')=COALESCE(organization_id,'') AND json_extract(scope_key,'$[1]')=COALESCE(project_access_id,'') AND json_extract(scope_key,'$[2]')=project_id AND json_extract(scope_key,'$[3]')=document_id)) ELSE 0 END),\n\tCONSTRAINT \"memory_structured_origins_identities\" CHECK(length(user_event_id)>0 AND length(answer_event_id)>0 AND user_event_id<>answer_event_id AND length(user_content_id)>0 AND length(answer_content_id)>0 AND length(manifest_content_ref)>0 AND user_content_id<>answer_content_id AND manifest_content_ref<>user_content_id AND manifest_content_ref<>answer_content_id AND (status='minimized' OR (length(ledger_body_ref)>0 AND length(enrollment_id)>0 AND length(permission_epoch)>0 AND length(policy_version)>0))),\n\tCONSTRAINT \"memory_structured_origins_hashes\" CHECK(status='minimized' OR (length(user_sha256)=64 AND user_sha256 NOT GLOB '*[^0-9a-f]*' AND length(answer_sha256)=64 AND answer_sha256 NOT GLOB '*[^0-9a-f]*' AND length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*' AND length(ledger_body_sha256)=64 AND ledger_body_sha256 NOT GLOB '*[^0-9a-f]*' AND length(consumed_context_sha256)=64 AND consumed_context_sha256 NOT GLOB '*[^0-9a-f]*' AND length(source_list_sha256)=64 AND source_list_sha256 NOT GLOB '*[^0-9a-f]*' AND length(ledger_history_sha256)=64 AND ledger_history_sha256 NOT GLOB '*[^0-9a-f]*' AND length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),\n\tCONSTRAINT \"memory_structured_origins_enrollment\" CHECK(status='minimized' OR (typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(retention_days)='integer' AND retention_days BETWEEN 1 AND 365)),\n\tCONSTRAINT \"memory_structured_origins_sequences\" CHECK(status='minimized' OR (typeof(source_head)='integer' AND source_head BETWEEN 1 AND 9007199254740989 AND typeof(user_source_sequence)='integer' AND user_source_sequence=source_head+1 AND typeof(answer_source_sequence)='integer' AND answer_source_sequence=source_head+2)),\n\tCONSTRAINT \"memory_structured_origins_counts\" CHECK(status='minimized' OR (typeof(source_count)='integer' AND source_count BETWEEN 2 AND 128 AND source_count%2=0 AND typeof(ledger_storage_revision)='integer' AND ledger_storage_revision BETWEEN 1 AND 64 AND typeof(ledger_revision_count)='integer' AND ledger_revision_count=ledger_storage_revision)),\n\tCONSTRAINT \"memory_structured_origins_lifetime\" CHECK(status='minimized' OR (length(enrolled_at)>0 AND enrolled_at<=created_at AND created_at<answer_expires_at AND created_at<manifest_expires_at AND answer_expires_at<=source_retention_ceiling AND manifest_expires_at<=source_retention_ceiling AND source_retention_ceiling<=enrollment_expires_at)),\n\tCONSTRAINT \"memory_structured_origins_state\" CHECK((status='active' AND withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR (status IN('withdrawn','minimized') AND withdrawn_at IS NOT NULL AND length(withdrawn_at)>0 AND withdrawal_reason IS NOT NULL AND (status='minimized' OR created_at<=withdrawn_at) AND withdrawal_reason IN('source-unavailable','source-changed','source-expired','enrollment-changed','access-withdrawn','erased','manual'))),\n\tCONSTRAINT \"memory_structured_origins_shape\" CHECK((status IN('active','withdrawn') AND owner_user_id IS NOT NULL AND project_id IS NOT NULL AND document_id IS NOT NULL AND user_source_sequence IS NOT NULL AND user_sha256 IS NOT NULL AND answer_source_sequence IS NOT NULL AND answer_sha256 IS NOT NULL AND answer_expires_at IS NOT NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND enrolled_at IS NOT NULL AND enrollment_expires_at IS NOT NULL AND retention_days IS NOT NULL AND source_head IS NOT NULL AND ledger_id IS NOT NULL AND ledger_storage_revision IS NOT NULL AND ledger_body_ref IS NOT NULL AND ledger_body_sha256 IS NOT NULL AND consumed_context_sha256 IS NOT NULL AND source_list_sha256 IS NOT NULL AND source_count IS NOT NULL AND ledger_history_sha256 IS NOT NULL AND ledger_revision_count IS NOT NULL AND manifest_sha256 IS NOT NULL AND manifest_expires_at IS NOT NULL AND source_retention_ceiling IS NOT NULL AND created_at IS NOT NULL) OR (status='minimized' AND owner_user_id IS NULL AND organization_id IS NULL AND project_access_id IS NULL AND project_id IS NULL AND document_id IS NULL AND user_source_sequence IS NULL AND user_sha256 IS NULL AND answer_source_sequence IS NULL AND answer_sha256 IS NULL AND answer_expires_at IS NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND enrolled_at IS NULL AND enrollment_expires_at IS NULL AND retention_days IS NULL AND source_head IS NULL AND ledger_id IS NULL AND ledger_storage_revision IS NULL AND ledger_body_ref IS NULL AND ledger_body_sha256 IS NULL AND consumed_context_sha256 IS NULL AND source_list_sha256 IS NULL AND source_count IS NULL AND ledger_history_sha256 IS NULL AND ledger_revision_count IS NULL AND manifest_sha256 IS NULL AND manifest_expires_at IS NULL AND source_retention_ceiling IS NULL AND created_at IS NULL))\n);\nCREATE UNIQUE INDEX `idx_memory_structured_origin_user_event` ON `memory_structured_answer_origins` (`user_event_id`);--> statement-breakpoint\nCREATE UNIQUE INDEX `idx_memory_structured_origin_answer_event` ON `memory_structured_answer_origins` (`answer_event_id`);--> statement-breakpoint\nCREATE UNIQUE INDEX `idx_memory_structured_origin_user_content` ON `memory_structured_answer_origins` (`user_content_id`);--> statement-breakpoint\nCREATE UNIQUE INDEX `idx_memory_structured_origin_answer_content` ON `memory_structured_answer_origins` (`answer_content_id`);--> statement-breakpoint\nCREATE UNIQUE INDEX `idx_memory_structured_origin_manifest` ON `memory_structured_answer_origins` (`manifest_content_ref`);--> statement-breakpoint\nCREATE UNIQUE INDEX `idx_memory_structured_origin_turn` ON `memory_structured_answer_origins` (`actor_user_id`,`scope_key`,`turn_id`);--> statement-breakpoint\nCREATE INDEX `idx_memory_structured_origin_actor` ON `memory_structured_answer_origins` (`actor_user_id`,`status`);--> statement-breakpoint\nCREATE INDEX `idx_memory_structured_origin_enrollment` ON `memory_structured_answer_origins` (`enrollment_id`,`status`);--> statement-breakpoint\nCREATE INDEX `idx_memory_structured_origin_ledger` ON `memory_structured_answer_origins` (`ledger_id`,`status`);--> statement-breakpoint\nCREATE TABLE `memory_structured_answer_originals` (\n\t`origin_id` text NOT NULL,\n\t`ordinal` integer NOT NULL,\n\t`event_stream_id` text NOT NULL,\n\t`event_id` text NOT NULL,\n\t`source_sequence` integer NOT NULL,\n\t`event_type` text NOT NULL,\n\t`role` text NOT NULL,\n\t`turn_id` text NOT NULL,\n\t`content_id` text NOT NULL,\n\t`content_sha256` text NOT NULL,\n\t`projection_sha256` text NOT NULL,\n\t`recorded_at` text NOT NULL,\n\t`source_retention_ceiling` text NOT NULL,\n\t`retained_by_ledger` integer NOT NULL,\n\t`presented_in_context` integer NOT NULL,\n\tPRIMARY KEY(`origin_id`, `ordinal`),\n\tFOREIGN KEY (`origin_id`) REFERENCES `memory_structured_answer_origins`(`origin_id`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"memory_structured_originals_bounds\" CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 127 AND typeof(source_sequence)='integer' AND source_sequence BETWEEN 1 AND 9007199254740991 AND typeof(retained_by_ledger)='integer' AND retained_by_ledger IN(0,1) AND typeof(presented_in_context)='integer' AND presented_in_context IN(0,1)),\n\tCONSTRAINT \"memory_structured_originals_identity\" CHECK(length(origin_id)>0 AND length(event_stream_id)>0 AND length(event_id)>0 AND length(turn_id)>0 AND length(content_id)>0 AND length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^0-9a-f]*' AND length(projection_sha256)=64 AND projection_sha256 NOT GLOB '*[^0-9a-f]*'),\n\tCONSTRAINT \"memory_structured_originals_role\" CHECK((role='user' AND event_type='ChatMessageSent') OR (role='assistant' AND event_type='AssistantReasoned')),\n\tCONSTRAINT \"memory_structured_originals_lifetime\" CHECK(length(recorded_at)>0 AND recorded_at<source_retention_ceiling)\n);\nCREATE UNIQUE INDEX `idx_memory_structured_original_event` ON `memory_structured_answer_originals` (`origin_id`,`event_id`);--> statement-breakpoint\nCREATE UNIQUE INDEX `idx_memory_structured_original_sequence` ON `memory_structured_answer_originals` (`origin_id`,`event_stream_id`,`source_sequence`);--> statement-breakpoint\nCREATE UNIQUE INDEX `idx_memory_structured_original_content` ON `memory_structured_answer_originals` (`origin_id`,`content_id`);--> statement-breakpoint\nCREATE UNIQUE INDEX `idx_memory_structured_original_turn_role` ON `memory_structured_answer_originals` (`origin_id`,`turn_id`,`role`);--> statement-breakpoint\nCREATE INDEX `idx_memory_structured_original_source` ON `memory_structured_answer_originals` (`event_stream_id`,`event_id`);--> statement-breakpoint\nCREATE INDEX `idx_memory_structured_original_body` ON `memory_structured_answer_originals` (`content_id`);--> statement-breakpoint\nCREATE TABLE `memory_structured_answer_ledger_revisions` (\n\t`origin_id` text NOT NULL,\n\t`ordinal` integer NOT NULL,\n\t`ledger_id` text NOT NULL,\n\t`storage_revision` integer NOT NULL,\n\t`predecessor_revision` integer NOT NULL,\n\t`predecessor_hash` text,\n\t`body_ref` text NOT NULL,\n\t`body_hash` text NOT NULL,\n\t`created_at` text NOT NULL,\n\t`expires_at` text NOT NULL,\n\tPRIMARY KEY(`origin_id`, `ordinal`),\n\tFOREIGN KEY (`origin_id`) REFERENCES `memory_structured_answer_origins`(`origin_id`) ON UPDATE no action ON DELETE no action,\n\tCONSTRAINT \"memory_structured_origin_revisions_identity\" CHECK(length(origin_id)>0 AND length(ledger_id)=64 AND ledger_id NOT GLOB '*[^0-9a-f]*' AND length(body_ref)>0 AND length(body_hash)=64 AND body_hash NOT GLOB '*[^0-9a-f]*'),\n\tCONSTRAINT \"memory_structured_origin_revisions_chain\" CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 63 AND typeof(storage_revision)='integer' AND storage_revision=ordinal+1 AND typeof(predecessor_revision)='integer' AND ((storage_revision=1 AND predecessor_revision=0 AND predecessor_hash IS NULL) OR (storage_revision>1 AND predecessor_revision=storage_revision-1 AND predecessor_hash IS NOT NULL AND length(predecessor_hash)=64 AND predecessor_hash NOT GLOB '*[^0-9a-f]*'))),\n\tCONSTRAINT \"memory_structured_origin_revisions_lifetime\" CHECK(length(created_at)>0 AND created_at<expires_at)\n);\nCREATE UNIQUE INDEX `idx_memory_structured_origin_revision` ON `memory_structured_answer_ledger_revisions` (`origin_id`,`ledger_id`,`storage_revision`);--> statement-breakpoint\nCREATE UNIQUE INDEX `idx_memory_structured_origin_revision_body` ON `memory_structured_answer_ledger_revisions` (`origin_id`,`body_ref`);--> statement-breakpoint\nCREATE INDEX `idx_memory_structured_origin_revision_content` ON `memory_structured_answer_ledger_revisions` (`body_ref`);--> statement-breakpoint\nCREATE INDEX `idx_memory_structured_origin_revision_ledger` ON `memory_structured_answer_ledger_revisions` (`ledger_id`);--> statement-breakpoint\nCREATE TRIGGER `memory_structured_origin_insert` BEFORE INSERT ON `memory_structured_answer_origins`\nWHEN NEW.status<>'active' OR EXISTS(SELECT 1 FROM memory_structured_answer_origins origin\n WHERE origin.origin_id=NEW.origin_id\n OR origin.user_event_id IN(NEW.user_event_id,NEW.answer_event_id) OR origin.answer_event_id IN(NEW.user_event_id,NEW.answer_event_id)\n OR origin.user_content_id IN(NEW.user_content_id,NEW.answer_content_id,NEW.manifest_content_ref)\n OR origin.answer_content_id IN(NEW.user_content_id,NEW.answer_content_id,NEW.manifest_content_ref)\n OR origin.manifest_content_ref IN(NEW.user_content_id,NEW.answer_content_id,NEW.manifest_content_ref)\n OR (origin.actor_user_id=NEW.actor_user_id AND origin.scope_key=NEW.scope_key AND origin.turn_id=NEW.turn_id))\nBEGIN SELECT RAISE(ABORT,'structured answer origin requires new active identities'); END;\nCREATE TRIGGER `memory_structured_origin_immutable` BEFORE UPDATE ON `memory_structured_answer_origins`\nWHEN NEW.origin_id IS NOT OLD.origin_id\n OR NEW.schema_version IS NOT OLD.schema_version OR NEW.recipe_version IS NOT OLD.recipe_version\n OR NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.scope_key IS NOT OLD.scope_key\n OR NEW.turn_id IS NOT OLD.turn_id OR NEW.user_event_id IS NOT OLD.user_event_id OR NEW.user_content_id IS NOT OLD.user_content_id\n OR NEW.answer_event_id IS NOT OLD.answer_event_id OR NEW.answer_content_id IS NOT OLD.answer_content_id\n OR NEW.manifest_content_ref IS NOT OLD.manifest_content_ref\n OR (NEW.status IS NOT OLD.status AND NOT((OLD.status='active' AND NEW.status='withdrawn') OR (OLD.status='withdrawn' AND NEW.status='minimized')))\n OR (OLD.status IN('withdrawn','minimized') AND (NEW.withdrawn_at IS NOT OLD.withdrawn_at OR NEW.withdrawal_reason IS NOT OLD.withdrawal_reason))\n OR (NOT(OLD.status='withdrawn' AND NEW.status='minimized') AND (\n  NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.project_access_id IS NOT OLD.project_access_id\n  OR NEW.project_id IS NOT OLD.project_id OR NEW.document_id IS NOT OLD.document_id\n  OR NEW.user_source_sequence IS NOT OLD.user_source_sequence OR NEW.user_sha256 IS NOT OLD.user_sha256\n  OR NEW.answer_source_sequence IS NOT OLD.answer_source_sequence OR NEW.answer_sha256 IS NOT OLD.answer_sha256\n  OR NEW.answer_expires_at IS NOT OLD.answer_expires_at OR NEW.enrollment_id IS NOT OLD.enrollment_id\n  OR NEW.enrollment_revision IS NOT OLD.enrollment_revision OR NEW.permission_epoch IS NOT OLD.permission_epoch\n  OR NEW.policy_version IS NOT OLD.policy_version OR NEW.enrolled_at IS NOT OLD.enrolled_at\n  OR NEW.enrollment_expires_at IS NOT OLD.enrollment_expires_at OR NEW.retention_days IS NOT OLD.retention_days\n  OR NEW.source_head IS NOT OLD.source_head OR NEW.ledger_id IS NOT OLD.ledger_id\n  OR NEW.ledger_storage_revision IS NOT OLD.ledger_storage_revision OR NEW.ledger_body_ref IS NOT OLD.ledger_body_ref\n  OR NEW.ledger_body_sha256 IS NOT OLD.ledger_body_sha256 OR NEW.consumed_context_sha256 IS NOT OLD.consumed_context_sha256\n  OR NEW.source_list_sha256 IS NOT OLD.source_list_sha256 OR NEW.source_count IS NOT OLD.source_count\n  OR NEW.ledger_history_sha256 IS NOT OLD.ledger_history_sha256 OR NEW.ledger_revision_count IS NOT OLD.ledger_revision_count\n  OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256 OR NEW.manifest_expires_at IS NOT OLD.manifest_expires_at\n  OR NEW.source_retention_ceiling IS NOT OLD.source_retention_ceiling OR NEW.created_at IS NOT OLD.created_at))\n OR (NEW.status='minimized' AND (EXISTS(SELECT 1 FROM memory_structured_answer_originals original WHERE original.origin_id=OLD.origin_id)\n  OR EXISTS(SELECT 1 FROM memory_structured_answer_ledger_revisions revision WHERE revision.origin_id=OLD.origin_id)))\nBEGIN SELECT RAISE(ABORT,'structured answer origin permits only first withdrawal and final minimization'); END;\nCREATE TRIGGER `memory_structured_origin_no_delete` BEFORE DELETE ON `memory_structured_answer_origins`\nBEGIN SELECT RAISE(ABORT,'structured answer origin tombstones are retained'); END;\nCREATE TRIGGER `memory_structured_original_insert` BEFORE INSERT ON `memory_structured_answer_originals`\nWHEN NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.origin_id=NEW.origin_id AND origin.status='active' AND NEW.ordinal<origin.source_count)\n OR EXISTS(SELECT 1 FROM memory_structured_answer_originals original WHERE original.origin_id=NEW.origin_id\n  AND (original.ordinal=NEW.ordinal OR original.event_id=NEW.event_id\n   OR (original.event_stream_id=NEW.event_stream_id AND original.source_sequence=NEW.source_sequence)\n   OR original.content_id=NEW.content_id OR (original.turn_id=NEW.turn_id AND original.role=NEW.role)))\nBEGIN SELECT RAISE(ABORT,'structured original requires active bounded origin'); END;\nCREATE TRIGGER `memory_structured_original_immutable` BEFORE UPDATE ON `memory_structured_answer_originals`\nBEGIN SELECT RAISE(ABORT,'structured original dependency is immutable'); END;\nCREATE TRIGGER `memory_structured_original_withdrawn_delete` BEFORE DELETE ON `memory_structured_answer_originals`\nWHEN NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.origin_id=OLD.origin_id AND origin.status='withdrawn')\nBEGIN SELECT RAISE(ABORT,'structured original deletion requires withdrawn origin'); END;\nCREATE TRIGGER `memory_structured_origin_revision_insert` BEFORE INSERT ON `memory_structured_answer_ledger_revisions`\nWHEN NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.origin_id=NEW.origin_id AND origin.status='active' AND NEW.ordinal<origin.ledger_revision_count AND NEW.ledger_id=origin.ledger_id)\n OR EXISTS(SELECT 1 FROM memory_structured_answer_ledger_revisions revision WHERE revision.origin_id=NEW.origin_id\n  AND (revision.ordinal=NEW.ordinal OR (revision.ledger_id=NEW.ledger_id AND revision.storage_revision=NEW.storage_revision) OR revision.body_ref=NEW.body_ref))\nBEGIN SELECT RAISE(ABORT,'structured ledger revision requires active bounded origin'); END;\nCREATE TRIGGER `memory_structured_origin_revision_immutable` BEFORE UPDATE ON `memory_structured_answer_ledger_revisions`\nBEGIN SELECT RAISE(ABORT,'structured ledger revision dependency is immutable'); END;\nCREATE TRIGGER `memory_structured_origin_revision_withdrawn_delete` BEFORE DELETE ON `memory_structured_answer_ledger_revisions`\nWHEN NOT EXISTS(SELECT 1 FROM memory_structured_answer_origins origin WHERE origin.origin_id=OLD.origin_id AND origin.status='withdrawn')\nBEGIN SELECT RAISE(ABORT,'structured ledger revision deletion requires withdrawn origin'); END;\n",
  "documentJob": "CREATE TABLE `memory_document_job_answer_origins` (\n  `origin_id` text PRIMARY KEY NOT NULL,\n  `schema_version` integer NOT NULL,\n  `recipe_version` text NOT NULL,\n  `actor_user_id` text NOT NULL,\n  `scope_key` text NOT NULL,\n  `job_id` text NOT NULL,\n  `turn_id` text NOT NULL,\n  `user_event_id` text NOT NULL,\n  `user_content_id` text NOT NULL,\n  `answer_event_id` text NOT NULL,\n  `answer_content_id` text NOT NULL,\n  `manifest_content_ref` text NOT NULL,\n  `owner_user_id` text,\n  `stream_id` text,\n  `organization_id` text,\n  `project_access_id` text,\n  `project_id` text,\n  `document_id` text,\n  `attempt_count` integer,\n  `correlation_id` text,\n  `request_sha256` text,\n  `claim_sha256` text,\n  `input_content_ref` text,\n  `input_sha256` text,\n  `input_expires_at` text,\n  `job_requested_at` text,\n  `job_started_at` text,\n  `job_lease_expires_at` text,\n  `job_expires_at` text,\n  `requested_sequence` integer,\n  `source_head` integer,\n  `project_source_head` integer,\n  `user_source_sequence` integer,\n  `user_sha256` text,\n  `answer_source_sequence` integer,\n  `answer_sha256` text,\n  `answer_expires_at` text,\n  `mode` text,\n  `renderer_recipe` text,\n  `locale` text,\n  `enrollment_id` text,\n  `enrollment_revision` integer,\n  `permission_epoch` text,\n  `policy_version` text,\n  `enrolled_at` text,\n  `enrollment_expires_at` text,\n  `retention_days` integer,\n  `selection_cursor` integer,\n  `consumed_value_sha256` text,\n  `source_count` integer,\n  `ledger_revision_count` integer,\n  `selector_count` integer,\n  `selector_list_sha256` text,\n  `manifest_sha256` text,\n  `manifest_expires_at` text,\n  `proof_valid_until` text,\n  `source_retention_ceiling` text,\n  `created_at` text,\n  `status` text NOT NULL,\n  `withdrawn_at` text,\n  `withdrawal_reason` text,\n  CONSTRAINT `memory_document_job_origins_version` CHECK (COALESCE((typeof(schema_version)='integer' AND schema_version=1 AND recipe_version='native-document-job-answer-origin-v1'),0)),\n  CONSTRAINT `memory_document_job_origins_registrations` CHECK (COALESCE((length(origin_id)>0 AND length(actor_user_id)>0 AND length(scope_key)>0 AND length(job_id)>0 AND length(turn_id)>0 AND length(user_event_id)>0 AND length(user_content_id)>0 AND length(answer_event_id)>0 AND length(answer_content_id)>0 AND length(manifest_content_ref)>0 AND user_event_id<>answer_event_id AND user_content_id<>answer_content_id AND user_content_id<>manifest_content_ref AND answer_content_id<>manifest_content_ref),0)),\n  CONSTRAINT `memory_document_job_origins_scope` CHECK (COALESCE((status='minimized' OR (length(owner_user_id)>0 AND stream_id='creative:'||owner_user_id AND length(project_id)>0 AND length(document_id)>0 AND ((organization_id IS NULL AND project_access_id IS NULL AND project_source_head IS NULL AND actor_user_id=owner_user_id) OR (length(organization_id)>0 AND length(project_access_id)>0 AND typeof(project_source_head)='integer' AND project_source_head BETWEEN 0 AND 9007199254740989)))),0)),\n  CONSTRAINT `memory_document_job_origins_scope_key` CHECK (COALESCE((CASE WHEN json_valid(scope_key) THEN json_type(scope_key)='array' AND json_array_length(scope_key)=4 AND json_type(scope_key,'$[0]')='text' AND json_type(scope_key,'$[1]')='text' AND json_type(scope_key,'$[2]')='text' AND json_type(scope_key,'$[3]')='text' AND ((json_extract(scope_key,'$[0]')='' AND json_extract(scope_key,'$[1]')='') OR (json_extract(scope_key,'$[0]')<>'' AND json_extract(scope_key,'$[1]')<>'')) AND json_extract(scope_key,'$[2]')<>'' AND json_extract(scope_key,'$[3]')<>'' AND scope_key=json_array(json_extract(scope_key,'$[0]'),json_extract(scope_key,'$[1]'),json_extract(scope_key,'$[2]'),json_extract(scope_key,'$[3]')) AND (status='minimized' OR (json_extract(scope_key,'$[0]')=COALESCE(organization_id,'') AND json_extract(scope_key,'$[1]')=COALESCE(project_access_id,'') AND json_extract(scope_key,'$[2]')=project_id AND json_extract(scope_key,'$[3]')=document_id)) ELSE 0 END),0)),\n  CONSTRAINT `memory_document_job_origins_identities` CHECK (COALESCE((status='minimized' OR (length(correlation_id)>0 AND length(input_content_ref)>0 AND renderer_recipe='document-job-evidence-answer-v1' AND length(enrollment_id)>0 AND length(permission_epoch)>0 AND length(policy_version)>0 AND typeof(attempt_count)='integer' AND attempt_count BETWEEN 1 AND 9007199254740991 AND input_content_ref<>answer_content_id AND input_content_ref<>manifest_content_ref)),0)),\n  CONSTRAINT `memory_document_job_origins_hashes` CHECK (COALESCE((status='minimized' OR (length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*' AND length(claim_sha256)=64 AND claim_sha256 NOT GLOB '*[^0-9a-f]*' AND length(input_sha256)=64 AND input_sha256 NOT GLOB '*[^0-9a-f]*' AND length(user_sha256)=64 AND user_sha256 NOT GLOB '*[^0-9a-f]*' AND length(answer_sha256)=64 AND answer_sha256 NOT GLOB '*[^0-9a-f]*' AND length(consumed_value_sha256)=64 AND consumed_value_sha256 NOT GLOB '*[^0-9a-f]*' AND length(selector_list_sha256)=64 AND selector_list_sha256 NOT GLOB '*[^0-9a-f]*' AND length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),0)),\n  CONSTRAINT `memory_document_job_origins_sequences` CHECK (COALESCE((status='minimized' OR (typeof(source_head)='integer' AND source_head BETWEEN 1 AND 9007199254740989 AND typeof(requested_sequence)='integer' AND requested_sequence BETWEEN 0 AND source_head AND typeof(selection_cursor)='integer' AND selection_cursor<=source_head AND ((mode='extractive' AND selection_cursor>=1) OR (mode='structured' AND selection_cursor>=0)) AND typeof(user_source_sequence)='integer' AND user_source_sequence=source_head+1 AND typeof(answer_source_sequence)='integer' AND answer_source_sequence=source_head+2)),0)),\n  CONSTRAINT `memory_document_job_origins_evidence` CHECK (COALESCE((status='minimized' OR (locale IN('en','fr','ar','ja') AND typeof(source_count)='integer' AND source_count BETWEEN 1 AND 128 AND typeof(ledger_revision_count)='integer' AND ((mode='extractive' AND ledger_revision_count=0) OR (mode='structured' AND source_count>=2 AND source_count%2=0 AND ledger_revision_count BETWEEN 1 AND 64)) AND typeof(selector_count)='integer' AND selector_count BETWEEN 1 AND 513)),0)),\n  CONSTRAINT `memory_document_job_origins_enrollment` CHECK (COALESCE((status='minimized' OR (typeof(enrollment_revision)='integer' AND enrollment_revision BETWEEN 1 AND 9007199254740991 AND typeof(retention_days)='integer' AND retention_days BETWEEN 1 AND 365)),0)),\n  CONSTRAINT `memory_document_job_origins_timestamps` CHECK (COALESCE((status='minimized' OR (length(input_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',input_expires_at)=input_expires_at AND length(job_requested_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_requested_at)=job_requested_at AND length(job_started_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_started_at)=job_started_at AND length(job_lease_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_lease_expires_at)=job_lease_expires_at AND length(job_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',job_expires_at)=job_expires_at AND length(answer_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',answer_expires_at)=answer_expires_at AND length(enrolled_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',enrolled_at)=enrolled_at AND length(enrollment_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',enrollment_expires_at)=enrollment_expires_at AND length(manifest_expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',manifest_expires_at)=manifest_expires_at AND length(proof_valid_until)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',proof_valid_until)=proof_valid_until AND length(source_retention_ceiling)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',source_retention_ceiling)=source_retention_ceiling AND length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)),0)),\n  CONSTRAINT `memory_document_job_origins_lifetime` CHECK (COALESCE((status='minimized' OR (job_requested_at<=job_started_at AND job_started_at<=created_at AND enrolled_at<=created_at AND created_at<proof_valid_until AND proof_valid_until<=job_lease_expires_at AND proof_valid_until<=input_expires_at AND proof_valid_until<=job_expires_at AND proof_valid_until<=source_retention_ceiling AND created_at<answer_expires_at AND answer_expires_at<=manifest_expires_at AND manifest_expires_at<=source_retention_ceiling AND source_retention_ceiling<=enrollment_expires_at AND manifest_expires_at<=input_expires_at AND manifest_expires_at<=job_expires_at)),0)),\n  CONSTRAINT `memory_document_job_origins_state` CHECK (COALESCE(((status='active' AND withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR (status IN('withdrawn','minimized') AND length(withdrawn_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',withdrawn_at)=withdrawn_at AND withdrawal_reason IN('source-unavailable','source-changed','source-expired','enrollment-changed','access-withdrawn','job-changed','erased','manual') AND (status='minimized' OR created_at<=withdrawn_at))),0)),\n  CONSTRAINT `memory_document_job_origins_shape` CHECK (COALESCE(((status IN('active','withdrawn') AND owner_user_id IS NOT NULL AND stream_id IS NOT NULL AND project_id IS NOT NULL AND document_id IS NOT NULL AND attempt_count IS NOT NULL AND correlation_id IS NOT NULL AND request_sha256 IS NOT NULL AND claim_sha256 IS NOT NULL AND input_content_ref IS NOT NULL AND input_sha256 IS NOT NULL AND input_expires_at IS NOT NULL AND job_requested_at IS NOT NULL AND job_started_at IS NOT NULL AND job_lease_expires_at IS NOT NULL AND job_expires_at IS NOT NULL AND requested_sequence IS NOT NULL AND source_head IS NOT NULL AND user_source_sequence IS NOT NULL AND user_sha256 IS NOT NULL AND answer_source_sequence IS NOT NULL AND answer_sha256 IS NOT NULL AND answer_expires_at IS NOT NULL AND mode IS NOT NULL AND renderer_recipe IS NOT NULL AND locale IS NOT NULL AND enrollment_id IS NOT NULL AND enrollment_revision IS NOT NULL AND permission_epoch IS NOT NULL AND policy_version IS NOT NULL AND enrolled_at IS NOT NULL AND enrollment_expires_at IS NOT NULL AND retention_days IS NOT NULL AND selection_cursor IS NOT NULL AND consumed_value_sha256 IS NOT NULL AND source_count IS NOT NULL AND ledger_revision_count IS NOT NULL AND selector_count IS NOT NULL AND selector_list_sha256 IS NOT NULL AND manifest_sha256 IS NOT NULL AND manifest_expires_at IS NOT NULL AND proof_valid_until IS NOT NULL AND source_retention_ceiling IS NOT NULL AND created_at IS NOT NULL) OR (status='minimized' AND owner_user_id IS NULL AND stream_id IS NULL AND organization_id IS NULL AND project_access_id IS NULL AND project_id IS NULL AND document_id IS NULL AND attempt_count IS NULL AND correlation_id IS NULL AND request_sha256 IS NULL AND claim_sha256 IS NULL AND input_content_ref IS NULL AND input_sha256 IS NULL AND input_expires_at IS NULL AND job_requested_at IS NULL AND job_started_at IS NULL AND job_lease_expires_at IS NULL AND job_expires_at IS NULL AND requested_sequence IS NULL AND source_head IS NULL AND project_source_head IS NULL AND user_source_sequence IS NULL AND user_sha256 IS NULL AND answer_source_sequence IS NULL AND answer_sha256 IS NULL AND answer_expires_at IS NULL AND mode IS NULL AND renderer_recipe IS NULL AND locale IS NULL AND enrollment_id IS NULL AND enrollment_revision IS NULL AND permission_epoch IS NULL AND policy_version IS NULL AND enrolled_at IS NULL AND enrollment_expires_at IS NULL AND retention_days IS NULL AND selection_cursor IS NULL AND consumed_value_sha256 IS NULL AND source_count IS NULL AND ledger_revision_count IS NULL AND selector_count IS NULL AND selector_list_sha256 IS NULL AND manifest_sha256 IS NULL AND manifest_expires_at IS NULL AND proof_valid_until IS NULL AND source_retention_ceiling IS NULL AND created_at IS NULL)),0))\n);\nCREATE UNIQUE INDEX `idx_memory_document_job_origin_job_id` ON `memory_document_job_answer_origins` (`job_id`);\nCREATE UNIQUE INDEX `idx_memory_document_job_origin_user_event_id` ON `memory_document_job_answer_origins` (`user_event_id`);\nCREATE UNIQUE INDEX `idx_memory_document_job_origin_answer_event_id` ON `memory_document_job_answer_origins` (`answer_event_id`);\nCREATE UNIQUE INDEX `idx_memory_document_job_origin_user_content_id` ON `memory_document_job_answer_origins` (`user_content_id`);\nCREATE UNIQUE INDEX `idx_memory_document_job_origin_answer_content_id` ON `memory_document_job_answer_origins` (`answer_content_id`);\nCREATE UNIQUE INDEX `idx_memory_document_job_origin_manifest_content_ref` ON `memory_document_job_answer_origins` (`manifest_content_ref`);\nCREATE UNIQUE INDEX `idx_memory_document_job_origin_turn` ON `memory_document_job_answer_origins` (`actor_user_id`, `scope_key`, `turn_id`);\nCREATE INDEX `idx_memory_document_job_origin_actor` ON `memory_document_job_answer_origins` (`actor_user_id`, `status`);\nCREATE INDEX `idx_memory_document_job_origin_enrollment` ON `memory_document_job_answer_origins` (`enrollment_id`, `status`);\nCREATE INDEX `idx_memory_document_job_origin_scope` ON `memory_document_job_answer_origins` (`actor_user_id`, `scope_key`, `status`);\nCREATE INDEX `idx_memory_document_job_origin_expiry` ON `memory_document_job_answer_origins` (`status`, `answer_expires_at`);\nCREATE TABLE `memory_document_job_origin_dependencies` (\n  `origin_id` text NOT NULL,\n  `resource_kind` text NOT NULL,\n  `resource_id` text NOT NULL,\n  CONSTRAINT `memory_document_job_origin_dependencies_origin_id_resource_kind_resource_id_pk` PRIMARY KEY (`origin_id`, `resource_kind`, `resource_id`),\n  CONSTRAINT `memory_document_job_origin_dependencies_origin_id_memory_document_job_answer_origins_origin_id_fk` FOREIGN KEY (`origin_id`) REFERENCES `memory_document_job_answer_origins` (`origin_id`) ON UPDATE NO ACTION ON DELETE CASCADE,\n  CONSTRAINT `memory_document_job_origin_dependencies_shape` CHECK (COALESCE((length(origin_id)>0 AND resource_kind IN('event','private-content','ledger','enrollment') AND length(resource_id)>0),0))\n);\nCREATE INDEX `idx_memory_document_job_origin_dependency` ON `memory_document_job_origin_dependencies` (`resource_kind`, `resource_id`, `origin_id`);\n"
});
const REGISTRY_TABLES = Object.freeze([
  'memory_structured_answer_origins', 'memory_structured_answer_originals',
  'memory_structured_answer_ledger_revisions', 'memory_document_job_answer_origins',
  'memory_document_job_origin_dependencies',
]);

export function createPrivateStorageSqlite({ schema = 'absent' } = {}) {
  assert.ok(schema === 'absent' || schema === 'exact-present', 'Unknown fixture schema arrangement');
  const normalized = sql => sql.trim().replace(/\s+/gu, ' ');
  const personalInsertPrefix = 'INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) SELECT ?,?,?,CASE WHEN (';
  const personalInsertSuffix = ') THEN ? ELSE NULL END,?,?,NULL';
  const personalCleanupPrefix = "UPDATE private_content SET content='',redacted_at=? WHERE owner_id=? AND redacted_at IS NULL AND kind NOT IN('document-artifact','memory-structured-ledger','memory-structured-origin','memory-document-job-origin') AND expires_at<=? AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=private_content.content_id) AND ";
  const data = { schema, retired: false, closed: false, forbiddenWrites: 0, reentrantAttempts: 0, lateReadAttempts: 0,
    prepares: 0, first: 0, all: 0, readBatches: 0, batchAttempts: 0, committedBatches: 0, rolledBackBatches: 0,
    lostAckThrows: 0, reads: [], batches: [], fixtureMutations: [], fixtureDdl: [], cleanupFailure: null };
  let connectionActive = false, transactionOpen = false, nextLostAck = false;
  const statements = new WeakMap();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
    db.exec(DDL);
    data.fixtureDdl.push({ label: 'base-canonical-and-existing-account-schema', sql: DDL });
    if (schema === 'exact-present') {
      for (const [family, sql] of Object.entries(ADDITIVE_SCHEMA_SQL)) {
        db.exec(sql); // Exact SQL setup only; never a migration/lifecycle runner.
        data.fixtureDdl.push({ label: `exact-empty-${family}-schema`, sql });
      }
    }
    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
    const tables = new Set(tableNames);
    function live() {
      if (data.retired || data.closed) { data.lateReadAttempts++; throw Error('Private storage fixture retired'); }
    }
    function idle() {
      if (connectionActive) { data.reentrantAttempts++; throw Error('Private storage fixture connection is already owned'); }
    }
    function acquire() { live(); idle(); connectionActive = true; }
    function refuse(message) { data.forbiddenWrites++; throw Error(message); }
    function readable(sql) {
      if (!/^\s*(?:SELECT|WITH)\b/iu.test(sql)) refuse('Private storage attempted non-read SQL outside batch');
    }
    function selectedWrite(sql, index) {
      const compact = normalized(sql);
      const allowed = index === 0
        ? compact.startsWith(personalInsertPrefix) && compact.endsWith(personalInsertSuffix)
        : index === 1 && compact.startsWith(personalCleanupPrefix);
      if (sql.includes(';') || !allowed) refuse('Private storage attempted an unexpected production batch statement');
    }
    function copyBindings(bindings) {
      assert.ok(Array.isArray(bindings));
      // This selected closure binds only scalar SQL values. Reject mutable blobs
      // rather than exposing a second alias into a prepared statement's values.
      for (const value of bindings) assert.ok(value === null || typeof value === 'string' ||
        typeof value === 'number' || typeof value === 'bigint', 'Only scalar fixture bindings are admitted');
      return Object.freeze([...bindings]);
    }
    function finish(failed, primary, batch) {
      const cleanup = [];
      if (transactionOpen) {
        try {
          db.exec('ROLLBACK'); transactionOpen = false;
          if (batch) { batch.rolledBack = true; data.rolledBackBatches++; }
        }
        catch (error) { cleanup.push(error); }
      }
      try { db.exec('PRAGMA query_only=OFF'); } catch (error) { cleanup.push(error); }
      if (cleanup.length) {
        data.retired = true;
        throw new AggregateError(failed ? [primary, ...cleanup] : cleanup, 'Private storage SQL cleanup failed; fixture retired');
      }
      if (failed) throw primary; // An explicit flag preserves even `throw undefined`.
    }
    function read(rows, log, alreadyOwned = false) {
      live(); rows.forEach(row => readable(row.sql)); if(!alreadyOwned)acquire();
      try {
        let failed = false, primary, result;
        try {
          db.exec('PRAGMA query_only=ON');
          db.exec('BEGIN'); transactionOpen = true;
          result = rows.map(({ sql, bindings, kind, column }) => {
            live();
            if (log) data.reads.push({ sql, bindings: [...bindings], kind });
            const prepared = db.prepare(sql);
            if (kind === 'first') {
              const value = prepared.get(...bindings);
              return value === undefined ? null : column === undefined ? value : value[column];
            }
            return { success: true, results: prepared.all(...bindings) };
          });
          db.exec('COMMIT'); transactionOpen = false;
        } catch (error) {
          if (/readonly|read.only|SQLITE_READONLY/iu.test(String(error?.message))) data.forbiddenWrites++;
          failed = true; primary = error;
        }
        finish(failed, primary);
        return result;
      } finally { connectionActive = false; }
    }
    function fixtureMutation(sql, bindings) {
      assert.equal(typeof sql, 'string');
      const match = /^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_][a-z0-9_]*)\b/u.exec(sql);
      assert.ok(match && tables.has(match[1]) && !REGISTRY_TABLES.includes(match[1]) && !sql.includes(';'),
        'Fixture mutation needs one declared non-registry table DML statement');
      return { sql, bindings: copyBindings(bindings) };
    }
    function executeFixture(row, label) {
      live();
      const observation = { label, sql: row.sql, bindings: [...row.bindings] };
      data.fixtureMutations.push(observation);
      try {
        const result = db.prepare(row.sql).run(...row.bindings);
        observation.changes = result.changes;
        return result;
      } catch (error) { observation.failure = error; throw error; }
    }
    function arrangeNow(row, label) {
      acquire();
      try {
        let failed = false, primary, result;
        try { db.exec('PRAGMA query_only=OFF'); result = executeFixture(row, label); }
        catch (error) { failed = true; primary = error; }
        finish(failed, primary);
        return result;
      } finally { connectionActive = false; }
    }
    function statementFor(sql, bindings = []) {
      live(); assert.equal(typeof sql, 'string'); data.prepares++;
      const values = copyBindings(bindings);
      const statement = Object.freeze({
        bind(...next) { live(); return statementFor(sql, next); },
        async first(column) {
          data.first++;
          if (column !== undefined && typeof column !== 'string')
            throw new TypeError('Private storage first column must be a string or undefined');
          return read([{ sql, bindings: values, kind: 'first', column }], true)[0];
        },
        async all() {
          data.all++;
          return read([{ sql, bindings: values, kind: 'all' }], true)[0];
        },
        async run() { live(); refuse('Private storage attempted a production write outside batch'); },
      });
      statements.set(statement, { sql, bindings: values });
      return statement;
    }
    const DB = Object.freeze({
      prepare(sql) { assert.equal(arguments.length, 1); return statementFor(sql); },
      async exec() { live(); refuse('Private storage attempted production schema/write execution'); },
      async batch(input) {
        // The production boundary now observes its two schemas and auxiliary
        // flags together. Keep that read-only snapshot separate from write
        // accounting and lost-write-ACK injection; do not widen admitted DML.
        if(Array.isArray(input)){
          acquire();
          try{
            if(Object.getOwnPropertyDescriptor(input,'length')?.value===3){
            const rows=[];
            for(let index=0;index<3;index++){
              const item=Object.getOwnPropertyDescriptor(input,String(index));
              if(!item||!Object.hasOwn(item,'value'))refuse('Read batch needs own indexed statements');
              const row=statements.get(item.value);
              if(!row||row.bindings.length||row.sql.includes(';'))refuse('Read batch needs owned unbound schema statements');
              const sql=normalized(row.sql);
              if(index<2?!sql.startsWith('SELECT (SELECT json_group_array(')||!sql.endsWith(' AS schema_json')
                :!sql.startsWith("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins') AS origins"))refuse('Unexpected schema snapshot statement');
              rows.push({sql:row.sql,bindings:[],kind:'all'});
            }
            live();data.readBatches++;
            return read(rows,true,true);
            }
          }finally{connectionActive=false;}
        }
        live(); data.batchAttempts++;
        const batch = { attempt: data.batchAttempts, statements: [], committed: false, rolledBack: false };
        data.batches.push(batch);
        let owned = false;
        try {
          if (!Array.isArray(input)) refuse('Personal storage batch needs an actual statement array');
          acquire(); owned = true; // Fence reentrant descriptor traps before inspecting caller-owned input.
          const length = Object.getOwnPropertyDescriptor(input, 'length');
          if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 1 || length.value > 2)
            refuse('Personal storage batch needs one or two actual statements');
          const rows = [];
          for (let index = 0; index < length.value; index++) {
            const item = Object.getOwnPropertyDescriptor(input, String(index));
            if (!item || !Object.hasOwn(item, 'value')) refuse('Batch statement must be an own indexed data property');
            const row = statements.get(item.value);
            if (!row) refuse('Batch only accepts statements from this actual fixture port');
            selectedWrite(row.sql, index);
            const bindings = [];
            for (let offset = 0; offset < row.bindings.length; offset++) bindings.push(row.bindings[offset]);
            rows.push(Object.freeze({ sql: row.sql, bindings: Object.freeze(bindings) }));
          }
          live(); // A descriptor trap may retire the fixture; do not begin SQL afterward.
          let failed = false, primary, results;
          try {
            try { db.exec('PRAGMA query_only=OFF'); }
            catch (error) { data.retired = true; throw error; }
            db.exec('BEGIN'); transactionOpen = true;
            results = rows.map(row => {
              live();
              const observed = { sql: row.sql, bindings: [...row.bindings] };
              batch.statements.push(observed);
              try {
                const actual = db.prepare(row.sql).run(...row.bindings);
                observed.changes = actual.changes;
                // These are the direct per-statement SQLite changes, not total
                // trigger changes or an invented successful D1 count.
                return { success: true, meta: { changes: actual.changes } };
              } catch (error) { observed.failure = error; throw error; }
            });
            db.exec('COMMIT'); transactionOpen = false;
            batch.committed = true; data.committedBatches++;
          } catch (error) {
            failed = true; primary = error;
          }
          // One cleanup pass owns all transaction/fence failures. The outer
          // catch records only; it must not replay rollback or touch SQL on ACK.
          finish(failed, primary, batch);
          if (nextLostAck) {
            nextLostAck = false;
            data.lostAckThrows++;
            const error = Error('Private storage fixture: acknowledgement lost after actual COMMIT');
            error.code = 'FIXTURE_PRIVATE_STORAGE_POST_COMMIT_ACK_LOST';
            batch.ackError = error;
            throw error; // Outside the transaction catch: committed rows stay committed.
          }
          return results;
        } catch (error) {
          batch.failure = error;
          throw error;
        } finally { if (owned) connectionActive = false; }
      },
    });
    const h = {
      DB, env: { DB },
      get state() {
        // Observations cannot be used to reset private ownership or lifetime.
        const copyRows = rows => rows.map(row => ({ ...row, ...(row.bindings ? { bindings: [...row.bindings] } : {}) }));
        return { ...data, reads: copyRows(data.reads), fixtureMutations: copyRows(data.fixtureMutations),
          batches: data.batches.map(batch => ({ ...batch, statements: copyRows(batch.statements) })),
          fixtureDdl: copyRows(data.fixtureDdl), cleanupFailure: data.cleanupFailure ? { ...data.cleanupFailure } : null };
      },
      mutate(sql, ...bindings) { live(); return arrangeNow(fixtureMutation(sql, bindings), 'fixture-mutation'); },
      insert(table, values) {
        live(); assert.ok(tables.has(table), `Unknown fixture table: ${table}`);
        const keys = Object.keys(values); assert.ok(keys.length); keys.forEach(ident);
        return h.mutate(`INSERT INTO ${ident(table)}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...Object.values(values));
      },
      rows(sql, ...bindings) { return read([{ sql, bindings: copyBindings(bindings), kind: 'all' }], false)[0].results; },
      snapshot() {
        const requests = [
          { sql: "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') ORDER BY type,name", bindings: [], kind: 'all' },
          ...tableNames.map(table => ({ sql: `SELECT * FROM ${ident(table)} ORDER BY rowid`, bindings: [], kind: 'all' })),
        ];
        const [schema, ...rows] = read(requests, false);
        return { schema: schema.results, rows: Object.fromEntries(tableNames.map((table, index) => [table, rows[index].results])) };
      },
      armCleanupFailure(contentId) {
        live(); idle(); assert.equal(data.cleanupFailure, null, 'Only one cleanup-failure target is admitted');
        assert.ok(typeof contentId === 'string' && contentId.length > 0 && contentId.length <= 256);
        acquire();
        try {
          let failed = false, primary;
          try {
            db.exec('PRAGMA query_only=OFF');
            const target = db.prepare("SELECT content_id FROM private_content WHERE content_id=? AND kind='prompt' AND redacted_at IS NULL AND expires_at<strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)").get(contentId);
            assert.ok(target, 'Fault target must be an actual expired unscoped ordinary prompt');
            const literal = "'" + contentId.replaceAll("'", "''") + "'";
            const sql = `CREATE TRIGGER fixture_private_storage_cleanup_failure BEFORE UPDATE ON private_content
WHEN OLD.content_id=${literal} AND OLD.kind='prompt' AND OLD.redacted_at IS NULL
 AND OLD.expires_at<strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NEW.content='' AND NEW.redacted_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'private_storage_fixture_cleanup_failure'); END;`;
            db.exec(sql);
            data.fixtureDdl.push({ label: 'ordinary-expiry-fault-trigger', sql });
            data.cleanupFailure = { contentId, trigger: 'fixture_private_storage_cleanup_failure' };
          } catch (error) { failed = true; primary = error; }
          finish(failed, primary);
        } finally { connectionActive = false; }
      },
      loseNextCommitAck() { live(); idle(); assert.equal(nextLostAck, false); nextLostAck = true; },
      seedPrincipal(policyVersion, { actorId, email = `${actorId}@example.test`, name = `Fixture ${actorId}` }) {
        live(); assert.ok(typeof actorId === 'string' && actorId.length); assert.equal(typeof policyVersion, 'string');
        assert.equal(typeof email, 'string'); assert.equal(typeof name, 'string');
        h.insert('users', { user_id: actorId, email, display_name: name, role: 'creator', consent_version: policyVersion,
          consented_at: PAST, created_at: PAST, updated_at: PAST });
        return { actorId, email, name, headers: {
          'oai-authenticated-user-id': actorId, 'oai-authenticated-user-email': email,
          'oai-authenticated-user-full-name': encodeURIComponent(name),
          'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
        } }; // Request input metadata only. Never a user/auth/context result.
      },
      retire() { data.retired = true; nextLostAck = false; },
      close() {
        idle(); data.retired = true; nextLostAck = false;
        if (data.closed) return;
        connectionActive = true;
        const errors = [];
        try {
          if (transactionOpen) try { db.exec('ROLLBACK'); transactionOpen = false; } catch (error) { errors.push(error); }
          try { db.exec('PRAGMA query_only=OFF'); } catch (error) { errors.push(error); }
          try { db.close(); data.closed = true; } catch (error) { errors.push(error); }
          if (errors.length) throw new AggregateError(errors, 'Private storage fixture close failed');
        } finally { connectionActive = false; }
      },
    };
    return h;
  } catch (primary) {
    // Own the allocation immediately; setup failure cannot leak the database.
    try { db.close(); data.closed = true; }
    catch (cleanup) { throw new AggregateError([primary, cleanup], 'Private storage fixture construction and close failed'); }
    throw primary;
  }
}
