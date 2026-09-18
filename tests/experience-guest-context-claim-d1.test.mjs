import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [{ handleSession, POLICY_VERSION }, { GUEST_CUSTODY_SCHEMA, issueGuestClaimSession, readGuestCustodyTerms },
  { GUEST_SOURCE_SCHEMA, readGuestSourcePolicy, prepareGuestImageSource, commitGuestImageSource },
  { inspectGuestContextInventory }, { claimGuestContext },
  { GUEST_CONTEXT_ADOPTION_SCHEMA },
  { GUEST_PLAN_CUSTODY_SCHEMA },
  { registeredExperience, initialValues }, { canonicalJson, digest }, { readWorkspaceEvents }] = await Promise.all([
  import('../worker/pilot-policy.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'), import('../worker/experience-guest-context-claim.ts'), import('../worker/experience-guest-context-adoption.ts'),
  import('../worker/experience-guest-plan-custody.ts'), import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'), import('../worker/runtime.ts'),
]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid', owner = 'owner', subject = 'A blue heron on a stone bridge';
const headers = (actor = owner, extra = {}) => ({ origin, ...(actor ? {
  'oai-authenticated-user-id': actor, 'oai-authenticated-user-email': `${actor}@example.invalid`,
} : {}), ...extra });
const request = (actor = owner, method = 'POST') => new Request(`${origin}/unregistered-context-claim`, { method, headers: headers(actor) });
const proofFor = session => ({ sessionId: session.sessionId, sessionToken: session.sessionToken, claimToken: session.claimToken });
const financialTables = ['users', 'budget_counters', 'cost_budget_counters', 'budget_reservations', 'cost_budget_reservations',
  'document_jobs', 'output_execution_grants', 'output_operation_slots', 'output_provider_calls'];

// Wrap the real workerd D1 statements, never emulate their execution. The late
// assertion hook deliberately enters the same native D1 transaction as retained-plan custody within the coordinator.
function observedDatabase(raw, diagnostic) {
  const records = [], statementsByObject = new WeakMap();
  const record = row => {
    assert.ok(row.bindings.length <= 100, `D1 parameters: ${row.bindings.length}`);
    assert.ok(Buffer.byteLength(row.sql) <= 100000, `D1 SQL bytes: ${Buffer.byteLength(row.sql)}`);
    records.push({ sql: row.sql, parameters: row.bindings.length, sqlBytes: Buffer.byteLength(row.sql) });
  };
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings };
    const result = {
      bind(...args) { return wrap(statement.bind(...args), sql, args); },
      async first(...args) { record(row); try { return await statement.first(...args); } catch (error) { diagnostic(`Actual D1 first() failure: ${String(error)}; parameters=${bindings.length}; SQL bytes=${Buffer.byteLength(sql)}`); throw error; } },
      async all(...args) { record(row); return statement.all(...args); },
      async run(...args) { record(row); return statement.run(...args); },
    };
    statementsByObject.set(result, row);
    return result;
  }
  const observed = {
    records, failRetention: false, lateFailureHits: 0,
    DB: {
      prepare(sql) { return wrap(raw.prepare(sql), sql); },
      async batch(items) {
        const rows = items.map(item => { const row = statementsByObject.get(item); assert.ok(row, 'real D1 statement'); record(row); return row; });
        const native = rows.map(row => row.statement);
        if (observed.failRetention && rows.some(row => /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+experience_guest_plan/iu.test(row.sql))) {
          observed.lateFailureHits++;
          native.push(raw.prepare("INSERT INTO context_claim_test_assertions VALUES('injected-late-d1-failure',0)"));
        }
        return raw.batch(native);
      },
    },
  };
  return observed;
}
async function rows(db, table) { return (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results; }
async function snapshot(db, tables) { return Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(db, table)]))); }
async function streamHistory(db, stream) {
  const events = (await db.prepare('SELECT * FROM events WHERE stream_id=? ORDER BY sequence').bind(stream).all()).results;
  const bodies = (await db.prepare('SELECT body.* FROM event_private_payloads body JOIN events event ON event.event_id=body.private_event_id WHERE event.stream_id=? ORDER BY event.sequence')
    .bind(stream).all()).results;
  const receipts = (await db.prepare('SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY sequence').bind(stream).all()).results;
  return { events, bodies, receipts };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-claim-d1-')), egress = [], media = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default { fetch() { return new Response('Only local D1 bindings are exercised.', {status: 404}); } };",
    d1Databases: ['Custody'], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: req => { egress.push(req.url); throw Error('The custody fixture permits no external fetch.'); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); assert.deepEqual(media, []); });
  const raw = await mf.getD1Database('Custody'), observed = observedDatabase(raw, message => t.diagnostic(message)), DB = observed.DB;
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Native application fetch forbidden.'); });
  const env = { DB, MEDIA: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map(method => [method, () => { media.push(method); throw Error('Media forbidden.'); }])),
    ASSETS: { fetch() { egress.push('assets'); throw Error('Assets forbidden.'); } } };
  // This is fixture-only canonical account initialization through the native
  // schema/session implementation. The custody operation cannot create users.
  assert.equal((await handleSession(new Request('http://localhost/api/session', { headers: headers() }), env)).status, 200);
  await DB.prepare("UPDATE users SET consent_version=?,role='creator'").bind(POLICY_VERSION).run();
  for (const sql of [...GUEST_CUSTODY_SCHEMA, ...GUEST_SOURCE_SCHEMA, ...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_PLAN_CUSTODY_SCHEMA]) await DB.prepare(sql).run();
  await DB.prepare('CREATE TABLE context_claim_test_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1))').run();
  const terms = readGuestCustodyTerms({ version: 1, policyId: 'guest-policy', origin, startsAtMs: Date.now() - 60000, expiresAtMs: Date.now() + 600000,
    sessionLifetimeMs: 300000, leaseLifetimeMs: 120000, maximumSessions: 5, maximumLeaseAcquisitions: 3 });
  await DB.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').bind(terms.policyId, await digest(terms), canonicalJson(terms), `sha256:${'b'.repeat(64)}`).run();
  const session = await issueGuestClaimSession(request(null), env, terms.policyId), release = await registeredExperience('image'), values = initialValues(release);
  values.subject = { value: subject, provenance: 'authored' }; values.ratio = { value: { width: 1, height: 1 }, provenance: 'authored' };
  const policy = readGuestSourcePolicy({ version: 1, policyId: 'source-policy', sessionPolicyId: terms.policyId, sessionTermsDigest: await digest(terms), releaseHash: release.releaseHash,
    maximumDraftBytes: 65536, maximumEventBytes: 65536, maximumEvents: 16, draftLifetimeMs: 120000 });
  await DB.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').bind(policy.policyId, await digest(policy), canonicalJson(policy), `sha256:${'c'.repeat(64)}`).run();
  const proof = proofFor(session), sourceInput = { proof, policyId: policy.policyId, request: { intentId: session.sessionId, experienceId: 'image', releaseHash: release.releaseHash, values } };
  const financialBefore = await snapshot(DB, financialTables);
  observed.records.length = 0;
  const prepared = await prepareGuestImageSource(request(null), env, sourceInput);
  const committed = await commitGuestImageSource(request(null), env, { proof, draftHash: prepared.plan.draftHash });
  const inventory = await inspectGuestContextInventory(request(null), env, { proof });
  const input = { sessionId: session.sessionId, requestId: 'claim-request', approvedManifestDigest: inventory.manifestDigest, proof };
  return { DB, env, observed, session, prepared, committed, proof, financialBefore, inventory, input,
    claim: (includeProof = true) => claimGuestContext(request(), env, includeProof ? input : {
      sessionId: input.sessionId, requestId: input.requestId, approvedManifestDigest: input.approvedManifestDigest,
    }) };
}

