/** Shared retention/identity fence only, never authority to retrieve or spend.
 * Fixed aliases are internal SQL, not caller data. Full source/lineage witnesses
 * are additionally required by the recovery service at every effect. */
// Keep the inner predicates balanced too: this fence is embedded in cleanup's
// larger CTE, whose D1 expression-depth budget includes nested subqueries.
const all = (parts: readonly string[]): string => {
  if (parts.length === 1) return '(' + parts[0] + ')';
  const middle = Math.floor(parts.length / 2);
  return '(' + all(parts.slice(0, middle)) + ' AND ' + all(parts.slice(middle)) + ')';
};
export const model3dRecoveryAttemptSql = `(${all([
  'slot.attempt_ordinal=0', 'slot.previous_slot_id IS NULL',
  "json_extract(job.request_json,'$.model3dCostPreview.version')='model3d-mini-app-cost-v1'",
])} OR ${all([
  'slot.attempt_ordinal=1', 'slot.previous_slot_id IS NOT NULL',
  "json_extract(job.request_json,'$.model3dCostPreview.version')='model3d-mini-app-replacement-cost-v1'",
  "json_extract(job.request_json,'$.model3dCostPreview.requestId')=job.job_id",
  "json_extract(job.request_json,'$.model3dCostPreview.previousSlotId')=slot.previous_slot_id",
  `EXISTS(SELECT 1 FROM output_operation_slots parent
      JOIN output_provider_calls prior ON prior.scope_key=parent.scope_key AND prior.slot_id=parent.slot_id
      WHERE ${all([
        'parent.scope_key=slot.scope_key', 'parent.slot_id=slot.previous_slot_id',
        'parent.attempt_ordinal=0', 'parent.previous_slot_id IS NULL',
        "parent.job_id=json_extract(job.request_json,'$.model3dCostPreview.previousJobId')", 'parent.job_id<>job.job_id',
        'parent.grant_id<>slot.grant_id', 'parent.token_reservation_id<>slot.token_reservation_id', 'parent.cost_reservation_id<>slot.cost_reservation_id',
        'parent.target_id=slot.target_id', 'parent.target_contract_digest=slot.target_contract_digest', 'parent.source_digest=slot.source_digest',
        "prior.provider='fal'", 'prior.model=slot.model', "prior.call_key='model3d:initial'", "prior.stage_key='model3d:initial'",
        'prior.reserved_microusd=400000', "prior.provider_response_id=json_extract(job.request_json,'$.model3dCostPreview.previousProviderRequestId')",
        '(SELECT COUNT(*) FROM output_provider_calls counted WHERE counted.scope_key=parent.scope_key AND counted.slot_id=parent.slot_id)=1',
      ])})`,
  `EXISTS(SELECT 1 FROM output_plan_revisions child_plan JOIN event_private_payloads proof ON proof.private_event_id=child_plan.confirmed_event_id
      WHERE ${all([
        'child_plan.scope_key=slot.scope_key', 'child_plan.plan_revision_id=slot.plan_revision_id',
        'child_plan.owner_user_id=job.owner_id', 'proof.owner_id=job.owner_id', 'proof.redacted_at IS NULL',
        "json_extract(proof.private_json,'$.output_command_envelope.experienceBinding.replacementCycle.id')=json_extract(job.request_json,'$.model3dCostPreview.replacementCycleId')",
      ])})`,
])})`;
