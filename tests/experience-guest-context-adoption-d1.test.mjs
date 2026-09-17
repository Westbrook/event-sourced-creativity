import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [{ handleSession, POLICY_VERSION }, { GUEST_CUSTODY_SCHEMA, issueGuestClaimSession, readGuestCustodyTerms },
  { GUEST_SOURCE_SCHEMA, readGuestSourcePolicy, prepareGuestImageSource, commitGuestImageSource },
  { inspectGuestContextInventory }, { acquireGuestClaimLease },
  { GUEST_CONTEXT_ADOPTION_SCHEMA, adoptGuestContextSource, readGuestContextAdoption },
  { registeredExperience, initialValues }, { canonicalJson, digest }, { readWorkspaceEvents }, { foldEvents }, { handleEvents }] = await Promise.all([
  import('../worker/pilot-policy.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'), import('../worker/experience-guest-claim-lease.ts'), import('../worker/experience-guest-context-adoption.ts'),
  import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'), import('../worker/runtime.ts'), import('../src/model/events.ts'), import('../worker/events-api.ts'),
]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid', owner = 'owner', subject = 'A blue heron on a stone bridge';
const headers = (actor = owner, extra = {}) => ({ origin, ...(actor ? {
  'oai-authenticated-user-id': actor, 'oai-authenticated-user-email': `${actor}@example.invalid`,
} : {}), ...extra });
const request = (actor = owner) => new Request(`${origin}/unregistered-context-adoption`, { method: 'POST', headers: headers(actor) });
const proofFor = session => ({ sessionId: session.sessionId, sessionToken: session.sessionToken, claimToken: session.claimToken });
const statements = sql => sql.split('--> statement-breakpoint').map(part => part.trim()).filter(Boolean);
const financialTables = ['users', 'budget_counters', 'cost_budget_counters', 'budget_reservations', 'cost_budget_reservations',
  'document_jobs', 'output_execution_grants', 'output_operation_slots', 'output_provider_calls'];

// Wrap the real workerd D1 statements, never emulate their execution. The late
// assertion hook deliberately enters the same native D1 transaction as adoption.
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
    records, failAdoption: false, lateFailureHits: 0,
    DB: {
      prepare(sql) { return wrap(raw.prepare(sql), sql); },
      async batch(items) {
        const rows = items.map(item => { const row = statementsByObject.get(item); assert.ok(row, 'real D1 statement'); record(row); return row; });
        const native = rows.map(row => row.statement);
        if (observed.failAdoption && rows.some(row => row.sql.includes('INSERT INTO experience_guest_context_adoptions'))) {
          observed.lateFailureHits++;
          native.push(raw.prepare("INSERT INTO experience_guest_context_adoption_assertions VALUES('injected-late-d1-failure',0)"));
        }
        return raw.batch(native);
      },
    },
  };
  return observed;
}
async function rows(db, table) { return (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results; }
async function snapshot(db, tables) { return Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(db, table)]))); }
async function guestHistory(db, session) {
  const events = (await db.prepare('SELECT * FROM events WHERE stream_id=? ORDER BY sequence').bind(`creative:${session.guestSubject}`).all()).results;
  const bodies = (await db.prepare('SELECT body.* FROM event_private_payloads body JOIN events event ON event.event_id=body.private_event_id WHERE event.stream_id=? ORDER BY event.sequence')
    .bind(`creative:${session.guestSubject}`).all()).results;
  const receipts = (await db.prepare('SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY sequence').bind(`creative:${session.guestSubject}`).all()).results;
  return { events, bodies, receipts };
}

