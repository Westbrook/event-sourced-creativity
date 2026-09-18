import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { install, rowsSnapshot } from './helpers/model3d-workerd-snapshot.mjs';

// This is an actual-local-D1 harness. The application modules run in Node
// against the real Miniflare D1 binding; the byte receiver is synthetic.
// No R2 binding, setup PUT, account, provider, or public application route exists.
const sha = value => createHash('sha256').update(value).digest('hex');
const phase = (name, detail = {}) => process.stderr.write(`[guest-result-claim-source-d1] ${JSON.stringify({ phase: name,
  pid: process.pid, ppid: process.ppid, runnerPgid: process.env.FORMA_TEST_PGID ?? null, ...detail })}\n`);
const sourcePaths = [
  'worker/experience-guest-image-result-claim-source.ts',
  'worker/experience-guest-image-result-media-operation.ts', 'worker/experience-guest-image-result-media.ts',
  'worker/experience-guest-image-result-inventory.ts', 'worker/experience-guest-image-result-facts.ts',
  'worker/experience-guest-image-result-contract.ts', 'worker/experience-guest-image-result-copy-contract.ts',
  'worker/experience-guest-image-result-copy-schema.ts', 'worker/experience-guest-image-result-claim-contract.ts',
  'worker/experience-guest-image-copy-contract.ts', 'worker/experience-guest-image-claim.ts', 'worker/event-privacy.ts',
  'tests/experience-guest-image-result-claim-contract.test.mjs',
  'worker/experience-guest-image-history.ts', 'worker/experience-guest-image-stage-facts.ts',
  'worker/experience-guest-image-stage-claim-inventory.ts', 'worker/experience-guest-sponsor-contract.ts',
  'worker/experience-sponsor-image-format.ts', 'worker/experience-guest-image-admission-witness.ts',
  'worker/experience-guest-image-execution.ts', 'worker/experience-guest-image-driver.ts',
  'worker/experience-guest-context-adoption.ts', 'worker/experience-guest-plan-custody.ts',
  'worker/experience-guest-image-claim-inventory.ts', 'worker/experience-guest-image-stage-custody.ts',
  'worker/experience-guest-session.ts', 'worker/principal-request-core.ts',
  'worker/intake-authority.ts', 'worker/policy-version.ts',
  'src/experiences/compiler.ts', 'src/model/output-asset-inspection.ts', 'src/model/media-ownership.ts',
  'tests/experience-guest-image-result-claim-source-d1.test.mjs',
  'tests/experience-guest-image-result-claim-source.test.mjs',
  'tests/helpers/guest-image-result-media-fixture.mjs', 'tests/helpers/guest-image-result-inventory-fixture.mjs',
  'tests/helpers/guest-image-run-fixture.mjs', 'tests/helpers/guest-image-admission-fixture.mjs',
  'tests/helpers/guest-image-issuer-fixture.mjs', 'tests/helpers/guest-image-stage-fixture.mjs',
  'tests/helpers/d1-expression-depth.mjs', 'tests/helpers/model3d-workerd-snapshot.mjs',
  'cloudflare.d.ts', 'package.json', 'pnpm-lock.yaml',
];
const sourcePins = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, sha(await readFile(new URL('../' + path, import.meta.url)))])));
async function bookends(t, label) {
  const before = await sourcePins(); phase('source-bookend-before', { label, sourcePins: before });
  t.after(async () => {
    const after = await sourcePins(); phase('source-bookend-after', { label, sourcePins: after });
    assert.deepEqual(after, before, 'production, fixture, inspector and compiler bytes stay fixed during qualification');
  });
}
async function finite(pending, milliseconds, label) {
  let timer;
  try { return await Promise.race([pending, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`guest_claim_source_fixture_timeout:${label}`)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
// Parent host guard derived from the independently reviewed standalone source
// a15a6a33740bc53d6148975c13a0ff8d6cf50f4777ad6df5d70308686d5d4b23.
// This adaptation adds reversible ownership and the exact pinned synchronous
// binding-proxy Worker. It does not claim arbitrary Worker/subprocess/OS isolation.
let activeHostGuard = false;
function installHostNetworkGuard(miniflareEntry) {
  assert.equal(activeHostGuard, false, 'a previous owned runtime must finish cleanup before another starts');
  activeHostGuard = true;
  const require = createRequire(import.meta.url), mfRequire = createRequire(miniflareEntry);
  const net = require('node:net'), tls = require('node:tls'), http = require('node:http'), https = require('node:https');
  const dns = require('node:dns'), dgram = require('node:dgram'), workerThreads = require('node:worker_threads');
  const patches = [], events = [], allowed = {}, proxyWorkers = [], state = { phase: 'setup', restored: false };
  const hadCfFlag = Object.hasOwn(process.env, 'CLOUDFLARE_CF_FETCH_ENABLED'), previousCfFlag = process.env.CLOUDFLARE_CF_FETCH_ENABLED;
  let undici, previousDispatcher, installedDispatcher, identity, controls;
  function patch(object, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    assert.ok(!descriptor || Object.hasOwn(descriptor, 'value'), `guard replacement requires a data property: ${name}`);
    Object.defineProperty(object, name, descriptor ? { ...descriptor, value } : { value, writable: true, configurable: true });
    patches.push(() => { if (descriptor) Object.defineProperty(object, name, descriptor); else delete object[name]; });
  }
  function restore() {
    if (state.restored) return;
    const failures = [];
    if (undici && previousDispatcher) {
      try { undici.setGlobalDispatcher(previousDispatcher); } catch (error) { failures.push(error); }
    }
    // Restore the borrowed dispatcher by identity; never close or destroy it.
    for (const undo of [...patches].reverse()) { try { undo(); } catch (error) { failures.push(error); } }
    try { syncBuiltinESMExports(); } catch (error) { failures.push(error); }
    try { if (hadCfFlag) process.env.CLOUDFLARE_CF_FETCH_ENABLED = previousCfFlag; else delete process.env.CLOUDFLARE_CF_FETCH_ENABLED; }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'host guard restoration failed');
    state.restored = true; activeHostGuard = false;
  }
  function deny(transport, target) {
    const error = new Error(`FORMA_HOST_EGRESS_DENIED ${transport} ${String(target)}`); error.code = 'FORMA_HOST_EGRESS_DENIED';
    events.push({ phase: state.phase, transport, target: String(target) }); throw error;
  }
  function host(transport, value) {
    const hostname = String(value ?? 'localhost').toLowerCase();
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) deny(transport, hostname);
    allowed[transport] = (allowed[transport] ?? 0) + 1; return hostname;
  }
  function origin(transport, value) {
    let url; try { url = new URL(String(value)); } catch { deny(transport, 'invalid origin'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) deny(transport, 'invalid origin');
    host(transport, url.hostname);
  }
  function socket(transport, args) {
    let values = args; if (Array.isArray(values[0])) values = values[0]; const first = values[0]; let options;
    if (first && typeof first === 'object') options = first;
    else if (typeof first === 'number' || typeof first === 'string' && /^\d+$/u.test(first)) {
      options = { port: first, host: typeof values[1] === 'string' ? values[1] : 'localhost' };
    } else deny(transport, 'unsupported socket arguments');
    if (options.path !== undefined || options.socketPath !== undefined || options.fd !== undefined
      || options.lookup !== undefined || options.socket !== undefined) deny(transport, 'unreviewed socket path/fd/lookup/socket');
    if (!Number.isInteger(Number(options.port)) || Number(options.port) < 1 || Number(options.port) > 65535) deny(transport, 'invalid port');
    host(transport, options.host ?? options.hostname ?? 'localhost');
  }
  function request(transport, args) {
    const first = args[0]; let options = {};
    if (typeof first === 'string' || first instanceof URL) { origin(transport, first); if (args[1] && typeof args[1] === 'object') options = args[1]; }
    else if (first && typeof first === 'object') options = first;
    else deny(transport, 'invalid request arguments');
    if (options.socketPath !== undefined) deny(transport, 'unreviewed socket path');
    if (options.hostname !== undefined) host(transport, options.hostname);
    else if (options.host !== undefined) {
      let url; try { url = new URL('http://' + options.host); } catch { deny(transport, 'invalid host'); } host(transport, url.hostname);
    } else if (typeof first !== 'string' && !(first instanceof URL)) host(transport, 'localhost');
  }
  function lookupValue(name, options) {
    const hostname = host('dns.lookup', name), family = typeof options === 'number' ? options : options?.family;
    const ipv6 = hostname === '::1' || hostname === '[::1]' || hostname === 'localhost' && family === 6;
    const value = { address: ipv6 ? '::1' : '127.0.0.1', family: ipv6 ? 6 : 4 }; return options?.all ? [value] : value;
  }
  try {
    process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
    for (const name of ['connect', 'createConnection']) {
      const original = net[name]; patch(net, name, function (...args) { socket('net.' + name, args); return original.apply(this, args); });
    }
    const socketConnect = net.Socket.prototype.connect;
    patch(net.Socket.prototype, 'connect', function (...args) { socket('net.Socket.connect', args); return socketConnect.apply(this, args); });
    const tlsConnect = tls.connect; patch(tls, 'connect', function (...args) { socket('tls.connect', args); return tlsConnect.apply(this, args); });
    for (const [label, module] of [['http', http], ['https', https]]) for (const name of ['request', 'get']) {
      const original = module[name]; patch(module, name, function (...args) { request(label + '.' + name, args); return original.apply(this, args); });
    }
    patch(dns, 'lookup', function (name, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      if (typeof callback !== 'function') throw new TypeError('lookup callback required');
      let value; try { value = lookupValue(name, options); } catch (error) { queueMicrotask(() => callback(error)); return; }
      queueMicrotask(() => Array.isArray(value) ? callback(null, value) : callback(null, value.address, value.family));
    });
    patch(dns.promises, 'lookup', async (name, options) => lookupValue(name, options));
    // Successor delta: native getnameinfo can bypass the JS socket guards.
    // Neither callback nor promise service lookup is needed by this fixture.
    patch(dns, 'lookupService', (...args) => deny('dns.lookupService', args[0] ?? ''));
    patch(dns.promises, 'lookupService', async (...args) => deny('dns.promises.lookupService', args[0] ?? ''));
    for (const object of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
      for (const name of Object.getOwnPropertyNames(object)) if ((name === 'reverse' || name.startsWith('resolve')) && typeof object[name] === 'function') {
        patch(object, name, (...args) => deny('dns.' + name, args[0] ?? ''));
      }
    }
    for (const name of ['send', 'connect']) patch(dgram.Socket.prototype, name, () => deny('dgram.' + name, 'UDP is unnecessary for this fixture'));
    const nativeFetch = globalThis.fetch;
    patch(globalThis, 'fetch', function (input, ...args) {
      origin('global.fetch', typeof input === 'string' || input instanceof URL ? input : input.url); return nativeFetch.call(this, input, ...args);
    });
    syncBuiltinESMExports();
    const undiciEntry = mfRequire.resolve('undici'); undici = mfRequire('undici'); previousDispatcher = undici.getGlobalDispatcher();
    class LoopbackDispatcher extends undici.Dispatcher {
      dispatch(options, handler) { origin('miniflare.undici.dispatch', options.origin); return previousDispatcher.dispatch(options, handler); }
      close() { return deny('miniflare.undici.close', 'borrowed dispatcher cannot be closed by fixture'); }
      destroy() { return deny('miniflare.undici.destroy', 'borrowed dispatcher cannot be destroyed by fixture'); }
    }
    installedDispatcher = new LoopbackDispatcher(); undici.setGlobalDispatcher(installedDispatcher);

    // The lazy binding proxy runs in another Node realm. Match its complete
    // installed script and filename, then guard its own Pool/fetch boundary.
    // URL parsing must yield exactly numeric loopback; this permits equivalent
    // spellings that URL canonically normalizes to the same loopback address.
    // Decode only the pinned literal's one Unicode escape and two known header
    // substitutions. Never eval, compile, rewrite vendor files or substitute its
    // message, id, port, response or Atomics protocol.
    const entryBytes = readFileSync(miniflareEntry), entrySource = entryBytes.toString('utf8');
    assert.equal(sha(entryBytes), '9584409d464f6c21d720b20da3c5dc6e5bdab0393f9cb19b36cb960beaf0958b');
    const start = entrySource.indexOf('var WORKER_SCRIPT = ('), end = entrySource.indexOf('\n);\nvar SynchronousFetcher', start);
    assert.ok(start >= 0 && end > start); const section = entrySource.slice(start, end);
    let expectedScript = section.slice(section.indexOf('`') + 1, section.lastIndexOf('`'));
    assert.equal(expectedScript.split('\\').length - 1, 1); assert.equal(expectedScript.split('\\u2014').length - 1, 1);
    for (const [placeholder, value] of [['${CoreHeaders.OP_SYNC}', 'MF-Op-Sync'], ['${CoreHeaders.OP_RESULT_TYPE}', 'MF-Op-Result-Type']]) {
      assert.equal(expectedScript.split(placeholder).length - 1, 1); expectedScript = expectedScript.replace(placeholder, value);
    }
    expectedScript = expectedScript.replace('\\u2014', '—');
    assert.equal(sha(expectedScript), '4d25b5d205de6b409af1c5138b4b6f8277b532f70eea92767b2b85f821e735ad');
    const guardInsertion = `    const __formaCounts = new Int32Array(workerData.__formaHostNetworkCounts);
    try {
      const __formaUrl = new URL(url);
      if (!["http:", "https:"].includes(__formaUrl.protocol) || __formaUrl.username || __formaUrl.password
        || !["127.0.0.1", "[::1]"].includes(__formaUrl.hostname)) throw new Error("non-loopback proxy URL");
    } catch (__formaError) {
      Atomics.add(__formaCounts, 0, 1);
      throw new Error("FORMA_PROXY_WORKER_EGRESS_DENIED " + String(__formaError));
    }
    Atomics.add(__formaCounts, 1, 1);
`;
    const boundary = '  try {\n    if (dispatcherUrl !== url) {';
    const nativeFetchCall = 'const response = await fetch(url, { method, headers, body, dispatcher });';
    assert.equal(expectedScript.split(boundary).length - 1, 1); assert.equal(expectedScript.split(nativeFetchCall).length - 1, 1);
    const guardedScript = expectedScript.replace(boundary, '  try {\n' + guardInsertion + '    if (dispatcherUrl !== url) {')
      .replace(nativeFetchCall, 'const response = await fetch(url, { method, headers, body, dispatcher, redirect: "error" });');
    const OriginalWorker = workerThreads.Worker;
    patch(workerThreads, 'Worker', class GuardedBindingProxyWorker extends OriginalWorker {
      constructor(script, options) {
        const exactData = (value, names) => !!value && typeof value === 'object' && !Array.isArray(value)
          && Reflect.ownKeys(value).length === names.length && names.every(name => {
            const descriptor = Object.getOwnPropertyDescriptor(value, name); return descriptor && Object.hasOwn(descriptor, 'value');
          });
        if (script !== expectedScript || !exactData(options, ['eval', 'workerData', 'transferList']) || options.eval !== true
          || !exactData(options.workerData, ['notifyHandle', 'port', 'filename']) || options.workerData.filename !== miniflareEntry
          || !(options.workerData.notifyHandle instanceof Int32Array) || options.workerData.notifyHandle.length !== 1
          || !(options.workerData.notifyHandle.buffer instanceof SharedArrayBuffer)
          || !(options.workerData.port instanceof workerThreads.MessagePort)
          || !Array.isArray(options.transferList) || options.transferList.length !== 1
          || options.transferList[0] !== options.workerData.port) deny('worker_threads.Worker', 'unknown script, filename or bridge construction');
        const counters = new Int32Array(new SharedArrayBuffer(8));
        const recorded = { expectedScriptSha256: sha(expectedScript), guardedScriptSha256: sha(guardedScript), counters };
        proxyWorkers.push(recorded);
        super(guardedScript, { ...options, workerData: { ...options.workerData, __formaHostNetworkCounts: counters.buffer } });
      }
    });
    syncBuiltinESMExports();
    identity = { miniflareEntry, miniflareEntrySha256: sha(entryBytes), undiciEntry, undiciEntrySha256: sha(readFileSync(undiciEntry)),
      undiciVersion: mfRequire('undici/package.json').version, proxyScriptSha256: sha(expectedScript), guardedProxyScriptSha256: sha(guardedScript) };
  } catch (error) {
    try { restore(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'partial host guard install failed'); }
    throw error;
  }
  return {
    identity, restore, setPhase(value) { state.phase = value; },
    snapshot() { return { identity, phase: state.phase, restored: state.restored, denials: structuredClone(events), allowed: structuredClone(allowed),
      proxyWorkers: proxyWorkers.map(row => ({ expectedScriptSha256: row.expectedScriptSha256, guardedScriptSha256: row.guardedScriptSha256,
        deniedRequests: Atomics.load(row.counters, 0), allowedRequests: Atomics.load(row.counters, 1) })) }; },
    async verifyGuards() {
      state.phase = 'guard-selfcheck'; const expected = [];
      async function rejected(name, action) {
        const before = events.length; let refused = false;
        try { await action(); } catch { refused = true; }
        assert.ok(refused && events.length === before + 1, `host guard selfcheck: ${name}`); expected.push(name);
      }
      await rejected('actual Miniflare undici global dispatcher', () => undici.fetch('https://forbidden.invalid/guard'));
      await rejected('Node global fetch', () => globalThis.fetch('https://forbidden.invalid/guard'));
      await rejected('Node http request', () => http.request('http://forbidden.invalid/guard'));
      await rejected('Node https request', () => https.request('https://forbidden.invalid/guard'));
      await rejected('Node net connector', () => net.connect({ host: 'forbidden.invalid', port: 443 }));
      await rejected('Node TLS connector', () => tls.connect({ host: 'forbidden.invalid', port: 443 }));
      await rejected('Node DNS lookup', () => dns.promises.lookup('forbidden.invalid'));
      await rejected('Node DNS callback lookupService', () => dns.lookupService('192.0.2.1', 443, () => assert.fail('Denied lookupService callback must not run')));
      await rejected('Node DNS promise lookupService', () => dns.promises.lookupService('192.0.2.1', 443));
      controls = expected; state.phase = 'runtime'; return { expectedBlockedControls: [...expected], denials: structuredClone(events) };
    },
    assertContained() {
      assert.equal(controls?.length, 9); assert.equal(events.length, 9);
      assert.ok(events.every(row => row.phase === 'guard-selfcheck'), 'no unexpected setup, runtime or disposal host denial');
      assert.ok(proxyWorkers.length > 0, 'the actual lazy binding proxy used the reviewed Worker guard');
      for (const row of proxyWorkers) {
        assert.equal(Atomics.load(row.counters, 0), 0, 'no denied proxy Worker URL, including swallowed failures');
        assert.ok(Atomics.load(row.counters, 1) > 0, 'observed real proxy requests passed the in-worker loopback gate');
      }
    },
  };
}

async function prepareMiniflare(t, label, egress) {
  const repoRequire = createRequire(new URL('../package.json', import.meta.url));
  const wranglerRequire = createRequire(repoRequire.resolve('wrangler')), entry = wranglerRequire.resolve('miniflare');
  const guard = installHostNetworkGuard(entry); let mf, constructionAttempted = false;
  // This owner exists before selfchecks, Miniflare loading or construction.
  t.after(async () => {
    const failures = []; let disposed = !constructionAttempted;
    try { t.mock.reset(); } catch (error) { failures.push(error); }
    guard.setPhase('dispose');
    if (mf) {
      phase('miniflare-dispose-start', { label });
      try { await finite(mf.dispose(), 10000, `${label}:dispose`); disposed = true; phase('miniflare-dispose-complete', { label }); }
      catch (error) { failures.push(error); phase('miniflare-dispose-failed', { label, error: String(error) }); }
    }
    const observed = guard.snapshot(); phase('host-network-guard-final', { label, ...observed,
      constructionAttempted, runtimeHandleAcquired: !!mf, ownedRuntimeDisposed: disposed });
    try { guard.assertContained(); } catch (error) { failures.push(error); }
    try { assert.deepEqual(egress, [], 'even caught workerd egress is a fixture failure'); } catch (error) { failures.push(error); }
    if (disposed) {
      try { guard.restore(); phase('host-network-guard-restored', { label, restored: guard.snapshot().restored }); }
      catch (error) { failures.push(error); phase('host-network-guard-restore-failed', { label, error: String(error) }); }
    } else {
      // A bounded timeout/rejection is not shutdown. Keep guards installed; the
      // isolated bounded runner must terminate remaining owned processes. A
      // second runtime in this process is refused by activeHostGuard.
      phase('host-network-guard-retained', { label, reason: 'owned runtime disposal unconfirmed; process must not be reused' });
    }
    if (failures.length) throw new AggregateError(failures, 'owned Miniflare host containment or cleanup failed');
  });
  const controls = await guard.verifyGuards(); phase('host-network-guard-ready', { label, ...guard.identity, ...controls });
  const classes = wranglerRequire('miniflare');
  return { ...classes, create(options) {
    assert.equal(constructionAttempted, false); constructionAttempted = true;
    try { mf = new classes.Miniflare(options); return mf; }
    catch (error) { phase('miniflare-construction-failed', { label, error: String(error), shutdownConfirmed: false }); throw error; }
  } };
}

const queryLimits = Object.freeze({ functionArguments: 32, parameters: 100, sqlBytes: 100000 });
const onlyMutationTables = Object.freeze(['experience_guest_claim_leases', 'experience_guest_image_result_copy_attempts']);
const forbiddenMutation = /\b(?:UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu;
const leaseColumns = Object.freeze(['session_id', 'lease_id', 'destination_user_id', 'manifest_digest', 'request_id',
  'request_ids_json', 'acquisitions', 'created_at_ms', 'expires_at_ms']);

/** Qualify every emitted application statement against all five unchanged
 * deployment limits, then execute it on actual local D1. Only the fixed first
 * lease and reserved-attempt INSERTs may mutate, and only inside a batch.
 * Fault hooks are local test owners: no callback reaches application code. */
function observedDatabase(raw, qualifier) {
  const handles = new WeakMap();
  const state = { records: [], batches: [], violations: [], afterBatch: null, afterFirst: null, rollbackRace: null,
    actualMutations: [], injectedRaces: [], engineErrors: [] };
  const forbidden = operation => {
    state.violations.push({ operation }); throw new Error(`guest-claim-source-D1 forbidden ${operation}`);
  };
  function qualify(row, method) {
    try {
      assert.equal(typeof row.sql, 'string');
      const insert = /^\s*INSERT INTO (experience_guest_claim_leases|experience_guest_image_result_copy_attempts)\s*\(/u.exec(row.sql);
      assert.ok(insert || /^\s*SELECT\b/iu.test(row.sql), 'only reads and the two allocated INSERTs');
      assert.doesNotMatch(row.sql, forbiddenMutation);
      if (!insert) assert.doesNotMatch(row.sql, /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\b/iu);
      else assert.equal(method, 'batch', 'fixed mutation is transaction-only');
      const compiled = qualifier.qualify(row.sql, row.bindings);
      assert.equal(compiled.ok, true); assert.equal(compiled.limit, 100);
      assert.deepEqual(compiled.queryLimits, queryLimits); assert.equal(compiled.compoundSelectLimit, 5);
      assert.equal(compiled.parameterCount, row.bindings.length); assert.equal(compiled.statementBytes, Buffer.byteLength(row.sql));
      const record = { sql: row.sql, sqlSha256: sha(row.sql), parameters: row.bindings.length,
        sqlBytes: Buffer.byteLength(row.sql), bindings: [...row.bindings], method, mutationTable: insert?.[1] ?? null };
      state.records.push(record); return record;
    } catch (error) {
      state.violations.push({ operation: method, sqlSha256: sha(String(row.sql)), error: String(error) }); throw error;
    }
  }
  const wrap = (statement, sql, bindings = []) => {
    const row = { statement, sql, bindings };
    const wrapped = {
      bind: (...values) => wrap(statement.bind(...values), sql, values),
      async first(...args) {
        qualify(row, 'first'); const result = await statement.first(...args);
        return state.afterFirst ? state.afterFirst(row, result) : result;
      },
      async all(...args) { qualify(row, 'all'); return statement.all(...args); },
      run: () => forbidden('statement.run'), raw: () => forbidden('statement.raw'),
    };
    handles.set(wrapped, row); return wrapped;
  };
  state.DB = {
    prepare: sql => wrap(raw.prepare(sql), sql),
    exec: () => forbidden('DB.exec'), dump: () => forbidden('DB.dump'),
    async batch(statements) {
      let rows, records;
      try {
        assert.ok(Array.isArray(statements) && statements.length > 0 && statements.length <= 512);
        rows = Array.from(statements, statement => { const row = handles.get(statement);
          assert.ok(row, 'same observed database owns every statement'); return row; });
        records = rows.map(row => qualify(row, 'batch'));
        assert.ok(records.filter(row => row.mutationTable).length <= 1, 'at most one allocated mutation per transaction');
      } catch (error) { state.violations.push({ operation: 'batch', error: String(error) }); throw error; }
      state.batches.push(records); const native = rows.map(row => row.statement);
      const mutationIndex = records.findIndex(row => row.mutationTable);
      try { if (mutationIndex >= 0) {
        assert.ok(mutationIndex > 0 && mutationIndex < records.length - 1,
          'fixed mutation has genuine before and after proof statements');
        state.actualMutations.push(records[mutationIndex].mutationTable);
        const race = state.rollbackRace;
        if (race && race.mutationTable === records[mutationIndex].mutationTable) {
          // This separate test-owned write races the real after-proof inside the
          // same actual D1 transaction. Neither assertion SQL nor application
          // bindings are replaced. The engine must roll back both mutations.
          assert.ok(onlyMutationTables.includes(race.mutationTable));
          assert.equal(typeof race.contentId, 'string'); assert.equal(typeof race.redactedAt, 'string');
          const sql = 'UPDATE private_content SET redacted_at=? WHERE content_id=?';
          qualifier.qualify(sql, [race.redactedAt, race.contentId]);
          native.splice(mutationIndex + 1, 0, raw.prepare(sql).bind(race.redactedAt, race.contentId));
          state.injectedRaces.push({ sql, contentId: race.contentId, after: race.mutationTable });
          state.rollbackRace = null;
        }
      } } catch (error) { state.violations.push({ operation: 'batch-shape', error: String(error) }); throw error; }
      let results;
      try { results = await raw.batch(native); }
      catch (error) { state.engineErrors.push({ mutationTable: records[mutationIndex]?.mutationTable ?? null,
        error: String(error) }); throw error; }
      return state.afterBatch ? state.afterBatch(rows, results) : results;
    },
  };
  return state;
}
const databaseSnapshot = async f => ({
  schema: (await f.raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results,
  rows: await rowsSnapshot(f.raw, f.exported.tables),
});
const nativeRows = async (f, table) => {
  assert.ok(f.exported.tables.includes(table));
  return (await f.raw.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).all()).results;
};
const preserveRows = (before, after, changed = []) => {
  assert.deepEqual(after.schema, before.schema, 'application never installs or modifies schema');
  for (const [table, rows] of Object.entries(before.rows)) if (!changed.includes(table)) {
    assert.deepEqual(after.rows[table], rows, `original ${table} rows, types and rowids survive`);
  }
};

// Fixed local successor of the accepted scalar/schema/rowid exporter. The
// donor remains unchanged; only this fixture's schema-object capacity grows.
const quoteSnapshotIdentifier = name => '"' + name.replaceAll('"', '""') + '"';
function exportClaimSourceSynthetic(sqlite) {
  const schema = sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  // This fixture adds five exact families to the accepted donor graph.
  // Their table/index/trigger totals (including native automatic indexes) are
  // context8 + plan9 + SAVE6 + stage13 + result29 = 65 schema objects.
  // No schema entry is filtered; SQL and row/statement bounds stay unchanged.
  const maximumSchemaObjects = 512 + 65;
  phase('synthetic-schema-snapshot-count', { actualSchemaObjects: schema.length,
    donorMaximumSchemaObjects: 512, addedFamilyMaximumObjects: 65, maximumSchemaObjects });
  assert(schema.length <= maximumSchemaObjects);
  assert(schema.every(row => !row.name.startsWith('sqlite_') || row.sql === null));
  const tables = schema.filter(row => row.type === 'table'), inserts = [], rows = {};
  for (const { name } of tables) {
    const columns = sqlite.prepare(`PRAGMA table_info(${quoteSnapshotIdentifier(name)})`).all().map(row => row.name);
    const expressions = ['CAST(rowid AS TEXT) AS original_rowid', ...columns.map((column, i) => `quote(${quoteSnapshotIdentifier(column)}) AS c${i}`)];
    rows[name] = structuredClone(sqlite.prepare(`SELECT ${expressions.join(',')} FROM ${quoteSnapshotIdentifier(name)} ORDER BY rowid`).all());
    for (const row of rows[name]) {
      assert(/^[0-9]+$/.test(row.original_rowid));
      const sql = `INSERT INTO ${quoteSnapshotIdentifier(name)}(rowid,${columns.map(quoteSnapshotIdentifier).join(',')}) VALUES(${row.original_rowid},${columns.map((_, i) => row['c' + i]).join(',')})`;
      assert(Buffer.byteLength(sql) < 90000);
      inserts.push(sql);
    }
  }
  assert(inserts.length <= 2048);
  return { schema: structuredClone(schema), tables: tables.map(row => row.name), rows, inserts };
}

async function actualD1Fixture(t, { resultSchema = true, memory = false, schemaDamage = null } = {}) {
  const label = `actual-d1-claim-source:${resultSchema ? 'complete-result-family' : 'absent-result-family'}:${memory ? 'memory' : 'no-memory'}`;
  await bookends(t, label);
  const egress = [], runtime = await prepareMiniflare(t, label, egress), { Log, LogLevel } = runtime;
  const mf = runtime.create({ cf: false, modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default {fetch(){return new Response('Local guest claim-source D1 fixture.',{status:404});}};",
    d1Databases: ['GuestResultClaimSource'], log: new Log(LogLevel.NONE),
    outboundService(request) { egress.push({ url: request.url, method: request.method }); throw new Error('external workerd fetch forbidden'); } });
  // Initialize the real local proxy before the genuine producer fixture replaces
  // the host fetch with its closed, no-network native provider-wire fixture.
  const raw = await finite(mf.getD1Database('GuestResultClaimSource'), 10000, 'claim-source:d1-binding');
  const compound = count => Array.from({ length: count }, () => 'SELECT 1').join(' UNION ALL ');
  assert.equal((await raw.prepare(compound(5)).all()).results.length, 5);
  await assert.rejects(raw.prepare(compound(6)).all(), /too many terms in compound SELECT/iu);
  const fixture = await import('./experience-guest-image-result-claim-source.test.mjs');
  const helper = await import('./helpers/guest-image-result-media-fixture.mjs');
  const f = await fixture.claimSourceFixture(t, { inventory: false, resultSchema, memory });
  if (schemaDamage !== null) {
    assert.ok(resultSchema && ['partial', 'changed'].includes(schemaDamage));
    f.sqlite.exec('DROP TRIGGER experience_guest_image_result_attempt_delete');
    if (schemaDamage === 'changed') f.sqlite.exec(`CREATE TRIGGER experience_guest_image_result_attempt_delete
      BEFORE DELETE ON experience_guest_image_result_copy_attempts WHEN 0
      BEGIN SELECT RAISE(ABORT,'changed local test guard'); END`);
  }
  const exported = exportClaimSourceSynthetic(f.sqlite); await install(raw, exported);
  const schema = exported.schema.filter(row => row.sql).sort((left, right) => {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    return rank[left.type] - rank[right.type] || left.name.localeCompare(right.name);
  }).map(row => row.sql);
  const qualifier = await helper.createMediaSqlQualifier(schema), observed = observedDatabase(raw, qualifier);
  f.env.DB = observed.DB; f.DB = observed.DB;
  t.after(() => {
    assert.deepEqual(observed.violations, [], 'application refusal cannot swallow a strict SQL or mutation violation');
    qualifier.assertVerified();
  });
  phase('genuine-completed-snapshot-installed', { engine: 'actual-local-workerd-D1', media: 'synthetic-receiver-branded-bucket',
    graphSetup: 'one genuine native producer; exact schema/scalars/rowids transferred', resultSchema, memory, schemaDamage });
  return { ...f, raw, exported, observed, qualifier, helper, fixture };
}

function measuredProofs(f, label) {
  const metrics = f.qualifier.metrics();
  assert.ok(metrics.statements > 0); assert.deepEqual(metrics.failures, []);
  assert.ok(metrics.maxBindings <= 100 && metrics.maxSqlBytes <= 100000);
  return { label, engine: 'actual-local-workerd-D1', ...metrics,
    enforcedLimits: { expressionDepth: 100, compoundSelects: 5, ...queryLimits },
    emittedMutations: [...f.observed.actualMutations], sourceBytesUnchanged: true,
    physicalR2: false, providerCalls: false, finalCustody: false };
}

const claimApis = async () => {
  const [source, media] = await Promise.all([
    import('../worker/experience-guest-image-result-claim-source.ts'),
    import('../worker/experience-guest-image-result-media.ts'),
  ]);
  return { ...source, ...media };
};
const refusal = error => {
  assert.match(String(error), /(?:guest_image_result_|guest_image_output_retirement_unavailable|guest_custody_database_changed|^Error: guest_image_stage_inventory_lease_invalid$)/u);
  return true;
};
const rejected = action => assert.rejects(async () => action(), refusal);
const leaseTable = 'experience_guest_claim_leases';
const attemptTable = 'experience_guest_image_result_copy_attempts';

async function inspectOriginal(f) {
  await f.helper.createMediaInventory(f, f.request);
  assert.ok(f.inventory && Object.isFrozen(f.inventory));
  assert.deepEqual(f.inventoryData.manifest.financialReceipt, {
    period: f.initialToken.period, tokenReservationId: f.initialToken.reservation_id,
    costReservationId: f.initialCost.reservation_id, usedTokens: 400, usedMicrousd: 4200,
  });
  assert.equal(f.inventoryData.manifest.object.contentSha256, f.mediaOracle.sha256);
  assert.equal(f.inventoryData.manifest.object.storageKey, f.mediaOracle.key);
  await f.helper.assertGuestImageResultInventoryCurrent(f.request, f.env, f.inventory);
  return f.inventoryData;
}
async function leaseOriginal(f, api, requestId = 'actual-d1-result-claim-1') {
  const leased = await api.acquireGuestImageResultClaimSource(f.request, f.env, { inventory: f.inventory, requestId });
  assert.ok(leased && Object.isFrozen(leased)); assert.deepEqual(Reflect.ownKeys(leased), []);
  await api.assertGuestImageResultClaimSourceCurrent(f.request, f.env, leased);
  const leases = await nativeRows(f, leaseTable); assert.equal(leases.length, 1);
  const lease = leases[0]; assert.deepEqual(Object.keys(lease).sort(), [...leaseColumns].sort());
  assert.equal(lease.session_id, f.session.sessionId); assert.equal(lease.destination_user_id, f.claimOwner);
  assert.equal(lease.manifest_digest, f.inventoryData.manifestDigest); assert.equal(lease.request_id, requestId);
  assert.equal(lease.request_ids_json, JSON.stringify([requestId])); assert.equal(lease.acquisitions, 1);
  assert.match(lease.lease_id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u);
  assert.ok(Number.isSafeInteger(lease.created_at_ms) && Number.isSafeInteger(lease.expires_at_ms));
  const session = (await nativeRows(f, 'experience_guest_sessions'))[0];
  const policy = JSON.parse((await nativeRows(f, 'experience_guest_policies'))[0].terms_json);
  assert.equal(lease.expires_at_ms, Math.min(lease.created_at_ms + policy.leaseLifetimeMs, session.expires_at_ms));
  await rejected(() => f.helper.assertGuestImageResultInventoryCurrent(f.request, f.env, f.inventory));
  return { leased, lease };
}
async function exactReservedRow(f, lease) {
  const { GUEST_IMAGE_RESULT_COPY_COLUMNS, readGuestImageResultCopyAttemptRow,
    validateGuestImageResultCopyDescriptor } = await import('../worker/experience-guest-image-result-copy-contract.ts');
  const attempts = await nativeRows(f, attemptTable); assert.equal(attempts.length, 1);
  const attempt = attempts[0]; assert.deepEqual(Object.keys(attempt).sort(), [...GUEST_IMAGE_RESULT_COPY_COLUMNS].sort());
  assert.deepEqual(await readGuestImageResultCopyAttemptRow(attempt), attempt);
  const descriptor = await validateGuestImageResultCopyDescriptor(JSON.parse(attempt.descriptor_json));
  assert.deepEqual(descriptor.manifest, f.inventoryData.manifest);
  assert.equal(descriptor.manifestDigest, f.inventoryData.manifestDigest);
  assert.deepEqual(descriptor.leaseSnapshot, lease); assert.deepEqual(JSON.parse(attempt.lease_snapshot_json), lease);
  assert.equal(descriptor.source.byteLength, f.mediaOracle.size);
  assert.equal(attempt.byte_length, f.mediaOracle.size); assert.equal(attempt.content_sha256, f.mediaOracle.sha256);
  assert.equal(attempt.mime_type, 'image/png'); assert.equal(attempt.width, 1024); assert.equal(attempt.height, 1024);
  assert.equal(attempt.state, 'reserved'); assert.equal(attempt.row_version, 0); assert.equal(attempt.put_outcome, 'pending');
  assert.equal(attempt.updated_at_ms, attempt.created_at_ms);
  for (const key of ['put_started_at_ms', 'put_settled_at_ms', 'verified_at_ms', 'published_at_ms', 'published_claim_digest']) {
    assert.equal(attempt[key], null, `${key} remains unset before physical copy`);
  }
  assert.equal(attempt.source_expires_at_ms, Date.parse(f.inventoryData.manifest.expiresAt));
  assert.deepEqual(await nativeRows(f, 'experience_guest_image_result_custodies'), []);
  assert.deepEqual(await nativeRows(f, 'experience_guest_image_result_copies'), []);
  return attempt;
}

// Positive first: real application inventory and transaction predicates execute
// on actual local D1 before any malformed row, ACK, schema or race is introduced.
for (const memory of [false, true]) test(`actual local D1 original source reaches exact first lease and reserved-v0 with ${memory ? 'complete' : 'absent'} Memory`, { timeout: 120000 }, async t => {
  const f = await actualD1Fixture(t, { memory }), api = await claimApis();
  const before = await databaseSnapshot(f); let io;
  try {
    io = f.helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
    await inspectOriginal(f);
    const { leased, lease } = await leaseOriginal(f, api);
    preserveRows(before, await databaseSnapshot(f), [leaseTable]);
    const bytes = await api.readLeasedGuestImageResultMedia(f.request, f.env, leased);
    assert.ok(bytes && Object.isFrozen(bytes)); assert.deepEqual(Reflect.ownKeys(bytes), []);
    const mediaReview = api.guestImageResultLeasedMediaReview(f.request, f.env, bytes);
    assert.equal(mediaReview.byteLength, f.mediaOracle.size); assert.equal(mediaReview.sha256, f.mediaOracle.sha256);
    const result = await api.reserveGuestImageResultMedia(f.request, f.env, bytes);
    assert.equal(result.status, 'reserved'); assert.ok(result.reservation && Object.isFrozen(result.reservation));
    assert.deepEqual(Reflect.ownKeys(result.reservation), []);
    const attempt = await exactReservedRow(f, lease);
    const review = api.guestImageResultReservedReview(f.request, f.env, result.reservation);
    assert.deepEqual(review, { version: 1, kind: 'guest-image-result-reservation', status: 'reserved',
      attemptId: attempt.attempt_id, custodyId: attempt.custody_id, destinationUserId: f.claimOwner,
      manifestDigest: f.inventoryData.manifestDigest, byteLength: f.mediaOracle.size,
      expiresAtMs: Math.min(attempt.source_expires_at_ms, lease.expires_at_ms),
      freshBytesVerified: true, custodyTransferred: false, publicReadAvailable: false });
    assert.ok(Object.isFrozen(review));
    await api.assertGuestImageResultReservedCurrent(f.request, f.env, result.reservation);
    await rejected(() => api.assertGuestImageResultClaimSourceCurrent(f.request, f.env, leased));
    await rejected(() => api.readLeasedGuestImageResultMedia(f.request, f.env, leased));
    await rejected(() => api.reserveGuestImageResultMedia(f.request, f.env, bytes));
    assert.throws(() => api.guestImageResultLeasedMediaReview(f.request, f.env, bytes), refusal);
    await rejected(() => api.assertGuestImageResultReservedCurrent(f.request, f.env, {}));
    await rejected(() => api.assertGuestImageResultReservedCurrent(f.request, f.env, structuredClone(result.reservation)));
    assert.deepEqual(io.state.calls, ['get', 'head']);
    assert.deepEqual(f.observed.actualMutations, [leaseTable, attemptTable], 'one emitted INSERT of each kind');
    preserveRows(before, await databaseSnapshot(f), [leaseTable, attemptTable]);
    io.assertUntouched();
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, memory ? 'genuine-reserve-complete-memory' : 'genuine-reserve'),
      committedLeaseRows: 1, committedAttemptRows: 1, mediaCalls: io.state.calls,
      observedByteLength: attempt.byte_length, immutableManifest: true, exactNineFieldLease: true }));
  } finally { io?.close(); }
});

