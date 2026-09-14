import type { OutputScope, OutputSqlAssertion } from "./output-command-core.ts";
import { scenePreparationCyclePrefix, type ScenePreparationPredecessor } from "./experience-scene-renewal.ts";

const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value);
function personal(scope: OutputScope) {
  if (scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || scope.organizationId !== null
    || scope.projectAccessId !== null || scope.contextId !== null
    || ![scope.actorUserId, scope.documentId, scope.projectId].every(id)
    || scope.key !== `personal:${scope.ownerUserId}:${scope.projectId}`) throw new Error("experience_scene_renewal_scope_unavailable");
}

/** Fence the actual retained row, not only its earlier-read expiry. A shortened
 * or extended retention deadline invalidates this preparation; renewal never
 * changes retention itself. Full draft bytes/custody remain separate guards. */
export function sceneRenewalWindowAssertion(scope: OutputScope, draftId: string, preparationExpiresAt: string, retentionExpiresAt: string): OutputSqlAssertion {
  personal(scope);
  scenePreparationCyclePrefix(draftId);
  for (const value of [preparationExpiresAt, retentionExpiresAt]) {
    if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("experience_scene_renewal_lineage_unavailable");
  }
  return { sql: `?<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM private_content draft
    WHERE draft.content_id=? AND draft.owner_id=? AND draft.kind='experience-draft' AND draft.redacted_at IS NULL
      AND draft.expires_at=? AND julianday(draft.expires_at)>julianday('now','+15 minutes'))`,
    bindings: [preparationExpiresAt, draftId, scope.ownerUserId, retentionExpiresAt] };
}

export function sceneRenewalPredecessorAssertion(scope: OutputScope, predecessor: ScenePreparationPredecessor): OutputSqlAssertion {
  personal(scope);
  const planRevisionId = predecessor.confirmation.planRevisionId;
  if (!id(planRevisionId) || !id(predecessor.confirmation.eventId)) throw new Error("experience_scene_renewal_lineage_unavailable");
  return { sql: `(SELECT plan_revision_id FROM output_plan_revisions WHERE scope_key=? AND document_id=? ORDER BY revision DESC LIMIT 1)=?
    AND EXISTS(SELECT 1 FROM output_plan_revisions WHERE scope_key=? AND plan_revision_id=? AND owner_user_id=?
      AND project_id=? AND document_id=? AND confirmed_event_id=? AND source_digest=? AND requirements_digest=?)`,
    bindings: [scope.key, scope.documentId, planRevisionId, scope.key, planRevisionId, scope.ownerUserId, scope.projectId,
      scope.documentId, predecessor.confirmation.eventId, predecessor.sourceDigest, predecessor.requirementsDigest] };
}

/** Exact index fence for selection and for the first successor append. Receipt
 * and private-body assertions must ALSO accompany it. A count alone is not
 * sufficient: replacing a key while retaining the count must fail. */
export function sceneRenewalIndexAssertion(scope: OutputScope, draftId: string, expectedKeys: readonly string[], output: "scene" | "video" = "scene"): OutputSqlAssertion {
  personal(scope);
  const prefix = scenePreparationCyclePrefix(draftId, output);
  if (expectedKeys.length > 32 || new Set(expectedKeys).size !== expectedKeys.length
    || expectedKeys.some(key => !id(key) || !key.startsWith(prefix))) throw new Error("experience_scene_renewal_lineage_unavailable");
  return { sql: `(SELECT COUNT(*) FROM output_commands WHERE scope_key=? AND actor_user_id=? AND substr(command_key,1,?)=?)=?
    AND NOT EXISTS(SELECT 1 FROM output_commands WHERE scope_key=? AND actor_user_id=? AND substr(command_key,1,?)=?
      AND command_key NOT IN(SELECT value FROM json_each(?)))`,
    bindings: [scope.key, scope.actorUserId, prefix.length, prefix, expectedKeys.length,
      scope.key, scope.actorUserId, prefix.length, prefix, JSON.stringify([...expectedKeys].sort())] };
}

