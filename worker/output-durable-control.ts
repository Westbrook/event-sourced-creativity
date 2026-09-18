import { readOutputDurableObservation } from "../src/model/output-durable-observation.ts";
import { outputAssertionStatements, OutputConflictError, type OutputScope, type OutputSqlAssertion } from "./output-command-core.ts";
import type { OutputOperationSlot } from "./output-requirements-ledger.ts";
import type { WorkerEnv } from "./runtime.ts";

export const OUTPUT_DURABLE_OWNER_SQL = "json_type(request_json,'$.outputDurable') IS NOT NULL";
export function outputJobIsDurable(job: { request_json: string; output_durable_owner?: number }): boolean {
  if (job.output_durable_owner) return true;
  try { return Object.hasOwn(JSON.parse(job.request_json), "outputDurable"); } catch { return false; }
}
export type OutputDurableDelivery = Readonly<{ version: 1; jobId: string }>;
export type OutputDurableMedia = "image"|"slides"|"short_story"|"scene"|"storyboard"|"audio"|"video"|"model3d";
type Registration = { media:readonly OutputDurableMedia[];database: D1Database; wake: (delivery: OutputDurableDelivery) => Promise<void> };
const runtimes = new WeakMap<WorkerEnv, Registration>();
type Lease = { jobId: string; deadline: number; assertion: OutputSqlAssertion; active: () => boolean };
const leases = new WeakMap<WorkerEnv, Lease>();

/** Internal factory seam. Never register the original request environment. */
export function registerOutputDurableRuntime(env: WorkerEnv, wake: Registration["wake"], media:readonly OutputDurableMedia[]) {
  if (runtimes.has(env)) throw new OutputConflictError("output_durable_runtime_already_registered");
  runtimes.set(env, { database: env.DB, wake, media:Object.freeze([...media]) });
}
export function outputDurableRuntimeAvailable(env: WorkerEnv): boolean {
  return runtimes.get(env)?.database === env.DB;
}
export function registerOutputDurableLease(env: WorkerEnv, lease: Lease) { leases.set(env, lease); }
export function assertOutputDurableLease(env: WorkerEnv, jobId: string): void {
  const lease = leases.get(env);
  if (!lease || lease.jobId !== jobId || !lease.active() || Date.now() >= lease.deadline)
    throw new OutputConflictError("output_durable_lease_required", 409);
}
export function outputDurableFence(env: WorkerEnv, jobId: string): OutputSqlAssertion | null {
  if (!leases.has(env)) return null;
  assertOutputDurableLease(env, jobId);
  return structuredClone(leases.get(env)!.assertion);
}

/** Bound advisory delivery independently of the transport. A timeout leaves
 * the row due; any late delivery is harmless under the consumer's lease. */
export async function hintOutputDurableDelivery(wake: Registration["wake"], delivery: OutputDurableDelivery): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => wake(Object.freeze({ ...delivery }))).then(() => true, () => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 1000); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A delivery hint is not the delivery guarantee. The future runtime must also
 * sweep committed due rows. Failure here must not undo the committed Run. */
export async function wakeOutputDurableJobs(env: WorkerEnv, slots: readonly OutputOperationSlot[]): Promise<boolean> {
  const runtime = runtimes.get(env);
  if (!runtime || runtime.database !== env.DB) return false;
  await Promise.all(slots.map(slot => hintOutputDurableDelivery(runtime.wake, { version: 1, jobId: slot.jobId })));
  return true;
}

/** Appended inside the existing Run command transaction. Authorization alone
 * creates no outbox and no delivery. Replay may only match the original row. */