test('actual local D1 ordinary inventory accepts absent result family then refuses a genuine session lease', { timeout: 120000 }, async t => {
  const f = await actualD1Fixture(t, { resultSchema: false }); let io;
  try {
    io = f.helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
    await inspectOriginal(f); const before = await databaseSnapshot(f);
    const now = (await f.raw.prepare(`SELECT ${f.fixture.GUEST_DB_NOW} AS now`).first()).now;
    const session = (await nativeRows(f, 'experience_guest_sessions'))[0];
    const policy = JSON.parse((await nativeRows(f, 'experience_guest_policies'))[0].terms_json);
    const row = { session_id: f.session.sessionId, lease_id: crypto.randomUUID(), destination_user_id: f.claimOwner,
      manifest_digest: f.inventoryData.manifestDigest, request_id: 'ordinary-native-lease', request_ids_json: '["ordinary-native-lease"]',
      acquisitions: 1, created_at_ms: now, expires_at_ms: Math.min(now + policy.leaseLifetimeMs, session.expires_at_ms) };
    await f.raw.prepare(`INSERT INTO ${leaseTable}(${leaseColumns.join(',')}) VALUES(${leaseColumns.map(() => '?').join(',')})`)
      .bind(...leaseColumns.map(key => row[key])).run();
    assert.deepEqual(await nativeRows(f, leaseTable), [row]);
    await rejected(() => f.helper.assertGuestImageResultInventoryCurrent(f.request, f.env, f.inventory));
    await rejected(() => f.helper.createMediaInventory(f, f.fixture.claimRequest()));
    preserveRows(before, await databaseSnapshot(f), [leaseTable]);
    assert.deepEqual(io.state.calls, []); assert.deepEqual(f.observed.actualMutations, []);
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, 'ordinary-absent-family-real-lease-refusal'), testSetupLeaseRows: 1 }));
  } finally { io?.close(); }
});

