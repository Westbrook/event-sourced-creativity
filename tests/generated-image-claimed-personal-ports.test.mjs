import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test as nativeTest } from 'node:test';
import { png } from './output-asset-fixtures.mjs';

// Direct result supplier-port native successor. Source-only until its
// frozen test/closure is independently reviewed and explicitly qualified.
// Exact private harness reuse: accepted native11 test037fa45a, commit97ab4cbb;
// ancestor host guard/runtime from reader526d5b42. New roles have read-only
// operation-specific facets. No API route/client credit; derivative/body-role
// acceptance is a separately selected successor after the original three cases.
{
const [{ readFileSync }, { readFile, realpath }, { createRequire, syncBuiltinESMExports },
  { dirname, extname, relative, resolve, sep }, { fileURLToPath }, { copyWriterFixture }, { exportSynthetic }] = await Promise.all([
  import('node:fs'), import('node:fs/promises'), import('node:module'), import('node:path'), import('node:url'),
  import('./experience-guest-image-result-copy-writer.test.mjs'), import('./helpers/model3d-workerd-snapshot.mjs'),
]);
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const phase = (name, detail = {}) => process.stderr.write(`[guest-result-personal-ports-d1] ${JSON.stringify({
  phase: name, pid: process.pid, ppid: process.ppid, runnerPgid: process.env.FORMA_TEST_PGID ?? null, ...detail })}\n`);
async function finite(pending, milliseconds, label) {
  let timer;
  try { return await Promise.race([pending, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('copy_fixture_timeout:' + label)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

// Reversible guard derived from the accepted byte-reader D1 fixture. The host
// transport checks and borrowed-dispatcher ownership are unchanged. This direct
// Worker adaptation removes the synchronous proxy transform and refuses every
// Node Worker construction. It does not claim arbitrary child-process/OS isolation.
let activeHostGuard = false;
function installHostNetworkGuard(miniflareEntry) {
  assert.equal(activeHostGuard, false, 'a previous owned runtime must finish cleanup before another starts');
  activeHostGuard = true;
  const require = createRequire(import.meta.url), mfRequire = createRequire(miniflareEntry);
  const net = require('node:net'), tls = require('node:tls'), http = require('node:http'), https = require('node:https');
  const dns = require('node:dns'), dgram = require('node:dgram'), workerThreads = require('node:worker_threads');
  const patches = [], events = [], allowed = {}, state = { phase: 'setup', restored: false };
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
    // Native getnameinfo bypasses socket guards; neither form is needed here.
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

    // This fixture never requests a lazy binding proxy. Any new Node realm is
    // refused rather than running an unguarded worker or rewriting vendor code.
    patch(workerThreads, 'Worker', class RefusedFixtureWorker {
      constructor() { deny('worker_threads.Worker', 'direct dispatch fixture must not create a Node Worker'); }
    });
    syncBuiltinESMExports();
    identity = { miniflareEntry, miniflareEntrySha256: sha(readFileSync(miniflareEntry)),
      undiciEntry, undiciEntrySha256: sha(readFileSync(undiciEntry)),
      undiciVersion: mfRequire('undici/package.json').version, bindingAccess: 'direct-dispatch-only' };

  } catch (error) {
    try { restore(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'partial host guard install failed'); }
    throw error;
  }
  return {
    identity, restore, setPhase(value) { state.phase = value; },
    snapshot() { return { identity, phase: state.phase, restored: state.restored, denials: structuredClone(events), allowed: structuredClone(allowed),
      bindingAccess: 'direct-dispatch-only' }; },
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
      await rejected('Node Worker construction', () => new workerThreads.Worker('unused', { eval: true }));
      controls = expected; state.phase = 'runtime'; return { expectedBlockedControls: [...expected], denials: structuredClone(events) };
    },
    assertContained() {
      assert.equal(controls?.length, 10); assert.equal(events.length, 10);
      assert.ok(events.every(row => row.phase === 'guard-selfcheck'), 'no unexpected setup, runtime or disposal host denial');
    },
  };
}


// This function is serialized as fixture source and bundled with the selected
// production exports. Its body runs only inside workerd. The JSON boundary holds
// synthetic rows, proof strings and PNG bytes, never an opaque authority token.
function fixtureWorker({ inventory, core, media, custody, principal, intakeAuthority, sceneVersion, sceneEpochActivateSql, sceneMigration, wire, composition, revision, eventWrite, ownership }) {
  const requireFact = (value, message) => { if (!value) throw Error('copy_fixture:' + message); };
  const encoder = new TextEncoder();
  const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const same = (actual, expected, label) => requireFact(stable(actual) === stable(expected), label);
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const quote = name => '"' + name.replaceAll('"', '""') + '"';
  const attemptTable = 'experience_guest_image_result_copy_attempts', leaseTable = 'experience_guest_claim_leases';
  async function snapshot(db, tables) {
    const output = {};
    for (const name of tables) {
      const columns = (await db.prepare(`PRAGMA table_info(${quote(name)})`).all()).results.map(row => row.name);
      const expressions = ['CAST(rowid AS TEXT) AS original_rowid', ...columns.map((column, i) => `quote(${quote(column)}) AS c${i}`)];
      output[name] = (await db.prepare(`SELECT ${expressions.join(',')} FROM ${quote(name)} ORDER BY rowid`).all()).results;
    }
    return output;
  }
  async function install(db, exported) {
    requireFact(exported.schema.length <= 512 && exported.inserts.length <= 2048, 'snapshot bounds');
    await db.batch(exported.schema.filter(row => row.type === 'table').map(row => db.prepare(row.sql)));
    await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'), ...exported.inserts.map(sql => db.prepare(sql))]);
    const secondary = exported.schema.filter(row => row.sql && row.type !== 'table');
    if (secondary.length) await db.batch(secondary.map(row => db.prepare(row.sql)));
    same((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'fixture foreign keys');
    same(await snapshot(db, exported.tables), exported.rows, 'native rowids/scalars exactly installed');
    const names = new Set(exported.schema.map(row => row.name));
    const schema = (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
    same(schema.filter(row => names.has(row.name)), exported.schema, 'native schema exactly installed');
  }
  let used = false;
  return { async fetch(incoming, bindings) {
    requireFact(!used && incoming.method === 'POST' && new URL(incoming.url).pathname === '/qualify', 'single fixture request');
    used = true;
    const raw = await incoming.text(); requireFact(encoder.encode(raw).length <= 16 * 1024 * 1024, 'fixture input bound');
    const input = JSON.parse(raw), db = bindings.DB, bucket = bindings.MEDIA;
    requireFact(input.mode === 'positive' && ['positive', 'cancellation', 'deadline', 'successor'].includes(input.portCase), 'fixed native current case');
    const retained = input.mode.startsWith('retained-');
    const bytes = Uint8Array.from(atob(input.source.base64), char => char.charCodeAt(0));
    requireFact(bytes.length <= 20 * 1024 * 1024 && await hash(bytes) === input.source.sha256, 'synthetic source byte hash');
    await install(db, input.snapshot);
    const sourceSetup = await bucket.put(input.source.key, bytes, {
      customMetadata: input.source.metadata, httpMetadata: input.source.httpMetadata, onlyIf: { etagDoesNotMatch: '*' },
    });
    requireFact(sourceSetup !== null, 'fixture source setup has a native ACK');
    const sourceVersion = sourceSetup.version;
    const calls = [], violations = [], trace = [], sqlForms = new Map(), handles = new WeakMap();
    let traceBytes = 0, sqlBytes = 0, step = 'inventory', injected = 0, rollbackSnapshot = null, finalBatchSize = null, injectionError = null;
    const count = kind => calls.filter(row => row.kind === kind).length;
    const reject = message => { violations.push(message); throw Error('copy_fixture_guard:' + message); };
    const currentRow = () => db.prepare(`SELECT * FROM ${attemptTable}`).first();
    const record = (sql, values, method) => {
      const inserted = /^\s*INSERT INTO (experience_guest_claim_leases|experience_guest_image_result_copy_attempts|event_write_stage|event_client_receipts|output_commands|private_content|experience_guest_context_adoptions|experience_guest_image_claims|experience_guest_image_stage_custodies|experience_guest_image_stage_copies|experience_guest_image_result_custodies|experience_guest_image_result_copies)\s*\(/u.exec(sql)?.[1];
      const updated = /^\s*UPDATE (experience_guest_image_result_copy_attempts|experience_guest_sessions)\s+SET\b/u.exec(sql)?.[1] ?? null;
      const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/giu;
      if (encoder.encode(sql).length > 100000 || values.length > 100) reject('native SQL bounds');
      if (inserted || updated) {
        if (method !== 'batch' || /;|--|\/\*/u.test(sql) || [...sql.matchAll(mutation)].length !== 1) reject('mutation outside exact transactional table allocation');
        if (inserted && ![attemptTable, leaseTable].includes(inserted) && !['claim', 'retained-claim'].includes(step)
          || updated === 'experience_guest_sessions' && !['claim', 'retained-claim'].includes(step)) reject('claim mutation outside final claim');
      } else if (!/^\s*(?:SELECT|WITH)\b/iu.test(sql) || mutation.test(sql)) reject('unallocated SQL');
      const key = JSON.stringify([sql, values]);
      if (!sqlForms.has(key)) {
        sqlBytes += encoder.encode(key).length;
        if (sqlForms.size >= 4096 || sqlBytes > 32 * 1024 * 1024) reject('SQL evidence bound');
        sqlForms.set(key, { sql, bindings: [...values] });
      }
      const item = { step, method, inserted: inserted ?? null, updated, form: [...sqlForms.keys()].indexOf(key), parameters: values.length };
      traceBytes += encoder.encode(JSON.stringify(item)).length;
      if (trace.length >= 16384 || traceBytes > 2 * 1024 * 1024) reject('SQL trace bound');
      trace.push(item);
    };
    function statement(sql, values = []) {
      const native = values.length ? db.prepare(sql).bind(...values) : db.prepare(sql);
      const wrapped = {
        bind(...next) { return statement(sql, next); },
        async first(...args) { record(sql, values, 'first'); return native.first(...args); },
        async all(...args) { record(sql, values, 'all'); return native.all(...args); },
        async run(...args) { record(sql, values, 'run'); return native.run(...args); },
        raw() { return reject('DB.raw'); },
      };
      handles.set(wrapped, { native, sql, values }); return wrapped;
    }
    const observedDB = {
      prepare: sql => statement(sql),
      async batch(statements) {
        requireFact(Array.isArray(statements) && statements.length > 0 && statements.length <= 511, 'native batch bound');
        const items = statements.map(value => handles.get(value));
        if (items.some(value => !value)) return reject('foreign native statement');
        for (const item of items) record(item.sql, item.values, 'batch');
        const publication = ['claim', 'retained-claim'].includes(step) && items.some(item => /^\s*INSERT INTO experience_guest_image_result_custodies\s*\(/u.test(item.sql));
        if (publication) {
          requireFact(finalBatchSize === null, 'one physical final publication batch'); finalBatchSize = items.length;
          const row = await currentRow(); requireFact(row.state === 'ready', 'genuine persisted ready row precedes publication');
          if (['claim-rollback', 'foreign-null-envelope', 'foreign-lineage-alias'].includes(input.mode)) {
            const before = await snapshot(db, input.snapshot.tables), extra = [];
            const descriptor = JSON.parse(row.descriptor_json), m = descriptor.manifest;
            if (input.mode === 'claim-rollback') extra.push(db.prepare("SELECT json_extract('not-json','$')"));
            if (input.mode === 'foreign-null-envelope') extra.push(db.prepare(`INSERT INTO event_private_payloads
              (private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at) VALUES(?,?,NULL,?,?,?,NULL)`)
              .bind(crypto.randomUUID(), 'synthetic-foreign-owner', m.documentId, '{}', new Date().toISOString()));
            if (input.mode === 'foreign-lineage-alias') {
              const session = await db.prepare('SELECT * FROM experience_guest_sessions WHERE session_id=?').bind(row.session_id).first();
              const foreign = { ...session, session_id: crypto.randomUUID(), guest_subject: 'guest:' + crypto.randomUUID(),
                project_id: crypto.randomUUID(), document_id: crypto.randomUUID(), session_hash: 'sha256:' + '1'.repeat(64),
                claim_hash: 'sha256:' + '2'.repeat(64) };
              const keys = Object.keys(foreign);
              extra.push(db.prepare(`INSERT INTO experience_guest_sessions(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).bind(...keys.map(key => foreign[key])));
              // All four typed identities are valid text. The cross-session
              // original session reference is a real alias, not copied prose.
              const lineage = JSON.stringify({ sessionId: m.sessionId, guestSubject: foreign.guest_subject,
                projectId: foreign.project_id, documentId: foreign.document_id });
              extra.push(db.prepare(`INSERT INTO experience_guest_context_adoptions
                (session_id,destination_user_id,lease_id,request_id,manifest_digest,lineage_json,lineage_digest,created_at_ms)
                VALUES(?,?,?,?,?,?,?,?)`).bind(foreign.session_id, 'synthetic-foreign-owner', crypto.randomUUID(), crypto.randomUUID(),
                row.manifest_digest, lineage, 'sha256:' + '3'.repeat(64), Date.now()));
            }
            requireFact(items.length + extra.length <= 511, 'fixture fault injection also respects native batch bound');
            let lastMutation = -1;
            for (const [index, item] of items.entries()) if (/^\s*(?:INSERT|UPDATE)\b/u.test(item.sql)) lastMutation = index;
            requireFact(lastMutation >= 0 && lastMutation < items.length - 1, 'whole graph after assertions follow last write');
            // Fixture-owned rows are inserted after all canonical writes and
            // before the unmodified production after proofs. They confer no
            // capability and must roll back with the entire candidate graph.
            const native = items.map(item => item.native);
            native.splice(input.mode === 'claim-rollback' ? native.length : lastMutation + 1, 0, ...extra);
            injected++;
            try { await db.batch(native); }
            catch (error) {
              injectionError = String(error);
              requireFact(/malformed JSON/iu.test(injectionError), 'rollback reached a throwing proof rather than failing fixture DDL/constraints');
              rollbackSnapshot = await snapshot(db, input.snapshot.tables);
              same(rollbackSnapshot, before, 'native final batch rolled back every table, rowid and scalar'); throw error;
            }
            return reject('fixture final rollback or foreign graph unexpectedly passed');
          }
        }
        let result;
        try { result = await db.batch(items.map(item => item.native)); }
        catch (error) {
          if (['claim', 'retained-claim'].includes(step)) reportNativeFailure(error, 'native-batch');
          throw error;
        }
        if (publication && input.mode === 'claim-ack-lost') {
          requireFact((await currentRow())?.state === 'published', 'whole graph persisted before injected ACK loss');
          injected++; return null;
        }
        return result;
      },
      exec() { return reject('DB.exec'); }, dump() { return reject('DB.dump'); },
    };
    async function checkKey(key, kind) {
      if (key === input.source.key) {
        if (!['get', 'head'].includes(kind)) return reject('source mutation');
        return 'source';
      }
      const row = await currentRow();
      if (!row || key !== row.destination_key || !['copy', 'claim', 'retained-claim'].includes(step)) return reject('unallocated storage key');
      if (step === 'retained-claim' && !['get', 'head'].includes(kind)) return reject('retained retry is strictly read only before the claim');
      if (step === 'claim' && kind !== 'head') return reject('final claim may only inspect the already verified destination HEAD');
      return 'destination';
    }
    const observedBucket = {
      async get(key, ...args) {
        const target = await checkKey(key, 'get'); calls.push({ kind: target + '-get', key });
        // Preserve native object/body/accessor/method identity and receivers. No
        // plain-object spread, proxy hydration or synthesized stream is used.
        const value = await Reflect.apply(bucket.get, bucket, [key, ...args]);
        if (step === 'retained-claim' && input.mode === 'retained-cleanup-race' && target === 'destination') {
          requireFact(injected === 0, 'one exact fixture-owned cleanup race');
          const prior = await currentRow(); requireFact(prior.state === 'ready', 'genuine ready precedes race');
          await db.prepare(`UPDATE ${attemptTable} SET state='cleanup_pending',row_version=row_version+1,updated_at_ms=? WHERE attempt_id=? AND state='ready'`)
            .bind(Date.now(), prior.attempt_id).run();
          requireFact((await currentRow()).state === 'cleanup_pending', 'fixture cleanup fence persisted'); injected++;
        }
        return value;
      },
      async head(key, ...args) {
        const target = await checkKey(key, 'head'); calls.push({ kind: target + '-head', key });
        return Reflect.apply(bucket.head, bucket, [key, ...args]);
      },
      async put(key, value, options) {
        if (await checkKey(key, 'put') !== 'destination' || count('destination-put')) return reject('more than one app PUT');
        const row = await currentRow();
        requireFact(row.state === 'writing' && row.put_outcome === 'pending', 'native writing row precedes app PUT');
        requireFact(value instanceof ArrayBuffer && value.byteLength === bytes.byteLength, 'actual admitted PUT backing buffer');
        same([...new Uint8Array(value)], [...bytes], 'exact original PUT bytes');
        same(options, { onlyIf: { etagDoesNotMatch: '*' }, customMetadata: JSON.parse(row.destination_metadata_json), httpMetadata: { contentType: 'image/png' } }, 'native conditional PUT options');
        calls.push({ kind: 'destination-put', key });
        const result = await Reflect.apply(bucket.put, bucket, [key, value, options]);
        return result;
      },
      async delete(key, ...args) {
        if (await checkKey(key, 'delete') !== 'destination') return reject('wrong DELETE key');
        const row = await currentRow();
        requireFact(row.state === 'cleanup_pending' && row.put_outcome === 'success', 'irreversible fence and known settlement precede DELETE');
        calls.push({ kind: 'destination-delete', key });
        return Reflect.apply(bucket.delete, bucket, [key, ...args]);
      },
      list() { return reject('MEDIA.list'); }, createMultipartUpload() { return reject('MEDIA.multipart'); },
    };
    const env = { DB: observedDB, MEDIA: observedBucket,
      OPENAI_API_KEY: 'no-network-fixture', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: 'gpt-image-2',
      ASSETS: { fetch() { return reject('ASSETS.fetch'); } } };
    const controller = new AbortController();
    const request = new Request(input.request.url, { method: 'POST', headers: input.request.headers, signal: controller.signal });
    const inspected = await inventory.inspectGuestImageResultInventory(request, env, { proof: input.proof });
    step = 'lease';
    const leased = await core.acquireGuestImageResultClaimSource(request, env, { inventory: inspected, requestId: crypto.randomUUID() });
    step = 'source-media';
    const observed = await media.readLeasedGuestImageResultMedia(request, env, leased);
    step = 'reserve';
    const reserved = await media.reserveGuestImageResultMedia(request, env, observed);
    requireFact(reserved.status === 'reserved', 'genuine fixed reserve succeeded');
    const reservedRow = await currentRow(); requireFact(reservedRow?.state === 'reserved', 'native reserved row');
    const reservedLeaseRows = (await db.prepare(`SELECT * FROM ${leaseTable}`).all()).results;
    step = 'copy';
    const outcome = await media.copyGuestImageResultMedia(request, env, reserved.reservation);
    requireFact(outcome.status === 'ready', 'genuine source, lease, bytes, reservation and writer reach ready');
    const readyReview = core.guestImageResultReadyReview(request, env, outcome.ready), readyRow = await currentRow();
    requireFact(readyRow.state === 'ready' && readyRow.put_outcome === 'success', 'known ACK and separate native readback recorded');
    const readySnapshot = await snapshot(db, input.snapshot.tables);
    const readySession = await db.prepare('SELECT * FROM experience_guest_sessions WHERE session_id=?').bind(readyRow.session_id).first();
    step = retained ? 'retained-claim' : 'claim';
    const freshRequest = retained ? new Request(input.request.url, { method: 'POST', headers: input.request.headers }) : null;
    const retryInput = { proof: input.proof, selector: { version: 1, attemptId: readyRow.attempt_id, custodyId: readyRow.custody_id, manifestDigest: readyRow.manifest_digest } };
    if (retained) controller.abort();
    let claimed = null, claimError = null;
    const positiveMode = ['positive', 'claim-ack-lost', 'retained-positive'].includes(input.mode);
    // Keep the original captured error unchanged. Only known constant error
    // tokens cross the diagnostic boundary; native errors may embed row data.
    const diagnosticState = (originalText, rowState) => {
      const boundedText = originalText === null ? null : originalText.slice(0, 4096), lower = boundedText?.toLowerCase();
      const recognized = boundedText !== null
        && /^(?:Error: )?(?:guest_image_result_[a-z_]+|copy_fixture(?:_guard)?:[a-z_]+)$/u.test(boundedText);
      return {
        errorText: boundedText === null ? null : recognized ? boundedText : '[unrecognized error text redacted]',
        errorTextRedacted: boundedText !== null && (!recognized || boundedText.length !== originalText.length),
        claimedStatus: claimed === null ? null : claimed.status === 'claimed' ? 'claimed' : 'unexpected',
        nativeErrorTokens: ['D1_ERROR', 'SQLITE_ERROR', 'SQLITE_CONSTRAINT', 'SQLITE_TOOBIG', 'SQLITE_RANGE', 'SQLITE_BUSY', 'SQLITE_INTERRUPT']
          .filter(token => boundedText !== null && new RegExp('\\b' + token + '\\b', 'u').test(boundedText)),
        nativeFailureReasons: ['expression tree is too large', 'expression tree too large', 'too many sql variables', 'sql logic error',
          'too many terms in compound select', 'no such table', 'no such column', 'malformed json'].filter(reason => lower?.includes(reason)),
        rowState: ['reserved', 'writing', 'ready', 'cleanup_pending', 'deleted', 'published'].includes(rowState) ? rowState : null,
        lastConfirmedNativeTransition: 'ready', finalBatchSize, injected, attemptedSqlTraceCount: trace.length,
        lastAttemptedSqlStep: ['inventory', 'lease', 'source-media', 'reserve', 'copy', 'claim', 'retained-claim'].includes(trace.at(-1)?.step)
          ? trace.at(-1).step : null,
        lastAttemptedSqlForm: Number.isSafeInteger(trace.at(-1)?.form) ? trace.at(-1).form : null,
      };
    };
    function reportNativeFailure(error, boundary, capturedText) {
      if (!positiveMode) return;
      try {
        const ownErrorToken = name => {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(error, name);
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
            const value = descriptor.value;
            if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
            return typeof value === 'string' && /^(?:[A-Za-z]{1,64}Error|Error|[A-Z][A-Z_]{0,127}|guest_image_result_[a-z_]{1,128})$/u.test(value) ? value : null;
          } catch { return null; }
        };
        console.error('[guest-result-claim-d1-native-failure] ' + JSON.stringify({ boundary,
          ...diagnosticState(capturedText ?? String(error), null), errorName: ownErrorToken('name'), errorCode: ownErrorToken('code') }));
      } catch { /* Diagnostic failure must not replace the original native error. */ }
    }
    try { claimed = retained ? await core.retryGuestImageResultClaim(freshRequest, env, retryInput)
      : await core.claimGuestImageResult(request, env, outcome.ready); }
    catch (error) {
      claimError = String(error);
      reportNativeFailure(error, 'claim-catch', claimError);
    }
    const callsBeforeReplay = calls.length, traceBeforeReplay = trace.length;
    let replayRefused = false;
    try { if (retained) await core.retryGuestImageResultClaim(freshRequest, env, retryInput);
      else await core.claimGuestImageResult(request, env, outcome.ready); } catch { replayRefused = true; }
    requireFact(replayRefused && calls.length === callsBeforeReplay && trace.length === traceBeforeReplay,
      'spent ready cannot dispatch SQL, media or another claim');
    step = 'fixture-verification';
    const row = await currentRow();
    requireFact(row !== null, 'one persisted attempt remains');
    const attemptRows = (await db.prepare(`SELECT * FROM ${attemptTable}`).all()).results;
    const leaseRows = (await db.prepare(`SELECT * FROM ${leaseTable}`).all()).results;
    requireFact(attemptRows.length === 1 && leaseRows.length === 1, 'single native lease and attempt');
    same(leaseRows, reservedLeaseRows, 'complete native lease remains unchanged throughout copy and claim');
    const immutableColumns = ['attempt_id', 'custody_id', 'session_id', 'destination_user_id', 'lease_id', 'lease_acquisition',
      'request_id', 'manifest_digest', 'descriptor_json', 'descriptor_digest', 'lease_snapshot_json', 'source_expires_at_ms',
      'destination_key', 'writer_nonce', 'content_sha256', 'byte_length', 'mime_type', 'width', 'height', 'destination_metadata_json', 'created_at_ms'];
    requireFact(Object.keys(row).length === 30, 'complete accepted native attempt row');
    for (const name of immutableColumns) same(row[name], reservedRow[name], 'immutable native attempt value:' + name);
    const destination = await bucket.get(row.destination_key);
    const destinationReceipt = destination === null ? null : { version: destination.version, etag: destination.etag,
      size: destination.size, sha256: await hash(await destination.arrayBuffer()), metadata: destination.customMetadata };
    const original = await bucket.get(input.source.key);
    requireFact(original !== null && original.version === sourceVersion && await hash(await original.arrayBuffer()) === input.source.sha256, 'original native object preserved');
    same(original.customMetadata, input.source.metadata, 'original native metadata preserved');
    const after = await snapshot(db, input.snapshot.tables);
    const changedTables = [attemptTable, leaseTable, 'experience_guest_sessions', 'events', 'event_private_payloads', 'event_client_receipts',
      'output_commands', 'private_content', 'experience_guest_context_adoptions', 'experience_guest_image_claims',
      'experience_guest_image_stage_custodies', 'experience_guest_image_stage_copies', 'experience_guest_image_result_custodies',
      'experience_guest_image_result_copies'];
    for (const [name, before] of Object.entries(input.snapshot.rows)) {
      if (!changedTables.includes(name)) same(after[name], before, 'untouched table:' + name);
    }
    const canonical = {};
    for (const table of ['experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_image_stage_custodies',
      'experience_guest_image_stage_copies', 'experience_guest_image_result_custodies', 'experience_guest_image_result_copies'])
      canonical[table] = (await db.prepare(`SELECT * FROM ${quote(table)}`).all()).results;
    const session = await db.prepare('SELECT * FROM experience_guest_sessions WHERE session_id=?').bind(row.session_id).first();
    const descriptor = JSON.parse(row.descriptor_json), destinationStream = 'creative:' + row.destination_user_id;
    const events = (await db.prepare('SELECT * FROM events WHERE stream_id=? ORDER BY sequence').bind(destinationStream).all()).results;
    const contents = (await db.prepare('SELECT * FROM private_content WHERE owner_id=? ORDER BY content_id').bind(row.destination_user_id).all()).results;
    if (['positive', 'claim-ack-lost', 'retained-positive'].includes(input.mode)) {
      if (!(claimed?.status === 'claimed' && claimError === null && row.state === 'published'))
        throw Error('copy_fixture:exact complete winner accepted:' + JSON.stringify({ boundary: 'winner-assertion', ...diagnosticState(claimError, row.state) }));
      requireFact(claimed?.status === 'claimed' && claimError === null && row.state === 'published', 'exact complete winner accepted');
      requireFact(session.revoked_at_ms === row.published_at_ms && row.published_claim_digest === canonical.experience_guest_image_result_custodies[0]?.lineage_digest,
        'same atomic native tombstone, publication and canonical digest');
      same({ ...session, revoked_at_ms: readySession.revoked_at_ms }, readySession, 'every original session value except the one tombstone is preserved');
      requireFact(after.experience_guest_sessions.length === readySnapshot.experience_guest_sessions.length, 'no extra session created by claim');
      requireFact(events.length === descriptor.manifest.sourceHead + 2 && events.at(-1).type === 'GuestImageResultClaimed', 'N+2 canonical events');
      requireFact(contents.length === 5, 'five canonical body copies');
      for (const table of ['experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_image_stage_custodies', 'experience_guest_image_result_custodies'])
        requireFact(canonical[table].length === 1, 'one canonical mapping:' + table);
      requireFact(canonical.experience_guest_image_stage_copies.length === 3 && canonical.experience_guest_image_result_copies.length === 2, 'three plus two copy rows');
      const lineage = JSON.parse(canonical.experience_guest_image_result_custodies[0].lineage_json);
      for (const copy of [...lineage.stageCopies, ...lineage.resultCopies]) {
        const content = contents.find(value => value.content_id === copy.content_id);
        requireFact(content && content.owner_id === row.destination_user_id && content.redacted_at === null
          && content.created_at === copy.created_at && content.expires_at === copy.expires_at
          && encoder.encode(content.content).length === copy.byte_length, 'native canonical content/receipt association');
        // Contract digests hash canonical JSON strings, not raw UTF-8 bytes.
        requireFact('sha256:' + await hash(encoder.encode(JSON.stringify(content.content))) === copy.original_digest, 'exact copied body digest');
      }
      // Canonical append-only additions must not rewrite an original row. The
      // one guest-session tombstone is the sole allowed source-row update.
      for (const name of ['events', 'event_private_payloads', 'event_client_receipts', 'output_commands', 'private_content'])
        for (const before of input.snapshot.rows[name]) requireFact(after[name].some(value => stable(value) === stable(before)), 'original row preserved:' + name);
    } else if (input.mode === 'retained-cleanup-race') {
      requireFact(claimed === null && claimError !== null && injected === 1 && finalBatchSize === null && row.state === 'cleanup_pending',
        'fresh retry observes cleanup fence and does not publish');
      const expected = structuredClone(readySnapshot);
      expected[attemptTable] = after[attemptTable];
      same(after, expected, 'only fixture-owned attempt fence changed; no canonical write, lease refresh or revocation');
      requireFact(session.revoked_at_ms === null && events.length === 0 && contents.length === 0, 'no partial graph after fresh retry race');
    } else {
      requireFact(claimed === null && claimError !== null && injected === 1 && finalBatchSize !== null && rollbackSnapshot !== null,
        'control reached actual final batch and native rollback');
      same(after, readySnapshot, 'all candidate events, bodies, mappings, publication and revocation rolled back');
      same(row, readyRow, 'complete known-success ready tuple preserved after rollback');
      requireFact(session.revoked_at_ms === null && events.length === 0 && contents.length === 0, 'no partial visible canonical graph');
    }
    same((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'final foreign keys');
    same(violations, [], 'no swallowed fixture guard violation');
    requireFact(count('source-get') === 1 && count('source-head') === 1, 'one native source GET/HEAD');
    // Measured from the actual emitted constructor and executions. JSON byte
    // counts below describe these retained fixture bindings, not a replacement
    // for production's complete own-data envelope accounting or a new gate.
    const forms = [...sqlForms.values()];
    const nativeBudgetObservation = {
      statements: trace.length, finalBatchStatements: finalBatchSize,
      maxSqlUtf8Bytes: Math.max(...forms.map(item => encoder.encode(item.sql).length)),
      maxBindingArrayJsonBytes: Math.max(...forms.map(item => encoder.encode(JSON.stringify(item.bindings)).length)),
      claimStatements: trace.filter(item => ['claim', 'retained-claim'].includes(item.step)).length,
      claimSqlUtf8Bytes: trace.filter(item => ['claim', 'retained-claim'].includes(item.step))
        .reduce((total, item) => total + encoder.encode(forms[item.form].sql).length, 0),
      claimBindingArrayJsonBytes: trace.filter(item => ['claim', 'retained-claim'].includes(item.step))
        .reduce((total, item) => total + encoder.encode(JSON.stringify(forms[item.form].bindings)).length, 0),
    };
    const receipt = { mode: input.mode, status: claimed?.status ?? null, claimError, claimed, readyReview, row, readyRow, reservedRow, nativeBudgetObservation,
      destination: destinationReceipt, injected, injectionError, rolledBack: rollbackSnapshot !== null, replayRefused, finalBatchSize,
      canonical, session, events, contents, calls, trace, fixtureStorageCalls: { sourceSetupPut: 1, sourceVerificationGet: 1, destinationVerificationGet: 1 },
      sqlForms: [...sqlForms.values()], sourceVersion, unchangedTables: input.snapshot.tables.filter(name => !changedTables.includes(name)),
      sourceSha256: input.source.sha256, preservedRowsSha256: await hash(encoder.encode(stable(Object.fromEntries(Object.entries(after).filter(([name]) => !changedTables.includes(name)))))) };
    // Separate current-read phase; genuine native publication above is unchanged.
    requireFact(input.mode === 'positive' && ['positive', 'cancellation', 'deadline', 'successor'].includes(input.portCase), 'fixed native successor case');
    requireFact(receipt.status === 'claimed' && row.state === 'published', 'genuine publication precedes current');
    const retainedCustody = canonical.experience_guest_image_result_custodies[0];
    const retainedLineage = JSON.parse(retainedCustody.lineage_json);
    const originalPlan = contents.find(value => value.content_id === retainedLineage.resultCopies.find(copy => copy.role === 'planner').content_id);
    requireFact(originalPlan && originalPlan.owner_id === row.destination_user_id, 'genuine retained planner');
    const originalClaim = receipt.claimed.completedReview;
    const claimPayloadRow = await db.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=?')
      .bind(retainedCustody.claim_event_id, row.destination_user_id).first();
    requireFact(claimPayloadRow && typeof claimPayloadRow.private_json === 'string', 'genuine canonical private claim');
    const originalClaimPayload = JSON.parse(claimPayloadRow.private_json);
    const expectedCurrent = Object.freeze({
      ownerId: row.destination_user_id,
      projectId: retainedLineage.copy.manifest.projectId,
      documentId: retainedLineage.copy.manifest.documentId,
      outputId: retainedCustody.output_id,
      generationId: retainedCustody.generation_id,
      claimEventId: retainedCustody.claim_event_id,
      key: row.destination_key,
    });
    controller.abort();
    requireFact(request.signal.aborted, 'original producer request retired');
    const currentController = new AbortController();
    const currentOrigin = new URL(request.url).origin;
    const currentRequest = new Request(currentOrigin + '/api/generated-images/' + encodeURIComponent(expectedCurrent.outputId), {
      method: 'GET', headers: { origin: currentOrigin,
        'oai-authenticated-user-id': expectedCurrent.ownerId,
        'oai-authenticated-user-email': expectedCurrent.ownerId + '@example.invalid' },
      signal: currentController.signal,
    });
    requireFact(!currentRequest.signal.aborted && currentRequest.body === null
      && new URL(currentRequest.url).search === '' && !currentRequest.headers.has('cookie')
      && !currentRequest.headers.has('authorization'), 'fresh personal GET with no guest or project-context authority');

    // Exact local fixture DDL only; no application operation installs this schema.
    const preMigrationRows = await snapshot(db, input.snapshot.tables);
    const sceneStatements = sceneMigration.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean);
    requireFact(sceneStatements.length > 0 && sceneStatements.length <= 64, 'pinned scene migration bound');
    await db.batch(sceneStatements.map(sql => db.prepare(sql)));
    same(await snapshot(db, input.snapshot.tables), preMigrationRows, 'scene DDL preserves all preexisting rows');

    async function fullCurrentState() {
      const schema = (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
      const tempSchema = (await db.prepare('SELECT type,name,tbl_name,sql FROM temp.sqlite_schema ORDER BY type,name').all()).results;
      const discovered = schema.filter(value => value.type === 'table').map(value => value.name).sort();
      const tables = [...input.snapshot.tables, 'scene_source_epoch', 'scene_source_generations'].sort();
      requireFact(discovered.length <= 512 && new Set(discovered).size === discovered.length
        && new Set(tables).size === tables.length, 'complete bounded native table roster');
      // Installed workerd reserves these exact internal tables; D1 denies their
      // row/PRAGMA access. Preserve their complete catalog definitions, while
      // snapshotting every exported application table and both actual scene tables.
      const protectedNames = new Set(['_cf_KV', '_cf_METADATA']);
      requireFact(tables.every(name => discovered.includes(name) && !protectedNames.has(name))
        && discovered.every(name => tables.includes(name) || protectedNames.has(name)), 'exact application and protected native table roster');
      const protectedPlatformTables = schema.filter(value => value.type === 'table' && protectedNames.has(value.name));
      return { schema, tempSchema, tables, protectedPlatformTables, rows: await snapshot(db, tables) };
    }
    function currentReject(message) {
      const value = 'current:' + message;
      // The enclosing fixture rechecks this same ledger at final response. A
      // production catch-to-null never turns a forbidden operation into a pass.
      violations.push(value);
      throw Error('copy_fixture_guard:' + value);
    }
    function readonlyCurrentSql(sql) {
      if (typeof sql !== 'string' || !/^\s*SELECT\b/iu.test(sql)) return false;
      let delimiter = '';
      for (let index = 0; index < sql.length; index++) {
        const character = sql[index];
        if (delimiter) {
          if (character === delimiter) {
            if (delimiter !== ']' && sql[index + 1] === delimiter) index++;
            else delimiter = '';
          }
        } else if (["'", '"', '`'].includes(character)) delimiter = character;
        else if (character === '[') delimiter = ']';
        else if (character === ';' || sql.slice(index, index + 2) === '--' || sql.slice(index, index + 2) === '/*') return false;
      }
      return delimiter === '';
    }
    function makeCurrentDbFacet(phaseName, permitEpochActivation = false) {
      const originals = new WeakMap(), pending = new Set();
      const observation = { phase: phaseName, statements: 0, wrappers: 0, batches: 0,
        maxBatch: 0, maxSqlBytes: 0, maxBindingBytes: 0, activationBatches: 0 };
      let active = true;
      const checkActive = () => { if (!active) currentReject(phaseName + ':stale-facet'); };
      function validate(sql, bindings) {
        checkActive();
        if (typeof sql !== 'string' || encoder.encode(sql).length > 100000
          || !Array.isArray(bindings) || bindings.length > 100
          || bindings.some(value => value !== null && typeof value !== 'string'
            && !(typeof value === 'number' && Number.isFinite(value)))
          || encoder.encode(JSON.stringify(bindings)).length > 1048576
          || !(readonlyCurrentSql(sql) || permitEpochActivation && sql === sceneEpochActivateSql && bindings.length === 0))
          currentReject(phaseName + ':sql-or-bindings');
      }
      function recordCurrent(query, method) {
        validate(query.sql, query.bindings);
        if (++observation.statements > 2186) currentReject(phaseName + ':statement-cap');
        const key = JSON.stringify([query.sql, query.bindings]);
        if (!sqlForms.has(key)) {
          sqlBytes += encoder.encode(key).length;
          if (sqlForms.size >= 4096 || sqlBytes > 32 * 1024 * 1024) currentReject('shared-sql-evidence-cap');
          sqlForms.set(key, { sql: query.sql, bindings: [...query.bindings] });
        }
        const entry = { step: phaseName, method, inserted: null, updated: null,
          form: [...sqlForms.keys()].indexOf(key), parameters: query.bindings.length };
        traceBytes += encoder.encode(JSON.stringify(entry)).length;
        if (trace.length >= 16384 || traceBytes > 2 * 1024 * 1024) currentReject('shared-trace-cap');
        trace.push(entry);
        observation.maxSqlBytes = Math.max(observation.maxSqlBytes, encoder.encode(query.sql).length);
        observation.maxBindingBytes = Math.max(observation.maxBindingBytes, encoder.encode(JSON.stringify(query.bindings)).length);
      }
      function dispatch(work) {
        checkActive();
        const value = work();
        const promise = Promise.resolve(value);
        pending.add(promise);
        promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
      }
      function statement(sql, bindings = []) {
        validate(sql, bindings);
        if (++observation.wrappers > 4372) currentReject(phaseName + ':prepare-bind-cap');
        const actual = db.prepare(sql);
        const native = bindings.length ? actual.bind(...bindings) : actual;
        const item = Object.freeze({ native, sql, bindings: Object.freeze([...bindings]) });
        const wrapped = Object.freeze({
          bind(...values) { checkActive(); return statement(sql, values); },
          first(...args) {
            if (args.length > 1 || args.length && typeof args[0] !== 'string'
              || !readonlyCurrentSql(sql)) currentReject(phaseName + ':first');
            recordCurrent(item, 'first');
            return dispatch(() => Reflect.apply(native.first, native, args));
          },
          all(...args) {
            if (args.length || !readonlyCurrentSql(sql)) currentReject(phaseName + ':all');
            recordCurrent(item, 'all');
            return dispatch(() => Reflect.apply(native.all, native, []));
          },
          run() { return currentReject(phaseName + ':run'); },
          raw() { return currentReject(phaseName + ':raw'); },
        });
        originals.set(wrapped, item);
        return wrapped;
      }
      const database = Object.freeze({
        prepare(...args) { if (args.length !== 1) return currentReject(phaseName + ':prepare-arity'); return statement(args[0]); },
        batch(...args) {
          checkActive();
          const queries = args[0];
          if (args.length !== 1 || !Array.isArray(queries) || queries.length < 1 || queries.length > 210)
            currentReject(phaseName + ':batch-shape');
          const selected = [];
          // Resolve/validate every member before any native dispatch. No array holes,
          // stale producer handles, raw native handles or partially executed prefix.
          for (let index = 0; index < queries.length; index++) {
            const slot = Object.getOwnPropertyDescriptor(queries, index);
            const item = slot && Object.hasOwn(slot, 'value') ? originals.get(slot.value) : null;
            if (!item) currentReject(phaseName + ':foreign-or-sparse-batch');
            validate(item.sql, item.bindings); selected.push(item);
          }
          const activations = selected.filter(item => item.sql === sceneEpochActivateSql);
          if (activations.length && (!permitEpochActivation || activations.length !== 1
            || selected.length !== 4 || selected[2].sql !== sceneEpochActivateSql
            || observation.activationBatches !== 0)) currentReject(phaseName + ':activation-shape');
          if (activations.length) observation.activationBatches++;
          if (observation.statements + selected.length > 2186) currentReject(phaseName + ':batch-statement-cap');
          for (const item of selected) recordCurrent(item, 'batch');
          observation.batches++; observation.maxBatch = Math.max(observation.maxBatch, selected.length);
          return dispatch(() => Reflect.apply(db.batch, db, [selected.map(item => item.native)]));
        },
        exec() { return currentReject(phaseName + ':exec'); },
        dump() { return currentReject(phaseName + ':dump'); },
        withSession() { return currentReject(phaseName + ':withSession'); },
      });
      return Object.freeze({ database, observation,
        seal() { active = false; },
        async settle() { await Promise.allSettled([...pending]); requireFact(pending.size === 0, 'current native DB settlement'); },
      });
    }

    // Local source preparation has an explicit, separate authority/activation facet.
    // Current-read never inherits this exception or any producer/source allowance.
    const beforeEpoch = await fullCurrentState();
    const setupFacet = makeCurrentDbFacet('current-fixture-scene-setup', true);
    const setupEnv = { ...env, DB: setupFacet.database, MEDIA: Object.freeze({
      get() { return currentReject('setup:MEDIA.get'); }, head() { return currentReject('setup:MEDIA.head'); },
      put() { return currentReject('setup:MEDIA.put'); }, delete() { return currentReject('setup:MEDIA.delete'); },
      list() { return currentReject('setup:MEDIA.list'); }, createMultipartUpload() { return currentReject('setup:MEDIA.multipart'); },
      resumeMultipartUpload() { return currentReject('setup:MEDIA.resume-multipart'); },
    }) };
    let sceneVersionReceipt, fixturePrincipal;
    try {
      const auth = await principal.readExistingPrincipalRequest(currentRequest, setupEnv, 'creator', { account: 'principal' });
      requireFact(!Object.hasOwn(auth, 'kind') && !auth.response && auth.user
        && principal.requireConsent(auth.user) === null && auth.user.userId === expectedCurrent.ownerId,
      'real consented claimant for explicit source preparation');
      fixturePrincipal = auth.user;
      const authority = intakeAuthority.projectIntakeAuthority(setupEnv,
        { user: auth.user, principal: auth.user, impersonation: null },
        { projectId: expectedCurrent.projectId, documentId: expectedCurrent.documentId });
      sceneVersionReceipt = await sceneVersion.captureSceneSourceVersion(setupEnv, { streamId: auth.user.streamId }, [authority]);
      requireFact(sceneVersionReceipt.streamId === 'creative:' + expectedCurrent.ownerId
        && sceneVersionReceipt.epoch === 1 && setupFacet.observation.activationBatches === 1, 'one genuine fixture source epoch');
    } finally { setupFacet.seal(); await setupFacet.settle(); }
    const afterEpoch = await fullCurrentState();
    same(afterEpoch.schema, beforeEpoch.schema, 'source preparation schema unchanged');
    same(afterEpoch.tempSchema, beforeEpoch.tempSchema, 'source preparation temp schema unchanged');
    for (const table of beforeEpoch.tables) if (table !== 'scene_source_epoch')
      same(afterEpoch.rows[table], beforeEpoch.rows[table], 'source preparation preserves:' + table);
    requireFact(afterEpoch.rows.scene_source_epoch.length === 1, 'one prepared epoch row');

    function makePersonalDbFacet(role, phaseName) {
      const [statementLimit, batchLimit] = caps[role];
      const originals = new WeakMap(), pending = new Set();
      const observation = { phase: phaseName, statements: 0, wrappers: 0, batches: 0,
        maxBatch: 0, maxSqlBytes: 0, maxBindingBytes: 0, activationBatches: 0 };
      let active = true;
      const checkActive = () => { if (!active) currentReject(phaseName + ':stale-facet'); };
      function validate(sql, bindings) {
        checkActive();
        if (typeof sql !== 'string' || encoder.encode(sql).length > 100000
          || !Array.isArray(bindings) || bindings.length > 100
          || bindings.some(value => value !== null && typeof value !== 'string'
            && !(typeof value === 'number' && Number.isFinite(value)))
          || encoder.encode(JSON.stringify(bindings)).length > 1048576
          || !readonlyCurrentSql(sql))
          currentReject(phaseName + ':sql-or-bindings');
      }
      function recordCurrent(query, method) {
        validate(query.sql, query.bindings);
        if (++observation.statements > statementLimit) currentReject(phaseName + ':statement-cap');
        const key = JSON.stringify([query.sql, query.bindings]);
        if (!sqlForms.has(key)) {
          sqlBytes += encoder.encode(key).length;
          if (sqlForms.size >= 4096 || sqlBytes > 32 * 1024 * 1024) currentReject('shared-sql-evidence-cap');
          sqlForms.set(key, { sql: query.sql, bindings: [...query.bindings] });
        }
        const entry = { step: phaseName, method, inserted: null, updated: null,
          form: [...sqlForms.keys()].indexOf(key), parameters: query.bindings.length };
        traceBytes += encoder.encode(JSON.stringify(entry)).length;
        if (trace.length >= 16384 || traceBytes > 2 * 1024 * 1024) currentReject('shared-trace-cap');
        trace.push(entry);
        observation.maxSqlBytes = Math.max(observation.maxSqlBytes, encoder.encode(query.sql).length);
        observation.maxBindingBytes = Math.max(observation.maxBindingBytes, encoder.encode(JSON.stringify(query.bindings)).length);
      }
      function dispatch(work) {
        checkActive();
        const value = work();
        const promise = Promise.resolve(value);
        pending.add(promise);
        promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
      }
      function statement(sql, bindings = []) {
        validate(sql, bindings);
        if (++observation.wrappers > statementLimit * 2) currentReject(phaseName + ':prepare-bind-cap');
        const actual = db.prepare(sql);
        const native = bindings.length ? actual.bind(...bindings) : actual;
        const item = Object.freeze({ native, sql, bindings: Object.freeze([...bindings]) });
        const wrapped = Object.freeze({
          bind(...values) { checkActive(); return statement(sql, values); },
          first(...args) {
            if (args.length > 1 || args.length && typeof args[0] !== 'string'
              || !readonlyCurrentSql(sql)) currentReject(phaseName + ':first');
            recordCurrent(item, 'first');
            return dispatch(() => Reflect.apply(native.first, native, args));
          },
          all(...args) {
            if (args.length || !readonlyCurrentSql(sql)) currentReject(phaseName + ':all');
            recordCurrent(item, 'all');
            return dispatch(() => Reflect.apply(native.all, native, []));
          },
          run() { return currentReject(phaseName + ':run'); },
          raw() { return currentReject(phaseName + ':raw'); },
        });
        originals.set(wrapped, item);
        return wrapped;
      }
      const database = Object.freeze({
        prepare(...args) { if (args.length !== 1) return currentReject(phaseName + ':prepare-arity'); return statement(args[0]); },
        batch(...args) {
          checkActive();
          const queries = args[0];
          if (args.length !== 1 || !Array.isArray(queries) || queries.length < 1 || queries.length > batchLimit)
            currentReject(phaseName + ':batch-shape');
          const selected = [];
          // Resolve/validate every member before any native dispatch. No array holes,
          // stale producer handles, raw native handles or partially executed prefix.
          for (let index = 0; index < queries.length; index++) {
            const slot = Object.getOwnPropertyDescriptor(queries, index);
            const item = slot && Object.hasOwn(slot, 'value') ? originals.get(slot.value) : null;
            if (!item) currentReject(phaseName + ':foreign-or-sparse-batch');
            validate(item.sql, item.bindings); selected.push(item);
          }
          if (observation.statements + selected.length > statementLimit) currentReject(phaseName + ':batch-statement-cap');
          for (const item of selected) recordCurrent(item, 'batch');
          observation.batches++; observation.maxBatch = Math.max(observation.maxBatch, selected.length);
          return dispatch(() => Reflect.apply(db.batch, db, [selected.map(item => item.native)]));
        },
        exec() { return currentReject(phaseName + ':exec'); },
        dump() { return currentReject(phaseName + ':dump'); },
        withSession() { return currentReject(phaseName + ':withSession'); },
      });
      return Object.freeze({ database, observation,
        seal() { active = false; },
        async settle() { await Promise.allSettled([...pending]); requireFact(pending.size === 0, 'current native DB settlement'); },
      });
    }

    currentController.abort();
    const portReceipts = [], portStates = new WeakMap();
    const actualDraftId = retainedLineage.saveLineage.draftId;
    const absentOutputId = expectedCurrent.outputId === 'object-ffffffff' ? 'object-eeeeeeee' : 'object-ffffffff';
    const absentDraftId = actualDraftId === 'experience-draft-' + 'f'.repeat(64) ? 'experience-draft-' + 'e'.repeat(64) : 'experience-draft-' + 'f'.repeat(64);
    requireFact(fixturePrincipal.userId === expectedCurrent.ownerId, 'actual setup principal equals genuine custody owner');
    const caps = Object.freeze({ origin: [8, 0], exclusion: [8, 0], media: [2179, 207], draft: [2190, 210], inputs: [2184, 209], current: [2186, 210] });
    const bodyCaps = Object.freeze({ media: 24_000_000, draft: 65_536, inputs: 524_288, refusal: 1024 });
    async function bounded(promise, milliseconds, label) {
      let timer;
      try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('native_ports_timeout:' + label)), milliseconds); })]); }
      finally { clearTimeout(timer); }
    }
    function freshPort(role, selected, mediaKey = expectedCurrent.key) {
      const portController = new AbortController();
      const path = role === 'draft' ? wire.GUEST_IMAGE_PERSONAL_PATHS.draft + selected
        : role === 'inputs' ? wire.GUEST_IMAGE_PERSONAL_PATHS.inputs + selected
          : role === 'media' || role === 'exclusion' ? '/api/media/' + encodeURIComponent(mediaKey)
            : '/api/generated-images/' + selected;
      const portRequest = new Request(currentOrigin + path, { method: 'GET', headers: { origin: currentOrigin,
        'oai-authenticated-user-id': fixturePrincipal.userId, 'oai-authenticated-user-email': fixturePrincipal.email }, signal: portController.signal });
      requireFact(portRequest.body === null && new URL(portRequest.url).search === '' && !portRequest.headers.has('cookie')
        && !portRequest.headers.has('authorization'), 'exact fresh original personal GET');
      return { request: portRequest, controller: portController };
    }
    function makePortStorage(name, allowed, mediaKey = expectedCurrent.key) {
      const calls = [], pending = new Set(); let active = true;
      function dispatch(kind, args) {
        if (!active || !allowed || pending.size || args.length !== 1 || args[0] !== mediaKey
          || (kind === 'get' ? calls.length !== 0 : calls.length !== 1 || calls[0] !== 'get')) currentReject(name + ':storage:' + kind);
        calls.push(kind); const promise = Promise.resolve(Reflect.apply(bucket[kind], bucket, args)); pending.add(promise);
        promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise;
      }
      return { calls, storage: Object.freeze({ get(...args) { return dispatch('get', args); }, head(...args) { return dispatch('head', args); },
        put() { return currentReject(name + ':storage:put'); }, delete() { return currentReject(name + ':storage:delete'); },
        list() { return currentReject(name + ':storage:list'); }, createMultipartUpload() { return currentReject(name + ':storage:multipart'); },
        resumeMultipartUpload() { return currentReject(name + ':storage:resume-multipart'); } }),
      seal() { active = false; }, async settle() { await Promise.allSettled([...pending]); requireFact(pending.size === 0, name + ':native storage settled'); } };
    }
    function responseHeaders(response, png = false, pngBytes = row.byte_length) {
      requireFact(response instanceof Response && wire.isGuestImagePersonalResponse(response), 'real marked supplier Response');
      same(response.headers.get('cache-control'), 'private, no-store', 'private noncacheable response');
      same(response.headers.get('x-content-type-options'), 'nosniff', 'response MIME protection');
      same(response.headers.get('vary'), 'Cookie, oai-authenticated-user-id, oai-authenticated-user-email', 'exact personal response variation');
      if (png) {
        same(response.status, 200, 'actual PNG response'); same(response.headers.get('content-type'), 'image/png', 'PNG MIME');
        same(response.headers.get('content-length'), String(pngBytes), 'genuine exact PNG length');
        same(response.headers.get('content-security-policy'), "default-src 'none'; sandbox", 'PNG response CSP');
      }
    }
    async function readBody(response, maximum, png = false, pngBytes = row.byte_length) {
      requireFact(response.body && !response.bodyUsed, 'one unread native Response body');
      const reader = response.body.getReader(), chunks = []; let total = 0, reads = 0, complete = false;
      const readLimit = png ? Math.ceil(pngBytes / 65_536) + 1 : 1025;
      try {
        for (;;) {
          requireFact(++reads <= readLimit, 'finite supplier response reads');
          const part = await bounded(reader.read(), 5000, 'response-body');
          if (part.done) { requireFact(part.value === undefined, 'actual body EOF'); complete = true; break; }
          requireFact(part.value instanceof Uint8Array && part.value.length > 0 && total + part.value.length <= maximum
            && (!png || part.value.length <= 65_536), 'bounded actual response chunk');
          chunks.push(part.value); total += part.value.length;
        }
        const joined = new Uint8Array(total); let offset = 0;
        for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
        return { bytes: joined, reads, chunks: chunks.length, maximumChunk: chunks.reduce((value, chunk) => Math.max(value, chunk.length), 0) };
      } finally { if (!complete) await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    }
    async function refusedResponse(response) {
      responseHeaders(response); same(response.status, 404, 'terminal supplier refusal');
      const body = await readBody(response, bodyCaps.refusal);
      same(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.bytes)), { status: 'refused', code: 'unavailable' }, 'closed refusal body');
      return { status: response.status, bytes: body.bytes.length };
    }
    async function portPhase(name, role, selected, work, expectedCalls = role === 'media' || role === 'current' ? ['get', 'head'] : [], selectedMedia = null) {
      const mediaKey = selectedMedia?.key ?? expectedCurrent.key, mediaBytes = selectedMedia?.byteLength ?? row.byte_length;
      const before = await fullCurrentState(), action = freshPort(role, selected, mediaKey);
      const facet = makePersonalDbFacet(role, name), storage = makePortStorage(name, role === 'media' || role === 'current', mediaKey);
      const state = { observation: facet.observation, mediaHandoff: null, mediaKey, mediaBytes }; portStates.set(action.request, state);
      const actionEnv = { ...env, DB: facet.database, MEDIA: storage.storage };
      let output, primary, failed = false; const cleanupErrors = [];
      try { output = await work(action, actionEnv); }
      catch (error) { failed = true; primary = error; }
      // Positive media is consumed inside work while its actual owner remains
      // live. Abort/seal only after work returns or its explicit cancellation.
      action.controller.abort(); facet.seal(); storage.seal();
      try { await facet.settle(); } catch (error) { cleanupErrors.push(error); }
      try { await storage.settle(); } catch (error) { cleanupErrors.push(error); }
      try { if (state.mediaHandoff) same({ statements: facet.observation.statements, batches: facet.observation.batches }, state.mediaHandoff, name + ':no native SQL after Response handoff'); }
      catch (error) { cleanupErrors.push(error); }
      try { same(await fullCurrentState(), before, name + ':every native app/scene rowid/scalar and catalog unchanged'); }
      catch (error) { cleanupErrors.push(error); }
      if (failed || cleanupErrors.length) {
        const diagnostic = { case: input.portCase, phase: name, database: facet.observation, storageCalls: storage.calls,
          denials: violations.slice(0, 8).map(value => String(value).slice(0, 256)), denialCount: violations.length,
          primary: failed ? String(primary).slice(0, 512) : null, cleanupErrors: cleanupErrors.map(value => String(value).slice(0, 256)),
          originalRequestRetired: action.request.signal.aborted };
        throw new AggregateError([...(failed ? [primary] : []), ...cleanupErrors], 'native port failure:' + JSON.stringify(diagnostic));
      }
      same(storage.calls, expectedCalls, name + ':exact native media calls'); same(violations, [], name + ':persistent denial ledger');
      const record = { name, role, database: facet.observation, mediaHandoff: state.mediaHandoff, storageCalls: storage.calls, output,
        unchangedStateSha256: await hash(encoder.encode(stable(before))), originalRequestRetired: action.request.signal.aborted };
      requireFact(encoder.encode(JSON.stringify(record)).length <= 600_000, 'one bounded port receipt');
      portReceipts.push(record); return output;
    }
    function assertNativeExclusion(result, selected, phaseName) {
      same(result.subjectId, fixturePrincipal.userId, 'actual negative-only owner');
      requireFact(result.exclusion && typeof result.exclusion.sql === 'string' && Array.isArray(result.exclusion.bindings), 'actual negative-only guard');
      requireFact(result.exclusion.sql.endsWith(') AND NOT EXISTS(SELECT 1 FROM experience_guest_image_result_custodies WHERE destination_user_id=? AND output_id=?)'), 'exact owned output absence fence');
      same(result.exclusion.bindings.slice(-2), [fixturePrincipal.userId, selected], 'actual principal and absent output selector fence');
      const last = trace.at(-1), form = [...sqlForms.values()][last?.form];
      requireFact(last && last.step === phaseName && last.method === 'all' && form, 'already observed terminal native proof');
      same(form.sql, 'SELECT 1 AS current WHERE ' + result.exclusion.sql, 'returned exclusion is the actually checked final predicate');
      same(form.bindings, result.exclusion.bindings, 'returned exclusion preserves every observed native proof binding');
    }
    async function origin(selected, expectedKind) {
      return portPhase('origin-' + expectedKind, 'origin', selected, async (action, actionEnv) => {
        const operation = custody.beginGuestImageResultOriginRead(action.request, actionEnv, { outputId: selected });
        try {
          const result = await bounded(operation.result, 5000, 'origin');
          requireFact(Object.isFrozen(result) && result.kind === expectedKind && result.statementCount > 0 && result.statementCount <= 8, 'actual origin selection');
          if (expectedKind === 'native') assertNativeExclusion(result, selected, 'origin-' + expectedKind);
          return { kind: result.kind, statementCount: result.statementCount };
        } finally { operation.retire(); }
      });
    }
    async function mediaResponse(action, actionEnv) {
      const state = portStates.get(action.request); requireFact(state && state.mediaHandoff === null, 'one observed media Response handoff');
      const response = await custody.readGuestImageResultMediaResponse(action.request, actionEnv, { mediaKey: state.mediaKey });
      responseHeaders(response, true, state.mediaBytes);
      state.mediaHandoff = { statements: state.observation.statements, batches: state.observation.batches };
      return response;
    }
    if (input.portCase === 'positive') {
      await origin(expectedCurrent.outputId, 'claimed'); await origin(absentOutputId, 'native');
      for (const [selected, expectedKind] of [[expectedCurrent.outputId, 'refused'], [absentOutputId, 'native']]) {
        await portPhase('native-media-' + expectedKind, 'exclusion', selected, async (action, actionEnv) => {
          const operation = custody.beginGuestImageResultNativeMediaExclusion(action.request, actionEnv,
            { outputId: selected, ownerId: fixturePrincipal.userId });
          try {
            const result = await bounded(operation.result, 5000, 'native-exclusion');
            requireFact(Object.isFrozen(result) && result.kind === expectedKind && result.statementCount > 0 && result.statementCount <= 8, 'actual native-media classification');
            if (result.kind === 'refused') await refusedResponse(result.response);
            else assertNativeExclusion(result, selected, 'native-media-' + expectedKind);
            return { kind: result.kind, statementCount: result.statementCount };
          } finally { operation.retire(); }
        });
      }
      await portPhase('original-media', 'media', expectedCurrent.outputId, async (action, actionEnv) => {
        const response = await mediaResponse(action, actionEnv), body = await readBody(response, bodyCaps.media, true);
        requireFact(body.bytes.length === row.byte_length && await hash(body.bytes) === row.content_sha256, 'actual streamed original PNG');
        return { status: 200, bytes: body.bytes.length, sha256: await hash(body.bytes), reads: body.reads, chunks: body.chunks, maximumChunk: body.maximumChunk };
      });
      for (const [selected, absent] of [[actualDraftId, false], [absentDraftId, true]]) {
        await portPhase(absent ? 'absent-draft' : 'original-draft', 'draft', selected, async (action, actionEnv) => {
          const response = await custody.readGuestImageResultDraftResponse(action.request, actionEnv, { draftId: selected });
          responseHeaders(response); same(response.status, 200, 'actual draft/absence response');
          const body = await readBody(response, bodyCaps.draft), value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.bytes));
          if (absent) same(value, { status: 'absent' }, 'proved exact absent draft');
          else {
            const view = wire.parseGuestImageResultDraftView(value); requireFact(view, 'actual closed draft parser');
            for (const key of ['ownerId', 'projectId', 'documentId', 'outputId', 'generationId']) same(view[key], expectedCurrent[key], 'draft same identity:' + key);
            same(view.draftId, actualDraftId, 'actual saved draft ID'); same(view.claim, originalClaim, 'actual draft completed claim');
            same(view.sourceEventId, expectedCurrent.claimEventId, 'actual canonical source event');
            same(view.title, originalClaimPayload.title, 'actual canonical output title');
            same(view.head, retainedLineage.canonical.sequence, 'draft preserves actual canonical stream head');
            same(view.revision, 0, 'original draft revision'); same(view.editEventId, null, 'no invented derivative');
            same(view.media.url, originalClaimPayload.media_url, 'actual original media URL'); same(view.media.sha256, row.content_sha256, 'actual original media digest');
            same(view.expiresAt, retainedLineage.canonical.expiresAt, 'actual original minimum canonical expiry');
          }
          return { status: 200, bytes: body.bytes.length, view: value };
        });
      }
      await portPhase('original-inputs', 'inputs', expectedCurrent.outputId, async (action, actionEnv) => {
        const response = await custody.readGuestImageResultInputsResponse(action.request, actionEnv, { outputId: expectedCurrent.outputId });
        responseHeaders(response); same(response.status, 200, 'actual Inputs response');
        const body = await readBody(response, bodyCaps.inputs), value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.bytes));
        const view = wire.parseGuestImageResultInputView(value); requireFact(view, 'actual closed Inputs parser');
        const promptCopy = retainedLineage.resultCopies.find(value => value.role === 'prompt');
        const actualPrompt = contents.find(value => value.content_id === promptCopy.content_id); requireFact(actualPrompt, 'genuine exact retained prompt copy');
        same(view.claim, originalClaim, 'Inputs actual claim'); same(view.submitted_prompt, actualPrompt.content, 'Inputs actual copied prompt');
        same(view.retained_input_status, 'available', 'actual readable prompt role');
        same(view.source_block_versions, originalClaimPayload.source_block_versions, 'actual original source block versions');
        same(view.output.object_id, expectedCurrent.outputId, 'Inputs same output'); same(view.output.generation_id, expectedCurrent.generationId, 'Inputs same generation');
        same(view.output.document_id, expectedCurrent.documentId, 'Inputs same Document');
        return { status: 200, bytes: body.bytes.length, view };
      });
      await portPhase('original-current-completion', 'current', expectedCurrent.outputId, async (action, actionEnv) => {
        const operation = custody.beginGuestImageResultCurrentSnapshot(action.request, actionEnv, { outputId: expectedCurrent.outputId });
        try {
          const completion = await operation.result; requireFact(completion && Object.isFrozen(completion), 'actual frozen current completion');
          same(Object.keys(completion).sort(), ['expiresAt', 'snapshot'], 'closed current completion');
          const result = completion.snapshot; requireFact(Object.isFrozen(result) && result.status === 'current', 'actual strict current snapshot');
          for (const key of ['ownerId', 'projectId', 'documentId', 'outputId', 'generationId']) same(result[key], expectedCurrent[key], 'current same identity:' + key);
          same(result.claim, originalClaim, 'current actual claim'); same(result.rawJson, originalPlan.content, 'actual strict original planner bytes');
          same(result.contentSha256, await hash(encoder.encode(originalPlan.content)), 'raw planner hash domain');
          same(result.head, retainedLineage.canonical.sequence, 'current preserves actual canonical stream head');
          same(result.revision, 0, 'current original revision'); same(result.editEventId, null, 'current no derivative');
          same(result.sourceIds, [], 'no fabricated local pair'); same(result.media.sha256, row.content_sha256, 'current actual PNG');
          same(completion.expiresAt, retainedLineage.canonical.expiresAt, 'copied actual minimum expiry');
          return { revision: result.revision, head: result.head, outputId: result.outputId, documentId: result.documentId,
            sha256: result.media.sha256, contentSha256: result.contentSha256, expiresAt: completion.expiresAt };
        } finally { operation.retire(); }
      });
      for (const item of portReceipts.filter(value => value.role === 'origin' || value.role === 'exclusion'))
        same(item.output.statementCount, item.database.statements, 'actual supplier count equals native dispatch count');
    } else if (input.portCase === 'cancellation') {
      for (const role of ['origin', 'current']) {
        await portPhase(role + '-immediate-retire', role, expectedCurrent.outputId, async (action, actionEnv) => {
          const operation = role === 'origin' ? custody.beginGuestImageResultOriginRead(action.request, actionEnv, { outputId: expectedCurrent.outputId })
            : custody.beginGuestImageResultCurrentSnapshot(action.request, actionEnv, { outputId: expectedCurrent.outputId });
          operation.retire(); const result = await bounded(operation.result, 5000, 'immediate-retire');
          if (role === 'current') same(result, null, 'retired current cannot disclose');
          else { same(result.kind, 'refused', 'retired origin refuses'); same(result.statementCount, 0, 'no origin native dispatch'); await refusedResponse(result.response); }
          return { retired: true, result: role === 'current' ? null : result.kind };
        }, []);
        same(portReceipts.at(-1).database.statements, 0, 'retire before queued native dispatch');
      }
      await portPhase('media-original-request-abort', 'media', expectedCurrent.outputId, async (action, actionEnv) => {
        const response = await mediaResponse(action, actionEnv); requireFact(!response.bodyUsed, 'response remains unread before original abort');
        const reader = response.body.getReader(), closed = reader.closed.then(() => 'closed', () => 'rejected'); let rejected = false;
        action.controller.abort();
        try {
          same(await bounded(closed, 5000, 'aborted-response-closed'), 'rejected', 'abort closes unread HWM0 stream before any pull');
          const settled = await bounded(reader.read().then(() => 'value', () => 'rejected'), 5000, 'aborted-response-read'); rejected = settled === 'rejected';
        } finally { reader.releaseLock(); }
        requireFact(rejected, 'original request abort rejects unconsumed native response');
        return { status: 200, aborted: true, proactivelyTerminated: true, emittedBytes: 0 };
      });
      await portPhase('media-consumer-cancel', 'media', expectedCurrent.outputId, async (action, actionEnv) => {
        const response = await mediaResponse(action, actionEnv); requireFact(!response.bodyUsed, 'response remains unread before consumer cancellation');
        await bounded(response.body.cancel('fixture-consumer-cancel'), 5000, 'response-cancel');
        const reader = response.body.getReader(); try { const value = await bounded(reader.read(), 5000, 'cancelled-response-read'); same(value.done, true, 'cancelled body ends'); same(value.value, undefined, 'cancelled body emits no bytes'); }
        finally { reader.releaseLock(); }
        return { status: 200, cancelled: true, emittedBytes: 0 };
      });
    } else if (input.portCase === 'successor') {
    const actionReceipts = [];
    const stageColumns = eventWrite.EVENT_WRITE_COLUMNS.split(',');
    const revisionColumns = ['revision_id', 'owner_id', 'organization_id', 'project_access_id', 'project_id', 'document_id',
      'artifact_id', 'revision', 'content_json', 'content_sha256', 'created_by_user_id', 'created_at', 'expires_at', 'redacted_at'];
    const stageSql = `INSERT INTO event_write_stage(${stageColumns.join(',')}) VALUES(${stageColumns.map(() => '?').join(',')})`;
    const revisionSql = `INSERT INTO artifact_revisions(${revisionColumns.join(',')}) VALUES(${revisionColumns.map(() => '?').join(',')})`;
    const adoptionPairSql = `SELECT e.*,p.owner_id private_owner,p.project_id private_project,p.document_id private_document,
        p.private_json,p.redacted_at private_redacted,p.created_at private_created_at
        FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id
        WHERE e.event_id IN (?,?) ORDER BY e.sequence`;
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
    const editedBytes = Uint8Array.from(atob(input.edited.base64), value => value.charCodeAt(0));
    requireFact(editedBytes.length > 0 && editedBytes.length <= 20 * 1024 * 1024
      && await hash(editedBytes) === input.edited.sha256 && input.edited.sha256 !== row.content_sha256,
    'bounded distinct synthetic editor PNG');
    function freshAction(method = 'GET', body, extraHeaders = {}, operation) {
      const actionController = new AbortController();
      const actionRequest = new Request(currentOrigin + '/api/generated-images/' + encodeURIComponent(expectedCurrent.outputId)
        + (operation ? '?operationSha256=' + operation : ''), { method, body,
        headers: { origin: currentOrigin, 'oai-authenticated-user-id': expectedCurrent.ownerId,
          'oai-authenticated-user-email': expectedCurrent.ownerId + '@example.invalid', ...extraHeaders }, signal: actionController.signal });
      requireFact(!actionRequest.signal.aborted && !actionRequest.headers.has('authorization') && !actionRequest.headers.has('cookie'),
        'fresh exact personal successor request');
      return { request: actionRequest, controller: actionController };
    }
    function makeWriterDbFacet(kind) {
      requireFact(kind === 'adopt' || kind === 'save', 'fixed writer phase');
      const phaseName = 'native-' + kind, originals = new WeakMap(), pending = new Set();
      const statementLimit = kind === 'adopt' ? 2397 : 4795, batchLimit = kind === 'adopt' ? 421 : 423;
      const observation = { phase: phaseName, statements: 0, wrappers: 0, batches: 0, publicationBatches: 0,
        maxBatch: 0, maxSqlBytes: 0, maxBindings: 0, maxBindingBytes: 0, activationBatches: 0 };
      const publications = [], nativeErrors = []; let active = true;
      const checkActive = () => { if (!active) currentReject(phaseName + ':stale-facet'); };
      const mutationKind = sql => sql === stageSql ? 'event_write_stage' : kind === 'save' && sql === revisionSql ? 'artifact_revisions' : null;
      function validate(sql, values, unbound = false) {
        checkActive();
        if (typeof sql !== 'string' || encoder.encode(sql).length > 100000 || !Array.isArray(values) || values.length > 100
          || values.some(value => value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))
          || encoder.encode(JSON.stringify(values)).length > 1048576 || !(readonlyCurrentSql(sql) || mutationKind(sql)))
          currentReject(phaseName + ':sql-or-bindings');
        if (!unbound && sql === stageSql && (values.length !== 17 || values[1] !== 'creative:' + expectedCurrent.ownerId
          || values[13] !== expectedCurrent.ownerId || values[14] !== expectedCurrent.projectId || values[15] !== expectedCurrent.documentId
          || typeof values[16] !== 'string' || !(kind === 'adopt' ? ['ReferenceIngested', 'BlockCreated'] : ['GeneratedImageEdited']).includes(values[11])))
          currentReject(phaseName + ':event-stage');
        if (!unbound && sql === revisionSql && (values.length !== 14 || values[1] !== expectedCurrent.ownerId || values[2] !== null
          || values[3] !== null || values[4] !== expectedCurrent.projectId || values[5] !== expectedCurrent.documentId
          || values[10] !== expectedCurrent.ownerId || values[13] !== null || ![0, 1].includes(values[7])))
          currentReject(phaseName + ':revision-row');
      }
      function recordWriter(item, method) {
        validate(item.sql, item.bindings);
        if (mutationKind(item.sql) && method !== 'batch') currentReject(phaseName + ':direct-write');
        if (++observation.statements > statementLimit) currentReject(phaseName + ':statement-cap');
        const key = JSON.stringify([item.sql, item.bindings]);
        if (!sqlForms.has(key)) {
          sqlBytes += encoder.encode(key).length;
          if (sqlForms.size >= 4096 || sqlBytes > 32 * 1024 * 1024) currentReject('shared-sql-evidence-cap');
          sqlForms.set(key, { sql: item.sql, bindings: [...item.bindings] });
        }
        const entry = { step: phaseName, method, inserted: mutationKind(item.sql), updated: null,
          form: [...sqlForms.keys()].indexOf(key), parameters: item.bindings.length };
        traceBytes += encoder.encode(JSON.stringify(entry)).length;
        if (trace.length >= 16384 || traceBytes > 2 * 1024 * 1024) currentReject('shared-trace-cap');
        trace.push(entry);
        observation.maxSqlBytes = Math.max(observation.maxSqlBytes, encoder.encode(item.sql).length);
        observation.maxBindings = Math.max(observation.maxBindings, item.bindings.length);
        observation.maxBindingBytes = Math.max(observation.maxBindingBytes, encoder.encode(JSON.stringify(item.bindings)).length);
      }
      function dispatch(work) {
        checkActive(); const dispatchedAtStatement = observation.statements;
        const promise = Promise.resolve(work()); pending.add(promise);
        promise.then(() => pending.delete(promise), error => {
          // Test-only bounded observation of an already rejected native promise.
          // Return that original promise unchanged; no retry or replacement ACK.
          let message; try { message = String(error).slice(0, 256); } catch { message = 'unprintable native database rejection'; }
          if (nativeErrors.length < 4) nativeErrors.push({ dispatchedAtStatement, message });
          pending.delete(promise);
        }); return promise;
      }
      function statement(sql, values = [], unbound = true) {
        validate(sql, values, unbound);
        if (++observation.wrappers > 2 * statementLimit) currentReject(phaseName + ':wrapper-cap');
        const actual = db.prepare(sql), native = values.length ? actual.bind(...values) : actual;
        const item = Object.freeze({ native, sql, bindings: Object.freeze([...values]) });
        const wrapped = Object.freeze({
          bind(...next) { checkActive(); return statement(sql, next, false); },
          first(...args) {
            if (args.length > 1 || args.length && typeof args[0] !== 'string' || !readonlyCurrentSql(sql)) currentReject(phaseName + ':first');
            recordWriter(item, 'first'); return dispatch(() => Reflect.apply(native.first, native, args));
          },
          all(...args) {
            if (args.length || !readonlyCurrentSql(sql)) currentReject(phaseName + ':all');
            recordWriter(item, 'all'); return dispatch(() => Reflect.apply(native.all, native, []));
          },
          run() { return currentReject(phaseName + ':run'); }, raw() { return currentReject(phaseName + ':raw'); },
        }); originals.set(wrapped, item); return wrapped;
      }
      const database = Object.freeze({
        prepare(...args) { if (args.length !== 1) return currentReject(phaseName + ':prepare-arity'); return statement(args[0]); },
        batch(...args) {
          checkActive(); const queries = args[0];
          if (args.length !== 1 || !Array.isArray(queries) || queries.length < 1 || queries.length > batchLimit) currentReject(phaseName + ':batch-shape');
          const selected = [];
          for (let index = 0; index < queries.length; index++) {
            const slot = Object.getOwnPropertyDescriptor(queries, index), item = slot && Object.hasOwn(slot, 'value') ? originals.get(slot.value) : null;
            if (!item) currentReject(phaseName + ':foreign-or-sparse-batch'); validate(item.sql, item.bindings); selected.push(item);
          }
          const writes = selected.filter(item => mutationKind(item.sql));
          if (writes.length) {
            if (++observation.publicationBatches !== 1) currentReject(phaseName + ':second-publication');
            const indices = selected.flatMap((item, index) => mutationKind(item.sql) ? [index] : []);
            const beforeProofs = selected.slice(0, indices[0]);
            const afterProofs = kind === 'adopt' ? selected.slice(indices.at(-1) + 1, -1) : selected.slice(indices.at(-1) + 1);
            const proofLimit = kind === 'adopt' ? 209 : 210;
            if (beforeProofs.length < 1 || beforeProofs.length > proofLimit || afterProofs.length < 1 || afterProofs.length > proofLimit
              || indices.some((index, position) => index !== indices[0] + position)
              || !beforeProofs.every(item => item.sql.startsWith('SELECT CASE WHEN '))
              || !afterProofs.every(item => item.sql.startsWith('SELECT CASE WHEN '))) currentReject(phaseName + ':publication-proofs');
            if (kind === 'adopt') {
              if (writes.length !== 2 || writes.some(item => item.sql !== stageSql)
                || writes[0].bindings[11] !== 'ReferenceIngested' || writes[1].bindings[11] !== 'BlockCreated'
                || selected.at(-1).sql !== adoptionPairSql || selected.at(-1).bindings.length !== 2
                || selected.at(-1).bindings[0] !== writes[0].bindings[0] || selected.at(-1).bindings[1] !== writes[1].bindings[0])
                currentReject(phaseName + ':adoption-batch');
            } else if (writes.length !== 3 || writes[0].sql !== stageSql || writes[0].bindings[11] !== 'GeneratedImageEdited'
              || writes.slice(1).some(item => item.sql !== revisionSql) || writes[1].bindings[7] !== 0 || writes[2].bindings[7] !== 1)
              currentReject(phaseName + ':first-save-batch');
            publications.push(writes.map(item => ({ sql: item.sql, bindings: [...item.bindings] })));
          }
          if (observation.statements + selected.length > statementLimit) currentReject(phaseName + ':batch-statement-cap');
          selected.forEach(item => recordWriter(item, 'batch'));
          observation.batches++; observation.maxBatch = Math.max(observation.maxBatch, selected.length);
          return dispatch(() => Reflect.apply(db.batch, db, [selected.map(item => item.native)]));
        },
        exec() { return currentReject(phaseName + ':exec'); }, dump() { return currentReject(phaseName + ':dump'); },
        withSession() { return currentReject(phaseName + ':withSession'); },
      });
      return { database, observation, publications, nativeErrors, seal() { active = false; },
        async settle() { await Promise.allSettled([...pending]); requireFact(pending.size === 0, phaseName + ':native DB settlement'); } };
    }
    const revisionMetadataKeys = ['ownerId', 'custodyId', 'outputId', 'generationId', 'claimEventId', 'lineageDigest', 'revisionId',
      'editEventId', 'revisionSha256', 'operationSha256', 'sha256', 'mimeType', 'model', 'source'];
    const revisionKeyPrefix = `guest-image-result-media-v1/${ownership.ownerMediaNamespace(expectedCurrent.ownerId)}/${originalClaim.custodyId}/${expectedCurrent.outputId}/revisions/`;
    let revisionKey, revisionPutReceipt, savedMetadata, operationSha256;
    function makeStorageFacet(name, isSave, key) {
      let active = true; const pending = new Set(), calls = [];
      const expected = isSave ? ['get', 'head', 'put', 'get', 'head', 'get', 'head'] : ['get', 'head'];
      function dispatch(kind, args) {
        try {
        if (!active || pending.size || expected[calls.length] !== kind) currentReject(name + ':storage-order');
        const expectedKey = isSave && calls.length >= 3 ? revisionKey : key;
        if (kind !== 'put' && (args.length !== 1 || args[0] !== expectedKey)) currentReject(name + ':storage-key');
        if (kind === 'put') {
          const [target, buffer, options] = args, metadata = options?.customMetadata;
          if (args.length !== 3 || typeof target !== 'string' || target !== revisionKeyPrefix + metadata?.revisionId + '.png'
            || !uuid.test(metadata?.revisionId) || !uuid.test(metadata?.editEventId) || !(buffer instanceof ArrayBuffer)
            || buffer.byteLength !== editedBytes.length || !options || !metadata) currentReject(name + ':put-shape');
          same(Object.keys(options).sort(), ['customMetadata', 'httpMetadata', 'onlyIf'], 'exact native revision PUT options');
          same(options.onlyIf, { etagDoesNotMatch: '*' }, 'native conditional absence PUT');
          same(options.httpMetadata, { contentType: 'image/png' }, 'native edited PNG content type');
          same(Object.keys(metadata).sort(), [...revisionMetadataKeys].sort(), 'all fourteen revision metadata keys');
          same({ ownerId: metadata.ownerId, custodyId: metadata.custodyId, outputId: metadata.outputId, generationId: metadata.generationId,
            claimEventId: metadata.claimEventId, lineageDigest: metadata.lineageDigest, sha256: metadata.sha256, operationSha256: metadata.operationSha256,
            mimeType: metadata.mimeType, model: metadata.model, source: metadata.source },
          { ownerId: expectedCurrent.ownerId, custodyId: originalClaim.custodyId, outputId: expectedCurrent.outputId,
            generationId: expectedCurrent.generationId, claimEventId: expectedCurrent.claimEventId, lineageDigest: originalClaim.lineageDigest,
            sha256: input.edited.sha256, operationSha256, mimeType: 'image/png', model: 'authored-composition', source: 'generated-image-editor' },
          'exact actual claim and intent metadata');
          requireFact(/^[a-f0-9]{64}$/u.test(metadata.revisionSha256), 'revision envelope digest grammar');
          same([...new Uint8Array(buffer)], [...editedBytes], 'actual supplied native PUT PNG bytes');
          revisionKey = target; savedMetadata = { ...metadata };
        }
        } catch (error) { violations.push(name + ':storage-validation:' + String(error)); throw error; }
        calls.push({ kind, key: args[0] });
        const promise = Promise.resolve(Reflect.apply(bucket[kind], bucket, args)); pending.add(promise);
        promise.then(value => {
          if (kind === 'put' && value) revisionPutReceipt = { key: value.key, version: value.version, etag: value.etag,
            size: value.size, customMetadata: value.customMetadata, httpMetadata: value.httpMetadata };
          pending.delete(promise);
        }, () => pending.delete(promise));
        // Return the actual native R2 object/body with original receiver identity.
        return promise;
      }
      const storage = Object.freeze({ get(...args) { return dispatch('get', args); }, head(...args) { return dispatch('head', args); },
        put(...args) { return dispatch('put', args); }, delete() { return currentReject(name + ':storage-delete'); },
        list() { return currentReject(name + ':storage-list'); }, createMultipartUpload() { return currentReject(name + ':storage-multipart'); },
        resumeMultipartUpload() { return currentReject(name + ':storage-resume-multipart'); } });
      return { storage, calls, seal() { active = false; }, async settle() { await Promise.allSettled([...pending]);
        requireFact(pending.size === 0, name + ':native storage settlement'); }, assertComplete() {
        same(calls.map(call => call.kind), expected, name + ':exact native media work');
      } };
    }
    async function runAction(name, action, databaseFacet, storageFacet, work) {
      let value, primaryError, failed = false; const cleanupErrors = [];
      try { value = await work({ ...env, DB: databaseFacet.database, MEDIA: storageFacet.storage }); }
      catch (error) { failed = true; primaryError = error; }
      action.controller.abort(); databaseFacet.seal(); storageFacet.seal();
      try { await databaseFacet.settle(); } catch (error) { cleanupErrors.push(error); }
      try { await storageFacet.settle(); } catch (error) { cleanupErrors.push(error); }
      if (failed || cleanupErrors.length) {
        // Failure-only test receipt, after ordinary teardown. No new native IO,
        // private rows, SQL bindings, request bodies or authority are disclosed.
        const forms = [...sqlForms.values()];
        const sqlTail = trace.filter(item => item.step === databaseFacet.observation.phase).slice(-8).map(item => {
          const sql = forms[item.form]?.sql ?? '';
          return { method: item.method, parameters: item.parameters,
            kind: item.inserted ?? (sql.startsWith('SELECT CASE WHEN ') ? 'proof' : 'read'),
            firstTable: /\b(?:FROM|JOIN)\s+([a-z_][a-z_0-9]*)\b/iu.exec(sql)?.[1]?.slice(0, 64) ?? null };
        });
        let primary; try { primary = failed ? String(primaryError).slice(0, 512) : null; } catch { primary = 'unprintable primary failure'; }
        const diagnostic = { name, primary, database: databaseFacet.observation, sqlTail,
          nativeDatabaseErrors: (databaseFacet.nativeErrors ?? []).slice(0, 4),
          storageCalls: storageFacet.calls.slice(0, 18).map(item => item.kind),
          violations: violations.slice(0, 8).map(value => String(value).slice(0, 256)), violationCount: violations.length,
          cleanupErrorCount: cleanupErrors.length, originalRequestRetired: action.request.signal.aborted };
        const errors = [...(failed ? [primaryError] : []), ...cleanupErrors];
        throw new AggregateError(errors, 'native action failure receipt:' + JSON.stringify(diagnostic));
      }
      storageFacet.assertComplete(); same(violations, [], name + ':no swallowed guard violation');
      actionReceipts.push({ name, database: databaseFacet.observation, storageCalls: storageFacet.calls, originalRequestRetired: action.request.signal.aborted });
      return value;
    }
    async function assertExactNewRows(before, after, table, newCount) {
      requireFact(after.rows[table].length === before.rows[table].length + newCount, table + ':exact new row count');
      same(after.rows[table].slice(0, before.rows[table].length), before.rows[table], table + ':all original rowids/scalars preserved');
    }
    async function assertPublishedDelta(before, after, facet, appended) {
      same(after.schema, before.schema, 'complete main catalog unchanged'); same(after.tempSchema, before.tempSchema, 'complete temp catalog unchanged');
      same(after.tables, before.tables, 'exact application table roster unchanged');
      same(after.protectedPlatformTables, before.protectedPlatformTables, 'native protected table catalogs unchanged');
      const writes = facet.publications[0]; requireFact(facet.publications.length === 1 && writes, 'one actual atomic publication');
      const staged = writes.filter(item => item.sql === stageSql), revisionWrites = writes.filter(item => item.sql === revisionSql);
      same(staged.map(item => item.bindings), appended.map(event => eventWrite.eventWriteBindings(event)), 'real ACK events equal actual native stage bindings');
      requireFact(staged.length === appended.length, 'exact acknowledged staged event count');
      const mutable = new Set(['events', 'event_private_payloads', 'scene_source_generations', ...(revisionWrites.length ? ['artifact_revisions'] : [])]);
      for (const table of before.tables) if (!mutable.has(table)) same(after.rows[table], before.rows[table], 'full immutable table:' + table);
      await assertExactNewRows(before, after, 'events', staged.length);
      await assertExactNewRows(before, after, 'event_private_payloads', staged.length);
      if (revisionWrites.length) await assertExactNewRows(before, after, 'artifact_revisions', revisionWrites.length);
      for (const stagedEvent of staged) {
        const values = stagedEvent.bindings;
        const publicRow = await db.prepare('SELECT * FROM events WHERE event_id=?').bind(values[0]).first();
        same(publicRow, Object.fromEntries(stageColumns.slice(0, 13).map((column, index) => [column, values[index]])), 'native event row exact thirteen cells');
        const privateRow = await db.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').bind(values[0]).first();
        same(privateRow, { private_event_id: values[0], owner_id: values[13], project_id: values[14], document_id: values[15],
          private_json: values[16], created_at: values[4], redacted_at: null }, 'native private envelope exact seven cells');
      }
      for (const write of revisionWrites) {
        const stored = await db.prepare('SELECT * FROM artifact_revisions WHERE revision_id=?').bind(write.bindings[0]).first();
        same(stored, Object.fromEntries(revisionColumns.map((column, index) => [column, write.bindings[index]])), 'native revision row exact fourteen cells');
        requireFact(stored.content_sha256 === await hash(encoder.encode(stored.content_json))
          && stored.created_at < stored.expires_at && stored.expires_at <= retainedLineage.canonical.expiresAt, 'actual revision hash and bounded retention');
      }
      const streamQuoted = "'" + ('creative:' + expectedCurrent.ownerId).replaceAll("'", "''") + "'";
      const prior = before.rows.scene_source_generations.find(value => value.c0 === "'stream'" && value.c1 === streamQuoted);
      const current = after.rows.scene_source_generations.find(value => value.c0 === "'stream'" && value.c1 === streamQuoted);
      requireFact(current && current.c2 === String((prior ? Number(prior.c2) : 0) + 2 * staged.length), 'actual scene generation follows both triggers per event');
      if (prior) same(current, { ...prior, c2: current.c2 }, 'scene stream rowid and other scalar cells preserved');
      else same(Object.keys(current).sort(), ['original_rowid', 'c0', 'c1', 'c2'].sort(), 'exact new stream generation shape');
      same(after.rows.scene_source_generations.filter(value => value !== current), before.rows.scene_source_generations.filter(value => value !== prior),
        'all other scene generation rows unchanged');
      same((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'successor native foreign keys');
    }
    const beforeAdoption = await fullCurrentState();
    const adoptionCommand = { operation: 'adopt-claimed-local-source', claim: originalClaim, expectedRevision: 0,
      expectedEditEventId: null, expectedMediaSha256: row.content_sha256 };
    const adoptAction = freshAction('POST', JSON.stringify(adoptionCommand), { 'content-type': 'application/json' });
    const adoptDb = makeWriterDbFacet('adopt'), adoptStorage = makeStorageFacet('adopt', false, expectedCurrent.key);
    const adoption = await runAction('adopt', adoptAction, adoptDb, adoptStorage, async actionEnv => {
      const response = await custody.adoptGuestImageResultLocalSource(adoptAction.request, actionEnv, { outputId: expectedCurrent.outputId });
      const body = await response.json(); requireFact(response.status === 200 && body.status === 'adopted', 'actual adoption ACK:' + JSON.stringify({ status: body.status, code: body.code })); return body;
    });
    same(adoption.appended.map(event => event.type), ['ReferenceIngested', 'BlockCreated'], 'genuine two-event local adoption');
    same(adoption.appended[0].payload.claim, originalClaim, 'adopted source retains exact completed claim');
    same(adoption.appended[0].payload.media_url, originalClaimPayload.media_url, 'adopted source is actual original PNG');
    same(adoption.referenceId, adoption.appended[0].payload.reference_id, 'adoption ACK matches actual receipt reference');
    same(adoption.referenceId, adoption.appended[1].payload.properties.reference_id, 'adoption ACK matches actual block reference');
    same(adoption.blockId, adoption.appended[1].payload.block_id, 'adoption ACK matches actual created block');
    requireFact(adoption.sourceId === adoption.blockId + ':image' && adoption.appended[0].sequence + 1 === adoption.appended[1].sequence
      && adoption.head === adoption.appended[1].sequence && adoption.appended[0].payload.source_revision === 0
      && adoption.appended[0].payload.source_edit_event_id === null, 'actual original local pair identities and sequence');
    const afterAdoption = await fullCurrentState(); await assertPublishedDelta(beforeAdoption, afterAdoption, adoptDb, adoption.appended);
    const readAction = freshAction(), readDb = makeCurrentDbFacet('native-current-before-save'), readStorage = makeStorageFacet('current-before-save', false, expectedCurrent.key);
    const current = await runAction('current-before-save', readAction, readDb, readStorage,
      actionEnv => custody.readGuestImageResultCurrentSnapshot(readAction.request, actionEnv, { outputId: expectedCurrent.outputId }));
    same(await fullCurrentState(), afterAdoption, 'fresh current before Save is fully read-only');
    requireFact(current && current.status === 'current' && current.revision === 0 && current.editEventId === null
      && Object.isFrozen(current) && Object.isFrozen(current.claim), 'genuine frozen original editor snapshot');
    for (const name of ['ownerId', 'projectId', 'documentId', 'outputId', 'generationId']) same(current[name], expectedCurrent[name], 'current same identity:' + name);
    same(current.claim, originalClaim, 'current genuine claim'); same(current.sourceEventId, expectedCurrent.claimEventId, 'canonical source event');
    same(current.contentRef, originalPlan.content_id, 'current retained planner reference'); same(current.rawJson, originalPlan.content, 'current exact planner bytes');
    same(current.contentSha256, await hash(encoder.encode(originalPlan.content)), 'current genuine raw planner digest');
    same(current.sourceIds, [adoption.sourceId], 'only actual newly adopted eligible source'); same(current.head, adoption.head, 'current actual adoption head');
    const source = current.sources.find(value => value.id === adoption.sourceId); requireFact(source && source.requiresUnlock !== true, 'genuine eligible local source');
    const recipe = composition.normalizeReferenceComposition(composition.addReferenceCompositionLayer(
      composition.createReferenceComposition('16:9'), source, 'native-fixture-layer'));
    requireFact(recipe, 'actual composition normalized');
    const editRequest = { expectedRevision: current.revision, expectedEditEventId: current.editEventId, expectedContentSha256: current.contentSha256,
      generationId: current.generationId, sourceEventId: current.sourceEventId, contentRef: current.contentRef,
      sourceMediaUrl: current.media.url, sourceMediaSha256: current.media.sha256, sourceId: adoption.sourceId, recipe,
      resultMediaSha256: input.edited.sha256, resultByteLength: editedBytes.length, schemaVersion: 2, claim: current.claim };
    const parsedRequest = revision.parseGuestImageResultEditRequest(editRequest); requireFact(parsedRequest, 'real schema2 request parser');
    operationSha256 = await hash(encoder.encode(JSON.stringify({ domain: 'guest-image-result-edit@1', ownerId: current.ownerId,
      projectId: current.projectId, documentId: current.documentId, outputId: current.outputId, request: parsedRequest })));
    same(await revision.guestImageResultEditOperationSha256({ ownerId: current.ownerId, projectId: current.projectId,
      documentId: current.documentId, outputId: current.outputId }, parsedRequest), operationSha256, 'actual operation hash agrees with exact domain bytes');
    const multipart = new FormData(); multipart.append('request', JSON.stringify(editRequest));
    multipart.append('png', new File([editedBytes], 'image.png', { type: 'image/png' }));
    const saveAction = freshAction('PATCH', multipart), saveDb = makeWriterDbFacet('save'), saveStorage = makeStorageFacet('save', true, expectedCurrent.key);
    const saved = await runAction('save', saveAction, saveDb, saveStorage, async actionEnv => {
      const response = await custody.handleGuestImageResultEdit(saveAction.request, actionEnv, { outputId: expectedCurrent.outputId });
      const body = await response.json(); requireFact(response.status === 200 && response.headers.get('cache-control') === 'no-store'
        && body.status === 'saved', 'actual Save ACK:' + JSON.stringify({ status: body.status, code: body.code })); return body;
    });
    requireFact(saved.stillCurrent === true && saved.currentRevision === 1 && saved.head === current.head + 1
      && saved.operationSha256 === operationSha256 && saved.appended.length === 1, 'actual first Save acknowledgment');
    const imageRevision = saved.imageRevision;
    requireFact(imageRevision.schemaVersion === 2 && imageRevision.revision === 1 && imageRevision.source.revision === 0
      && saved.currentEditEventId === imageRevision.editEventId && saved.appended[0].eventId === imageRevision.editEventId,
    'actual schema2 revision and edit event');
    same(imageRevision.claim, originalClaim, 'full exact claim retained'); same(imageRevision.source.eventId, expectedCurrent.claimEventId, 'original source event retained');
    same(imageRevision.source.mediaUrl, current.media.url, 'original source media retained'); same(imageRevision.source.sha256, current.media.sha256, 'original source hash retained');
    same(imageRevision.contentRef, current.contentRef, 'same retained planner'); same(imageRevision.contentSha256, current.contentSha256, 'actual raw planner digest retained');
    same(imageRevision.recipeSha256, await hash(encoder.encode(JSON.stringify(recipe))), 'canonical recipe hash');
    same(imageRevision.media.url, '/api/media/' + encodeURIComponent(revisionKey), 'same actual revision PNG key');
    const afterSave = await fullCurrentState(); await assertPublishedDelta(afterAdoption, afterSave, saveDb, saved.appended);
    const revisionWrites = saveDb.publications[0].filter(item => item.sql === revisionSql);
    const originalEnvelope = JSON.parse(revisionWrites[0].bindings[8]), editedEnvelope = JSON.parse(revisionWrites[1].bindings[8]);
    same(originalEnvelope.imageRevision, null, 'actual revision-zero retention row');
    same(editedEnvelope.imageRevision, imageRevision, 'actual row contains acknowledged full revision');
    same(editedEnvelope.request, parsedRequest, 'actual row contains complete canonical request');
    requireFact(savedMetadata.revisionId === revisionWrites[1].bindings[0] && savedMetadata.editEventId === imageRevision.editEventId
      && savedMetadata.revisionSha256 === revisionWrites[1].bindings[9] && revisionWrites[1].bindings[11] === saved.appended[0].recordedAt,
    'actual event, private row and PNG metadata bind same revision');
    requireFact(revisionPutReceipt && revisionPutReceipt.key === revisionKey && revisionPutReceipt.size === editedBytes.length, 'native conditional PUT acknowledged actual revision');
    same(revisionPutReceipt.customMetadata, savedMetadata, 'native PUT returns exact actual fourteen metadata');

    // Source-only fragment for the genuine native successor Worker. Place in its
    // lexical scope after fullCurrentState. Invoke only after real revision-1 Save
    // and after the preceding operation's Request/facets have retired and settled.
    // This fixed fixture facet is never exposed to an application operation.
    const bodyFaultReceipts = [];
    const copiedBodyFaultOrder = ['prompt', 'planner'];
    let copiedBodyFaultIndex = 0, copiedBodyFaultActive = false, copiedBodyFaultFailed = false;
    async function removeGenuineCopiedBody(role) {
      requireFact(!copiedBodyFaultActive && !copiedBodyFaultFailed
        && copiedBodyFaultIndex < copiedBodyFaultOrder.length
        && role === copiedBodyFaultOrder[copiedBodyFaultIndex], 'fixed prompt-then-planner fixture removal order');
      copiedBodyFaultActive = true; copiedBodyFaultIndex++;
      const name = 'fixture-remove-copied-' + role;
      try {
        const before = await fullCurrentState();
        const columns = (await db.prepare('PRAGMA table_info("private_content")').all()).results;
        same(columns.map(value => value.name),
          ['content_id', 'owner_id', 'kind', 'content', 'created_at', 'expires_at', 'redacted_at'],
          name + ':actual native seven-column snapshot order');
        const copies = retainedLineage.resultCopies.filter(value => value.role === role);
        requireFact(copies.length === 1, name + ':one genuine immutable result-copy role');
        const copy = copies[0];
        const associations = canonical.experience_guest_image_result_copies.filter(value => value.role === role
          && value.custody_id === retainedCustody.custody_id && value.content_id === copy.content_id);
        requireFact(associations.length === 1, name + ':one actually published association');
        same(associations[0], copy, name + ':actual association equals genuine lineage');
        const originals = contents.filter(value => value.content_id === copy.content_id && value.owner_id === expectedCurrent.ownerId);
        requireFact(originals.length === 1, name + ':one historical genuine copied body');
        const original = originals[0];
        const readSql = `SELECT CAST(rowid AS TEXT) AS original_rowid,
          content_id,owner_id,kind,content,created_at,expires_at,redacted_at
          FROM private_content WHERE content_id=? AND owner_id=?`;
        const observed = await db.prepare(readSql).bind(copy.content_id, expectedCurrent.ownerId).all();
        requireFact(observed && observed.success === true && observed.error === undefined
          && Array.isArray(observed.results) && observed.results.length === 1, name + ':one actual native row');
        const actual = observed.results[0];
        same(Object.keys(actual).sort(), ['original_rowid', 'content_id', 'owner_id', 'kind', 'content', 'created_at', 'expires_at', 'redacted_at'].sort(),
          name + ':closed observed row');
        requireFact(typeof actual.original_rowid === 'string' && /^-?[0-9]+$/u.test(actual.original_rowid), name + ':actual native rowid');
        for (const key of ['content_id', 'owner_id', 'kind', 'content', 'created_at', 'expires_at', 'redacted_at'])
          same(actual[key], original[key], name + ':unaltered genuine body field:' + key);
        requireFact(actual.content_id === copy.content_id && actual.owner_id === expectedCurrent.ownerId
          && actual.kind === 'guest-image-result-history' && actual.created_at === copy.created_at
          && actual.expires_at === copy.expires_at && actual.redacted_at === null
          && typeof actual.content === 'string' && actual.content.length > 0, name + ':exact live copied tuple');
        requireFact(encoder.encode(actual.content).length === copy.byte_length
          && 'sha256:' + await hash(encoder.encode(JSON.stringify(actual.content))) === copy.original_digest,
          name + ':original byte count and canonical JSON-string association digest');
        const beforeRows = before.rows.private_content;
        const matching = beforeRows.filter(value => value.original_rowid === actual.original_rowid);
        requireFact(matching.length === 1, name + ':one target in complete native snapshot');
        const target = matching[0];
        same(Object.keys(target).sort(), ['original_rowid', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'].sort(),
          name + ':closed native scalar snapshot');
        same(target.c6, 'NULL', name + ':snapshot is initially unredacted');
        const redactedAt = new Date().toISOString();
        requireFact(actual.created_at <= redactedAt && redactedAt < actual.expires_at
          && redactedAt < retainedLineage.canonical.expiresAt, name + ':real timestamp inside unchanged original retention');
        const updateSql = `UPDATE private_content SET content='',redacted_at=?
          WHERE content_id=? AND owner_id=? AND kind='guest-image-result-history'
            AND created_at=? AND expires_at=? AND redacted_at IS NULL`;
        const updateBindings = [redactedAt, actual.content_id, actual.owner_id, actual.created_at, actual.expires_at];
        // Exactly one fixed native mutation; no arbitrary SQL, retries, provider,
        // R2, schema, artifact, event, authority or association operation is exposed.
        const acknowledgement = await db.prepare(updateSql).bind(...updateBindings).run();
        requireFact(acknowledgement && acknowledgement.success === true && acknowledgement.error === undefined
          && acknowledgement.meta && acknowledgement.meta.changes === 1, name + ':native one-row UPDATE acknowledged');
        const after = await fullCurrentState();
        // c3/c6 are quote(content)/quote(redacted_at), proved by the exact PRAGMA
        // order above. Empty string is SQL ''; actual ISO timestamps contain no
        // quotes. Keep all other scalar strings and the original native prototype.
        const changed = Object.assign(Object.create(Object.getPrototypeOf(target)), target,
          { c3: "''", c6: "'" + redactedAt + "'" });
        const expectedPrivate = beforeRows.map(value => value === target ? changed : value);
        const expectedRows = Object.assign(Object.create(Object.getPrototypeOf(before.rows)), before.rows,
          { private_content: expectedPrivate });
        const expectedAfter = Object.assign(Object.create(Object.getPrototypeOf(before)), before, { rows: expectedRows });
        same(after, expectedAfter, name + ':only the actual copied row content and redacted_at changed');
        const receipt = { name, role, originalRowid: actual.original_rowid, contentId: actual.content_id,
          ownerId: actual.owner_id, redactedAt, changes: acknowledgement.meta.changes,
          originalDigest: copy.original_digest, originalBytes: copy.byte_length,
          changedFields: ['content', 'redacted_at'], beforeSha256: await hash(encoder.encode(stable(before))),
          afterSha256: await hash(encoder.encode(stable(after))) };
        bodyFaultReceipts.push(receipt); return receipt;
      } catch (error) {
        copiedBodyFaultFailed = true; throw error;
      } finally { copiedBodyFaultActive = false; }
    }


    // Actual first-Save publication above has already joined these two full
    // artifact rows to native stage bindings. This separate fixture read takes
    // expiry expectations from those native rows, never from a fabricated DTO.
    const retainedRevisions = (await db.prepare('SELECT revision_id,revision,expires_at FROM artifact_revisions WHERE revision_id IN (?,?) ORDER BY revision')
      .bind(revisionWrites[0].bindings[0], revisionWrites[1].bindings[0]).all()).results;
    requireFact(retainedRevisions.length === 2 && retainedRevisions[0].revision === 0 && retainedRevisions[1].revision === 1, 'actual complete first-Save retained revision pair');
    for (const [index, value] of retainedRevisions.entries()) same(value, { revision_id: revisionWrites[index].bindings[0], revision: index,
      expires_at: revisionWrites[index].bindings[12] }, 'native retained expiry equals actual committed row');
    const expectedExpiry = new Date(Math.min(Date.parse(originalClaimPayload.content_expires_at), ...retainedRevisions.map(value => Date.parse(value.expires_at)))).toISOString();
    const originalMedia = { key: expectedCurrent.key, byteLength: row.byte_length, sha256: row.content_sha256 };
    const derivativeMedia = { key: revisionKey, byteLength: imageRevision.media.byteLength, sha256: imageRevision.media.sha256 };
    requireFact(originalMedia.key !== derivativeMedia.key && originalMedia.sha256 !== derivativeMedia.sha256
      && derivativeMedia.sha256 === input.edited.sha256 && derivativeMedia.byteLength === editedBytes.length, 'genuine original and derivative are distinguishable');
    same(decodeURIComponent(imageRevision.media.url.slice('/api/media/'.length)), derivativeMedia.key, 'actual current revision URL selects native PUT key');
    same(await fullCurrentState(), afterSave, 'fixture expiry lookup preserves actual saved graph');
    function assertPersonalBodyLoads(phaseName, role, plannerAvailable = true) {
      const forms = [...sqlForms.values()];
      // These are the two direct body-returning projections in the frozen
      // collector. Whole-proof predicates may also mention private_content;
      // they remain native proof checks, not returned prompt/planner bodies.
      const loads = trace.filter(item => item.step === phaseName).map(item => forms[item.form]).filter(form =>
        /^\s*SELECT\s+(?:content|content_id,owner_id,kind,content,created_at,expires_at,redacted_at)\s+FROM\s+private_content\b/u.test(form.sql));
      const expectedRole = role === 'inputs' ? 'prompt' : role === 'current' ? 'planner' : null;
      same(loads.length, expectedRole ? 1 : 0, phaseName + ':exact source body-returning query count');
      if (expectedRole) {
        const copied = retainedLineage.resultCopies.find(value => value.role === expectedRole);
        requireFact(copied && loads[0].bindings[0] === copied.content_id && loads[0].bindings[1] === expectedCurrent.ownerId,
          phaseName + ':only exact copied role body is selected');
      }
      return { bodyQueryRole: expectedRole, bodyQueryCount: loads.length, plannerAvailable };
    }
    async function successorMedia(name, expected) {
      const output = await portPhase(name, 'media', expectedCurrent.outputId, async (action, actionEnv) => {
        const response = await mediaResponse(action, actionEnv), body = await readBody(response, bodyCaps.media, true, expected.byteLength);
        requireFact(body.bytes.length === expected.byteLength && await hash(body.bytes) === expected.sha256, name + ':actual selected original/derivative PNG');
        return { status: 200, bytes: body.bytes.length, sha256: await hash(body.bytes), reads: body.reads, chunks: body.chunks,
          maximumChunk: body.maximumChunk, key: expected.key };
      }, ['get', 'head'], expected);
      Object.assign(output, assertPersonalBodyLoads(name, 'media')); return output;
    }
    async function successorDraft(name) {
      const output = await portPhase(name, 'draft', actualDraftId, async (action, actionEnv) => {
        const response = await custody.readGuestImageResultDraftResponse(action.request, actionEnv, { draftId: actualDraftId });
        responseHeaders(response); same(response.status, 200, name + ':actual body-free draft');
        const body = await readBody(response, bodyCaps.draft), value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.bytes));
        const view = wire.parseGuestImageResultDraftView(value); requireFact(view, name + ':closed actual draft');
        for (const key of ['ownerId', 'projectId', 'documentId', 'outputId', 'generationId']) same(view[key], expectedCurrent[key], name + ':same identity:' + key);
        same(view.draftId, actualDraftId, name + ':same original SAVE draft'); same(view.claim, originalClaim, name + ':same completed claim');
        same(view.sourceEventId, expectedCurrent.claimEventId, name + ':same canonical source'); same(view.title, originalClaimPayload.title, name + ':same output title');
        same(view.revision, 1, name + ':actual current revision'); same(view.editEventId, imageRevision.editEventId, name + ':same saved edit event');
        same(view.head, saved.head, name + ':actual saved stream head'); same(view.media, imageRevision.media, name + ':actual derivative tuple');
        same(view.expiresAt, expectedExpiry, name + ':minimum canonical and both actual retained revision expiries');
        return { status: 200, bytes: body.bytes.length, view };
      });
      Object.assign(output, assertPersonalBodyLoads(name, 'draft')); return output;
    }
    async function successorCurrent(name, available) {
      const output = await portPhase(name, 'current', expectedCurrent.outputId, async (action, actionEnv) => {
        const operation = custody.beginGuestImageResultCurrentSnapshot(action.request, actionEnv, { outputId: expectedCurrent.outputId });
        try {
          const completion = await operation.result;
          if (!available) { same(completion, null, name + ':required planner absence refuses strict current'); return { result: null, plannerAvailable: false }; }
          requireFact(completion && Object.isFrozen(completion) && Object.isFrozen(completion.snapshot), name + ':real current completion');
          same(Object.keys(completion).sort(), ['expiresAt', 'snapshot'], name + ':closed completion');
          const view = completion.snapshot;
          for (const key of ['ownerId', 'projectId', 'documentId', 'outputId', 'generationId']) same(view[key], expectedCurrent[key], name + ':same identity:' + key);
          same(view.status, 'current', name + ':actual current'); same(view.claim, originalClaim, name + ':same completed claim');
          same(view.sourceEventId, expectedCurrent.claimEventId, name + ':same canonical source'); same(view.contentRef, originalPlan.content_id, name + ':same retained planner');
          same(view.rawJson, originalPlan.content, name + ':real retained planner bytes'); same(view.contentSha256, await hash(encoder.encode(originalPlan.content)), name + ':raw planner hash domain');
          same(view.revision, 1, name + ':actual revision'); same(view.editEventId, imageRevision.editEventId, name + ':same edit event');
          same(view.media, imageRevision.media, name + ':actual derivative'); same(view.head, saved.head, name + ':actual saved head');
          same(view.sourceIds, [], name + ':old original pair cannot act as a revised pair'); same(completion.expiresAt, expectedExpiry, name + ':actual minimum expiry');
          return { revision: view.revision, editEventId: view.editEventId, head: view.head, media: view.media,
            expiresAt: completion.expiresAt, plannerAvailable: true, contentSha256: view.contentSha256 };
        } finally { operation.retire(); }
      }, available ? ['get', 'head'] : [], derivativeMedia);
      Object.assign(output, assertPersonalBodyLoads(name, 'current', available)); return output;
    }
    async function successorInputs(name) {
      const output = await portPhase(name, 'inputs', expectedCurrent.outputId, async (action, actionEnv) => {
        const response = await custody.readGuestImageResultInputsResponse(action.request, actionEnv, { outputId: expectedCurrent.outputId });
        responseHeaders(response); same(response.status, 200, name + ':actual optional prompt disclosure');
        const body = await readBody(response, bodyCaps.inputs), value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.bytes));
        const view = wire.parseGuestImageResultInputView(value); requireFact(view, name + ':closed actual Inputs');
        same(view.claim, originalClaim, name + ':same completed claim'); same(view.submitted_prompt, null, name + ':no substituted prompt body');
        same(view.retained_input_status, 'unavailable', name + ':actual optional body absence'); same(view.source_block_versions, originalClaimPayload.source_block_versions, name + ':canonical source versions');
        same(view.output, { object_id: expectedCurrent.outputId, generation_id: expectedCurrent.generationId, document_id: expectedCurrent.documentId,
          quality: originalClaimPayload.quality, purpose: originalClaimPayload.purpose, prompt_technique: originalClaimPayload.prompt_technique,
          provider: originalClaimPayload.provider, model: originalClaimPayload.model_id, planner_model: originalClaimPayload.planner_model_id,
          source_surface: originalClaimPayload.source_surface }, name + ':exact original canonical input output fields');
        return { status: 200, bytes: body.bytes.length, view };
      });
      Object.assign(output, assertPersonalBodyLoads(name, 'inputs')); return output;
    }
    await successorMedia('saved-original-media', originalMedia);
    await successorMedia('saved-current-media', derivativeMedia);
    await successorDraft('saved-draft');
    await successorCurrent('saved-current-completion', true);
    await removeGenuineCopiedBody('prompt');
    await successorInputs('prompt-unavailable-inputs');
    await successorCurrent('prompt-unavailable-current', true);
    await removeGenuineCopiedBody('planner');
    await successorDraft('bodies-unavailable-draft');
    await successorMedia('bodies-unavailable-original-media', originalMedia);
    await successorMedia('bodies-unavailable-current-media', derivativeMedia);
    await successorInputs('bodies-unavailable-inputs');
    await successorCurrent('planner-unavailable-current', false);
    same(actionReceipts.map(value => value.name), ['adopt', 'current-before-save', 'save'], 'one necessary producer only; no Check or second edit');
    receipt.personalSuccessor = { producerActions: actionReceipts, adoption: { status: adoption.status, head: adoption.head, sourceId: adoption.sourceId },
      saved: { status: saved.status, head: saved.head, revision: saved.currentRevision, editEventId: imageRevision.editEventId },
      originalMedia, derivativeMedia, expectedExpiry, retainedRevisions, bodyFaults: bodyFaultReceipts,
      beforeAdoptionSha256: await hash(encoder.encode(stable(beforeAdoption))), afterAdoptionSha256: await hash(encoder.encode(stable(afterAdoption))),
      afterSaveSha256: await hash(encoder.encode(stable(afterSave))),
      attribution: 'direct derivative and body-role supplier evidence only; one genuine native adoption/Save setup; prompt then planner physical-body fixture faults; no Check replay or held route/client credit' };
    } else {
      await portPhase('media-original-deadline', 'media', expectedCurrent.outputId, async (action, actionEnv) => {
        const monotonicStart = performance.now(), wallStart = Date.now();
        const response = await mediaResponse(action, actionEnv); requireFact(!response.bodyUsed, 'native response unread before deadline');
        let closedMonotonicElapsed, closedWallElapsed;
        const reader = response.body.getReader(), closed = reader.closed.then(() => 'closed', () => {
          closedMonotonicElapsed = performance.now() - monotonicStart; closedWallElapsed = Date.now() - wallStart; return 'rejected';
        }); let rejected = false;
        let monotonicElapsed, wallElapsed;
        try {
          await new Promise(resolve => setTimeout(resolve, 31_500));
          monotonicElapsed = performance.now() - monotonicStart; wallElapsed = Date.now() - wallStart;
          requireFact(monotonicElapsed >= 30_000 && wallElapsed >= 30_000 && !action.request.signal.aborted, 'real original owner deadline elapsed without caller abort');
          requireFact(closedMonotonicElapsed >= 30_000 && closedWallElapsed >= 30_000
            && closedMonotonicElapsed <= monotonicElapsed && closedWallElapsed <= wallElapsed, 'actual unread-stream rejection occurs at the operation deadline before the observation');
          same(await bounded(closed, 5000, 'expired-response-closed'), 'rejected', 'deadline closes unread HWM0 stream before any pull');
          const settled = await bounded(reader.read().then(() => 'value', () => 'rejected'), 5000, 'expired-response-read'); rejected = settled === 'rejected';
        } finally { reader.releaseLock(); }
        requireFact(rejected, 'expired original owner rejects unread response');
        return { status: 200, expiredOperationDeadline: true, proactivelyTerminated: true, emittedBytes: 0, monotonicElapsed, wallElapsed, closedMonotonicElapsed, closedWallElapsed,
          retentionExpiryIsolated: false };
      });
    }
    same((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'native personal-port foreign keys');
    same(violations, [], 'final native port guard ledger');
    receipt.sqlForms = [...sqlForms.values()]; receipt.nativeBudgetObservation.scope = 'producer-before-personal-port-fixture-setup';
    receipt.ports = { case: input.portCase, setup: setupFacet.observation, sourceVersion: sceneVersionReceipt, actions: portReceipts,
      originalProducerRequestAborted: request.signal.aborted, protectedPlatformTables: afterEpoch.protectedPlatformTables,
      protectedPlatformData: 'native internal data unavailable; full catalog and every application/scene rowid/scalar compared',
      attribution: input.portCase === 'successor' ? 'direct derivative/body-role supplier ports; one native adoption/Save setup; explicit copied prompt/planner body faults; no Check/held API/route/client/provider/isolated-retention-expiry credit'
        : 'direct original-result supplier ports only; actual local Worker/D1/R2 and genuine same-Worker claim; no held API/route/client/provider/derivative/isolated-retention-expiry credit' };
    const response = JSON.stringify(receipt); requireFact(encoder.encode(response).length <= 36 * 1024 * 1024, 'bounded native port receipt');
    return new Response(response, { headers: { 'content-type': 'application/json' } });
  } };
}

