import type { WorkerEnv } from './runtime.ts';
import type { MemorySqlGuard } from './memory-sql.ts';
import { derivationExact, derivationHash, derivationInteger, derivationTime } from './memory-derivation-policy.ts';
import { derivationAssertion, derivationChanged, derivationResults, derivationVerified, memoryDerivationSchema } from './memory-derivation-store.ts';
import { nativeDerivationResultInputs, nativeDerivationResultStatements, type NativeDerivationResultRead } from './memory-derivation-results.ts';
import { DERIVATION_INDEX_COLUMNS as columns } from './memory-derivation-index-schema.ts';

type Row = { job_id: string; operation: 'upsert' | 'delete'; generation: 1 | 2; updated_at: string; expires_at: string | null };
const fail = (): never => { throw Error('memory-index-intent-unavailable'); };
function shape(row: unknown): row is Row {
  return derivationExact(row, columns) && derivationHash(row.job_id) && derivationTime(row.updated_at)
    && (row.operation === 'upsert' && row.generation === 1 && derivationTime(row.expires_at) && row.updated_at < row.expires_at
      || row.operation === 'delete' && row.generation === 2 && row.expires_at === null);
}
function snapshot(row: Row): MemorySqlGuard {
  return { condition: `EXISTS(SELECT 1 FROM memory_derivation_index_intents WHERE ${columns.map(key => key + ' IS ?').join(' AND ')})`,
    bindings: columns.map(key => row[key]) };
}
function verified(row: D1Result<Record<string, unknown>>) {
  return derivationVerified(row) || row.results.length === 1 && derivationExact(row.results[0], ['context_source_asserted']) && row.results[0]!.context_source_asserted === 1;
}
declare const indexBrand: unique symbol;
export type NativeDerivationIndexUpsert = { readonly [indexBrand]: true };
const captures = new WeakMap<NativeDerivationIndexUpsert, { env: WorkerEnv; db: D1Database; read: NativeDerivationResultRead; row: Row; schema: MemorySqlGuard }>();

/** Backfill is explicit and source-validated, never migration data or an old
 * saved receipt. New results already register atomically at publication. This
 * function issues a local preparation, NOT embedding/provider/remote authority. */
export async function captureNativeDerivationIndexUpsert(env: WorkerEnv, read: NativeDerivationResultRead): Promise<NativeDerivationIndexUpsert | null> {
  try {
    const db = env.DB, input = nativeDerivationResultInputs(env, read), schema = await memoryDerivationSchema(env);
    if (!schema.indexPresent || env.DB !== db) return null;
    const found = structuredClone(await db.prepare(`SELECT ${columns.join(',')} FROM memory_derivation_index_intents WHERE job_id=?`).bind(input.jobId).all<Record<string, unknown>>());
    if (env.DB !== db || !derivationResults([found], 1) || found.results.length > 1 || found.results.some(row => !shape(row))) return null;
    const prior = found.results[0] as Row | undefined;
    if (prior && (prior.operation !== 'upsert' || prior.expires_at !== input.expiresAt)) return null;
    const row: Row = prior ?? { job_id: input.jobId, operation: 'upsert', generation: 1, updated_at: new Date().toISOString(), expires_at: input.expiresAt };
    const before = nativeDerivationResultStatements(env, read), statements = [...before, derivationAssertion(env, schema.guard)];
    let write = -1;
    if (!prior) {
      statements.push(derivationAssertion(env, { condition: 'NOT EXISTS(SELECT 1 FROM memory_derivation_index_intents WHERE job_id=?)', bindings: [input.jobId] }));
      write = statements.length;
      statements.push(db.prepare(`INSERT INTO memory_derivation_index_intents(${columns.join(',')}) VALUES(?,?,?,?,?)`).bind(...columns.map(key => row[key])),
        derivationAssertion(env, { condition: 'changes()=1', bindings: [] }));
    }
    statements.push(derivationAssertion(env, snapshot(row)), ...nativeDerivationResultStatements(env, read), derivationAssertion(env, schema.guard));
    if (statements.length > 100 || env.DB !== db) return null;
    const result = structuredClone(await db.batch<Record<string, unknown>>(statements));
    nativeDerivationResultInputs(env, read);
    if (env.DB !== db || !derivationResults(result, statements.length) || !result.every((value, i) => i === write ? derivationChanged(value, 1) : verified(value))) return null;
    const handle = Object.freeze({}) as NativeDerivationIndexUpsert;
    captures.set(handle, { env, db, read, row, schema: schema.guard }); return handle;
  } catch { return null; }
}
function current(env: WorkerEnv, handle: NativeDerivationIndexUpsert) {
  const value = captures.get(handle);
  if (!value || value.env !== env || value.db !== env.DB || value.row.expires_at! <= new Date().toISOString()) return fail();
  nativeDerivationResultInputs(env, value.read); return value;
}
/** Copies are data, not authority. No embeddings or external access is created.
 * An eventual adapter must also qualify consent, transport and paid admission. */