for (const mutationTable of [leaseTable, attemptTable]) test(`actual local D1 failing native after-proof rolls back ${mutationTable} and the source race`, { timeout: 120000 }, async t => {
  const f = await actualD1Fixture(t), api = await claimApis(); let io;
  try {
    io = f.helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
    await inspectOriginal(f);
    let bytes;
    if (mutationTable === attemptTable) {
      const { leased } = await leaseOriginal(f, api);
      bytes = await api.readLeasedGuestImageResultMedia(f.request, f.env, leased);
    }
    const before = await databaseSnapshot(f), contentId = f.inventoryData.manifest.privateContents[0].contentId;
    const source = await f.raw.prepare('SELECT content_id,redacted_at FROM private_content WHERE content_id=?').bind(contentId).first();
    assert.equal(source.content_id, contentId); assert.equal(source.redacted_at, null);
    f.observed.rollbackRace = { mutationTable, contentId, redactedAt: new Date().toISOString() };
    const action = mutationTable === leaseTable
      ? api.acquireGuestImageResultClaimSource(f.request, f.env, { inventory: f.inventory, requestId: 'd1-rollback-lease' })
      : api.reserveGuestImageResultMedia(f.request, f.env, bytes);
    await rejected(() => action);
    assert.equal(f.observed.rollbackRace, null, 'race entered the real transaction');
    assert.equal(f.observed.injectedRaces.length, 1); assert.equal(f.observed.injectedRaces[0].contentId, contentId);
    assert.equal(f.observed.engineErrors.length, 1); assert.equal(f.observed.engineErrors[0].mutationTable, mutationTable);
    assert.match(f.observed.engineErrors[0].error, /malformed JSON/iu, 'real native failing assertion, not a false return value');
    assert.deepEqual(await databaseSnapshot(f), before, 'actual engine rolled back INSERT and in-batch body redaction together');
    assert.deepEqual(await nativeRows(f, attemptTable), []);
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, `native-after-proof-rollback:${mutationTable}`),
      injectedRaces: f.observed.injectedRaces, engineErrors: f.observed.engineErrors, transactionRolledBack: true }));
  } finally { io?.close(); }
});

for (const acknowledgement of ['throw-after-commit', 'null-final-proof']) test(`actual local D1 reserved commit with ${acknowledgement} gives only nondispatching recovery`, { timeout: 120000 }, async t => {
  const f = await actualD1Fixture(t), api = await claimApis(); let io;
  try {
    io = f.helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
    await inspectOriginal(f); const { leased, lease } = await leaseOriginal(f, api);
    const bytes = await api.readLeasedGuestImageResultMedia(f.request, f.env, leased), before = await databaseSnapshot(f);
    let changed = 0;
    f.observed.afterBatch = (statements, results) => {
      if (!statements.some(row => new RegExp(`^\\s*INSERT INTO ${attemptTable}\\s*\\(`, 'u').test(row.sql))) return results;
      changed++; assert.equal(changed, 1);
      assert.equal(results.length, statements.length);
      const finalProof = results.at(-1); assert.equal(finalProof.success, true);
      assert.deepEqual(finalProof.results, [{ current: 1 }]);
      assert.match(statements.at(-1).sql, /^SELECT CASE WHEN /u);
      phase('ack-fault-after-native-success', { acknowledgement, finalSqlSha256: sha(statements.at(-1).sql),
        nativeFinalCurrent: finalProof.results[0].current, nativeResults: results.length });
      if (acknowledgement === 'throw-after-commit') throw Error('fixture lost actual reserve acknowledgement after native commit');
      const after = structuredClone(results); after[after.length - 1].results = [{ current: null }]; return after;
    };
    const result = await api.reserveGuestImageResultMedia(f.request, f.env, bytes);
    assert.equal(result.status, 'reservation-unknown'); assert.ok(result.recovery && Object.isFrozen(result.recovery));
    assert.equal(Object.hasOwn(result, 'reservation'), false); assert.equal(changed, 1);
    await rejected(() => api.assertGuestImageResultReservedCurrent(f.request, f.env, result.recovery));
    await rejected(() => api.reserveGuestImageResultMedia(f.request, f.env, bytes));
    await rejected(() => api.readLeasedGuestImageResultMedia(f.request, f.env, leased));
    await exactReservedRow(f, lease);
    assert.deepEqual(io.state.calls, ['get', 'head']); assert.deepEqual(f.observed.actualMutations, [leaseTable, attemptTable]);
    preserveRows(before, await databaseSnapshot(f), [attemptTable]);
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, `uncertain-reserve:${acknowledgement}`),
      nativeCommitConfirmedByIndependentRead: true, recoveryDispatches: 0, secondInsertOrByteRead: false }));
  } finally { io?.close(); }
});


for (const schemaDamage of ['partial', 'changed']) test(`actual local D1 ${schemaDamage} result family refuses before lease or bytes`, { timeout: 120000 }, async t => {
  const f = await actualD1Fixture(t, { schemaDamage }); let io;
  try {
    io = f.helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
    const before = await databaseSnapshot(f);
    await rejected(() => f.helper.createMediaInventory(f, f.request));
    assert.deepEqual(await databaseSnapshot(f), before);
    assert.deepEqual(f.observed.actualMutations, []); assert.deepEqual(io.state.calls, []);
    t.diagnostic(JSON.stringify(measuredProofs(f, `schema-refusal:${schemaDamage}`)));
  } finally { io?.close(); }
});

test('actual local D1 schema change after inventory refuses first lease and does not revive after restoration', { timeout: 120000 }, async t => {
  const f = await actualD1Fixture(t), api = await claimApis(); let io;
  try {
    io = f.helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
    await inspectOriginal(f); const before = await databaseSnapshot(f);
    const trigger = before.schema.find(row => row.name === 'experience_guest_image_result_attempt_delete');
    assert.equal(typeof trigger.sql, 'string');
    await f.raw.prepare('DROP TRIGGER experience_guest_image_result_attempt_delete').run();
    await rejected(() => api.acquireGuestImageResultClaimSource(f.request, f.env, {
      inventory: f.inventory, requestId: 'd1-schema-race' }));
    await f.raw.prepare(trigger.sql).run();
    await rejected(() => api.acquireGuestImageResultClaimSource(f.request, f.env, {
      inventory: f.inventory, requestId: 'd1-schema-race' }));
    assert.deepEqual(await databaseSnapshot(f), before, 'no native row change committed; exact schema restored');
    // The observer records emitted SQL before native execution, not commits.
    assert.deepEqual(f.observed.actualMutations, [leaseTable]); assert.deepEqual(io.state.calls, []);
    assert.equal(f.observed.engineErrors.length, 1);
    assert.equal(f.observed.engineErrors[0].mutationTable, leaseTable);
    assert.match(f.observed.engineErrors[0].error, /malformed JSON/iu);
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, 'schema-race-terminal-owner'),
      engineErrors: f.observed.engineErrors, emittedLeaseInsert: true, committedLeaseRows: 0 }));
  } finally { io?.close(); }
});

async function nativeJsonProjectionProbe(f) {
  const document = '{"leaseSnapshot":{"session_id":"foreign-session"},"items":[{"content_id":"foreign-body"}],"duplicate":"first","duplicate":"second","nullable":null}';
  const nodes = (await f.raw.prepare('SELECT id,fullkey,path,key,type,atom FROM json_tree(?) ORDER BY id').bind(document).all()).results;
  const session = nodes.find(row => row.key === 'session_id'), body = nodes.find(row => row.key === 'content_id');
  assert.equal(session.type, 'text'); assert.equal(session.atom, 'foreign-session');
  assert.equal(body.type, 'text'); assert.equal(body.atom, 'foreign-body');
  const duplicate = nodes.filter(row => row.key === 'duplicate');
  assert.equal(duplicate.length, 2); assert.equal(duplicate[0].fullkey, duplicate[1].fullkey);
  assert.deepEqual(duplicate.map(row => row.atom), ['first', 'second']);
  const nullable = nodes.find(row => row.key === 'nullable'); assert.equal(nullable.type, 'null'); assert.equal(nullable.atom, null);
  const truth = await f.raw.prepare(`SELECT
    (json_extract(?, '$.nullable')='value') AS nullable_equal,
    ((json_extract(?, '$.nullable')='value') IS NOT TRUE) AS nullable_not_true,
    json_extract(?, ?) AS session_roundtrip,
    json_extract(?, ?) AS body_roundtrip`).bind(document, document, document, session.fullkey, document, body.fullkey).first();
  assert.deepEqual(truth, { nullable_equal: null, nullable_not_true: 1, session_roundtrip: 'foreign-session', body_roundtrip: 'foreign-body' });
  phase('native-json-projection-probe', { engine: 'actual-local-workerd-D1', sessionFullkey: session.fullkey,
    bodyFullkey: body.fullkey, duplicateFullkey: duplicate[0].fullkey, duplicateCount: duplicate.length, truth });
  return { sessionFullkey: session.fullkey, bodyFullkey: body.fullkey };
}

function testInsert(f, table, row) {
  assert.ok([leaseTable, attemptTable, 'experience_guest_sessions'].includes(table));
  const columns = Object.keys(row); assert.ok(columns.every(column => /^[a-z_][a-z_0-9]*$/u.test(column)));
  const sql = `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`;
  const bindings = columns.map(column => row[column]); f.qualifier.qualify(sql, bindings);
  return f.raw.prepare(sql).bind(...bindings);
}

/** These adversarial rows are inert contract-valid synthetic records. They are
 * not a second native provider journey and never create an application token.
 * The initial own graph above remains the only genuine claimed byte source. */
async function foreignAttempt(f, own, mutate = () => {}) {
  const [{ canonicalJson, digest }, contract] = await Promise.all([
    import('../src/experiences/compiler.ts'), import('../worker/experience-guest-image-result-copy-contract.ts'),
  ]);
  const originalSession = (await nativeRows(f, 'experience_guest_sessions')).find(row => row.session_id === f.session.sessionId);
  const sessionId = crypto.randomUUID(), guestSubject = `guest:${crypto.randomUUID()}`;
  const manifest = structuredClone(f.inventoryData.manifest);
  manifest.sessionId = sessionId; manifest.guestSubject = guestSubject;
  manifest.projectId = crypto.randomUUID(); manifest.documentId = crypto.randomUUID(); manifest.generationId = crypto.randomUUID();
  const foreignProject = manifest.projectId, foreignDocument = manifest.documentId;
  manifest.completionEventId = crypto.randomUUID(); manifest.usageEventId = crypto.randomUUID();
  manifest.sourceEventIds = manifest.sourceEventIds.map(() => crypto.randomUUID());
  for (const key of Object.keys(manifest.nativeIdentity)) manifest.nativeIdentity[key] = crypto.randomUUID();
  for (const key of ['tokenReservationId', 'costReservationId']) manifest.financialReceipt[key] = crypto.randomUUID();
  for (const body of manifest.privateContents) body.contentId = `foreign-content-${crypto.randomUUID()}`;
  // These are scoped or explicitly non-association values: retaining them must
  // not poison a valid foreign-session record by destination/payer/model alone.
  manifest.nativeIdentity.targetId = f.inventoryData.manifest.nativeIdentity.targetId;
  manifest.nativeIdentity.preflightId = f.inventoryData.manifest.nativeIdentity.preflightId;
  mutate(manifest);
  manifest.object.storageKey = `u-${Buffer.from(manifest.guestSubject).toString('hex')}/generated/${manifest.generationId}.png`;
  manifest.object.publicationEventId = manifest.completionEventId;
  const manifestDigest = await digest(manifest), requestId = own.request_id;
  const lease = { ...JSON.parse(own.lease_snapshot_json), session_id: sessionId, lease_id: crypto.randomUUID(),
    manifest_digest: manifestDigest, request_id: requestId, request_ids_json: JSON.stringify([requestId]) };
  const session = { ...originalSession, session_id: sessionId, guest_subject: guestSubject,
    project_id: foreignProject, document_id: foreignDocument,
    session_hash: `sha256:${sha(crypto.randomUUID())}`, claim_hash: `sha256:${sha(crypto.randomUUID())}` };
  const ids = { attemptId: crypto.randomUUID(), custodyId: crypto.randomUUID(), writerNonce: crypto.randomUUID() };
  const metadataInput = { ...ids, destinationUserId: own.destination_user_id, manifestDigest, manifest };
  const descriptor = await contract.validateGuestImageResultCopyDescriptor({ version: 1, kind: 'guest-image-result-copy', ...metadataInput,
    requestId, leaseSnapshot: lease, source: JSON.parse(own.descriptor_json).source,
    destinationKey: contract.guestImageResultMediaKey({ destinationUserId: own.destination_user_id, custodyId: ids.custodyId,
      outputId: contract.guestImageResultOriginalOutputId(manifest.generationId) }),
    destinationMetadata: contract.guestImageResultCopyMetadata(metadataInput) });
  const row = await contract.readGuestImageResultCopyAttemptRow({ ...own,
    attempt_id: ids.attemptId, custody_id: ids.custodyId, session_id: sessionId, lease_id: lease.lease_id,
    manifest_digest: manifestDigest, descriptor_json: canonicalJson(descriptor), descriptor_digest: await digest(descriptor),
    lease_snapshot_json: canonicalJson(lease), destination_key: descriptor.destinationKey, writer_nonce: ids.writerNonce,
    destination_metadata_json: canonicalJson(descriptor.destinationMetadata) });
  return { session, lease, row, descriptor };
}

