import type { WorkerEnv } from "./runtime.ts";
import type { PilotUser } from "./pilot-policy.ts";

type Row = Record<string, string | number | null>;
type DB = Pick<WorkerEnv, "DB">;
export class GenerationAccountingPreviewError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code: string, status = 409): never => { throw new GenerationAccountingPreviewError(code, status); };
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
const json = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "string" || value.length > 2_097_152) return fail("accounting_retained_evidence_unavailable");
  try { const decoded: unknown = JSON.parse(value); if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) return decoded as Record<string, unknown>; } catch { /* fail closed */ }
  return fail("accounting_retained_evidence_unavailable");
};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)])) : value;
const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(value))))))
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
const JOB_COLUMNS = "job_id,owner_id,stream_id,document_id,kind,status,correlation_id,request_json,result_json,attempt_count,started_at,completed_at,lease_expires_at,expires_at,updated_at";
const scopeSQL = `SELECT CASE WHEN
  EXISTS(SELECT 1 FROM project_resource_scopes WHERE (resource_kind='job' AND resource_id=?) OR (resource_kind='document' AND resource_id=?))
  OR EXISTS(SELECT 1 FROM project_budget_reservation_scopes WHERE reservation_id IN(?,?))
  OR EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes WHERE reservation_id=?)
  OR EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=? OR token_reservation_id=? OR cost_reservation_id=?)
  OR EXISTS(SELECT 1 FROM consequential_execution_steps WHERE token_reservation_id=? OR cost_reservation_id=?)
  OR EXISTS(SELECT 1 FROM budget_hold_dispositions WHERE job_id=? OR token_reservation_id=? OR cost_reservation_id=?)
  THEN 1 ELSE 0 END AS conflict`;
const auditAmounts = ["reserved_tokens", "used_tokens", "released_tokens", "total_tokens", "planner_tokens", "reserved_microusd", "used_microusd", "released_microusd", "cost_microusd", "planner_cost_microusd", "video_cost_microusd"] as const;

