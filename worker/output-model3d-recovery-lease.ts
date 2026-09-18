import { captureOutputModel3dRecoveryCheckpoint } from "./output-model3d-recovery-checkpoint.ts";
import { compactModel3dRecoveryAssertions } from "./output-model3d-recovery-assertions.ts";
import { captureModel3dComparisonData } from "../src/model/output-model3d-offer.ts";
import { outputAssertionStatements, OutputConflictError, type OutputScope, type OutputOperationSlot, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { WorkerEnv } from "./runtime.ts";
import { model3dRecoveryAttemptSql } from "./output-model3d-recovery-attempt.ts";

const fail = (): never => { throw new OutputConflictError("output_model3d_recovery_unavailable", 409); };
type Current = { sourceDigest: string; requirementsDigest: string; retentionExpiresAt: string };
type Checkpoint = Awaited<ReturnType<typeof captureOutputModel3dRecoveryCheckpoint>>;
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), value => value.toString(16).padStart(2, "0")).join("");

/** D1 promises are not abortable. Retire the awaiting continuation promptly;
 * SQL deadlines still prevent a delayed claim from creating a usable lease. */
async function within<T>(operation: () => Promise<T>, deadlineMs: number, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!Number.isFinite(deadlineMs) || Date.now() >= deadlineMs) return fail();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const boundary = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new OutputConflictError("output_model3d_recovery_deadline", 409)), Math.max(0, deadlineMs - Date.now()));
    if (signal) { abort = () => reject(signal.reason ?? new Error("output_model3d_recovery_aborted")); signal.addEventListener("abort", abort, { once: true }); }
  });
  try {
    const value = await Promise.race([boundary, Promise.resolve().then(() => {
      signal?.throwIfAborted(); if (Date.now() >= deadlineMs) return fail(); return operation();
    })]);
    signal?.throwIfAborted(); if (Date.now() >= deadlineMs) return fail(); return value;
  } finally { if (timer !== undefined) clearTimeout(timer); if (abort) signal?.removeEventListener("abort", abort); }
}

/** Finite read/publication lease for a failed accepted attempt, never dispatch.
 * The caller's current resolver supplies nonempty live source/private authority
 * assertions and its actual minimum retained-body expiry. No synthetic scope or
 * snapshot authorizes this function. Existing normal job leases win.
 */