const relatedAttemptAliases = [
  ['guest subject', (next, original) => { next.guestSubject = original.guestSubject; }],
  ['Project', (next, original) => { next.projectId = original.projectId; }],
  ['Document', (next, original) => { next.documentId = original.documentId; }],
  ['generation and canonical output', (next, original) => { next.generationId = original.generationId; }],
  ['completion and publication event', (next, original) => { next.completionEventId = original.completionEventId; }],
  ['usage event', (next, original) => { next.usageEventId = original.usageEventId; }],
  ['source prefix event', (next, original) => { next.sourceEventIds[0] = original.sourceEventIds[0]; }],
  ...['scopeKey', 'jobId', 'slotId', 'executionGrantId', 'issuerGrantId', 'consumptionId', 'planRevisionId'].map(key =>
    [`native ${key}`, (next, original) => { next.nativeIdentity[key] = original.nativeIdentity[key]; }]),
  ...['tokenReservationId', 'costReservationId'].map(key =>
    [`financial ${key}`, (next, original) => { next.financialReceipt[key] = original.financialReceipt[key]; }]),
  ...[0, 1].map(index => [`retained body ${index}`, (next, original) => { next.privateContents[index].contentId = original.privateContents[index].contentId; }]),
];

test('actual local D1 permits a valid unrelated attempt and excludes fixed cross-session identity aliases', { timeout: 120000 }, async t => {
  const f = await actualD1Fixture(t), api = await claimApis(); let io;
  try {
    io = f.helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
    await inspectOriginal(f); const { leased, lease } = await leaseOriginal(f, api);
    const bytes = await api.readLeasedGuestImageResultMedia(f.request, f.env, leased);
    const result = await api.reserveGuestImageResultMedia(f.request, f.env, bytes);
    assert.equal(result.status, 'reserved'); const own = await exactReservedRow(f, lease);
    const transition = f.observed.batches.find(batch => batch.some(row => row.mutationTable === attemptTable));
    assert.ok(transition); const at = transition.findIndex(row => row.mutationTable === attemptTable);
    const afterProofs = transition.slice(at + 1); assert.ok(afterProofs.length > 0);
    for (const proof of afterProofs) {
      assert.equal(proof.mutationTable, null); assert.match(proof.sql, /^SELECT CASE WHEN /u);
      assert.ok(proof.sql.endsWith(" THEN 1 ELSE json_extract('invalid', '$.assertion') END AS current"));
    }
    // Replay complete emitted statements and exact bindings, unchanged. These
    // are test observations, never structural stand-ins for application tokens.
    const exactAfterStatements = () => afterProofs.map(proof => f.raw.prepare(proof.sql).bind(...proof.bindings));
    const nativeJson = await nativeJsonProjectionProbe(f);
    const unrelated = await foreignAttempt(f, own);
    const unrelatedResult = await f.raw.batch([testInsert(f, 'experience_guest_sessions', unrelated.session),
      testInsert(f, leaseTable, unrelated.lease), testInsert(f, attemptTable, unrelated.row), ...exactAfterStatements()]);
    assert.ok(unrelatedResult.every(row => row.success === true));
    assert.ok(unrelatedResult.slice(3).every(row => row.results.length === 1 && row.results[0].current === 1));
    await api.assertGuestImageResultReservedCurrent(f.request, f.env, result.reservation);
    const baseline = await databaseSnapshot(f), aliases = [];
    for (const [label, mutate] of relatedAttemptAliases) {
      const foreign = await foreignAttempt(f, own, manifest => mutate(manifest, f.inventoryData.manifest));
      await assert.rejects(f.raw.batch([testInsert(f, 'experience_guest_sessions', foreign.session),
        testInsert(f, leaseTable, foreign.lease), testInsert(f, attemptTable, foreign.row), ...exactAfterStatements()]), /malformed JSON/iu);
      assert.deepEqual(await databaseSnapshot(f), baseline, `${label}: native failed proof rolls back the synthetic competing row`);
      aliases.push(label);
    }
    // The following matrix replays captured SQL truth only; it does not renew
    // the process-local reservation or require its monotonic deadline to grow.
    assert.deepEqual(io.state.calls, ['get', 'head']);
    assert.deepEqual(f.observed.actualMutations, [leaseTable, attemptTable]);
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, 'fixed-attempt-associations'), nativeJson,
      validUnrelatedAttemptAccepted: true, aliases, unchangedStatementReplay: true,
      fullCustodyLineageMatrixQualified: false }));
  } finally { io?.close(); }
});


// OFFLINE SOURCE CANDIDATE ONLY. Not imported, compiled, evaluated or executed.
// Private addition to the allocated D1 test; uses its existing assert/createHash imports.
// Adapted from resultClaimFixture, source SHA-256:
// 667dd46a6561bc5250ba6a5cb171b0636d13f01de3c6d959786010f61c17077e.
// This builds inert test data only. It performs no DB, R2, provider or custody operation.
const custodyMatrixHash = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const custodyMatrixTime = seconds => new Date(Date.UTC(2026, 8, 18) + seconds * 1000).toISOString();
function custodyMatrixUuidFactory() {
  const ids = new Map();
  return label => {
    if (!ids.has(label)) ids.set(label, crypto.randomUUID());
    return ids.get(label);
  };
}

async function buildUnrelatedCustody(f, {
  prefixCount = 5, projectDocument = 'absent', prefixProse = null,
  scopedPreflightId = null, scopedTargetId = null,
} = {}) {
  assert.ok([3, 5, 16].includes(prefixCount));
  assert.ok(['absent', 'null'].includes(projectDocument));
  assert.ok(prefixProse === null || typeof prefixProse === 'string');
  assert.ok(scopedPreflightId === null || typeof scopedPreflightId === 'string');
  assert.ok(scopedTargetId === null || typeof scopedTargetId === 'string');
  const [{ canonicalJson, digest }, { ownerMediaNamespace },
    { guestImageStageHistoryIdentity }, copyApi, claimApi] = await Promise.all([
    import('../src/experiences/compiler.ts'),
    import('../src/model/media-ownership.ts'),
    import('../worker/experience-guest-image-stage-custody.ts'),
    import('../worker/experience-guest-image-result-copy-contract.ts'),
    import('../worker/experience-guest-image-result-claim-contract.ts'),
  ]);
  const uuid = custodyMatrixUuidFactory(), hash = custodyMatrixHash, time = custodyMatrixTime;
  const namespace = uuid(0), sessionId = uuid(4), guestSubject = `guest:${uuid(5)}`;
  const projectId = uuid(6), documentId = uuid(7), generationId = uuid(8);
  const destinationUserId = `foreign-owner-${namespace}`, requestId = `foreign-request-${namespace}`;
  const scoped = label => `foreign-${label}-${namespace}`;
  const preflightId = scopedPreflightId ?? uuid(15), targetId = scopedTargetId ?? scoped('target');
  const bodyText = {
    confirmation: 'Synthetic confirmation body for the unrelated custody matrix.',
    quote: 'Synthetic quote body for the unrelated custody matrix.',
    construction: 'Synthetic construction body for the unrelated custody matrix.',
    planner: 'Synthetic planner body for the unrelated custody matrix.',
    prompt: 'Synthetic prompt body for the unrelated custody matrix.',
  };
  const bodyBytes = role => Buffer.byteLength(bodyText[role], 'utf8');
  const bodyDigest = role => hash(bodyText[role]);
  const sourceEventIds = Array.from({ length: prefixCount }, (_, index) => uuid(1000 + index));
  const manifest = {
    version: 1, kind: 'original-image-completed-result', sessionId, guestSubject, projectId, documentId,
    sourceHead: prefixCount, sourceSaveHead: prefixCount + 1, quoteHead: prefixCount + 3,
    runHead: prefixCount + 6, resultHead: prefixCount + 14, expiresAt: time(3600),
    draftHash: hash(scoped('draft')), contentDigest: hash(scoped('authored-source')), sourceEventIds,
    originalPayerUserId: 'payer-synthetic', generationId, completionEventId: uuid(9), usageEventId: uuid(10), completedAt: time(20),
    nativeIdentity: { scopeKey: scoped('scope'), jobId: scoped('job'), slotId: scoped('slot'),
      executionGrantId: scoped('execution-grant'), issuerGrantId: scoped('issuer-grant'), consumptionId: scoped('consumption'),
      planRevisionId: uuid(14), targetId, preflightId },
    financialReceipt: { period: '2026-09', tokenReservationId: scoped('token-hold'), costReservationId: scoped('cost-hold'),
      usedTokens: 123, usedMicrousd: 456 },
    privateContents: [
      { contentId: scoped('planner-source'), kind: 'provider-output', contentDigest: bodyDigest('planner'),
        bytes: bodyBytes('planner'), createdAt: time(10), expiresAt: time(3600) },
      { contentId: scoped('prompt-source'), kind: 'prompt', contentDigest: bodyDigest('prompt'),
        bytes: bodyBytes('prompt'), createdAt: time(11), expiresAt: time(4200) },
    ],
    object: { storageKey: `${ownerMediaNamespace(guestSubject)}/generated/${generationId}.png`,
      contentSha256: hash(scoped('synthetic-png-descriptor')).slice(7), mimeType: 'image/png', width: 2, height: 3,
      publicationEventId: uuid(9), recordedDescriptorOnly: true },
    nativeSnapshotDigest: hash(scoped('original-native-graph')),
  };
  // Assert fresh core identities against fixture data, never proof SQL/bindings.
  const original = f.inventoryData.manifest;
  for (const key of ['sessionId', 'guestSubject', 'projectId', 'documentId', 'generationId', 'completionEventId', 'usageEventId'])
    assert.notEqual(manifest[key], original[key], `foreign ${key}`);
  assert.equal(typeof f.fixture.claimOwner, 'string');
  assert.notEqual(destinationUserId, f.fixture.claimOwner);
  const manifestDigest = await digest(manifest), custodyId = uuid(18), attemptId = uuid(17), writerNonce = uuid(19);
  const leaseSnapshot = { session_id: sessionId, lease_id: uuid(16), destination_user_id: destinationUserId, manifest_digest: manifestDigest,
    request_id: requestId, request_ids_json: canonicalJson([requestId]), acquisitions: 1,
    created_at_ms: Date.parse(time(21)), expires_at_ms: Date.parse(time(90)) };
  const copy = { version: 1, kind: 'guest-image-result-copy', attemptId, custodyId, requestId, destinationUserId, manifestDigest,
    manifest, leaseSnapshot, source: { byteLength: 80, producerMetadata: { model: 'gpt-image-2', provider: 'openai',
      adapter: 'image-adapter-1', providerRequestId: '' } },
    destinationKey: copyApi.guestImageResultMediaKey({ destinationUserId, custodyId, outputId: `object-${generationId.slice(-8)}` }),
    destinationMetadata: copyApi.guestImageResultCopyMetadata({ attemptId, custodyId, destinationUserId, manifestDigest, manifest, writerNonce }),
    writerNonce };
  const contextLineage = { version: 1, sessionId, guestSubject, projectId, documentId, draftHash: manifest.draftHash, manifestDigest,
    sourceEventIds: [...sourceEventIds], sourceHead: prefixCount, destinationUserId, origin: 'https://forma.example',
    targetStart: 1, targetHead: prefixCount,
    events: Array.from({ length: prefixCount }, (_, index) => {
      const type = ['ProjectCreated', 'DocumentCreated', 'EmptyCanvasChosen'][index] ?? 'BlockCreated';
      const id = uuid(2000 + index), key = `guest-context-adoption:v1:${sessionId}:${index}`;
      const publicValue = { project_id: projectId,
        ...(index > 0 ? { document_id: documentId } : projectDocument === 'null' ? { document_id: null } : {}),
        ...(index >= 3 ? { block_id: uuid(3000 + index), type: 'intent' } : {}),
        _private_ref: id, client_event_id: key,
        ...(index === 0 && prefixProse !== null ? { note: prefixProse } : {}) };
      return { id, sequence: index + 1, occurred: time(28), recorded: time(28), type,
        public: canonicalJson(publicValue), privateDigest: hash(scoped(`prefix-private-${index}`)),
        project: projectId, document: index === 0 ? null : documentId, key };
    }), lease: structuredClone(leaseSnapshot) };
  const contextLineageDigest = await digest(contextLineage), requirementId = uuid(23), driverId = scoped('driver');
  const savePublic = (eventId, actor) => canonicalJson({ block_id: requirementId, type: 'output', scope: 'document', project_id: projectId,
    document_id: documentId, actor_user_id: actor, _private_ref: eventId });
  const command = (key, action, eventId, seconds, requestDigest) => ({ scope_key: `personal:${guestSubject}:${projectId}`,
    actor_user_id: guestSubject, command_key: key, request_digest: requestDigest, action, event_id: eventId, created_at: time(seconds) });
  const resource = (resourceId, operation, seconds) => ({ resource_id: resourceId, campaign_id: scoped('campaign'),
    policy_digest: hash(scoped('policy')), limits_digest: hash(scoped('limits')), actor_user_id: guestSubject,
    session_digest: hash(scoped('session')), operation, intent_key: driverId, payload_digest: hash(scoped('command')),
    text_bytes: 32, issued_grant_id: null, recorded_at_ms: Date.parse(time(seconds)) });
  const saveKey = scoped('save'), saveCommand = command(saveKey, 'save', uuid(11), 4, hash(scoped('save-request')).slice(7));
  const saveLineage = { version: 1, kind: 'first-image-save', sessionId, guestSubject, destinationUserId, projectId, documentId,
    draftId: `experience-draft-${hash(scoped('draft-id')).slice(7)}`, draftHash: manifest.draftHash, manifestDigest,
    origin: contextLineage.origin, contextLineageDigest,
    source: { head: prefixCount, eventIds: [...sourceEventIds], expiresAt: time(7200), sessionPolicyId: uuid(24), sessionTermsDigest: hash(scoped('terms')),
      sessionExpiresAtMs: Date.parse(time(7200)), sourcePolicyId: uuid(25), sourcePolicyDigest: hash(scoped('source-policy')),
      requestDigest: hash(scoped('request')), contentDigest: manifest.contentDigest, releaseHash: hash(scoped('release')),
      save: { id: uuid(11), sequence: prefixCount + 1, occurred: time(4), recorded: time(4), public: savePublic(uuid(11), guestSubject),
        privateDigest: hash(scoped('saved-private')) },
      command: saveCommand, resource: { ...resource(`${saveKey}:text`, 'text-intake', 4), intent_key: saveKey,
        payload_digest: `sha256:${saveCommand.request_digest}` } },
    target: { id: uuid(26), sequence: prefixCount + 1, occurred: time(28), recorded: time(28), public: savePublic(uuid(26), destinationUserId),
      privateDigest: hash(scoped('canonical-save-private')), commandKey: scoped('canonical-save'),
      requestDigest: hash(scoped('canonical-save-request')).slice(7), requirementId, contextHead: prefixCount } };
  const saveLineageDigest = await digest(saveLineage), preflightCommandDigest = hash(scoped('preflight-command')).slice(7);
  const stageLineage = { version: 1, kind: 'original-image-stage-custody', sessionId, guestSubject, destinationUserId, projectId, documentId,
    manifestDigest, nativeSnapshotDigest: hash(scoped('quoted-stage-graph')), contextLineageDigest, saveLineageDigest,
    source: { head: prefixCount, saveHead: prefixCount + 1, stageHead: prefixCount + 3, state: 'quoted', expiresAt: time(7200),
      originalPayerUserId: manifest.originalPayerUserId, saveEventId: uuid(11),
      confirmation: { id: uuid(12), sequence: prefixCount + 2, occurred: time(5), recorded: time(5),
        public: canonicalJson({ plan_revision_id: uuid(14), project_id: projectId, document_id: documentId,
          actor_user_id: guestSubject, _private_ref: uuid(12) }), privateDigest: bodyDigest('confirmation') },
      confirmationCommand: command(scoped('confirm'), 'confirm', uuid(12), 5, hash(scoped('confirm-request')).slice(7)),
      confirmationResource: resource(`${driverId}:text`, 'text-intake', 5),
      quote: { id: uuid(13), sequence: prefixCount + 3, occurred: time(6), recorded: time(6),
        public: canonicalJson({ preflight_id: preflightId, plan_revision_id: uuid(14), project_id: projectId,
          document_id: documentId, actor_user_id: guestSubject, _private_ref: uuid(13) }), privateDigest: bodyDigest('quote'),
        preflightId, planRevisionId: uuid(14), expiresAt: time(600), termsDigest: hash(scoped('quote-terms')).slice(7) },
      quoteCommand: command(scoped('preflight'), 'preflight', uuid(13), 6, preflightCommandDigest),
      construction: { driverId, commandDigest: preflightCommandDigest, resource: resource(`${driverId}:preflight`, 'preflight', 6) } },
    copies: [] };
  const stageCopies = [], resultCopies = [], bodies = [];
  for (const [index, role] of ['confirmation', 'quote', 'construction'].entries()) {
    const originalDigest = bodyDigest(role), byteLength = bodyBytes(role);
    const contentId = await guestImageStageHistoryIdentity({ sessionId, destinationUserId, manifestDigest, role, originalDigest });
    const createdAt = time(29), expiresAt = time(2600000 + index);
    stageLineage.copies.push({ role, contentId, digest: originalDigest, bytes: byteLength });
    stageCopies.push({ session_id: sessionId, role, content_id: contentId, original_digest: originalDigest,
      byte_length: byteLength, created_at: createdAt, expires_at: expiresAt });
    bodies.push({ content_id: contentId, owner_id: destinationUserId, kind: 'guest-image-stage-history',
      content: bodyText[role], created_at: createdAt, expires_at: expiresAt, redacted_at: null });
  }
  for (const [index, role] of ['planner', 'prompt'].entries()) {
    const source = manifest.privateContents[index];
    const contentId = await claimApi.guestImageResultHistoryIdentity({ sessionId, destinationUserId, manifestDigest,
      role, originalDigest: source.contentDigest });
    const createdAt = time(29), expiresAt = time(2592000 + index);
    resultCopies.push({ custody_id: custodyId, role, content_id: contentId, original_content_id: source.contentId,
      original_kind: source.kind, original_digest: source.contentDigest, byte_length: source.bytes, created_at: createdAt, expires_at: expiresAt });
    bodies.push({ content_id: contentId, owner_id: destinationUserId, kind: 'guest-image-result-history',
      content: bodyText[role], created_at: createdAt, expires_at: expiresAt, redacted_at: null });
  }
  const canonicalEventId = uuid(27), outputId = `object-${generationId.slice(-8)}`;
  const eventOrigin = claimApi.readGuestImageResultClaimEventOrigin({ version: 1, kind: 'guest-image-result-event-origin-v1',
    custodyId, claimEventId: canonicalEventId, outputId, generationId, manifestDigest });
  const eventEnvelope = canonicalJson({ custody_id: custodyId, object_id: outputId, generation_id: generationId,
    manifest_digest: manifestDigest, project_id: projectId, document_id: documentId, event_origin: eventOrigin });
  const value = { version: 1, kind: 'original-image-result-custody', copy, contextLineage, contextLineageDigest, saveLineage, saveLineageDigest,
    stageLineage, stageLineageDigest: await digest(stageLineage), stageCopies, resultCopies,
    originalCompletion: { eventId: manifest.completionEventId, sequence: prefixCount + 13, occurredAt: time(19), recordedAt: time(19),
      privateDigest: hash(scoped('original-completion')), objectId: outputId, ...structuredClone(copy.source.producerMetadata) },
    canonical: { eventId: canonicalEventId, streamId: `creative:${destinationUserId}`, sequence: prefixCount + 2,
      occurredAt: time(30), recordedAt: time(30), privateDigest: hash(eventEnvelope), expiresAt: time(2592000) } };
  assert.deepEqual(await copyApi.validateGuestImageResultCopyDescriptor(copy), copy);
  const lineage = await claimApi.readGuestImageResultClaimLineage(value);
  assert.deepEqual(lineage, value, 'contract-valid synthetic stored lineage, not an executed claim');
  const projected = await claimApi.guestImageResultClaimRows(lineage);
  assert.deepEqual(projected.eventOrigin, eventOrigin);
  assert.equal(hash(eventEnvelope), lineage.canonical.privateDigest);
  assert.equal(await digest(JSON.parse(eventEnvelope)), lineage.canonical.privateDigest);
  assert.equal(new Set(bodies.map(body => body.content_id)).size, 5);
  for (const [index, row] of [...lineage.stageCopies, ...lineage.resultCopies].entries()) {
    const body = bodies[index];
    assert.equal(body.content_id, row.content_id); assert.equal(body.owner_id, destinationUserId);
    assert.equal(Buffer.byteLength(body.content, 'utf8'), row.byte_length); assert.equal(hash(body.content), row.original_digest);
    assert.equal(body.created_at, row.created_at); assert.equal(body.expires_at, row.expires_at);
  }
  const attemptValue = { attempt_id: attemptId, custody_id: custodyId, session_id: sessionId, destination_user_id: destinationUserId,
    lease_id: leaseSnapshot.lease_id, lease_acquisition: 1, request_id: requestId, manifest_digest: manifestDigest,
    descriptor_json: canonicalJson(copy), descriptor_digest: await digest(copy), lease_snapshot_json: canonicalJson(leaseSnapshot),
    source_expires_at_ms: Date.parse(manifest.expiresAt), destination_key: copy.destinationKey, writer_nonce: writerNonce,
    content_sha256: manifest.object.contentSha256, byte_length: copy.source.byteLength, mime_type: 'image/png',
    width: manifest.object.width, height: manifest.object.height, destination_metadata_json: canonicalJson(copy.destinationMetadata),
    state: 'reserved', row_version: 0, put_outcome: 'pending', created_at_ms: leaseSnapshot.created_at_ms,
    updated_at_ms: leaseSnapshot.created_at_ms, put_started_at_ms: null, put_settled_at_ms: null, verified_at_ms: null,
    published_at_ms: null, published_claim_digest: null };
  const attempt = await copyApi.readGuestImageResultCopyAttemptRow(attemptValue);
  assert.deepEqual(attempt, attemptValue, 'strict initial synthetic reserved-v0 row');
  return { lineage, projected, bodies, attempt, eventEnvelope };
}