/** Exact-job diagnostics only: every statement is SELECT. Never settle, repair, initialize or contact a provider. */
export async function previewGenerationAccounting(env: DB, actor: PilotUser, jobId: string, now = Date.now()) {
  if (!id(jobId)) return fail("accounting_job_id_required", 400);
  if (actor.role !== "admin" || actor.streamId !== `creative:${actor.userId}` || actor.fictional || actor.projectExecution
    || actor.billingUserId && actor.billingUserId !== actor.userId || !actor.authorizationSnapshot || actor.access.identityPolicyDeniedCustody) return fail("accounting_principal_administrator_required", 403);
  const job = await env.DB.prepare(`SELECT ${JOB_COLUMNS} FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=?
    AND length(request_json)<=2097152 AND length(result_json)<=2097152 LIMIT 1`).bind(jobId, actor.userId, actor.streamId).first<Row>();
  if (!job) return fail("accounting_job_not_found", 404);
  const request = json(job.request_json), checkpoint = json(job.result_json);
  if (job.kind !== "render_document" || request.artifactKind !== "video" || request.productionMode !== "managed"
    || !["failed", "canceled"].includes(String(job.status)) || job.lease_expires_at !== null
    || !job.completed_at || !Number.isFinite(Date.parse(String(job.completed_at))) || !(Date.parse(String(job.expires_at)) > now)
    || !id(job.document_id) || !id(job.correlation_id) || !integer(job.attempt_count)) return fail("accounting_terminal_personal_managed_video_required");
  const tokenId = checkpoint.reservationId, costId = checkpoint.costReservationId;
  if (!id(tokenId) || !id(costId) || tokenId === costId) return fail("accounting_exact_reservations_required");
  const plannerId = id(checkpoint.plannerResponseId) ? checkpoint.plannerResponseId : "";
  const sameJobSQL = `SELECT 1 AS matches FROM document_jobs WHERE ${Object.keys(job).map(key => `${key} IS ?`).join(" AND ")} LIMIT 1`;
  const scopeBindings = [jobId, job.document_id, tokenId, costId, costId, jobId, tokenId, costId, tokenId, costId, jobId, tokenId, costId];
  // This batch pins the selected job version and reads all ledgers in one read-only snapshot.
  const rows = await env.DB.batch<Row>([
    env.DB.prepare(sameJobSQL).bind(...Object.values(job)),
    env.DB.prepare(scopeSQL).bind(...scopeBindings),
    env.DB.prepare("SELECT * FROM budget_reservations WHERE reservation_id=? LIMIT 1").bind(tokenId),
    env.DB.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=? LIMIT 1").bind(costId),
    env.DB.prepare(`SELECT scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens,updated_at FROM budget_counters
      WHERE period=(SELECT period FROM budget_reservations WHERE reservation_id=?) AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma')) ORDER BY scope LIMIT 3`).bind(tokenId, actor.userId),
    env.DB.prepare(`SELECT scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd,updated_at FROM cost_budget_counters
      WHERE period=(SELECT period FROM cost_budget_reservations WHERE reservation_id=?) AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma')) ORDER BY scope LIMIT 3`).bind(costId, actor.userId),
    env.DB.prepare(`SELECT event_id,stream_id,correlation_id,type,CASE WHEN length(payload)<=65536 THEN payload ELSE NULL END AS payload,occurred_at FROM events WHERE stream_id=?
      AND type IN('BudgetReserved','GenerationUsageRecorded','BudgetReleased')
      AND (correlation_id=? OR json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.reservation_id')=?
        OR json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.cost_reservation_id')=?
        OR (?<>'' AND json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END,'$.planner_response_id')=?))
      ORDER BY event_id LIMIT 101`).bind(actor.streamId, job.correlation_id, tokenId, costId, plannerId, plannerId),
  ]);
  if (rows.some(row => !row.success) || rows[0]?.results.length !== 1) return fail("accounting_snapshot_changed");
  if (rows[1]?.results.length !== 1 || rows[1].results[0]?.conflict !== 0) return fail("accounting_personal_unscoped_only");
  const token = rows[2]?.results[0], cost = rows[3]?.results[0];
  if (!token || !cost || token.reservation_id !== tokenId || cost.reservation_id !== costId
    || [token, cost].some(row => row.owner_id !== actor.userId || row.stream_id !== actor.streamId || row.correlation_id !== job.correlation_id || row.operation !== "document-render:video")
    || token.period !== cost.period || !/^\d{4}-(0[1-9]|1[0-2])$/u.test(String(token.period)) || cost.workspace_id !== "forma"
    || checkpoint.costReservationPeriod !== undefined && checkpoint.costReservationPeriod !== cost.period
    || ![token.reserved_tokens, token.used_tokens, cost.reserved_microusd, cost.used_microusd].every(integer)
    || !["active", "settled", "released"].includes(String(token.status)) || !["active", "executing", "settled", "released"].includes(String(cost.status))
    || token.status === "active" && token.used_tokens !== 0 || ["active", "executing"].includes(String(cost.status)) && cost.used_microusd !== 0
    || token.status === "released" && token.used_tokens !== 0 || cost.status === "released" && cost.used_microusd !== 0) return fail("accounting_reservation_binding_conflict");
  const tokenCounters = rows[4].results, costCounters = rows[5].results;
  for (const [counters, unit, reservation, active] of [[tokenCounters, "tokens", token, token.status === "active"], [costCounters, "microusd", cost, ["active", "executing"].includes(String(cost.status))]] as const) {
    if (counters.length !== 2 || new Set(counters.map(row => row.scope)).size !== 2 || counters.some(row => row.period !== token.period
      || !(row.scope === "user" && row.scope_id === actor.userId || row.scope === "workspace" && row.scope_id === "forma")
      || ![row[`used_${unit}`], row[`reserved_${unit}`], row[`hard_limit_${unit}`]].every(integer)
      || active && Number(row[`reserved_${unit}`]) < Number(reservation[`reserved_${unit}`]))) return fail("accounting_counter_inconsistent");
  }
  const entries = checkpoint.providerSubmissions;
  if (checkpoint.providerSubmissionProtocol !== 1 || !entries || typeof entries !== "object" || Array.isArray(entries)
    || Object.keys(entries).length < 1 || Object.keys(entries).length > 64
    || checkpoint.providerSubmissionLegacyUncertain !== undefined && typeof checkpoint.providerSubmissionLegacyUncertain !== "boolean") return fail("accounting_per_call_evidence_unavailable");
  const seen = new Set<string>();
  const calls = Object.entries(entries).map(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail("accounting_call_evidence_invalid");
    const call = value as Record<string, unknown>;
    if (!id(key) || call.clientRequestId !== key || !["openai", "fal"].includes(String(call.provider))
      || !["planning", "image", "video"].includes(String(call.operation)) || typeof call.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(call.model)
      || !["pending", "accepted", "completed", "rejected"].includes(String(call.status))
      || call.providerRequestId !== undefined && !id(call.providerRequestId) || call.unitId !== undefined && !id(call.unitId)
      || ["costMicrousd", "inputTokens", "outputTokens", "totalTokens"].some(field => call[field] !== undefined && !integer(call[field]))) return fail("accounting_call_evidence_invalid");
    if (call.providerRequestId) {
      const identity = `${call.provider}:${call.providerRequestId}`;
      if (seen.has(identity)) return fail("accounting_duplicate_provider_identity");
      seen.add(identity);
    }
    const rejectionConflict = call.status === "rejected" && [call.costMicrousd, call.inputTokens, call.outputTokens, call.totalTokens].some(value => value !== undefined && value !== 0);
    if (rejectionConflict) return fail("accounting_rejected_call_usage_conflict");
    const accountingReason = call.status === "pending" ? "submission_outcome_unresolved" : call.status === "accepted" ? "accepted_call_billing_unresolved"
      : call.status === "completed" && !integer(call.costMicrousd) ? "completed_call_cost_missing"
        : call.status === "completed" && call.operation === "planning" && (![call.inputTokens, call.outputTokens, call.totalTokens].every(integer) || call.totalTokens !== Number(call.inputTokens) + Number(call.outputTokens)) ? "planner_usage_incomplete"
          : call.status === "completed" && !call.providerRequestId ? "completed_call_identity_missing" : null;
    return { clientRequestId: key, provider: call.provider, operation: call.operation, model: call.model, unitId: call.unitId ?? null,
      status: call.status, providerRequestId: call.providerRequestId ?? null, costMicrousd: call.costMicrousd ?? null,
      inputTokens: call.inputTokens ?? null, outputTokens: call.outputTokens ?? null, totalTokens: call.totalTokens ?? null, accountingReason };
  });
  const mediaRecord = (value: unknown, kind: "anchor" | "scene") => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail("accounting_media_evidence_invalid");
    const retained = value as Record<string, unknown>;
    const reference = (field: string) => retained[field] === undefined || retained[field] === null ? null : id(retained[field]) ? String(retained[field]) : fail("accounting_media_evidence_invalid");
    for (const field of ["costMicrousd", "durationSeconds"]) if (retained[field] !== undefined && !integer(retained[field])) return fail("accounting_media_evidence_invalid");
    if (kind === "scene" && !["preparing", "submitted", "completed"].includes(String(retained.status))) return fail("accounting_media_evidence_invalid");
    const providerRequestId = reference("providerJobId"), providerSubmissionId = reference("providerSubmissionId");
    const suppliedIdentity = providerRequestId !== null || providerSubmissionId !== null;
    const matches = calls.filter(call => suppliedIdentity
      && (providerRequestId === null || call.providerRequestId === providerRequestId)
      && (providerSubmissionId === null || call.clientRequestId === providerSubmissionId));
    const matching = matches.length === 1 ? matches[0] : null;
    const anyIdentityMatch = calls.some(call => providerRequestId !== null && call.providerRequestId === providerRequestId
      || providerSubmissionId !== null && call.clientRequestId === providerSubmissionId);
    return { kind, sceneId: reference("sceneId"), providerRequestId, providerSubmissionId,
      status: kind === "scene" ? String(retained.status) : "retained", durationSeconds: retained.durationSeconds ?? null,
      costMicrousd: retained.costMicrousd ?? null, matchedCallId: matching?.clientRequestId ?? null,
      accountingReason: matches.length > 1 || !matching && anyIdentityMatch ? "media_call_identity_conflict" : !matching ? "media_call_receipt_missing"
        : matching.operation !== (kind === "anchor" ? "image" : "video") ? "media_call_operation_conflict"
        : matching.costMicrousd !== null && retained.costMicrousd !== undefined && matching.costMicrousd !== retained.costMicrousd ? "media_call_cost_conflict" : null };
  };
  const sceneEntries = checkpoint.productionSceneReceipts;
  if (sceneEntries !== undefined && (!sceneEntries || typeof sceneEntries !== "object" || Array.isArray(sceneEntries) || Object.keys(sceneEntries).length > 64)) return fail("accounting_media_evidence_invalid");
  const retainedMedia = [
    ...(checkpoint.productionAnchor !== undefined ? [mediaRecord(checkpoint.productionAnchor, "anchor")] : []),
    ...Object.values(sceneEntries ?? {}).map(scene => mediaRecord(scene, "scene")),
  ];
  const generation = checkpoint.generationReceipt;
  const observedCallCount = generation && typeof generation === "object" && !Array.isArray(generation) ? (generation as Record<string, unknown>).actual_provider_call_count : undefined;
  if (observedCallCount !== undefined && observedCallCount !== null && !integer(observedCallCount)) return fail("accounting_call_history_invalid");
  const callHistoryReason = observedCallCount === undefined || observedCallCount === null ? "recorded_call_count_unavailable"
    : observedCallCount > calls.length ? "recorded_calls_missing"
      : retainedMedia.some(media => media.accountingReason !== null) ? "retained_media_call_history_unresolved" : null;
  const callHistoryComplete = callHistoryReason === null;
  if (rows[6].results.length > 100 || rows[6].results.reduce((sum, row) => sum + String(row.payload).length, 0) > 2_097_152) return fail("accounting_audit_evidence_limit");
  const audits = rows[6].results.map(row => {
    if (!id(row.event_id) || !id(row.correlation_id) || row.stream_id !== actor.streamId || !Number.isFinite(Date.parse(String(row.occurred_at)))) return fail("accounting_audit_evidence_invalid");
    const payload = json(row.payload), values: Record<string, number | null> = {};
    for (const key of auditAmounts) {
      if (payload[key] !== undefined && !integer(payload[key])) return fail("accounting_audit_evidence_invalid");
      values[key] = payload[key] === undefined ? null : Number(payload[key]);
    }
    const reference = (key: string) => payload[key] === undefined || payload[key] === null ? null : id(payload[key]) ? payload[key] : fail("accounting_audit_evidence_invalid");
    return { eventId: row.event_id, correlationId: row.correlation_id, type: row.type, occurredAt: row.occurred_at,
      reservationId: reference("reservation_id"), costReservationId: reference("cost_reservation_id"), plannerResponseId: reference("planner_response_id"), amounts: values };
  });
  const knownCalls = calls.filter(call => call.accountingReason === null);
  const knownReceiptCostMicrousd = knownCalls.reduce((sum, call) => sum + Number(call.costMicrousd ?? 0), 0);
  if (!integer(knownReceiptCostMicrousd)) return fail("accounting_usage_overflow");
  const legacyUncertain = checkpoint.providerSubmissionLegacyUncertain === true;
  const allCallsKnown = !legacyUncertain && callHistoryComplete && knownCalls.length === calls.length;
  const before = { job, token, cost, tokenCounters, costCounters, audits: rows[6].results };
  return { version: 1, kind: "read_only_generation_accounting_preview", observedAt: new Date(now).toISOString(), snapshotSha256: await digest(before),
    mutationAvailable: false, providerCalls: 0, ledgerWrites: 0,
    job: { jobId, documentId: job.document_id, correlationId: job.correlation_id, status: job.status, attemptCount: job.attempt_count,
      completedAt: job.completed_at, checkpointUpdatedAt: job.updated_at, requestSha256: await digest(job.request_json), checkpointSha256: await digest(job.result_json) },
    reservations: { period: token.period,
      tokens: { reservationId: tokenId, status: token.status, reserved: token.reserved_tokens, used: token.used_tokens },
      dollars: { reservationId: costId, currency: "USD", status: cost.status, reservedMicrousd: cost.reserved_microusd, usedMicrousd: cost.used_microusd } },
    counters: { tokens: tokenCounters, dollars: costCounters }, calls, retainedMedia, audits,
    accounting: { allCallsKnown, legacyUncertain, callHistoryComplete, callHistoryReason, recordedProviderCallCount: observedCallCount ?? null,
      knownReceiptCostMicrousd, unresolvedCallCount: calls.length - knownCalls.length,
      totalReceiptCostMicrousd: allCallsKnown ? knownReceiptCostMicrousd : null, proposedSettlementMicrousd: null,
      note: "Provider receipt costs are not a proposed charge. Prior settlements and external billing evidence require separate reconciliation; an accepted request is not proof of final billing." } };
}
