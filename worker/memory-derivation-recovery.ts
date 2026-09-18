import type { WorkerEnv } from './runtime.ts';
import { memoryCanonical } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { DERIVATION_RECOVERY_COLUMNS } from './memory-derivation-recovery-schema.ts';
import { DERIVATION_JOB_COLUMNS } from './memory-derivation-job-schema.ts';
import { derivationConsentId, derivationExact, derivationHash, derivationId, derivationInteger, derivationTime } from './memory-derivation-policy.ts';
import { derivationAssertion, derivationChanged, derivationResults, derivationVerified, memoryDerivationSchema } from './memory-derivation-store.ts';
import { reconcileNativeDerivationFinance, recoverNativeDerivationNoDispatch } from './memory-derivation-finance.ts';

type Row = Record<string, unknown>;
const fail = (): never => { throw Error('memory-derivation-recovery-unconfirmed'); };
const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export const MEMORY_DERIVATION_RECOVERY_PAGE = 2;
export const MEMORY_DERIVATION_UNFUNDED_ATTEMPTS = 8;

/** Source-free maintenance, not admission. Only an expired lease for which the
 * original deterministic financial identity AND private bridge never exist can
 * become waiting again. The next claim must reprove native access and originals.
 * A lost reservation acknowledgement, removed bridge, or possible dispatch can
 * never become another attempt through this path. */
export async function recoverNativeDerivationUnfundedLease(env: WorkerEnv, jobId: string): Promise<'waiting' | 'exhausted' | 'unchanged'> {
  if (!derivationHash(jobId)) return 'unchanged';
  const db = env.DB, schema = await memoryDerivationSchema(env);
  if (!schema.financePresent || env.DB !== db) return 'unchanged';
  const read = structuredClone(await db.prepare(`SELECT ${DERIVATION_JOB_COLUMNS.join(',')} FROM memory_derivation_jobs
    WHERE job_id=? AND state='leased' AND lease_expires_at<=${clock} AND expires_at>${clock} LIMIT 2`).bind(jobId).all<Row>());
  if (env.DB !== db || !derivationResults([read], 1) || read.results.length > 1) return fail();
  const job = read.results[0]; if (!job) return 'unchanged';
  if (!derivationExact(job, DERIVATION_JOB_COLUMNS) || job.job_id !== jobId || job.state !== 'leased'
    || !derivationConsentId(job.lease_token) || !derivationInteger(job.attempts, 1)
    || !derivationTime(job.lease_expires_at) || !derivationTime(job.expires_at) || !derivationTime(job.not_before)
    || Object.values(job).some(value => value !== null && typeof value !== 'string' && !Number.isSafeInteger(value))) return fail();
  const financeId = await memoryDigest(memoryCanonical(['native-memory-finance-v1', jobId, job.lease_token]));
  const unfunded = `NOT EXISTS(SELECT 1 FROM memory_derivation_job_finance WHERE job_id=?)
    AND NOT EXISTS(SELECT 1 FROM memory_derivation_finance WHERE finance_id=?)
    AND NOT EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id IN(?,?))
    AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id IN(?,?))`;
  const bindings = [jobId, financeId, financeId + ':tokens', financeId + ':usd', financeId + ':tokens', financeId + ':usd'];
  const exhausted = job.attempts >= MEMORY_DERIVATION_UNFUNDED_ATTEMPTS;
  const delaySeconds = 60 * 2 ** Math.min(job.attempts - 1, 6);
  // A due-row comparison includes every original column. A concurrent claimant,
  // privacy inverse or financial writer cannot be silently overwritten.
  const same = DERIVATION_JOB_COLUMNS.map(column => column + ' IS ?').join(' AND ');
  const statements = [derivationAssertion(env, schema.guard),
    db.prepare(`UPDATE memory_derivation_jobs SET state='waiting',lease_token=NULL,lease_expires_at=NULL,
      not_before=MAX(not_before,CASE WHEN ?=1 THEN expires_at ELSE MIN(expires_at,strftime('%Y-%m-%dT%H:%M:%fZ','now','+'||?||' seconds')) END),failure_code='interrupted' WHERE ${same}
      AND state='leased' AND lease_expires_at<=${clock} AND expires_at>${clock} AND ${unfunded}`)
      .bind(exhausted ? 1 : 0, delaySeconds, ...DERIVATION_JOB_COLUMNS.map(column => job[column] as string | number | null), ...bindings),
    db.prepare('SELECT changes() AS changed'), derivationAssertion(env, schema.guard)];
  if (env.DB !== db) return fail();
  const result = structuredClone(await db.batch<Row>(statements));
  const changed = result[2]?.results[0]?.changed;
  if (env.DB !== db || !derivationResults(result, statements.length) || !derivationVerified(result[0]!) || !derivationVerified(result[3]!)
    || result[2]!.results.length !== 1 || !derivationExact(result[2]!.results[0], ['changed'])
    || !derivationInteger(changed, 0, 1) || !derivationChanged(result[1]!, changed)) return fail();
  return changed ? exhausted ? 'exhausted' : 'waiting' : 'unchanged';
}