/** Require absence in the actual durable indexes, including settled/failed rows.
 * A missing table or query failure must propagate as unavailable. Do not catch
 * it and substitute zeros. Orphan scope rows are conservative blockers because
 * their missing association cannot prove they belong to another Document.
 *
 * originalRequestIds must include every retained plan in the verified lineage;
 * native Scene reservation correlation is exactly that plan's request/job ID.
 * The same predicate is intended for read qualification AND final atomic write,
 * never solely as an earlier in-memory Boolean. */
export function sceneRenewalNoExecutionAssertion(scope: OutputScope, originalRequestIds: readonly string[], output: "scene" | "video" = "scene"): OutputSqlAssertion {
  personal(scope);
  if (originalRequestIds.length < 1 || originalRequestIds.length > 9 || new Set(originalRequestIds).size !== originalRequestIds.length
    || !["scene", "video"].includes(output)
    || originalRequestIds.some(value => !new RegExp(`^${output}-[a-f0-9]{64}$`, "u").test(value))) throw new Error("experience_scene_renewal_lineage_unavailable");
  const requests = JSON.stringify([...originalRequestIds].sort());
  return { sql: `NOT EXISTS(SELECT 1 FROM output_commands command LEFT JOIN events event ON event.event_id=command.event_id
      WHERE command.scope_key=? AND command.action IN('authorize','run')
        AND (json_extract(event.payload,'$.document_id')=? OR json_extract(event.payload,'$.document_id') IS NULL))
    AND NOT EXISTS(SELECT 1 FROM events event WHERE event.stream_id=?
      AND event.type IN('OutputExecutionAuthorized','OutputExecutionRunRequested')
      AND CASE WHEN json_valid(event.payload) THEN
        (json_extract(event.payload,'$.document_id')=? OR json_type(event.payload,'$.document_id') IS NULL
          OR json_type(event.payload,'$.document_id')!='text'
          OR length(json_extract(event.payload,'$.document_id')) NOT BETWEEN 1 AND 160
          OR json_extract(event.payload,'$.document_id') NOT GLOB '[A-Za-z0-9]*'
          OR json_extract(event.payload,'$.document_id') GLOB '*[^A-Za-z0-9._:-]*') ELSE 1 END)
    AND NOT EXISTS(SELECT 1 FROM output_execution_grants grant_row LEFT JOIN output_plan_revisions plan
      ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id
      WHERE grant_row.scope_key=? AND (plan.document_id=? OR plan.document_id IS NULL))
    AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot LEFT JOIN output_plan_revisions plan
      ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      WHERE slot.scope_key=? AND (plan.document_id=? OR plan.document_id IS NULL
        OR slot.job_id IN(SELECT value FROM json_each(?))))
    AND NOT EXISTS(SELECT 1 FROM document_jobs WHERE (owner_id=? AND document_id=?)
      OR job_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM budget_reservations reservation WHERE EXISTS(SELECT 1 FROM json_each(?) original
      WHERE reservation.correlation_id=original.value OR substr(reservation.correlation_id,1,length(original.value)+9)=original.value||':attempt:'))
    AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations reservation WHERE EXISTS(SELECT 1 FROM json_each(?) original
      WHERE reservation.correlation_id=original.value OR substr(reservation.correlation_id,1,length(original.value)+9)=original.value||':attempt:'))
    AND NOT EXISTS(SELECT 1 FROM output_provider_calls call LEFT JOIN output_operation_slots slot
      ON slot.scope_key=call.scope_key AND slot.slot_id=call.slot_id
      LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      WHERE call.scope_key=? AND (plan.document_id=? OR plan.document_id IS NULL
        OR slot.job_id IN(SELECT value FROM json_each(?))))`,
    bindings: [scope.key, scope.documentId, `creative:${scope.ownerUserId}`, scope.documentId,
      scope.key, scope.documentId, scope.key, scope.documentId, requests,
      scope.ownerUserId, scope.documentId, requests, requests, requests, scope.key, scope.documentId, requests] };
}
