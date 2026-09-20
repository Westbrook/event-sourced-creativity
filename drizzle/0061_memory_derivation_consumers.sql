CREATE TABLE `memory_derivation_consumer_contents` (
	`content_id` text PRIMARY KEY NOT NULL,
	`origin_id` text NOT NULL,
	`role` text NOT NULL,
	FOREIGN KEY (`origin_id`) REFERENCES `memory_derivation_consumers`(`origin_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_consumer_content_role" CHECK(role IN('consent','response','result','answer'))
);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_consumer_content_origin` ON `memory_derivation_consumer_contents` (`origin_id`);--> statement-breakpoint
CREATE TABLE `memory_derivation_consumers` (
	`origin_id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_enrollment_id` text NOT NULL,
	`context_revision` text NOT NULL,
	`job_id` text NOT NULL,
	`output_sha256` text NOT NULL,
	`scope_key` text NOT NULL,
	`turn_id` text NOT NULL,
	`execution_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`retired_at` text,
	CONSTRAINT "memory_consumer_state" CHECK((state='active' AND retired_at IS NULL) OR (state='retired' AND retired_at IS NOT NULL)),
	CONSTRAINT "memory_consumer_identity" CHECK(length(origin_id)=36 AND length(context_revision)=36 AND length(output_sha256)=64 AND output_sha256 NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "memory_consumer_time" CHECK(length(created_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS created_at AND length(expires_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS expires_at AND expires_at>created_at AND (retired_at IS NULL OR length(retired_at)=24 AND strftime('%Y-%m-%dT%H:%M:%fZ',retired_at) IS retired_at AND retired_at>=created_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_memory_derivation_consumer_execution` ON `memory_derivation_consumers` (`execution_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_consumer_source` ON `memory_derivation_consumers` (`job_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_consumer_context` ON `memory_derivation_consumers` (`target_enrollment_id`,`context_revision`,`state`);--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_consumer_turn` ON `memory_derivation_consumers` (`actor_user_id`,`scope_key`,`turn_id`);
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_insert BEFORE INSERT ON memory_derivation_consumers
WHEN NEW.state!='active' OR EXISTS(SELECT 1 FROM memory_derivation_consumers WHERE origin_id=NEW.origin_id OR execution_id=NEW.execution_id)
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_contexts c JOIN memory_derivation_results r ON r.job_id=c.job_id
   JOIN consequential_executions e ON e.execution_id=NEW.execution_id JOIN private_content p ON p.content_id=e.consent_ref
   WHERE c.target_enrollment_id=NEW.target_enrollment_id AND c.actor_user_id=NEW.actor_user_id AND c.revision=NEW.context_revision
    AND c.state='accepted' AND c.job_id=NEW.job_id AND c.output_sha256=NEW.output_sha256 AND r.state='active' AND r.output_sha256=NEW.output_sha256
    AND NEW.expires_at<=MIN(c.expires_at,r.expires_at) AND NEW.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND e.actor_user_id=NEW.actor_user_id AND e.operation='assistant-specialist' AND e.status='quoted'
    AND p.owner_id=NEW.actor_user_id AND p.kind='execution-consent' AND p.redacted_at IS NULL AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND json_extract(p.content,'$.binding.request.memory.originId')=NEW.origin_id
    AND json_extract(p.content,'$.binding.request.scopeKey')=NEW.scope_key AND json_extract(p.content,'$.binding.request.turnId')=NEW.turn_id)
BEGIN SELECT RAISE(ABORT,'memory_consumer_source_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_update BEFORE UPDATE ON memory_derivation_consumers
WHEN NEW.origin_id IS NOT OLD.origin_id OR NEW.actor_user_id IS NOT OLD.actor_user_id
 OR NEW.target_enrollment_id IS NOT OLD.target_enrollment_id OR NEW.context_revision IS NOT OLD.context_revision
 OR NEW.job_id IS NOT OLD.job_id OR NEW.output_sha256 IS NOT OLD.output_sha256 OR NEW.scope_key IS NOT OLD.scope_key
 OR NEW.turn_id IS NOT OLD.turn_id OR NEW.execution_id IS NOT OLD.execution_id OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR NOT(OLD.state='active' AND NEW.state='retired' AND NEW.retired_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'memory_consumer_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_delete BEFORE DELETE ON memory_derivation_consumers
BEGIN SELECT RAISE(ABORT,'memory_consumer_tombstone_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_retired AFTER UPDATE OF state ON memory_derivation_consumers WHEN NEW.state='retired'
BEGIN UPDATE private_content SET content='',redacted_at=COALESCE(redacted_at,NEW.retired_at)
 WHERE content_id IN(SELECT content_id FROM memory_derivation_consumer_contents WHERE origin_id=NEW.origin_id) AND redacted_at IS NULL; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_content_insert BEFORE INSERT ON memory_derivation_consumer_contents
WHEN EXISTS(SELECT 1 FROM memory_derivation_consumer_contents WHERE content_id=NEW.content_id OR (origin_id,role)=(NEW.origin_id,NEW.role))
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_consumers c JOIN private_content p ON p.content_id=NEW.content_id
  WHERE c.origin_id=NEW.origin_id AND c.state='active' AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND p.owner_id=c.actor_user_id AND p.redacted_at IS NULL AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND p.kind=CASE NEW.role WHEN 'consent' THEN 'execution-consent' WHEN 'response' THEN 'provider-response' WHEN 'result' THEN 'context-proposal' WHEN 'answer' THEN 'chat-assistant' END)
BEGIN SELECT RAISE(ABORT,'memory_consumer_content_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_content_expiry AFTER INSERT ON memory_derivation_consumer_contents
BEGIN UPDATE private_content SET expires_at=MIN(expires_at,(SELECT expires_at FROM memory_derivation_consumers WHERE origin_id=NEW.origin_id)) WHERE content_id=NEW.content_id;
 UPDATE private_content_retention_scopes SET assigned_expires_at=MIN(assigned_expires_at,(SELECT expires_at FROM memory_derivation_consumers WHERE origin_id=NEW.origin_id)) WHERE content_id=NEW.content_id; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_content_update BEFORE UPDATE ON memory_derivation_consumer_contents
BEGIN SELECT RAISE(ABORT,'memory_consumer_content_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_content_delete BEFORE DELETE ON memory_derivation_consumer_contents
BEGIN SELECT RAISE(ABORT,'memory_consumer_content_tombstone_required'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_context_update AFTER UPDATE ON memory_derivation_contexts
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND target_enrollment_id=OLD.target_enrollment_id; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_context_delete AFTER DELETE ON memory_derivation_contexts
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND target_enrollment_id=OLD.target_enrollment_id; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_result_update AFTER UPDATE ON memory_derivation_results WHEN NEW.state='withdrawn'
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND job_id=OLD.job_id; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_result_delete BEFORE DELETE ON memory_derivation_results
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND job_id=OLD.job_id; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_parent_update AFTER UPDATE ON memory_live_enrollments
WHEN OLD.revision IS NOT NEW.revision OR NEW.recall_enabled<>1 OR NEW.learn_enabled<>1 OR NEW.expires_at IS NOT OLD.expires_at
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND target_enrollment_id=OLD.enrollment_id; END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_parent_delete BEFORE DELETE ON memory_live_enrollments
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND target_enrollment_id=OLD.enrollment_id; END;
