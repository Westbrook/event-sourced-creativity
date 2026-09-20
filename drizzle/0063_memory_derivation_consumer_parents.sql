DROP TRIGGER memory_derivation_consumer_update;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_update BEFORE UPDATE ON memory_derivation_consumers
WHEN NEW.origin_id IS NOT OLD.origin_id OR NEW.actor_user_id IS NOT OLD.actor_user_id
 OR NEW.target_enrollment_id IS NOT OLD.target_enrollment_id OR NEW.context_revision IS NOT OLD.context_revision
 OR NEW.job_id IS NOT OLD.job_id OR NEW.output_sha256 IS NOT OLD.output_sha256 OR NEW.scope_key IS NOT OLD.scope_key
 OR NEW.turn_id IS NOT OLD.turn_id OR NEW.execution_id IS NOT OLD.execution_id OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR NOT((OLD.state='active' AND NEW.state='retired' AND NEW.retired_at IS NOT NULL) OR (OLD.state='retired' AND NEW.state='retired' AND NEW.retired_at IS OLD.retired_at))
BEGIN SELECT RAISE(ABORT,'memory_consumer_immutable'); END;
--> statement-breakpoint
CREATE TABLE `memory_derivation_consumer_parents` (
	`origin_id` text NOT NULL,
	`parent_origin_id` text NOT NULL,
	`parent_content_id` text NOT NULL,
	PRIMARY KEY(`origin_id`, `parent_origin_id`),
	FOREIGN KEY (`origin_id`) REFERENCES `memory_derivation_consumers`(`origin_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_origin_id`) REFERENCES `memory_derivation_consumers`(`origin_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memory_consumer_parent_distinct" CHECK(origin_id<>parent_origin_id)
);
--> statement-breakpoint
CREATE INDEX `idx_memory_derivation_consumer_parent` ON `memory_derivation_consumer_parents` (`parent_origin_id`);
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_parents_insert BEFORE INSERT ON memory_derivation_consumer_parents
WHEN EXISTS(SELECT 1 FROM memory_derivation_consumer_parents WHERE (origin_id,parent_origin_id)=(NEW.origin_id,NEW.parent_origin_id))
 OR (SELECT COUNT(*) FROM memory_derivation_consumer_parents WHERE origin_id=NEW.origin_id)>=2
 OR NOT EXISTS(SELECT 1 FROM memory_derivation_consumers child JOIN consequential_executions execution ON execution.execution_id=child.execution_id
  JOIN private_content approved ON approved.content_id=execution.consent_ref
  JOIN memory_derivation_consumers parent ON parent.origin_id=NEW.parent_origin_id
  JOIN consequential_executions prior ON prior.execution_id=parent.execution_id
  JOIN memory_derivation_consumer_contents registered ON registered.origin_id=parent.origin_id AND registered.role='result'
  JOIN private_content content ON content.content_id=registered.content_id,
  json_each(approved.content,'$.binding.request.memory.parents') expected
  WHERE child.origin_id=NEW.origin_id AND child.state='active' AND execution.status='quoted' AND parent.state='active'
   AND parent.actor_user_id=child.actor_user_id AND parent.scope_key=child.scope_key AND parent.turn_id<>child.turn_id
   AND parent.target_enrollment_id=child.target_enrollment_id AND parent.context_revision=child.context_revision
   AND parent.job_id=child.job_id AND parent.output_sha256=child.output_sha256
   AND parent.expires_at>=child.expires_at AND parent.created_at<=child.created_at
   AND prior.status='completed' AND prior.result_ref=NEW.parent_content_id AND registered.content_id=NEW.parent_content_id
   AND content.owner_id=parent.actor_user_id AND content.kind='context-proposal' AND content.redacted_at IS NULL
   AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND json_extract(expected.value,'$.originId')=parent.origin_id AND json_extract(expected.value,'$.turnId')=parent.turn_id
   AND json_extract(expected.value,'$.executionId')=parent.execution_id AND json_extract(expected.value,'$.contentId')=content.content_id
   AND json_extract(expected.value,'$.reply')=json_extract(content.content,'$.reply')
   AND json_extract(expected.value,'$.bindingHash')=prior.binding_hash
   AND json_extract(content.content,'$.sourceStatus')='semantic-memory-assisted')
 OR EXISTS(WITH RECURSIVE ancestors(id) AS(SELECT NEW.parent_origin_id UNION SELECT edge.parent_origin_id FROM memory_derivation_consumer_parents edge JOIN ancestors ON edge.origin_id=ancestors.id LIMIT 18)
  SELECT COUNT(*) FROM ancestors HAVING COUNT(*)>16 OR MAX(id=NEW.origin_id)=1)
BEGIN SELECT RAISE(ABORT,'memory_consumer_parent_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_parents_update BEFORE UPDATE ON memory_derivation_consumer_parents
BEGIN SELECT RAISE(ABORT,'memory_consumer_parent_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_parents_delete BEFORE DELETE ON memory_derivation_consumer_parents
BEGIN SELECT RAISE(ABORT,'memory_consumer_parent_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_parents_seed AFTER INSERT ON memory_derivation_consumers
BEGIN
 INSERT INTO memory_derivation_consumer_parents(origin_id,parent_origin_id,parent_content_id)
 SELECT NEW.origin_id,json_extract(expected.value,'$.originId'),json_extract(expected.value,'$.contentId')
 FROM consequential_executions execution JOIN private_content approved ON approved.content_id=execution.consent_ref,
 json_each(approved.content,'$.binding.request.memory.parents') expected WHERE execution.execution_id=NEW.execution_id;
 SELECT CASE WHEN (SELECT COUNT(*) FROM memory_derivation_consumer_parents WHERE origin_id=NEW.origin_id)<=2
  AND (WITH RECURSIVE ancestors(id) AS(SELECT NEW.origin_id UNION SELECT edge.parent_origin_id FROM memory_derivation_consumer_parents edge JOIN ancestors ON edge.origin_id=ancestors.id LIMIT 18) SELECT COUNT(*) FROM ancestors)<=17
 THEN 1 ELSE RAISE(ABORT,'memory_consumer_parent_inventory') END;
END;
--> statement-breakpoint
CREATE TRIGGER memory_derivation_consumer_parents_retired AFTER UPDATE OF state ON memory_derivation_consumers WHEN NEW.state='retired'
BEGIN UPDATE memory_derivation_consumers SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state='active' AND origin_id IN(WITH RECURSIVE descendants(id) AS(
  SELECT origin_id FROM memory_derivation_consumer_parents WHERE parent_origin_id=NEW.origin_id
  UNION SELECT edge.origin_id FROM memory_derivation_consumer_parents edge JOIN descendants ON edge.parent_origin_id=descendants.id)
 SELECT id FROM descendants); END;
