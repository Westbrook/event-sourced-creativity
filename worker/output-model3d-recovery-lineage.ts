import { canonicalJson } from "../src/experiences/compiler.ts";
import { readExperienceOutputLineage } from "./experience-output-originals.ts";
import { model3dLineageIndexAssertions } from "./experience-model3d-replacement-proof.ts";
import { outputCommandReceiptAssertion, OutputConflictError, type OutputOperationSlot, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { ExperienceOutputBinding } from "./experience-output-binding.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import { readModel3dExecutionOffer } from "../src/model/output-model3d-offer.ts";
import { model3dMiniAppAttemptMatches } from "../src/model/model3d-mini-app-consent.ts";
import type { OutputPreflight } from "../src/model/output-delivery-contract.ts";

const fail = (): never => { throw new OutputConflictError("output_model3d_recovery_lineage_unavailable", 409); };
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** An already authorized child only. No new quote, paid call, parent mutation,
 * or dependence on the parent's later reconciliation/lease/hold state. The
 * caller reuses the full retained draft/intake/current-source resolver. */
export async function resolveAcceptedModel3dReplacement(input: OutputBridgeTargetInput, root: ExperienceOutputBinding,
  retentionExpiresAt: string, slot: OutputOperationSlot) {
  if (slot.attemptOrdinal !== 1 || !slot.previousSlotId || slot.scopeKey !== input.scope.key) return fail();
  const lineage = await readExperienceOutputLineage({ env: input.env, scope: input.scope }, root);
  const cycle = lineage.binding.replacementCycle, saved = lineage.originals;
  if (!cycle || !saved.confirm || !saved.preflight || !saved.authorize || !saved.run
    || !same(saved.confirm.receipt.payload.confirmed_plan, input.confirmedPlan)
    || saved.confirm.receipt.payload.plan_revision_id !== slot.planRevisionId
    || saved.authorize.receipt.payload.grant_id !== slot.grantId
    || saved.authorize.envelope.explicitAuthorization !== true || saved.run.envelope.explicitRun !== true
    || saved.run.envelope.grantId !== slot.grantId || saved.run.receipt.payload.grant_id !== slot.grantId
    || saved.run.receipt.payload.existing_jobs_only !== true || !same(saved.run.receipt.payload.job_ids, [slot.jobId])
    || !same(saved.authorize.receipt.payload.authorized_targets, [{ target_id: slot.targetId, operation_slot_id: slot.slotId, job_id: slot.jobId, route_digest: slot.routeDigest }])
    || cycle.predecessor.slotId !== slot.previousSlotId || cycle.predecessor.jobId === slot.jobId
    || cycle.predecessor.grantId === slot.grantId || cycle.predecessor.targetId !== slot.targetId
    || cycle.predecessor.targetContractDigest !== slot.targetContractDigest
    || cycle.predecessor.sourceDigest !== input.sourceDigest || cycle.predecessor.requirementsDigest !== input.requirementsDigest) return fail();
  const prior = cycle.predecessor;
  const preflight = saved.preflight.receipt.payload.preflight as OutputPreflight;
  const offer = preflight?.targets?.length === 1 ? readModel3dExecutionOffer(preflight.targets[0]) : null;
  if (!offer || !model3dMiniAppAttemptMatches(offer.preview,slot)
    || preflight.planRevisionId!==slot.planRevisionId || saved.preflight.receipt.payload.preflight_id!==preflight.id
    || saved.authorize.receipt.payload.preflight_id!==preflight.id || saved.authorize.envelope.preflightId!==preflight.id
    || saved.authorize.envelope.termsDigest!==preflight.termsDigest || saved.authorize.envelope.maximumMicrousd!==preflight.maximumMicrousd
    || !same(saved.authorize.envelope.model3dCostConsent,{...offer.preview,confirmed:true,providerTransferConfirmed:true})
    || offer.preview.replacementCycleId!==cycle.id || offer.preview.previousJobId!==prior.jobId
    || offer.preview.previousProviderRequestId!==prior.providerRequestId) return fail();
  // Select immutable parent identity only. Status, completed/updated timestamps,
  // settlement totals and recovery metadata are intentionally not witnesses.
  const parentSql = `SELECT parent.scope_key,parent.slot_id,parent.job_id,parent.grant_id,parent.plan_revision_id,
      parent.target_id,parent.target_contract_digest,parent.source_digest,parent.token_reservation_id,parent.cost_reservation_id,
      call.client_request_id,call.provider_response_id,call.request_digest,call.provider,call.model,call.reserved_microusd
    FROM output_operation_slots parent JOIN document_jobs job ON job.job_id=parent.job_id
    JOIN output_provider_calls call ON call.scope_key=parent.scope_key AND call.slot_id=parent.slot_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=parent.scope_key AND grant_row.grant_id=parent.grant_id
    WHERE (parent.scope_key=? AND parent.slot_id=? AND parent.job_id=? AND parent.grant_id=?
      AND parent.attempt_ordinal=0 AND parent.previous_slot_id IS NULL AND parent.target_id=?
      AND parent.target_contract_digest=? AND parent.source_digest=? AND parent.plan_revision_id=?
      AND parent.provider='fal' AND parent.maximum_calls=1 AND parent.maximum_tokens=1 AND parent.maximum_microusd=400000
      AND parent.token_reservation_id<>? AND parent.cost_reservation_id<>?)
      AND (job.owner_id=? AND job.document_id=? AND job.stream_id=? AND job.source_surface='outputs' AND job.kind='render_document'
      AND grant_row.actor_user_id=job.owner_id AND grant_row.payer_user_id=job.owner_id AND grant_row.context_id IS NULL
      AND call.call_key='model3d:initial' AND call.stage_key='model3d:initial' AND call.provider='fal' AND call.model=parent.model
      AND call.provider_response_id=? AND call.reserved_microusd=400000
      AND length(call.request_digest)=64 AND call.request_digest NOT GLOB '*[^0-9a-f]*')
      AND ((SELECT COUNT(*) FROM output_provider_calls counted WHERE counted.scope_key=parent.scope_key AND counted.slot_id=parent.slot_id)=1
      AND (SELECT COUNT(*) FROM output_operation_slots child WHERE child.scope_key=parent.scope_key AND child.previous_slot_id=parent.slot_id)=1
      AND NOT EXISTS(SELECT 1 FROM output_operation_slots child WHERE child.scope_key=parent.scope_key AND child.previous_slot_id=parent.slot_id AND child.slot_id<>?))`;
  const bindings = [input.scope.key, prior.slotId, prior.jobId, prior.grantId, slot.targetId, slot.targetContractDigest, slot.sourceDigest,
    prior.confirmation.planRevisionId, slot.tokenReservationId, slot.costReservationId, input.scope.actorUserId, input.scope.documentId,
    root.streamId, prior.providerRequestId, slot.slotId];
  const parent = await input.env.DB.prepare(parentSql).bind(...bindings).first<Record<string, string>>();
  if (!parent) return fail();
  const assertions: OutputSqlAssertion[] = [
    ...lineage.witnesses.map(value => outputCommandReceiptAssertion(input.scope, value.receipt)),
    ...model3dLineageIndexAssertions(input.scope, root.draftId, lineage.cycleCommandKeys),
    {sql:"EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND preflight_id=? AND plan_revision_id=? AND authorization_event_id=?)",
      bindings:[slot.scopeKey,slot.grantId,preflight.id,slot.planRevisionId,saved.authorize.receipt.eventId]},
    { sql: `EXISTS(${parentSql} AND call.client_request_id=? AND call.request_digest=? AND call.model=?)`,
      bindings: [...bindings, parent.client_request_id!, parent.request_digest!, parent.model!] },
    { sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [retentionExpiresAt], deadlineMs: Date.parse(retentionExpiresAt) },
  ];
  return { cycle, assertions };
}
