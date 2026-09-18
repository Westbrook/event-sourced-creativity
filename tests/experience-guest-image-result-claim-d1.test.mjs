import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { exportSynthetic } from './helpers/model3d-workerd-snapshot.mjs';

// SOURCE-AUTHORED QUALIFICATION, not a receipt. The direct-dispatch runtime and
// host guard and selected bundler use the reviewed writer13 successor fixture,
// SHA256 411605cf27f0a8586459f9afa8e3b4da93ff1103d174876df6634907f454d931.
// Exact source-only adaptation is retained under upstream-fixture-composition-01.
// Run only after final producer reconciliation and independent source/fixture
// review, starting with --test-name-pattern='positive:'. No remote service,
// provider, route, migration, invoice or deployment is qualified here.
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const phase = (name, detail = {}) => process.stderr.write(`[guest-result-claim-d1] ${JSON.stringify({
  phase: name, pid: process.pid, ppid: process.ppid, runnerPgid: process.env.FORMA_TEST_PGID ?? null, ...detail })}\n`);
const attemptTable = 'experience_guest_image_result_copy_attempts';
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
function fixtureWorker({ inventory, core, media }) {
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
    requireFact(['positive', 'claim-ack-lost', 'claim-rollback', 'foreign-null-envelope', 'foreign-lineage-alias', 'retained-positive', 'retained-cleanup-race'].includes(input.mode), 'fixed case');
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
    const response = JSON.stringify(receipt); requireFact(encoder.encode(response).length <= 36 * 1024 * 1024, 'fixture response bound');
    return new Response(response, { headers: { 'content-type': 'application/json' } });
  } };
}