export function nativeDerivationIndexUpsertInputs(env: WorkerEnv, handle: NativeDerivationIndexUpsert) {
  const value = current(env, handle), input = nativeDerivationResultInputs(env, value.read);
  return { jobId: value.row.job_id, generation: 1 as const, expiresAt: input.expiresAt,
    candidate: input.candidate, remoteState: 'unqualified' as const };
}
/** Must be carried into any future final publication/dispatch admission, with
 * all native original/dependency/access proof. A queued pointer is insufficient. */
export function nativeDerivationIndexUpsertStatements(env: WorkerEnv, handle: NativeDerivationIndexUpsert) {
  const value = current(env, handle);
  return [...nativeDerivationResultStatements(env, value.read), derivationAssertion(env, value.schema), derivationAssertion(env, snapshot(value.row))];
}

/** Source-free recovery page. No user access is needed to DELETE already-erased
 * remote data. This is internal worker metadata, not a public endpoint or ACK. */
export async function readNativeDerivationIndexDeletes(env: WorkerEnv, afterJobId?: string, limit = 32) {
  if (afterJobId !== undefined && !derivationHash(afterJobId) || !derivationInteger(limit, 1, 32)) return fail();
  const db = env.DB, schema = await memoryDerivationSchema(env);
  if (!schema.indexPresent || env.DB !== db) return { items: [], next: null, remoteState: 'unqualified' as const };
  const query = `SELECT ${columns.join(',')} FROM memory_derivation_index_intents WHERE operation='delete' AND job_id>? ORDER BY job_id LIMIT ?`, bindings = [afterJobId ?? '', limit + 1];
  const result = structuredClone(await db.prepare(query).bind(...bindings).all<Record<string, unknown>>());
  if (env.DB !== db || !derivationResults([result], 1) || result.results.length > limit + 1 || result.results.some(row => !shape(row) || row.operation !== 'delete')) return fail();
  const rows = result.results as Row[];
  const proof = [derivationAssertion(env, schema.guard), derivationAssertion(env, {
    condition: `(SELECT json_group_array(json_array(${columns.join(',')})) FROM (${query}))=?`, bindings: [...bindings, JSON.stringify(rows.map(row => columns.map(key => row[key])))],
  })];
  const checked = structuredClone(await db.batch<Record<string, unknown>>(proof));
  if (env.DB !== db || !derivationResults(checked, proof.length) || !checked.every(derivationVerified)) return fail();
  return { items: rows.slice(0, limit).map(row => ({ jobId: row.job_id, generation: 2 as const })), next: rows.length > limit ? rows[limit - 1]!.job_id : null, remoteState: 'unqualified' as const };
}

/** Internal, source-free queue diagnostics. Unexpired is NOT source-fresh or
 * remotely indexed; only a new native read can establish current usability. */
export async function readNativeDerivationIndexStatus(env: WorkerEnv) {
  const db = env.DB, schema = await memoryDerivationSchema(env);
  if (!schema.indexPresent || env.DB !== db) return null;
  const observedAt = new Date().toISOString(), query = `SELECT
    COALESCE(SUM(CASE WHEN operation='upsert' AND expires_at>? THEN 1 ELSE 0 END),0) AS unexpiredQueued,
    COALESCE(SUM(CASE WHEN operation='upsert' AND expires_at<=? THEN 1 ELSE 0 END),0) AS expiredQueued,
    COALESCE(SUM(CASE WHEN operation='delete' THEN 1 ELSE 0 END),0) AS pendingDeletes FROM memory_derivation_index_intents`;
  const result = structuredClone(await db.prepare(query).bind(observedAt, observedAt).all<Record<string, unknown>>());
  if (env.DB !== db || !derivationResults([result], 1) || result.results.length !== 1
    || !derivationExact(result.results[0], ['unexpiredQueued', 'expiredQueued', 'pendingDeletes']) || !Object.values(result.results[0]).every(n => derivationInteger(n))) return fail();
  const row = result.results[0] as Record<'unexpiredQueued' | 'expiredQueued' | 'pendingDeletes', number>;
  const proof = [derivationAssertion(env, schema.guard), derivationAssertion(env, { condition: `EXISTS(SELECT 1 FROM (${query}) WHERE unexpiredQueued=? AND expiredQueued=? AND pendingDeletes=?)`,
    bindings: [observedAt, observedAt, row.unexpiredQueued, row.expiredQueued, row.pendingDeletes] })];
  const checked = structuredClone(await db.batch<Record<string, unknown>>(proof));
  if (env.DB !== db || !derivationResults(checked, proof.length) || !checked.every(derivationVerified)) return fail();
  return { ...row, observedAt, remoteState: 'unqualified' as const };
}
