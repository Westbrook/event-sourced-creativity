import { parseMemoryBehavioralResult, type ParsedMemoryBehavioralDerivation } from './memory-behavioral-result.ts';
import { prepareNativeDerivationCompletion } from "./memory-derivation-completion.ts";
import type { WorkerEnv } from './runtime.ts';
import { memoryCanonical, type MemorySqlGuard } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { derivationExact, derivationHash, derivationId, derivationInteger } from './memory-derivation-policy.ts';
import { derivationAssertion, derivationChanged, derivationResults, derivationVerified, memoryDerivationSchema } from './memory-derivation-store.ts';
import { DERIVATION_RESULT_TABLE_COLUMNS } from './memory-derivation-results-schema.ts';
import { nativeDerivationCandidateInputs, nativeDerivationCandidateStatements, type NativeDerivationCandidateReceipt } from './memory-derivation-provider.ts';
import { observeNativeDerivationJob, nativeDerivationEvidenceInputs } from './memory-derivation-admission.ts';
import { captureNativeDerivationSources, nativeDerivationSourceInputs, type NativeDerivationSourceCapture } from './memory-derivation-sources.ts';
import { nativeDerivationManifestInputs, nativeDerivationManifestStatements, revalidateNativeDerivationManifest,
  type NativeDerivationManifest, type NativeDerivationManifestData } from './memory-derivation-manifest.ts';
import { parseMemoryDerivationResult, type ParsedMemoryDerivation } from './memory-derivation-result.ts';

type Row = Record<string, string | number | null>;
type Dependency = { kind: 'event' | 'content' | 'turn' | 'task'; resource_id: string; actor_user_id: string; scope_key: string };
const columns = DERIVATION_RESULT_TABLE_COLUMNS.memory_derivation_results;
const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const retire = `state='withdrawn',raw_json=NULL,manifest_json=NULL,output_sha256=NULL,manifest_sha256=NULL,retired_at=MAX(published_at,${clock})`;
const validProof = (row: D1Result<Record<string, unknown>>) => derivationVerified(row)
  || row.results.length === 1 && derivationExact(row.results[0], ['context_source_asserted']) && row.results[0]!.context_source_asserted === 1;

/** Native manifest only. Stored JSON is never passed here before exact native
 * comparison. Saved ancestry references remain inverses even if already absent. */
