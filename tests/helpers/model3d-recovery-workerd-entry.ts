// Local test entry only. The runner resolves these imports against its pinned
// canonical source root. No product HTTP route or authentication is simulated.
import { outputModel3dRecoveryAvailable } from './worker/output-model3d-recovery-availability.ts';
import { executeOutputModel3dRecovery } from './worker/output-model3d-recovery.ts';
import { claimOutputModel3dRecoveryLease } from './worker/output-model3d-recovery-lease.ts';
import { outputModel3dRecoveryStorage } from './worker/output-model3d-recovery-completion.ts';
import { reconcileOutputNativeStorage } from './worker/output-private-execution.ts';
import { ensureSchema } from './worker/runtime.ts';
import { ensureOutputRequirementsSchema } from './worker/output-requirements-ledger.ts';

const environments = new Map();
const must = (value, label) => { if (!value) throw Error('fixture_assertion:' + label); };
const labels = new Set(['Complete', 'Source', 'Race', 'Lease']);
function environment(bindings, label) {
  if (!environments.has(label)) {
    const real = bindings[label], metrics = { queries: 0, batches: 0, puts: 0, conditionalPuts: 0, deletes: 0, collisionKey: null, queryFailures: [] };
    const native = new WeakMap(), descriptions = new WeakMap();
    const statement = (inner, sql, values = []) => {
      const wrapped = new Proxy(inner, { get(target, key) {
        if (key === 'bind') return (...values) => { must(values.length <= 100 && !values.includes(undefined), 'binding_limit'); return statement(target.bind(...values), sql, values); };
        if (['run', 'all', 'first', 'raw'].includes(String(key))) return async (...args) => {
          metrics.queries++; try { return await target[key](...args); }
          catch (error) { metrics.queryFailures.push({ sql, error: String(error) }); throw Error(String(error) + ' statement=' + sql); }
        };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
      } });
      native.set(wrapped, inner); descriptions.set(wrapped, {sql, values}); return wrapped;
    };
    const DB = new Proxy(real, { get(target, key) {
      if (key === 'prepare') return sql => statement(target.prepare(sql), sql);
      if (key === 'batch') return async inputs => { metrics.batches++; metrics.queries += inputs.length;
        try { return await target.batch(inputs.map(input => native.get(input) ?? input)); }
        catch (error) {
          const failures = [];
          for (let index = 0; index < inputs.length; index++) {
            const d = descriptions.get(inputs[index]); if (!d) continue;
            try { await target.prepare('EXPLAIN QUERY PLAN ' + d.sql).bind(...d.values).all(); }
            catch (compiled) { failures.push({ index, sql: d.sql, error: String(compiled) }); }
          }
          throw Error(String(error) + ' compile_failures=' + JSON.stringify(failures));
        }
      };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const bucket = bindings[label + 'Media'];
    const MEDIA = new Proxy(bucket, { get(target, key) {
      if (key === 'put') return async (name, bytes, options) => {
        metrics.puts++;
        if (options?.onlyIf?.etagDoesNotMatch === '*') metrics.conditionalPuts++;
        if (label === 'Race' && metrics.collisionKey === null) {
          // Deterministic local race at the actual native R2 boundary, after
          // the service's head and SQL reservation. Never fake a put result.
          metrics.collisionKey = name;
          await target.put(name, new Uint8Array([7, 9, 11]), { customMetadata: { ownerId: 'foreign-synthetic-owner' } });
        }
        return target.put(name, bytes, options);
      };
      if (key === 'delete') return names => { metrics.deletes++; return target.delete(names); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    environments.set(label, { env: { ...bindings, DB, MEDIA, FAL_KEY: 'synthetic-unit-test-key-not-a-credential',
      ASSETS: { fetch() { throw Error('local_fixture_assets_forbidden'); } } }, metrics });
  }
  return environments.get(label);
}

export default { async fetch(request, bindings) {
  const [action, label] = new URL(request.url).pathname.slice(1).split('/');
  if (request.method !== 'GET' || !labels.has(label) || !['warm', 'available', 'recover', 'cleanup', 'lease-retention'].includes(action))
    return new Response('Unknown local test action', { status: 404 });
  const f = JSON.parse(bindings.FIXTURE), { env, metrics } = environment(bindings, label);
  const before = { ...metrics, queryFailureCount: metrics.queryFailures.length };
  const counters = () => ({ queries: metrics.queries - before.queries, batches: metrics.batches - before.batches,
    puts: metrics.puts - before.puts, conditionalPuts: metrics.conditionalPuts - before.conditionalPuts,
    deletes: metrics.deletes - before.deletes, collisionKey: metrics.collisionKey,
    queryFailures: metrics.queryFailures.slice(before.queryFailureCount) });
  try {
    if (action === 'warm') {
      // Actual request-local initialization, kept separate from service counts.
      await ensureSchema(env); await ensureOutputRequirementsSchema(env);
      return Response.json({ ok: true, counters: counters() });
    }
    const job = await env.DB.prepare('SELECT * FROM document_jobs WHERE job_id=?').bind(f.jobId).first();
    must(job, 'original_job_missing'); job.output_slot_id = f.slot.slotId;
    if (action === 'available') {
      // Actual read-only advisory, not the service's source/authority proof.
      const value = await outputModel3dRecoveryAvailable(env, f.scope, f.slot, job);
      return Response.json({ ok: true, value, counters: counters() });
    }
    if (action === 'cleanup') {
      const value = await reconcileOutputNativeStorage(env, { ownerUserId: f.scope.ownerUserId, personalOnly: true });
      return Response.json({ ok: true, value, counters: counters() });
    }
    if (action === 'lease-retention') {
      const lease = await claimOutputModel3dRecoveryLease(env, f.scope, f.slot, job, { assertions: f.assertions, current: f.current });
      try {
        await lease.assertCurrent();
        const bytes = new Uint8Array([103, 108, 84, 70]);
        const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
        const location = outputModel3dRecoveryStorage(f.scope.ownerUserId, 'artifact', lease.token, 0, { role: 'mesh', mimeType: 'model/gltf-binary', format: 'glb' });
        const file = { url: location.url, mimeType: 'model/gltf-binary', fileName: 'original.glb', fileSize: bytes.length, format: 'glb', role: 'mesh', sha256: sha };
        const entry = { index: 0, token: lease.token, storageKey: location.storageKey, sha256: sha, file,
          providerMediaUrl: 'https://v3.fal.media/files/test/original.glb' };
        const now = new Date().toISOString();
        // Synthetic storage fixture only; this branch makes no completion or
        // paid receipt and does not pretend four bytes are a qualified mesh.
        await env.DB.batch([
          env.DB.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES(?,?,'experience-draft','{}',?,?)")
            .bind(f.draftId, f.scope.ownerUserId, now, job.expires_at),
          env.DB.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputModel3dRecoveryFiles',json(?)) WHERE job_id=?")
            .bind(JSON.stringify([entry]), f.jobId),
          env.DB.prepare("INSERT INTO output_native_storage_writes(scope_key,slot_id,storage_key,content_sha256,status,write_acknowledged,created_at,updated_at) VALUES(?,?,?,?,'written',1,?,?)")
            .bind(f.scope.key, f.slot.slotId, location.storageKey, sha, now, now),
          env.DB.prepare("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z' WHERE scope_key=? AND grant_id=?")
            .bind(f.scope.key, f.slot.grantId),
        ]);
        const put = await env.MEDIA.put(location.storageKey, bytes, { onlyIf: { etagDoesNotMatch: '*' }, customMetadata: {
          outputNativeStorage: '1', outputScopeKey: f.scope.key, outputSlotId: f.slot.slotId,
          outputOwnerId: f.scope.ownerUserId, outputDocumentId: f.scope.documentId, outputSha256: sha,
        } });
        must(put, 'retention_fixture_put');
        const live = await reconcileOutputNativeStorage(env, { ownerUserId: f.scope.ownerUserId, personalOnly: true });
        must(live.reconciled === 0 && live.pending === 0 && await env.MEDIA.head(location.storageKey), 'live_lease_retention');
        // Revocation remains stronger than this short retention-only grace.
        await env.DB.prepare("UPDATE output_execution_grants SET status='revoked' WHERE scope_key=? AND grant_id=?")
          .bind(f.scope.key, f.slot.grantId).run();
        const revoked = await reconcileOutputNativeStorage(env, { ownerUserId: f.scope.ownerUserId, personalOnly: true });
        must(revoked.reconciled === 1 && revoked.pending === 0 && !await env.MEDIA.head(location.storageKey), 'revocation_cleanup');
        return Response.json({ ok: true, live, revoked, storageKey: location.storageKey, counters: counters() });
      } finally { await lease.release(); }
    }
    const value = await executeOutputModel3dRecovery(env, f.user, job, { scope: f.scope, slot: f.slot, retentionPolicy: null },
      { assertions: f.assertions, current: f.current, signal: request.signal });
    return Response.json({ ok: true, value, counters: counters() });
  } catch (error) {
    // Only synthetic local fixture failures; no live private data can enter.
    return Response.json({ ok: false, error: String(error), counters: counters() }, { status: 409 });
  }
} };