const fixturePaths = [
  'tests/generated-image-claimed-personal-ports.test.mjs', 'worker/generated-image-claimed-personal-wire.ts',
  'worker/experience-guest-image-result-custody.ts',
  'tests/generated-image-claimed-current.test.mjs', 'tests/output-asset-fixtures.mjs', 'drizzle/0038_scene_source_generations.sql',
  'tests/experience-guest-image-result-claim-d1.test.mjs',
  'tests/experience-guest-image-result-copy-writer-d1-r2.test.mjs',
  'tests/experience-guest-image-result-copy-writer.test.mjs',
  'tests/helpers/guest-image-result-media-fixture.mjs', 'tests/helpers/guest-image-result-inventory-fixture.mjs',
  'tests/helpers/guest-image-run-fixture.mjs', 'tests/helpers/guest-image-admission-fixture.mjs',
  'tests/helpers/guest-image-issuer-fixture.mjs', 'tests/helpers/guest-image-stage-fixture.mjs',
  'tests/helpers/model3d-workerd-snapshot.mjs', 'tests/helpers/d1-expression-depth.mjs',
  'tests/output-execution-test-helpers.mjs', 'tests/output-server-test-helpers.mjs',
  'package.json', 'pnpm-lock.yaml',
];
async function pinFiles(paths) {
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await readFile(resolve(root, path)))])));
}