async function originalHistory(f) {
  return {
    stream: await streamHistory(f.DB, `creative:${f.session.guestSubject}`),
    privateDrafts: (await rows(f.DB, 'private_content')).filter(row => row.owner_id === f.session.guestSubject),
    source: await snapshot(f.DB, ['experience_guest_policies', 'experience_guest_source_policies', 'experience_guest_sources', 'experience_guest_source_commits']),
  };
}
async function completedHistory(f) {
  return { stream: await streamHistory(f.DB, `creative:${owner}`),
    records: await snapshot(f.DB, ['experience_guest_sessions', 'experience_guest_claim_leases', 'experience_guest_context_adoptions']) };
}
function expectedReceipt(f, result) {
  assert.equal(result.version, 1); assert.equal(result.status, 'context-claimed'); assert.equal(result.contextCustodyTransferred, true);
  assert.equal(result.generationAvailable, false); assert.equal(result.miniAppClaimComplete, false);
  const receipt = result.receipt;
  assert.equal(receipt.sessionId, f.session.sessionId); assert.equal(receipt.requestId, f.input.requestId);
  assert.equal(receipt.manifestDigest, f.inventory.manifestDigest); assert.equal(receipt.destinationUserId, owner);
  assert.equal(receipt.projectId, f.session.projectId); assert.equal(receipt.documentId, f.session.documentId);
  assert.equal(receipt.eventIds.length, f.prepared.plan.events.length); assert.equal(receipt.head, receipt.eventIds.length);
  assert.equal(receipt.contextCustodyTransferred, true); assert.equal(receipt.miniAppClaimComplete, false);
}
async function expectedRetained(f, result) {
  expectedReceipt(f, result); assert.equal(result.planRetention, 'retained');
  assert.deepEqual(result.retained.plan, f.prepared.plan); assert.equal(result.retained.generationAvailable, false);
  assert.deepEqual(result.retained.custody.eventIds, result.receipt.eventIds);
  assert.deepEqual(result.retained.custody.appended, await readWorkspaceEvents(f.env, `creative:${owner}`));
  assert.deepEqual((await streamHistory(f.DB, `creative:${owner}`)).events.map(event => event.event_id), result.receipt.eventIds);
  assert.ok((await rows(f.DB, 'experience_guest_sessions'))[0].revoked_at_ms);
  const leases = await rows(f.DB, 'experience_guest_claim_leases'); assert.equal(leases.length, 1); assert.equal(leases[0].acquisitions, 1);
  assert.equal((await rows(f.DB, 'experience_guest_context_adoptions')).length, 1);
  const mappings = await rows(f.DB, 'experience_guest_plan_custodies'); assert.equal(mappings.length, 1);
  const copies = (await rows(f.DB, 'private_content')).filter(row => row.owner_id === owner); assert.equal(copies.length, 1);
  assert.equal(copies[0].content_id, mappings[0].content_id); assert.notEqual(copies[0].content_id, f.prepared.plan.draftId);
  assert.equal(copies[0].content, canonicalJson(f.prepared.plan));
  assert.equal(await digest(copies[0].content), mappings[0].content_digest);
}
async function unchanged(f, original) {
  assert.deepEqual(await originalHistory(f), original, 'coordination preserves all original guest content, events, receipts, policy and source history');
  assert.deepEqual(await snapshot(f.DB, financialTables), f.financialBefore, 'coordination does not bootstrap another account, job, grant or financial reservation');
  assert.deepEqual(await rows(f.DB, 'context_claim_test_assertions'), []);
  assert.deepEqual(await rows(f.DB, 'experience_guest_plan_custody_assertions'), []);
  assert.deepEqual((await f.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
}
function metrics(t, f, phaseStart) {
  const phase = f.observed.records.slice(phaseStart);
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', executedStatements: f.observed.records.length,
    coordinatorPhaseStatements: phase.length, maxBindings: Math.max(...phase.map(row => row.parameters)), maxSqlBytes: Math.max(...phase.map(row => row.sqlBytes)) }));
}

