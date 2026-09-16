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
export function sceneRenewalIndexAssertion(scope: OutputScope, draftId: string, expectedKeys: readonly string[], output: "scene" | "video" | "model3d" | "slides" | "audio" = "scene"): OutputSqlAssertion {
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
export function sceneRenewalNoExecutionAssertion(scope: OutputScope, originalRequestIds: readonly string[], output: "scene" | "video" | "audio" = "scene"): OutputSqlAssertion {
  personal(scope);
  if (originalRequestIds.length < 1 || originalRequestIds.length > 9 || new Set(originalRequestIds).size !== originalRequestIds.length
    || !["scene", "video", "audio"].includes(output)
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

/** Slides job/reservation UUIDs are allocated at authorization, not quote time.
 * Never invent a deterministic request ID. Unassociated own-stream reservations
 * are blockers; only a consistent, positively different Document is excluded.
 * Keep this proof in both read qualification and the atomic successor append. */
export function slidesRenewalNoExecutionAssertion(scope: OutputScope): OutputSqlAssertion {
  personal(scope);
  const stream = `creative:${scope.ownerUserId}`;
  const reservations = (["budget_reservations", "cost_budget_reservations"] as const).map((table, index) => {
    const reservationId = index === 0 ? "token_reservation_id" : "cost_reservation_id";
    const eventReservationId = index === 0 ? "reservation_id" : "cost_reservation_id";
    return { sql: `NOT EXISTS(SELECT 1 FROM ${table} reservation
      WHERE (reservation.owner_id=? OR reservation.stream_id=?) AND reservation.operation='document-render:slides'
      AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot
        JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
        JOIN document_jobs job ON job.job_id=slot.job_id
        WHERE slot.${reservationId}=reservation.reservation_id
          AND reservation.owner_id=? AND reservation.stream_id=?
          AND plan.owner_user_id=? AND plan.document_id!=? AND length(plan.document_id) BETWEEN 1 AND 160
          AND plan.document_id GLOB '[A-Za-z0-9]*' AND plan.document_id NOT GLOB '*[^A-Za-z0-9._:-]*'
          AND slot.scope_key='personal:'||plan.owner_user_id||':'||plan.project_id
          AND job.owner_id=plan.owner_user_id AND job.document_id=plan.document_id AND job.stream_id=reservation.stream_id
          AND (reservation.correlation_id=slot.job_id
            OR (substr(reservation.correlation_id,1,length(slot.job_id)+9)=slot.job_id||':attempt:'
              AND length(substr(reservation.correlation_id,length(slot.job_id)+10)) BETWEEN 1 AND 9
              AND substr(reservation.correlation_id,length(slot.job_id)+10) NOT GLOB '*[^0-9]*'
              AND CAST(substr(reservation.correlation_id,length(slot.job_id)+10) AS INTEGER)>0)
            OR (substr(reservation.correlation_id,1,length(slot.job_id)+10)=slot.job_id||':recovery:'
              AND length(substr(reservation.correlation_id,length(slot.job_id)+11))=36
              AND substr(reservation.correlation_id,length(slot.job_id)+11) GLOB '????????-????-????-????-????????????'
              AND length(replace(substr(reservation.correlation_id,length(slot.job_id)+11),'-',''))=32
              AND replace(substr(reservation.correlation_id,length(slot.job_id)+11),'-','') NOT GLOB '*[^a-f0-9]*')))
      AND NOT EXISTS(SELECT 1 FROM document_jobs job
        JOIN events budget ON budget.stream_id=job.stream_id AND budget.type='BudgetReserved'
        JOIN events requested ON requested.event_id=budget.causation_id
        WHERE job.owner_id=? AND job.stream_id=? AND job.kind='render_document'
          AND reservation.owner_id=job.owner_id AND reservation.stream_id=job.stream_id
          AND job.document_id!=? AND length(job.document_id) BETWEEN 1 AND 160
          AND job.document_id GLOB '[A-Za-z0-9]*' AND job.document_id NOT GLOB '*[^A-Za-z0-9._:-]*'
          AND CASE WHEN json_valid(job.request_json) THEN json_extract(job.request_json,'$.artifactKind')='slides' ELSE 0 END
          AND (reservation.correlation_id=job.job_id
            OR (substr(reservation.correlation_id,1,length(job.job_id)+9)=job.job_id||':attempt:'
              AND length(substr(reservation.correlation_id,length(job.job_id)+10)) BETWEEN 1 AND 9
              AND substr(reservation.correlation_id,length(job.job_id)+10) NOT GLOB '*[^0-9]*'
              AND CAST(substr(reservation.correlation_id,length(job.job_id)+10) AS INTEGER)>0)
            OR (substr(reservation.correlation_id,1,length(job.job_id)+10)=job.job_id||':recovery:'
              AND length(substr(reservation.correlation_id,length(job.job_id)+11))=36
              AND substr(reservation.correlation_id,length(job.job_id)+11) GLOB '????????-????-????-????-????????????'
              AND length(replace(substr(reservation.correlation_id,length(job.job_id)+11),'-',''))=32
              AND replace(substr(reservation.correlation_id,length(job.job_id)+11),'-','') NOT GLOB '*[^a-f0-9]*'))
          AND budget.actor='worker:policy' AND budget.client_id='server:document-job:render_document'
          AND budget.correlation_id=reservation.correlation_id
          AND requested.stream_id=job.stream_id AND requested.type='DocumentRenderRequested'
          AND (requested.actor='user' OR requested.actor='user:'||job.owner_id) AND requested.client_id=budget.client_id
          AND requested.correlation_id=budget.correlation_id AND requested.sequence<budget.sequence
          AND CASE WHEN json_valid(budget.payload) AND json_valid(requested.payload) THEN
            json_extract(budget.payload,'$.operation')='document-render:slides'
            AND json_extract(budget.payload,'$.artifact_kind')='slides'
            AND json_extract(budget.payload,'$.${eventReservationId}')=reservation.reservation_id
            AND json_extract(budget.payload,'$.period')=reservation.period
            AND json_type(budget.payload,'$.artifact_id')='text' AND length(json_extract(budget.payload,'$.artifact_id'))>0
            AND json_extract(requested.payload,'$.artifact_id')=json_extract(budget.payload,'$.artifact_id')
            AND json_extract(requested.payload,'$.artifact_kind')='slides'
            AND json_extract(requested.payload,'$.document_id')=job.document_id ELSE 0 END))`,
      bindings: [scope.ownerUserId, stream, scope.ownerUserId, stream, scope.ownerUserId, scope.documentId,
        scope.ownerUserId, stream, scope.documentId] };
  });
  return { sql: `NOT EXISTS(SELECT 1 FROM output_commands command LEFT JOIN events event ON event.event_id=command.event_id
      WHERE command.scope_key=? AND command.action IN('authorize','run')
      AND CASE WHEN json_valid(event.payload) THEN
        (json_extract(event.payload,'$.document_id')=? OR json_type(event.payload,'$.document_id') IS NOT 'text') ELSE 1 END)
    AND NOT EXISTS(SELECT 1 FROM events event WHERE event.stream_id=? AND event.type IN('OutputExecutionAuthorized','OutputExecutionRunRequested')
      AND CASE WHEN json_valid(event.payload) THEN
        (json_extract(event.payload,'$.document_id')=? OR json_type(event.payload,'$.document_id') IS NOT 'text'
          OR length(json_extract(event.payload,'$.document_id')) NOT BETWEEN 1 AND 160
          OR json_extract(event.payload,'$.document_id') NOT GLOB '[A-Za-z0-9]*'
          OR json_extract(event.payload,'$.document_id') GLOB '*[^A-Za-z0-9._:-]*') ELSE 1 END)
    AND NOT EXISTS(SELECT 1 FROM output_execution_grants grant_row LEFT JOIN output_plan_revisions plan
      ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id
      WHERE grant_row.scope_key=? AND (plan.document_id=? OR plan.document_id IS NULL))
    AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot LEFT JOIN output_plan_revisions plan
      ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      WHERE slot.scope_key=? AND (plan.document_id=? OR plan.document_id IS NULL))
    AND NOT EXISTS(SELECT 1 FROM document_jobs WHERE owner_id=? AND document_id=?)
    AND NOT EXISTS(SELECT 1 FROM output_provider_calls call LEFT JOIN output_operation_slots slot
      ON slot.scope_key=call.scope_key AND slot.slot_id=call.slot_id
      LEFT JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
      WHERE call.scope_key=? AND (plan.document_id=? OR plan.document_id IS NULL))
    AND ${reservations.map(part => part.sql).join(" AND ")}`,
    bindings: [scope.key, scope.documentId, stream, scope.documentId, scope.key, scope.documentId,
      scope.key, scope.documentId, scope.ownerUserId, scope.documentId, scope.key, scope.documentId,
      ...reservations.flatMap(part => part.bindings)] };
}