// Test-only raw-D1 additions. No capability accepts these rows or statements.
const custodyMatrixTables = Object.freeze([
  'experience_guest_sessions', leaseTable, attemptTable,
  'experience_guest_context_adoptions', 'experience_guest_image_claims',
  'experience_guest_image_stage_custodies', 'experience_guest_image_stage_copies',
  'private_content', 'events', 'event_private_payloads',
  'experience_guest_image_result_custodies', 'experience_guest_image_result_copies',
]);
function custodyMatrixInsert(f, table, row) {
  assert.ok(custodyMatrixTables.includes(table));
  const columns = Object.keys(row); assert.ok(columns.every(column => /^[a-z_][a-z_0-9]*$/u.test(column)));
  const sql = `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`;
  const bindings = columns.map(column => row[column]);
  f.qualifier.qualify(sql, bindings);
  return f.raw.prepare(sql).bind(...bindings);
}
function custodyMatrixStatement(f, sql, bindings) {
  f.qualifier.qualify(sql, bindings);
  return f.raw.prepare(sql).bind(...bindings);
}

/** Construct a fixed stored-data fixture. The three journal updates merely
 * seed synthetic ready metadata; they call no writer, bucket or final claim.
 * Strict unrelated lineages are checked by buildUnrelatedCustody. Hostile
 * variants change only the embedded result-custody JSON and its outer hash;
 * coherent foreign prerequisite ledgers and native scalar IDs stay untouched. */
async function custodyMatrixSeed(f, foreign, { lineageJson = foreign.projected.custody.lineage_json } = {}) {
  const [{ canonicalJson }, { publicEventPayload }] = await Promise.all([
    import('../src/experiences/compiler.ts'), import('../worker/event-privacy.ts'),
  ]);
  assert.equal(typeof lineageJson, 'string');
  const parsed = JSON.parse(lineageJson), l = foreign.lineage, copy = l.copy, m = copy.manifest, lease = copy.leaseSnapshot;
  assert.deepEqual(parsed.copy, l.copy, 'native descriptor is never changed by this matrix');
  assert.equal(parsed.canonical.eventId, l.canonical.eventId, 'native event FK is never changed');
  assert.equal(parsed.canonical.sequence, l.canonical.sequence);
  assert.equal(parsed.canonical.expiresAt, l.canonical.expiresAt);
  const original = (await nativeRows(f, 'experience_guest_sessions')).find(row => row.session_id === f.session.sessionId);
  assert.ok(original);
  const session = { ...original, session_id: m.sessionId, guest_subject: m.guestSubject,
    project_id: m.projectId, document_id: m.documentId,
    session_hash: custodyMatrixHash(crypto.randomUUID()), claim_hash: custodyMatrixHash(crypto.randomUUID()) };
  const common = { session_id: m.sessionId, destination_user_id: copy.destinationUserId, lease_id: lease.lease_id,
    request_id: copy.requestId, manifest_digest: copy.manifestDigest };
  const context = { ...common, lineage_json: canonicalJson(l.contextLineage), lineage_digest: l.contextLineageDigest,
    created_at_ms: Date.parse(custodyMatrixTime(28)) };
  const save = { ...common, context_lineage_digest: l.contextLineageDigest, lineage_json: canonicalJson(l.saveLineage),
    lineage_digest: l.saveLineageDigest, created_at_ms: Date.parse(custodyMatrixTime(28)) };
  const stage = { ...common, context_lineage_digest: l.contextLineageDigest, save_lineage_digest: l.saveLineageDigest,
    lineage_json: canonicalJson(l.stageLineage), lineage_digest: l.stageLineageDigest, created_at_ms: Date.parse(custodyMatrixTime(29)) };
  const envelope = JSON.parse(foreign.eventEnvelope), publicValue = publicEventPayload(l.canonical.eventId, envelope, true);
  assert.equal(custodyMatrixHash(publicValue.privateJson), l.canonical.privateDigest);
  const event = { event_id: l.canonical.eventId, stream_id: l.canonical.streamId, sequence: l.canonical.sequence,
    occurred_at: l.canonical.occurredAt, recorded_at: l.canonical.recordedAt, actor: `user:${copy.destinationUserId}`,
    client_id: 'synthetic-custody-fixture', correlation_id: copy.requestId, causation_id: null, compensates_event_id: null,
    schema_version: 1, type: 'GuestImageResultClaimed', payload: JSON.stringify(publicValue.payload) };
  const privateEvent = { private_event_id: l.canonical.eventId, owner_id: copy.destinationUserId,
    project_id: m.projectId, document_id: m.documentId, private_json: foreign.eventEnvelope,
    created_at: l.canonical.recordedAt, redacted_at: null };
  const custody = { ...foreign.projected.custody, lineage_json: lineageJson, lineage_digest: custodyMatrixHash(lineageJson) };
  const initial = foreign.attempt, started = initial.created_at_ms + 1000, settled = started + 1000, verified = settled + 1000;
  assert.ok(verified < custody.created_at_ms && custody.created_at_ms < lease.expires_at_ms);
  const writing = { ...initial, state: 'writing', row_version: 1, put_started_at_ms: started, updated_at_ms: started };
  const succeeded = { ...writing, row_version: 2, put_outcome: 'success', put_settled_at_ms: settled, updated_at_ms: settled };
  const ready = { ...succeeded, state: 'ready', row_version: 3, verified_at_ms: verified, updated_at_ms: verified };
  // These exact updates exercise the installed immutable-transition triggers;
  // their acknowledgements and all final stored scalars are checked below.
  const transitionStatements = [
    custodyMatrixStatement(f, `UPDATE ${attemptTable} SET state='writing',row_version=1,put_started_at_ms=?,updated_at_ms=? WHERE attempt_id=? AND state='reserved' AND row_version=0 AND put_outcome='pending'`, [started, started, initial.attempt_id]),
    custodyMatrixStatement(f, `UPDATE ${attemptTable} SET row_version=2,put_outcome='success',put_settled_at_ms=?,updated_at_ms=? WHERE attempt_id=? AND state='writing' AND row_version=1 AND put_outcome='pending'`, [settled, settled, initial.attempt_id]),
    custodyMatrixStatement(f, `UPDATE ${attemptTable} SET state='ready',row_version=3,verified_at_ms=?,updated_at_ms=? WHERE attempt_id=? AND state='writing' AND row_version=2 AND put_outcome='success'`, [verified, verified, initial.attempt_id]),
  ];
  const expected = [
    ['experience_guest_sessions', session], [leaseTable, lease], [attemptTable, ready],
    ['experience_guest_context_adoptions', context], ['experience_guest_image_claims', save],
    ['experience_guest_image_stage_custodies', stage],
    ...foreign.bodies.map(row => ['private_content', row]),
    ...l.stageCopies.map(row => ['experience_guest_image_stage_copies', row]),
    ['events', event], ['event_private_payloads', privateEvent],
    ['experience_guest_image_result_custodies', custody],
    ...foreign.projected.copies.map(row => ['experience_guest_image_result_copies', row]),
  ];
  const prefix = [custodyMatrixInsert(f, 'experience_guest_sessions', session), custodyMatrixInsert(f, leaseTable, lease),
    custodyMatrixInsert(f, attemptTable, initial), ...transitionStatements,
    ...expected.slice(3, -2).map(([table, row]) => custodyMatrixInsert(f, table, row))];
  const copies = foreign.projected.copies.map(row => custodyMatrixInsert(f, 'experience_guest_image_result_copies', row));
  return { prefix, copies, expected, transitionOffsets: [3, 4, 5], lineageJson, ready };
}

function capturedCustodyProofs(f) {
  const transition = f.observed.batches.find(batch => batch.some(row => row.mutationTable === attemptTable));
  assert.ok(transition);
  const at = transition.findIndex(row => row.mutationTable === attemptTable), proofs = transition.slice(at + 1);
  assert.ok(proofs.length > 0);
  for (const proof of proofs) {
    assert.equal(proof.mutationTable, null); assert.match(proof.sql, /^SELECT CASE WHEN /u);
    assert.ok(proof.sql.endsWith(" THEN 1 ELSE json_extract('invalid', '$.assertion') END AS current"));
  }
  // Captured complete SQL and binding arrays are replayed without alteration.
  return { proofs, statements: () => proofs.map(proof => f.raw.prepare(proof.sql).bind(...proof.bindings)) };
}
function assertCustodyProofResults(results, offset, count) {
  assert.equal(results.slice(offset, offset + count).length, count);
  for (const result of results.slice(offset, offset + count)) {
    assert.equal(result.success, true); assert.deepEqual(result.results, [{ current: 1 }]);
  }
}
async function assertCustodySeedReadback(f, seed, before) {
  const after = await databaseSnapshot(f); assert.deepEqual(after.schema, before.schema);
  // Existing scalar values and rowids are preserved even in appended tables.
  for (const [table, rows] of Object.entries(before.rows)) {
    assert.deepEqual(after.rows[table].slice(0, rows.length), rows, `preserved existing ${table}`);
    assert.equal(after.rows[table].length, rows.length + seed.expected.filter(([name]) => name === table).length, `exact appended ${table}`);
  }
  for (const table of new Set(seed.expected.map(([name]) => name))) {
    const rows = await nativeRows(f, table);
    for (const [, expected] of seed.expected.filter(([name]) => name === table))
      assert.equal(rows.filter(row => Object.keys(row).length === Object.keys(expected).length
        && Object.entries(expected).every(([key, value]) => Object.is(row[key], value))).length, 1, `exact synthetic ${table} row`);
  }
  assert.deepEqual((await f.raw.prepare('PRAGMA foreign_key_check').all()).results, []);
  return after;
}
async function acceptUnrelatedCustody(f, capture, options) {
  const foreign = await buildUnrelatedCustody(f, options), seed = await custodyMatrixSeed(f, foreign);
  const before = await databaseSnapshot(f);
  const result = await f.raw.batch([...seed.prefix, ...capture.statements(), ...seed.copies, ...capture.statements()]);
  assert.ok(result.every(row => row.success === true));
  for (const index of seed.transitionOffsets) assert.equal(result[index].meta.changes, 1, 'one synthetic journal successor');
  assertCustodyProofResults(result, seed.prefix.length, capture.proofs.length);
  assertCustodyProofResults(result, seed.prefix.length + capture.proofs.length + seed.copies.length, capture.proofs.length);
  const after = await assertCustodySeedReadback(f, seed, before);
  return { foreign, after };
}

async function custodyProjectionTargets(f) {
  const m = f.inventoryData.manifest, events = (await nativeRows(f, 'events')).filter(row => row.stream_id === `creative:${m.guestSubject}`);
  const commands = (await nativeRows(f, 'output_commands')).filter(row => row.actor_user_id === m.guestSubject);
  const command = action => { const rows = commands.filter(row => row.action === action); assert.equal(rows.length, 1); return rows[0]; };
  const save = command('save'), confirm = command('confirm'), preflight = command('preflight');
  const saveEvent = events.find(row => row.event_id === save.event_id); assert.ok(saveEvent);
  const requirementId = JSON.parse(saveEvent.payload).block_id; assert.equal(typeof requirementId, 'string');
  const source = (await nativeRows(f, 'experience_guest_sources')).find(row => row.session_id === m.sessionId); assert.ok(source);
  const drivers = (await nativeRows(f, 'experience_sponsor_driver_intents')).filter(row => row.actor_user_id === m.guestSubject);
  assert.equal(drivers.length, 1); const driverId = drivers[0].driver_id;
  const resources = (await nativeRows(f, 'experience_sponsor_resource_receipts')).filter(row => row.actor_user_id === m.guestSubject);
  const exactResource = id => { const rows = resources.filter(row => row.resource_id === id); assert.equal(rows.length, 1); return rows[0].resource_id; };
  const blockIds = events.filter(row => m.sourceEventIds.includes(row.event_id)).flatMap(row => {
    const value = JSON.parse(row.payload); return typeof value.block_id === 'string' ? [value.block_id] : [];
  });
  assert.ok(blockIds.length > 0);
  for (const body of m.privateContents) assert.equal((await nativeRows(f, 'private_content')).filter(row => row.content_id === body.contentId).length, 1);
  return { sessionId: m.sessionId, guestSubject: m.guestSubject, projectId: m.projectId, documentId: m.documentId,
    sourceEventIds: [...m.sourceEventIds], saveEventId: save.event_id, requirementId, draftId: source.draft_id,
    commandScope: save.scope_key, commandActor: save.actor_user_id,
    commandEventIds: { save: save.event_id, confirm: confirm.event_id, preflight: preflight.event_id },
    resourceIds: { save: exactResource(`${save.command_key}:text`), confirmation: exactResource(`${driverId}:text`), construction: exactResource(`${driverId}:preflight`) },
    driverId, planRevisionId: m.nativeIdentity.planRevisionId, preflightId: m.nativeIdentity.preflightId,
    completionEventId: m.completionEventId, objectId: `object-${m.generationId.slice(-8)}`,
    streamId: `creative:${m.guestSubject}`, bodyIds: m.privateContents.map(row => row.contentId), blockIds };
}

