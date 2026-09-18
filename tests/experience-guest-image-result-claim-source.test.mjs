import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test as nativeTest } from 'node:test';
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises';
import { completedMediaFixture, createMediaInventory, installMediaReadGuards, knownPngOracle, deferred, sha,
  snapshot, request, rows, assertGuestImageResultInventoryCurrent, compileResultInventorySql } from './helpers/guest-image-result-media-fixture.mjs';
import { origin, insert, time, GUEST_DB_NOW } from './helpers/guest-image-stage-fixture.mjs';

// The accepted helper registers source resolution before these native modules
// load. Importing this file for its fixture never registers the native tests.
const [{ GUEST_CONTEXT_ADOPTION_SCHEMA }, { GUEST_PLAN_CUSTODY_SCHEMA },
  { GUEST_IMAGE_SAVE_CLAIM_SCHEMA }, { GUEST_IMAGE_STAGE_CUSTODY_SCHEMA },
  { GUEST_IMAGE_RESULT_COPY_SCHEMA }, { POLICY_VERSION },
  { guestImageResultInventoryData, inspectGuestImageResultInventory }, media] = await Promise.all([
  import('../worker/experience-guest-context-adoption.ts'),
  import('../worker/experience-guest-plan-custody.ts'),
  import('../worker/experience-guest-image-claim-inventory.ts'),
  import('../worker/experience-guest-image-stage-custody.ts'),
  import('../worker/experience-guest-image-result-copy-schema.ts'),
  import('../worker/policy-version.ts'),
  import('../worker/experience-guest-image-result-inventory.ts'),
  import('../worker/experience-guest-image-result-media.ts'),
]);

export const claimOwner = 'synthetic-result-claim-owner';
export const otherClaimOwner = 'synthetic-other-result-claim-owner';
export const claimRequest = (actor = claimOwner, extra = {}) => new Request(`${origin}/unregistered-result-claim`, {
  method: 'POST', headers: { origin,
    ...(actor ? { 'oai-authenticated-user-id': actor, 'oai-authenticated-user-email': `${actor}@example.invalid` } : {}), ...extra },
});

/** Every positive source, financial, event and storage row comes from the
 * accepted native completion fixture. These local extensions install dormant
 * DDL and personal test users only; no supplier helper is changed. D1 calls
 * inventory:false, transfers this actual graph into its isolated native DB,
 * and inspects it with this same f.request after replacing env.DB. */
export async function claimSourceFixture(t, { resultSchema = true, inventory = true, inventoryDeadline, ...options } = {}) {
  const f = await completedMediaFixture(t, { ...options, inventory: false });
  for (const sql of [...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_PLAN_CUSTODY_SCHEMA,
    ...GUEST_IMAGE_SAVE_CLAIM_SCHEMA, ...GUEST_IMAGE_STAGE_CUSTODY_SCHEMA,
    ...(resultSchema ? GUEST_IMAGE_RESULT_COPY_SCHEMA : [])]) f.sqlite.exec(sql);
  for (const actor of [claimOwner, otherClaimOwner]) insert(f, 'users', {
    user_id: actor, email: `${actor}@example.invalid`, display_name: actor, role: 'creator',
    consent_version: POLICY_VERSION, consented_at: time, created_at: time, updated_at: time,
  });
  const controller = new AbortController();
  f.request = new Request(claimRequest(), { signal: controller.signal });
  t.after(() => controller.abort());
  f.claimOwner = claimOwner; f.otherClaimOwner = otherClaimOwner;
  if (inventory) await createMediaInventory(f, f.request, inventoryDeadline);
  return f;
}

