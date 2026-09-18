import { memoryDigest } from "../src/model/scoped-memory.ts";
import { memoryCanonical, type MemorySqlGuard } from "./memory-sql.ts";
import { liveMemoryAuthority, liveMemoryEnrollmentGuard, type LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { DERIVATION_CURSOR_COLUMNS } from "./memory-derivation-job-schema.ts";
import { DERIVATION_GRANT_COLUMNS, derivationAssertion, derivationResults, derivationVerified, derivationChanged,
  derivationRowGuard, derivationQualificationGuard, memoryDerivationSchema, memoryDerivationEnabled,
  memoryDerivationGrantShape, readDerivationQualification, type MemoryDerivationGrant } from "./memory-derivation-store.ts";
import { derivationExact, derivationInteger, derivationTime } from "./memory-derivation-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

export const MEMORY_DERIVATION_REFERENCE_PAGE = 128;
export const MEMORY_DERIVATION_PENDING_LIMIT = 32;
type Row = Record<string, unknown>;
type Cursor = { consent_id: string; grant_id: string; grant_revision: number; purpose: string;
  registered_through_sequence: number; generation: number; created_at: string; updated_at: string; expires_at: string };
const fail = (): never => { throw new Error("memory-derivation-delivery-unavailable"); };
const snapshot = (consentId: string, row: Cursor | null): MemorySqlGuard => ({
  condition: `(SELECT json_group_array(json_array(${DERIVATION_CURSOR_COLUMNS.join(",")})) FROM memory_derivation_cursors WHERE consent_id=?)=?`,
  bindings: [consentId, JSON.stringify(row ? [DERIVATION_CURSOR_COLUMNS.map(key => row[key])] : [])],
});

/** Append the complete returned statement array AFTER native source publication
 * and BEFORE its enrollment cursor ACK, in the same authorized transaction.
 * The SQL selects prospective inserts at execution time. These references are
 * candidate pointers only: no plaintext, provider authority or completed cursor.
 * A later native admission must independently prove every original and lifetime.
 */
export async function prepareNativeDerivationDelivery(env: WorkerEnv, enrollment: LiveMemoryEnrollment, through: number, now: string) {
  const db = env.DB, enrollmentKey = memoryCanonical(enrollment), e = structuredClone(enrollment);
  const statements: D1PreparedStatement[] = [], asserted: number[] = [], cursorWrites: number[] = [];
  const current = () => env.DB === db && memoryCanonical(enrollment) === enrollmentKey;
  const assert = (guard: MemorySqlGuard) => { asserted.push(statements.length); statements.push(derivationAssertion({ ...env, DB: db }, guard)); };
  // Even disabled/legacy publications pin schema absence/presence. Do not read
  // consent or queue rows while deployment is disabled.
  const schema = await memoryDerivationSchema(env); assert(schema.guard);
  if (!current() || !derivationInteger(through) || through < e.cursor_sequence || !derivationTime(now)) fail();
  const enabled = () => memoryDerivationEnabled(env, e.actor_user_id) && e.learn_enabled === 1 && e.background_enabled === 1;
  let registeredPurposes = 0, capacityPurposes = 0;
  if (schema.jobsPresent && enabled()) {
    // One queue window must fit the native 64-pair capture limit. Legacy
    // schemas keep their original registration contract until completion exists.
    const pageLimit = schema.completionPresent ? 64 : MEMORY_DERIVATION_REFERENCE_PAGE;
    const pending = schema.completionPresent ? " AND NOT EXISTS(SELECT 1 FROM memory_derivation_completions done WHERE done.job_id=memory_derivation_jobs.job_id)" : "";
    const result = structuredClone(await db.prepare(`SELECT ${DERIVATION_GRANT_COLUMNS.join(",")} FROM memory_derivation_grants
      WHERE enrollment_id=? AND enrollment_revision=? AND revoked_at IS NULL AND background_enabled=1
        AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY purpose LIMIT 4`).bind(e.enrollment_id, e.revision).all<Row>());
    if (!current() || !enabled() || !derivationResults([result], 1) || result.results.length > 3 || !result.results.every(memoryDerivationGrantShape)) fail();
    for (const g of result.results as MemoryDerivationGrant[]) {
      if (g.actor_user_id !== e.actor_user_id || g.owner_user_id !== e.owner_user_id || g.organization_id !== e.organization_id
        || g.project_access_id !== e.project_access_id || g.project_id !== e.project_id || g.document_id !== e.document_id
        || g.permission_epoch !== e.permission_epoch || g.expires_at > e.expires_at || g.retention_days > e.retention_days) fail();
      const qualification = await readDerivationQualification(env, g.qualification_id);
      if (!qualification || qualification.row.terms_sha256 !== g.terms_sha256 || qualification.terms.purpose !== g.purpose
        || qualification.terms.monthlyCapMicroUsd !== g.monthly_cap_microusd) continue;
      const cursorResult = structuredClone(await db.prepare(`SELECT ${DERIVATION_CURSOR_COLUMNS.join(",")} FROM memory_derivation_cursors WHERE consent_id=? LIMIT 2`).bind(g.consent_id).all<Row>());
      if (!current() || !enabled() || !derivationResults([cursorResult], 1) || cursorResult.results.length > 1) fail();
      const cursor = (cursorResult.results[0] ?? null) as Cursor | null;
      if (cursor && (!derivationExact(cursor, DERIVATION_CURSOR_COLUMNS) || cursor.consent_id !== g.consent_id || cursor.grant_id !== g.grant_id
        || cursor.grant_revision !== g.revision || cursor.purpose !== g.purpose || cursor.expires_at !== g.expires_at
        || !derivationInteger(cursor.registered_through_sequence, g.source_after_sequence) || !derivationInteger(cursor.generation, 0, Number.MAX_SAFE_INTEGER - 1)
        || !derivationTime(cursor.created_at) || !derivationTime(cursor.updated_at) || cursor.created_at < g.consented_at || cursor.updated_at < cursor.created_at)) fail();
      const after = cursor?.registered_through_sequence ?? g.source_after_sequence;
      if (through <= after) continue;
      const countResult = structuredClone(await db.prepare("SELECT COUNT(*) AS count FROM memory_derivation_jobs WHERE consent_id=?"+pending).bind(g.consent_id).all<Row>());
      if (!derivationResults([countResult], 1) || countResult.results.length !== 1 || !derivationExact(countResult.results[0], ["count"])
        || !derivationInteger(countResult.results[0]!.count) || !current() || !enabled()) fail();
      const count = countResult.results[0]!.count as number;
      if (!cursor && count) fail();
      if (count >= MEMORY_DERIVATION_PENDING_LIMIT) { capacityPurposes++; continue; }
      const jobId = await memoryDigest(memoryCanonical(["native-reference-delivery-v1", g.consent_id, g.purpose, after, through]));
      const expires = [g.expires_at, qualification.row.expires_at].sort()[0]!;
      // Purpose retention begins at the original event, never this delayed run.
      // The dependency still copies the original remembered ceiling exactly;
      // the job takes the smaller purpose-specific deadline.
      const sources = `FROM memory_live_sources s JOIN events original ON (original.event_id,original.sequence,original.stream_id)=(s.event_id,s.sequence,?)
        WHERE s.enrollment_id=? AND s.sequence>? AND s.sequence<=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND original.recorded_at>=? AND original.recorded_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND strftime('%Y-%m-%dT%H:%M:%fZ',original.recorded_at,'+'||?||' days')>strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
      const sourceBindings = [`creative:${e.owner_user_id}`, e.enrollment_id, after, through, g.consented_at, g.retention_days];
      assert(derivationRowGuard("memory_derivation_grants", DERIVATION_GRANT_COLUMNS, g));
      assert(derivationQualificationGuard(qualification.row));
      assert(liveMemoryEnrollmentGuard(e, "learn"));
      assert(snapshot(g.consent_id, cursor));
      assert({ condition: "(SELECT COUNT(*) FROM memory_derivation_jobs WHERE consent_id=?"+pending+")=? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        bindings: [g.consent_id, count, expires] });
      if (!cursor) statements.push(db.prepare(`INSERT INTO memory_derivation_cursors(${DERIVATION_CURSOR_COLUMNS.join(",")}) VALUES(?,?,?,?,?,0,?,?,?)`)
        .bind(g.consent_id, g.grant_id, g.revision, g.purpose, after, now, now, g.expires_at));
      // The extra reference is only an overflow witness. Cursor never skips it.
      statements.push(db.prepare(`WITH page AS (SELECT s.event_id,s.sequence,s.expires_at,
          strftime('%Y-%m-%dT%H:%M:%fZ',original.recorded_at,'+'||?||' days') AS purpose_expires_at ${sources} ORDER BY s.sequence,s.event_id LIMIT ${pageLimit+1}),
        selected AS (SELECT * FROM page ORDER BY sequence,event_id LIMIT ${pageLimit})
        INSERT INTO memory_derivation_jobs(job_id,consent_id,purpose,after_sequence,through_sequence,source_count,created_at,expires_at,state,lease_token,lease_expires_at,attempts,not_before,failure_code)
        SELECT ?,?,?,?,CASE WHEN (SELECT COUNT(*) FROM page)>${pageLimit} THEN MAX(sequence) ELSE ? END,COUNT(*),?,MIN(?,MIN(expires_at),MIN(purpose_expires_at)),
          'waiting',NULL,NULL,0,?,NULL FROM selected HAVING COUNT(*)>0`)
        .bind(g.retention_days, ...sourceBindings, jobId, g.consent_id, g.purpose, after, through, now, expires, now));
      statements.push(db.prepare(`INSERT INTO memory_derivation_job_sources(job_id,enrollment_id,event_id,sequence,expires_at)
        SELECT ?,s.enrollment_id,s.event_id,s.sequence,s.expires_at ${sources}
          AND s.sequence<=(SELECT through_sequence FROM memory_derivation_jobs WHERE job_id=?) ORDER BY s.sequence,s.event_id`)
        .bind(jobId, ...sourceBindings, jobId));
      cursorWrites.push(statements.length);
      statements.push(db.prepare(`UPDATE memory_derivation_cursors SET registered_through_sequence=COALESCE(
        (SELECT through_sequence FROM memory_derivation_jobs WHERE job_id=?),?),generation=generation+1,updated_at=?
        WHERE consent_id=? AND registered_through_sequence=? AND generation=?`)
        .bind(jobId, through, now, g.consent_id, after, cursor?.generation ?? 0));
      assert({ condition: "changes()=1", bindings: [] });
      assert({ condition: `EXISTS(SELECT 1 FROM memory_derivation_cursors c WHERE c.consent_id=? AND c.generation=?
          AND ((c.registered_through_sequence=? AND NOT EXISTS(SELECT 1 ${sources}))
          OR EXISTS(SELECT 1 FROM memory_derivation_jobs j WHERE j.job_id=? AND j.consent_id=c.consent_id AND j.through_sequence=c.registered_through_sequence
            AND j.source_count=(SELECT COUNT(*) FROM memory_derivation_job_sources d WHERE d.job_id=j.job_id)
            AND j.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))`,
        bindings: [g.consent_id, (cursor?.generation ?? 0) + 1, through, ...sourceBindings, jobId] });
      assert(derivationRowGuard("memory_derivation_grants", DERIVATION_GRANT_COLUMNS, g));
      assert(derivationQualificationGuard(qualification.row));
      registeredPurposes++;
    }
  }
  assert(schema.guard);
  if (!current() || registeredPurposes && !enabled()) fail();
  let used = false;
  return { statements, registeredPurposes, capacityPurposes,
    acknowledge(raw: unknown) { if (used) return false; used = true;
      return current() && (!registeredPurposes || enabled()) && derivationResults(raw, statements.length)
        && asserted.every(index => derivationVerified(raw[index]!)) && cursorWrites.every(index => derivationChanged(raw[index]!, 1)); } };
}

/** Catch up existing references even with no new extractive page/checkpoint.
 * One native scope per invocation. No provider, lease or budget is admitted here. */
export async function registerNativeDerivationBacklog(env: WorkerEnv, e: LiveMemoryEnrollment, now: string) {
  if (!memoryDerivationEnabled(env, e.actor_user_id) || !e.learn_enabled || !e.background_enabled) return { registeredPurposes: 0, capacityPurposes: 0 };
  const db = env.DB, authority = await liveMemoryAuthority(env, e);
  if (!authority || env.DB !== db) throw new Error("memory-derivation-delivery-unavailable");
  const delivery = await prepareNativeDerivationDelivery(env, e, e.cursor_sequence, now);
  const guard = liveMemoryEnrollmentGuard(e, "learn"), statements = [derivationAssertion(env, authority.guard), derivationAssertion(env, guard),
    ...delivery.statements, derivationAssertion(env, authority.guard), derivationAssertion(env, guard)];
  const result = structuredClone(await db.batch<Row>(statements));
  if (env.DB !== db || !derivationResults(result, statements.length) || ![0, 1, statements.length - 2, statements.length - 1].every(index => derivationVerified(result[index]!))
    || !delivery.acknowledge(result.slice(2, -2))) throw new Error("memory-derivation-delivery-unconfirmed");
  return { registeredPurposes: delivery.registeredPurposes, capacityPurposes: delivery.capacityPurposes };
}

/** Expired reference jobs are erased, never treated as completed processing.
 * Keep active cursors so a later invocation cannot resurrect their ranges. */
export async function sweepNativeDerivationJobs(env: WorkerEnv) {
  const db = env.DB, schema = await memoryDerivationSchema(env), selected = `SELECT job_id FROM memory_derivation_jobs
    WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY expires_at,job_id LIMIT 128`;
  let cascades = 0;
  const counter = `SELECT (SELECT COUNT(*) FROM memory_derivation_job_sources WHERE job_id IN(${selected}))${schema.completionPresent ? `+
    (SELECT COUNT(*) FROM memory_derivation_completions WHERE job_id IN(${selected}))` : ""}${schema.resultsPresent ? `+
    (SELECT COUNT(*) FROM memory_derivation_results WHERE job_id IN(${selected}))+
    (SELECT COUNT(*) FROM memory_derivation_result_dependencies WHERE job_id IN(${selected}))` : ""}${schema.financePresent ? `+
    (SELECT COUNT(*) FROM memory_derivation_job_finance WHERE job_id IN(${selected}))+
    (SELECT COUNT(*) FROM memory_derivation_finance f JOIN memory_derivation_job_finance link ON link.finance_id=f.finance_id
      WHERE link.job_id IN(${selected}) AND f.admission_closed_at IS NULL)` : ""} AS count`;
  if (schema.jobsPresent) {
    const observed = structuredClone(await db.prepare(counter).all<Row>());
    if (!derivationResults([observed], 1) || observed.results.length !== 1 || !derivationExact(observed.results[0], ["count"])
      || !derivationInteger(observed.results[0]!.count, 0, 128 * (130 + 2 + 2048))) fail();
    cascades = observed.results[0]!.count as number;
  }
  const statements = [derivationAssertion(env, schema.guard), ...(schema.jobsPresent ? [
    derivationAssertion(env, { condition: `(${counter})=?`, bindings: [cascades] }),
    db.prepare(`DELETE FROM memory_derivation_jobs WHERE job_id IN(${selected})`), db.prepare("SELECT changes() AS direct_changes")] : []), derivationAssertion(env, schema.guard)];
  if (env.DB !== db) fail();
  const result = structuredClone(await db.batch<Row>(statements)), direct = schema.jobsPresent ? result[3]?.results[0]?.direct_changes : 0;
  if (env.DB !== db || !derivationResults(result, statements.length) || !derivationVerified(result[0]!) || !derivationVerified(result.at(-1)!)
    || schema.jobsPresent && (!derivationVerified(result[1]!) || result[3]?.results.length !== 1 || !derivationExact(result[3].results[0], ["direct_changes"])
      || !derivationInteger(direct, 0, 128) || !derivationChanged(result[2]!, Number(direct), cascades))) throw new Error("memory-derivation-cleanup-unconfirmed");
}
