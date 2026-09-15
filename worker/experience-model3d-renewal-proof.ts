import type { OutputScope, OutputSqlAssertion } from "./output-command-core.ts";
import { parseModel3dReplacementPredecessor, type Model3dReplacementPredecessor } from "./experience-model3d-replacement.ts";

/** Unpaid quote renewal exempts only the positively captured original parent.
 * All other execution history (including orphan/failed/settled rows) blocks it.
 * Exact parent row/custody assertions MUST accompany this in the same batch. */
export function model3dRenewalNoExecutionAssertion(scope: OutputScope, requestIds: readonly string[], parent: Model3dReplacementPredecessor): OutputSqlAssertion {
  if (scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || scope.organizationId !== null
    || scope.contextId !== null || scope.projectAccessId !== null || scope.key !== `personal:${scope.ownerUserId}:${scope.projectId}`
    || !parseModel3dReplacementPredecessor(parent) || requestIds.length < 1 || requestIds.length > 9
    || new Set(requestIds).size !== requestIds.length || requestIds.some(id => !/^model3d-[a-f0-9]{64}$/u.test(id) || id === parent.jobId))
    throw new Error("experience_model3d_replacement_lineage_unavailable");
  const requests = JSON.stringify([...requestIds].sort());
  return { sql: `NOT EXISTS(SELECT 1 FROM output_commands command LEFT JOIN events event ON event.event_id=command.event_id
      WHERE command.scope_key=? AND command.action IN('authorize','run') AND command.command_key NOT IN(?,?)
        AND CASE WHEN json_valid(event.payload) THEN (json_extract(event.payload,'$.document_id')=? OR json_type(event.payload,'$.document_id') IS NULL
          OR json_type(event.payload,'$.document_id')!='text'
          OR length(json_extract(event.payload,'$.document_id')) NOT BETWEEN 1 AND 160
          OR json_extract(event.payload,'$.document_id') NOT GLOB '[A-Za-z0-9]*'
          OR json_extract(event.payload,'$.document_id') GLOB '*[^A-Za-z0-9._:-]*') ELSE 1 END)
    AND NOT EXISTS(SELECT 1 FROM events event WHERE event.stream_id=? AND event.event_id NOT IN(?,?)
      AND event.type IN('OutputExecutionAuthorized','OutputExecutionRunRequested')
      AND CASE WHEN json_valid(event.payload) THEN
        (json_extract(event.payload,'$.document_id')=? OR json_type(event.payload,'$.document_id') IS NULL
          OR json_type(event.payload,'$.document_id')!='text'
          OR length(json_extract(event.payload,'$.document_id')) NOT BETWEEN 1 AND 160
          OR json_extract(event.payload,'$.document_id') NOT GLOB '[A-Za-z0-9]*'
          OR json_extract(event.payload,'$.document_id') GLOB '*[^A-Za-z0-9._:-]*') ELSE 1 END)
    AND NOT EXISTS(SELECT 1 FROM output_execution_grants grant_row LEFT JOIN output_plan_revisions plan
      ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id
      WHERE grant_row.scope_key=? AND grant_row.grant_id!=? AND (plan.document_id=? OR plan.document_id IS NULL))
    AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot LEFT JOIN output_plan_revisions plan
      ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      WHERE slot.scope_key=? AND slot.slot_id!=? AND (plan.document_id=? OR plan.document_id IS NULL
        OR slot.job_id IN(SELECT value FROM json_each(?))))
    AND NOT EXISTS(SELECT 1 FROM document_jobs WHERE job_id!=? AND ((owner_id=? AND document_id=?)
      OR job_id IN(SELECT value FROM json_each(?))))
    AND NOT EXISTS(SELECT 1 FROM budget_reservations reservation WHERE EXISTS(SELECT 1 FROM json_each(?) original
      WHERE reservation.correlation_id=original.value OR substr(reservation.correlation_id,1,length(original.value)+9)=original.value||':attempt:'))
    AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations reservation WHERE EXISTS(SELECT 1 FROM json_each(?) original
      WHERE reservation.correlation_id=original.value OR substr(reservation.correlation_id,1,length(original.value)+9)=original.value||':attempt:'))
    AND NOT EXISTS(SELECT 1 FROM output_provider_calls call LEFT JOIN output_operation_slots slot
      ON slot.scope_key=call.scope_key AND slot.slot_id=call.slot_id
      LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      WHERE call.scope_key=? AND call.slot_id!=? AND (plan.document_id=? OR plan.document_id IS NULL
        OR slot.job_id IN(SELECT value FROM json_each(?))))`,
    bindings: [scope.key, parent.authorization.key, parent.run.key, scope.documentId,
      `creative:${scope.ownerUserId}`, parent.authorization.eventId, parent.run.eventId, scope.documentId,
      scope.key, parent.grantId, scope.documentId, scope.key, parent.slotId, scope.documentId, requests,
      parent.jobId, scope.ownerUserId, scope.documentId, requests, requests, requests, scope.key, parent.slotId, scope.documentId, requests] };
}