export const leaseTable = 'experience_guest_claim_leases';
export const attemptTable = 'experience_guest_image_result_copy_attempts';
const fixedInsert = /^\s*INSERT INTO (experience_guest_claim_leases|experience_guest_image_result_copy_attempts)\s*\(/u;
const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu;

/** The old read-only IO tripwires remain intact. Only this new test's DB guard
 * allows the exact two allocated inserts, and every caught violation remains
 * visible in cleanup. Postconditions compare all other tables and stored bytes. */
export function installClaimSourceGuards(f, t) {
  const io = installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
  const initial = snapshot(f), statements = [], violations = [], handles = new WeakMap();
  const prepare = f.DB.prepare, batch = f.DB.batch;
  const blockedDescriptors = new Map(['exec', 'dump'].map(method => [method, Object.getOwnPropertyDescriptor(f.DB, method)]));
  let closed = false, activeStatements = new Set();
  const forbidden = operation => { violations.push(operation); throw Error(`claim fixture blocked ${operation}`); };
  for (const method of blockedDescriptors.keys()) Object.defineProperty(f.DB, method,
    { configurable: true, writable: true, value: () => forbidden(`DB.${method}`) });
  function qualify(sql, bindings, method) {
    try {
      assert.equal(typeof sql, 'string'); assert.ok(Array.isArray(bindings));
      assert.ok(Buffer.byteLength(sql) <= 100000, 'actual SQL byte limit');
      assert.ok(bindings.length <= 100, 'actual binding limit');
      const inserted = fixedInsert.exec(sql)?.[1] ?? null;
      if (inserted) {
        assert.equal(method, 'batch', 'allocated writes happen only inside a native batch');
        assert.doesNotMatch(sql, /;|--|\/\*/u, 'one closed SQL statement');
        assert.equal([...sql.matchAll(new RegExp(mutation.source, 'giu'))].length, 1, 'one allocated mutation only');
      }
      else { assert.match(sql, /^\s*(?:SELECT|WITH)\b/iu); assert.doesNotMatch(sql, mutation, 'no hidden mutation'); }
      statements.push({ sql, bindings: [...bindings], method, inserted, sqlBytes: Buffer.byteLength(sql) });
    } catch (error) { violations.push(String(error)); throw error; }
  }
  function wrap(statement, sql, bindings = []) {
    const bind = statement.bind, execute = statement.execute;
    if (typeof execute === 'function') statement.execute = function (...args) {
      if (!activeStatements.has(this)) return forbidden('unobserved Statement.execute');
      return execute.apply(this, args);
    };
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql, values); };
    for (const method of ['first', 'all', 'run']) {
      const original = statement[method];
      if (typeof original === 'function') statement[method] = function (...args) {
        qualify(sql, bindings, method); const previous = activeStatements; activeStatements = new Set([this]);
        try { return original.apply(this, args); } finally { activeStatements = previous; }
      };
    }
    handles.set(statement, { sql, bindings }); return statement;
  }
  f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
  f.DB.batch = function (prepared) {
    for (const statement of prepared) {
      const record = handles.get(statement);
      if (!record) { violations.push('unobserved DB statement'); throw Error('unobserved DB statement'); }
      qualify(record.sql, record.bindings, 'batch');
    }
    const previous = activeStatements; activeStatements = new Set(prepared);
    try { return batch.call(this, prepared); } finally { activeStatements = previous; }
  };
  function assertPreserved(expected = initial) {
    assert.deepEqual(violations, [], 'caught errors cannot hide forbidden DB writes'); io.assertUntouched();
    const actual = snapshot(f); assert.deepEqual(actual.schema, expected.schema);
    for (const [table, values] of Object.entries(expected.contents))
      if (![leaseTable, attemptTable].includes(table)) assert.deepEqual(actual.contents[table], values, `${table} remains unchanged`);
  }
  const close = () => { if (closed) return; try { assert.deepEqual(violations, []); }
    finally { try { io.close(); } finally { f.DB.prepare = prepare; f.DB.batch = batch;
      for (const [method, descriptor] of blockedDescriptors) { if (descriptor) Object.defineProperty(f.DB, method, descriptor); else delete f.DB[method]; }
      closed = true; } } };
  t.after(() => { assert.deepEqual(violations, []); assert.equal(closed, true, 'claim guard explicitly closed'); });
  return { ...io, initial, statements, violations, assertPreserved, close,
    countInserts: table => statements.filter(row => row.inserted === table).length };
}

export { createMediaInventory, knownPngOracle, deferred, sha, snapshot, request, rows, GUEST_DB_NOW,
  guestImageResultInventoryData, inspectGuestImageResultInventory, assertGuestImageResultInventoryCurrent };

const directlyInvoked = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
const test = (name, fn) => nativeTest(name, { timeout: 30000 }, fn);
const refusal = error => { assert.match(String(error), /(?:guest_image_result_|guest_image_stage_inventory_lease_invalid|guest_image_output_retirement_unavailable|guest_custody_database_changed)/u); return true; };
const rejected = promise => assert.rejects(promise, refusal);

