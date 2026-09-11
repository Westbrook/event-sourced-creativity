import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import { configuredPilotAdmissionGuard, POLICY_VERSION, type PilotUser } from "./pilot-policy.ts";
import { outputAssertionStatements, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { HOLD_DISPOSITION_STATUS, holdSchemaProof } from "./budget-hold-schema.ts";

type Row = Record<string, string | number | null>;
type DB = Pick<WorkerEnv, "DB">;
export class HoldDispositionError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code: string, status = 409): never => { throw new HoldDispositionError(code, status); };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)])) : value;
export const holdHash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(JSON.stringify(canonical(value)))))).map(v => v.toString(16).padStart(2, "0")).join("");
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const object = (v: unknown): Record<string, unknown> => {
  try { const x = JSON.parse(String(v)); if (x && typeof x === "object" && !Array.isArray(x)) return x; } catch { /* fail closed */ }
  return fail("hold_invalid_retained_json");
};
const rowProof = (table: string, row: Row): OutputSqlAssertion => ({
  sql: `EXISTS(SELECT 1 FROM ${table} WHERE ${Object.keys(row).map(key => `${key} IS ?`).join(" AND ")})`, bindings: Object.values(row),
});
export const holdAdministratorAuthority = (actor: PilotUser): OutputSqlAssertion => {
  const p=actor.authorizationSnapshot;
  if (!p || actor.role!=="admin" || actor.streamId!==`creative:${actor.userId}` || actor.access.identityPolicyDeniedCustody) return fail("hold_principal_administrator_required",403);
  return {
    sql: `EXISTS(SELECT 1 FROM (${PRINCIPAL_WITH_ACCESS_SQL}) current WHERE current.user_id=? AND current.email=? AND current.role='admin' AND current.consent_version=?
      AND current.updated_at=? AND COALESCE(current.permission_epoch,'')=? AND COALESCE(current.grants_json,'[]')=?
      AND COALESCE(current.organizations_json,'[]')=? AND COALESCE(current.projects_json,'[]')=?
      AND COALESCE(current.identity_policies_json,'[]')=? AND COALESCE(current.approved_canvas_requirements,0)=?)
      AND NOT EXISTS(SELECT 1 FROM impersonation_sessions WHERE actor_user_id=? AND status='active' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    bindings:[actor.userId,actor.userId,actor.email,POLICY_VERSION,p.updatedAt,p.rawEpoch,p.grants,p.organizations,p.projects,p.identityPolicies,p.canvasRequirements,actor.userId],
  };
};
const scopeProof = (job: Row, token: Row, cost: Row): OutputSqlAssertion => ({
  sql: `NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes WHERE reservation_id IN(?,?))
    AND NOT EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes WHERE reservation_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE
      (resource_kind='job' AND resource_id=?) OR (resource_kind='document' AND resource_id=? AND owner_user_id=?))
    AND NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=? OR token_reservation_id=? OR cost_reservation_id=?)
    AND NOT EXISTS(SELECT 1 FROM consequential_execution_steps WHERE token_reservation_id=? OR cost_reservation_id=?)`,
  bindings: [token.reservation_id, cost.reservation_id, cost.reservation_id, job.job_id, job.document_id, job.owner_id,
    job.job_id, token.reservation_id, cost.reservation_id, token.reservation_id, cost.reservation_id],
});
const auditPredicate = "stream_id=? AND type IN('BudgetReserved','BudgetReleased','GenerationUsageRecorded') AND (correlation_id=? OR json_extract(payload,'$.reservation_id')=? OR json_extract(payload,'$.cost_reservation_id')=?)";

/** No schema initialization, provider calls, or ledger repair: read bounded state, then pin every row again inside the write transaction. */
async function snapshot(env: DB, actor: PilotUser, jobId: string) {
  const job = await env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=?")
    .bind(jobId, actor.userId, actor.streamId).first<Row>();
  if (!job) return fail("hold_job_not_found", 404);
  const checkpoint = object(job.result_json), request = object(job.request_json);
  if (job.kind !== "render_document" || request.artifactKind !== "slides" || !["failed", "canceled"].includes(String(job.status))
    || job.output_slot_id || job.lease_expires_at || !job.completed_at) return fail("hold_terminal_personal_slides_required");
  const tokenId = checkpoint.reservationId, costId = checkpoint.costReservationId;
  if (typeof tokenId !== "string" || !tokenId || typeof costId !== "string" || !costId) return fail("hold_exact_reservations_required");
  const receipt = checkpoint.generationReceipt as Record<string, unknown> | undefined;
  if (checkpoint.presentationProviderSubmission !== "pending" && receipt?.provider_request_status !== "submission_unknown") return fail("hold_unknown_provider_outcome_required");
  const jobProof = rowProof("document_jobs", job);
  const auditBindings = [actor.streamId, job.correlation_id, tokenId, costId];
  const read = await env.DB.batch([
    env.DB.prepare("SELECT 1 AS matches WHERE " + jobProof.sql).bind(...jobProof.bindings!),
    env.DB.prepare("SELECT * FROM budget_reservations WHERE reservation_id=?").bind(tokenId),
    env.DB.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=?").bind(costId),
    env.DB.prepare("SELECT * FROM users WHERE user_id=?").bind(actor.userId),
    env.DB.prepare("SELECT event_id,stream_id,correlation_id,type,payload FROM events WHERE " + auditPredicate + " ORDER BY event_id").bind(...auditBindings),
  ]);
  if (!read[0]?.results.length) return fail("hold_snapshot_changed");
  const token = read[1]?.results[0] as Row | undefined, cost = read[2]?.results[0] as Row | undefined, principal = read[3]?.results[0] as Row | undefined;
  if (!principal || principal.role !== "admin" || principal.consent_version !== POLICY_VERSION || principal.email !== actor.email
    || actor.fictional || actor.projectExecution || actor.billingUserId && actor.billingUserId !== actor.userId) return fail("hold_principal_administrator_required", 403);
  if (!token || !cost || token.owner_id !== actor.userId || cost.owner_id !== actor.userId
    || [token, cost].some(row => row.stream_id !== job.stream_id || row.correlation_id !== job.correlation_id || row.operation !== "document-render:slides")
    || token.period !== cost.period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(token.period)) || cost.workspace_id !== "forma"
    || checkpoint.costReservationPeriod !== undefined && checkpoint.costReservationPeriod !== token.period
    || token.status !== "active" || cost.status !== "executing" || token.used_tokens !== 0 || cost.used_microusd !== 0
    || !integer(token.reserved_tokens) || !token.reserved_tokens || !integer(cost.reserved_microusd) || !cost.reserved_microusd) return fail("hold_reservation_binding_conflict");
  const scopes = scopeProof(job, token, cost), audits = read[4]?.results as Row[];
  if (audits.some(row => row.type !== "BudgetReserved")) return fail("hold_prior_financial_audit_requires_review");
  const reserved = audits.filter(row => {
    const p = object(row.payload);
    return row.correlation_id === token.correlation_id && p.reservation_id === tokenId && p.cost_reservation_id === costId
      && p.reserved_tokens === token.reserved_tokens && p.reserved_microusd === cost.reserved_microusd && p.period === token.period && p.operation === token.operation;
  });
  if (reserved.length !== 1) return fail("hold_reservation_audit_binding_required");
  const counters = await env.DB.batch([
    env.DB.prepare("SELECT 1 AS matches WHERE " + scopes.sql).bind(...scopes.bindings!),
    env.DB.prepare("SELECT * FROM budget_counters WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma')) ORDER BY scope").bind(token.period, actor.userId),
    env.DB.prepare("SELECT * FROM cost_budget_counters WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma')) ORDER BY scope").bind(token.period, actor.userId),
  ]);
  if (!counters[0]?.results.length) return fail("hold_personal_unscoped_only");
  const tokenCounters = counters[1]?.results as Row[], costCounters = counters[2]?.results as Row[];
  for (const [rows, unit, amount] of [[tokenCounters, "tokens", token.reserved_tokens], [costCounters, "microusd", cost.reserved_microusd]] as const) {
    if (rows.length !== 2 || rows.some(row => !integer(row[`used_${unit}`]) || !integer(row[`reserved_${unit}`])
      || !integer(row[`hard_limit_${unit}`]) || Number(row[`reserved_${unit}`]) < amount)) return fail("hold_counter_inconsistent");
  }
  return { job, token, cost, principal, audits, tokenCounters, costCounters, scopes, auditBindings };
}

export async function previewHoldDisposition(env: DB, actor: PilotUser, jobId: string) {
  const schema=holdSchemaProof();
  if(!await env.DB.prepare("SELECT 1 AS ready WHERE "+schema.sql).bind(...schema.bindings).first())return fail("hold_schema_not_ready");
  const s = await snapshot(env, actor, jobId);
  return { schemaVerified: true, kind: "administrative_hold_release", providerOutcome: "unknown", previewSha256: await holdHash(s),
    jobId, documentId: s.job.document_id, correlationId: s.job.correlation_id, ownerId: actor.userId, streamId: actor.streamId,
    tokenReservationId: s.token.reservation_id, costReservationId: s.cost.reservation_id, period: s.token.period,
    releaseTokens: s.token.reserved_tokens, releaseMicrousd: s.cost.reserved_microusd,
    settledTokensDelta: 0, settledMicrousdDelta: 0, providerCalls: 0,
    counters: { tokens: s.tokenCounters, dollars: s.costCounters },
    warning: "This releases internal capacity only. Provider usage and billed amount remain unknown. A later charge requires a separate reviewed correction." };
}

export type HoldDispositionCommand = { dispositionId: string; jobId: string; previewSha256: string; approvalRef: string; supportRef: string; reason: string; evidenceSha256: string; acknowledgement: string };
export const HOLD_ACKNOWLEDGEMENT = "Release internal holds; provider billing remains unknown";
export function validateHoldCommand(value: unknown): HoldDispositionCommand {
  const v = value as HoldDispositionCommand;
  if (!v || typeof v !== "object" || Object.keys(v).sort().join(",") !== ["dispositionId", "jobId", "previewSha256", "approvalRef", "supportRef", "reason", "evidenceSha256", "acknowledgement"].sort().join(",")
    || typeof v.dispositionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(v.dispositionId) || typeof v.jobId !== "string" || v.jobId.length > 100 || !v.jobId
    || ![v.previewSha256, v.evidenceSha256].every(x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x))
    || ![v.approvalRef, v.supportRef, v.reason].every(x => typeof x === "string" && x.trim().length >= 5 && x.length <= 500 && !Array.from(x).some(c => c.charCodeAt(0) < 32))
    || v.acknowledgement !== HOLD_ACKNOWLEDGEMENT) return fail("hold_explicit_command_required", 400);
  return v;
}

export async function applyHoldDisposition(env: WorkerEnv, actor: PilotUser, input: HoldDispositionCommand) {
  if (env.FORMA_HOLD_DISPOSITION_ENABLED !== "true") return fail("hold_administration_disabled", 403);
  const command = validateHoldCommand(input), commandSha256 = await holdHash({ actor: actor.userId, command });
  const auth = holdAdministratorAuthority(actor), admission = configuredPilotAdmissionGuard(env, actor);
  const authorized = await env.DB.prepare("SELECT 1 AS ok WHERE " + auth.sql + " AND " + admission.sql).bind(...auth.bindings!, ...admission.bindings!).first();
  if (!authorized || actor.fictional || actor.projectExecution || actor.billingUserId && actor.billingUserId !== actor.userId) return fail("hold_principal_administrator_required", 403);
  const existing = async () => env.DB.prepare("SELECT * FROM budget_hold_dispositions WHERE disposition_id=? AND operator_id=? AND command_sha256=?")
    .bind(command.dispositionId, actor.userId, commandSha256).first<Row>();
  const prior = await existing();
  if (prior) return { applied: false, replayed: true, dispositionId: command.dispositionId, recordSha256: prior.record_sha256 };
  const s = await snapshot(env, actor, command.jobId);
  if (await holdHash(s) !== command.previewSha256) return fail("hold_preview_changed");
  const now = new Date().toISOString(), eventId = crypto.randomUUID();
  const afterToken = { ...s.token, status: HOLD_DISPOSITION_STATUS, settlement_reason: `administrative:${command.dispositionId}`, settled_at: now, updated_at: now };
  const afterCost = { ...s.cost, status: HOLD_DISPOSITION_STATUS, settled_at: now, updated_at: now };
  const afterCounters = (rows: Row[], unit: string, amount: number) => rows.map(row => ({ ...row, [`reserved_${unit}`]: Number(row[`reserved_${unit}`]) - amount, updated_at: now }));
  const record = { version: 1, dispositionId: command.dispositionId, operatorId: actor.userId, command, commandSha256,
    providerOutcome: "unknown", kind: "administrative_hold_release", eventId, createdAt: now,
    job: { jobId: s.job.job_id, ownerId: s.job.owner_id, streamId: s.job.stream_id, documentId: s.job.document_id, correlationId: s.job.correlation_id,
      kind: s.job.kind, status: s.job.status, attemptCount: s.job.attempt_count, startedAt: s.job.started_at, completedAt: s.job.completed_at, leaseExpiresAt: s.job.lease_expires_at,
      requestSha256: await holdHash(s.job.request_json), resultSha256: await holdHash(s.job.result_json) },
    before: { token: s.token, cost: s.cost, tokenCounters: s.tokenCounters, costCounters: s.costCounters },
    after: { token: afterToken, cost: afterCost, tokenCounters: afterCounters(s.tokenCounters, "tokens", Number(s.token.reserved_tokens)), costCounters: afterCounters(s.costCounters, "microusd", Number(s.cost.reserved_microusd)) },
    auditSha256: await holdHash(s.audits), auditIds: s.audits.map(row => row.event_id),
    releaseTokens: s.token.reserved_tokens, releaseMicrousd: s.cost.reserved_microusd, settledTokensDelta: 0, settledMicrousdDelta: 0, providerCalls: 0 };
  const recordJson = JSON.stringify(record), recordSha256 = await holdHash(record);
  const assert = (p: OutputSqlAssertion) => outputAssertionStatements(env, p);
  const proofs = [holdSchemaProof(), auth, admission, rowProof("users", s.principal), rowProof("document_jobs", s.job), s.scopes,
    rowProof("budget_reservations", s.token), rowProof("cost_budget_reservations", s.cost),
    ...s.tokenCounters.map(row => rowProof("budget_counters", row)), ...s.costCounters.map(row => rowProof("cost_budget_counters", row)),
    ...s.audits.map(row => rowProof("events", row)),
    { sql: `(SELECT COUNT(*) FROM events WHERE ${auditPredicate})=?`, bindings: [...s.auditBindings, s.audits.length] }];
  const statements = proofs.flatMap(assert);
  const write = (statement: D1PreparedStatement) => statements.push(statement, ...assert({ sql: "changes()=1" }));
  for (const [rows, table, unit, amount] of [[s.tokenCounters, "budget_counters", "tokens", s.token.reserved_tokens], [s.costCounters, "cost_budget_counters", "microusd", s.cost.reserved_microusd]] as const) {
    for (const row of rows) write(env.DB.prepare(`UPDATE ${table} SET reserved_${unit}=reserved_${unit}-?,updated_at=? WHERE scope=? AND scope_id=? AND period=?`)
      .bind(amount, now, row.scope, row.scope_id, row.period));
  }
  write(env.DB.prepare("UPDATE budget_reservations SET status=?,settlement_reason=?,settled_at=?,updated_at=? WHERE reservation_id=?")
    .bind(afterToken.status, afterToken.settlement_reason, now, now, s.token.reservation_id));
  write(env.DB.prepare("UPDATE cost_budget_reservations SET status=?,settled_at=?,updated_at=? WHERE reservation_id=?")
    .bind(afterCost.status, now, now, s.cost.reservation_id));
  write(env.DB.prepare(`INSERT INTO budget_hold_dispositions(disposition_id,operator_id,job_id,correlation_id,token_reservation_id,cost_reservation_id,command_sha256,record_sha256,record_json,event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(command.dispositionId, actor.userId, s.job.job_id, s.job.correlation_id, s.token.reservation_id, s.cost.reservation_id, commandSha256, recordSha256, recordJson, eventId, now));
  // The immutable public event contains only IDs/digests, never rationale or retained source content.
  const eventPayload = JSON.stringify({ disposition_id: command.dispositionId, record_sha256: recordSha256, provider_outcome: "unknown" });
  write(env.DB.prepare(`INSERT INTO event_write_stage(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload,owner_id)
    SELECT ?,?,COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)+1,?,?,?,?,?,1,'BudgetHoldAdministrativelyReleased',?,?`)
    .bind(eventId, actor.streamId, actor.streamId, now, now, actor.userId, "server:hold-administration", s.job.correlation_id, eventPayload, actor.userId));
  statements.push(...assert(rowProof("budget_reservations", afterToken)), ...assert(rowProof("cost_budget_reservations", afterCost)),
    ...record.after.tokenCounters.flatMap(row => assert(rowProof("budget_counters", row))), ...record.after.costCounters.flatMap(row => assert(rowProof("cost_budget_counters", row))),
    ...assert(rowProof("document_jobs", s.job)), ...assert({ sql: "EXISTS(SELECT 1 FROM events WHERE event_id=? AND type='BudgetHoldAdministrativelyReleased' AND payload=?)", bindings: [eventId, eventPayload] }));
  try { await env.DB.batch(statements); }
  catch {
    const durable = await existing();
    if (!durable) return fail("hold_accounting_write_conflict");
    return { applied: false, replayed: true, dispositionId: command.dispositionId, recordSha256: durable.record_sha256 };
  }
  return { applied: true, replayed: false, dispositionId: command.dispositionId, recordSha256 };
}
