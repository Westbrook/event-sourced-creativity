import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [{ ensureSchema }, { GUEST_CUSTODY_SCHEMA, GUEST_DB_NOW, issueGuestClaimSession, readGuestCustodyTerms },
  { GUEST_SOURCE_SCHEMA, readGuestSourcePolicy, prepareGuestImageSource, commitGuestImageSource },
  { inspectGuestContextInventory, guestContextInventoryData }, { saveGuestImageRequirement, readGuestImageRequirement },
  { acquireGuestContextClaimLease }, { SPONSOR_ENTITLEMENT_SCHEMA }, { SPONSOR_RESOURCE_SCHEMA }, { SPONSOR_APPROVAL_SCHEMA },
  { approveGuestSponsorCampaign }, { compileGuestSponsorApprovalProposal }, { preflightOutputImageSlidesTarget },
  { sponsorImageTransport }, { registeredExperience, initialValues }, { canonicalJson, digest }, { POLICY_VERSION },
  { SPONSOR_ISSUER_SCHEMA }, { SPONSOR_DRIVER_SCHEMA }, { SPONSOR_INTAKE_SCHEMA },
  { SPONSOR_READ_POLICY_SCHEMA }, { SPONSOR_READ_APPROVAL_SCHEMA }, { SPONSOR_READ_ATTEMPT_SCHEMA },
  { SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA }, { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA }] = await Promise.all([
  import('../worker/runtime.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'), import('../worker/experience-guest-image-output.ts'),
  import('../worker/experience-guest-claim-lease.ts'), import('../worker/experience-sponsor-entitlement.ts'),
  import('../worker/experience-sponsor-resources.ts'), import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-approval.ts'), import('../worker/experience-guest-sponsor-contract.ts'),
  import('../worker/output-image-slides-preflight.ts'), import('../worker/experience-sponsor-image-evidence.ts'),
  import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'), import('../worker/policy-version.ts'),
  import('../worker/experience-sponsor-issuer.ts'), import('../worker/experience-sponsor-driver.ts'), import('../worker/experience-sponsor-intake.ts'),
  import('../worker/experience-sponsor-read-policy.ts'), import('../worker/experience-sponsor-read-approval.ts'), import('../worker/experience-sponsor-read-attempts.ts'),
  import('../worker/experience-sponsor-intake-read-policy.ts'), import('../worker/experience-sponsor-intake-read-approval.ts'), import('../worker/experience-sponsor-intake-read-attempts.ts'),
]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid', payer = 'synthetic-payer', time = '2020-01-01T00:00:00.000Z';
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const request = () => new Request(`${origin}/unregistered-guest-image-output`, { method: 'POST', headers: { origin } });
const claimRequest = () => new Request(`${origin}/unregistered-context-claim`, { method: 'POST',
  headers: { origin, 'oai-authenticated-user-id': payer, 'oai-authenticated-user-email': `${payer}@example.invalid` } });
const proofFor = session => ({ sessionId: session.sessionId, sessionToken: session.sessionToken, claimToken: session.claimToken });
const statements = sql => sql.split('--> statement-breakpoint').map(part => part.trim()).filter(Boolean);
const optionalSchema = [...SPONSOR_ISSUER_SCHEMA, ...SPONSOR_DRIVER_SCHEMA, ...SPONSOR_INTAKE_SCHEMA,
  ...SPONSOR_READ_POLICY_SCHEMA, ...SPONSOR_READ_APPROVAL_SCHEMA, ...SPONSOR_READ_ATTEMPT_SCHEMA,
  ...SPONSOR_INTAKE_READ_POLICY_SCHEMA, ...SPONSOR_INTAKE_READ_APPROVAL_SCHEMA, ...SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA];

// Forward every application statement to actual workerd D1. Optional hooks add
// explicit fixture changes in the native batch, or simulate lost acknowledgments;
// they never interpret SQL or manufacture database result rows.
function observedDatabase(raw, diagnostic) {
  const handles = new WeakMap(), observed = { records: [], batches: [], readOnly: false, beforeBatch: null, afterBatch: null };
  function record(row) {
    if (row.bindings.length > 100 || Buffer.byteLength(row.sql) > 100000) diagnostic(`Actual statement exceeds D1 limits: bindings=${row.bindings.length}; SQL bytes=${Buffer.byteLength(row.sql)}`);
    assert.ok(row.bindings.length <= 100, `D1 bindings=${row.bindings.length}`); assert.ok(Buffer.byteLength(row.sql) <= 100000, `D1 SQL bytes=${Buffer.byteLength(row.sql)}`);
    if (observed.readOnly) {
      assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'Lease replay must be read-only');
      assert.doesNotMatch(row.sql, /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu);
    }
    observed.records.push({ sql: row.sql, parameters: row.bindings.length, sqlBytes: Buffer.byteLength(row.sql),
      maxBoundTextBytes: Math.max(0, ...row.bindings.map(value => typeof value === 'string' ? Buffer.byteLength(value) : 0)),
      totalBoundTextBytes: row.bindings.reduce((total, value) => total + (typeof value === 'string' ? Buffer.byteLength(value) : 0), 0) });
  }
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings };
    const wrapped = {
      bind(...args) { return wrap(statement.bind(...args), sql, args); },
      async first(...args) { record(row); try { return await statement.first(...args); } catch (error) { diagnostic(`Actual D1 read failed: ${String(error)}; bindings=${bindings.length}; bytes=${Buffer.byteLength(sql)}`); throw error; } },
      async all(...args) { record(row); return statement.all(...args); },
      async run(...args) { record(row); return statement.run(...args); },
    };
    handles.set(wrapped, row); return wrapped;
  }
  observed.DB = {
    prepare(sql) { return wrap(raw.prepare(sql), sql); },
    async batch(items) {
      const original = items.map(item => handles.get(item)); assert.ok(original.every(Boolean));
      if (observed.beforeBatch) items = await observed.beforeBatch(items, original) ?? items;
      const rows = items.map(item => handles.get(item)); assert.ok(rows.every(Boolean));
      rows.forEach(record); observed.batches.push(rows.map(row => row.sql));
      let result;
      try { result = await raw.batch(rows.map(row => row.statement)); }
      catch (error) { diagnostic(`Actual D1 batch failed: ${String(error)}`); throw error; }
      if (observed.afterBatch) await observed.afterBatch(rows);
      return result;
    },
  };
  return observed;
}
async function rows(db, table, withoutRowid = false) {
  const values = (await db.prepare(`SELECT * FROM ${quote(table)}${withoutRowid ? '' : ' ORDER BY rowid'}`).all()).results;
  return withoutRowid ? values.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))) : values;
}
async function snapshot(db) {
  const schema = (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results, contents = {};
  for (const row of schema.filter(row => row.type === 'table' && !row.name.startsWith('_cf_'))) contents[row.name] = await rows(db, row.name, /WITHOUT\s+ROWID/iu.test(row.sql ?? ''));
  return { schema, contents };
}

async function templateFor(env, release) {
  const offered = await preflightOutputImageSlidesTarget({ env,
    target: { id: 'synthetic-template', selected: true, blocking_issues: [], media_kind: 'image', source_scope: { kind: 'document' },
      aspect_ratio: { width: 1, height: 1 }, instruction_text: 'Show a pear orchard', label: 'Synthetic template', coverage: { kind: 'document_outline' } },
    context: { snapshot: { facts: [{ type: 'subject', properties: { text: 'A pear orchard' } }] } } });
  assert.equal(offered.available, true);
  const settings = offered.settings, payload = settings.payload;
  return { version: 2, appId: 'image', recipeVersion: `image@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: 'image', inputMode: 'text-only', outputCount: 1, durationMs: 0, width: 1024, height: 1024,
    route: offered.route, maximumCalls: offered.maximumCalls, maximumTokens: offered.maximumTokens, maximumMicrousd: offered.maximumMicrousd,
    calls: structuredClone(settings.calls), settings: { kind: settings.kind, productionMode: payload.productionMode,
      budgetAcknowledged: payload.budgetAcknowledged, preflightAcknowledged: payload.preflightAcknowledged,
      imageRender: structuredClone(settings.imageRender), imageBudget: structuredClone(settings.imageBudget), executionPolicy: structuredClone(settings.executionPolicy) },
    transport: await sponsorImageTransport(env) };
}
async function fixture(t, { memory = false, optional = false, maximum = false, operationCap = 100, lifetime = 120000, leaseLifetimeMs = 120000 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-context-lease-d1-')), egress = [], media = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default {fetch(){return new Response('Local D1 fixture only.',{status:404});}};",
    d1Databases: ['Output'], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: req => { egress.push(req.url); throw Error('Worker egress forbidden.'); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); assert.deepEqual(media, []); });
  const raw = await mf.getD1Database('Output'), observed = observedDatabase(raw, message => t.diagnostic(message)), DB = observed.DB;
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Application fetch forbidden.'); });
  const env = { DB, OPENAI_API_KEY: 'no-network-fixture', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: 'gpt-image-2',
    MEDIA: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map(method => [method, () => { media.push(method); throw Error('Media forbidden.'); }])),
    ASSETS: { fetch() { egress.push('assets'); throw Error('Assets forbidden.'); } } };
  // Schema installation and the one existing synthetic payer row are fixture
  // setup only. No canonical guest row or lifecycle/session helper is used.
  await ensureSchema(env);
  for (const sql of [...GUEST_CUSTODY_SCHEMA, ...GUEST_SOURCE_SCHEMA, ...SPONSOR_ENTITLEMENT_SCHEMA, ...SPONSOR_RESOURCE_SCHEMA, ...SPONSOR_APPROVAL_SCHEMA,
    ...(optional ? optionalSchema : [])]) await DB.prepare(sql).run();
  if (memory) for (const name of ['0027_memory_native_origins.sql', '0033_memory_structured_answer_provenance.sql', '0034_memory_document_job_origins.sql'])
    await DB.batch(statements(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8')).map(sql => DB.prepare(sql)));
  await DB.prepare('INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(payer, `${payer}@example.invalid`, payer, 'creator', POLICY_VERSION, time, time, time).run();
  const now = (await DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value;
  const terms = readGuestCustodyTerms({ version: 1, policyId: 'synthetic-guest-policy', origin, startsAtMs: now - 60000, expiresAtMs: now + 600000,
    sessionLifetimeMs: 300000, leaseLifetimeMs, maximumSessions: 5, maximumLeaseAcquisitions: 3 });
  await DB.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').bind(terms.policyId, await digest(terms), canonicalJson(terms), `sha256:${'b'.repeat(64)}`).run();
  const session = await issueGuestClaimSession(request(), env, terms.policyId), proof = proofFor(session), release = await registeredExperience('image'), values = initialValues(release);
  const subject = maximum ? '界'.repeat(release.interactions.subject.maxLength) : 'A blue heron on a stone bridge';
  values.subject = { value: subject, provenance: 'authored' }; values.ratio = { value: { width: 1, height: 1 }, provenance: 'authored' };
  for (const key of ['composition', 'lighting']) values[key] = { value: [...release.interactions[key].options].sort((a, b) => b.value.length - a.value.length)[0].value, provenance: 'authored' };
  const sourcePolicy = readGuestSourcePolicy({ version: 1, policyId: 'synthetic-source-policy', sessionPolicyId: terms.policyId,
    sessionTermsDigest: await digest(terms), releaseHash: release.releaseHash, maximumDraftBytes: 65536, maximumEventBytes: 65536, maximumEvents: 16, draftLifetimeMs: lifetime });
  await DB.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').bind(sourcePolicy.policyId, await digest(sourcePolicy), canonicalJson(sourcePolicy), `sha256:${'c'.repeat(64)}`).run();
  const prepared = await prepareGuestImageSource(request(), env, { proof, policyId: sourcePolicy.policyId,
    request: { intentId: session.sessionId, experienceId: 'image', releaseHash: release.releaseHash, values } });
  const committed = await commitGuestImageSource(request(), env, { proof, draftHash: prepared.plan.draftHash });
  const inventory = await inspectGuestContextInventory(request(), env, { proof }), native = guestContextInventoryData(env, inventory);
  assert.equal(prepared.plan.events.length, 8, 'all eight original events reachable through the current Image compiler are present');
  const template = await templateFor(env, release), allowance = { maximumOperations: operationCap, maximumTextBytes: 1000000,
    maximumOperationsPerWindow: operationCap, maximumTextBytesPerWindow: 1000000, maximumPendingGrants: 10, maximumInflightJobs: 1 };
  const resources = { version: 1, startsAtMs: now - 60000, expiresAtMs: now + 600000, windowMs: 60000, maximumOperationTextBytes: 65536,
    campaign: { ...allowance, maximumInflightJobs: 3 }, actor: { ...allowance } };
  const proposal = { version: 1, purpose: 'guest-sponsored-image', issuerProtocol: 'guest-image-source@1', policy: {
    version: 3, mode: 'candidate', campaignId: 'synthetic-guest-campaign', policyVersion: 'synthetic-guest@1', payerUserId: payer,
    audience: 'guest-session', startsAtMs: resources.startsAtMs, expiresAtMs: resources.expiresAtMs,
    maximumGrantLifetimeMs: 30000, maximumAdmissions: 10, maximumMicrousd: Math.max(1000000, template.maximumMicrousd * 10), maximumAdmissionsPerActor: 5,
    windowMs: 60000, maximumAdmissionsPerWindow: 10, maximumAdmissionsPerActorWindow: 5, templates: [template], resources,
    guestAdmission: { protocol: 'guest-image-source@1', origin, sessionPolicyId: terms.policyId, sessionTermsDigest: await digest(terms),
      sourcePolicyId: sourcePolicy.policyId, sourcePolicyDigest: await digest(sourcePolicy), releaseHash: release.releaseHash },
  } };
  const compiled = await compileGuestSponsorApprovalProposal(proposal), approvalId = 'synthetic-approval';
  const approval = await approveGuestSponsorCampaign(new Request(`${origin}/unregistered-payer-approval`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': payer, 'oai-authenticated-user-email': `${payer}@example.invalid` },
    body: JSON.stringify({ version: 1, action: 'approve-guest-sponsor-campaign', approvalId, proposal,
      reviewedTermsDigest: compiled.termsDigest, confirmation: 'APPROVE_GUEST_SPONSOR_CAMPAIGN' }) }), env);
  assert.equal(approval.replayed, false); assert.equal(approval.generationAvailable, false);
  const input = { proof, campaignId: compiled.policy.campaignId, policyDigest: compiled.policyDigest, draftHash: prepared.plan.draftHash };
  assert.deepEqual((await rows(DB, 'users')).map(row => row.user_id), [payer]);
  observed.records.length = 0; observed.batches.length = 0;
  return { DB, env, observed, session, proof, terms, sourcePolicy, prepared, committed, inventory, native, release, subject, compiled, approvalId,
    input, memory, optional, maximum,
    claim: (requestId = 'synthetic-claim-1', changes = {}) => acquireGuestContextClaimLease(claimRequest(), env, { proof, requestId, inventory, ...changes }),
    save: () => saveGuestImageRequirement(request(), env, input), read: () => readGuestImageRequirement(request(), env, input) };
}
function metrics(t, f) {
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', memory: f.memory, optionalSponsorFamilies: f.optional,
    originalPrefix: f.prepared.plan.events.length, sourceMaximumEvents: f.sourcePolicy.maximumEvents, subjectCharacters: f.subject.length, subjectUtf8Bytes: Buffer.byteLength(f.subject),
    executedStatements: f.observed.records.length, maxBindings: Math.max(...f.observed.records.map(row => row.parameters)),
    maxSqlBytes: Math.max(...f.observed.records.map(row => row.sqlBytes)), maxBoundTextBytes: Math.max(...f.observed.records.map(row => row.maxBoundTextBytes)),
    maxStatementBoundTextBytes: Math.max(...f.observed.records.map(row => row.totalBoundTextBytes)), applicationBatches: f.observed.batches.length }));
}
const isLease = records => records.some(row => /(?:INSERT INTO|UPDATE) experience_guest_claim_leases\b/u.test(row.sql));
function injectAfterLeaseMutation(items, records, statement) {
  const index = records.findIndex(row => /(?:INSERT INTO|UPDATE) experience_guest_claim_leases\b/u.test(row.sql));
  assert.ok(index >= 0); assert.ok(records.slice(index + 1).some(row => /^\s*INSERT INTO output_atomic_assertions\b/u.test(row.sql)));
  const result = [...items]; result.splice(index + 1, 0, statement); return result;
}
function expectLease(f, value, acquisition = 1) {
  assert.deepEqual(Object.keys(value).sort(), ['version', 'status', 'leaseId', 'acquisition', 'destinationUserId', 'guestSubject', 'projectId', 'documentId', 'manifestDigest', 'expiresAtMs', 'custodyTransferred'].sort());
  assert.equal(value.version, 1); assert.equal(value.status, 'claiming'); assert.equal(value.acquisition, acquisition);
  assert.equal(value.destinationUserId, payer); assert.equal(value.guestSubject, f.session.guestSubject);
  assert.equal(value.projectId, f.prepared.plan.projectId); assert.equal(value.documentId, f.prepared.plan.documentId);
  assert.equal(value.manifestDigest, f.inventory.manifestDigest); assert.equal(value.custodyTransferred, false); assert.ok(Object.isFrozen(value));
  for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken]) assert.ok(!JSON.stringify(value).includes(secret));
}
async function assertLeaseOnly(f, before, receipt, requestIds) {
  const after = await snapshot(f.DB); assert.deepEqual(after.schema, before.schema);
  for (const [table, content] of Object.entries(before.contents)) if (table !== 'experience_guest_claim_leases')
    assert.deepEqual(after.contents[table], content, `unchanged ${table}`);
  assert.equal(after.contents.experience_guest_claim_leases.length, 1);
  const row = after.contents.experience_guest_claim_leases[0];
  assert.deepEqual({ ...row, created_at_ms: 0 }, { session_id: f.session.sessionId, lease_id: receipt.leaseId, destination_user_id: payer,
    manifest_digest: f.inventory.manifestDigest, request_id: requestIds.at(-1), request_ids_json: JSON.stringify(requestIds),
    acquisitions: requestIds.length, created_at_ms: 0, expires_at_ms: receipt.expiresAtMs });
  assert.ok(Number.isSafeInteger(row.created_at_ms)); assert.ok(row.created_at_ms < row.expires_at_ms);
  assert.ok(row.expires_at_ms <= f.session.expiresAtMs); return after;
}
async function waitForLeaseExpiry(f) {
  while ((await f.DB.prepare(`SELECT expires_at_ms>${GUEST_DB_NOW} AS active FROM experience_guest_claim_leases`).first()).active)
    await new Promise(resolve => setTimeout(resolve, 50));
}

for (const memory of [false, true]) test(`local workerd D1 acquires a source-bound context lease and exact read-only replay with ${memory ? 'full' : 'absent'} Memory`, { timeout: 120000 }, async t => {
  const f = await fixture(t, { memory, maximum: true, optional: memory }), before = await snapshot(f.DB);
  const receipt = await f.claim(); expectLease(f, receipt);
  const after = await assertLeaseOnly(f, before, receipt, ['synthetic-claim-1']);
  f.observed.readOnly = true; assert.deepEqual(await f.claim(), receipt); assert.deepEqual(await snapshot(f.DB), after); f.observed.readOnly = false;
  await assert.rejects(f.save(), 'lease-first ordering refuses SAVE'); assert.deepEqual(await snapshot(f.DB), after);
  metrics(t, f);
});

test('local workerd D1 stale native inventory after SAVE writes no lease and keeps the exact SAVE re-openable', { timeout: 120000 }, async t => {
  const f = await fixture(t, { optional: true }), saved = await f.save(), before = await snapshot(f.DB);
  assert.equal(saved.replayed, false); await assert.rejects(f.claim());
  assert.deepEqual(await snapshot(f.DB), before); assert.deepEqual(await rows(f.DB, 'experience_guest_claim_leases'), []);
  f.observed.readOnly = true; assert.deepEqual(await f.read(), { ...saved, replayed: true });
  assert.deepEqual(await f.save(), { ...saved, replayed: true }); assert.deepEqual(await snapshot(f.DB), before);
  metrics(t, f);
});

test('local workerd D1 final context lease guard rolls back late private-source mutation then resolves one lost acknowledgment', { timeout: 120000 }, async t => {
  const f = await fixture(t, { memory: true, optional: true }), before = await snapshot(f.DB); let attempts = 0;
  f.observed.beforeBatch = (items, records) => {
    if (!isLease(records)) return; attempts++;
    return injectAfterLeaseMutation(items, records, f.DB.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").bind(f.committed.eventIds.at(-1)));
  };
  await assert.rejects(f.claim()); assert.equal(attempts, 1); assert.deepEqual(await snapshot(f.DB), before);
  f.observed.beforeBatch = null; let lost = 0;
  f.observed.afterBatch = records => { if (isLease(records)) { lost++; throw Error('Synthetic lost lease acknowledgment after actual commit'); } };
  const receipt = await f.claim(); expectLease(f, receipt); assert.equal(lost, 1); f.observed.afterBatch = null;
  const after = await assertLeaseOnly(f, before, receipt, ['synthetic-claim-1']);
  f.observed.readOnly = true; assert.deepEqual(await f.claim(), receipt); assert.deepEqual(await snapshot(f.DB), after); f.observed.readOnly = false;
  await f.DB.prepare("UPDATE users SET consent_version='synthetic-expired-consent' WHERE user_id=?").bind(payer).run();
  const revoked = await snapshot(f.DB); f.observed.readOnly = true; await assert.rejects(f.claim()); assert.deepEqual(await snapshot(f.DB), revoked);
  metrics(t, f);
});

test('local workerd D1 concurrent acquisition and expired renewal CAS preserve one lease and append-only request history', { timeout: 120000 }, async t => {
  const f = await fixture(t, { leaseLifetimeMs: 5000 }), before = await snapshot(f.DB);
  async function race(ids) {
    let arrivals = 0, release; const barrier = new Promise(resolve => { release = resolve; });
    f.observed.beforeBatch = async (_items, records) => { if (!isLease(records)) return; if (++arrivals === 2) release(); await barrier; };
    const outcomes = await Promise.allSettled(ids.map(id => f.claim(id))); f.observed.beforeBatch = null;
    assert.equal(arrivals, 2, 'both actual pre-reads complete before either native acquisition batch'); return outcomes;
  }
  const initial = await race(['synthetic-claim-1', 'synthetic-claim-1']);
  assert.ok(initial.every(value => value.status === 'fulfilled')); assert.deepEqual(initial[0].value, initial[1].value);
  const first = initial[0].value; expectLease(f, first); const firstSnapshot = await assertLeaseOnly(f, before, first, ['synthetic-claim-1']);
  await waitForLeaseExpiry(f);
  const renewed = await race(['synthetic-claim-2', 'synthetic-claim-2']);
  assert.ok(renewed.every(value => value.status === 'fulfilled')); assert.deepEqual(renewed[0].value, renewed[1].value);
  const second = renewed[0].value; expectLease(f, second, 2); assert.equal(second.leaseId, first.leaseId);
  const secondSnapshot = await assertLeaseOnly(f, before, second, ['synthetic-claim-1', 'synthetic-claim-2']);
  assert.equal(secondSnapshot.contents.experience_guest_claim_leases[0].created_at_ms, firstSnapshot.contents.experience_guest_claim_leases[0].created_at_ms);
  await assert.rejects(f.claim('synthetic-claim-1')); assert.deepEqual(await snapshot(f.DB), secondSnapshot);
  await waitForLeaseExpiry(f);
  const competing = await race(['synthetic-claim-3', 'synthetic-claim-4']);
  assert.equal(competing.filter(value => value.status === 'fulfilled').length, 1);
  const winner = competing.find(value => value.status === 'fulfilled').value; expectLease(f, winner, 3); assert.equal(winner.leaseId, first.leaseId);
  const row = (await rows(f.DB, 'experience_guest_claim_leases'))[0], history = JSON.parse(row.request_ids_json);
  assert.deepEqual(history.slice(0, 2), ['synthetic-claim-1', 'synthetic-claim-2']); assert.ok(['synthetic-claim-3', 'synthetic-claim-4'].includes(history[2]));
  const thirdSnapshot = await assertLeaseOnly(f, before, winner, history);
  assert.equal(row.created_at_ms, firstSnapshot.contents.experience_guest_claim_leases[0].created_at_ms);
  await waitForLeaseExpiry(f); await assert.rejects(f.claim('synthetic-claim-5'));
  assert.deepEqual(await snapshot(f.DB), thirdSnapshot, 'finite acquisition cap cannot refresh lifetime or consume another history slot');
  metrics(t, f);
});
