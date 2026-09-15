import { captureOutputModel3dRecoveryCheckpoint } from "./output-model3d-recovery-checkpoint.ts";
import { compactModel3dRecoveryAssertions } from "./output-model3d-recovery-assertions.ts";
import { outputProofReadStatements, assertOutputProofRead } from "./output-disclosure-proof.ts";
import { OutputConflictError, outputSlotFromRow, type OutputScope, type OutputOperationSlot, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { model3dMayPrepareReplacement, model3dReplacementPrefix } from "./experience-model3d-replacement.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { WorkerEnv } from "./runtime.ts";
import { scenePreparationCyclePrefix } from "./experience-scene-renewal.ts";
import { sceneRenewalIndexAssertion } from "./experience-scene-renewal-proof.ts";

const fail = (): never => { throw new OutputConflictError("experience_model3d_replacement_unavailable", 409); };
type Row = Record<string, string | number | null>;
const tables = new Set(["document_jobs", "output_operation_slots", "output_execution_grants", "output_provider_calls", "budget_reservations", "cost_budget_reservations"]);
export function model3dLineageIndexAssertions(scope: OutputScope, draftId: string, keys: readonly string[]): OutputSqlAssertion[] {
  const replacement = model3dReplacementPrefix(draftId), quote = scenePreparationCyclePrefix(draftId, "model3d");
  if (keys.some(key => !key.startsWith(replacement) && !key.startsWith(quote))) return fail();
  return [model3dReplacementIndexAssertion(scope, draftId, keys.filter(key => key.startsWith(replacement))),
    sceneRenewalIndexAssertion(scope, draftId, keys.filter(key => key.startsWith(quote)), "model3d")];
}
/** Preserve exact captured scalar rows, including nulls. Only fixed internal
 * tables and D1-returned column names are accepted. No accounting writes. */
export function model3dReplacementRowAssertion(table: string, row: Row): OutputSqlAssertion {
  if (!tables.has(table) || !row || Object.getPrototypeOf(row) !== Object.prototype && Object.getPrototypeOf(row) !== null) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(row), ownKeys = Reflect.ownKeys(descriptors);
  if (!ownKeys.length || ownKeys.length > 90 || ownKeys.some(key => typeof key !== "string" || !/^[a-z][a-z0-9_]*$/u.test(key))) return fail();
  const keys = ownKeys as string[];
  if (keys.some(key => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, "value"))) return fail();
  const values = keys.map(key => descriptors[key]!.value);
  if (values.some(value => value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value)))) return fail();
  return { sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${keys.map(key => `${key} IS ?`).join(" AND ")})`, bindings: values };
}
export function model3dReplacementIndexAssertion(scope: OutputScope, draftId: string, keys: readonly string[]): OutputSqlAssertion {
  const prefix = model3dReplacementPrefix(draftId);
  if (scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || scope.contextId !== null || scope.organizationId !== null
    || scope.projectAccessId !== null || scope.key !== `personal:${scope.ownerUserId}:${scope.projectId}`
    || keys.length > 4 || new Set(keys).size !== keys.length
    || keys.some(key => !key.startsWith(prefix) || !/^[a-f0-9]{64}:(confirm|preflight|authorize|run)$/u.test(key.slice(prefix.length)))) return fail();
  if (new Set(keys.map(key => key.slice(prefix.length, prefix.length + 64))).size > 1
    || new Set(keys.map(key => key.slice(prefix.length + 65))).size !== keys.length) return fail();
  return { sql: `(SELECT COUNT(*) FROM output_commands WHERE scope_key=? AND actor_user_id=? AND substr(command_key,1,?)=?)=?
    AND NOT EXISTS(SELECT 1 FROM output_commands WHERE scope_key=? AND actor_user_id=? AND substr(command_key,1,?)=?
      AND command_key NOT IN(SELECT value FROM json_each(?)))`,
    bindings: [scope.key, scope.actorUserId, prefix.length, prefix, keys.length, scope.key, scope.actorUserId, prefix.length, prefix, JSON.stringify([...keys].sort())] };
}

/** Fresh owner/source assertions are mandatory, and must also accompany the
 * eventual command transaction. This read never calls a provider, claims a
 * lease, releases a hold, changes the parent or allocates a child. */
export async function captureModel3dReplacementParent(env: WorkerEnv, scope: OutputScope, slot: OutputOperationSlot,
  suppliedJob: DocumentJobRow, options: {
    assertions: readonly OutputSqlAssertion[];
    current: { sourceDigest: string; requirementsDigest: string; retentionExpiresAt: string };
    /** After admission only this independently authorized child may be active. */
    childJobId?: string;
    /** From the verified retained child confirmation, never a caller clock. */
    childDeadlineMs?: number;
  }) {
  if (!options.assertions.length || scope.kind !== "personal" || scope.actorUserId !== scope.ownerUserId || scope.contextId !== null
    || scope.organizationId !== null || scope.projectAccessId !== null || scope.key !== `personal:${scope.ownerUserId}:${scope.projectId}`
    || slot.attemptOrdinal !== 0 || slot.previousSlotId !== null
    || options.childJobId !== undefined && !/^model3d-[a-f0-9]{64}$/u.test(options.childJobId)) return fail();
  const queries = [
    env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=?").bind(suppliedJob.job_id, scope.ownerUserId),
    env.DB.prepare("SELECT * FROM output_operation_slots WHERE scope_key=? AND slot_id=?").bind(scope.key, slot.slotId),
    env.DB.prepare("SELECT * FROM output_execution_grants WHERE scope_key=? AND grant_id=?").bind(scope.key, slot.grantId),
    env.DB.prepare("SELECT * FROM output_provider_calls WHERE scope_key=? AND slot_id=? LIMIT 2").bind(scope.key, slot.slotId),
    env.DB.prepare("SELECT * FROM budget_reservations WHERE reservation_id=? AND owner_id=?").bind(slot.tokenReservationId, scope.ownerUserId),
    env.DB.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?").bind(slot.costReservationId, scope.ownerUserId),
  ];
  const authority = compactModel3dRecoveryAssertions(options.assertions);
  const read = await env.DB.batch<Row>([...outputProofReadStatements(env, authority), ...queries]);
  assertOutputProofRead(read.slice(0, authority.length), authority.length);
  const rows = read.slice(authority.length);
  if (rows.length !== queries.length || rows.some(row => row.success === false || row.results.length !== 1)) return fail();
  const [job, parentSlot, grant, call, token, cost] = rows.map(row => row.results[0]!);
  if (!job || !parentSlot || !grant || !call || !token || !cost || job.request_json !== suppliedJob.request_json || job.result_json !== suppliedJob.result_json
    || parentSlot.job_id !== slot.jobId || parentSlot.grant_id !== slot.grantId || parentSlot.target_id !== slot.targetId
    || parentSlot.target_contract_digest !== slot.targetContractDigest || parentSlot.source_digest !== slot.sourceDigest
    || parentSlot.plan_revision_id !== slot.planRevisionId || parentSlot.route_digest !== slot.routeDigest
    || parentSlot.cost_reservation_id !== slot.costReservationId || parentSlot.token_reservation_id !== slot.tokenReservationId
    || parentSlot.status !== "uncertain" || parentSlot.attempt_ordinal !== 0 || parentSlot.previous_slot_id !== null) return fail();
  const actualSlot = outputSlotFromRow(scope.key, parentSlot);
  if (actualSlot.maximumCalls !== slot.maximumCalls || actualSlot.maximumMicrousd !== slot.maximumMicrousd
    || actualSlot.maximumTokens !== slot.maximumTokens || actualSlot.provider !== slot.provider || actualSlot.model !== slot.model) return fail();
  const checkpoint = await captureOutputModel3dRecoveryCheckpoint({ scope, slot: actualSlot, job: { ...job, output_slot_id: slot.slotId },
    grant, calls: [call], token, cost, current: options.current });
  const metadata = JSON.parse(job.result_json as string) as Record<string, unknown>;
  const recovery = metadata.outputModel3dRecovery;
  const noRecoveryLease = recovery === undefined || recovery !== null && typeof recovery === "object" && !Array.isArray(recovery)
    && (recovery as Record<string, unknown>).version === "output-model3d-recovery-v1"
    && typeof (recovery as Record<string, unknown>).expiresAt === "string"
    && Number.isFinite(Date.parse((recovery as Record<string, unknown>).expiresAt as string))
    && Date.parse((recovery as Record<string, unknown>).expiresAt as string) <= Date.now();
  if (!model3dMayPrepareReplacement({ sourceCurrent: checkpoint.offer.preview.sourceDigest === options.current.sourceDigest,
    custodyCurrent: true, personalOwner: true, evidenceComplete: true, textOnly: checkpoint.offer.contract.reference === null,
    jobFailed: job.status === "failed", parentAttemptOrdinal: Number(parentSlot.attempt_ordinal), parentPreviousSlotId: parentSlot.previous_slot_id as string | null,
    parentSlotStatus: String(parentSlot.status), parentCallCount: rows[3]!.results.length, parentCallStatus: String(call.status),
    parentCallUsedMicrousd: call.used_microusd as number | null, parentReservedMicrousd: Number(cost.reserved_microusd),
    costReservationActive: ["active", "executing"].includes(String(cost.status)), providerAccepted: checkpoint.submission.status === "accepted",
    retainedResultCount: Object.hasOwn(metadata, "outputModel3dCompletion") ? 1 : 0, activeLeaseCount: noRecoveryLease ? 0 : 1,
    successorCount: 0, newMaximumMicrousd: 400000, newMaximumCalls: 1, now: Date.now(), retentionExpiresAt: checkpoint.expiresAt,
    childDeadlineMs: options.childDeadlineMs })) return fail();
  const assertions = rows.map((row, i) => model3dReplacementRowAssertion([...tables][i]!, row.results[0]!));
  const expectedChild = options.childJobId ?? null;
  assertions.push({ sql: `NOT EXISTS(SELECT 1 FROM output_operation_slots child
      WHERE child.scope_key=? AND child.target_id=? AND child.target_contract_digest=? AND child.slot_id<>?
        AND NOT(child.previous_slot_id IS ? AND child.attempt_ordinal IS 1 AND child.job_id IS ?))
    AND (SELECT COUNT(*) FROM output_operation_slots child WHERE child.scope_key=? AND child.previous_slot_id=?)<=?
    AND (SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=1
    AND (SELECT COUNT(*) FROM output_operation_slots WHERE scope_key=? AND grant_id=?)=1
    AND NOT EXISTS(SELECT 1 FROM events WHERE stream_id=? AND correlation_id=? AND type='DocumentRenderCompleted')
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind IN('job','document') AND resource_id IN(?,?))
    AND NOT EXISTS(SELECT 1 FROM document_jobs other WHERE other.owner_id=? AND other.document_id=?
      AND other.job_id<>? AND other.job_id IS NOT ? AND other.status IN('running','committing')
      AND other.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    bindings: [scope.key, slot.targetId, slot.targetContractDigest, slot.slotId, slot.slotId, expectedChild,
      scope.key, slot.slotId, expectedChild ? 1 : 0, scope.key, slot.slotId, scope.key, slot.grantId,
      job.stream_id, job.correlation_id, job.job_id, scope.documentId, scope.ownerUserId, scope.documentId, job.job_id, expectedChild] });
  // Exact row checks pin even expired recovery-lease data; claiming recovery
  // after this snapshot invalidates admission rather than racing another writer.
  assertions.push({ sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [checkpoint.expiresAt], deadlineMs: Date.parse(checkpoint.expiresAt) });
  const verified = compactModel3dRecoveryAssertions([...authority, ...assertions]);
  assertOutputProofRead(await env.DB.batch(outputProofReadStatements(env, verified)), verified.length);
  return { checkpoint, assertions: [...authority, ...assertions] };
}