async function bundleWorker() {
  const repoRequire = createRequire(resolve(root, 'package.json'));
  const wranglerRequire = createRequire(repoRequire.resolve('wrangler'));
  const esbuildEntry = wranglerRequire.resolve('esbuild'), esbuild = wranglerRequire('esbuild');
  const sceneMigrationText = await readFile(resolve(nativeHarnessRoot,
    'drizzle/0038_scene_source_generations.sql'), 'utf8');
  const source = `import * as inventory from './worker/experience-guest-image-result-inventory.ts';\n`
    + `import * as core from './worker/experience-guest-image-result-claim-source.ts';\n`
    + `import * as media from './worker/experience-guest-image-result-media.ts';\n`
    + `import * as custody from './worker/experience-guest-image-result-custody.ts';\n`
    + `import * as principal from './worker/principal-request-core.ts';\n`
    + `import * as intakeAuthority from './worker/intake-authority.ts';\n`
    + `import * as sceneVersion from './worker/scene-source-generation.ts';\n`
    + `import { SCENE_SOURCE_EPOCH_ACTIVATE_SQL as sceneEpochActivateSql } from './db/scene-source-generations.ts';\n`
    + `import * as wire from './worker/generated-image-claimed-personal-wire.ts';\n`
    + `import * as composition from './src/model/reference-composition.ts';\n`
    + `import * as revision from './src/model/generated-image-revision.ts';\n`
    + `import * as eventWrite from './worker/event-write-primitives.ts';\n`
    + `import * as ownership from './src/model/media-ownership.ts';\n`
    + `export default (${nativeCurrentFixtureWorker.toString()})({inventory,core,media,custody,principal,intakeAuthority,sceneVersion,sceneEpochActivateSql,wire,composition,revision,eventWrite,ownership,sceneMigration:${JSON.stringify(sceneMigrationText)}});\n`;
  const dependencyRoot = await realpath(resolve(root, 'node_modules'));
  const inputs = new Map(); let totalBytes = 0;
  // Bounds admit one finite selected source closure; they are fixture tooling
  // bounds, not an application claim/source/accounting allowance. No package is
  // installed, stubbed, rewritten or imported by Node here. Only node:crypto
  // remains external, supplied natively by workerd's nodejs_compat flag.
  let result;
  try { result = await finite(esbuild.build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root,
    sourcefile: 'guest-image-personal-ports-native-fixture-entry.mjs', loader: 'js' }, bundle: true, write: false,
    platform: 'browser', format: 'esm', target: 'es2022', treeShaking: true, metafile: true, logLevel: 'silent',
    external: ['node:crypto'],
    plugins: [{ name: 'finite-unmodified-selected-closure', setup(build) {
      build.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, async args => {
        const path = await realpath(args.path), local = relative(root, path);
        const dependency = relative(dependencyRoot, path);
        const inRepository = ['worker' + sep, 'src' + sep, 'db' + sep].some(prefix => local.startsWith(prefix));
        const inDependencies = dependency !== '' && dependency !== '..' && !dependency.startsWith('..' + sep);
        assert.ok(inRepository || inDependencies, 'bundle input is a selected repo/dependency file: ' + local);
        const bytes = await readFile(path);
        if (!inputs.has(path)) {
          totalBytes += bytes.byteLength; assert.ok(inputs.size < 640 && totalBytes <= 16 * 1024 * 1024, 'selected source closure bound');
          inputs.set(path, { path, sha256: sha(bytes), bytes: bytes.byteLength });
        } else assert.equal(inputs.get(path).sha256, sha(bytes), 'input bytes stable during bundle');
        const extension = extname(path), loader = extension === '.json' ? 'json' : /tsx$/u.test(extension) ? 'tsx'
          : /ts$/u.test(extension) ? 'ts' : /jsx$/u.test(extension) ? 'jsx' : 'js';
        return { contents: bytes, loader, resolveDir: dirname(path) };
      });
    } }],
  }), 30000, 'selected-module-bundle');
  } finally { esbuild.stop(); }
  assert.equal(result.errors.length, 0); assert.equal(result.warnings.length, 0);
  assert.equal(result.outputFiles.length, 1); assert.ok(result.outputFiles[0].contents.byteLength <= 8 * 1024 * 1024);
  const nativeCryptoImport = item => item.external === true && item.path === 'node:crypto' && item.kind === 'import-statement';
  // These exact pinned declarations are erased types, verified independently
  // against their AST and emitted bundle. They are input metadata only; the
  // emitted Worker allowlist below still permits only native node:crypto.
  const inputOnlyTypes = [
    { importer: 'worker/generated-image-api.ts', path: '../src/model/events.ts', sha256: 'd3f7b4091fa2394243995cad4e7a11ea088afbafa402b299540ad3a767d3e4e6' },
    { importer: 'worker/output-scene-completion.ts', path: './output-scene-preflight-contract.ts', sha256: '3025254f97eb1b07750577b00673c61436fa814a9208493a8c13ba83e3f572bd' },
  ];
  const inputOnlyRecords = Object.entries(result.metafile.inputs).flatMap(([importer, value]) =>
    value.imports.filter(item => item.external && !nativeCryptoImport(item)).map(item => ({ importer, ...item })));
  assert.equal(inputOnlyRecords.length, inputOnlyTypes.length, 'exact erased-type input roster: ' + JSON.stringify(inputOnlyRecords.slice(0, 8)));
  for (const expected of inputOnlyTypes) {
    const matches = inputOnlyRecords.filter(item => item.importer === expected.importer && item.path === expected.path
      && item.kind === 'import-statement' && item.external === true);
    assert.equal(matches.length, 1, 'one exact reviewed erased-type input: ' + expected.importer + ': ' + JSON.stringify(inputOnlyRecords.slice(0, 8)));
    assert.equal(inputs.get(await realpath(resolve(root, expected.importer)))?.sha256, expected.sha256, 'erased-type source bytes unchanged');
  }
  assert.ok(Object.values(result.metafile.outputs).every(value => value.imports.every(nativeCryptoImport)), 'no unresolved arbitrary Worker import');
  const nativeExternalImports = Object.values(result.metafile.outputs).flatMap(value => value.imports);
  const sourceInputs = [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path));
  const receipt = { entrySha256: sha(source), outputSha256: sha(result.outputFiles[0].contents), outputBytes: result.outputFiles[0].contents.byteLength,
    sourceBytes: totalBytes, dependencyRoot, sourceInputs, nativeExternalImports, verifiedInputOnlyTypes: inputOnlyTypes, metafileSha256: sha(JSON.stringify(result.metafile)),
    esbuildEntry, esbuildEntrySha256: sha(await readFile(esbuildEntry)), esbuildVersion: esbuild.version };
  phase('selected-closure-bundle', receipt);
  return { script: result.outputFiles[0].text, receipt, sceneMigrationText, async assertUnchanged() {
    for (const input of sourceInputs) assert.equal(sha(await readFile(input.path)), input.sha256, 'bundle source stable: ' + input.path);
  } };
}