/** One bounded, source-free financial recovery page. It never reads private
 * content, calls a provider, releases ambiguous dispatches, or creates holds.
 * Rollout/consent withdrawal does not prevent paying original verified usage.
 * The cursor is scan position only, never an authority or a completion claim. */
export async function reconcileNativeDerivationPage(env: WorkerEnv, after: string | null = null) {
  if (after !== null && !derivationId(after)) return fail();
  const db = env.DB, schema = await memoryDerivationSchema(env);
  if (!schema.financePresent) return { status: 'schema-unavailable' as const, considered: 0, recovered: 0, failed: 0, more: false, cursor: null };
  const eligible = `FROM memory_derivation_finance f
    LEFT JOIN memory_derivation_usage usage ON usage.finance_id=f.finance_id
    LEFT JOIN memory_derivation_no_dispatch unused ON unused.finance_id=f.finance_id
    LEFT JOIN budget_reservations token ON token.reservation_id=f.token_id
    LEFT JOIN cost_budget_reservations cost ON cost.reservation_id=f.cost_id
    WHERE (? IS NULL OR f.finance_id>?)
    AND (usage.finance_id IS NOT NULL AND (token.status IS NOT CASE WHEN usage.used_tokens>0 THEN 'settled' ELSE 'released' END
        OR token.used_tokens IS NOT usage.used_tokens OR token.settled_at IS NULL
        OR cost.status IS NOT CASE WHEN usage.used_microusd>0 THEN 'settled' ELSE 'released' END
        OR cost.used_microusd IS NOT usage.used_microusd OR cost.settled_at IS NULL)
      OR unused.finance_id IS NOT NULL AND ((unused.token_was_present=1 OR token.reservation_id IS NOT NULL)
          AND (token.status IS NOT 'released' OR token.used_tokens IS NOT 0 OR token.settled_at IS NULL)
        OR (unused.cost_was_present=1 OR cost.reservation_id IS NOT NULL)
          AND (cost.status IS NOT 'released' OR cost.used_microusd IS NOT 0 OR cost.settled_at IS NULL))
      OR usage.finance_id IS NULL AND unused.finance_id IS NULL AND f.dispatch_token IS NULL
      AND (f.admission_closed_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM memory_derivation_job_finance link
        JOIN memory_derivation_jobs job ON job.job_id=link.job_id WHERE link.finance_id=f.finance_id
        AND job.state='leased' AND job.lease_expires_at>${clock} AND job.expires_at>${clock})))`;
  const statements = [derivationAssertion(env, schema.guard), db.prepare(`SELECT f.finance_id ${eligible} ORDER BY f.finance_id LIMIT ?`)
    .bind(after, after, MEMORY_DERIVATION_RECOVERY_PAGE + 1)];
  if (env.DB !== db) return fail();
  const result = structuredClone(await db.batch<Row>(statements));
  if (env.DB !== db || !derivationResults(result, 2) || !derivationVerified(result[0]!)
    || result[1]!.results.length > MEMORY_DERIVATION_RECOVERY_PAGE + 1
    || result[1]!.results.some(row => !derivationExact(row, ['finance_id']) || !derivationId(row.finance_id))
    || result[1]!.results.some((row, index, rows) => index > 0 && String(row.finance_id) <= String(rows[index - 1]!.finance_id))) return fail();
  const selected = result[1]!.results.slice(0, MEMORY_DERIVATION_RECOVERY_PAGE);
  let recovered = 0, failed = 0;
  for (const row of selected) {
    if (env.DB !== db) return fail();
    try {
      // The original receipt/fence is replayed in the settlement transaction.
      // An eligible SELECT itself grants no mutation or refund permission.
      if (await reconcileNativeDerivationFinance(env, String(row.finance_id))
        || await recoverNativeDerivationNoDispatch(env, String(row.finance_id))) recovered++;
      else failed++;
    } catch { failed++; }
    if (env.DB !== db) return fail();
  }
  return { status: failed ? 'partial' as const : 'completed' as const, considered: selected.length, recovered, failed,
    more: result[1]!.results.length > MEMORY_DERIVATION_RECOVERY_PAGE, cursor: selected.length ? String(selected.at(-1)!.finance_id) : null };
}

/** Bounded existing-worker maintenance hook. Scheduling registration is outside
 * this module. A partial result is visible to its caller, never called complete. */
