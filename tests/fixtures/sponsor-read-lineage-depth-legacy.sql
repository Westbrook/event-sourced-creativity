SELECT CASE WHEN (EXISTS(SELECT 1 FROM document_jobs job
 JOIN output_operation_slots slot ON slot.job_id=job.job_id
 JOIN output_execution_grants execution ON execution.scope_key=slot.scope_key AND execution.grant_id=slot.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN experience_sponsor_consumptions used ON used.job_id=job.job_id AND used.actor_user_id=job.owner_id
 JOIN experience_sponsor_grants issued ON issued.grant_id=used.grant_id AND issued.campaign_id=used.campaign_id
 JOIN experience_sponsor_issuances issuance ON issuance.grant_id=issued.grant_id AND issuance.campaign_id=issued.campaign_id
 JOIN experience_sponsor_approvals approval ON approval.campaign_id=issued.campaign_id AND approval.policy_digest=issued.policy_digest
 WHERE job.job_id=? AND job.owner_id=? AND job.stream_id='creative:'||job.owner_id
 AND job.kind='generate' AND job.source_surface='outputs'
 AND plan.scope_kind='personal' AND plan.owner_user_id=job.owner_id AND plan.document_id=job.document_id
 AND execution.actor_user_id=job.owner_id AND execution.payer_user_id<>job.owner_id AND execution.context_id IS NULL
 AND execution.plan_revision_id=slot.plan_revision_id AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
 AND slot.source_digest=plan.source_digest
 AND slot.provider='openai' AND slot.maximum_calls=2 AND execution.maximum_calls=2
 AND (SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1
 AND issued.actor_user_id=used.actor_user_id AND issued.intent_key=used.intent_key AND issued.session_digest=used.session_digest
 AND issued.envelope_digest=used.envelope_digest AND issuance.actor_user_id=used.actor_user_id AND issuance.intent_key=used.intent_key
 AND issuance.envelope_digest=used.envelope_digest AND issuance.policy_digest=issued.policy_digest
 AND approval.payer_user_id=execution.payer_user_id AND approval.approved_by_user_id=approval.payer_user_id
 AND slot.maximum_microusd=used.maximum_microusd AND execution.maximum_microusd=slot.maximum_microusd
 AND (typeof(job.document_id)='text' AND length(CAST(job.document_id AS BLOB))<=4096) AND (typeof(job.stream_id)='text' AND length(CAST(job.stream_id AS BLOB))<=4096) AND (typeof(job.correlation_id)='text' AND length(CAST(job.correlation_id AS BLOB))<=4096) AND (typeof(plan.project_id)='text' AND length(CAST(plan.project_id AS BLOB))<=4096) AND (typeof(plan.source_digest)='text' AND length(CAST(plan.source_digest AS BLOB))<=4096) AND (typeof(slot.scope_key)='text' AND length(CAST(slot.scope_key AS BLOB))<=4096) AND (typeof(slot.slot_id)='text' AND length(CAST(slot.slot_id AS BLOB))<=4096) AND (typeof(slot.route_digest)='text' AND length(CAST(slot.route_digest AS BLOB))<=4096) AND (typeof(slot.model)='text' AND length(CAST(slot.model AS BLOB))<=4096) AND (typeof(execution.grant_id)='text' AND length(CAST(execution.grant_id AS BLOB))<=4096) AND (typeof(execution.payer_user_id)='text' AND length(CAST(execution.payer_user_id AS BLOB))<=4096) AND (typeof(used.consumption_id)='text' AND length(CAST(used.consumption_id AS BLOB))<=4096) AND (typeof(used.campaign_id)='text' AND length(CAST(used.campaign_id AS BLOB))<=4096) AND (typeof(used.envelope_digest)='text' AND length(CAST(used.envelope_digest AS BLOB))<=4096) AND (typeof(used.session_digest)='text' AND length(CAST(used.session_digest AS BLOB))<=4096) AND (typeof(used.intent_key)='text' AND length(CAST(used.intent_key AS BLOB))<=4096) AND (typeof(issued.grant_id)='text' AND length(CAST(issued.grant_id AS BLOB))<=4096) AND (typeof(issued.policy_digest)='text' AND length(CAST(issued.policy_digest AS BLOB))<=4096)
 AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=plan.project_id)
 AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE (resource_kind='document' AND resource_id=job.document_id)
   OR (resource_kind='job' AND resource_id=job.job_id)) AND job.document_id=? AND job.stream_id=? AND job.correlation_id=? AND plan.project_id=?
      AND slot.scope_key=? AND slot.slot_id=? AND execution.grant_id=? AND issued.grant_id=? AND used.consumption_id=? AND used.campaign_id=?
      AND issued.policy_digest=? AND issuance.envelope_json=? AND approval.policy_json=?
      AND slot.route_digest=? AND slot.model=? AND slot.maximum_tokens=? AND slot.maximum_microusd=? AND execution.payer_user_id=?
      AND plan.source_digest=? AND plan.source_head=?)) THEN 1 ELSE 0 END AS current