async function ownedRuntime(t, label, script, egress) {
  const repoRequire = createRequire(resolve(root, 'package.json'));
  const wranglerRequire = createRequire(repoRequire.resolve('wrangler')), entry = wranglerRequire.resolve('miniflare');
  const guard = installHostNetworkGuard(entry); let mf, constructionAttempted = false, cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    const failures = []; let disposed = !constructionAttempted;
    guard.setPhase('dispose');
    if (mf) {
      try { await finite(mf.dispose(), 10000, label + ':dispose'); disposed = true; }
      catch (error) { failures.push(error); }
    }
    phase('host-network-guard-final', { label, ...guard.snapshot(), constructionAttempted,
      runtimeHandleAcquired: !!mf, ownedRuntimeDisposed: disposed });
    try { guard.assertContained(); } catch (error) { failures.push(error); }
    try { assert.deepEqual(egress, [], 'caught Worker egress remains a fixture failure'); } catch (error) { failures.push(error); }
    if (disposed) {
      try { guard.restore(); phase('host-network-guard-restored', { label, restored: guard.snapshot().restored }); }
      catch (error) { failures.push(error); }
    } else phase('host-network-guard-retained', { label, reason: 'disposal unconfirmed; isolated runner must terminate owned process group; do not reuse process' });
    if (failures.length) throw new AggregateError(failures, 'owned direct Worker cleanup or containment failed');
  })();
  // Registered before guard probes, Miniflare loading and constructor dispatch.
  t.after(cleanup);
  phase('host-network-guard-ready', { label, ...guard.identity, ...await guard.verifyGuards() });
  const { Miniflare, Log, LogLevel } = wranglerRequire('miniflare');
  constructionAttempted = true;
  mf = new Miniflare({ cf: false, modules: true, script, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE), d1Databases: { DB: 'synthetic-copy-writer' },
    r2Buckets: ['MEDIA'], outboundService: request => {
      egress.push({ method: request.method, url: request.url }); throw Error('FORMA_WORKER_EGRESS_DENIED');
    } });
  return { mf, cleanup };
}