export function prepareOutputDurableRun(env: WorkerEnv, scope: OutputScope, slots: readonly OutputOperationSlot[], runEventId: string) {
  if (!outputDurableRuntimeAvailable(env)) return { statements: [] as D1PreparedStatement[], assertions: [] as OutputSqlAssertion[] };
  if (scope.kind !== "personal" || scope.ownerUserId !== scope.actorUserId || scope.contextId)
    throw new OutputConflictError("output_durable_scope_unsupported", 403);
  const statements: D1PreparedStatement[] = [], assertions: OutputSqlAssertion[] = [];
  const now = new Date().toISOString();
  for (const slot of slots) {
    if (slot.attemptOrdinal !== 0 || slot.previousSlotId !== null) throw new OutputConflictError("output_durable_attempt_unsupported", 403);
    const identity: OutputSqlAssertion = { sql: `EXISTS(SELECT 1 FROM output_durable_jobs durable
      JOIN document_jobs job ON job.job_id=durable.job_id
      JOIN output_operation_slots slot ON slot.scope_key=durable.scope_key AND slot.slot_id=durable.slot_id
      JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      WHERE durable.job_id=? AND durable.scope_key=? AND durable.slot_id=? AND durable.grant_id=?
        AND durable.actor_user_id=? AND durable.stream_id=? AND durable.document_id=?
        AND durable.route_digest=? AND durable.source_digest=? AND durable.target_contract_digest=?
        AND job.owner_id=durable.actor_user_id AND job.stream_id=durable.stream_id AND job.document_id=durable.document_id
        AND slot.job_id=job.job_id AND slot.route_digest=durable.route_digest AND slot.source_digest=durable.source_digest
        AND slot.target_contract_digest=durable.target_contract_digest AND grant_row.payer_user_id=grant_row.actor_user_id
        AND grant_row.actor_user_id=durable.actor_user_id AND json_extract(job.request_json,'$.outputDurable')=1)`,
      bindings: [slot.jobId, scope.key, slot.slotId, slot.grantId, scope.actorUserId, `creative:${scope.ownerUserId}`, scope.documentId, slot.routeDigest, slot.sourceDigest, slot.targetContractDigest] };
    // No adoption of already-started legacy work and no sponsored execution.
    statements.push(env.DB.prepare(`INSERT INTO output_durable_jobs(job_id,scope_key,slot_id,grant_id,actor_user_id,stream_id,document_id,run_event_id,
      route_digest,source_digest,target_contract_digest,phase,next_attempt_at,created_at,updated_at)
      SELECT job.job_id,slot.scope_key,slot.slot_id,slot.grant_id,job.owner_id,job.stream_id,job.document_id,?,slot.route_digest,slot.source_digest,slot.target_contract_digest,'queued',?,?,?
      FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
      JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
      JOIN event_private_payloads authorization ON authorization.private_event_id=grant_row.authorization_event_id
      WHERE job.job_id=? AND slot.scope_key=? AND slot.slot_id=? AND job.owner_id=? AND job.document_id=?
        AND job.status='queued' AND job.attempt_count=0 AND job.source_surface='outputs'
        AND (CASE WHEN job.kind='generate' THEN 'image' WHEN job.kind='render_document' THEN json_extract(job.request_json,'$.artifactKind') END) IN(SELECT value FROM json_each(?))
        AND grant_row.actor_user_id=job.owner_id AND grant_row.payer_user_id=job.owner_id
        AND json_type(authorization.private_json,'$.output_command_envelope.sponsor_entitlement') IS NULL
        AND NOT EXISTS(SELECT 1 FROM output_provider_calls paid WHERE paid.scope_key=slot.scope_key AND paid.slot_id=slot.slot_id)
      ON CONFLICT(job_id) DO NOTHING`).bind(runEventId, now, now, now, slot.jobId, scope.key, slot.slotId, scope.actorUserId, scope.documentId,JSON.stringify(runtimes.get(env)!.media)));
    statements.push(env.DB.prepare(`UPDATE document_jobs SET request_json=json_set(request_json,'$.outputDurable',1)
      WHERE job_id=? AND owner_id=? AND EXISTS(SELECT 1 FROM output_durable_jobs durable WHERE durable.job_id=document_jobs.job_id AND durable.scope_key=? AND durable.slot_id=?)
        AND json_type(request_json,'$.outputDurable') IS NULL`).bind(slot.jobId, scope.actorUserId, scope.key, slot.slotId));
    assertions.push(identity, { sql: `EXISTS(SELECT 1 FROM events run JOIN event_private_payloads body ON body.private_event_id=run.event_id
      WHERE run.event_id=? AND run.type='OutputExecutionRunRequested' AND run.stream_id=? AND run.actor=? AND run.client_id='server:output-requirements'
        AND body.owner_id=? AND body.document_id=? AND body.redacted_at IS NULL
        AND json_extract(body.private_json,'$.grant_id')=? AND json_extract(body.private_json,'$.existing_jobs_only')=1
        AND EXISTS(SELECT 1 FROM json_each(body.private_json,'$.job_ids') id WHERE id.value=?))`,
      bindings: [runEventId, `creative:${scope.ownerUserId}`, `user:${scope.actorUserId}`, scope.ownerUserId, scope.documentId, slot.grantId, slot.jobId] });
  }
  return { statements, assertions };
}

export async function requireOutputDurableBinding(env: WorkerEnv, jobId: string): Promise<void> {
  assertOutputDurableLease(env, jobId);
  const assertion = outputDurableFence(env, jobId)!;
  await env.DB.batch(outputAssertionStatements(env, assertion));
}

/** Read-only projection; routing remains restricted when the runtime is absent. */
export async function readOutputDurableOwnership(env: WorkerEnv, job: { job_id: string; request_json: string }) {
  if (!outputJobIsDurable(job)) return {};
  const row = await env.DB.prepare("SELECT phase,revision FROM output_durable_jobs WHERE job_id=?").bind(job.job_id).first<{ phase: string; revision: number }>();
  const observation = row && readOutputDurableObservation({ version: 1, phase: row.phase, revision: row.revision });
  if (!observation) throw new OutputConflictError("output_durable_observation_unavailable");
  return { executionOwner: "durable" as const, observation };
}
