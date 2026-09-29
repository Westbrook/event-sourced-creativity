import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [{ ensureSchema, readWorkspaceEvents }, { GUEST_CUSTODY_SCHEMA, GUEST_DB_NOW, issueGuestClaimSession, readGuestCustodyTerms },
  { GUEST_SOURCE_SCHEMA, readGuestSourcePolicy, prepareGuestImageSource, commitGuestImageSource },
  { inspectGuestContextInventory, guestContextInventoryData }, { saveGuestImageRequirement, readGuestImageRequirement },
  { retireExpiredGuestImageSource }, { retireExpiredGuestImageOutput },
  { GUEST_CONTEXT_ADOPTION_SCHEMA }, { GUEST_PLAN_CUSTODY_SCHEMA },
  { SPONSOR_ENTITLEMENT_SCHEMA }, { SPONSOR_RESOURCE_SCHEMA }, { SPONSOR_APPROVAL_SCHEMA },
  { approveGuestSponsorCampaign, revokeGuestSponsorCampaign }, { compileGuestSponsorApprovalProposal },
  { preflightOutputImageSlidesTarget }, { sponsorImageTransport }, { registeredExperience, initialValues },
  { canonicalJson, digest }, { POLICY_VERSION }, { authoritativeCreativeContext },
  { SPONSOR_ISSUER_SCHEMA }, { SPONSOR_DRIVER_SCHEMA }, { SPONSOR_INTAKE_SCHEMA },
  { SPONSOR_READ_POLICY_SCHEMA }, { SPONSOR_READ_APPROVAL_SCHEMA }, { SPONSOR_READ_ATTEMPT_SCHEMA },
  { SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA }, { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA }] = await Promise.all([
  import('../worker/runtime.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'), import('../worker/experience-guest-image-output.ts'),
  import('../worker/experience-guest-source-retirement.ts'), import('../worker/experience-guest-image-output-retirement.ts'),
  import('../worker/experience-guest-context-adoption.ts'), import('../worker/experience-guest-plan-custody.ts'),
  import('../worker/experience-sponsor-entitlement.ts'), import('../worker/experience-sponsor-resources.ts'), import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-approval.ts'), import('../worker/experience-guest-sponsor-contract.ts'),
  import('../worker/output-image-slides-preflight.ts'), import('../worker/experience-sponsor-image-evidence.ts'),
  import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'), import('../worker/policy-version.ts'), import('../worker/context-authority.ts'),
  import('../worker/experience-sponsor-issuer.ts'), import('../worker/experience-sponsor-driver.ts'), import('../worker/experience-sponsor-intake.ts'),
  import('../worker/experience-sponsor-read-policy.ts'), import('../worker/experience-sponsor-read-approval.ts'), import('../worker/experience-sponsor-read-attempts.ts'),
  import('../worker/experience-sponsor-intake-read-policy.ts'), import('../worker/experience-sponsor-intake-read-approval.ts'), import('../worker/experience-sponsor-intake-read-attempts.ts'),
]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid', payer = 'synthetic-payer', time = '2020-01-01T00:00:00.000Z';
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const request = () => new Request(`${origin}/unregistered-guest-image-output`, { method: 'POST', headers: { origin } });
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
      assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'retirement replay must be read-only');
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
async function fixture(t, { memory = false, optional = false, custody = false, maximum = false, operationCap = 100, lifetime = 15000 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-output-retirement-d1-')), egress = [], media = [];
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
    ...(optional ? optionalSchema : []), ...(custody ? [...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_PLAN_CUSTODY_SCHEMA] : [])]) await DB.prepare(sql).run();
  if (memory) for (const name of ['0027_memory_native_origins.sql', '0033_memory_structured_answer_provenance.sql', '0034_memory_document_job_origins.sql'])
    await DB.batch(statements(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8')).map(sql => DB.prepare(sql)));
  await DB.prepare('INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(payer, `${payer}@example.invalid`, payer, 'creator', POLICY_VERSION, time, time, time).run();
  const now = (await DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value;
  const terms = readGuestCustodyTerms({ version: 1, policyId: 'synthetic-guest-policy', origin, startsAtMs: now - 60000, expiresAtMs: now + 600000,
    sessionLifetimeMs: 300000, leaseLifetimeMs: 120000, maximumSessions: 5, maximumLeaseAcquisitions: 3 });
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
  const originalEvents = await readWorkspaceEvents(env, prepared.plan.streamId), sourceContext = authoritativeCreativeContext(originalEvents, {
    projectId: prepared.plan.projectId, documentId: prepared.plan.documentId });
  const input = { proof, campaignId: compiled.policy.campaignId, policyDigest: compiled.policyDigest, draftHash: prepared.plan.draftHash };
  assert.deepEqual((await rows(DB, 'users')).map(row => row.user_id), [payer]);
  observed.records.length = 0; observed.batches.length = 0;
  return { DB, env, observed, session, proof, terms, sourcePolicy, prepared, committed, inventory, native, release, subject, compiled, approvalId,
    originalEvents, sourceContext, input, memory, optional, custody, maximum,
    save: () => saveGuestImageRequirement(request(), env, input), read: () => readGuestImageRequirement(request(), env, input) };
}

async function databaseNow(f) { return (await f.DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value; }
async function due(f) {
  const deadline = performance.now() + 30000;
  while (await databaseNow(f) < Date.parse(f.prepared.expiresAt)) {
    assert.ok(performance.now() < deadline, 'the real D1 source deadline must become due');
    await delay(50);
  }
}
function canonicalTime(value) {
  assert.equal(typeof value, 'string'); assert.equal(new Date(value).toISOString(), value);
}
async function tailRow(f, saved) { return f.DB.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').bind(saved.eventId).first(); }
function receipt(f, saved, result, row, replayed) {
  assert.deepEqual(result, { status: 'retired', scope: 'first-save-private-body', sessionId: f.session.sessionId,
    documentId: f.prepared.plan.documentId, requirementId: saved.requirementId, eventId: saved.eventId, redactedAt: row.redacted_at, replayed });
  assert.ok(Object.isFrozen(result));
  for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken, payer]) assert.ok(!JSON.stringify(result).includes(secret));
}
async function onlyTailChanged(f, saved, before, start, finish) {
  const after = await snapshot(f.DB), original = before.contents.event_private_payloads.find(row => row.private_event_id === saved.eventId);
  const retired = after.contents.event_private_payloads.find(row => row.private_event_id === saved.eventId);
  assert.ok(original.private_json.length > 0); assert.equal(original.redacted_at, null);
  assert.equal(retired.private_json, ''); canonicalTime(retired.redacted_at);
  assert.ok(Date.parse(retired.redacted_at) >= start && Date.parse(retired.redacted_at) <= finish, 'retirement timestamp is bounded by actual D1 time');
  assert.deepEqual({ ...retired, private_json: original.private_json, redacted_at: original.redacted_at }, original);
  const expected = structuredClone(before);
  expected.contents.event_private_payloads = expected.contents.event_private_payloads.map(row => row.private_event_id === saved.eventId ? retired : row);
  assert.deepEqual(after, expected, 'only the exact SAVE private bytes and redaction marker may change; all source, public, command, resource, account, financial and schema history is retained');
  assert.deepEqual((await f.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  return { after, retired };
}
async function retireSource(f, saved) {
  const before = await snapshot(f.DB), originalTail = await tailRow(f, saved);
  const result = await retireExpiredGuestImageSource(f.env, { sessionId: f.session.sessionId });
  assert.equal(result.status, 'retired'); assert.equal(result.eventCount, f.committed.eventIds.length);
  const after = await snapshot(f.DB), expected = structuredClone(before), ids = new Set(f.committed.eventIds);
  expected.contents.private_content = expected.contents.private_content.map(row => {
    if (row.content_id !== f.prepared.plan.draftId) return row;
    const erased = after.contents.private_content.find(value => value.content_id === row.content_id);
    assert.equal(erased.content, ''); canonicalTime(erased.redacted_at);
    return { ...row, content: '', redacted_at: erased.redacted_at };
  });
  expected.contents.event_private_payloads = expected.contents.event_private_payloads.map(row => {
    if (!ids.has(row.private_event_id)) return row;
    const erased = after.contents.event_private_payloads.find(value => value.private_event_id === row.private_event_id);
    assert.equal(erased.private_json, ''); canonicalTime(erased.redacted_at);
    return { ...row, private_json: '', redacted_at: erased.redacted_at };
  });
  assert.deepEqual(after, expected, 'accepted source cleanup erases only its original draft/prefix');
  assert.deepEqual(await tailRow(f, saved), originalTail, 'source cleanup never rewrites the first-SAVE tail or its existing tombstone');
}
async function revokeAndDrift(f) {
  const revoked = await revokeGuestSponsorCampaign(new Request(`${origin}/unregistered-payer-revoke`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': payer, 'oai-authenticated-user-email': `${payer}@example.invalid` },
    body: JSON.stringify({ version: 1, action: 'revoke-guest-sponsor-campaign', campaignId: f.compiled.policy.campaignId,
      policyDigest: f.compiled.policyDigest, confirmation: 'REVOKE_GUEST_SPONSOR_CAMPAIGN' }) }), f.env);
  assert.equal(revoked.status, 'revoked');
  // Deliberate local authority/configuration changes after the original deadline.
  // The cleanup API has no Request, credentials, principal or active-policy input.
  await f.DB.prepare(`UPDATE experience_guest_sessions SET revoked_at_ms=${GUEST_DB_NOW} WHERE session_id=?`).bind(f.session.sessionId).run();
  await f.DB.prepare(`UPDATE experience_guest_policies SET revoked_at_ms=${GUEST_DB_NOW} WHERE policy_id=?`).bind(f.terms.policyId).run();
  await f.DB.prepare(`UPDATE experience_guest_source_policies SET revoked_at_ms=${GUEST_DB_NOW} WHERE policy_id=?`).bind(f.sourcePolicy.policyId).run();
  await f.DB.prepare("UPDATE users SET role='viewer',consent_version='synthetic-expired' WHERE user_id=?").bind(payer).run();
  await f.DB.prepare("UPDATE experience_sponsor_campaigns SET policy_digest='changed',policy_json='{}',enabled=0 WHERE campaign_id=?").bind(f.compiled.policy.campaignId).run();
  await f.DB.prepare("UPDATE experience_sponsor_resource_policies SET limits_digest='changed',limits_json='{}',enabled=0 WHERE campaign_id=?").bind(f.compiled.policy.campaignId).run();
  f.env.FORMA_PILOT_COHORT_ID = 'synthetic-disabled-live-authority';
}
function metrics(t, f, start) {
  const phase = f.observed.records.slice(start);
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', memory: f.memory, optionalSponsorFamilies: f.optional, optionalCustodyFamilies: f.custody,
    retirementPhaseObservedStatements: phase.length, maxBindings: Math.max(...phase.map(row => row.parameters)),
    maxSqlBytes: Math.max(...phase.map(row => row.sqlBytes)), maxBoundTextBytes: Math.max(...phase.map(row => row.maxBoundTextBytes)),
    maxStatementBoundTextBytes: Math.max(...phase.map(row => row.totalBoundTextBytes)) }));
}
const isRetirement = records => records.some(row => /^\s*UPDATE event_private_payloads SET private_json\s*=\s*''/iu.test(row.sql));
const retire = f => retireExpiredGuestImageOutput(f.env, { sessionId: f.session.sessionId });

// Actual native source, actual local payer approval and the native first SAVE
// precede cleanup. This is a dormant local retention test, never a public guest
// policy, generated-result deletion, provider operation or financial action.
for (const memory of [false, true]) test(`local workerd D1 retires only the due first-SAVE body with ${memory ? 'complete Memory, sponsor and empty custody schemas, tail-first' : 'absent optional schemas, source-first'} cleanup after authority revocation`, { timeout: 120000 }, async t => {
  const f = await fixture(t, { memory, optional: memory, custody: memory }), saved = await f.save();
  const early = await snapshot(f.DB); f.observed.readOnly = true;
  await assert.rejects(retire(f), /guest_image_output_retirement_not_due/u);
  assert.deepEqual(await snapshot(f.DB), early, 'retirement cannot erase before the original source deadline'); f.observed.readOnly = false;
  await due(f); await revokeAndDrift(f);
  if (!memory) await retireSource(f, saved);
  const before = await snapshot(f.DB), phaseStart = f.observed.records.length, start = await databaseNow(f);
  const result = await retire(f), finish = await databaseNow(f), { after, retired } = await onlyTailChanged(f, saved, before, start, finish);
  receipt(f, saved, result, retired, false);
  f.observed.readOnly = true; receipt(f, saved, await retire(f), retired, true);
  assert.deepEqual(await snapshot(f.DB), after, 'exact tombstone replay never mutates or refreshes retirement'); f.observed.readOnly = false;
  if (memory) {
    await retireSource(f, saved);
    const complete = await snapshot(f.DB); f.observed.readOnly = true;
    receipt(f, saved, await retire(f), retired, true);
    assert.deepEqual(await snapshot(f.DB), complete, 'tail-first then prefix cleanup preserves the original tail tombstone');
  }
  metrics(t, f, phaseStart);
});

test('local workerd D1 late retirement metadata drift rolls back the entire batch and lost ACK resolves one original tombstone', { timeout: 120000 }, async t => {
  const f = await fixture(t), saved = await f.save(); await due(f);
  const before = await snapshot(f.DB), phaseStart = f.observed.records.length; let injected = 0;
  f.observed.beforeBatch = (items, records) => {
    if (!isRetirement(records)) return;
    injected++;
    const guards = records.flatMap((row, index) => /^\s*INSERT INTO output_atomic_assertions\b/u.test(row.sql) ? [index] : []);
    assert.ok(guards.length >= 2, 'native before and after assertions are in the actual retirement batch');
    const changed = [...items];
    changed.splice(guards.at(-1), 0, f.DB.prepare("UPDATE event_private_payloads SET owner_id='synthetic-unrelated-owner' WHERE private_event_id=?").bind(saved.eventId));
    return changed;
  };
  await assert.rejects(retire(f)); assert.equal(injected, 1);
  assert.deepEqual(await snapshot(f.DB), before, 'late final proof failure rolls back erasure, tombstone and injected metadata drift');
  f.observed.beforeBatch = null; let attempts = 0, lost = 0;
  f.observed.beforeBatch = (_items, records) => { if (isRetirement(records)) attempts++; };
  f.observed.afterBatch = records => { if (isRetirement(records)) { lost++; throw Error('Synthetic lost retirement acknowledgment after successful native commit'); } };
  const start = await databaseNow(f), result = await retire(f), finish = await databaseNow(f);
  assert.equal(attempts, 1); assert.equal(lost, 1); f.observed.beforeBatch = null; f.observed.afterBatch = null;
  const { after, retired } = await onlyTailChanged(f, saved, before, start, finish); receipt(f, saved, result, retired, true);
  f.observed.readOnly = true; receipt(f, saved, await retire(f), retired, true);
  assert.deepEqual(await snapshot(f.DB), after, 'uncertain acknowledgment recovery and replay never issue a second mutation');
  metrics(t, f, phaseStart);
});