const nativeHarnessRoot = root;
const nativeCurrentPhase = phase, nativeCurrentFinite = finite;
const nativeCurrentPinFiles = pinFiles, nativeCurrentFixturePaths = fixturePaths;
const nativeCurrentFixtureWorker = fixtureWorker, nativeCurrentBundle = bundleWorker;
const nativeCurrentOwnedRuntime = ownedRuntime;

async function qualifyNativePersonalPorts(t, portCase) {
  const before = await nativeCurrentPinFiles(nativeCurrentFixturePaths);
  nativeCurrentPhase('source-bookend-before', { portCase, sourcePins: before });
  t.after(async () => {
    const after = await nativeCurrentPinFiles(nativeCurrentFixturePaths);
    nativeCurrentPhase('source-bookend-after', { portCase, sourcePins: after });
    assert.deepEqual(after, before, 'native port fixture dependencies remain fixed');
  });
  const bundle = await nativeCurrentBundle(); t.after(() => bundle.assertUnchanged());
  const f = await copyWriterFixture(t, { inventory: false });
  const exported = exportSynthetic(f.sqlite), edited = portCase === 'successor' ? png({ width: 1536, height: 864 }) : null;
  const payload = { mode: 'positive', portCase, snapshot: exported, proof: f.proof,
    request: { url: f.request.url, headers: [...f.request.headers] },
    source: { key: f.mediaOracle.key, sha256: f.mediaOracle.sha256, base64: Buffer.from(f.mediaOracle.bytes).toString('base64'),
      metadata: f.mediaOracle.metadata, httpMetadata: f.mediaOracle.httpMetadata },
    ...(edited ? { edited: { base64: Buffer.from(edited).toString('base64'), sha256: sha(edited) } } : {}) };
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 16 * 1024 * 1024);
  // Exact upstream synthetic producer, exported data and source PNG. The
  // successor additionally carries one local editor PNG; the Worker performs
  // its genuine adoption/Save setup before fresh private read operations.
  t.mock.reset();
  const egress = [], runtime = await nativeCurrentOwnedRuntime(t, portCase, bundle.script, egress);
  let result, primaryError, failed = false, cleanupError, cleanupFailed = false;
  try {
    const response = await nativeCurrentFinite(runtime.mf.dispatchFetch('http://fixture.invalid/qualify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }), 45000, portCase + ':dispatch');
    const body = await nativeCurrentFinite(response.text(), 5000, portCase + ':response');
    assert.equal(response.status, 200, body.slice(0, 2048)); assert.ok(Buffer.byteLength(body) <= 36 * 1024 * 1024);
    result = JSON.parse(body);
  } catch (error) { failed = true; primaryError = error; }
  try { await runtime.cleanup(); } catch (error) { cleanupFailed = true; cleanupError = error; }
  if (failed && cleanupFailed) throw new AggregateError([primaryError, cleanupError], 'native personal ports and owned runtime cleanup failed');
  if (failed) throw primaryError;
  if (cleanupFailed) throw cleanupError;
  // Qualify observed native SQL only after the runtime is fully disposed.
  const schema = exported.schema.filter(row => row.sql).sort((left, right) => {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    return rank[left.type] - rank[right.type] || left.name.localeCompare(right.name);
  }).map(row => row.sql);
  const sceneSql = bundle.sceneMigrationText.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean);
  const { createMediaSqlQualifier } = await import('./helpers/guest-image-result-media-fixture.mjs');
  const qualifier = await createMediaSqlQualifier([...schema, ...sceneSql]);
  for (const form of result.sqlForms) qualifier.qualify(form.sql, form.bindings);
  qualifier.assertVerified(); const sqlMetrics = qualifier.metrics();
  assert.ok(sqlMetrics.uniqueSql > 0 && sqlMetrics.maxBindings <= 100 && sqlMetrics.maxSqlBytes <= 100000);
  assert.equal(result.status, 'claimed'); assert.equal(result.row.state, 'published');
  assert.equal(result.sourceSha256, f.mediaOracle.sha256);
  assert.ok(result.unchangedTables.includes('output_native_storage_writes') && result.unchangedTables.includes('output_provider_calls'));
  const ports = result.ports;
  assert.equal(ports.case, portCase); assert.equal(ports.originalProducerRequestAborted, true);
  assert.equal(ports.setup.activationBatches, 1);
  const expectedNames = portCase === 'positive'
    ? ['origin-claimed', 'origin-native', 'native-media-refused', 'native-media-native', 'original-media', 'original-draft', 'absent-draft', 'original-inputs', 'original-current-completion']
    : portCase === 'cancellation'
      ? ['origin-immediate-retire', 'current-immediate-retire', 'media-original-request-abort', 'media-consumer-cancel']
      : portCase === 'successor' ? ['saved-original-media', 'saved-current-media', 'saved-draft', 'saved-current-completion',
        'prompt-unavailable-inputs', 'prompt-unavailable-current', 'bodies-unavailable-draft', 'bodies-unavailable-original-media',
        'bodies-unavailable-current-media', 'bodies-unavailable-inputs', 'planner-unavailable-current'] : ['media-original-deadline'];
  assert.deepEqual(ports.actions.map(value => value.name), expectedNames);
  const limits = { origin: [8, 0], exclusion: [8, 0], media: [2179, 207], draft: [2190, 210], inputs: [2184, 209], current: [2186, 210] };
  for (const action of ports.actions) {
    const retiredBeforeDispatch = action.name.endsWith('-immediate-retire'), [statementLimit, batchLimit] = limits[action.role];
    assert.equal(action.originalRequestRetired, true); assert.equal(action.database.activationBatches, 0);
    assert.match(action.unchangedStateSha256, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isInteger(action.database.statements) && action.database.statements <= statementLimit);
    if (retiredBeforeDispatch) assert.equal(action.database.statements, 0);
    else assert.ok(action.database.statements > 0);
    assert.ok(action.database.maxBatch <= batchLimit);
    if (action.role === 'media') assert.deepEqual(action.mediaHandoff, { statements: action.database.statements, batches: action.database.batches });
    else assert.equal(action.mediaHandoff, null);
    if (batchLimit === 0) assert.equal(action.database.batches, 0);
    assert.deepEqual(action.storageCalls, !retiredBeforeDispatch && action.name !== 'planner-unavailable-current' && ['media', 'current'].includes(action.role) ? ['get', 'head'] : []);
    if (action.output.statementCount !== undefined) assert.equal(action.output.statementCount, action.database.statements);
  }
  if (portCase !== 'successor') assert.equal(new Set(ports.actions.map(value => value.unchangedStateSha256)).size, 1, 'all direct roles preserve exactly the same genuine graph');
  if (portCase === 'positive') {
    const media = ports.actions.find(value => value.name === 'original-media').output;
    assert.equal(media.sha256, f.mediaOracle.sha256); assert.equal(media.bytes, f.mediaOracle.bytes.length);
    assert.ok(media.maximumChunk > 0 && media.maximumChunk <= 65536 && media.chunks > 0 && media.reads === media.chunks + 1);
    const current = ports.actions.find(value => value.name === 'original-current-completion').output;
    assert.equal(current.revision, 0); assert.equal(current.sha256, f.mediaOracle.sha256);
    assert.equal(ports.actions.find(value => value.name === 'origin-native').database.statements, 3);
    assert.equal(ports.actions.find(value => value.name === 'native-media-refused').database.statements, 2);
  } else if (portCase === 'cancellation') {
    assert.equal(ports.actions[0].output.retired, true); assert.equal(ports.actions[1].output.result, null);
    assert.equal(ports.actions[2].output.aborted, true); assert.equal(ports.actions[2].output.proactivelyTerminated, true); assert.equal(ports.actions[2].output.emittedBytes, 0);
    assert.equal(ports.actions[3].output.cancelled, true); assert.equal(ports.actions[3].output.emittedBytes, 0);
  } else if (portCase === 'successor') {
    const successor = result.personalSuccessor;
    assert.deepEqual(successor.producerActions.map(value => value.name), ['adopt', 'current-before-save', 'save']);
    for (const action of successor.producerActions) {
      const limits = action.name === 'adopt' ? [2397, 421] : action.name === 'save' ? [4795, 423] : [2186, 210];
      assert.equal(action.originalRequestRetired, true); assert.equal(action.database.activationBatches, 0);
      assert.ok(action.database.statements > 0 && action.database.statements <= limits[0] && action.database.maxBatch <= limits[1]);
      assert.deepEqual(action.storageCalls.map(value => value.kind), action.name === 'save' ? ['get', 'head', 'put', 'get', 'head', 'get', 'head'] : ['get', 'head']);
      if (action.name !== 'current-before-save') assert.equal(action.database.publicationBatches, 1);
    }
    assert.equal(successor.adoption.status, 'adopted'); assert.equal(successor.saved.status, 'saved'); assert.equal(successor.saved.revision, 1);
    assert.equal(successor.originalMedia.sha256, f.mediaOracle.sha256); assert.equal(successor.originalMedia.byteLength, f.mediaOracle.bytes.length);
    assert.equal(successor.derivativeMedia.sha256, sha(edited)); assert.equal(successor.derivativeMedia.byteLength, edited.length);
    assert.notEqual(successor.derivativeMedia.key, successor.originalMedia.key); assert.notEqual(successor.derivativeMedia.sha256, successor.originalMedia.sha256);
    assert.deepEqual(successor.retainedRevisions.map(value => value.revision), [0, 1]);
    const canonical = JSON.parse(result.canonical.experience_guest_image_result_custodies[0].lineage_json).canonical;
    assert.equal(successor.expectedExpiry, new Date(Math.min(Date.parse(canonical.expiresAt), ...successor.retainedRevisions.map(value => Date.parse(value.expires_at)))).toISOString());
    assert.deepEqual(successor.bodyFaults.map(value => value.role), ['prompt', 'planner']);
    assert.equal(successor.bodyFaults.length, 2);
    for (const fault of successor.bodyFaults) {
      assert.equal(fault.changes, 1); assert.deepEqual(fault.changedFields, ['content', 'redacted_at']);
      assert.notEqual(fault.beforeSha256, fault.afterSha256);
    }
    const groups = [ports.actions.slice(0, 4), ports.actions.slice(4, 6), ports.actions.slice(6)];
    assert.deepEqual(groups.map(value => value.length), [4, 2, 5]);
    for (const group of groups) assert.equal(new Set(group.map(value => value.unchangedStateSha256)).size, 1, 'one explicit unchanged read baseline per body-fault phase');
    assert.equal(groups[0][0].unchangedStateSha256, successor.afterSaveSha256);
    assert.equal(successor.bodyFaults[0].beforeSha256, successor.afterSaveSha256);
    assert.equal(groups[1][0].unchangedStateSha256, successor.bodyFaults[0].afterSha256);
    assert.equal(successor.bodyFaults[1].beforeSha256, successor.bodyFaults[0].afterSha256);
    assert.equal(groups[2][0].unchangedStateSha256, successor.bodyFaults[1].afterSha256);
    for (const action of ports.actions) {
      const output = action.output;
      if (action.role === 'media') {
        const media = action.name.includes('original-media') ? successor.originalMedia : successor.derivativeMedia;
        assert.equal(output.key, media.key); assert.equal(output.sha256, media.sha256); assert.equal(output.bytes, media.byteLength);
        assert.ok(output.chunks > 0 && output.maximumChunk <= 65536 && output.reads === output.chunks + 1);
      }
      if (action.role === 'draft') { assert.equal(output.view.revision, 1); assert.equal(output.view.expiresAt, successor.expectedExpiry); assert.equal(output.view.head, successor.saved.head); }
      if (action.role === 'inputs') { assert.equal(output.view.submitted_prompt, null); assert.equal(output.view.retained_input_status, 'unavailable'); }
      if (action.role === 'current' && action.name !== 'planner-unavailable-current') {
        assert.equal(output.revision, 1); assert.equal(output.head, successor.saved.head); assert.equal(output.expiresAt, successor.expectedExpiry);
      }
      const expectedRole = action.role === 'inputs' ? 'prompt' : action.role === 'current' ? 'planner' : null;
      assert.equal(output.bodyQueryRole, expectedRole); assert.equal(output.bodyQueryCount, expectedRole ? 1 : 0);
    }
    assert.equal(ports.actions.at(-1).output.result, null); assert.deepEqual(ports.actions.at(-1).storageCalls, []);
  } else {
    const outcome = ports.actions[0].output;
    assert.equal(outcome.expiredOperationDeadline, true); assert.equal(outcome.proactivelyTerminated, true); assert.equal(outcome.emittedBytes, 0);
    assert.ok(outcome.monotonicElapsed >= 30000 && outcome.wallElapsed >= 30000);
    assert.ok(outcome.closedMonotonicElapsed >= 30000 && outcome.closedMonotonicElapsed <= outcome.monotonicElapsed
      && outcome.closedWallElapsed >= 30000 && outcome.closedWallElapsed <= outcome.wallElapsed);
    assert.equal(outcome.retentionExpiryIsolated, false);
  }
  nativeCurrentPhase('native-personal-port-qualification-receipt', { portCase, ports, sqlMetrics,
    bundleSha256: bundle.receipt.outputSha256, sourcePins: before, sourceVersion: result.sourceVersion,
    ...(result.personalSuccessor ? { personalSuccessor: result.personalSuccessor } : {}),
    attribution: portCase === 'successor' ? 'genuine native current-derivative and copied-body-role supplier evidence; one real adoption/Save producer; no Check or held route/client/provider/isolated-retention-expiry acceptance'
      : 'genuine local Worker/D1/R2 claim and direct original-result supplier ports; zero external provider IO; no route, client, invoice, derivative or isolated-retention-expiry acceptance' });
  return result;
}

nativeTest('native claimed personal ports: original direct roles and absence', { timeout: 180000, concurrency: false }, async t => {
  await qualifyNativePersonalPorts(t, 'positive');
});
nativeTest('native claimed personal ports: immediate retirement and media abort cancellation', { timeout: 180000, concurrency: false }, async t => {
  await qualifyNativePersonalPorts(t, 'cancellation');
});
nativeTest('native claimed personal ports: unread media Response real operation deadline', { timeout: 180000, concurrency: false }, async t => {
  await qualifyNativePersonalPorts(t, 'deadline');
});
nativeTest('native claimed personal ports: saved derivative and unavailable copied bodies', { timeout: 180000, concurrency: false }, async t => {
  await qualifyNativePersonalPorts(t, 'successor');
});
}
