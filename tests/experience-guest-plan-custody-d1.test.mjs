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
  { GUEST_PLAN_CUSTODY_SCHEMA, retainGuestContextPlan, readGuestContextPlan },
  { registeredExperience, initialValues }, { canonicalJson, digest }, { readWorkspaceEvents }, { foldEvents }, { handleEvents }] = await Promise.all([
  import('../worker/pilot-policy.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'), import('../worker/experience-guest-claim-lease.ts'), import('../worker/experience-guest-context-adoption.ts'),
  import('../worker/experience-guest-plan-custody.ts'), import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'), import('../worker/runtime.ts'), import('../src/model/events.ts'), import('../worker/events-api.ts'),
]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid', owner = 'owner', subject = 'A blue heron on a stone bridge';
const headers = (actor = owner, extra = {}) => ({ origin, ...(actor ? {
  'oai-authenticated-user-id': actor, 'oai-authenticated-user-email': `${actor}@example.invalid`,
} : {}), ...extra });
const request = (actor = owner, method = 'POST') => new Request(`${origin}/unregistered-plan-custody`, { method, headers: headers(actor) });
const proofFor = session => ({ sessionId: session.sessionId, sessionToken: session.sessionToken, claimToken: session.claimToken });
const statements = sql => sql.split('--> statement-breakpoint').map(part => part.trim()).filter(Boolean);
const financialTables = ['users', 'budget_counters', 'cost_budget_counters', 'budget_reservations', 'cost_budget_reservations',
  'document_jobs', 'output_execution_grants', 'output_operation_slots', 'output_provider_calls'];

// Wrap the real workerd D1 statements, never emulate their execution. The late
// assertion hook deliberately enters the same native D1 transaction as retained-plan custody.
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
    records, failPlan: false, lateFailureHits: 0,
    DB: {
      prepare(sql) { return wrap(raw.prepare(sql), sql); },
      async batch(items) {
        const rows = items.map(item => { const row = statementsByObject.get(item); assert.ok(row, 'real D1 statement'); record(row); return row; });
        const native = rows.map(row => row.statement);
        if (observed.failPlan && rows.some(row => /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+experience_guest_plan/iu.test(row.sql))) {
          observed.lateFailureHits++;
          native.push(raw.prepare("INSERT INTO retained_plan_test_assertions VALUES('injected-late-d1-failure',0)"));
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

async function fixture(t, memory) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-plan-d1-')), egress = [], media = [];
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
  assert.equal((await raw.prepare(`SELECT json_array(${Array(32).fill('1').join(',')}) AS value`).first()).value, JSON.stringify(Array(32).fill(1)));
  // This pinned workerd also accepts 33 function arguments; the documented
  // hosted limit of 32 is qualified separately by the strict parser tests.
  assert.equal((await raw.prepare(`SELECT ${Array(100).fill('1').join(' AND ')} AS value`).first()).value, 1);
  await assert.rejects(raw.prepare(`SELECT ${Array(101).fill('1').join(' AND ')}`).first(), /Expression tree is too large/u);
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Native application fetch forbidden.'); });
  const env = { DB, MEDIA: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map(method => [method, () => { media.push(method); throw Error('Media forbidden.'); }])),
    ASSETS: { fetch() { egress.push('assets'); throw Error('Assets forbidden.'); } } };
  // This is fixture-only canonical account initialization through the native
  // schema/session implementation. The custody operation cannot create users.
  assert.equal((await handleSession(new Request('http://localhost/api/session', { headers: headers() }), env)).status, 200);
  await DB.prepare("UPDATE users SET consent_version=?,role='creator'").bind(POLICY_VERSION).run();
  for (const sql of [...GUEST_CUSTODY_SCHEMA, ...GUEST_SOURCE_SCHEMA, ...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_PLAN_CUSTODY_SCHEMA]) await DB.prepare(sql).run();
  await DB.prepare('CREATE TABLE retained_plan_test_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1))').run();
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
  const adopted = await adoptGuestContextSource(request(), env, { inventory, leaseId: lease.leaseId, requestId: 'claim-request' });
  const baseline = await readWorkspaceEvents(env, `creative:${owner}`);
  return { DB, env, observed, session, prepared, committed, proof, financialBefore, adopted, baseline,
    retain: () => retainGuestContextPlan(request(), env, { sessionId: session.sessionId }),
    read: () => readGuestContextPlan(request(owner, 'GET'), env, { draftId: prepared.plan.draftId }),
    recover: () => readGuestContextAdoption(request(), env, { sessionId: session.sessionId }) };
}

function expectedPlan(f, result, replayed) {
  assert.equal(result.version, 1); assert.equal(result.status, 'context-only');
  assert.equal(result.generationAvailable, false); assert.equal(result.miniAppClaimComplete, false);
  assert.deepEqual(result.plan, f.prepared.plan, 'the exact original plan and its hash/identity are retained');
  if (replayed !== undefined) assert.equal(result.replayed, replayed);
  const custody = result.custody;
  assert.equal(custody.version, 1); assert.equal(custody.kind, 'guest-context');
  assert.equal(custody.sessionId, f.session.sessionId); assert.equal(custody.destinationUserId, owner);
  assert.equal(custody.draftId, f.prepared.plan.draftId); assert.equal(custody.draftHash, f.prepared.plan.draftHash);
  assert.equal(custody.projectId, f.session.projectId); assert.equal(custody.documentId, f.session.documentId);
  assert.equal(custody.targetStreamId, `creative:${owner}`); assert.equal(custody.head, f.adopted.head);
  assert.deepEqual(custody.eventIds, f.adopted.eventIds); assert.equal(custody.manifestDigest, f.adopted.manifestDigest);
  assert.ok(custody.documentRoute.includes(`/document/${f.session.documentId}/`));
  assert.deepEqual(custody.appended, f.baseline, 'canonical hydration DTO matches actual native baseline identities, actors, ordering and payloads');
}

// Native application functions execute against actual local workerd D1. The
// returned plan is context-only; this does not qualify a public route, generated
// outputs, providers, or hosted D1 deployment.
for (const memory of [false, true]) test(`local workerd D1 retains and reads the original adopted plan with ${memory ? 'complete' : 'absent'} Memory schema, atomic rollback and concurrent replay`, { timeout: 90000 }, async t => {
  const f = await fixture(t, memory), original = await streamHistory(f.DB, `creative:${f.session.guestSubject}`);
  const before = await snapshot(f.DB, ['private_content', 'events', 'event_private_payloads', 'event_client_receipts', 'experience_guest_sessions',
    'experience_guest_claim_leases', 'experience_guest_policies', 'experience_guest_source_policies', 'experience_guest_sources', 'experience_guest_source_commits', 'experience_guest_context_adoptions',
    'experience_guest_plan_custodies', 'experience_guest_plan_custody_assertions', 'retained_plan_test_assertions']);
  const phaseStart = f.observed.records.length;
  f.observed.failPlan = true;
  await assert.rejects(f.retain(), /CHECK constraint failed/u);
  f.observed.failPlan = false;
  assert.equal(f.observed.lateFailureHits, 1);
  assert.deepEqual(await snapshot(f.DB, Object.keys(before)), before, 'D1 restores the canonical private copy and immutable mapping on a late failure');
  const concurrent = await Promise.all([f.retain(), f.retain()]);
  for (const result of concurrent) expectedPlan(f, result);
  assert.deepEqual(concurrent[0].custody, concurrent[1].custody);
  const mappings = await rows(f.DB, 'experience_guest_plan_custodies'); assert.equal(mappings.length, 1);
  const mapping = mappings[0];
  assert.equal(mapping.session_id, f.session.sessionId); assert.equal(mapping.destination_user_id, owner);
  assert.equal(mapping.draft_id, f.prepared.plan.draftId); assert.equal(mapping.draft_hash, f.prepared.plan.draftHash);
  assert.notEqual(mapping.content_id, mapping.draft_id, 'canonical private storage has a distinct key from the original guest draft');
  assert.ok(!JSON.stringify(mapping).includes(subject), 'the immutable mapping contains no context prose');
  const privateCopies = (await rows(f.DB, 'private_content')).filter(row => row.owner_id === owner);
  assert.equal(privateCopies.length, 1); assert.equal(privateCopies[0].content_id, mapping.content_id);
  assert.equal(privateCopies[0].content, canonicalJson(f.prepared.plan)); assert.equal(privateCopies[0].redacted_at, null);
  assert.equal(await digest(privateCopies[0].content), mapping.content_digest);
  assert.equal(privateCopies[0].created_at, mapping.created_at); assert.equal(privateCopies[0].expires_at, mapping.expires_at);
  const retained = await snapshot(f.DB, Object.keys(before));
  expectedPlan(f, await f.read(), true); expectedPlan(f, await f.retain(), true);
  await assert.rejects(f.DB.prepare('UPDATE experience_guest_plan_custodies SET draft_hash=draft_hash').run(), /immutable/u);
  await assert.rejects(f.DB.prepare('DELETE FROM experience_guest_plan_custodies').run(), /immutable/u);
  expectedPlan(f, await f.read(), true);
  assert.deepEqual(await snapshot(f.DB, Object.keys(retained)), retained, 'read and exact replay preserve retained bytes, events and mapping');
  const blockId = f.prepared.plan.events.find(event => event.type === 'BlockCreated' && event.payload.properties?.text === subject).payload.block_id;
  const edit = await handleEvents(new Request(`${origin}/api/events`, { method: 'POST', headers: headers(owner, { 'content-type': 'application/json' }),
    body: JSON.stringify({ action: 'batch', expectedSequence: f.adopted.head, events: [{ type: 'BlockPropertyEdited', payload: {
      project_id: f.session.projectId, document_id: f.session.documentId, block_id: blockId, property_path: 'text', old_value: subject, new_value: 'A heron beside a quiet lake',
    } }] }) }), f.env);
  const editBody = await edit.json(); assert.equal(edit.status, 200, JSON.stringify(editBody)); assert.deepEqual(editBody.rejected, []); assert.equal(editBody.appended.length, 1);
  const reopened = foldEvents(await readWorkspaceEvents(f.env, `creative:${owner}`), Infinity, f.session.documentId, f.session.projectId);
  assert.equal(reopened.documentId, f.session.documentId); assert.ok(reopened.libraryBlocks.some(block => block.id === blockId && block.properties.text === 'A heron beside a quiet lake'));
  const editedHistory = await streamHistory(f.DB, `creative:${owner}`);
  expectedPlan(f, await f.read(), true); expectedPlan(f, await f.retain(), true);
  assert.deepEqual(await streamHistory(f.DB, `creative:${owner}`), editedHistory, 'retained read and exact replay cannot append or restore the canonical baseline after native editing');
  const afterRead = foldEvents(await readWorkspaceEvents(f.env, `creative:${owner}`), Infinity, f.session.documentId, f.session.projectId);
  assert.ok(afterRead.libraryBlocks.some(block => block.id === blockId && block.properties.text === 'A heron beside a quiet lake'));
  assert.deepEqual(await rows(f.DB, 'experience_guest_plan_custodies'), mappings);
  assert.deepEqual((await rows(f.DB, 'private_content')).filter(row => row.owner_id === owner), privateCopies);
  assert.deepEqual(await streamHistory(f.DB, `creative:${f.session.guestSubject}`), original, 'guest event/private-body/client-receipt history is unchanged');
  assert.deepEqual((await rows(f.DB, 'private_content')).filter(row => row.owner_id === f.session.guestSubject),
    before.private_content.filter(row => row.owner_id === f.session.guestSubject), 'original guest draft ownership, bytes and expiry are unchanged');
  for (const table of ['experience_guest_sessions', 'experience_guest_claim_leases', 'experience_guest_policies', 'experience_guest_source_policies',
    'experience_guest_sources', 'experience_guest_source_commits', 'experience_guest_context_adoptions']) {
    assert.deepEqual(await rows(f.DB, table), before[table], `original custody history unchanged: ${table}`);
  }
  assert.deepEqual(await snapshot(f.DB, financialTables), f.financialBefore, 'plan custody does not change accounts, jobs, grants or financial reservations');
  assert.deepEqual((await f.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  const retention = f.observed.records.slice(phaseStart);
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', memory, executedStatements: f.observed.records.length,
    retainedPlanPhaseStatements: retention.length, maxBindings: Math.max(...retention.map(row => row.parameters)), maxSqlBytes: Math.max(...retention.map(row => row.sqlBytes)) }));
});