async function beginCustodyMatrix(t) {
  const f = await actualD1Fixture(t), api = await claimApis();
  const io = f.helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
  try {
    await inspectOriginal(f); const { leased, lease } = await leaseOriginal(f, api);
    const bytes = await api.readLeasedGuestImageResultMedia(f.request, f.env, leased);
    const reserved = await api.reserveGuestImageResultMedia(f.request, f.env, bytes);
    assert.equal(reserved.status, 'reserved'); await exactReservedRow(f, lease);
    // Any capability assertion happens now, before long raw-SQL fixture work.
    await api.assertGuestImageResultReservedCurrent(f.request, f.env, reserved.reservation);
    const capture = capturedCustodyProofs(f);
    return { f, io, capture };
  } catch (error) { io.close(); throw error; }
}

function assertCustodyMatrixIo(f, io) {
  assert.deepEqual(io.state.calls, ['get', 'head']);
  assert.deepEqual(f.observed.actualMutations, [leaseTable, attemptTable]);
  assert.deepEqual(f.observed.violations, []);
}

test('actual local D1 smallest complete unrelated custody preserves genuine reserve proofs', { timeout: 120000 }, async t => {
  const { f, io, capture } = await beginCustodyMatrix(t);
  try {
    const nativeJson = await nativeJsonProjectionProbe(f);
    await acceptUnrelatedCustody(f, capture, { prefixCount: 5 });
    assertCustodyMatrixIo(f, io);
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, 'custody-unrelated-smallest'), nativeJson,
      unrelatedStrictLineage: true, prefixAndCompleteProofs: true, syntheticReadyJournalOnly: true,
      copiedBodies: 5, resultMappings: 2, proofSqlSha256: capture.proofs.map(row => row.sqlSha256),
      fullCustodyLineageMatrixQualified: false }));
  } finally { io.close(); }
});

test('actual local D1 unrelated custody accepts prefix bounds and scoped IDs without prose association', { timeout: 120000 }, async t => {
  const { f, io, capture } = await beginCustodyMatrix(t);
  try {
    const original = f.inventoryData.manifest;
    const positiveOptions = [
      { prefixCount: 3, projectDocument: 'absent' },
      { prefixCount: 3, projectDocument: 'null' },
      { prefixCount: 16, projectDocument: 'absent' },
      { prefixCount: 16, projectDocument: 'null', prefixProse: original.sessionId,
        scopedPreflightId: original.nativeIdentity.preflightId, scopedTargetId: original.nativeIdentity.targetId },
    ];
    for (const options of positiveOptions) await acceptUnrelatedCustody(f, capture, options);
    assertCustodyMatrixIo(f, io);
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, 'custody-unrelated-boundaries'), positiveOptions,
      unrelatedPositiveCount: positiveOptions.length, unchangedStatementReplay: true,
      proofSqlSha256: capture.proofs.map(row => row.sqlSha256), fullCustodyLineageMatrixQualified: false }));
  } finally { io.close(); }
});


// OFFLINE SOURCE CANDIDATE ONLY: no application/test/runtime execution occurred.
// Private addition to the allocated D1 test; uses its existing assert import.
// These closures mutate only a cloned result-custody embedded lineage. They do
// not touch its copy subtree, canonical.eventId or direct native custody columns.
// Hostile lineage is deliberately semantically invalid. Keep coherent foreign
// prerequisites unchanged; never reparse it as an accepted completed claim.
// Defaults require a 16-event builder baseline. Options only select an inert
// baseline; no options or callbacks reach application code.
function custodyCaseAt(value, path) {
  return path.reduce((node, key) => node[key], value);
}
function custodyCaseSet(value, path, replacement) {
  assert.ok(path.length > 0);
  custodyCaseAt(value, path.slice(0, -1))[path.at(-1)] = replacement;
}
function custodyCaseDrop(value, path) {
  assert.ok(path.length > 0);
  delete custodyCaseAt(value, path.slice(0, -1))[path.at(-1)];
}
function custodyCasePublic(value, path, mutate) {
  const payload = JSON.parse(custodyCaseAt(value, path));
  assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload));
  mutate(payload);
  custodyCaseSet(value, path, JSON.stringify(payload));
}
function custodyCaseDuplicateRawKey(raw, key, duplicate, position) {
  const parsed = JSON.parse(raw);
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  assert.ok(Object.hasOwn(parsed, key), 'duplicate an existing fixed key');
  assert.ok(raw.startsWith('{') && raw.endsWith('}'));
  assert.ok(position === 'first' || position === 'last');
  const entry = `${JSON.stringify(key)}:${JSON.stringify(duplicate)}`;
  return position === 'first' ? `{${entry},${raw.slice(1)}` : `${raw.slice(0, -1)},${entry}}`;
}
function custodyCaseDuplicateOuterKey(serialized, path, key) {
  const object = custodyCaseAt(JSON.parse(serialized), path);
  assert.ok(Object.hasOwn(object, key));
  const before = JSON.stringify(object);
  const after = custodyCaseDuplicateRawKey(before, key, object[key], 'first');
  if (path.length === 0) return after;
  const index = serialized.indexOf(before);
  assert.ok(index >= 0, 'exact fixed object serialization occurs in lineage');
  assert.equal(serialized.indexOf(before, index + before.length), -1, 'target subtree is unambiguous');
  return serialized.slice(0, index) + after + serialized.slice(index + before.length);
}