function dependencies(manifest: NativeDerivationManifestData): Dependency[] {
  const rows = new Map<string, Dependency>();
  const add = (kind: Dependency['kind'], resource_id: string, actor_user_id = '', scope_key = '') => {
    const row = { kind, resource_id, actor_user_id, scope_key }; rows.set(memoryCanonical(row), row);
  };
  for (const event of manifest.provenance.events) add('event', event.eventId);
  for (const artifact of manifest.provenance.artifacts??[]) {
    add('content',artifact.contentRef);
    for(const eventId of artifact.eventIds)add('event',eventId);
  }
  for(const reuse of manifest.provenance.reuseBindings?.entries??[]){add('content',reuse.previewRef);for(const eventId of reuse.eventIds)add('event',eventId);}
  for (const relation of manifest.provenance.relationBindings?.entries??[]) for(const eventId of relation.eventIds)add('event',eventId);
  for(const inspected of manifest.provenance.blockInspections??[])for(const eventId of [inspected.eventId,...inspected.eventIds])add('event',eventId);
  for (const block of manifest.provenance.blockBindings?.entries??[]) for(const eventId of block.eventIds)add('event',eventId);
  for (const original of manifest.originalBacking) add('content', original.contentRef);
  for (const turn of manifest.provenance.turns) add('turn', turn.turnId, turn.actorUserId, turn.scopeKey);
  for (const paid of manifest.provenance.paid) {
    add('task', paid.taskId); add('content', paid.consentRef); add('content', paid.resultRef);
    const turn = manifest.provenance.turns.find(row => row.turnId === paid.turnId);
    if (!turn) throw Error('memory-result-dependency-unavailable');
    for (const ancestor of paid.ancestry) {
      add('turn', ancestor.turnId, turn.actorUserId, turn.scopeKey);
      if (ancestor.userRef) add('content', ancestor.userRef);
      if (ancestor.answerRef) add('content', ancestor.answerRef);
    }
  }
  if (!rows.size || rows.size > 2048) throw Error('memory-result-dependency-capacity');
  return [...rows.values()].sort((a, b) => {
    const x = JSON.stringify([a.kind, a.resource_id, a.actor_user_id, a.scope_key]);
    const y = JSON.stringify([b.kind, b.resource_id, b.actor_user_id, b.scope_key]);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}
const rowGuard = (env: WorkerEnv, row: Row) => derivationAssertion(env, {
  condition: `EXISTS(SELECT 1 FROM memory_derivation_results WHERE ${columns.map(column => column + ' IS ?').join(' AND ')})`,
  bindings: columns.map(column => row[column]!),
});
function dependencyGuard(env: WorkerEnv, jobId: string, expected: Dependency[]) {
  // Exact set equality without relying on SQLite JSON object key ordering.
  return derivationAssertion(env, { condition: `(SELECT COUNT(*) FROM memory_derivation_result_dependencies WHERE job_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM memory_derivation_result_dependencies d
      WHERE d.job_id=? AND (d.kind,d.resource_id,d.actor_user_id,d.scope_key)=(json_extract(expected.value,'$.kind'),
        json_extract(expected.value,'$.resource_id'),json_extract(expected.value,'$.actor_user_id'),json_extract(expected.value,'$.scope_key'))))`,
    bindings: [jobId, expected.length, JSON.stringify(expected), jobId] });
}
async function resultRow(env: WorkerEnv, jobId: string) {
  const db = env.DB, result = structuredClone(await db.prepare(`SELECT ${columns.join(',')} FROM memory_derivation_results WHERE job_id=? LIMIT 2`).bind(jobId).all<Row>());
  if (env.DB !== db || !derivationResults([result], 1) || result.results.length > 1
    || result.results.some(row => !derivationExact(row, columns))) throw Error('memory-result-unavailable');
  return result.results[0] ?? null;
}

/** Atomic body + complete inverse index publication. No provider call, semantic
 * completion cursor or inferred user declaration. An uncertain ACK never causes
 * another purchase; a matching retained active row is idempotent. */
export async function publishNativeDerivationResult(env: WorkerEnv, receipt: NativeDerivationCandidateReceipt) {
  try {
    const db = env.DB, input = nativeDerivationCandidateInputs(env, receipt), schema = await memoryDerivationSchema(env);
    if (!schema.resultsPresent || env.DB !== db) return { status: 'unavailable' as const };
    const manifest = JSON.parse(input.manifest) as NativeDerivationManifestData, jobId = manifest.jobId;
    const expected = dependencies(manifest), previous = await resultRow(env, jobId);
    if (previous?.state === 'withdrawn') return { status: 'withdrawn' as const };
    const row: Row = { job_id: jobId, finance_id: input.financeId, state: 'active', raw_json: input.raw,
      manifest_json: input.manifest, output_sha256: input.outputSha256, manifest_sha256: input.manifestSha256,
      dependency_count: expected.length, published_at: previous?.published_at ?? new Date().toISOString(), expires_at: input.expiresAt, retired_at: null };
    if (previous && memoryCanonical(previous) !== memoryCanonical(row)) return { status: 'unavailable' as const };
    const proof = nativeDerivationCandidateStatements(env, receipt), statements = [...proof, derivationAssertion(env, schema.guard)];
    const writes: [number, number, number?][] = [];
    if (previous) statements.push(rowGuard(env, row));
    else {
      statements.push(derivationAssertion(env, { condition: 'NOT EXISTS(SELECT 1 FROM memory_derivation_results WHERE job_id=?)', bindings: [jobId] }));
      writes.push([statements.length, 1]);
      statements.push(db.prepare(`INSERT INTO memory_derivation_results(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`)
        .bind(...columns.map(column => column === 'state' ? 'staging' : row[column]!)), derivationAssertion(env, { condition: 'changes()=1', bindings: [] }));
      writes.push([statements.length, expected.length]);
      statements.push(db.prepare(`INSERT INTO memory_derivation_result_dependencies(job_id,kind,resource_id,actor_user_id,scope_key)
        SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.resource_id'),json_extract(value,'$.actor_user_id'),json_extract(value,'$.scope_key') FROM json_each(?)`)
        .bind(jobId, JSON.stringify(expected)), derivationAssertion(env, { condition: 'changes()=?', bindings: [expected.length] }));
      statements.push(dependencyGuard(env, jobId, expected));
      writes.push([statements.length, 1, Number(schema.indexPresent)]);
      statements.push(db.prepare("UPDATE memory_derivation_results SET state='active' WHERE job_id=? AND state='staging'").bind(jobId),
        derivationAssertion(env, { condition: 'changes()=1', bindings: [] }));
    }
    statements.push(rowGuard(env, row), dependencyGuard(env, jobId, expected), derivationAssertion(env, schema.guard));
    const completion = schema.completionPresent ? await prepareNativeDerivationCompletion(env,jobId,'stored') : null;
    const completionOffset = statements.length;
    if(completion)statements.push(...completion.statements);
    nativeDerivationCandidateInputs(env, receipt);
    if (env.DB !== db) return { status: 'unavailable' as const };
    const result = structuredClone(await db.batch<Record<string, unknown>>(statements));
    nativeDerivationCandidateInputs(env, receipt);
    if (env.DB !== db || !derivationResults(result, statements.length) || !result.slice(0,completionOffset).every((value, index) => {
      const write = writes.find(([at]) => at === index); return write ? derivationChanged(value, write[1], write[2] ?? 0) : validProof(value);
    }) || completion && !completion.acknowledge(result.slice(completionOffset))) return { status: 'uncertain' as const };
    return { status: 'stored' as const, jobId };
  } catch { return { status: 'uncertain' as const }; }
}

declare const readBrand: unique symbol;
export type NativeDerivationResultRead = Readonly<{ [readBrand]: true }>;
const reads = new WeakMap<NativeDerivationResultRead, { env: WorkerEnv; db: WorkerEnv['DB']; row: Row;
  capture: NativeDerivationSourceCapture; manifest: NativeDerivationManifest; candidate: ParsedMemoryDerivation | ParsedMemoryBehavioralDerivation; dependencies: Dependency[] }>();

/** actorUserId comes from the authenticated native principal, never request JSON.
 * No result body is read before that actor's current scope/purpose proof. */
async function readResult(env: WorkerEnv, actorUserId: string, jobId: string,
  consumer?: { enrollmentId: string; enrollmentRevision: number; guards: readonly MemorySqlGuard[] }): Promise<NativeDerivationResultRead | null> {
  try {
    if (!derivationHash(jobId)) return null;
    const db = env.DB, evidence = await observeNativeDerivationJob(env, actorUserId, jobId);
    if (!evidence || !nativeDerivationEvidenceInputs(env,evidence).resultsPresent || env.DB !== db) return null;
    if (consumer) {
      const parent = nativeDerivationEvidenceInputs(env, evidence).enrollment;
      if (!parent || parent.enrollment_id !== consumer.enrollmentId || parent.revision !== consumer.enrollmentRevision || !consumer.guards.length) return null;
    }
    const row = await resultRow(env, jobId);
    if (!row || row.state !== 'active' || typeof row.raw_json !== 'string' || typeof row.manifest_json !== 'string'
      || typeof row.expires_at !== 'string' || row.expires_at <= new Date().toISOString()
      || await memoryDigest(row.raw_json) !== row.output_sha256 || await memoryDigest(row.manifest_json) !== row.manifest_sha256) return null;
    const parsedManifest=JSON.parse(row.manifest_json) as NativeDerivationManifestData;
    const captured = await captureNativeDerivationSources(env, evidence, {history:parsedManifest.history!==undefined,crossProducerHistory:parsedManifest.history?.version===2,...(parsedManifest.history?.version===2?{historySelection:{jobIds:parsedManifest.history.windowJobIds,boundary:parsedManifest.history.boundary}}:{}),blockBindings:parsedManifest.provenance?.blockBindings!==undefined,relationBindings:parsedManifest.provenance?.relationBindings!==undefined,reuseBindings:parsedManifest.provenance?.reuseBindings!==undefined}); if (captured.status !== 'captured') return null;
    const manifest = await revalidateNativeDerivationManifest(env, captured.capture, row.manifest_json); if (!manifest) return null;
    const source = nativeDerivationSourceInputs(env, captured.capture), expected = dependencies(nativeDerivationManifestInputs(env, manifest).manifest);
    if (row.dependency_count !== expected.length || source.retentionCeiling !== row.expires_at) return null;
    const context={purpose: source.purpose, scopeKey: source.scopeKey,
      manifestId: jobId, manifestRevision: 1, checkedAt: source.checkedAt, validUntil: source.validUntil,
      sources: source.originals, priorItems: [], suppressedLineages: []};
    const candidate = source.behavioralSources?await parseMemoryBehavioralResult(row.raw_json,{...context,observations:source.behavioralSources}):await parseMemoryDerivationResult(row.raw_json,context);
    if (!candidate) return null;
    const handle = Object.freeze({}) as NativeDerivationResultRead;
    reads.set(handle, { env, db, row, capture: captured.capture, manifest, candidate, dependencies: expected });
    const proof = [...nativeDerivationResultStatements(env, handle), ...(consumer?.guards.map(guard => derivationAssertion(env, guard)) ?? [])],
      checked = structuredClone(await db.batch<Record<string, unknown>>(proof));
    if (env.DB !== db || !derivationResults(checked, proof.length) || !checked.every(validProof)) { reads.delete(handle); return null; }
    nativeDerivationResultInputs(env, handle); return handle;
  } catch { return null; }
}
export const readNativeDerivationResult = (env: WorkerEnv, actorUserId: string, jobId: string) => readResult(env, actorUserId, jobId);

/** Ephemeral presentation only. Never returns a publication handle: a future
 * saved consumer needs its own durable destination/boundary dependencies. */
export async function readNativeDerivationPresentation(env: WorkerEnv, actorUserId: string, jobId: string,
  consumer: { enrollmentId: string; enrollmentRevision: number; guards: readonly MemorySqlGuard[] }) {
  const read = await readResult(env, actorUserId, jobId, structuredClone(consumer));
  return read ? nativeDerivationResultInputs(env, read) : null;
}
function currentRead(env: WorkerEnv, handle: NativeDerivationResultRead) {
  const read = reads.get(handle);
  if (!read || read.env !== env || read.db !== env.DB || read.candidate.validUntil <= new Date().toISOString()) throw Error('memory-result-read-unavailable');
  nativeDerivationManifestInputs(env, read.manifest); return read;
}
export function nativeDerivationResultInputs(env: WorkerEnv, handle: NativeDerivationResultRead) {
  const read = currentRead(env, handle);
  const history=nativeDerivationSourceInputs(env,read.capture).history;
  return { jobId: String(read.row.job_id), expiresAt: String(read.row.expires_at), candidate: structuredClone(read.candidate),
    ...(history?{history:{windowCount:history.windowJobIds.length+1,originalPairs:history.originalPairs,boundary:history.boundary,afterSequence:history.afterSequence,throughSequence:history.throughSequence}}:{}) };
}
/** A consumer that writes an answer must carry these statements into its own
 * atomic publication; read success alone is not durable answer authority. */
export function nativeDerivationResultStatements(env: WorkerEnv, handle: NativeDerivationResultRead) {
  const read = currentRead(env, handle);
  return [...nativeDerivationManifestStatements(env, read.manifest), rowGuard(env, read.row),
    dependencyGuard(env, String(read.row.job_id), read.dependencies)];
}

/** Actor-private erasure does not require retaining permission to read the
 * source. Identity comes from a native authenticated principal. This withdraws
 * one result; cross-job lineage suppression is a separate user control. */
export async function withdrawNativeDerivationResult(env: WorkerEnv, actorUserId: string, jobId: string, authorizationGuard?: MemorySqlGuard): Promise<boolean> {
  if (!derivationId(actorUserId) || !derivationHash(jobId)) return false;
  const db = env.DB, schema = await memoryDerivationSchema(env);
  if (!schema.resultsPresent || env.DB !== db) return false;
  const owned = `EXISTS(SELECT 1 FROM memory_derivation_jobs j JOIN memory_derivation_cursors c ON c.consent_id=j.consent_id
    JOIN memory_derivation_grants g ON (g.consent_id,g.grant_id,g.revision)=(c.consent_id,c.grant_id,c.grant_revision)
    WHERE j.job_id=? AND g.actor_user_id=?)`;
  const query = `SELECT state,((SELECT COUNT(*) FROM memory_derivation_result_dependencies WHERE job_id=r.job_id)${schema.indexPresent ? `+(SELECT COUNT(*) FROM memory_derivation_index_intents WHERE job_id=r.job_id AND operation='upsert')` : ''}) AS dependencies
    FROM memory_derivation_results r WHERE r.job_id=? AND ${owned}`;
  const observed = structuredClone(await db.prepare(query).bind(jobId, jobId, actorUserId).all<Record<string, unknown>>());
  if (env.DB !== db || !derivationResults([observed], 1) || observed.results.length > 1) throw Error('memory-result-withdrawal-unconfirmed');
  const row = observed.results[0]; if (!row) return false;
  if (!derivationExact(row, ['state', 'dependencies']) || !['staging', 'active', 'withdrawn'].includes(String(row.state))
    || !derivationInteger(row.dependencies, 0, 2049) || row.state === 'withdrawn' && row.dependencies !== 0) throw Error('memory-result-withdrawal-unconfirmed');
  const change = Number(row.state !== 'withdrawn');
  const statements = [derivationAssertion(env, schema.guard), derivationAssertion(env, { condition: `${owned}
    AND EXISTS(SELECT 1 FROM memory_derivation_results WHERE job_id=? AND state=?)
    AND (SELECT dependencies FROM (${query}))=?`,
    bindings: [jobId, actorUserId, jobId, String(row.state), jobId, jobId, actorUserId, row.dependencies] }),
    db.prepare(`UPDATE memory_derivation_results SET ${retire} WHERE job_id=? AND state IN('staging','active')`).bind(jobId),
    derivationAssertion(env, { condition: 'changes()=?', bindings: [change] }), derivationAssertion(env, {
      condition: `EXISTS(SELECT 1 FROM memory_derivation_results WHERE job_id=? AND state='withdrawn' AND raw_json IS NULL AND manifest_json IS NULL)
        AND NOT EXISTS(SELECT 1 FROM memory_derivation_result_dependencies WHERE job_id=?)`, bindings: [jobId, jobId] }), ...(authorizationGuard ? [derivationAssertion(env,authorizationGuard)] : [])];
  const result = structuredClone(await db.batch<Record<string, unknown>>(statements));
  if (env.DB !== db || !derivationResults(result, statements.length) || authorizationGuard && !derivationVerified(result[5]!) || ![0, 1, 3, 4].every(index => derivationVerified(result[index]!))
    || !derivationChanged(result[2]!, change, row.dependencies)) throw Error('memory-result-withdrawal-unconfirmed');
  return true;
}

/** Bounded source-free expiry. Retire private payloads and inverses, retaining
 * only a job-lifetime tombstone so a delayed receipt cannot resurrect them. */
export async function sweepNativeDerivationResults(env: WorkerEnv) {
  const db = env.DB, schema = await memoryDerivationSchema(env);
  if (!schema.resultsPresent || env.DB !== db) return 0;
  const selected = `SELECT job_id FROM memory_derivation_results WHERE state IN('staging','active') AND expires_at<=${clock} ORDER BY expires_at,job_id LIMIT 16`;
  const counter = `SELECT (SELECT COUNT(*) FROM memory_derivation_results WHERE job_id IN(${selected})) AS count,
    ((SELECT COUNT(*) FROM memory_derivation_result_dependencies WHERE job_id IN(${selected}))${schema.indexPresent ? `+(SELECT COUNT(*) FROM memory_derivation_index_intents WHERE operation='upsert' AND job_id IN(${selected}))` : ''}) AS dependencies`;
  const observed = structuredClone(await db.prepare(counter).all<Record<string, unknown>>());
  if (env.DB !== db || !derivationResults([observed], 1) || observed.results.length !== 1 || !derivationExact(observed.results[0], ['count', 'dependencies'])) throw Error('memory-result-expiry-unconfirmed');
  const row = observed.results[0]!;
  if (!derivationInteger(row.count, 0, 16) || !derivationInteger(row.dependencies, 0, 16 * 2049)) throw Error('memory-result-expiry-unconfirmed');
  const statements = [derivationAssertion(env, schema.guard), derivationAssertion(env, {
    condition: `(SELECT count FROM (${counter}))=? AND (SELECT dependencies FROM (${counter}))=?`, bindings: [row.count, row.dependencies] }),
    db.prepare(`UPDATE memory_derivation_results SET ${retire} WHERE job_id IN(${selected})`),
    derivationAssertion(env, { condition: 'changes()=?', bindings: [row.count] })];
  const result = structuredClone(await db.batch<Record<string, unknown>>(statements));
  if (env.DB !== db || !derivationResults(result, statements.length) || ![0, 1, 3].every(index => derivationVerified(result[index]!))
    || !derivationChanged(result[2]!, row.count, row.dependencies)) throw Error('memory-result-expiry-unconfirmed');
  return row.count;
}

/** Native-only edit targets. The browser supplies a claim key, never replacement
 * source identities or retention deadlines. */
export function nativeDerivationResultControlTarget(env: WorkerEnv, handle: NativeDerivationResultRead, claimKey: string) {
  const read=currentRead(env,handle),source=nativeDerivationSourceInputs(env,read.capture);
  const item=read.candidate.items.find(item=>item.claimKey===claimKey);
  if(!item)throw Error('memory-user-control-target-unavailable');
  return { actorUserId:source.binding.actorUserId,enrollmentId:source.binding.enrollmentId,purpose:source.purpose,scopeKey:source.scopeKey,claimKey,
    lineages:item.lineageIds.map(lineageId=>{
      const original=source.originals.find(original=>original.lineageId===lineageId&&original.role==='user');
      const backing=source.originalBacking.find(row=>row.eventId===original?.sourceId);
      if(original&&backing)return {lineageId,kind:'original' as const,sourceContentRef:backing.contentRef,expiresAt:[original.expiresAt,source.retentionCeiling].sort()[0]!};
      const observed=source.behavioralSources?.find(row=>row.lineageId===lineageId);
      if(!observed)throw Error('memory-user-control-target-unavailable');
      return {lineageId,kind:'observation' as const,sourceContentRef:observed.sourceId,expiresAt:[observed.expiresAt,source.retentionCeiling].sort()[0]!};
    }) };
}