if (directlyInvoked) {
  const [api, operationApi] = await Promise.all([import('../worker/experience-guest-image-result-claim-source.ts'),
    import('../worker/experience-guest-image-result-media-operation.ts')]);
  const acquire = (f, overrides = {}) => api.acquireGuestImageResultClaimSource(f.request, f.env,
    { inventory: f.inventory, requestId: 'result-claim-request-1', ...overrides });
  const readLeased = (f, source) => media.readLeasedGuestImageResultMedia(f.request, f.env, source);
  const reserve = (f, observation) => media.reserveGuestImageResultMedia(f.request, f.env, observation);
  const opaque = token => { assert.ok(Object.isFrozen(token)); assert.deepEqual(Reflect.ownKeys(token), []); };
  const inertCopies = f => { for (const table of ['experience_guest_context_adoptions', 'experience_guest_image_claims',
    'experience_guest_plan_custodies', 'experience_guest_image_stage_custodies', 'experience_guest_image_stage_copies',
    'experience_guest_image_result_custodies', 'experience_guest_image_result_copies'])
    if (f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) assert.deepEqual(rows(f, table), [], table); };
  const financialTables = ['budget_reservations', 'cost_budget_reservations', 'experience_sponsor_consumptions',
    'experience_sponsor_grants', 'experience_sponsor_resource_receipts'];
  const financialSnapshot = f => Object.fromEntries(financialTables.map(table => [table, rows(f, table)]));
  function interceptBatch(f, table, action) {
    const batch = f.DB.batch; let calls = 0;
    f.DB.batch = async function (statements) {
      const relevant = statements.some(statement => fixedInsert.exec(statement.sql)?.[1] === table);
      const result = await batch.call(this, statements);
      if (relevant) { calls++; return action(result, statements); }
      return result;
    };
    return { get calls() { return calls; }, close() { f.DB.batch = batch; } };
  }
  function capturePngHash(t) {
    const original = crypto.subtle.digest.bind(crypto.subtle); let count = 0;
    t.mock.method(crypto.subtle, 'digest', (algorithm, input) => {
      const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) count++;
      return original(algorithm, input);
    });
    return () => count;
  }
  function observeOperation(t, operation, f, beforeConsumerSettlement) {
    const prototype = Object.getPrototypeOf(operation), originalCharge = prototype.charge,
      originalOwn = prototype.own, originalUse = prototype.use;
    const charges = new Map(), owned = [], uses = [];
    t.mock.method(prototype, 'charge', function (kind, count = 1) {
      if (this === operation) charges.set(kind, (charges.get(kind) ?? 0) + count);
      return originalCharge.call(this, kind, count);
    });
    t.mock.method(prototype, 'own', function (bytes) {
      const result = originalOwn.call(this, bytes); if (this === operation) owned.push(bytes); return result;
    });
    t.mock.method(prototype, 'use', function (bytes, work) {
      if (this !== operation) return originalUse.call(this, bytes, work);
      const use = { bytes, snapshot: bytes.slice(), settlement: null }; uses.push(use);
      return originalUse.call(this, bytes, () => { let pending = work();
        if (uses.length === 2 && beforeConsumerSettlement) pending = Promise.resolve(pending).then(async value => {
          await beforeConsumerSettlement(); return value;
        });
        use.settlement = Promise.resolve(pending).then(() => undefined, () => undefined); return pending; });
    });
    return { charges, owned, uses, assertOneCopy() {
      for (const kind of ['readAttempts', 'get', 'head', 'hash', 'inspection', 'consumeAttempts']) assert.equal(charges.get(kind), 1, kind);
      assert.equal(charges.get('ownedBytes'), 2 * f.mediaOracle.size); assert.equal(owned.length, 2); assert.equal(uses.length, 2);
      assert.notEqual(owned[0].buffer, owned[1].buffer); assert.equal(uses[0].bytes, owned[0]); assert.equal(uses[1].bytes, owned[1]);
      for (const use of uses) assert.deepEqual(use.snapshot, f.mediaOracle.bytes);
    } };
  }
  function assertReservedRow(f, manifest, manifestDigest, lease) {
    const attempts = rows(f, attemptTable); assert.equal(attempts.length, 1);
    const row = attempts[0], descriptor = JSON.parse(row.descriptor_json);
    assert.equal(row.state, 'reserved'); assert.equal(row.row_version, 0); assert.equal(row.put_outcome, 'pending');
    for (const column of ['put_started_at_ms', 'put_settled_at_ms', 'verified_at_ms', 'published_at_ms', 'published_claim_digest'])
      assert.equal(row[column], null, column);
    assert.deepEqual(descriptor.manifest, manifest); assert.equal(descriptor.manifestDigest, manifestDigest);
    assert.deepEqual(descriptor.leaseSnapshot, lease); assert.deepEqual(JSON.parse(row.lease_snapshot_json), lease);
    assert.equal(descriptor.destinationUserId, claimOwner); assert.equal(descriptor.requestId, lease.request_id);
    assert.equal(descriptor.source.byteLength, f.mediaOracle.size);
    assert.deepEqual(descriptor.source.producerMetadata, { model: f.completed.body.model_id, provider: f.completed.body.provider,
      adapter: f.completed.body.adapter_version, providerRequestId: f.completed.body.provider_request_id ?? '' });
    assert.equal(row.content_sha256, f.mediaOracle.sha256); assert.equal(row.byte_length, f.mediaOracle.size);
    assert.equal(row.source_expires_at_ms, Date.parse(manifest.expiresAt));
    assert.equal(row.updated_at_ms, row.created_at_ms); assert.equal(row.created_at_ms >= lease.created_at_ms, true);
    assert.equal(new Set([row.attempt_id, row.custody_id, row.writer_nonce, row.lease_id]).size, 4);
    assert.equal(row.destination_key, descriptor.destinationKey); assert.notEqual(row.destination_key, f.mediaOracle.key);
    assert.equal(row.descriptor_digest, `sha256:${sha(row.descriptor_json)}`);
    return row;
  }

  // First execution gate: genuine completed native graph, actual first lease,
  // original byte proof, then exactly one reserved-v0 insertion. No PUT/custody.
  test('positive genuine result first lease, byte proof and one reserved successor preserve all original custody and finance', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t), hashes = capturePngHash(t);
    const originalInventory = f.inventory, data = f.inventoryData, finance = financialSnapshot(f);
    try {
      const source = await acquire(f); opaque(source);
      const accounting = observeOperation(t, operationApi.guestImageResultLeasedMediaOperation(f.request, f.env, source), f);
      assert.throws(() => guestImageResultInventoryData(f.request, f.env, originalInventory), refusal);
      assert.equal(guard.countInserts(leaseTable), 1); assert.equal(guard.countInserts(attemptTable), 0);
      const leases = rows(f, leaseTable); assert.equal(leases.length, 1); const lease = Object.fromEntries(Object.entries(leases[0]));
      assert.equal(Object.keys(lease).length, 9); assert.equal(lease.session_id, f.session.sessionId);
      assert.equal(lease.destination_user_id, claimOwner); assert.equal(lease.manifest_digest, data.manifestDigest);
      assert.equal(lease.request_id, 'result-claim-request-1'); assert.equal(lease.request_ids_json, '["result-claim-request-1"]');
      assert.equal(lease.acquisitions, 1); assert.ok(lease.expires_at_ms > lease.created_at_ms);
      const observation = await readLeased(f, source); opaque(observation);
      const result = await reserve(f, observation); assert.equal(result.status, 'reserved'); opaque(result.reservation);
      const row = assertReservedRow(f, data.manifest, data.manifestDigest, lease);
      await api.assertGuestImageResultReservedCurrent(f.request, f.env, result.reservation);
      const review = api.guestImageResultReservedReview(f.request, f.env, result.reservation);
      assert.ok(Object.isFrozen(review));
      for (const secret of [f.session.sessionToken, f.session.claimToken, f.mediaOracle.key, row.descriptor_json])
        assert.equal(JSON.stringify(review).includes(secret), false);
      assert.deepEqual(guard.state.calls, ['get', 'head']); assert.equal(hashes(), 1, 'one actual PNG digest'); accounting.assertOneCopy();
      assert.equal(guard.countInserts(leaseTable), 1); assert.equal(guard.countInserts(attemptTable), 1);
      assert.deepEqual(financialSnapshot(f), finance); guard.assertPreserved(); inertCopies(f);
      await rejected(media.readGuestImageResultMedia(f.request, f.env, originalInventory));
      await rejected(readLeased(f, source)); await rejected(reserve(f, observation));
      assert.equal(guard.countInserts(attemptTable), 1); assert.deepEqual(guard.state.calls, ['get', 'head']);
    } finally { guard.close(); }
  });

  // Offline prepare-time diagnostic only. Replay the genuine read-only proof
  // once to capture emitted SQL, then compile those exact statements with the
  // unchanged accepted compiler. Compilation does not execute target SQL and
  // never changes a production limit or grants source/custody authority.
  nativeTest('diagnostic exact emitted inventory proofs preserve all five SQL limits', { timeout: 120000 }, async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    const phase = (name, detail = {}) => process.stderr.write(`[guest-result-claim-source-native] ${JSON.stringify({ phase: name,
      diagnostic: 'offline-inventory-proof-compiler', ...detail })}\n`);
    try {
      const rank = { table: 0, index: 1, view: 2, trigger: 3 };
      const schema = snapshot(f).schema.filter(row => row.sql && !row.name.startsWith('sqlite_'))
        .sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name)).map(row => row.sql);
      const schemaSha256 = sha(JSON.stringify(schema));
      await assertGuestImageResultInventoryCurrent(f.request, f.env, f.inventory);
      const emitted = guard.statements.filter(row => row.method === 'batch'), proofs = f.inventoryData.proof;
      assert.equal(emitted.length, proofs.length, 'one complete actual currentness proof batch captured');
      phase('inventory-proof-compiler-start', { schemaSha256, proofCount: emitted.length,
        limits: { expressionDepth: 100, functionArguments: 32, parameters: 100, sqlBytes: 100000, compoundSelects: 5 } });
      for (let index = 0; index < emitted.length; index++) {
        const statement = emitted[index], proof = proofs[index];
        assert.equal(statement.sql, `SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`, 'exact production-emitted SELECT wrapper');
        assert.deepEqual(statement.bindings, proof.bindings, 'exact production-emitted bindings retained privately');
        const detail = { proofIndexZeroBased: index, sqlSha256: sha(statement.sql), schemaSha256,
          sqlBytes: statement.sqlBytes, bindingCount: statement.bindings.length };
        let compiled;
        try { compiled = compileResultInventorySql(schema, statement.sql); }
        catch (error) {
          phase('inventory-proof-compiler-harness-failure', { ...detail, error: String(error), sql: statement.sql }); throw error;
        }
        if (!compiled.ok) phase('inventory-proof-five-limit-failure', { ...detail, compiler: compiled, sql: statement.sql });
        assert.equal(compiled.ok, true, `proof ${index} (${detail.sqlSha256}): ${compiled.error ?? 'compiler refused'}`);
        assert.equal(compiled.parameterCount, statement.bindings.length);
        assert.equal(compiled.statementBytes, statement.sqlBytes); assert.equal(compiled.compoundSelectLimit, 5);
      }
      phase('inventory-proof-compiler-complete', { schemaSha256, proofCount: emitted.length, passed: true });
    } finally { try { guard.assertPreserved(); } finally { guard.close(); } }
  });

  test('ordinary absent-result-family inventory and original-byte consumption remain accepted', async t => {
    const f = await claimSourceFixture(t, { resultSchema: false }), guard = installClaimSourceGuards(f, t); let copies = 0;
    try { const token = await media.readGuestImageResultMedia(f.request, f.env, f.inventory);
      const returned = await media.consumeGuestImageResultMedia(f.request, f.env, token, async bytes => {
        copies++; assert.deepEqual(bytes, f.mediaOracle.bytes); assert.equal(knownPngOracle(bytes).sha256, f.mediaOracle.sha256); return 'accepted';
      });
      assert.equal(returned, 'accepted'); assert.equal(copies, 1); assert.deepEqual(guard.state.calls, ['get', 'head']);
      assert.equal(guard.countInserts(leaseTable), 0); assert.equal(guard.countInserts(attemptTable), 0); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('an existing session lease row still invalidates the old ordinary no-lease proof', async t => {
    const f = await claimSourceFixture(t, { resultSchema: false }), guard = installClaimSourceGuards(f, t);
    try { const now = f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
      f.sqlite.prepare('INSERT INTO experience_guest_claim_leases VALUES(?,?,?,?,?,?,?,?,?)').run(f.session.sessionId,
        crypto.randomUUID(), claimOwner, f.inventoryData.manifestDigest, 'prior-request', '["prior-request"]', 1, now, now + 30000);
      await rejected(assertGuestImageResultInventoryCurrent(f.request, f.env, f.inventory));
      await rejected(media.readGuestImageResultMedia(f.request, f.env, f.inventory)); assert.deepEqual(guard.state.calls, []); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('forged, cloned and proxy inventories cannot seed a claim or retire the genuine inventory', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    try { for (const inventory of [{}, structuredClone(f.inventory), Object.create(f.inventory), new Proxy(f.inventory, {})])
        await rejected(acquire(f, { inventory }));
      assert.equal(guard.countInserts(leaseTable), 0); const source = await acquire(f); opaque(source);
      assert.equal(guard.countInserts(leaseTable), 1); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('foreign Request and environment refusals do not retire another owner before handoff', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    try { for (const [req, env] of [[claimRequest(), f.env], [f.request, { ...f.env }]])
        await rejected(api.acquireGuestImageResultClaimSource(req, env, { inventory: f.inventory, requestId: 'result-claim-request-1' }));
      assert.equal(guard.countInserts(leaseTable), 0); opaque(await acquire(f)); assert.equal(guard.countInserts(leaseTable), 1); guard.assertPreserved();
    } finally { guard.close(); }
  });

  for (const boundary of ['anonymous', 'project-cookie', 'impersonation-cookie', 'leading-space-project-cookie', 'space-before-equals-impersonation-cookie', 'nonconsenting-owner'])
    test(`first lease requires a personal consenting principal: ${boundary}`, async t => {
      const f = await claimSourceFixture(t, { inventory: false });
      if (boundary === 'anonymous') f.request = claimRequest(null);
      else if (boundary !== 'nonconsenting-owner') f.request = claimRequest(claimOwner,
        { cookie: { 'project-cookie': 'forma_project_context=', 'impersonation-cookie': 'forma_impersonation=',
          'leading-space-project-cookie': ' forma_project_context=', 'space-before-equals-impersonation-cookie': 'forma_impersonation =' }[boundary] });
      else f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(claimOwner);
      await createMediaInventory(f); const guard = installClaimSourceGuards(f, t);
      try { await rejected(acquire(f)); assert.equal(guard.countInserts(leaseTable), 0); assert.deepEqual(guard.state.calls, []); guard.assertPreserved(); }
      finally { guard.close(); }
    });

  test('reserved guest credential prefixes cannot become request IDs or consume the genuine inventory', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    try { for (const requestId of ['forma-guest-session-v1.synthetic', 'forma-guest-claim-v1.synthetic'])
        await rejected(acquire(f, { requestId }));
      assert.equal(guard.countInserts(leaseTable), 0); opaque(await acquire(f));
      assert.equal(guard.countInserts(leaseTable), 1); assert.deepEqual(guard.state.calls, []); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('claim seed handoff is one-shot and cannot reset the first lease allowance', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    try { opaque(await acquire(f)); await rejected(acquire(f));
      assert.equal(guard.countInserts(leaseTable), 1); assert.equal(guard.countInserts(attemptTable), 0); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('ordinary media admission wins atomically against a later claim handoff', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    try { const observation = await media.readGuestImageResultMedia(f.request, f.env, f.inventory);
      await rejected(acquire(f)); assert.equal(guard.countInserts(leaseTable), 0);
      await media.consumeGuestImageResultMedia(f.request, f.env, observation, async bytes => assert.deepEqual(bytes, f.mediaOracle.bytes));
      assert.deepEqual(guard.state.calls, ['get', 'head']); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('a lost first-lease acknowledgement recovers only the one exact persisted row', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t), hook = interceptBatch(f, leaseTable, () => { throw Error('synthetic lost lease ACK'); });
    try { opaque(await acquire(f)); assert.equal(hook.calls, 1); assert.equal(rows(f, leaseTable).length, 1);
      assert.equal(guard.countInserts(leaseTable), 1); assert.equal(guard.countInserts(attemptTable), 0);
      assert.deepEqual(guard.state.calls, []); guard.assertPreserved();
    } finally { hook.close(); guard.close(); }
  });

  test('a lost reserve acknowledgement yields only a nondispatching recovery observation', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t); let hook;
    try { const source = await acquire(f), observation = await readLeased(f, source);
      hook = interceptBatch(f, attemptTable, () => { throw Error('synthetic lost reserve ACK'); });
      const result = await reserve(f, observation); assert.equal(result.status, 'reservation-unknown');
      assert.equal(Object.hasOwn(result, 'reservation'), false); assert.ok(Object.isFrozen(result.recovery));
      assert.throws(() => api.guestImageResultReservedReview(f.request, f.env, result.recovery), refusal);
      assert.equal(hook.calls, 1); assert.equal(rows(f, attemptTable).length, 1); assert.equal(guard.countInserts(attemptTable), 1);
      await rejected(reserve(f, observation)); assert.deepEqual(guard.state.calls, ['get', 'head']); guard.assertPreserved(); inertCopies(f);
    } finally { hook?.close(); guard.close(); }
  });

  for (const [column, changed] of Object.entries({
    session_id: () => crypto.randomUUID(), lease_id: () => crypto.randomUUID(), destination_user_id: () => otherClaimOwner,
    manifest_digest: () => `sha256:${'a'.repeat(64)}`, request_id: () => 'foreign-request',
    request_ids_json: () => '["foreign-request"]', acquisitions: value => value + 1,
    created_at_ms: value => value - 1, expires_at_ms: value => value - 1,
  })) test(`first lease cannot mint a source from a readback with changed ${column}`, async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t), prepare = f.DB.prepare; let hits = 0;
    function wrap(statement, sql) {
      const bind = statement.bind, first = statement.first;
      statement.bind = function (...values) { return wrap(bind.apply(this, values), sql); };
      statement.first = async function (...args) { const result = await first.apply(this, args);
        if (/FROM experience_guest_claim_leases/u.test(sql) && result && Object.hasOwn(result, 'lease_id')) {
          hits++; return { ...result, [column]: changed(result[column]) };
        }
        return result;
      }; return statement;
    }
    f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
    try { await rejected(acquire(f)); assert.ok(hits > 0, 'actual complete lease readback reached');
      assert.equal(guard.countInserts(leaseTable), 1); assert.equal(guard.countInserts(attemptTable), 0);
      assert.deepEqual(guard.state.calls, []); guard.assertPreserved();
    } finally { f.DB.prepare = prepare; guard.close(); }
  });

  test('late private-body redaction after HEAD blocks observation and reserve', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t); let expected;
    try { const source = await acquire(f);
      guard.state.beforeHead = () => { f.sqlite.prepare('UPDATE private_content SET content=?,redacted_at=? WHERE content_id=?')
        .run('', '2000-01-01T00:00:00.000Z', f.completed.body.output_ref); expected = snapshot(f); };
      await rejected(readLeased(f, source)); assert.ok(expected); assert.deepEqual(guard.state.calls, ['get', 'head']);
      assert.equal(guard.countInserts(attemptTable), 0); guard.assertPreserved(expected);
    } finally { guard.close(); }
  });

  test('changed private content between observation and reserve cannot create a copy attempt', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    try { const source = await acquire(f), observation = await readLeased(f, source);
      f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?')
        .run('2000-01-01T00:00:00.000Z', f.completed.body.output_ref); const expected = snapshot(f);
      await rejected(reserve(f, observation)); assert.equal(guard.countInserts(attemptTable), 0);
      assert.deepEqual(guard.state.calls, ['get', 'head']); guard.assertPreserved(expected);
    } finally { guard.close(); }
  });

  test('forged or cloned leased observations cannot reserve or poison the genuine owner', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    try { const source = await acquire(f), observation = await readLeased(f, source);
      for (const token of [{}, structuredClone(observation), Object.create(observation), new Proxy(observation, {})])
        await rejected(reserve(f, token));
      assert.equal(guard.countInserts(attemptTable), 0); assert.equal((await reserve(f, observation)).status, 'reserved');
      assert.equal(guard.countInserts(attemptTable), 1); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('ordinary and leased observation brands cannot substitute for each other', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t); let ordinaryCallbacks = 0;
    try { const source = await acquire(f), observation = await readLeased(f, source);
      assert.throws(() => media.guestImageResultMediaReview(f.request, f.env, observation), refusal);
      await rejected(media.consumeGuestImageResultMedia(f.request, f.env, observation, async () => { ordinaryCallbacks++; }));
      assert.equal(ordinaryCallbacks, 0); assert.equal((await reserve(f, observation)).status, 'reserved'); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('foreign leased Request and environment cannot retire the genuine source', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    try { const source = await acquire(f);
      for (const [req, env] of [[claimRequest(), f.env], [f.request, { ...f.env }]])
        await rejected(media.readLeasedGuestImageResultMedia(req, env, source));
      assert.deepEqual(guard.state.calls, []);
      assert.equal((await reserve(f, await readLeased(f, source))).status, 'reserved'); guard.assertPreserved();
    } finally { guard.close(); }
  });

  for (const changed of ['DB', 'bucket', 'headers']) test(`restoring ${changed} cannot revive a retired leased owner`, async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t);
    const original = { DB: f.env.DB, bucket: f.env.MEDIA, origin: f.request.headers.get('origin') };
    try { const source = await acquire(f);
      operationApi.guestImageResultLeasedMediaOperation(f.request, f.env, source);
      if (changed === 'DB') f.env.DB = { ...f.env.DB };
      else if (changed === 'bucket') f.env.MEDIA = { ...f.env.MEDIA };
      else f.request.headers.set('origin', 'https://foreign.example.invalid');
      await rejected(readLeased(f, source));
      f.env.DB = original.DB; f.env.MEDIA = original.bucket; f.request.headers.set('origin', original.origin);
      await rejected(readLeased(f, source)); assert.deepEqual(guard.state.calls, []);
      assert.equal(guard.countInserts(attemptTable), 0); guard.assertPreserved();
    } finally { f.env.DB = original.DB; f.env.MEDIA = original.bucket; f.request.headers.set('origin', original.origin); guard.close(); }
  });

  test('the original monotonic inventory deadline is not renewed by first lease', async t => {
    const f = await claimSourceFixture(t, { inventory: false }); let clock = 1000;
    t.mock.method(performance, 'now', () => clock); await createMediaInventory(f, f.request, 31000);
    const guard = installClaimSourceGuards(f, t);
    try { clock = 11000; const source = await acquire(f); clock = 31000;
      await rejected(readLeased(f, source)); clock = 11000; await rejected(readLeased(f, source));
      assert.deepEqual(guard.state.calls, []); assert.equal(guard.countInserts(leaseTable), 1);
      assert.equal(guard.countInserts(attemptTable), 0); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('lease expiry contracts the leased byte lifetime and restoring the clock does not revive it', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t); const originalNow = Date.now; let clock;
    try { const source = await acquire(f), lease = rows(f, leaseTable)[0];
      operationApi.guestImageResultLeasedMediaOperation(f.request, f.env, source);
      // Keep one restoration record. Mocking the method again to restore it
      // registers the expired mock as that second record's original method.
      clock = t.mock.method(Date, 'now', () => lease.expires_at_ms); await rejected(readLeased(f, source));
      clock.mock.restore(); assert.equal(Date.now, originalNow); await rejected(readLeased(f, source));
      assert.deepEqual(guard.state.calls, []); assert.equal(guard.countInserts(attemptTable), 0); guard.assertPreserved();
    } finally { clock?.mock.restore(); guard.close(); }
  });

  for (const stage of ['get', 'head']) test(`abort during leased ${stage.toUpperCase()} prevents late success and any reserve`, async t => {
    const f = await claimSourceFixture(t, { inventory: false }), controller = new AbortController();
    f.request = new Request(f.request, { signal: controller.signal }); await createMediaInventory(f);
    const guard = installClaimSourceGuards(f, t), entered = deferred(), release = deferred(); let pending;
    try { const source = await acquire(f);
      guard.state[stage === 'get' ? 'beforeGet' : 'beforeHead'] = async () => { entered.resolve(); await release.promise; };
      pending = readLeased(f, source).then(value => ({ value }), error => ({ error }));
      await entered.promise; controller.abort(); const result = await pending; assert.ok(result.error); refusal(result.error);
      release.resolve(); await rejected(readLeased(f, source));
      assert.deepEqual(guard.state.calls, stage === 'get' ? ['get'] : ['get', 'head']);
      assert.equal(guard.countInserts(attemptTable), 0); guard.assertPreserved();
    } finally { release.resolve(); await pending; guard.close(); }
  });

  for (const damage of ['missing-family', 'partial-family', 'changed-family'])
    test(`claim requires exact complete result schema: ${damage}`, async t => {
      const f = await claimSourceFixture(t, { resultSchema: damage !== 'missing-family', inventory: false });
      if (damage === 'partial-family') f.sqlite.exec('DROP TRIGGER experience_guest_image_result_attempt_insert');
      if (damage === 'changed-family') f.sqlite.exec('CREATE TRIGGER experience_guest_image_result_extra BEFORE INSERT ON experience_guest_image_result_copy_attempts BEGIN SELECT 1; END');
      const guard = installClaimSourceGuards(f, t);
      try { if (damage === 'missing-family') { await createMediaInventory(f); await rejected(acquire(f)); }
        else await rejected(createMediaInventory(f));
        assert.equal(guard.countInserts(leaseTable), 0); assert.equal(guard.countInserts(attemptTable), 0);
        assert.deepEqual(guard.state.calls, []); guard.assertPreserved();
      } finally { guard.close(); }
    });


  test('abort cannot retire an admitted consumer copy before its delayed promise settles', async t => {
    const f = await claimSourceFixture(t, { inventory: false }), controller = new AbortController();
    f.request = new Request(f.request, { signal: controller.signal }); await createMediaInventory(f);
    const guard = installClaimSourceGuards(f, t), entered = deferred(), release = deferred(); let pending, accounting;
    try { const source = await acquire(f);
      // Delay the actual admitted consumer promise after its real claim work,
      // not a DB acknowledgement whose owner may independently cancel early.
      accounting = observeOperation(t, operationApi.guestImageResultLeasedMediaOperation(f.request, f.env, source), f,
        async () => { entered.resolve(); await release.promise; });
      const observation = await readLeased(f, source);
      pending = reserve(f, observation).then(value => ({ value }), error => ({ error }));
      await entered.promise; assert.equal(accounting.uses.length, 2); const consumer = accounting.uses[1];
      assert.deepEqual(consumer.bytes, f.mediaOracle.bytes); controller.abort();
      const foreground = await Promise.race([pending, delay(1000).then(() => { throw Error('foreground blocked on the actual pending consumer promise'); })]);
      assert.equal(foreground.value?.status === 'reserved', false, 'aborted owner cannot disclose reserved authority');
      if (foreground.error) refusal(foreground.error);
      assert.deepEqual(consumer.bytes, f.mediaOracle.bytes, 'actual consumer still owns its input after foreground cancellation');
      release.resolve(); await consumer.settlement; await turn();
      assert.ok(consumer.bytes.every(value => value === 0), 'retire copy only after actual pending consumer settles');
      assert.equal(guard.countInserts(attemptTable), 1); assert.deepEqual(guard.state.calls, ['get', 'head']);
      guard.assertPreserved(); inertCopies(f);
    } finally { release.resolve(); await pending;
      if (accounting?.uses[1]?.settlement) { await accounting.uses[1].settlement; await turn(); }
      guard.close(); }
  });

  for (const malformed of ['wrong-length', 'false-success', 'wrong-insert-changes'])
    test(`malformed reserve acknowledgement cannot grant a reserved winner: ${malformed}`, async t => {
      const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t); let hook;
      try { const source = await acquire(f), observation = await readLeased(f, source);
        hook = interceptBatch(f, attemptTable, (results, statements) => {
          const changed = structuredClone(results), index = statements.findIndex(statement => fixedInsert.exec(statement.sql)?.[1] === attemptTable);
          if (malformed === 'wrong-length') changed.pop();
          else if (malformed === 'false-success') changed[index].success = false;
          else changed[index].meta.changes = 0;
          return changed;
        });
        const result = await reserve(f, observation); assert.equal(result.status, 'reservation-unknown');
        assert.equal(Object.hasOwn(result, 'reservation'), false); assert.equal(result.recovery.dispatchAllowed, false);
        assert.equal(hook.calls, 1); assert.equal(guard.countInserts(attemptTable), 1); assert.equal(rows(f, attemptTable).length, 1);
        assert.deepEqual(guard.state.calls, ['get', 'head']); guard.assertPreserved();
      } finally { hook?.close(); guard.close(); }
    });

  test('a late source failure inside the actual first-lease batch rolls back the lease and the injected change', async t => {
    const f = await claimSourceFixture(t), guard = installClaimSourceGuards(f, t), prepare = f.DB.prepare; let injected = 0;
    function wrap(statement, sql) {
      const bind = statement.bind, execute = statement.execute;
      statement.bind = function (...values) { return wrap(bind.apply(this, values), sql); };
      statement.execute = function (...args) { const result = execute.apply(this, args);
        if (fixedInsert.exec(sql)?.[1] === leaseTable && injected++ === 0)
          f.sqlite.prepare('UPDATE private_content SET content=?,redacted_at=? WHERE content_id=?')
            .run('', '2000-01-01T00:00:00.000Z', f.completed.body.output_ref);
        return result;
      }; return statement;
    }
    f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
    try { await rejected(acquire(f)); assert.equal(injected, 1, 'actual native insert ran before failing after-proof');
      assert.deepEqual(rows(f, leaseTable), []); assert.equal(guard.countInserts(leaseTable), 1);
      assert.deepEqual(snapshot(f), guard.initial, 'whole SQLite batch rolled back');
      assert.deepEqual(guard.state.calls, []); guard.assertPreserved();
    } finally { f.DB.prepare = prepare; guard.close(); }
  });

}
