import type { WorkerEnv } from "./runtime.ts";
import { configuredPilotAdmissionGuard, type PilotUser } from "./pilot-policy.ts";
import { holdAdministratorAuthority, holdHash } from "./budget-hold-dispositions.ts";
import { acquireGenerationAccounting } from "./generation-accounting-preview.ts";
import { outputAssertionStatements, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { videoReconciliationSchemaProof } from "./managed-video-reconciliation-schema.ts";

type Row = Record<string, string | number | null>;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export class VideoReconciliationError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code: string, status = 409): never => { throw new VideoReconciliationError(code, status); };
const rowProof = (table: string, row: Row): OutputSqlAssertion => ({
  sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${Object.keys(row).map(key => `${key} IS ?`).join(" AND ")})`, bindings: Object.values(row),
});

/** One authorized historical exception, not a generic price override or refund API. */
export const VIDEO_TREATMENT = Object.freeze({
  version: 1, id: "forma-video-reconciliation-20260911-01a040b4",
  jobId: "01a040b4-5c90-7ba3-aff1-7af8227dad00", attempt: 1,
  documentId: "80ad2760-79fb-4f00-9414-9c0376d2b2b7",
  tokenReservationId: "01a040b4-6604-7f3e-bbe8-efbc0f051d55",
  costReservationId: "01a040b4-6687-758f-a25f-322811e8294d", period: "2026-08",
  plannerId: "resp_0ec6442c224deaac016a8f8a5a2cb487d28b0b8f400e2be9a5",
  plannerModel: "gpt-5.6-terra", anchorModel: "ideogram/v4",
  anchorId: "01a040b4-d705-70d1-a08e-2d5273ec9f70",
  videoId: "01a040b5-1cc3-7522-a31f-b26787727a47",
  videoModel: "bytedance/seedance-2.0/reference-to-video", sceneId: "scene-003",
  reservedTokens: 152000, reservedMicrousd: 19644000,
  plannerInputTokens: 13230, plannerOutputTokens: 2350, plannerMicrousd: 54660, anchorMicrousd: 43824,
  usedTokens: 15580, usedMicrousd: 98484, unusedTokens: 136420, unusedMicrousd: 19545516,
  kind: "operator_adjudicated_zero", videoMicrousd: 0, providerVerified: false,
  screenshotSha256: "0a536135179f05a898c7295ca20dbcb871203058a0b47f2e26f3b8c95bda446a",
  screenshotBytes: 218556, screenshotDisplayedCost: "$0.00", httpStatus: 422, usableClips: 0,
  approvalRef: "codex:01a03eaa-d5b7-7630-943d-7105f7a3067b:report708",
  approvalText: "I authorize this treatment.",
  approvedTreatment: "Treat the exact failed Fal video as zero by operator adjudication from the retained screenshot, not independently provider-verified billing. Account for 98484 microUSD and 15580 preparation tokens. Restore 19545516 microUSD and 136420 unused tokens from the original August reservation only if fresh ownership, counters and supported prior-use checks match. No refund, new spend, current-month reset, budget-limit increase, provider retry or broad financial repair. Stop before mutation for any conflict or different amount.",
});
export const VIDEO_RECONCILIATION_ACK = "Apply the authorized August correction; video zero is operator-adjudicated, not provider-verified";
export type VideoReconciliationCommand = {
  treatmentId: string; treatmentSha256: string; snapshotSha256: string; evidenceSha256: string; acknowledgement: string;
};
export function validateVideoReconciliationCommand(value: unknown): VideoReconciliationCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("reconciliation_explicit_command_required", 400);
  const v = value as VideoReconciliationCommand;
  if (Object.keys(v).sort().join(",") !== "acknowledgement,evidenceSha256,snapshotSha256,treatmentId,treatmentSha256"
    || v.treatmentId !== VIDEO_TREATMENT.id || v.acknowledgement !== VIDEO_RECONCILIATION_ACK
    || ![v.treatmentSha256, v.snapshotSha256, v.evidenceSha256].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)))
    return fail("reconciliation_explicit_command_required", 400);
  return v;
}

async function authority(env: WorkerEnv, actor: PilotUser) {
  if (actor.fictional || actor.projectExecution || actor.billingUserId && actor.billingUserId !== actor.userId)
    return fail("reconciliation_principal_owner_required", 403);
  const auth = holdAdministratorAuthority(actor), admission = configuredPilotAdmissionGuard(env, actor), schema = videoReconciliationSchemaProof();
  if (!await env.DB.prepare("SELECT 1 AS ready WHERE " + schema.sql).bind(...schema.bindings).first()) {
    // Only fixed schema object names and match flags: never log source rows,
    // request bodies, identities, credentials or the stored SQL itself.
    try {
      const names = schema.bindings.filter((_, index) => index % 2 === 0);
      const rows = await env.DB.prepare(`SELECT name,sql FROM sqlite_schema WHERE name IN(${names.map(() => "?").join(",")})`).bind(...names).all<{ name: string; sql: string }>();
      console.error("video_reconciliation_schema_not_ready", names.map((name, index) => ({ name,
        present: rows.results.some(row => row.name === name),
        matches: rows.results.some(row => row.name === name && row.sql === schema.bindings[index * 2 + 1]) })));
    } catch { console.error("video_reconciliation_schema_diagnostic_unavailable"); }
    return fail("reconciliation_schema_not_ready", 503);
  }
  if (!await env.DB.prepare("SELECT 1 AS ok WHERE " + auth.sql + " AND " + admission.sql).bind(...auth.bindings!, ...admission.bindings!).first())
    return fail("reconciliation_authority_changed", 403);
  return [schema, auth, admission];
}
const exactScope = (actor: PilotUser): OutputSqlAssertion => ({
  sql: `EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND output_slot_id IS NULL AND lease_expires_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND NOT EXISTS(SELECT 1 FROM managed_video_reconciliations WHERE job_id=? OR token_reservation_id=? OR cost_reservation_id=?)`,
  bindings: [VIDEO_TREATMENT.jobId, actor.userId, actor.streamId, VIDEO_TREATMENT.jobId, VIDEO_TREATMENT.tokenReservationId, VIDEO_TREATMENT.costReservationId],
});

async function snapshot(env: WorkerEnv, actor: PilotUser) {
  const captured = await acquireGenerationAccounting(env, actor, VIDEO_TREATMENT.jobId);
  const { preview: p, before: s } = captured, t = VIDEO_TREATMENT;
  const arithmetic = p.acquisition.conditionalArithmetic;
  const planner = p.calls.find(c => c.operation === "planning"), anchor = p.calls.find(c => c.operation === "image"), video = p.calls.find(c => c.operation === "video");
  if (p.job.documentId !== t.documentId || p.job.status !== "failed" || p.job.attemptCount !== t.attempt
    || p.job.correlationId !== t.jobId + ":attempt:1" || p.reservations.period !== t.period
    || s.token.reservation_id !== t.tokenReservationId || s.cost.reservation_id !== t.costReservationId
    || s.token.status !== "active" || s.cost.status !== "executing" || s.token.used_tokens !== 0 || s.cost.used_microusd !== 0
    || s.token.reserved_tokens !== t.reservedTokens || s.cost.reserved_microusd !== t.reservedMicrousd
    || p.calls.length !== 3 || planner?.providerRequestId !== t.plannerId || anchor?.providerRequestId !== t.anchorId || video?.providerRequestId !== t.videoId
    || planner.model !== t.plannerModel || anchor.model !== t.anchorModel
    || planner.costMicrousd !== t.plannerMicrousd || anchor.costMicrousd !== t.anchorMicrousd
    || planner.inputTokens !== t.plannerInputTokens || planner.outputTokens !== t.plannerOutputTokens || planner.totalTokens !== t.usedTokens
    || video.model !== t.videoModel || video.unitId !== "scene:" + t.sceneId || video.status !== "accepted" || video.costMicrousd !== null
    || p.acquisition.unresolvedReasons.join(",") !== "external_billing_adjudication_not_acquired"
    || p.acquisition.plannerRefusalReasons.length || p.acquisition.priorUsage.rowsRead !== 0
    || !arithmetic || arithmetic.hypotheticalTotalMicrousd !== t.usedMicrousd || arithmetic.hypotheticalTotalTokens !== t.usedTokens
    || arithmetic.hypotheticalUnusedMicrousd !== t.unusedMicrousd || arithmetic.hypotheticalUnusedTokens !== t.unusedTokens)
    return fail("reconciliation_treatment_conflict");
  // The existing planner validates the full supported three-call/media slice.
  // Also pin the original reservation audit and definitive failure, not just labels.
  if (s.audits.length !== 1 || s.audits[0].type !== "BudgetReserved") return fail("reconciliation_prior_accounting_conflict");
  const reserved = JSON.parse(String(s.audits[0].payload)) as Record<string, unknown>;
  if (reserved.period !== t.period || reserved.operation !== "document-render:video"
    || reserved.reservation_id !== t.tokenReservationId || reserved.cost_reservation_id !== t.costReservationId
    || reserved.reserved_tokens !== t.reservedTokens || reserved.reserved_microusd !== t.reservedMicrousd)
    return fail("reconciliation_reservation_audit_conflict");
  const failure = await env.DB.prepare("SELECT event_id,stream_id,correlation_id,type,payload,occurred_at FROM events WHERE event_id=? AND stream_id=? AND correlation_id=? AND type='DocumentRenderFailed' AND length(payload)<=65536")
    .bind("01a040b8-a890-7be6-9f26-a5fa670e3179", actor.streamId, p.job.correlationId).first<Row>();
  if (!failure) return fail("reconciliation_failure_evidence_unavailable");
  const error = JSON.parse(String(failure.payload)) as Record<string, unknown>;
  if (error.http_status !== 422 || error.provider_request_id !== t.videoId || error.error_code !== "fal_content_policy_violation" || error.retryable !== false)
    return fail("reconciliation_failure_evidence_conflict");
  const scope = exactScope(actor);
  if (!await env.DB.prepare("SELECT 1 AS ok WHERE " + scope.sql).bind(...scope.bindings!).first()) return fail("reconciliation_scope_conflict");
  for (const [rows, unit, used] of [[s.tokenCounters, "tokens", t.usedTokens], [s.costCounters, "microusd", t.usedMicrousd]] as const)
    if (rows.some(row => !integer(Number(row["used_" + unit]) + used))) return fail("reconciliation_counter_overflow");
  return { ...captured, failure, scope };
}

const existing = (env: WorkerEnv, actor: PilotUser) => env.DB.prepare("SELECT * FROM managed_video_reconciliations WHERE reconciliation_id=? AND operator_id=?")
  .bind(VIDEO_TREATMENT.id, actor.userId).first<Row>();

export async function previewManagedVideoReconciliation(env: WorkerEnv, actor: PilotUser) {
  await authority(env, actor);
  if (await existing(env, actor)) return { verification: await verifyManagedVideoReconciliation(env, actor) };
  const { preview } = await snapshot(env, actor);
  return { preview: { treatment: VIDEO_TREATMENT, treatmentSha256: await holdHash(VIDEO_TREATMENT),
    snapshotSha256: preview.snapshotSha256, evidenceSha256: preview.acquisition.evidenceSha256,
    ownerId: actor.userId, counters: preview.counters, acknowledgement: VIDEO_RECONCILIATION_ACK,
    providerCalls: 0, ledgerWrites: 0, mutationAvailable: true } };
}

function afterCounters(rows: Row[], unit: "tokens" | "microusd", reserved: number, used: number, now: string) {
  return rows.map(row => ({ ...row, ["reserved_" + unit]: Number(row["reserved_" + unit]) - reserved,
    ["used_" + unit]: Number(row["used_" + unit]) + used, updated_at: now }));
}
function usageEvents(actor: PilotUser, correlation: string, now: string) {
  const t = VIDEO_TREATMENT;
  const common = { reconciliation_id: t.id, job_id: t.jobId, operation: "document-render:video", period: t.period,
    reservation_id: t.tokenReservationId, cost_reservation_id: t.costReservationId, accounting_basis: "operator_reconciliation" };
  const values = [
    { suffix: "planner", type: "GenerationUsageRecorded", payload: { ...common, provider: "openai", model: t.plannerModel,
      planner_response_id: t.plannerId, planner_cost_microusd: t.plannerMicrousd, cost_microusd: t.plannerMicrousd,
      input_tokens: t.plannerInputTokens, output_tokens: t.plannerOutputTokens, total_tokens: t.usedTokens, planner_tokens: t.usedTokens } },
    { suffix: "anchor", type: "GenerationUsageRecorded", payload: { ...common, provider: "fal", model: t.anchorModel,
      provider_job_id: t.anchorId, cost_microusd: t.anchorMicrousd, input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
    { suffix: "video", type: "GenerationUsageRecorded", payload: { ...common, provider: "fal", model: t.videoModel,
      provider_job_id: t.videoId, cost_microusd: 0, video_cost_microusd: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0,
      token_basis: "non_token_metered_video_adapter", billing_basis: t.kind, provider_billing_verified: false } },
    { suffix: "release", type: "BudgetReleased", payload: { ...common, reserved_tokens: t.reservedTokens, reserved_microusd: t.reservedMicrousd,
      used_tokens: t.usedTokens, used_microusd: t.usedMicrousd, released_tokens: t.unusedTokens, released_microusd: t.unusedMicrousd } },
  ];
  return values.map(value => ({ event_id: t.id + ":" + value.suffix, stream_id: actor.streamId, correlation_id: correlation,
    type: value.type, payload: JSON.stringify(value.payload), occurred_at: now }));
}

export async function applyManagedVideoReconciliation(env: WorkerEnv, actor: PilotUser, input: unknown) {
  const command = validateVideoReconciliationCommand(input), proofs = await authority(env, actor);
  const t = VIDEO_TREATMENT, treatmentSha256 = await holdHash(t);
  if (command.treatmentSha256 !== treatmentSha256) return fail("reconciliation_treatment_changed");
  const commandSha256 = await holdHash({ actor: actor.userId, command });
  const prior = await existing(env, actor);
  if (prior) {
    if (prior.command_sha256 !== commandSha256) return fail("reconciliation_command_conflict");
    return { applied: false, replayed: true, verification: await verifyManagedVideoReconciliation(env, actor) };
  }
  const s = await snapshot(env, actor), p = s.preview, before = s.before;
  if (p.snapshotSha256 !== command.snapshotSha256 || p.acquisition.evidenceSha256 !== command.evidenceSha256) return fail("reconciliation_preview_changed");
  const now = new Date().toISOString();
  const after = {
    token: { ...before.token, status: "settled", used_tokens: t.usedTokens, settlement_reason: "operator:" + t.id, settled_at: now, updated_at: now },
    cost: { ...before.cost, status: "settled", used_microusd: t.usedMicrousd, settled_at: now, updated_at: now },
    tokenCounters: afterCounters(before.tokenCounters, "tokens", t.reservedTokens, t.usedTokens, now),
    costCounters: afterCounters(before.costCounters, "microusd", t.reservedMicrousd, t.usedMicrousd, now),
  };
  const events = usageEvents(actor, String(before.job.correlation_id), now);
  const record = { version: 1, treatment: t, treatmentSha256, operatorId: actor.userId, command, commandSha256, createdAt: now,
    job: p.job, calls: p.calls, retainedMedia: p.retainedMedia, acquisition: p.acquisition,
    failureSha256: await holdHash(s.failure), originalAuditsSha256: await holdHash(before.audits),
    before: { token: before.token, cost: before.cost, tokenCounters: before.tokenCounters, costCounters: before.costCounters },
    after, events, providerCalls: 0, providerVerified: false };
  const recordJson = JSON.stringify(record), recordSha256 = await holdHash(record);
  proofs.push(s.scope, ...s.collectionProofs, rowProof("document_jobs", before.job), rowProof("events", s.failure),
    ...before.audits.map(row => rowProof("events", row)), rowProof("budget_reservations", before.token), rowProof("cost_budget_reservations", before.cost),
    ...before.tokenCounters.map(row => rowProof("budget_counters", row)), ...before.costCounters.map(row => rowProof("cost_budget_counters", row)));
  const assert = (proof: OutputSqlAssertion) => outputAssertionStatements(env, proof);
  const statements = proofs.flatMap(assert);
  const write = (statement: D1PreparedStatement) => statements.push(statement, ...assert({ sql: "changes()=1" }));
  for (const [rows, table, unit, reserved, used] of [
    [before.tokenCounters, "budget_counters", "tokens", t.reservedTokens, t.usedTokens],
    [before.costCounters, "cost_budget_counters", "microusd", t.reservedMicrousd, t.usedMicrousd],
  ] as const) for (const row of rows)
    write(env.DB.prepare(`UPDATE ${table} SET reserved_${unit}=reserved_${unit}-?,used_${unit}=used_${unit}+?,updated_at=? WHERE scope=? AND scope_id=? AND period=?`)
      .bind(reserved, used, now, row.scope, row.scope_id, row.period));
  write(env.DB.prepare("UPDATE budget_reservations SET status='settled',used_tokens=?,settlement_reason=?,settled_at=?,updated_at=? WHERE reservation_id=?")
    .bind(t.usedTokens, after.token.settlement_reason, now, now, t.tokenReservationId));
  write(env.DB.prepare("UPDATE cost_budget_reservations SET status='settled',used_microusd=?,settled_at=?,updated_at=? WHERE reservation_id=?")
    .bind(t.usedMicrousd, now, now, t.costReservationId));
  write(env.DB.prepare("INSERT INTO managed_video_reconciliations(reconciliation_id,operator_id,job_id,correlation_id,token_reservation_id,cost_reservation_id,command_sha256,treatment_sha256,record_sha256,record_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind(t.id, actor.userId, t.jobId, before.job.correlation_id, t.tokenReservationId, t.costReservationId, commandSha256, treatmentSha256, recordSha256, recordJson, now));
  for (const event of events) {
    write(env.DB.prepare("INSERT INTO event_write_stage(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload,owner_id) SELECT ?,?,COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)+1,?,?,?,?,?,1,?,?,?")
      .bind(event.event_id, actor.streamId, actor.streamId, now, now, actor.userId, "server:video-reconciliation", before.job.correlation_id, event.type, event.payload, actor.userId));
    statements.push(...assert(rowProof("events", event)));
  }
  const durableRow = { reconciliation_id: t.id, operator_id: actor.userId, job_id: t.jobId, correlation_id: before.job.correlation_id,
    token_reservation_id: t.tokenReservationId, cost_reservation_id: t.costReservationId, command_sha256: commandSha256,
    treatment_sha256: treatmentSha256, record_sha256: recordSha256, record_json: recordJson, created_at: now };
  statements.push(...assert(rowProof("managed_video_reconciliations", durableRow)),
    ...assert(rowProof("budget_reservations", after.token)), ...assert(rowProof("cost_budget_reservations", after.cost)),
    ...after.tokenCounters.flatMap(row => assert(rowProof("budget_counters", row))), ...after.costCounters.flatMap(row => assert(rowProof("cost_budget_counters", row))),
    ...assert(rowProof("document_jobs", before.job)));
  try {
    const result = await env.DB.batch(statements);
    if (result.some(row => !row.success)) throw new Error("Unsuccessful atomic batch");
  } catch {
    // A lost acknowledgement is not permission to create a new operation.
    const durable = await existing(env, actor);
    if (!durable || durable.command_sha256 !== commandSha256) return fail("reconciliation_write_conflict");
    return { applied: false, replayed: true, verification: await verifyManagedVideoReconciliation(env, actor) };
  }
  return { applied: true, replayed: false, verification: await verifyManagedVideoReconciliation(env, actor) };
}

export async function verifyManagedVideoReconciliation(env: WorkerEnv, actor: PilotUser) {
  await authority(env, actor);
  const row = await existing(env, actor);
  if (!row) return { found: false, verified: false, treatmentId: VIDEO_TREATMENT.id };
  const record = JSON.parse(String(row.record_json)) as ReconciliationRecord;
  if (row.record_sha256 !== await holdHash(record) || row.treatment_sha256 !== await holdHash(VIDEO_TREATMENT)
    || record.treatmentSha256 !== row.treatment_sha256 || await holdHash(record.treatment) !== row.treatment_sha256
    || record.operatorId !== actor.userId || record.commandSha256 !== row.command_sha256
    || await holdHash({ actor: actor.userId, command: validateVideoReconciliationCommand(record.command) }) !== row.command_sha256
    || row.job_id !== VIDEO_TREATMENT.jobId || row.correlation_id !== VIDEO_TREATMENT.jobId + ":attempt:1"
    || row.token_reservation_id !== VIDEO_TREATMENT.tokenReservationId || row.cost_reservation_id !== VIDEO_TREATMENT.costReservationId
    || row.created_at !== record.createdAt || record.events.length !== 4)
    return fail("reconciliation_record_conflict");
  const expectedEvents = usageEvents(actor, String(row.correlation_id), record.createdAt);
  if (await holdHash(record.events) !== await holdHash(expectedEvents)) return fail("reconciliation_audit_conflict");
  const t = VIDEO_TREATMENT, b = record.before;
  if (b.token.owner_id !== actor.userId || b.cost.owner_id !== actor.userId || b.token.stream_id !== actor.streamId || b.cost.stream_id !== actor.streamId
    || b.token.reservation_id !== t.tokenReservationId || b.cost.reservation_id !== t.costReservationId
    || b.token.period !== t.period || b.cost.period !== t.period || b.cost.workspace_id !== "forma"
    || b.token.status !== "active" || b.cost.status !== "executing" || b.token.used_tokens !== 0 || b.cost.used_microusd !== 0
    || b.token.reserved_tokens !== t.reservedTokens || b.cost.reserved_microusd !== t.reservedMicrousd)
    return fail("reconciliation_before_state_conflict");
  for (const [rows, unit, reserved, used] of [[b.tokenCounters, "tokens", t.reservedTokens, t.usedTokens], [b.costCounters, "microusd", t.reservedMicrousd, t.usedMicrousd]] as const)
    if (!Array.isArray(rows) || rows.length !== 2 || new Set(rows.map(counter => counter.scope)).size !== 2
      || rows.some(counter => counter.period !== t.period || !(counter.scope === "user" && counter.scope_id === actor.userId || counter.scope === "workspace" && counter.scope_id === "forma")
        || ![counter["used_" + unit], counter["reserved_" + unit], counter["hard_limit_" + unit]].every(integer)
        || Number(counter["reserved_" + unit]) < reserved || !integer(Number(counter["used_" + unit]) + used)))
      return fail("reconciliation_counter_evidence_conflict");
  const expectedAfter = {
    token: { ...b.token, status: "settled", used_tokens: t.usedTokens, settlement_reason: "operator:" + t.id, settled_at: record.createdAt, updated_at: record.createdAt },
    cost: { ...b.cost, status: "settled", used_microusd: t.usedMicrousd, settled_at: record.createdAt, updated_at: record.createdAt },
    tokenCounters: afterCounters(b.tokenCounters, "tokens", t.reservedTokens, t.usedTokens, record.createdAt),
    costCounters: afterCounters(b.costCounters, "microusd", t.reservedMicrousd, t.usedMicrousd, record.createdAt),
  };
  if (await holdHash(expectedAfter) !== await holdHash(record.after)) return fail("reconciliation_conservation_failed");
  const checks = [
    rowProof("budget_reservations", record.after.token), rowProof("cost_budget_reservations", record.after.cost),
    ...expectedEvents.map(event => rowProof("events", event)),
  ];
  const results = await env.DB.batch(checks.map(proof => env.DB.prepare("SELECT 1 AS ok WHERE " + proof.sql).bind(...proof.bindings!)));
  if (results.some(result => !result.success || result.results.length !== 1)) return fail("reconciliation_verification_failed");
  const current = await acquireGenerationAccounting(env, actor, t.jobId);
  const failure = await env.DB.prepare("SELECT event_id,stream_id,correlation_id,type,payload,occurred_at FROM events WHERE event_id=? AND stream_id=?")
    .bind("01a040b8-a890-7be6-9f26-a5fa670e3179", actor.streamId).first<Row>();
  const eventIds = new Set(expectedEvents.map(event => event.event_id));
  const drift: string[] = [];
  if (await holdHash(current.preview.job) !== await holdHash(record.job)
    || await holdHash(current.preview.calls) !== await holdHash(record.calls)
    || await holdHash(current.preview.retainedMedia) !== await holdHash(record.retainedMedia)
    || !failure || await holdHash(failure) !== record.failureSha256) drift.push("original_evidence_changed");
  if (await holdHash(current.before.audits.filter(event => !eventIds.has(String(event.event_id)))) !== record.originalAuditsSha256
    || current.before.priorUsage.length !== 4 || current.before.priorUsage.some(event => !eventIds.has(String(event.event_id))))
    drift.push("additional_accounting_requires_review");
  if (!await env.DB.prepare("SELECT 1 AS ok FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND output_slot_id IS NULL")
    .bind(t.jobId, actor.userId, actor.streamId).first()) drift.push("job_scope_changed");
  const countersUnchanged = await holdHash(current.before.tokenCounters) === await holdHash(record.after.tokenCounters)
    && await holdHash(current.before.costCounters) === await holdHash(record.after.costCounters);
  if (!countersUnchanged) drift.push("counters_changed_since_transaction");
  return { found: true, transactionVerified: true, verified: drift.length === 0, requiresReview: drift.length > 0, reviewReasons: drift,
    treatmentId: VIDEO_TREATMENT.id, recordSha256: row.record_sha256,
    createdAt: record.createdAt, treatment: VIDEO_TREATMENT, providerVerified: false,
    currentCounters: countersUnchanged ? "match_recorded_after_state" : "changed_since_transaction",
    record };
}

type ReconciliationRecord = {
    treatment: typeof VIDEO_TREATMENT; treatmentSha256: string; operatorId: string; command: VideoReconciliationCommand;
    commandSha256: string; createdAt: string; events: Row[];
    job: unknown; calls: unknown; retainedMedia: unknown; failureSha256: string; originalAuditsSha256: string;
    before: { token: Row; cost: Row; tokenCounters: Row[]; costCounters: Row[] };
    after: { token: Row; cost: Row; tokenCounters: Row[]; costCounters: Row[] };
};