// Group membership is static. Passing null registers names and creates closures;
// targets are dereferenced only when a case is applied to its isolated fixture.
// textChange returns exact duplicate-bearing JSON: hash/store those returned bytes
// directly. Parsing and reserializing afterwards would erase the duplicate control.
function custodyProjectionGroups(targets) {
  return [
    { name: "identity-01-root-owners", cases: [
      { name: "contextLineage.sessionId", change: value => custodyCaseSet(value, ["contextLineage","sessionId"], targets.sessionId), options: {"prefixCount":16} },
      { name: "contextLineage.guestSubject", change: value => custodyCaseSet(value, ["contextLineage","guestSubject"], targets.guestSubject), options: {"prefixCount":16} },
      { name: "contextLineage.projectId", change: value => custodyCaseSet(value, ["contextLineage","projectId"], targets.projectId), options: {"prefixCount":16} },
      { name: "contextLineage.documentId", change: value => custodyCaseSet(value, ["contextLineage","documentId"], targets.documentId), options: {"prefixCount":16} },
      { name: "saveLineage.sessionId", change: value => custodyCaseSet(value, ["saveLineage","sessionId"], targets.sessionId), options: {"prefixCount":16} },
      { name: "saveLineage.guestSubject", change: value => custodyCaseSet(value, ["saveLineage","guestSubject"], targets.guestSubject), options: {"prefixCount":16} },
      { name: "saveLineage.projectId", change: value => custodyCaseSet(value, ["saveLineage","projectId"], targets.projectId), options: {"prefixCount":16} },
      { name: "saveLineage.documentId", change: value => custodyCaseSet(value, ["saveLineage","documentId"], targets.documentId), options: {"prefixCount":16} },
    ] },
    { name: "identity-02-root-owners-to-sources", cases: [
      { name: "stageLineage.sessionId", change: value => custodyCaseSet(value, ["stageLineage","sessionId"], targets.sessionId), options: {"prefixCount":16} },
      { name: "stageLineage.guestSubject", change: value => custodyCaseSet(value, ["stageLineage","guestSubject"], targets.guestSubject), options: {"prefixCount":16} },
      { name: "stageLineage.projectId", change: value => custodyCaseSet(value, ["stageLineage","projectId"], targets.projectId), options: {"prefixCount":16} },
      { name: "stageLineage.documentId", change: value => custodyCaseSet(value, ["stageLineage","documentId"], targets.documentId), options: {"prefixCount":16} },
      { name: "contextLineage.lease.session_id", change: value => custodyCaseSet(value, ["contextLineage","lease","session_id"], targets.sessionId), options: {"prefixCount":16} },
      { name: "contextLineage.sourceEventIds.0", change: value => custodyCaseSet(value, ["contextLineage","sourceEventIds",0], targets.sourceEventIds[0]), options: {"prefixCount":16} },
      { name: "contextLineage.sourceEventIds.15", change: value => custodyCaseSet(value, ["contextLineage","sourceEventIds",15], targets.sourceEventIds[targets.sourceEventIds.length - 1]), options: {"prefixCount":16} },
      { name: "saveLineage.source.eventIds.0", change: value => custodyCaseSet(value, ["saveLineage","source","eventIds",0], targets.sourceEventIds[0]), options: {"prefixCount":16} },
    ] },
    { name: "identity-03-sources-to-commands", cases: [
      { name: "saveLineage.source.eventIds.15", change: value => custodyCaseSet(value, ["saveLineage","source","eventIds",15], targets.sourceEventIds[targets.sourceEventIds.length - 1]), options: {"prefixCount":16} },
      { name: "saveLineage.draftId", change: value => custodyCaseSet(value, ["saveLineage","draftId"], targets.draftId), options: {"prefixCount":16} },
      { name: "saveLineage.source.save.id", change: value => custodyCaseSet(value, ["saveLineage","source","save","id"], targets.saveEventId), options: {"prefixCount":16} },
      { name: "saveLineage.target.id", change: value => custodyCaseSet(value, ["saveLineage","target","id"], targets.saveEventId), options: {"prefixCount":16} },
      { name: "saveLineage.target.requirementId", change: value => custodyCaseSet(value, ["saveLineage","target","requirementId"], targets.requirementId), options: {"prefixCount":16} },
      { name: "saveLineage.source.command.scope_key", change: value => custodyCaseSet(value, ["saveLineage","source","command","scope_key"], targets.commandScope), options: {"prefixCount":16} },
      { name: "saveLineage.source.command.actor_user_id", change: value => custodyCaseSet(value, ["saveLineage","source","command","actor_user_id"], targets.commandActor), options: {"prefixCount":16} },
      { name: "saveLineage.source.command.event_id", change: value => custodyCaseSet(value, ["saveLineage","source","command","event_id"], targets.commandEventIds.save), options: {"prefixCount":16} },
    ] },
    { name: "identity-04-commands-to-resources", cases: [
      { name: "stageLineage.source.confirmationCommand.scope_key", change: value => custodyCaseSet(value, ["stageLineage","source","confirmationCommand","scope_key"], targets.commandScope), options: {"prefixCount":16} },
      { name: "stageLineage.source.confirmationCommand.actor_user_id", change: value => custodyCaseSet(value, ["stageLineage","source","confirmationCommand","actor_user_id"], targets.commandActor), options: {"prefixCount":16} },
      { name: "stageLineage.source.confirmationCommand.event_id", change: value => custodyCaseSet(value, ["stageLineage","source","confirmationCommand","event_id"], targets.commandEventIds.confirm), options: {"prefixCount":16} },
      { name: "stageLineage.source.quoteCommand.scope_key", change: value => custodyCaseSet(value, ["stageLineage","source","quoteCommand","scope_key"], targets.commandScope), options: {"prefixCount":16} },
      { name: "stageLineage.source.quoteCommand.actor_user_id", change: value => custodyCaseSet(value, ["stageLineage","source","quoteCommand","actor_user_id"], targets.commandActor), options: {"prefixCount":16} },
      { name: "stageLineage.source.quoteCommand.event_id", change: value => custodyCaseSet(value, ["stageLineage","source","quoteCommand","event_id"], targets.commandEventIds.preflight), options: {"prefixCount":16} },
      { name: "saveLineage.source.resource.resource_id", change: value => custodyCaseSet(value, ["saveLineage","source","resource","resource_id"], targets.resourceIds.save), options: {"prefixCount":16} },
      { name: "saveLineage.source.resource.actor_user_id", change: value => custodyCaseSet(value, ["saveLineage","source","resource","actor_user_id"], targets.guestSubject), options: {"prefixCount":16} },
    ] },
    { name: "identity-05-resources-to-stage-identities", cases: [
      { name: "stageLineage.source.confirmationResource.resource_id", change: value => custodyCaseSet(value, ["stageLineage","source","confirmationResource","resource_id"], targets.resourceIds.confirmation), options: {"prefixCount":16} },
      { name: "stageLineage.source.confirmationResource.actor_user_id", change: value => custodyCaseSet(value, ["stageLineage","source","confirmationResource","actor_user_id"], targets.guestSubject), options: {"prefixCount":16} },
      { name: "stageLineage.source.construction.resource.resource_id", change: value => custodyCaseSet(value, ["stageLineage","source","construction","resource","resource_id"], targets.resourceIds.construction), options: {"prefixCount":16} },
      { name: "stageLineage.source.construction.resource.actor_user_id", change: value => custodyCaseSet(value, ["stageLineage","source","construction","resource","actor_user_id"], targets.guestSubject), options: {"prefixCount":16} },
      { name: "originalCompletion.eventId", change: value => custodyCaseSet(value, ["originalCompletion","eventId"], targets.completionEventId), options: {"prefixCount":16} },
      { name: "originalCompletion.objectId", change: value => custodyCaseSet(value, ["originalCompletion","objectId"], targets.objectId), options: {"prefixCount":16} },
      { name: "canonical.streamId", change: value => custodyCaseSet(value, ["canonical","streamId"], targets.streamId), options: {"prefixCount":16} },
      { name: "stageLineage.source.saveEventId", change: value => custodyCaseSet(value, ["stageLineage","source","saveEventId"], targets.saveEventId), options: {"prefixCount":16} },
    ] },
    { name: "identity-06-stage-identities-to-copied-bodies", cases: [
      { name: "stageLineage.source.confirmation.id", change: value => custodyCaseSet(value, ["stageLineage","source","confirmation","id"], targets.commandEventIds.confirm), options: {"prefixCount":16} },
      { name: "stageLineage.source.quote.id", change: value => custodyCaseSet(value, ["stageLineage","source","quote","id"], targets.commandEventIds.preflight), options: {"prefixCount":16} },
      { name: "stageLineage.source.quote.planRevisionId", change: value => custodyCaseSet(value, ["stageLineage","source","quote","planRevisionId"], targets.planRevisionId), options: {"prefixCount":16} },
      { name: "stageLineage.source.construction.driverId", change: value => custodyCaseSet(value, ["stageLineage","source","construction","driverId"], targets.driverId), options: {"prefixCount":16} },
      { name: "stageLineage.copies.0.contentId", change: value => custodyCaseSet(value, ["stageLineage","copies",0,"contentId"], targets.bodyIds[0]), options: {"prefixCount":16} },
      { name: "stageLineage.copies.1.contentId", change: value => custodyCaseSet(value, ["stageLineage","copies",1,"contentId"], targets.bodyIds[1]), options: {"prefixCount":16} },
      { name: "stageLineage.copies.2.contentId", change: value => custodyCaseSet(value, ["stageLineage","copies",2,"contentId"], targets.bodyIds[0]), options: {"prefixCount":16} },
      { name: "resultCopies.0.content_id", change: value => custodyCaseSet(value, ["resultCopies",0,"content_id"], targets.bodyIds[0]), options: {"prefixCount":16} },
    ] },
    { name: "identity-07-copied-bodies", cases: [
      { name: "resultCopies.0.original_content_id", change: value => custodyCaseSet(value, ["resultCopies",0,"original_content_id"], targets.bodyIds[0]), options: {"prefixCount":16} },
      { name: "resultCopies.1.content_id", change: value => custodyCaseSet(value, ["resultCopies",1,"content_id"], targets.bodyIds[1]), options: {"prefixCount":16} },
      { name: "resultCopies.1.original_content_id", change: value => custodyCaseSet(value, ["resultCopies",1,"original_content_id"], targets.bodyIds[1]), options: {"prefixCount":16} },
      { name: "stageCopies.0.session_id", change: value => custodyCaseSet(value, ["stageCopies",0,"session_id"], targets.sessionId), options: {"prefixCount":16} },
      { name: "stageCopies.0.content_id", change: value => custodyCaseSet(value, ["stageCopies",0,"content_id"], targets.bodyIds[0]), options: {"prefixCount":16} },
      { name: "stageCopies.1.session_id", change: value => custodyCaseSet(value, ["stageCopies",1,"session_id"], targets.sessionId), options: {"prefixCount":16} },
      { name: "stageCopies.1.content_id", change: value => custodyCaseSet(value, ["stageCopies",1,"content_id"], targets.bodyIds[1]), options: {"prefixCount":16} },
      { name: "stageCopies.2.session_id", change: value => custodyCaseSet(value, ["stageCopies",2,"session_id"], targets.sessionId), options: {"prefixCount":16} },
    ] },
    { name: "identity-08-copied-bodies-to-context-events", cases: [
      { name: "stageCopies.2.content_id", change: value => custodyCaseSet(value, ["stageCopies",2,"content_id"], targets.bodyIds[0]), options: {"prefixCount":16} },
      { name: "contextLineage.events.0.id", change: value => custodyCaseSet(value, ["contextLineage","events",0,"id"], targets.sourceEventIds[0]), options: {"prefixCount":16} },
      { name: "contextLineage.events.0.project", change: value => custodyCaseSet(value, ["contextLineage","events",0,"project"], targets.projectId), options: {"prefixCount":16} },
      { name: "contextLineage.events.1.id", change: value => custodyCaseSet(value, ["contextLineage","events",1,"id"], targets.sourceEventIds[0]), options: {"prefixCount":16} },
      { name: "contextLineage.events.1.document", change: value => custodyCaseSet(value, ["contextLineage","events",1,"document"], targets.documentId), options: {"prefixCount":16} },
      { name: "contextLineage.events.3.id", change: value => custodyCaseSet(value, ["contextLineage","events",3,"id"], targets.sourceEventIds[0]), options: {"prefixCount":16} },
      { name: "contextLineage.events.15.id", change: value => custodyCaseSet(value, ["contextLineage","events",15,"id"], targets.sourceEventIds[targets.sourceEventIds.length - 1]), options: {"prefixCount":16} },
      { name: "contextLineage.events.15.project", change: value => custodyCaseSet(value, ["contextLineage","events",15,"project"], targets.projectId), options: {"prefixCount":16} },
    ] },
    { name: "identity-09-context-events-to-prefix-public", cases: [
      { name: "contextLineage.events.15.document", change: value => custodyCaseSet(value, ["contextLineage","events",15,"document"], targets.documentId), options: {"prefixCount":16} },
      { name: "contextLineage.events.0.public:_private_ref", change: value => custodyCasePublic(value, ["contextLineage","events",0,"public"], payload => { payload["_private_ref"] = targets.sourceEventIds[0]; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.0.public:project_id", change: value => custodyCasePublic(value, ["contextLineage","events",0,"public"], payload => { payload["project_id"] = targets.projectId; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.1.public:_private_ref", change: value => custodyCasePublic(value, ["contextLineage","events",1,"public"], payload => { payload["_private_ref"] = targets.sourceEventIds[0]; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.1.public:project_id", change: value => custodyCasePublic(value, ["contextLineage","events",1,"public"], payload => { payload["project_id"] = targets.projectId; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.1.public:document_id", change: value => custodyCasePublic(value, ["contextLineage","events",1,"public"], payload => { payload["document_id"] = targets.documentId; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.2.public:_private_ref", change: value => custodyCasePublic(value, ["contextLineage","events",2,"public"], payload => { payload["_private_ref"] = targets.sourceEventIds[0]; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.2.public:project_id", change: value => custodyCasePublic(value, ["contextLineage","events",2,"public"], payload => { payload["project_id"] = targets.projectId; }), options: {"prefixCount":16} },
    ] },
    { name: "identity-10-prefix-public", cases: [
      { name: "contextLineage.events.2.public:document_id", change: value => custodyCasePublic(value, ["contextLineage","events",2,"public"], payload => { payload["document_id"] = targets.documentId; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.3.public:_private_ref", change: value => custodyCasePublic(value, ["contextLineage","events",3,"public"], payload => { payload["_private_ref"] = targets.sourceEventIds[0]; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.3.public:project_id", change: value => custodyCasePublic(value, ["contextLineage","events",3,"public"], payload => { payload["project_id"] = targets.projectId; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.3.public:document_id", change: value => custodyCasePublic(value, ["contextLineage","events",3,"public"], payload => { payload["document_id"] = targets.documentId; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.3.public:block_id", change: value => custodyCasePublic(value, ["contextLineage","events",3,"public"], payload => { payload["block_id"] = targets.blockIds[0]; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.15.public:_private_ref", change: value => custodyCasePublic(value, ["contextLineage","events",15,"public"], payload => { payload["_private_ref"] = targets.sourceEventIds[0]; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.15.public:project_id", change: value => custodyCasePublic(value, ["contextLineage","events",15,"public"], payload => { payload["project_id"] = targets.projectId; }), options: {"prefixCount":16} },
      { name: "contextLineage.events.15.public:document_id", change: value => custodyCasePublic(value, ["contextLineage","events",15,"public"], payload => { payload["document_id"] = targets.documentId; }), options: {"prefixCount":16} },
    ] },
    { name: "identity-11-prefix-public-to-save-public", cases: [
      { name: "contextLineage.events.15.public:block_id", change: value => custodyCasePublic(value, ["contextLineage","events",15,"public"], payload => { payload["block_id"] = targets.blockIds[0]; }), options: {"prefixCount":16} },
      { name: "saveLineage.source.save.public:_private_ref", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { payload["_private_ref"] = targets.sourceEventIds[0]; }), options: {"prefixCount":16} },
      { name: "saveLineage.source.save.public:block_id", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { payload["block_id"] = targets.blockIds[0]; }), options: {"prefixCount":16} },
      { name: "saveLineage.source.save.public:project_id", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { payload["project_id"] = targets.projectId; }), options: {"prefixCount":16} },
      { name: "saveLineage.source.save.public:document_id", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { payload["document_id"] = targets.documentId; }), options: {"prefixCount":16} },
      { name: "saveLineage.source.save.public:actor_user_id", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { payload["actor_user_id"] = targets.guestSubject; }), options: {"prefixCount":16} },
      { name: "saveLineage.target.public:_private_ref", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["_private_ref"] = targets.sourceEventIds[0]; }), options: {"prefixCount":16} },
      { name: "saveLineage.target.public:block_id", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["block_id"] = targets.blockIds[0]; }), options: {"prefixCount":16} },
    ] },
    { name: "identity-12-save-public-to-stage-public", cases: [
      { name: "saveLineage.target.public:project_id", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["project_id"] = targets.projectId; }), options: {"prefixCount":16} },
      { name: "saveLineage.target.public:document_id", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["document_id"] = targets.documentId; }), options: {"prefixCount":16} },
      { name: "saveLineage.target.public:actor_user_id", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["actor_user_id"] = targets.guestSubject; }), options: {"prefixCount":16} },
      { name: "stageLineage.source.confirmation.public:_private_ref", change: value => custodyCasePublic(value, ["stageLineage","source","confirmation","public"], payload => { payload["_private_ref"] = targets.sourceEventIds[0]; }), options: {"prefixCount":16} },
      { name: "stageLineage.source.confirmation.public:plan_revision_id", change: value => custodyCasePublic(value, ["stageLineage","source","confirmation","public"], payload => { payload["plan_revision_id"] = targets.planRevisionId; }), options: {"prefixCount":16} },
      { name: "stageLineage.source.confirmation.public:project_id", change: value => custodyCasePublic(value, ["stageLineage","source","confirmation","public"], payload => { payload["project_id"] = targets.projectId; }), options: {"prefixCount":16} },
      { name: "stageLineage.source.confirmation.public:document_id", change: value => custodyCasePublic(value, ["stageLineage","source","confirmation","public"], payload => { payload["document_id"] = targets.documentId; }), options: {"prefixCount":16} },
      { name: "stageLineage.source.confirmation.public:actor_user_id", change: value => custodyCasePublic(value, ["stageLineage","source","confirmation","public"], payload => { payload["actor_user_id"] = targets.guestSubject; }), options: {"prefixCount":16} },
    ] },
    { name: "identity-13-stage-public", cases: [
      { name: "stageLineage.source.quote.public:_private_ref", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { payload["_private_ref"] = targets.sourceEventIds[0]; }), options: {"prefixCount":16} },
      { name: "stageLineage.source.quote.public:plan_revision_id", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { payload["plan_revision_id"] = targets.planRevisionId; }), options: {"prefixCount":16} },
      { name: "stageLineage.source.quote.public:project_id", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { payload["project_id"] = targets.projectId; }), options: {"prefixCount":16} },
      { name: "stageLineage.source.quote.public:document_id", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { payload["document_id"] = targets.documentId; }), options: {"prefixCount":16} },
      { name: "stageLineage.source.quote.public:actor_user_id", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { payload["actor_user_id"] = targets.guestSubject; }), options: {"prefixCount":16} },
    ] },
    { name: "shape-01-constants", cases: [
      { name: "wrong constant version", change: value => custodyCaseSet(value, ["version"], 2), options: {"prefixCount":16} },
      { name: "wrong constant kind", change: value => custodyCaseSet(value, ["kind"], "unrelated-kind"), options: {"prefixCount":16} },
      { name: "wrong constant contextLineage.version", change: value => custodyCaseSet(value, ["contextLineage","version"], 2), options: {"prefixCount":16} },
      { name: "wrong constant saveLineage.version", change: value => custodyCaseSet(value, ["saveLineage","version"], 2), options: {"prefixCount":16} },
      { name: "wrong constant saveLineage.kind", change: value => custodyCaseSet(value, ["saveLineage","kind"], "unrelated-save-kind"), options: {"prefixCount":16} },
      { name: "wrong constant stageLineage.version", change: value => custodyCaseSet(value, ["stageLineage","version"], 2), options: {"prefixCount":16} },
      { name: "wrong constant stageLineage.kind", change: value => custodyCaseSet(value, ["stageLineage","kind"], "unrelated-stage-kind"), options: {"prefixCount":16} },
      { name: "wrong constant stageLineage.source.state", change: value => custodyCaseSet(value, ["stageLineage","source","state"], "confirmed"), options: {"prefixCount":16} },
    ] },
    { name: "shape-02-required-nodes", cases: [
      { name: "missing contextLineage.sessionId", change: value => custodyCaseDrop(value, ["contextLineage","sessionId"]), options: {"prefixCount":16} },
      { name: "selected text is null", change: value => custodyCaseSet(value, ["contextLineage","sessionId"], null), options: {"prefixCount":16} },
      { name: "selected text is number", change: value => custodyCaseSet(value, ["contextLineage","sessionId"], 7), options: {"prefixCount":16} },
      { name: "selected text is object", change: value => custodyCaseSet(value, ["contextLineage","sessionId"], {}), options: {"prefixCount":16} },
      { name: "selected parent wrong type contextLineage", change: value => custodyCaseSet(value, ["contextLineage"], null), options: {"prefixCount":16} },
      { name: "selected parent wrong type saveLineage.source", change: value => custodyCaseSet(value, ["saveLineage","source"], []), options: {"prefixCount":16} },
      { name: "selected parent wrong type stageLineage.source.construction", change: value => custodyCaseSet(value, ["stageLineage","source","construction"], "wrong-parent"), options: {"prefixCount":16} },
      { name: "selected parent wrong type originalCompletion", change: value => custodyCaseSet(value, ["originalCompletion"], []), options: {"prefixCount":16} },
    ] },
    { name: "shape-03-required-nodes-to-array-bounds", cases: [
      { name: "missing stageLineage.source.confirmationCommand", change: value => custodyCaseDrop(value, ["stageLineage","source","confirmationCommand"]), options: {"prefixCount":16} },
      { name: "contextLineage.sourceEventIds below minimum", change: value => custodyCaseSet(value, ["contextLineage","sourceEventIds"], custodyCaseAt(value, ["contextLineage","sourceEventIds"]).slice(0, 2)), options: {"prefixCount":16} },
      { name: "contextLineage.sourceEventIds above maximum", change: value => { const array = custodyCaseAt(value, ["contextLineage","sourceEventIds"]); while (array.length <= 16) array.push(structuredClone(array[0])); }, options: {"prefixCount":16} },
      { name: "contextLineage.sourceEventIds wrong element type", change: value => custodyCaseSet(value, ["contextLineage","sourceEventIds",0], null), options: {"prefixCount":16} },
      { name: "saveLineage.source.eventIds below minimum", change: value => custodyCaseSet(value, ["saveLineage","source","eventIds"], custodyCaseAt(value, ["saveLineage","source","eventIds"]).slice(0, 2)), options: {"prefixCount":16} },
      { name: "saveLineage.source.eventIds above maximum", change: value => { const array = custodyCaseAt(value, ["saveLineage","source","eventIds"]); while (array.length <= 16) array.push(structuredClone(array[0])); }, options: {"prefixCount":16} },
      { name: "saveLineage.source.eventIds wrong element type", change: value => custodyCaseSet(value, ["saveLineage","source","eventIds",0], {}), options: {"prefixCount":16} },
      { name: "contextLineage.events below minimum", change: value => custodyCaseSet(value, ["contextLineage","events"], custodyCaseAt(value, ["contextLineage","events"]).slice(0, 2)), options: {"prefixCount":16} },
    ] },
    { name: "shape-04-array-bounds", cases: [
      { name: "contextLineage.events above maximum", change: value => { const array = custodyCaseAt(value, ["contextLineage","events"]); while (array.length <= 16) array.push(structuredClone(array[0])); }, options: {"prefixCount":16} },
      { name: "contextLineage.events wrong element type", change: value => custodyCaseSet(value, ["contextLineage","events",0], null), options: {"prefixCount":16} },
      { name: "resultCopies below minimum", change: value => custodyCaseSet(value, ["resultCopies"], custodyCaseAt(value, ["resultCopies"]).slice(0, 1)), options: {"prefixCount":16} },
      { name: "resultCopies above maximum", change: value => { const array = custodyCaseAt(value, ["resultCopies"]); while (array.length <= 2) array.push(structuredClone(array[0])); }, options: {"prefixCount":16} },
      { name: "resultCopies wrong element type", change: value => custodyCaseSet(value, ["resultCopies",0], null), options: {"prefixCount":16} },
      { name: "stageCopies below minimum", change: value => custodyCaseSet(value, ["stageCopies"], custodyCaseAt(value, ["stageCopies"]).slice(0, 2)), options: {"prefixCount":16} },
      { name: "stageCopies above maximum", change: value => { const array = custodyCaseAt(value, ["stageCopies"]); while (array.length <= 3) array.push(structuredClone(array[0])); }, options: {"prefixCount":16} },
      { name: "stageCopies wrong element type", change: value => custodyCaseSet(value, ["stageCopies",0], 7), options: {"prefixCount":16} },
    ] },
    { name: "shape-05-array-bounds-to-event-shapes", cases: [
      { name: "stageLineage.copies below minimum", change: value => custodyCaseSet(value, ["stageLineage","copies"], custodyCaseAt(value, ["stageLineage","copies"]).slice(0, 2)), options: {"prefixCount":16} },
      { name: "stageLineage.copies above maximum", change: value => { const array = custodyCaseAt(value, ["stageLineage","copies"]); while (array.length <= 3) array.push(structuredClone(array[0])); }, options: {"prefixCount":16} },
      { name: "stageLineage.copies wrong element type", change: value => custodyCaseSet(value, ["stageLineage","copies",0], "wrong-element"), options: {"prefixCount":16} },
      { name: "prefix event 0 wrong type constant", change: value => custodyCaseSet(value, ["contextLineage","events",0,"type"], "UnknownPrefixEvent"), options: {"prefixCount":16} },
      { name: "prefix event 1 wrong type constant", change: value => custodyCaseSet(value, ["contextLineage","events",1,"type"], "UnknownPrefixEvent"), options: {"prefixCount":16} },
      { name: "prefix event 2 wrong type constant", change: value => custodyCaseSet(value, ["contextLineage","events",2,"type"], "UnknownPrefixEvent"), options: {"prefixCount":16} },
      { name: "prefix event 3 wrong type constant", change: value => custodyCaseSet(value, ["contextLineage","events",3,"type"], "UnknownPrefixEvent"), options: {"prefixCount":16} },
      { name: "prefix event 15 wrong type constant", change: value => custodyCaseSet(value, ["contextLineage","events",15,"type"], "UnknownPrefixEvent"), options: {"prefixCount":16} },
    ] },
    { name: "shape-06-event-shapes-to-public-document", cases: [
      { name: "prefix first missing key", change: value => custodyCaseDrop(value, ["contextLineage","events",0,"key"]), options: {"prefixCount":16} },
      { name: "prefix last nontext key", change: value => custodyCaseSet(value, ["contextLineage","events",15,"key"], 7), options: {"prefixCount":16} },
      { name: "ProjectCreated event Document must be null", change: value => custodyCaseSet(value, ["contextLineage","events",0,"document"], "unrelated-document"), options: {"prefixCount":16} },
      { name: "DocumentCreated event Document missing", change: value => custodyCaseDrop(value, ["contextLineage","events",1,"document"]), options: {"prefixCount":16} },
      { name: "final BlockCreated event Document null", change: value => custodyCaseSet(value, ["contextLineage","events",15,"document"], null), options: {"prefixCount":16} },
      { name: "ProjectCreated public Document nonnull text", change: value => custodyCasePublic(value, ["contextLineage","events",0,"public"], payload => { payload["document_id"] = "unrelated-document"; }), options: {"prefixCount":16} },
      { name: "ProjectCreated public Document number", change: value => custodyCasePublic(value, ["contextLineage","events",0,"public"], payload => { payload["document_id"] = 7; }), options: {"prefixCount":16} },
      { name: "ProjectCreated public Document object", change: value => custodyCasePublic(value, ["contextLineage","events",0,"public"], payload => { payload["document_id"] = {}; }), options: {"prefixCount":16} },
    ] },
    { name: "shape-07-public-document-to-typed-keys", cases: [
      { name: "ProjectCreated duplicate null Document", change: value => custodyCaseSet(value, ["contextLineage","events",0,"public"], custodyCaseDuplicateRawKey(custodyCaseAt(value, ["contextLineage","events",0,"public"]), "document_id", null, "last")), options: {"prefixCount":16,"projectDocument":"null"} },
      { name: "prefix 1 public Document missing", change: value => custodyCasePublic(value, ["contextLineage","events",1,"public"], payload => { delete payload["document_id"]; }), options: {"prefixCount":16} },
      { name: "prefix 1 public Document null", change: value => custodyCasePublic(value, ["contextLineage","events",1,"public"], payload => { payload["document_id"] = null; }), options: {"prefixCount":16} },
      { name: "prefix 15 public Document missing", change: value => custodyCasePublic(value, ["contextLineage","events",15,"public"], payload => { delete payload["document_id"]; }), options: {"prefixCount":16} },
      { name: "prefix 15 public Document null", change: value => custodyCasePublic(value, ["contextLineage","events",15,"public"], payload => { payload["document_id"] = null; }), options: {"prefixCount":16} },
      { name: "prefix 0 client key missing", change: value => custodyCasePublic(value, ["contextLineage","events",0,"public"], payload => { delete payload["client_event_id"]; }), options: {"prefixCount":16} },
      { name: "prefix 0 client key nontext", change: value => custodyCasePublic(value, ["contextLineage","events",0,"public"], payload => { payload["client_event_id"] = 7; }), options: {"prefixCount":16} },
      { name: "prefix 15 client key missing", change: value => custodyCasePublic(value, ["contextLineage","events",15,"public"], payload => { delete payload["client_event_id"]; }), options: {"prefixCount":16} },
    ] },
    { name: "shape-08-typed-keys-to-public-decoder", cases: [
      { name: "prefix 15 client key nontext", change: value => custodyCasePublic(value, ["contextLineage","events",15,"public"], payload => { payload["client_event_id"] = 7; }), options: {"prefixCount":16} },
      { name: "command key nontext saveLineage.source.command", change: value => custodyCaseSet(value, ["saveLineage","source","command","command_key"], null), options: {"prefixCount":16} },
      { name: "command key nontext stageLineage.source.confirmationCommand", change: value => custodyCaseSet(value, ["stageLineage","source","confirmationCommand","command_key"], null), options: {"prefixCount":16} },
      { name: "command key nontext stageLineage.source.quoteCommand", change: value => custodyCaseSet(value, ["stageLineage","source","quoteCommand","command_key"], null), options: {"prefixCount":16} },
      { name: "canonical SAVE command key nontext", change: value => custodyCaseSet(value, ["saveLineage","target","commandKey"], null), options: {"prefixCount":16} },
      { name: "scoped stage preflight ID nontext", change: value => custodyCaseSet(value, ["stageLineage","source","quote","preflightId"], null), options: {"prefixCount":16} },
      { name: "first prefix malformed JSON", change: value => custodyCaseSet(value, ["contextLineage","events",0,"public"], '{'), options: {"prefixCount":16} },
      { name: "last prefix malformed JSON", change: value => custodyCaseSet(value, ["contextLineage","events",15,"public"], '{'), options: {"prefixCount":16} },
    ] },
    { name: "shape-09-public-decoder-to-duplicates", cases: [
      { name: "source SAVE malformed JSON", change: value => custodyCaseSet(value, ["saveLineage","source","save","public"], '{'), options: {"prefixCount":16} },
      { name: "target SAVE JSON scalar", change: value => custodyCaseSet(value, ["saveLineage","target","public"], 'null'), options: {"prefixCount":16} },
      { name: "confirmation JSON scalar", change: value => custodyCaseSet(value, ["stageLineage","source","confirmation","public"], '7'), options: {"prefixCount":16} },
      { name: "quote JSON array", change: value => custodyCaseSet(value, ["stageLineage","source","quote","public"], '[]'), options: {"prefixCount":16} },
      { name: "last prefix public byte overflow", change: value => custodyCasePublic(value, ["contextLineage","events",15,"public"], payload => { payload["_private_ref"] = 'x'.repeat(8193); }), options: {"prefixCount":16} },
      { name: "target SAVE public byte overflow", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["_private_ref"] = 'x'.repeat(8193); }), options: {"prefixCount":16} },
      { name: "prefix private reference duplicate alias first", change: value => custodyCaseSet(value, ["contextLineage","events",0,"public"], custodyCaseDuplicateRawKey(custodyCaseAt(value, ["contextLineage","events",0,"public"]), "_private_ref", targets.sourceEventIds[0], "first")), options: {"prefixCount":16} },
      { name: "prefix private reference duplicate alias last", change: value => custodyCaseSet(value, ["contextLineage","events",0,"public"], custodyCaseDuplicateRawKey(custodyCaseAt(value, ["contextLineage","events",0,"public"]), "_private_ref", targets.sourceEventIds[0], "last")), options: {"prefixCount":16} },
    ] },
    { name: "shape-10-duplicates", cases: [
      { name: "SAVE block duplicate alias first", change: value => custodyCaseSet(value, ["saveLineage","source","save","public"], custodyCaseDuplicateRawKey(custodyCaseAt(value, ["saveLineage","source","save","public"]), "block_id", targets.blockIds[0], "first")), options: {"prefixCount":16} },
      { name: "SAVE block duplicate alias last", change: value => custodyCaseSet(value, ["saveLineage","source","save","public"], custodyCaseDuplicateRawKey(custodyCaseAt(value, ["saveLineage","source","save","public"]), "block_id", targets.blockIds[0], "last")), options: {"prefixCount":16} },
      { name: "quote Project duplicate alias first", change: value => custodyCaseSet(value, ["stageLineage","source","quote","public"], custodyCaseDuplicateRawKey(custodyCaseAt(value, ["stageLineage","source","quote","public"]), "project_id", targets.projectId, "first")), options: {"prefixCount":16} },
      { name: "quote Project duplicate alias last", change: value => custodyCaseSet(value, ["stageLineage","source","quote","public"], custodyCaseDuplicateRawKey(custodyCaseAt(value, ["stageLineage","source","quote","public"]), "project_id", targets.projectId, "last")), options: {"prefixCount":16} },
      { name: "duplicate selected text leaf", textChange: serialized => custodyCaseDuplicateOuterKey(serialized, ["contextLineage"], "sessionId"), options: {"prefixCount":16} },
      { name: "duplicate context ancestor", textChange: serialized => custodyCaseDuplicateOuterKey(serialized, [], "contextLineage"), options: {"prefixCount":16} },
      { name: "duplicate SAVE source ancestor", textChange: serialized => custodyCaseDuplicateOuterKey(serialized, ["saveLineage"], "source"), options: {"prefixCount":16} },
      { name: "duplicate stage copies ancestor", textChange: serialized => custodyCaseDuplicateOuterKey(serialized, ["stageLineage"], "copies"), options: {"prefixCount":16} },
    ] },
    { name: "shape-11-save-exact-keys", cases: [
      { name: "source SAVE missing selected key", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { delete payload["_private_ref"]; }), options: {"prefixCount":16} },
      { name: "source SAVE extra key", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { payload["extra"] = "unrelated"; }), options: {"prefixCount":16} },
      { name: "source SAVE duplicate selected key", change: value => { const raw = custodyCaseAt(value, ["saveLineage","source","save","public"]); const payload = JSON.parse(raw); custodyCaseSet(value, ["saveLineage","source","save","public"], custodyCaseDuplicateRawKey(raw, "_private_ref", payload._private_ref, "last")); }, options: {"prefixCount":16} },
      { name: "source SAVE selected key nontext", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { payload["project_id"] = 7; }), options: {"prefixCount":16} },
      { name: "source SAVE wrong type constant", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { payload["type"] = "intent"; }), options: {"prefixCount":16} },
      { name: "source SAVE wrong scope constant", change: value => custodyCasePublic(value, ["saveLineage","source","save","public"], payload => { payload["scope"] = "project"; }), options: {"prefixCount":16} },
      { name: "target SAVE missing selected key", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { delete payload["_private_ref"]; }), options: {"prefixCount":16} },
      { name: "target SAVE extra key", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["extra"] = "unrelated"; }), options: {"prefixCount":16} },
    ] },
    { name: "shape-12-save-exact-keys-to-stage-exact-keys", cases: [
      { name: "target SAVE duplicate selected key", change: value => { const raw = custodyCaseAt(value, ["saveLineage","target","public"]); const payload = JSON.parse(raw); custodyCaseSet(value, ["saveLineage","target","public"], custodyCaseDuplicateRawKey(raw, "_private_ref", payload._private_ref, "last")); }, options: {"prefixCount":16} },
      { name: "target SAVE selected key nontext", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["project_id"] = 7; }), options: {"prefixCount":16} },
      { name: "target SAVE wrong type constant", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["type"] = "intent"; }), options: {"prefixCount":16} },
      { name: "target SAVE wrong scope constant", change: value => custodyCasePublic(value, ["saveLineage","target","public"], payload => { payload["scope"] = "project"; }), options: {"prefixCount":16} },
      { name: "confirmation missing selected key", change: value => custodyCasePublic(value, ["stageLineage","source","confirmation","public"], payload => { delete payload["project_id"]; }), options: {"prefixCount":16} },
      { name: "confirmation extra key", change: value => custodyCasePublic(value, ["stageLineage","source","confirmation","public"], payload => { payload["extra"] = "unrelated"; }), options: {"prefixCount":16} },
      { name: "confirmation duplicate selected key", change: value => { const raw = custodyCaseAt(value, ["stageLineage","source","confirmation","public"]); const payload = JSON.parse(raw); custodyCaseSet(value, ["stageLineage","source","confirmation","public"], custodyCaseDuplicateRawKey(raw, "project_id", payload.project_id, "last")); }, options: {"prefixCount":16} },
      { name: "confirmation selected key nontext", change: value => custodyCasePublic(value, ["stageLineage","source","confirmation","public"], payload => { payload["project_id"] = null; }), options: {"prefixCount":16} },
    ] },
    { name: "shape-13-stage-exact-keys", cases: [
      { name: "quote missing selected key", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { delete payload["project_id"]; }), options: {"prefixCount":16} },
      { name: "quote extra key", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { payload["extra"] = "unrelated"; }), options: {"prefixCount":16} },
      { name: "quote duplicate selected key", change: value => { const raw = custodyCaseAt(value, ["stageLineage","source","quote","public"]); const payload = JSON.parse(raw); custodyCaseSet(value, ["stageLineage","source","quote","public"], custodyCaseDuplicateRawKey(raw, "project_id", payload.project_id, "last")); }, options: {"prefixCount":16} },
      { name: "quote selected key nontext", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { payload["project_id"] = null; }), options: {"prefixCount":16} },
      { name: "quote scoped preflight key missing", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { delete payload["preflight_id"]; }), options: {"prefixCount":16} },
      { name: "quote scoped preflight key nontext", change: value => custodyCasePublic(value, ["stageLineage","source","quote","public"], payload => { payload["preflight_id"] = 7; }), options: {"prefixCount":16} },
    ] },
  ];
}