// This is one focused coordinator qualification with the previously qualified
// native pieces, using absent optional Memory schemas. It does not activate a
// route, browser claim UI, login, generated-result custody or hosted D1.
test('local workerd D1 coordinates one context claim and retained plan, then replays canonically without guest credentials', { timeout: 90000 }, async t => {
  const f = await fixture(t), original = await originalHistory(f), phaseStart = f.observed.records.length;
  const accepted = await f.claim(); await expectedRetained(f, accepted);
  await assert.rejects(inspectGuestContextInventory(request(null), f.env, { proof: f.proof }), /guest_custody_/u);
  const completion = await completedHistory(f), retained = await snapshot(f.DB, ['private_content', 'experience_guest_plan_custodies']);
  const replay = await f.claim(false); await expectedRetained(f, replay);
  assert.deepEqual(replay.receipt.eventIds, accepted.receipt.eventIds); assert.equal(replay.retained.replayed, true);
  assert.deepEqual(await completedHistory(f), completion, 'proofless recovery preserves the exact native baseline, lease, completion and guest revocation');
  assert.deepEqual(await snapshot(f.DB, Object.keys(retained)), retained, 'proofless replay cannot create another retained copy');
  await unchanged(f, original); metrics(t, f, phaseStart);
});

test('local workerd D1 returns a source-free partial after late plan-copy rollback and finishes only on an explicit canonical retry', { timeout: 90000 }, async t => {
  const f = await fixture(t), original = await originalHistory(f), phaseStart = f.observed.records.length;
  f.observed.failRetention = true;
  const partial = await f.claim(); expectedReceipt(f, partial);
  assert.equal(f.observed.lateFailureHits, 1, 'the coordinator does not retry a failed retention mutation automatically');
  assert.equal(partial.planRetention, 'unavailable');
  assert.deepEqual(Object.keys(partial).sort(), ['contextCustodyTransferred', 'generationAvailable', 'miniAppClaimComplete', 'planRetention', 'receipt', 'status', 'version']);
  for (const secret of [subject, f.session.sessionToken, f.session.claimToken]) assert.ok(!JSON.stringify(partial).includes(secret));
  assert.deepEqual(await rows(f.DB, 'experience_guest_plan_custodies'), []);
  assert.deepEqual((await rows(f.DB, 'private_content')).filter(row => row.owner_id === owner), [], 'late D1 failure rolls back the complete canonical plan copy');
  assert.deepEqual(await rows(f.DB, 'experience_guest_plan_custody_assertions'), []);
  const completion = await completedHistory(f);
  assert.equal(completion.records.experience_guest_context_adoptions.length, 1);
  assert.ok(completion.records.experience_guest_sessions[0].revoked_at_ms);
  assert.equal(completion.records.experience_guest_claim_leases[0].acquisitions, 1);
  assert.deepEqual(completion.stream.events.map(event => event.event_id), partial.receipt.eventIds);
  await unchanged(f, original);
  f.observed.failRetention = false;
  const accepted = await f.claim(false); await expectedRetained(f, accepted);
  assert.deepEqual(accepted.receipt.eventIds, partial.receipt.eventIds);
  assert.deepEqual(await completedHistory(f), completion, 'explicit retry completes plan retention without reacquiring a lease or reappending context');
  await unchanged(f, original); metrics(t, f, phaseStart);
});