export async function claimOutputModel3dRecoveryLease(env: WorkerEnv, suppliedScope: OutputScope, suppliedSlot: OutputOperationSlot, suppliedJob: DocumentJobRow,
  options: { assertions: OutputSqlAssertion[]; current: Current; signal?: AbortSignal }) {
  const enteredAt = Date.now(), signal = options.signal;
  if (!options.assertions.length || options.assertions.some(a => !a.sql || a.bindings && a.bindings.length > 100)) fail();
  signal?.throwIfAborted();
  const scope = captureModel3dComparisonData({ kind: suppliedScope.kind, key: suppliedScope.key, actorUserId: suppliedScope.actorUserId,
    ownerUserId: suppliedScope.ownerUserId, projectId: suppliedScope.projectId, documentId: suppliedScope.documentId, contextId: suppliedScope.contextId,
    organizationId: suppliedScope.organizationId, projectAccessId: suppliedScope.projectAccessId }) as OutputScope;
  const slot = captureModel3dComparisonData(suppliedSlot) as OutputOperationSlot;
  const job = captureModel3dComparisonData(suppliedJob) as DocumentJobRow;
  const current = captureModel3dComparisonData(options.current) as Current;
  const entryDeadlineMs = Math.min(enteredAt + 120000, Date.parse(job.expires_at), Date.parse(current.retentionExpiresAt),
    ...options.assertions.flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs]));
  if (!Number.isFinite(entryDeadlineMs) || entryDeadlineMs <= Date.now()) fail();
  const entryExpiry = new Date(entryDeadlineMs).toISOString();
  const authority = compactModel3dRecoveryAssertions([...options.assertions.map(a => ({ ...a, bindings: [...(a.bindings ?? [])] })),
    { sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [entryExpiry], deadlineMs: entryDeadlineMs }]);
  const guardedRead = async <T extends Record<string, unknown>>(query: D1PreparedStatement) => {
    signal?.throwIfAborted();
    const results = await within(() => env.DB.batch<T>([...authority.flatMap(a => outputAssertionStatements(env, a)), query]), entryDeadlineMs, signal);
    signal?.throwIfAborted(); const result = results.at(-1); if (!result || result.success === false) return fail(); return result.results;
  };
  const grantRows = await guardedRead(env.DB.prepare("SELECT scope_key,grant_id,actor_user_id,payer_user_id,context_id,status FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=?")
    .bind(scope.key, slot.grantId, scope.actorUserId));
  const calls = await guardedRead(env.DB.prepare("SELECT scope_key,slot_id,call_key,stage_key,client_request_id,provider_response_id,request_digest,provider,model,status,reserved_microusd,used_microusd FROM output_provider_calls WHERE scope_key=? AND slot_id=? LIMIT 2")
    .bind(scope.key, slot.slotId));
  const tokens = await guardedRead(env.DB.prepare("SELECT reservation_id,owner_id,stream_id,correlation_id,operation,period,status,reserved_tokens,used_tokens FROM budget_reservations WHERE reservation_id=? AND owner_id=?")
    .bind(slot.tokenReservationId, scope.ownerUserId));
  const costs = await guardedRead(env.DB.prepare("SELECT reservation_id,owner_id,stream_id,correlation_id,operation,period,status,reserved_microusd,used_microusd FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?")
    .bind(slot.costReservationId, scope.ownerUserId));
  if (grantRows.length !== 1 || tokens.length !== 1 || costs.length !== 1) fail();
  const checkpoint = await within(() => captureOutputModel3dRecoveryCheckpoint({ scope: { kind: scope.kind, key: scope.key, actorUserId: scope.actorUserId, ownerUserId: scope.ownerUserId,
    projectId: scope.projectId, documentId: scope.documentId, contextId: scope.contextId, organizationId: scope.organizationId, projectAccessId: scope.projectAccessId },
    slot, job, grant: grantRows[0], calls, token: tokens[0], cost: costs[0], current }), entryDeadlineMs, signal);
  const deadlineMs = Math.min(entryDeadlineMs, Date.parse(checkpoint.expiresAt));
  if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) fail();
  const token = crypto.randomUUID(), expiresAt = new Date(deadlineMs).toISOString();
  const lease = { version: "output-model3d-recovery-v1", token, expiresAt, jobId: job.job_id, slotId: slot.slotId,
    clientRequestId: checkpoint.clientRequestId, providerRequestId: checkpoint.providerRequestId, requestDigest: checkpoint.requestDigest,
    originalSubmission: checkpoint.submission, priorStatus: job.status, priorErrorCode: job.error_message, priorCompletedAt: job.completed_at,
    originalResultSha256: await within(() => hash(checkpoint.resultJson as string), deadlineMs, signal) };
  const fixed = outputModel3dRecoveryAssertions(scope, slot, job, checkpoint, expiresAt);
  const claim = env.DB.prepare(`UPDATE document_jobs SET result_json=json_set(
    json_insert(json_set(result_json,'$.outputModel3dRecoveryHistory',json(COALESCE(json_extract(result_json,'$.outputModel3dRecoveryHistory'),'[]'))),
      '$.outputModel3dRecoveryHistory[#]',json(?)), '$.outputModel3dRecovery',json(?))
    WHERE job_id=? AND owner_id=? AND status='failed' AND result_json IS ?
      AND (json_type(result_json,'$.outputModel3dRecoveryHistory') IS NULL OR json_type(result_json,'$.outputModel3dRecoveryHistory')='array')
      AND COALESCE(json_array_length(result_json,'$.outputModel3dRecoveryHistory'),0)<32
      AND (json_type(result_json,'$.outputModel3dRecovery') IS NULL
        OR (json_extract(result_json,'$.outputModel3dRecovery.version')='output-model3d-recovery-v1'
          AND json_extract(result_json,'$.outputModel3dRecovery.expiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
    .bind(JSON.stringify(lease), JSON.stringify(lease), job.job_id, scope.actorUserId, job.result_json);
  signal?.throwIfAborted();
  await within(() => env.DB.batch(compactModel3dRecoveryAssertions([...authority, ...fixed]).flatMap(a => outputAssertionStatements(env, a)).concat([claim, ...outputAssertionStatements(env, { sql: "changes()=1" })])), deadlineMs, signal);
  const leaseAssertion: OutputSqlAssertion = { sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND status='failed' AND json_extract(result_json,'$.outputModel3dRecovery.token')=? AND json_extract(result_json,'$.outputModel3dRecovery.expiresAt')=? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    bindings: [job.job_id, scope.actorUserId, token, expiresAt, expiresAt], deadlineMs };
  const assertions = () => compactModel3dRecoveryAssertions([...authority, ...fixed, leaseAssertion]);
  const assertCurrent = async () => { signal?.throwIfAborted(); if (Date.now() >= deadlineMs) fail(); await within(() => env.DB.batch(assertions().flatMap(a => outputAssertionStatements(env, a))), deadlineMs, signal); signal?.throwIfAborted(); if (Date.now() >= deadlineMs) fail(); };
  return Object.freeze({ checkpoint, token, expiresAt, deadlineMs, lease: Object.freeze(lease), assertions, assertCurrent,
    async release() {
      // Only retire this capability. Do not rewrite history or a completed job,
      // release money, reset notification, cancel the provider or queue a retry.
      // Independent of an already-aborted operation signal. The expiry is
      // captured now, and a late exact-token write can only retire capability.
      const retiredAt = new Date().toISOString();
      await within(() => env.DB.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputModel3dRecovery.expiresAt',?) WHERE job_id=? AND owner_id=? AND status='failed' AND json_extract(result_json,'$.outputModel3dRecovery.token')=?")
        .bind(retiredAt, job.job_id, scope.actorUserId, token).run(), Date.now() + 250).catch(() => {});
    },
  });
}

/** Exported pure statement builder for bounded SQL-shape controls. Each proof
 * remains its own assertion statement, not a flattened >100-binding query.
 */
export function outputModel3dRecoveryAssertions(scope: OutputScope, slot: OutputOperationSlot, job: DocumentJobRow, checkpoint: Checkpoint, expiresAt: string): OutputSqlAssertion[] {
  const original = JSON.parse(checkpoint.resultJson as string) as Record<string, unknown>;
  const immutableKeys = ["artifactId", "artifactKind", "outputExecution", "model3dInputReceipt", "reservationId", "costReservationId", "costReservationPeriod"];
  if (immutableKeys.some(key => !Object.hasOwn(original, key) || original[key] === undefined)) fail();
  const immutable = immutableKeys.map(key => ({ sql: "EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_extract(result_json,?) IS json_extract(?,'$') AND json_type(result_json,?)=json_type(?,'$'))",
    bindings: [job.job_id, "$." + key, JSON.stringify(original[key]), "$." + key, JSON.stringify(original[key])] }));
  return [...immutable, { sql: `EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    WHERE (job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.correlation_id=? AND job.kind='render_document'
      AND job.source_surface='outputs' AND job.status='failed' AND job.attempt_count=1 AND job.request_json=? AND job.expires_at=?
      AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (job.lease_expires_at IS NULL OR job.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND json_type(job.result_json,'$.outputModel3dStop') IS NULL)
      AND (slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.target_id=? AND slot.target_contract_digest=? AND slot.source_digest=? AND slot.route_digest=?
      AND slot.attempt_ordinal=? AND slot.previous_slot_id IS ? AND slot.status IN('failed','uncertain')
      AND slot.provider='fal' AND slot.model=? AND slot.maximum_calls=1 AND slot.maximum_tokens=1 AND slot.maximum_microusd=?
      AND slot.token_reservation_id=? AND slot.cost_reservation_id=?)
      AND (plan.scope_kind='personal' AND plan.owner_user_id=job.owner_id AND plan.project_id=? AND plan.document_id=job.document_id
      AND plan.organization_id IS NULL AND plan.project_access_id IS NULL AND plan.source_digest=slot.source_digest AND plan.requirements_digest=?
      AND grant_row.actor_user_id=job.owner_id AND grant_row.payer_user_id=job.owner_id AND grant_row.context_id IS NULL AND grant_row.status IN('authorized','active','completed'))
      AND ((SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind IN('job','document') AND resource.resource_id IN(job.job_id,job.document_id))
      AND NOT EXISTS(SELECT 1 FROM document_jobs other WHERE other.stream_id=job.stream_id AND other.document_id=job.document_id AND other.job_id<>job.job_id AND other.status IN('running','committing') AND other.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))`,
    bindings: [job.job_id, scope.actorUserId, job.stream_id, scope.documentId, job.correlation_id, job.request_json, job.expires_at,
      scope.key, slot.slotId, slot.grantId, slot.planRevisionId, slot.targetId, slot.targetContractDigest, slot.sourceDigest, slot.routeDigest,
      slot.attemptOrdinal, slot.previousSlotId, checkpoint.prepared.model, checkpoint.offer.preview.maximumMicrousd, slot.tokenReservationId, slot.costReservationId, scope.projectId, checkpoint.offer.preview.requirementsDigest] },
  { sql: `EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
    WHERE (job.job_id=? AND slot.scope_key=? AND slot.slot_id=?) AND ${model3dRecoveryAttemptSql})`,
    bindings: [job.job_id, scope.key, slot.slotId] },
  { sql: `EXISTS(SELECT 1 FROM output_provider_calls call JOIN document_jobs job ON job.job_id=?
    JOIN json_each(job.result_json,'$.providerSubmissions') receipt ON receipt.key=call.client_request_id
    WHERE call.scope_key=? AND call.slot_id=? AND call.call_key='model3d:initial' AND call.stage_key='model3d:initial'
      AND call.provider='fal' AND call.model=? AND call.client_request_id=? AND call.provider_response_id=? AND call.request_digest=? AND call.reserved_microusd=?
      AND call.status IN('uncertain','settled') AND (call.status='uncertain' AND call.used_microusd IS NULL OR call.status='settled' AND call.used_microusd=call.reserved_microusd)
      AND json_extract(receipt.value,'$.clientRequestId')=call.client_request_id AND json_extract(receipt.value,'$.providerRequestId')=call.provider_response_id
      AND json_extract(receipt.value,'$.provider')='fal' AND json_extract(receipt.value,'$.model')=call.model AND json_extract(receipt.value,'$.operation')='model3d'
      AND json_extract(receipt.value,'$.status') IN('accepted','completed')
      AND (json_type(receipt.value,'$.requestDigest') IS NULL OR json_extract(receipt.value,'$.requestDigest')=call.request_digest)
      AND (json_extract(receipt.value,'$.status')='accepted' AND call.status='uncertain'
        OR json_extract(receipt.value,'$.status')='completed' AND json_extract(receipt.value,'$.costMicrousd')=call.reserved_microusd
          AND json_extract(receipt.value,'$.inputTokens')=0 AND json_extract(receipt.value,'$.outputTokens')=0 AND json_extract(receipt.value,'$.totalTokens')=0)
      AND (SELECT COUNT(*) FROM output_provider_calls counted WHERE counted.scope_key=call.scope_key AND counted.slot_id=call.slot_id)=1
      AND (SELECT COUNT(*) FROM json_each(job.result_json,'$.providerSubmissions'))=1)`,
    bindings: [job.job_id, scope.key, slot.slotId, checkpoint.prepared.model, checkpoint.clientRequestId, checkpoint.providerRequestId, checkpoint.requestDigest, checkpoint.offer.preview.maximumMicrousd] },
  { sql: `EXISTS(SELECT 1 FROM budget_reservations token JOIN cost_budget_reservations cost ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id
      AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period
    WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=? AND token.correlation_id=? AND token.operation='document-render:model3d'
      AND token.period=? AND token.reserved_tokens=1 AND cost.reserved_microusd=?
      AND ((token.status='active' AND cost.status IN('active','executing') AND COALESCE(token.used_tokens,0)=0 AND COALESCE(cost.used_microusd,0)=0)
        OR (token.status='released' AND token.used_tokens=0 AND cost.status='settled' AND cost.used_microusd=cost.reserved_microusd
          AND EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key='model3d:initial' AND status='settled' AND used_microusd=cost.used_microusd))))`,
    bindings: [slot.tokenReservationId, slot.costReservationId, scope.ownerUserId, job.stream_id, job.correlation_id, original.costReservationPeriod as string, checkpoint.offer.preview.maximumMicrousd, scope.key, slot.slotId] },
  { sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [expiresAt], deadlineMs: Date.parse(expiresAt) }];
}