// Static source inventory: 101 identity cases + 102 shape/public cases = 203 total; 26 groups; maximum 8 cases/group.
// Shared required-node/public decoder shape checks are representative; fixed identity paths, array bounds, envelope keys and prefix boundaries are enumerated above.


// Finite groups have independent genuine reservations, original persisted
// lease lifetimes and 120-second test bounds. These are native SQL observations,
// never renewed process-local capabilities. No complete proof is filtered.
const custodyMatrixGroups = custodyProjectionGroups(null);
assert.equal(custodyMatrixGroups.length, 26);
assert.equal(custodyMatrixGroups.flatMap(group => group.cases).length, 203);
assert.ok(custodyMatrixGroups.every(group => group.cases.length > 0 && group.cases.length <= 8));
for (const registered of custodyMatrixGroups) test(`actual local D1 custody projection ${registered.name}`, { timeout: 120000 }, async t => {
  const { f, io, capture } = await beginCustodyMatrix(t);
  try {
    const targets = await custodyProjectionTargets(f), group = custodyProjectionGroups(targets).find(value => value.name === registered.name);
    assert.deepEqual(group.cases.map(value => value.name), registered.cases.map(value => value.name));
    const nativeJson = await nativeJsonProjectionProbe(f);
    // Strict complete foreign positive first, including the prefix used by
    // hostile cases; each group independently establishes noninterference.
    const accepted = await acceptUnrelatedCustody(f, capture, { prefixCount: 16 });
    const baseline = accepted.after, cases = [];
    const { canonicalJson } = await import('../src/experiences/compiler.ts');
    for (const spec of group.cases) {
      const foreign = await buildUnrelatedCustody(f, spec.options);
      assert.equal(Number(typeof spec.change === 'function') + Number(typeof spec.textChange === 'function'), 1);
      let lineageJson;
      if (spec.textChange) lineageJson = spec.textChange(foreign.projected.custody.lineage_json);
      else { const lineage = structuredClone(foreign.lineage); spec.change(lineage); lineageJson = canonicalJson(lineage); }
      assert.notEqual(lineageJson, foreign.projected.custody.lineage_json, `${spec.name}: actual mutation`);
      const nodeProbe = await custodyMatrixStatement(f, 'SELECT COUNT(*) AS nodes FROM json_tree(?)', [lineageJson]).first();
      assert.ok(nodeProbe.nodes > 0);
      const seed = await custodyMatrixSeed(f, foreign, { lineageJson });
      // A persisted lease expiry must never masquerade as an alias refusal.
      // Successful complete proof replay brackets every failing transaction.
      const beforeProof = await f.raw.batch(capture.statements());
      assertCustodyProofResults(beforeProof, 0, capture.proofs.length);
      let nativeError;
      await assert.rejects(f.raw.batch([...seed.prefix, ...capture.statements()]), error => {
        nativeError = String(error); assert.match(nativeError, /malformed JSON/iu); return true;
      });
      const afterProof = await f.raw.batch(capture.statements());
      assertCustodyProofResults(afterProof, 0, capture.proofs.length);
      assert.deepEqual(await databaseSnapshot(f), baseline, `${spec.name}: complete synthetic setup rolled back`);
      const evidence = { name: spec.name, options: spec.options, lineageBytes: Buffer.byteLength(lineageJson),
        lineageNodes: nodeProbe.nodes, lineageSha256: sha(lineageJson), setupStatements: seed.prefix.length,
        proofStatements: capture.proofs.length, nativeError, unchangedProofPassedBeforeAndAfter: true, fullRollback: true };
      cases.push(evidence); phase('custody-projection-case-qualified', { group: group.name, ...evidence });
    }
    assert.equal(cases.length, registered.cases.length);
    assertCustodyMatrixIo(f, io);
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, `custody-projection:${group.name}`), nativeJson,
      unrelatedStrictPositiveCount: 1, cases, proofSqlSha256: capture.proofs.map(row => row.sqlSha256),
      unchangedStatementReplay: true, groupQualified: true, fullCustodyLineageMatrixQualified: false,
      qualificationScope: 'this named group only; aggregate all 26 groups separately',
      syntheticReadyJournalOnly: true, physicalCopyEvidence: false, finalClaimOperationEvidence: false }));
  } finally { io.close(); }
});

// Keep raw escaped key spelling through hashing and binding. The parsed value
// is used only to locate one unambiguous fixed subtree, never to reserialize the
// completed hostile document. No callback or selector reaches application SQL.
function escapedObjectKey(serialized, path, key, escapedKey, replacement, position) {
  const object = custodyCaseAt(JSON.parse(serialized), path);
  assert.ok(Object.hasOwn(object, key));
  assert.equal(JSON.parse(`"${escapedKey}"`), key);
  assert.notEqual(escapedKey, key);
  assert.ok(['first', 'last', 'only'].includes(position));
  const before = JSON.stringify(object), entry = `"${escapedKey}":${JSON.stringify(replacement)}`;
  const after = position === 'first' ? `{${entry},${before.slice(1)}`
    : position === 'last' ? `${before.slice(0, -1)},${entry}}`
      : before.replace(`${JSON.stringify(key)}:${JSON.stringify(object[key])}`, entry);
  const index = serialized.indexOf(before);
  assert.ok(index >= 0); assert.equal(serialized.indexOf(before, index + before.length), -1);
  return serialized.slice(0, index) + after + serialized.slice(index + before.length);
}

async function decodedObjectKeyProbe(f) {
  const raw = '{"contentId":"foreign","content\\u0049d":"owned"}';
  const nodes = (await custodyMatrixStatement(f, 'SELECT parent,key,fullkey,type,atom FROM json_tree(?) WHERE type=\'text\' ORDER BY id', [raw]).all()).results;
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes.map(node => node.key), ['contentId', 'contentId']);
  assert.equal(nodes[0].parent, nodes[1].parent);
  assert.notEqual(nodes[0].fullkey, nodes[1].fullkey);
  phase('native-decoded-object-key-probe', { raw, nodes });
  return nodes;
}

for (const kind of ['attempt', 'custody']) test(`actual local D1 escaped object-label ${kind} proof refuses duplicate aliases`, { timeout: 120000 }, async t => {
  const { f, io, capture } = await beginCustodyMatrix(t);
  try {
    const decodedKeyProbe = await decodedObjectKeyProbe(f);
    const own = (await nativeRows(f, attemptTable)).find(row => row.session_id === f.session.sessionId);
    assert.ok(own);
    if (kind === 'attempt') {
      const positive = await foreignAttempt(f, own);
      const result = await f.raw.batch([testInsert(f, 'experience_guest_sessions', positive.session),
        testInsert(f, leaseTable, positive.lease), testInsert(f, attemptTable, positive.row), ...capture.statements()]);
      assertCustodyProofResults(result, 3, capture.proofs.length);
    } else await acceptUnrelatedCustody(f, capture, { prefixCount: 5 });
    const baseline = await databaseSnapshot(f), cases = [];
    const specs = [
      ['selected leaf escaped first', 'leaf', 'first'], ['selected leaf escaped last', 'leaf', 'last'],
      ['selected ancestor escaped first', 'ancestor', 'first'], ['selected ancestor escaped last', 'ancestor', 'last'],
      ['sole escaped required leaf', 'leaf', 'only'],
      ...(kind === 'custody' ? [['public decoder escaped first', 'public', 'first'], ['public decoder escaped last', 'public', 'last']] : []),
    ];
    for (const [name, mutation, position] of specs) {
      let hostileJson, setup;
      const ownedBody = f.inventoryData.manifest.privateContents[0].contentId;
      if (kind === 'attempt') {
        const foreign = await foreignAttempt(f, own), raw = foreign.row.descriptor_json;
        const path = ['manifest', 'privateContents', 0];
        if (mutation === 'leaf') hostileJson = escapedObjectKey(raw, path, 'contentId', 'content\\u0049d', ownedBody, position);
        else {
          const bodies = structuredClone(foreign.descriptor.manifest.privateContents); bodies[0].contentId = ownedBody;
          hostileJson = escapedObjectKey(raw, ['manifest'], 'privateContents', 'private\\u0043ontents', bodies, position);
        }
        const row = { ...foreign.row, descriptor_json: hostileJson, descriptor_digest: custodyMatrixHash(hostileJson) };
        setup = [testInsert(f, 'experience_guest_sessions', foreign.session), testInsert(f, leaseTable, foreign.lease), testInsert(f, attemptTable, row)];
      } else {
        const foreign = await buildUnrelatedCustody(f, { prefixCount: 5 });
        const raw = foreign.projected.custody.lineage_json;
        if (mutation === 'leaf') hostileJson = escapedObjectKey(raw, ['stageLineage','copies',0], 'contentId', 'content\\u0049d', ownedBody, position);
        else if (mutation === 'ancestor') {
          const copies = structuredClone(foreign.lineage.stageLineage.copies); copies[0].contentId = ownedBody;
          hostileJson = escapedObjectKey(raw, ['stageLineage'], 'copies', 'copi\\u0065s', copies, position);
        } else {
          const path = ['contextLineage','events',0,'public'], lineage = structuredClone(foreign.lineage);
          const publicJson = custodyCaseAt(lineage, path);
          custodyCaseSet(lineage, path, escapedObjectKey(publicJson, [], '_private_ref', '_private\\u005fref', f.inventoryData.manifest.sourceEventIds[0], position));
          hostileJson = (await import('../src/experiences/compiler.ts')).canonicalJson(lineage);
        }
        setup = (await custodyMatrixSeed(f, foreign, { lineageJson: hostileJson })).prefix;
      }
      assertCustodyProofResults(await f.raw.batch(capture.statements()), 0, capture.proofs.length);
      let nativeError = null, accepted = null;
      try { accepted = await f.raw.batch([...setup, ...capture.statements()]); }
      catch (error) { nativeError = String(error); }
      phase('escaped-object-key-observation', { kind, name, mutation, position, rawBytes: Buffer.byteLength(hostileJson), rawSha256: sha(hostileJson),
        expectedRefusal: true, nativeError, unexpectedFullProofSuccess: accepted !== null && accepted.every(row => row.success === true) });
      assert.match(nativeError ?? '', /malformed JSON/iu, `${kind} ${name}: complete source proof must refuse`);
      assertCustodyProofResults(await f.raw.batch(capture.statements()), 0, capture.proofs.length);
      assert.deepEqual(await databaseSnapshot(f), baseline, `${kind} ${name}: full synthetic setup rollback`);
      cases.push({ name, mutation, position, unchangedProofPassedBeforeAndAfter: true, fullRollback: true, nativeError });
    }
    assertCustodyMatrixIo(f, io);
    t.diagnostic(JSON.stringify({ ...measuredProofs(f, `escaped-object-keys:${kind}`), decodedKeyProbe, cases,
      unrelatedStrictPositiveCount: 1, unchangedStatementReplay: true, syntheticReadyJournalOnly: kind === 'custody',
      physicalCopyEvidence: false, finalClaimOperationEvidence: false }));
  } finally { io.close(); }
});
