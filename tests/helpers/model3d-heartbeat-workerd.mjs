import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { install } from './model3d-workerd-snapshot.mjs';
const require = createRequire(import.meta.url), wrangler = createRequire(require.resolve('wrangler'));
async function finite(work, ms, name) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('synthetic_runtime_timeout:' + name)), ms);
  })]); } finally { clearTimeout(timer); }
}

/** Replay an actual guarded batch against real local D1, never a live DB. */
export async function verifyHeartbeatInWorkerd(snapshot, statements) {
  const { Miniflare, Log, LogLevel } = wrangler('miniflare');
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-22',
    host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE), d1Databases: ['DB'],
    script: 'export default {fetch(){return new Response("synthetic heartbeat qualification")}}',
    outboundService() { throw Error('network_forbidden'); } });
  try {
    const db = await finite(mf.getD1Database('DB'), 10000, 'heartbeat-db');
    await finite(install(db, snapshot), 35000, 'heartbeat-install');
    for (const statement of statements) {
      assert(statement.bindings.length <= 100, 'D1 write parameter limit including assertion token');
      assert(!statement.bindings.includes(undefined));
    }
    try { await finite(db.batch(statements.map(s => db.prepare(s.sql).bind(...s.bindings))), 10000, 'heartbeat-batch'); }
    catch (error) {
      const failed = [];
      for (let index = 0; index < statements.length; index++) {
        const s = statements[index];
        try { await finite(db.prepare('EXPLAIN QUERY PLAN ' + s.sql).bind(...s.bindings).all(), 1000, 'heartbeat-explain'); }
        catch (compiled) { failed.push({ index, error: String(compiled), sql: s.sql }); }
      }
      throw Error(String(error) + ' compile_failures=' + JSON.stringify(failed));
    }
    return { statements: statements.length, maxBindings: Math.max(...statements.map(s => s.bindings.length)),
      sqlBytes: statements.reduce((total, s) => total + Buffer.byteLength(s.sql), 0) };
  } finally { await finite(mf.dispose(), 10000, 'heartbeat-dispose'); }
}

export async function verifyNativeRunnerInWorkerd(snapshot, fixture, bytes) {
  const { Miniflare, Log, LogLevel } = wrangler('miniflare'), { build } = wrangler('esbuild');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const entry = await readFile(new URL('./model3d-recovery-workerd-entry.ts', import.meta.url), 'utf8');
  const built = await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, absWorkingDir: root,
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*'],
    plugins: [{ name: 'synthetic-native-diagnostics', setup(build) {
      build.onResolve({ filter: /test-results/ }, () => { throw Error('protected input forbidden'); });
      build.onLoad({ filter: /\/worker\/document-jobs-api\.ts$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const marker = 'const detail = localDispatchStop??classifyDocumentJobFailure(error);';
        assert.equal(source.split(marker).length, 2, 'one native diagnostic boundary');
        // Test bundle only. Production keeps its safe public error projection;
        // this worker contains exclusively synthetic inputs and credentials.
        return { loader: 'ts', contents: source.replace(marker,
          'globalThis.__syntheticNativeFailure = String(error); ' + marker) };
      });
    } }] });
  let posts = 0, polls = 0, acceptedAt = 0;
  const base = 'https://queue.fal.run/fal-ai/hyper3d/requests/native-workerd-replacement';
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'],
    host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE), d1Databases: ['Native'], r2Buckets: ['NativeMedia'],
    script: built.outputFiles[0].text, bindings: { FIXTURE: JSON.stringify(fixture) },
    outboundService(request) {
      if (request.method === 'POST' && request.url === 'https://queue.fal.run/fal-ai/hyper3d/rodin/v2.5/text-to-3d') {
        assert.equal(++posts, 1); acceptedAt = Date.now();
        return Response.json({ request_id: 'native-workerd-replacement', status: 'IN_PROGRESS' });
      }
      assert.equal(request.method, 'GET');
      if (request.url === base + '/status?logs=1') {
        polls++;
        return Response.json({ request_id: 'native-workerd-replacement', status: Date.now() - acceptedAt >= 125000 ? 'COMPLETED' : 'IN_PROGRESS' });
      }
      if (request.url === base) return Response.json({ request_id: 'native-workerd-replacement', seed: 7,
        model_mesh: { url: 'https://fal.media/files/native-workerd.glb', file_name: 'native-workerd.glb',
          content_type: 'model/gltf-binary', file_size: bytes.length }, textures: [] });
      if (request.url === 'https://fal.media/files/native-workerd.glb') return new Response(bytes, {
        headers: { 'content-type': 'model/gltf-binary', 'content-length': String(bytes.length) } });
      throw Error('unexpected synthetic outbound request:' + request.url);
    } });
  try {
    const db = await finite(mf.getD1Database('Native'), 10000, 'native-db');
    await finite(install(db, snapshot), 35000, 'native-install');
    const warm = await finite(mf.dispatchFetch('https://qualification.invalid/warm/Native').then(r => r.json()), 10000, 'native-warm');
    assert.equal(warm.ok, true);
    const result = await finite(mf.dispatchFetch('https://qualification.invalid/native-run/Native').then(r => r.json()), 180000, 'native-run');
    assert.equal(result.ok, true, JSON.stringify({ ...result, posts, polls }));
    assert.equal(posts, 1); assert(polls >= 25, 'normal five-second polling reaches both heartbeats');
    assert.equal(result.counters.heartbeats, 2, 'both native guarded heartbeat batches committed');
    return { posts, polls, counters: result.counters };
  } finally { await finite(mf.dispose(), 10000, 'native-dispose'); }
}