export async function maintainNativeDerivationRecovery(env: WorkerEnv) {
  const db = env.DB, schema = await memoryDerivationSchema(env);
  if (env.DB !== db) return fail();
  if (!schema.recoveryPresent) return { financial: { status: 'schema-unavailable' as const, considered: 0, recovered: 0, failed: 0, more: false, cursor: null },
    requeued: 0, exhausted: 0, failed: 0, cursorAdvanced: false };
  const cursorRead = structuredClone(await db.batch<Row>([derivationAssertion(env, schema.guard),
    db.prepare(`SELECT ${DERIVATION_RECOVERY_COLUMNS.join(',')} FROM memory_derivation_recovery_cursor LIMIT 2`)]));
  if (env.DB !== db || !derivationResults(cursorRead, 2) || !derivationVerified(cursorRead[0]!) || cursorRead[1]!.results.length > 1) return fail();
  const cursor = cursorRead[1]!.results[0];
  if (cursor && (!derivationExact(cursor, DERIVATION_RECOVERY_COLUMNS) || cursor.singleton !== 1
    || cursor.after_finance_id !== null && !derivationId(cursor.after_finance_id)
    || !derivationInteger(cursor.generation, 0, Number.MAX_SAFE_INTEGER - 1) || !derivationTime(cursor.updated_at))) return fail();
  const financial = await reconcileNativeDerivationPage(env, cursor?.after_finance_id as string | null ?? null);
  if (financial.status === 'schema-unavailable' || env.DB !== db) return fail();
  let cursorAdvanced = false;
  if (financial.considered || cursor?.after_finance_id) {
    const next = financial.more ? financial.cursor : null;
    const writes = [derivationAssertion(env, schema.guard),
      ...(!cursor ? [db.prepare(`INSERT INTO memory_derivation_recovery_cursor(singleton,after_finance_id,generation,updated_at)
        SELECT 1,NULL,0,${clock} WHERE NOT EXISTS(SELECT 1 FROM memory_derivation_recovery_cursor)`)] : []),
      db.prepare(`UPDATE memory_derivation_recovery_cursor SET after_finance_id=?,generation=generation+1,updated_at=MAX(updated_at,${clock})
        WHERE singleton=1 AND generation=? AND after_finance_id IS ?${cursor ? ' AND updated_at=?' : ''}`)
        .bind(next, cursor?.generation as number ?? 0, cursor?.after_finance_id as string | null ?? null, ...(cursor ? [String(cursor.updated_at)] : [])),
      db.prepare('SELECT changes() AS changed'), derivationAssertion(env, schema.guard)];
    const receipts = structuredClone(await db.batch<Row>(writes)), changed = receipts.at(-2)?.results[0]?.changed;
    if (env.DB !== db || !derivationResults(receipts, writes.length) || !derivationVerified(receipts[0]!) || !derivationVerified(receipts.at(-1)!)
      || receipts.at(-2)!.results.length !== 1 || !derivationExact(receipts.at(-2)!.results[0], ['changed']) || !derivationInteger(changed, 0, 1)
      || !derivationChanged(receipts.at(-3)!, changed) || !cursor && !(derivationChanged(receipts[1]!, 0) || derivationChanged(receipts[1]!, 1))) return fail();
    cursorAdvanced = changed === 1;
  }
  const statements = [derivationAssertion(env, schema.guard), db.prepare(`SELECT job.job_id FROM memory_derivation_jobs job
    WHERE job.state='leased' AND job.lease_expires_at<=${clock} AND job.expires_at>${clock}
      AND NOT EXISTS(SELECT 1 FROM memory_derivation_job_finance link WHERE link.job_id=job.job_id)
    ORDER BY job.lease_expires_at,job.job_id LIMIT 1`)];
  const result = structuredClone(await db.batch<Row>(statements));
  if (env.DB !== db || !derivationResults(result, 2) || !derivationVerified(result[0]!) || result[1]!.results.length > 1
    || result[1]!.results.some(row => !derivationExact(row, ['job_id']) || !derivationHash(row.job_id))) return fail();
  let requeued = 0, exhausted = 0, failed = financial.failed;
  if (result[1]!.results.length) {
    try {
      const status = await recoverNativeDerivationUnfundedLease(env, String(result[1]!.results[0]!.job_id));
      requeued = status === 'waiting' ? 1 : 0; exhausted = status === 'exhausted' ? 1 : 0;
      // A concurrent privacy inverse/claim is benign; it issues no fresh permit.
    } catch { failed++; }
  }
  if (env.DB !== db) return fail();
  return { financial, requeued, exhausted, failed, cursorAdvanced };
}
