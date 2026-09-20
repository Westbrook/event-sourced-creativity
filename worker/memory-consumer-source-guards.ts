export const originalsCurrent=`EXISTS(SELECT 1 FROM consequential_executions execution
 JOIN private_content consent ON consent.content_id=execution.consent_ref AND consent.owner_id=consumer.actor_user_id
 WHERE execution.execution_id=consumer.execution_id AND execution.actor_user_id=consumer.actor_user_id
  AND consent.kind='execution-consent' AND consent.redacted_at IS NULL AND consent.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND json_type(consent.content,'$.binding.request.conversation')='array'
  AND json_array_length(consent.content,'$.binding.request.conversation') BETWEEN 1 AND 16
  AND json_array_length(consent.content,'$.binding.request.conversation')=(SELECT COUNT(*) FROM memory_derivation_consumer_sources WHERE origin_id=consumer.origin_id)
  AND EXISTS(SELECT 1 FROM memory_derivation_consumer_sources WHERE origin_id=consumer.origin_id AND turn_id=consumer.turn_id)
  AND NOT EXISTS(SELECT 1 FROM json_each(consent.content,'$.binding.request.conversation') expected
   LEFT JOIN memory_derivation_consumer_sources source ON source.origin_id=consumer.origin_id AND source.turn_id=json_extract(expected.value,'$.turnId')
    AND source.user_ref=json_extract(expected.value,'$.userRef') AND source.answer_ref=json_extract(expected.value,'$.answerRef')
   LEFT JOIN assistant_turns turn ON turn.actor_user_id=consumer.actor_user_id AND turn.scope_key=consumer.scope_key
    AND turn.turn_id=source.turn_id AND turn.user_content_ref=source.user_ref AND turn.assistant_content_ref=source.answer_ref
   LEFT JOIN private_content authored ON authored.content_id=source.user_ref AND authored.owner_id=consumer.actor_user_id
    AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND authored.content=json_extract(expected.value,'$.user')
   LEFT JOIN private_content answer ON answer.content_id=source.answer_ref AND answer.owner_id=consumer.actor_user_id
    AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND answer.content=json_extract(expected.value,'$.assistant')
   WHERE source.origin_id IS NULL OR turn.turn_id IS NULL OR authored.content_id IS NULL OR answer.content_id IS NULL))
 AND NOT EXISTS(SELECT 1 FROM memory_derivation_consumer_contents registered LEFT JOIN private_content copy ON copy.content_id=registered.content_id
  WHERE registered.origin_id=consumer.origin_id AND (copy.content_id IS NULL OR copy.owner_id<>consumer.actor_user_id OR copy.redacted_at IS NOT NULL
    OR copy.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))) `;

/** Bounded transitive negative provenance, checked in SQLite without hydrating
 * ancestor prose. Missing inventory is denial, never an original-history fallback. */
export const consumerClosureCurrent=`EXISTS(WITH RECURSIVE nodes(id) AS(
 SELECT consumer.origin_id UNION SELECT edge.parent_origin_id FROM memory_derivation_consumer_parents edge JOIN nodes ON edge.origin_id=nodes.id LIMIT 18)
 SELECT 1 WHERE (SELECT COUNT(*) FROM nodes)<=17 AND NOT EXISTS(
 SELECT 1 FROM nodes LEFT JOIN memory_derivation_consumers ancestor ON ancestor.origin_id=nodes.id
 LEFT JOIN consequential_executions execution ON execution.execution_id=ancestor.execution_id
 LEFT JOIN private_content approved ON approved.content_id=execution.consent_ref
 WHERE ancestor.origin_id IS NULL OR ancestor.state<>'active' OR ancestor.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  OR ancestor.actor_user_id<>consumer.actor_user_id OR ancestor.scope_key<>consumer.scope_key
  OR ancestor.target_enrollment_id<>consumer.target_enrollment_id OR ancestor.context_revision<>consumer.context_revision
  OR ancestor.job_id<>consumer.job_id OR ancestor.output_sha256<>consumer.output_sha256
  OR (${originalsCurrent.replaceAll('consumer.','ancestor.')}) IS NOT TRUE
  OR COALESCE(json_array_length(approved.content,'$.binding.request.memory.parents'),0)<>(SELECT COUNT(*) FROM memory_derivation_consumer_parents WHERE origin_id=ancestor.origin_id)
  OR COALESCE(json_array_length(approved.content,'$.binding.request.memory.parents'),0)>2
  OR EXISTS(SELECT 1 FROM json_each(approved.content,'$.binding.request.memory.parents') expected
   LEFT JOIN memory_derivation_consumer_parents edge ON edge.origin_id=ancestor.origin_id AND edge.parent_origin_id=json_extract(expected.value,'$.originId')
   LEFT JOIN memory_derivation_consumers parent ON parent.origin_id=edge.parent_origin_id AND parent.turn_id=json_extract(expected.value,'$.turnId')
   LEFT JOIN consequential_executions prior ON prior.execution_id=parent.execution_id AND prior.execution_id=json_extract(expected.value,'$.executionId')
   LEFT JOIN memory_derivation_consumer_contents registered ON registered.origin_id=parent.origin_id AND registered.role='result' AND registered.content_id=edge.parent_content_id
   LEFT JOIN private_content content ON content.content_id=registered.content_id AND content.content_id=json_extract(expected.value,'$.contentId')
    AND content.owner_id=parent.actor_user_id AND content.kind='context-proposal' AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE edge.origin_id IS NULL OR parent.origin_id IS NULL OR prior.status IS NOT 'completed' OR prior.result_ref IS NOT content.content_id
    OR prior.binding_hash IS NOT json_extract(expected.value,'$.bindingHash') OR content.content_id IS NULL
    OR json_extract(content.content,'$.reply') IS NOT json_extract(expected.value,'$.reply')
    OR json_extract(content.content,'$.sourceStatus') IS NOT 'semantic-memory-assisted')))`;