async function fixture(t, memory) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-context-d1-')), egress = [], media = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default { fetch() { return new Response('Only local D1 bindings are exercised.', {status: 404}); } };",
    d1Databases: ['Custody'], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: req => { egress.push(req.url); throw Error('The custody fixture permits no external fetch.'); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); assert.deepEqual(media, []); });
  const raw = await mf.getD1Database('Custody'), observed = observedDatabase(raw, message => t.diagnostic(message)), DB = observed.DB;
  // Establish the pinned local engine's compound SELECT boundary independently
  // of the inventory query. This does not assert a hosted D1 service limit.
  const compound = count => Array.from({ length: count }, () => 'SELECT 1').join(' UNION ALL ');
  assert.equal((await raw.prepare(compound(5)).all()).results.length, 5);
  await assert.rejects(raw.prepare(compound(6)).all(), /too many terms in compound SELECT/u);
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Native application fetch forbidden.'); });
  const env = { DB, MEDIA: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map(method => [method, () => { media.push(method); throw Error('Media forbidden.'); }])),
    ASSETS: { fetch() { egress.push('assets'); throw Error('Assets forbidden.'); } } };
  // This is fixture-only canonical account initialization through the native
  // schema/session implementation. The custody operation cannot create users.
  assert.equal((await handleSession(new Request('http://localhost/api/session', { headers: headers() }), env)).status, 200);
  await DB.prepare("UPDATE users SET consent_version=?,role='creator'").bind(POLICY_VERSION).run();
  for (const sql of [...GUEST_CUSTODY_SCHEMA, ...GUEST_SOURCE_SCHEMA, ...GUEST_CONTEXT_ADOPTION_SCHEMA]) await DB.prepare(sql).run();
  if (memory) for (const name of ['0027_memory_native_origins.sql', '0033_memory_structured_answer_provenance.sql', '0034_memory_document_job_origins.sql']) {
    await DB.batch(statements(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8')).map(sql => DB.prepare(sql)));
  }
  const terms = readGuestCustodyTerms({ version: 1, policyId: 'guest-policy', origin, startsAtMs: Date.now() - 60000, expiresAtMs: Date.now() + 600000,
    sessionLifetimeMs: 300000, leaseLifetimeMs: 120000, maximumSessions: 5, maximumLeaseAcquisitions: 3 });
  await DB.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').bind(terms.policyId, await digest(terms), canonicalJson(terms), `sha256:${'b'.repeat(64)}`).run();
  const session = await issueGuestClaimSession(request(null), env, terms.policyId), release = await registeredExperience('image'), values = initialValues(release);
  values.subject = { value: subject, provenance: 'authored' }; values.ratio = { value: { width: 1, height: 1 }, provenance: 'authored' };
  const policy = readGuestSourcePolicy({ version: 1, policyId: 'source-policy', sessionPolicyId: terms.policyId, sessionTermsDigest: await digest(terms), releaseHash: release.releaseHash,
    maximumDraftBytes: 65536, maximumEventBytes: 65536, maximumEvents: 16, draftLifetimeMs: 120000 });
  await DB.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').bind(policy.policyId, await digest(policy), canonicalJson(policy), `sha256:${'c'.repeat(64)}`).run();
  const proof = proofFor(session), input = { proof, policyId: policy.policyId, request: { intentId: session.sessionId, experienceId: 'image', releaseHash: release.releaseHash, values } };
  const financialBefore = await snapshot(DB, financialTables);
  observed.records.length = 0;
  const prepared = await prepareGuestImageSource(request(null), env, input);
  const committed = await commitGuestImageSource(request(null), env, { proof, draftHash: prepared.plan.draftHash });
  const inventory = await inspectGuestContextInventory(request(null), env, { proof });
  const lease = await acquireGuestClaimLease(request(), env, { proof, requestId: 'claim-request', manifestDigest: inventory.manifestDigest });
  return { DB, env, observed, session, prepared, committed, proof, financialBefore,
    adopt: () => adoptGuestContextSource(request(), env, { inventory, leaseId: lease.leaseId, requestId: 'claim-request' }),
    recover: () => readGuestContextAdoption(request(), env, { sessionId: session.sessionId }) };
}

// Actual workerd D1 execution of both schema paths. This does not qualify a
// hosted deployment, public guest activation, mini-app reopening or providers.
for (const memory of [false, true]) test(`local workerd D1 adopts and recovers native context with ${memory ? 'complete' : 'absent'} Memory schema and rolls back a late transaction failure`, { timeout: 90000 }, async t => {
  const f = await fixture(t, memory), source = await guestHistory(f.DB, f.session);
  const before = await snapshot(f.DB, ['events', 'event_private_payloads', 'event_client_receipts', 'experience_guest_sessions', 'experience_guest_claim_leases',
    'experience_guest_context_adoptions', 'experience_guest_context_adoption_assertions', 'event_write_stage']);
  f.observed.failAdoption = true;
  await assert.rejects(f.adopt(), /CHECK constraint failed/u);
  f.observed.failAdoption = false;
  assert.equal(f.observed.lateFailureHits, 1);
  assert.deepEqual(await snapshot(f.DB, Object.keys(before)), before, 'D1 restores the native event copies, completion and live guest authority after a late failure');
  const accepted = await f.adopt();
  assert.equal(accepted.status, 'context-adopted'); assert.equal(accepted.contextCustodyTransferred, true); assert.equal(accepted.miniAppClaimComplete, false);
  assert.equal(accepted.projectId, f.session.projectId); assert.equal(accepted.documentId, f.session.documentId); assert.equal(accepted.replayed, false);
  assert.equal(accepted.eventIds.length, f.committed.eventIds.length);
  assert.deepEqual(await guestHistory(f.DB, f.session), source, 'original native actor, private content and receipt history is unchanged');
  const completion = await snapshot(f.DB, ['events', 'event_private_payloads', 'event_client_receipts', 'experience_guest_sessions', 'experience_guest_context_adoptions']);
  assert.deepEqual((await f.recover()).eventIds, accepted.eventIds);
  assert.equal((await f.adopt()).replayed, true);
  assert.deepEqual(await snapshot(f.DB, Object.keys(completion)), completion, 'recovery never appends another baseline');
  await assert.rejects(inspectGuestContextInventory(request(null), f.env, { proof: f.proof }), /guest_custody_/u);
  const blockId = f.prepared.plan.events.find(event => event.type === 'BlockCreated' && event.payload.properties?.text === subject).payload.block_id;
  const edit = await handleEvents(new Request(`${origin}/api/events`, { method: 'POST', headers: headers(owner, { 'content-type': 'application/json' }),
    body: JSON.stringify({ action: 'batch', expectedSequence: accepted.head, events: [{ type: 'BlockPropertyEdited', payload: {
      project_id: f.session.projectId, document_id: f.session.documentId, block_id: blockId, property_path: 'text', old_value: subject, new_value: 'A heron beside a quiet lake',
    } }] }) }), f.env);
  const editBody = await edit.json(); assert.equal(edit.status, 200, JSON.stringify(editBody)); assert.deepEqual(editBody.rejected, []); assert.equal(editBody.appended.length, 1);
  const reopened = foldEvents(await readWorkspaceEvents(f.env, `creative:${owner}`), Infinity, f.session.documentId, f.session.projectId);
  assert.equal(reopened.documentId, f.session.documentId); assert.ok(reopened.libraryBlocks.some(block => block.id === blockId && block.properties.text === 'A heron beside a quiet lake'));
  assert.deepEqual((await f.recover()).eventIds, accepted.eventIds);
  assert.deepEqual(await snapshot(f.DB, financialTables), f.financialBefore, 'synthetic custody does not create accounts, jobs, grants or financial reservations');
  assert.deepEqual((await f.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', memory, executedStatements: f.observed.records.length,
    maxBindings: Math.max(...f.observed.records.map(row => row.parameters)), maxSqlBytes: Math.max(...f.observed.records.map(row => row.sqlBytes)) }));
});
