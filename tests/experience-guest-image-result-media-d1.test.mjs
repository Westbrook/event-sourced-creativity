import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { validPng } from './helpers/guest-image-run-fixture.mjs';
import { exportSynthetic, install, rowsSnapshot } from './helpers/model3d-workerd-snapshot.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const phase = (name, detail = {}) => process.stderr.write(`[guest-result-media-d1] ${JSON.stringify({ phase: name,
  pid: process.pid, ppid: process.ppid, runnerPgid: process.env.FORMA_TEST_PGID ?? null, ...detail })}\n`);
const sourcePaths = [
  'worker/experience-guest-image-result-media-operation.ts', 'worker/experience-guest-image-result-media.ts',
  'worker/experience-guest-image-result-inventory.ts', 'worker/experience-guest-image-result-facts.ts',
  'worker/experience-guest-image-result-contract.ts', 'worker/experience-guest-image-history.ts',
  'worker/experience-guest-image-stage-facts.ts', 'worker/experience-guest-sponsor-contract.ts',
  'worker/experience-sponsor-image-format.ts', 'worker/experience-guest-image-admission-witness.ts',
  'worker/experience-guest-image-execution.ts', 'worker/experience-guest-image-driver.ts',
  'src/model/output-asset-inspection.ts', 'src/model/media-ownership.ts',
  'tests/experience-guest-image-result-media.test.mjs', 'tests/experience-guest-image-result-media-d1.test.mjs',
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
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`guest_media_fixture_timeout:${label}`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
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
      controls = expected; state.phase = 'runtime'; return { expectedBlockedControls: [...expected], denials: structuredClone(events) };
    },
    assertContained() {
      assert.equal(controls?.length, 7); assert.equal(events.length, 7);
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

// This control intentionally runs the real object/stream operations inside
// workerd. It neither serializes a host object into a fake response nor imports
// the application byte reader. Returned JSON is only bounded synthetic evidence.
const r2ShapeWorker = String.raw`
const requireFact = (value, message) => { if (!value) throw new Error(message); };
async function finite(pending, label) {
  let timer;
  try { return await Promise.race([pending, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('shape_timeout:' + label)), 5000);
  })]); } finally { clearTimeout(timer); }
}
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typed, 'byteLength').get;
const bufferOf = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const getReader = ReadableStream.prototype.getReader;
const readChunk = ReadableStreamDefaultReader.prototype.read;
const cancelReader = ReadableStreamDefaultReader.prototype.cancel;
const releaseReader = ReadableStreamDefaultReader.prototype.releaseLock;
const cancelBody = ReadableStream.prototype.cancel;
const setBytes = Uint8Array.prototype.set;
function descriptors(object) {
  return Object.fromEntries(['key', 'size', 'httpEtag', 'customMetadata', 'writeHttpMetadata', 'body', 'etag', 'version'].map(key => {
    let cursor = object;
    for (let depth = 0; cursor !== null && depth < 8; depth++, cursor = Object.getPrototypeOf(cursor)) {
      const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
      if (descriptor) return [key, { depth, kind: Object.hasOwn(descriptor, 'value') ? 'data' : 'accessor',
        enumerable: descriptor.enumerable, configurable: descriptor.configurable,
        ...(Object.hasOwn(descriptor, 'value') ? { valueType: typeof descriptor.value }
          : { hasGetter: typeof descriptor.get === 'function', hasSetter: typeof descriptor.set === 'function' }) }];
    }
    return [key, null];
  }));
}
function capture(object, expectedKey) {
  requireFact(object && typeof object === 'object', 'object required');
  const key = object.key, size = object.size, httpEtag = object.httpEtag;
  requireFact(key === expectedKey, 'same exact key');
  requireFact(Number.isSafeInteger(size) && size > 0 && size <= 24000000, 'bounded integral size');
  requireFact(typeof httpEtag === 'string' && httpEtag.length > 0 && httpEtag.length <= 256, 'bounded HTTP ETag');
  const source = object.customMetadata;
  requireFact(source && typeof source === 'object' && !Array.isArray(source), 'metadata object');
  const prototype = Object.getPrototypeOf(source);
  requireFact(prototype === Object.prototype || prototype === null, 'plain native custom metadata map');
  const keys = Reflect.ownKeys(source); requireFact(keys.length > 0 && keys.length <= 64, 'metadata count');
  requireFact(keys.every(key => typeof key === 'string'), 'only string native metadata own keys'); keys.sort();
  const metadataShape = { prototype: prototype === null ? 'null' : 'Object.prototype', ownKeyCount: keys.length, descriptors: [] };
  const metadata = Object.create(null); let metadataBytes = 0;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    requireFact(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'own enumerable native metadata data property');
    const value = descriptor.value; requireFact(typeof value === 'string', 'metadata string');
    metadataShape.descriptors.push({ key, kind: 'data', enumerable: descriptor.enumerable, valueType: typeof value });
    metadataBytes += new TextEncoder().encode(key).length + new TextEncoder().encode(value).length;
    requireFact(key.length <= 256 && value.length <= 2048 && metadataBytes <= 8192, 'metadata bounds');
    metadata[key] = value;
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers); // Preserve the genuine native method receiver.
  requireFact(headers.get('content-type') === 'image/png', 'exact PNG HTTP MIME');
  const optional = {};
  for (const field of ['etag', 'version']) {
    const value = object[field];
    if (value !== undefined) {
      requireFact(typeof value === 'string' && value.length > 0 && value.length <= 256, 'optional scalar identity');
      optional[field] = value;
    }
  }
  return { key, size, httpEtag, metadata, contentType: headers.get('content-type'), optional,
    descriptors: descriptors(object), metadataShape };
}
export default { async fetch(request, env) {
  const calls = [], violations = [], cleanup = [];
  const bodyShape = { readBodyIsReadableStream: false, cancelBodyIsReadableStream: false,
    intrinsicGetReaderCalls: 0, intrinsicReadCalls: 0, intrinsicCancelCalls: 0, intrinsicReleaseCalls: 0 };
  const chunkShape = { count: 0, exactPrototypeCount: 0, arrayBufferCount: 0, positiveLengthCount: 0,
    intrinsicByteLengthTotal: 0, terminalValueUndefined: false };
  let reader, body, complete = false, pendingGet, active = true;
  const stop = () => {
    try {
      const pending = reader ? cancelReader.call(reader) : body ? cancelBody.call(body) : null;
      if (pending) void pending.catch(error => cleanup.push('cancel-rejected:' + String(error)));
    } catch (error) { cleanup.push('cancel-threw:' + String(error)); }
    try { if (reader) releaseReader.call(reader); } catch (error) { cleanup.push('release-threw:' + String(error)); }
  };
  try {
    requireFact(request.method === 'POST', 'POST only');
    const input = await request.json();
    requireFact(typeof input.key === 'string' && input.key.length <= 256, 'bounded key');
    const bucket = env.MEDIA;
    const media = new Proxy(bucket, { get(target, method) {
      if (method !== 'get' && method !== 'head') {
        violations.push(String(method)); throw new Error('shape forbidden R2 operation:' + String(method));
      }
      return key => {
        requireFact(key === input.key, 'exact original key only'); calls.push({ method, key });
        return target[method](key); // Real R2 binding and real method receiver.
      };
    } });
    const getExact = () => {
      pendingGet = media.get(input.key);
      void pendingGet.then(object => { if (!active) { body = object?.body; stop(); } }, () => {})
        .catch(error => cleanup.push('late-object-cleanup-failed:' + String(error)));
      return pendingGet;
    };
    const object = await finite(getExact(), 'get'); body = object?.body;
    const get = capture(object, input.key);
    bodyShape.readBodyIsReadableStream = body instanceof ReadableStream;
    requireFact(bodyShape.readBodyIsReadableStream, 'native body ReadableStream brand');
    reader = getReader.call(body); bodyShape.intrinsicGetReaderCalls++;
    const bytes = new Uint8Array(get.size); let offset = 0, reads = 0;
    try {
      while (true) {
        requireFact(++reads <= 65536, 'finite stream reads');
        const next = await finite(readChunk.call(reader), 'read'); bodyShape.intrinsicReadCalls++;
        if (next.done) {
          chunkShape.terminalValueUndefined = next.value === undefined;
          requireFact(chunkShape.terminalValueUndefined, 'native terminal read has no value'); complete = true; break;
        }
        const chunk = next.value;
        requireFact(chunk instanceof Uint8Array && Object.getPrototypeOf(chunk) === Uint8Array.prototype, 'exact native Uint8Array chunk prototype');
        requireFact(bufferOf.call(chunk) instanceof ArrayBuffer, 'native intrinsic chunk ArrayBuffer');
        const length = byteLengthOf.call(chunk);
        requireFact(Number.isSafeInteger(length) && length > 0 && length <= bytes.length - offset, 'bounded positive intrinsic chunk byte length');
        chunkShape.count++; chunkShape.exactPrototypeCount++; chunkShape.arrayBufferCount++; chunkShape.positiveLengthCount++;
        chunkShape.intrinsicByteLengthTotal += length;
        setBytes.call(bytes, chunk, offset); offset += length;
      }
      requireFact(offset === get.size && offset === input.size, 'exact total bytes');
    } finally { if (!complete) stop(); else { releaseReader.call(reader); bodyShape.intrinsicReleaseCalls++; } reader = null; }
    const contentSha256 = await finite(hash(bytes), 'hash');
    requireFact(contentSha256 === input.sha256, 'independent PNG hash'); bytes.fill(0);
    const headObject = await finite(media.head(input.key), 'head');
    const head = capture(headObject, input.key);
    requireFact(headObject.body === undefined || headObject.body === null, 'HEAD is metadata only');
    for (const key of ['key', 'size', 'httpEtag', 'contentType']) requireFact(get[key] === head[key], 'GET/HEAD ' + key);
    requireFact(JSON.stringify(get.metadata) === JSON.stringify(head.metadata), 'complete metadata equality');
    requireFact(JSON.stringify(get.optional) === JSON.stringify(head.optional), 'captured object identity equality');
    requireFact(JSON.stringify(get.metadata) === JSON.stringify(Object.fromEntries(Object.entries(input.metadata).sort())), 'seed metadata equality');
    complete = false; body = null;
    const cancelObject = await finite(getExact(), 'cancel-get'); body = cancelObject?.body;
    bodyShape.cancelBodyIsReadableStream = body instanceof ReadableStream;
    requireFact(bodyShape.cancelBodyIsReadableStream, 'fresh native cancellation ReadableStream brand');
    reader = getReader.call(body); bodyShape.intrinsicGetReaderCalls++;
    try { await finite(cancelReader.call(reader, 'local-shape-control'), 'ordinary-cancel'); bodyShape.intrinsicCancelCalls++;
      complete = true; cleanup.push('ordinary-cancel-complete'); }
    finally { releaseReader.call(reader); bodyShape.intrinsicReleaseCalls++; reader = null; cleanup.push('ordinary-release-complete'); }
    requireFact(violations.length === 0, 'persistent forbidden R2 operations');
    return Response.json({ ok: true, get, head, contentSha256, byteLength: offset, reads, calls, violations, cleanup,
      bodyShape, chunkShape, runtime: 'native-workerd-r2-shape-only', applicationReaderExecuted: false });
  } catch (error) {
    return Response.json({ ok: false, error: String(error), calls, violations, cleanup }, { status: 500 });
  } finally { active = false; if (reader || !complete) stop(); }
} };
`;

test('native workerd R2 shape preserves real GET body and HEAD metadata receivers', { timeout: 45000 }, async t => {
  await bookends(t, 'native-r2-shape');
  const egress = [], runtime = await prepareMiniflare(t, 'native-r2-shape', egress), { Log, LogLevel } = runtime;
  const mf = runtime.create({ cf: false, modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: r2ShapeWorker, r2Buckets: ['MEDIA'], log: new Log(LogLevel.NONE),
    outboundService(request) { egress.push({ url: request.url, method: request.method }); throw new Error('external workerd fetch forbidden'); } });
  const bucket = await finite(mf.getR2Bucket('MEDIA'), 10000, 'shape:bucket');
  // Shape-only setup deliberately does not replay a producer. The known local
  // PNG has a separate Node hash oracle; no application inspector derives it.
  const bytes = validPng(2, 2), key = 'local-shape-control/generated/00000000-0000-4000-8000-000000000001.png';
  const sha256 = sha(bytes), metadata = {
    ownerId: 'local-shape-guest', artifactId: '00000000-0000-4000-8000-000000000001',
    generationId: '00000000-0000-4000-8000-000000000001', model: 'gpt-image-2', provider: 'openai',
    adapter: 'openai-image-generation', providerRequestId: 'local-shape-image-request', source: 'provider-image-api',
    mimeType: 'image/png', sha256, outputNativeStorage: '1', outputScopeKey: 'local-shape-scope',
    outputSlotId: 'local-shape-slot', outputOwnerId: 'local-shape-guest', outputDocumentId: 'local-shape-document',
    outputSha256: sha256, 'unknown-retained-field': 'bounded metadata must survive unchanged',
  };
  assert.equal(bytes.readUInt32BE(16), 2); assert.equal(bytes.readUInt32BE(20), 2);
  const seeded = await finite(bucket.put(key, bytes, { httpMetadata: { contentType: 'image/png' }, customMetadata: metadata }), 10000, 'shape:seed');
  assert.ok(seeded, 'local setup PUT acknowledgement');
  const response = await finite(mf.dispatchFetch('https://synthetic.forma.invalid/r2-shape', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, size: bytes.length, sha256, metadata }),
  }), 15000, 'shape:dispatch');
  const value = await finite(response.json(), 5000, 'shape:json');
  assert.equal(response.status, 200, JSON.stringify(value)); assert.equal(value.ok, true, JSON.stringify(value));
  assert.equal(value.runtime, 'native-workerd-r2-shape-only'); assert.equal(value.applicationReaderExecuted, false);
  assert.equal(value.contentSha256, sha256); assert.equal(value.byteLength, bytes.length);
  assert.deepEqual(value.calls, [{ method: 'get', key }, { method: 'head', key }, { method: 'get', key }]);
  assert.deepEqual(value.violations, []); assert.deepEqual(value.cleanup, ['ordinary-cancel-complete', 'ordinary-release-complete']);
  assert.deepEqual(value.get.metadata, metadata); assert.deepEqual(value.head.metadata, metadata);
  assert.ok(Number.isSafeInteger(value.reads) && value.reads >= 2 && value.reads <= 65536);
  assert.deepEqual(value.bodyShape, { readBodyIsReadableStream: true, cancelBodyIsReadableStream: true,
    intrinsicGetReaderCalls: 2, intrinsicReadCalls: value.reads, intrinsicCancelCalls: 1, intrinsicReleaseCalls: 2 });
  assert.deepEqual(value.chunkShape, { count: value.reads - 1, exactPrototypeCount: value.reads - 1,
    arrayBufferCount: value.reads - 1, positiveLengthCount: value.reads - 1,
    intrinsicByteLengthTotal: bytes.length, terminalValueUndefined: true });
  for (const which of ['get', 'head']) {
    assert.equal(value[which].key, key); assert.equal(value[which].size, bytes.length);
    assert.equal(value[which].contentType, 'image/png'); assert.equal(value[which].httpEtag, seeded.httpEtag);
    assert.ok(['Object.prototype', 'null'].includes(value[which].metadataShape.prototype));
    assert.equal(value[which].metadataShape.ownKeyCount, Object.keys(metadata).length);
    assert.deepEqual(value[which].metadataShape.descriptors, Object.keys(metadata).sort().map(key =>
      ({ key, kind: 'data', enumerable: true, valueType: 'string' })));
    for (const field of ['size', 'customMetadata', 'httpEtag', 'writeHttpMetadata']) {
      const descriptor = value[which].descriptors[field];
      assert.ok(descriptor && Number.isSafeInteger(descriptor.depth) && descriptor.depth >= 0 && descriptor.depth < 8);
      assert.ok(['data', 'accessor'].includes(descriptor.kind));
    }
  }
  assert.ok(value.get.descriptors.body, 'native GET body descriptor observed without replacing the host object');
  const after = await finite(bucket.head(key), 5000, 'shape:seed-unchanged');
  assert.ok(after); assert.equal(after.httpEtag, seeded.httpEtag); assert.equal(after.size, bytes.length);
  assert.deepEqual(after.customMetadata, metadata);
  if (seeded.version !== undefined) assert.equal(after.version, seeded.version);
  t.diagnostic(JSON.stringify({ label: 'single-native-workerd-r2-shape-control',
    evidence: 'inline workerd uses actual native R2 object/stream receivers; no application reader in workerd',
    localOnly: true, producerRerun: false, measuredCalls: value.calls.map(row => row.method),
    byteLength: bytes.length, sha256, getDescriptors: value.get.descriptors, headDescriptors: value.head.descriptors,
    getMetadataShape: value.get.metadataShape, headMetadataShape: value.head.metadataShape,
    bodyShape: value.bodyShape, chunkShape: value.chunkShape,
    ordinaryCancellationOnly: true, pendingGetCancellationQualified: false, deployedR2Qualified: false }));
});

const queryLimits = { functionArguments: 32, parameters: 100, sqlBytes: 100000 };
const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu;
function observedDatabase(raw, qualifier) {
  const handles = new WeakMap();
  const state = { records: [], batches: [], violations: [], afterBatch: null, tamperedProofs: [] };
  const forbidden = operation => {
    state.violations.push({ operation }); throw new Error(`guest-media-D1 forbidden ${operation}`);
  };
  const qualify = (row, method) => {
    try {
      assert.equal(typeof row.sql, 'string'); assert.match(row.sql, /^\s*SELECT\b/iu);
      assert.doesNotMatch(row.sql, mutation, 'byte inspection cannot hide a write inside a read');
      const compiled = qualifier.qualify(row.sql, row.bindings);
      assert.equal(compiled.ok, true); assert.equal(compiled.limit, 100);
      assert.deepEqual(compiled.queryLimits, queryLimits); assert.equal(compiled.compoundSelectLimit, 5);
      assert.equal(compiled.parameterCount, row.bindings.length); assert.equal(compiled.statementBytes, Buffer.byteLength(row.sql));
      state.records.push({ sql: row.sql, sqlSha256: sha(row.sql), parameters: row.bindings.length,
        sqlBytes: Buffer.byteLength(row.sql), method });
    } catch (error) {
      state.violations.push({ operation: method, sqlSha256: sha(String(row.sql)), error: String(error) }); throw error;
    }
  };
  const wrap = (statement, sql, bindings = []) => {
    const row = { statement, sql, bindings };
    const wrapped = {
      bind: (...values) => wrap(statement.bind(...values), sql, values),
      async first(...args) { qualify(row, 'first'); return statement.first(...args); },
      async all(...args) { qualify(row, 'all'); return statement.all(...args); },
      run: () => forbidden('statement.run'),
      raw: () => forbidden('statement.raw'),
    };
    handles.set(wrapped, row); return wrapped;
  };
  state.DB = {
    prepare: sql => wrap(raw.prepare(sql), sql),
    exec: () => forbidden('DB.exec'),
    dump: () => forbidden('DB.dump'),
    async batch(statements) {
      let rows;
      try {
        assert.ok(Array.isArray(statements) && statements.length > 0 && statements.length <= 256);
        rows = Array.from(statements, statement => { const row = handles.get(statement); assert.ok(row, 'same observed database owns every statement'); return row; });
        rows.forEach(row => qualify(row, 'batch'));
      } catch (error) { state.violations.push({ operation: 'batch', error: String(error) }); throw error; }
      state.batches.push(rows.map(row => row.sql));
      const results = await raw.batch(rows.map(row => row.statement));
      return state.afterBatch ? state.afterBatch(rows, results) : results;
    },
  };
  return state;
}
const databaseSnapshot = async f => ({
  schema: (await f.raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results,
  rows: await rowsSnapshot(f.raw, f.exported.tables),
});

async function actualD1Fixture(t, helper) {
  await bookends(t, 'actual-d1-byte-proof');
  const egress = [], runtime = await prepareMiniflare(t, 'actual-d1-byte-proof', egress), { Log, LogLevel } = runtime;
  const mf = runtime.create({ cf: false, modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default {fetch(){return new Response('Local guest byte-proof D1 fixture.',{status:404});}};",
    d1Databases: ['GuestResultMedia'], log: new Log(LogLevel.NONE),
    outboundService(request) { egress.push({ url: request.url, method: request.method }); throw new Error('external workerd fetch forbidden'); } });
  // Initialize the real local bridge before the genuine synthetic producer
  // installs its closed provider-wire mock. No real provider is called.
  const raw = await finite(mf.getD1Database('GuestResultMedia'), 10000, 'media:d1-binding');
  const compound = count => Array.from({ length: count }, () => 'SELECT 1').join(' UNION ALL ');
  assert.equal((await raw.prepare(compound(5)).all()).results.length, 5);
  await assert.rejects(raw.prepare(compound(6)).all(), /too many terms in compound SELECT/iu);
  const f = await helper.completedMediaFixture(t, { inventory: false });
  const exported = exportSynthetic(f.sqlite); await install(raw, exported);
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
    graphSetup: 'one genuine native producer; exact schema/scalars/rowids transferred' });
  return { ...f, raw, exported, observed, qualifier };
}

test('actual local D1 byte proof validates original bytes and rejects a NULL final native proof acknowledgement', { timeout: 120000 }, async t => {
  const helper = await import('./helpers/guest-image-result-media-fixture.mjs');
  const { readGuestImageResultMedia, guestImageResultMediaReview, consumeGuestImageResultMedia } =
    await import('../worker/experience-guest-image-result-media.ts');
  const f = await actualD1Fixture(t, helper), before = await databaseSnapshot(f);
  let guard, positiveObservation, refusedObservation, consumed = 0;
  const receipt = { successfulRead: false, successfulConsumption: false, finalAckRefused: false };
  try {
    // Each operation starts with a fresh authentic inventory on the actual D1
    // handle. A completed observation cannot mint another media read attempt.
    await helper.createMediaInventory(f, helper.request());
    assert.deepEqual(f.inventoryData.manifest.financialReceipt, {
      period: f.initialToken.period, tokenReservationId: f.initialToken.reservation_id,
      costReservationId: f.initialCost.reservation_id, usedTokens: 400, usedMicrousd: 4200,
    });
    assert.equal(f.inventoryData.manifest.object.contentSha256, f.mediaOracle.sha256);
    assert.equal(f.inventoryData.manifest.object.storageKey, f.mediaOracle.key);
    guard = helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
    positiveObservation = await readGuestImageResultMedia(f.request, f.env, f.inventory);
    assert.ok(positiveObservation && Object.isFrozen(positiveObservation));
    assert.deepEqual(Reflect.ownKeys(positiveObservation), [], 'observation is opaque');
    const review = guestImageResultMediaReview(f.request, f.env, positiveObservation);
    const expectedReview = { version: 1, kind: 'guest-image-result-media', mimeType: 'image/png',
      sha256: f.mediaOracle.sha256, byteLength: f.mediaOracle.size, width: 1024, height: 1024,
      freshBytesVerified: true, custodyTransferred: false, publicReadAvailable: false };
    assert.ok(Object.isFrozen(review)); assert.deepEqual(review, expectedReview);
    await consumeGuestImageResultMedia(f.request, f.env, positiveObservation, async (bytes, consumedReview) => {
      consumed++; assert.equal(consumed, 1); assert.ok(bytes instanceof Uint8Array);
      assert.equal(consumedReview, review); assert.deepEqual(consumedReview, expectedReview);
      assert.equal(bytes.length, f.mediaOracle.size); assert.equal(sha(bytes), f.mediaOracle.sha256);
      assert.deepEqual(bytes, f.mediaOracle.bytes); helper.knownPngOracle(bytes);
    });
    assert.equal(consumed, 1); assert.deepEqual(guard.state.calls, ['get', 'head']);
    assert.equal(guard.state.metadataMethodCalls, 2);
    guard.assertUntouched(); guard.close(); guard = null;
    receipt.successfulRead = true; receipt.successfulConsumption = true;
    assert.deepEqual(await databaseSnapshot(f), before, 'positive full proof and byte consumption leave actual D1 unchanged');

    await helper.createMediaInventory(f, helper.request());
    const proofSql = f.inventoryData.proof.map(part => `SELECT CASE WHEN (${part.sql}) THEN 1 ELSE 0 END AS current`);
    const proofBindings = f.inventoryData.proof.map(part => part.bindings);
    assert.ok(proofSql.length > 0 && proofSql.length <= 256);
    guard = helper.installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
    f.observed.afterBatch = (statements, results) => {
      if (!guard.state.calls.includes('head')) return results;
      assert.deepEqual(guard.state.calls, ['get', 'head'], 'target the full proof after the actual final HEAD');
      assert.deepEqual(statements.map(row => row.sql), proofSql, 'every source-exact captured proof executes against actual D1');
      assert.deepEqual(statements.map(row => row.bindings), proofBindings, 'every current binding is preserved');
      assert.equal(f.observed.tamperedProofs.length, 0, 'alter only one final acknowledgement in one operation');
      assert.equal(results.length, statements.length);
      for (const result of results) {
        assert.equal(result.success, true); assert.equal(result.error, undefined);
        assert.equal(result.results.length, 1); assert.equal(result.results[0].current, 1);
      }
      const index = results.length - 1, original = results[index];
      f.observed.tamperedProofs.push({ index, sqlSha256: sha(statements[index].sql), originalCurrent: 1, returnedCurrent: null,
        boundary: 'after-final-HEAD-and-actual-complete-D1-proof-batch' });
      return results.map((result, at) => at === index ? { ...original, results: [{ ...original.results[0], current: null }] } : result);
    };
    await assert.rejects(async () => { refusedObservation = await readGuestImageResultMedia(f.request, f.env, f.inventory); },
      /guest_image_result_inventory_proof_unavailable/u);
    assert.equal(refusedObservation, undefined); assert.equal(f.observed.tamperedProofs.length, 1);
    assert.equal(consumed, 1, 'rejected final proof exposes no additional bytes');
    assert.deepEqual(guard.state.calls, ['get', 'head']); guard.assertUntouched();
    receipt.finalAckRefused = true;
    assert.deepEqual(await databaseSnapshot(f), before, 'all actual schema/rows remain unchanged after the negative control');
    assert.deepEqual((await f.raw.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally {
    f.observed.afterBatch = null;
    try { guard?.close(); } finally {
      t.diagnostic(JSON.stringify({ label: 'actual-local-d1-byte-proof-boundary', ...receipt,
        applicationExecution: 'Node-hosted production byte/inventory APIs against actual local Miniflare/workerd D1',
        mediaExecution: 'synthetic receiver-branded bucket; separate test qualifies native workerd R2 object shape',
        setup: 'one genuine native Run with synthetic provider responses; exact retained schema/scalars/rowids transferred',
        costs: 'synthetic application-recorded 400 tokens and 4200 microusd; not provider invoices',
        actualCompoundSelectLimit: 5, expressionDepthLimit: 100, ...queryLimits,
        ...f.qualifier.metrics(), strictlyQualifiedStatements: f.observed.records.length,
        tamperedProofs: f.observed.tamperedProofs, acknowledgementControl: 'fixture substitutes NULL only after actual successful full D1 batch',
        localOnly: true, writesByInspection: false, publicActivation: false, deployedApplicationRuntimeQualified: false }));
    }
  }
});