const fixturePaths = [
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
  const source = `import * as inventory from './worker/experience-guest-image-result-inventory.ts';\n`
    + `import * as core from './worker/experience-guest-image-result-claim-source.ts';\n`
    + `import * as media from './worker/experience-guest-image-result-media.ts';\n`
    + `export default (${fixtureWorker.toString()})({inventory,core,media});\n`;
  const dependencyRoot = await realpath(resolve(root, 'node_modules'));
  const inputs = new Map(); let totalBytes = 0;
  // Bounds admit one finite selected source closure; they are fixture tooling
  // bounds, not an application claim/source/accounting allowance. No package is
  // installed, stubbed, rewritten or imported by Node here. Only node:crypto
  // remains external, supplied natively by workerd's nodejs_compat flag.
  let result;
  try { result = await finite(esbuild.build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root,
    sourcefile: 'atomic-claim-native-fixture-entry.mjs', loader: 'js' }, bundle: true, write: false,
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
  return { script: result.outputFiles[0].text, receipt, async assertUnchanged() {
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

async function qualify(t, mode) {
  const before = await pinFiles(fixturePaths);
  phase('source-bookend-before', { mode, sourcePins: before });
  t.after(async () => {
    const after = await pinFiles(fixturePaths); phase('source-bookend-after', { mode, sourcePins: after });
    assert.deepEqual(after, before, 'fixture/compiler dependency bytes remain fixed');
  });
  // Bundle before the genuine fixture creates expiring policy/source rows. This
  // does not renew the actual request, source, lease or writer deadline.
  const bundle = await bundleWorker(); t.after(() => bundle.assertUnchanged());
  const { copyWriterFixture } = await import('./experience-guest-image-result-copy-writer.test.mjs');
  const { createMediaSqlQualifier } = await import('./helpers/guest-image-result-media-fixture.mjs');
  const f = await copyWriterFixture(t, { inventory: false });
  const exported = exportSynthetic(f.sqlite);
  const payload = { mode, snapshot: exported, proof: f.proof, request: { url: f.request.url, headers: [...f.request.headers] },
    source: { key: f.mediaOracle.key, sha256: f.mediaOracle.sha256, base64: Buffer.from(f.mediaOracle.bytes).toString('base64'),
      metadata: f.mediaOracle.metadata, httpMetadata: f.mediaOracle.httpMetadata } };
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 16 * 1024 * 1024);
  // Restore all local fake-provider hooks before installing host containment.
  // No Node production capability is passed to or consulted by the Worker.
  t.mock.reset();
  const egress = [], runtime = await ownedRuntime(t, mode, bundle.script, egress);
  let result;
  try {
    const response = await finite(runtime.mf.dispatchFetch('http://fixture.invalid/qualify', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }), 45000, mode + ':dispatch');
    const body = await finite(response.text(), 5000, mode + ':response');
    assert.equal(response.status, 200, body.slice(0, 2048)); assert.ok(Buffer.byteLength(body) <= 36 * 1024 * 1024);
    result = JSON.parse(body);
  } finally { await runtime.cleanup(); }
  // Independently prepare every actual statement shape under strict D1 limits.
  // This runs after disposal, with no live Worker or broadened execution budget.
  const schema = exported.schema.filter(row => row.sql).sort((left, right) => {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    return rank[left.type] - rank[right.type] || left.name.localeCompare(right.name);
  }).map(row => row.sql);
  const qualifier = await createMediaSqlQualifier(schema);
  for (const form of result.sqlForms) qualifier.qualify(form.sql, form.bindings);
  qualifier.assertVerified(); const sqlMetrics = qualifier.metrics();
  assert.ok(sqlMetrics.uniqueSql > 0 && sqlMetrics.maxBindings <= 100 && sqlMetrics.maxSqlBytes <= 100000);
  assert.equal(result.sourceSha256, f.mediaOracle.sha256);
  assert.ok(result.unchangedTables.includes('output_native_storage_writes') && result.unchangedTables.includes('output_provider_calls'));
  phase('native-qualification-receipt', { mode, status: result.status, claimError: result.claimError,
    rowState: result.row.state, putOutcome: result.row.put_outcome, calls: result.calls,
    sourceVersion: result.sourceVersion, preservedRowsSha256: result.preservedRowsSha256,
    bundleSha256: bundle.receipt.outputSha256, sqlMetrics, finalBatchSize: result.finalBatchSize, nativeBudgetObservation: result.nativeBudgetObservation,
    injected: result.injected, rolledBack: result.rolledBack,
    attribution: 'genuine inventory, lease, bytes, writer and claim inside actual local D1/native R2; synthetic source production; fixture-only post-write faults explicitly named; no remote provider/invoice evidence' });
  return result;
}

const callCount = (result, kind) => result.calls.filter(row => row.kind === kind).length;
const options = { concurrency: false, timeout: 180000 };

test('positive: actual local D1 claim transfers the whole five-body graph and tombstones the guest atomically', options, async t => {
  const result = await qualify(t, 'positive');
  assert.equal(result.claimError, null); assert.equal(result.status, 'claimed'); assert.equal(result.row.state, 'published');
  assert.equal(result.row.put_outcome, 'success'); assert.ok(result.row.verified_at_ms >= result.row.put_settled_at_ms);
  assert.equal(result.readyReview.freshDestinationBytesVerified, true);
  assert.equal(result.readyReview.custodyTransferred, false); assert.equal(result.claimed.custodyTransferred, true);
  assert.equal(result.claimed.publicReadAvailable, false); assert.equal(result.claimed.replayed, false);
  assert.equal(result.claimed.completedReview.custodyId, result.row.custody_id);
  assert.equal(result.claimed.completedReview.lineageDigest, result.row.published_claim_digest);
  assert.equal(result.session.revoked_at_ms, result.row.published_at_ms);
  assert.equal(result.destination.sha256, result.sourceSha256); assert.equal(result.destination.size, result.row.byte_length);
  assert.deepEqual(result.destination.metadata, JSON.parse(result.row.destination_metadata_json));
  assert.equal(callCount(result, 'destination-put'), 1); assert.equal(callCount(result, 'destination-get'), 1);
  assert.equal(callCount(result, 'destination-head'), 2); assert.equal(callCount(result, 'destination-delete'), 0);
  assert.equal(result.injected, 0); assert.equal(result.replayRefused, true);
  assert.ok(result.finalBatchSize > 0 && result.finalBatchSize <= 511);
  const claim = result.trace.filter(row => row.step === 'claim');
  assert.equal(claim.filter(row => row.inserted === 'experience_guest_image_result_custodies').length, 1);
  assert.equal(claim.filter(row => row.updated === 'experience_guest_sessions').length, 1);
  assert.equal(claim.filter(row => row.updated === attemptTable).length, 1);
  assert.equal(result.contents.length, 5);
});

test('actual local D1 claim lost final batch ACK uses one complete winner inspection with no write retry', options, async t => {
  const result = await qualify(t, 'claim-ack-lost');
  assert.equal(result.injected, 1); assert.equal(result.status, 'claimed'); assert.equal(result.claimError, null);
  assert.equal(result.claimed.replayed, true); assert.equal(result.row.state, 'published');
  assert.equal(result.session.revoked_at_ms, result.row.published_at_ms);
  assert.equal(callCount(result, 'destination-put'), 1); assert.equal(callCount(result, 'destination-get'), 1);
  assert.equal(callCount(result, 'destination-head'), 2); assert.equal(callCount(result, 'destination-delete'), 0);
  assert.equal(result.destination.sha256, result.sourceSha256);
  assert.equal(result.trace.filter(row => row.inserted === 'experience_guest_image_result_custodies').length, 1);
});

for (const [mode, label] of [
  ['claim-rollback', 'final injected fault'],
  ['foreign-null-envelope', 'foreign envelope with NULL project and original document'],
  ['foreign-lineage-alias', 'cross-session typed lineage alias'],
]) test(`actual local D1 claim rolls back every canonical row and tombstone for ${label}`, options, async t => {
  const result = await qualify(t, mode);
  assert.equal(result.injected, 1); assert.equal(result.rolledBack, true); assert.equal(result.status, null);
  assert.notEqual(result.claimError, null); assert.deepEqual(result.row, result.readyRow);
  assert.equal(result.row.state, 'ready'); assert.equal(result.row.put_outcome, 'success');
  assert.equal(result.row.published_at_ms, null); assert.equal(result.session.revoked_at_ms, null);
  assert.equal(result.events.length, 0); assert.equal(result.contents.length, 0);
  for (const rows of Object.values(result.canonical)) assert.deepEqual(rows, []);
  assert.equal(callCount(result, 'destination-put'), 1); assert.equal(callCount(result, 'destination-get'), 1);
  assert.equal(callCount(result, 'destination-head'), 2); assert.equal(callCount(result, 'destination-delete'), 0);
  assert.equal(result.destination.sha256, result.sourceSha256); assert.equal(result.replayRefused, true);
});


test('positive: actual local D1 fresh request requalifies a saved ready PNG after original request abort without a second PUT', options, async t => {
  const result = await qualify(t, 'retained-positive');
  assert.equal(result.claimError, null); assert.equal(result.status, 'claimed'); assert.equal(result.row.state, 'published');
  assert.equal(result.claimed.custodyTransferred, true); assert.equal(result.claimed.replayed, false);
  assert.equal(result.destination.sha256, result.sourceSha256); assert.equal(result.contents.length, 5);
  assert.equal(callCount(result, 'destination-put'), 1); assert.equal(callCount(result, 'destination-get'), 2);
  assert.equal(callCount(result, 'destination-head'), 3); assert.equal(callCount(result, 'destination-delete'), 0);
  assert.equal(result.replayRefused, true); assert.equal(result.injected, 0);
  assert.ok(result.finalBatchSize > 0 && result.finalBatchSize <= 511);
});

test('actual local D1 fresh ready retry refuses an exact cleanup fence racing its destination read', options, async t => {
  const result = await qualify(t, 'retained-cleanup-race');
  assert.equal(result.status, null); assert.match(result.claimError, /guest_image_result_/u);
  assert.equal(result.row.state, 'cleanup_pending'); assert.equal(result.finalBatchSize, null);
  assert.equal(result.session.revoked_at_ms, null); assert.equal(result.events.length, 0); assert.equal(result.contents.length, 0);
  assert.equal(result.injected, 1); assert.equal(result.replayRefused, true);
  assert.equal(callCount(result, 'destination-put'), 1); assert.equal(callCount(result, 'destination-get'), 2);
  assert.equal(callCount(result, 'destination-delete'), 0);
});
