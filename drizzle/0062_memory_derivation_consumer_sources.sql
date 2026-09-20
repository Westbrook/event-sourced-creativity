CREATE TABLE memory_derivation_consumer_sources (
 origin_id text NOT NULL REFERENCES memory_derivation_consumers(origin_id),
 turn_id text NOT NULL,user_ref text NOT NULL,answer_ref text NOT NULL,
 PRIMARY KEY(origin_id,turn_id)
);
--> statement-breakpoint
CREATE INDEX idx_memory_derivation_consumer_original_user ON memory_derivation_consumer_sources(user_ref);
--> statement-breakpoint
CREATE INDEX idx_memory_derivation_consumer_original_answer ON memory_derivation_consumer_sources(answer_ref);
--> statement-breakpoint
CREATE INDEX idx_memory_derivation_consumer_original_turn ON memory_derivation_consumer_sources(turn_id,origin_id);
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_sources_insert BEFORE INSERT ON memory_derivation_consumer_sources
WHEN EXISTS(SELECT 1 FROM memory_derivation_consumer_sources WHERE (origin_id,turn_id)=(NEW.origin_id,NEW.turn_id))
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_consumers c JOIN consequential_executions e ON e.execution_id=c.execution_id
  JOIN private_content p ON p.content_id=e.consent_ref AND p.owner_id=c.actor_user_id
  JOIN assistant_turns t ON t.actor_user_id=c.actor_user_id AND t.scope_key=c.scope_key AND t.turn_id=NEW.turn_id
  JOIN json_each(p.content,'$.binding.request.conversation') original
  WHERE c.origin_id=NEW.origin_id AND c.state='active' AND e.actor_user_id=c.actor_user_id
   AND p.kind='execution-consent' AND p.redacted_at IS NULL AND p.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND t.user_content_ref=NEW.user_ref AND t.assistant_content_ref=NEW.answer_ref
   AND json_extract(original.value,'$.turnId')=NEW.turn_id AND json_extract(original.value,'$.userRef')=NEW.user_ref
   AND json_extract(original.value,'$.answerRef')=NEW.answer_ref)
BEGIN SELECT RAISE(ABORT,'memory_consumer_original_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_sources_update BEFORE UPDATE ON memory_derivation_consumer_sources
BEGIN SELECT RAISE(ABORT,'memory_consumer_original_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_sources_delete BEFORE DELETE ON memory_derivation_consumer_sources
BEGIN SELECT RAISE(ABORT,'memory_consumer_original_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_sources_seed AFTER INSERT ON memory_derivation_consumers
BEGIN
 INSERT INTO memory_derivation_consumer_sources(origin_id,turn_id,user_ref,answer_ref)
 SELECT NEW.origin_id,json_extract(original.value,'$.turnId'),json_extract(original.value,'$.userRef'),json_extract(original.value,'$.answerRef')
 FROM consequential_executions e JOIN private_content p ON p.content_id=e.consent_ref AND p.owner_id=NEW.actor_user_id,
 json_each(p.content,'$.binding.request.conversation') original WHERE e.execution_id=NEW.execution_id;
 SELECT CASE WHEN (SELECT COUNT(*) FROM memory_derivation_consumer_sources WHERE origin_id=NEW.origin_id) BETWEEN 1 AND 16
  AND EXISTS(SELECT 1 FROM memory_derivation_consumer_sources WHERE origin_id=NEW.origin_id AND turn_id=NEW.turn_id)
 THEN 1 ELSE RAISE(ABORT,'memory_consumer_original_inventory') END;
END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_sources_turn_update AFTER UPDATE ON assistant_turns WHEN NEW.actor_user_id IS NOT OLD.actor_user_id OR NEW.scope_key IS NOT OLD.scope_key OR NEW.turn_id IS NOT OLD.turn_id OR NEW.user_content_ref IS NOT OLD.user_content_ref OR NEW.assistant_content_ref IS NOT OLD.assistant_content_ref OR NEW.request_json IS NOT OLD.request_json OR NEW.organization_id IS NOT OLD.organization_id OR NEW.project_access_id IS NOT OLD.project_access_id OR NEW.project_id IS NOT OLD.project_id OR NEW.document_id IS NOT OLD.document_id
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state='active' AND actor_user_id=OLD.actor_user_id AND scope_key=OLD.scope_key
 AND origin_id IN(SELECT origin_id FROM memory_derivation_consumer_sources WHERE turn_id=OLD.turn_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_sources_turn_delete AFTER DELETE ON assistant_turns
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state='active' AND actor_user_id=OLD.actor_user_id AND scope_key=OLD.scope_key
 AND origin_id IN(SELECT origin_id FROM memory_derivation_consumer_sources WHERE turn_id=OLD.turn_id); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_sources_private_update AFTER UPDATE ON private_content WHEN NEW.content_id IS NOT OLD.content_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.kind IS NOT OLD.kind OR NEW.content IS NOT OLD.content OR NEW.redacted_at IS NOT OLD.redacted_at OR NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state='active' AND (origin_id IN(SELECT origin_id FROM memory_derivation_consumer_sources WHERE user_ref=OLD.content_id OR answer_ref=OLD.content_id)
 OR origin_id IN(SELECT origin_id FROM memory_derivation_consumer_contents WHERE content_id=OLD.content_id)); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_sources_private_delete AFTER DELETE ON private_content
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE state='active' AND (origin_id IN(SELECT origin_id FROM memory_derivation_consumer_sources WHERE user_ref=OLD.content_id OR answer_ref=OLD.content_id)
 OR origin_id IN(SELECT origin_id FROM memory_derivation_consumer_contents WHERE content_id=OLD.content_id)); END;
