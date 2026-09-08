import type { WorkerEnv } from "./runtime.ts";
import { holdHash, HoldDispositionError } from "./budget-hold-dispositions.ts";
import { HOLD_DISPOSITION_STATUS, holdSchemaProof } from "./budget-hold-schema.ts";

type Row = Record<string, string | number | null>;
type Counters = { token: Row; cost: Row; tokenCounters: Row[]; costCounters: Row[] };
type Receipt = {
  version: number; dispositionId: string; operatorId: string; commandSha256: string; command: Record<string, unknown>;
  kind: string; providerOutcome: string; providerCalls: number; eventId: string; createdAt: string;
  job: { jobId: string; ownerId: string; streamId: string; documentId: string; correlationId: string; kind: string; status: string; attemptCount: number; startedAt: string|null; completedAt: string|null; leaseExpiresAt: string|null; requestSha256: string; resultSha256: string };
  before: Counters; after: Counters; releaseTokens: number; releaseMicrousd: number; settledTokensDelta: number; settledMicrousdDelta: number;
  auditSha256: string; auditIds: string[];
};

/** Independent follow-up: only SELECT statements; never initialize/repair schema or readBudgets. */
export async function verifyHoldDisposition(env: Pick<WorkerEnv, "DB">, operatorId: string, dispositionId: string) {
  const saved = await env.DB.prepare("SELECT * FROM budget_hold_dispositions WHERE disposition_id=? AND operator_id=?")
    .bind(dispositionId, operatorId).first<Row>();
  if (!saved) throw new HoldDispositionError("hold_disposition_not_found", 404);
  const r = JSON.parse(String(saved.record_json)) as Receipt;
  const checks: Record<string, boolean> = {};
  checks.recordDigest = await holdHash(r) === saved.record_sha256;
  checks.commandDigest = await holdHash({ actor: operatorId, command: r.command }) === saved.command_sha256 && r.commandSha256 === saved.command_sha256;
  checks.identity = r.version === 1 && r.dispositionId === dispositionId && r.operatorId === operatorId && r.job.ownerId === operatorId
    && r.job.streamId === `creative:${operatorId}` && r.job.jobId === saved.job_id && r.job.correlationId === saved.correlation_id
    && r.before.token.reservation_id === saved.token_reservation_id && r.before.cost.reservation_id === saved.cost_reservation_id
    && r.eventId === saved.event_id && r.createdAt === saved.created_at;
  checks.unknownPreserved = r.providerOutcome === "unknown" && r.kind === "administrative_hold_release" && r.providerCalls === 0
    && r.settledTokensDelta === 0 && r.settledMicrousdDelta === 0;
  const valid = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
  checks.amounts = valid(r.releaseTokens) && r.releaseTokens > 0 && valid(r.releaseMicrousd) && r.releaseMicrousd > 0
    && r.before.token.reserved_tokens === r.releaseTokens && r.before.cost.reserved_microusd === r.releaseMicrousd
    && r.before.token.used_tokens === 0 && r.before.cost.used_microusd === 0 && r.before.token.status === "active" && r.before.cost.status === "executing";
  checks.reservationTransition = await holdHash(r.after.token) === await holdHash({ ...r.before.token, status: HOLD_DISPOSITION_STATUS,
    settlement_reason: `administrative:${dispositionId}`, settled_at: r.createdAt, updated_at: r.createdAt })
    && await holdHash(r.after.cost) === await holdHash({ ...r.before.cost, status: HOLD_DISPOSITION_STATUS, settled_at: r.createdAt, updated_at: r.createdAt });
  checks.counterDelta = true;
  for (const [key, unit, amount] of [["tokenCounters", "tokens", r.releaseTokens], ["costCounters", "microusd", r.releaseMicrousd]] as const) {
    const before = r.before[key], after = r.after[key];
    if (before.length !== 2 || after.length !== 2) { checks.counterDelta = false; continue; }
    for (const row of before) {
      const expected = { ...row, [`reserved_${unit}`]: Number(row[`reserved_${unit}`]) - amount, updated_at: r.createdAt };
      const actual = after.find(x => x.scope === row.scope && x.scope_id === row.scope_id && x.period === row.period);
      checks.counterDelta &&= valid(row[`reserved_${unit}`]) && valid(row[`used_${unit}`]) && Number(row[`reserved_${unit}`]) >= amount
        && row.period === r.before.token.period && (row.scope === "user" && row.scope_id === operatorId || row.scope === "workspace" && row.scope_id === "forma")
        && await holdHash(expected) === await holdHash(actual);
    }
  }
  const b = r.before;
  // A single read-only batch provides the follow-up view; no assertions table is written.
  const schema = holdSchemaProof();
  const rows = await env.DB.batch([
    env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=?").bind(r.job.jobId, operatorId, r.job.streamId),
    env.DB.prepare("SELECT * FROM budget_reservations WHERE reservation_id=?").bind(saved.token_reservation_id),
    env.DB.prepare("SELECT * FROM cost_budget_reservations WHERE reservation_id=?").bind(saved.cost_reservation_id),
    env.DB.prepare("SELECT event_id,stream_id,correlation_id,actor,type,payload FROM events WHERE event_id=?").bind(r.eventId),
    env.DB.prepare(`SELECT event_id,stream_id,correlation_id,type,payload FROM events WHERE stream_id=?
      AND type IN('BudgetReserved','BudgetReleased','GenerationUsageRecorded')
      AND (correlation_id=? OR json_extract(payload,'$.reservation_id')=? OR json_extract(payload,'$.cost_reservation_id')=?) ORDER BY event_id`)
      .bind(r.job.streamId, r.job.correlationId, saved.token_reservation_id, saved.cost_reservation_id),
    env.DB.prepare(`SELECT *, (SELECT COALESCE(SUM(reserved_tokens),0) FROM budget_reservations reservation
      WHERE reservation.period=counter.period AND reservation.status='active' AND (counter.scope='workspace' OR reservation.owner_id=counter.scope_id)) AS ledger_reserved
      FROM budget_counters counter WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma')) ORDER BY scope`).bind(b.token.period, operatorId),
    env.DB.prepare(`SELECT *, (SELECT COALESCE(SUM(reserved_microusd),0) FROM cost_budget_reservations reservation
      WHERE reservation.period=counter.period AND reservation.status IN('active','executing') AND (counter.scope='workspace' OR reservation.owner_id=counter.scope_id)) AS ledger_reserved
      FROM cost_budget_counters counter WHERE period=? AND ((scope='user' AND scope_id=?) OR (scope='workspace' AND scope_id='forma')) ORDER BY scope`).bind(b.cost.period, operatorId),
    env.DB.prepare("SELECT 1 AS intact WHERE "+schema.sql).bind(...schema.bindings),
  ]);
  const job = rows[0]?.results[0] as Row | undefined, event = rows[3]?.results[0] as Row | undefined;
  checks.immutableSchema = rows[7]?.results.length === 1;
  checks.liveJobBinding = Boolean(job && job.job_id===r.job.jobId && job.document_id===r.job.documentId && job.correlation_id===r.job.correlationId
    && job.kind===r.job.kind && job.status===r.job.status && job.attempt_count===r.job.attemptCount && job.started_at===r.job.startedAt
    && job.completed_at===r.job.completedAt && job.lease_expires_at===r.job.leaseExpiresAt);
  checks.reservationsPersisted = await holdHash(rows[1]?.results[0]) === await holdHash(r.after.token) && await holdHash(rows[2]?.results[0]) === await holdHash(r.after.cost);
  checks.providerEvidenceUnchanged = Boolean(job && await holdHash(job.request_json) === r.job.requestSha256 && await holdHash(job.result_json) === r.job.resultSha256);
  checks.auditEvent = Boolean(event && event.stream_id === r.job.streamId && event.correlation_id === r.job.correlationId && event.actor === operatorId
    && event.type === "BudgetHoldAdministrativelyReleased" && await holdHash(JSON.parse(String(event.payload))) === await holdHash({ disposition_id: dispositionId, record_sha256: saved.record_sha256, provider_outcome: "unknown" }));
  checks.noAdditionalAttemptUsage = await holdHash(rows[4]?.results) === r.auditSha256;
  const currentCounters = { tokens: rows[5]?.results as Row[], dollars: rows[6]?.results as Row[] };
  checks.currentReservedProjection = true;
  checks.settledCountersUnchanged = true;
  for (const [list, unit] of [[currentCounters.tokens, "tokens"], [currentCounters.dollars, "microusd"]] as const) {
    checks.currentReservedProjection &&= list.length === 2 && list.every(row => valid(row[`used_${unit}`]) && valid(row[`reserved_${unit}`])
      && valid(row.ledger_reserved) && row.ledger_reserved === row[`reserved_${unit}`]);
    const after = unit === "tokens" ? r.after.tokenCounters : r.after.costCounters;
    checks.settledCountersUnchanged &&= list.length === 2 && list.every(row => {
      const prior = after.find(value=>value.scope===row.scope && value.scope_id===row.scope_id && value.period===row.period);
      return prior && row[`used_${unit}`]===prior[`used_${unit}`];
    });
  }
  const transactionChecks = ["recordDigest", "commandDigest", "identity", "unknownPreserved", "amounts", "reservationTransition", "counterDelta", "reservationsPersisted", "auditEvent", "immutableSchema"];
  return { dispositionId, recordSha256: saved.record_sha256, checkedAt: new Date().toISOString(),
    transactionVerified: transactionChecks.every(key => checks[key]), verified: Object.values(checks).every(Boolean), checks,
    providerOutcome: "unknown", providerBillingVerified: false, currentCounters, requiresReview: Object.entries(checks).filter(([,ok])=>!ok).map(([key])=>key),
    note: "The recorded adjustment is checked separately from current state. Any changed settled counter requires review, including legitimate later usage; this pass does not attribute that change or infer historical provider charges." };
}
