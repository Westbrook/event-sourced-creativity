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
  { SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA }, { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA, SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA }, { SPONSOR_NATIVE_IMAGE_READ_INDEXES }] = await Promise.all([
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
  import('../worker/experience-sponsor-native-image-read.ts'),
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
  ...SPONSOR_INTAKE_READ_POLICY_SCHEMA, ...SPONSOR_INTAKE_READ_APPROVAL_SCHEMA];

// Forward every application statement to actual workerd D1. Optional hooks add
// explicit fixture changes in the native batch, or simulate lost acknowledgments;
// they never interpret SQL or manufacture database result rows.
function observedDatabase(raw, diagnostic) {
  const handles = new WeakMap(), observed = { records: [], batches: [], batchErrors: [], readOnly: false, beforeBatch: null, afterBatch: null };
  function record(row) {
    if (row.bindings.length > 100 || Buffer.byteLength(row.sql) > 100000) diagnostic(`Actual statement exceeds D1 limits: bindings=${row.bindings.length}; SQL bytes=${Buffer.byteLength(row.sql)}`);
    assert.ok(row.bindings.length <= 100, `D1 bindings=${row.bindings.length}`); assert.ok(Buffer.byteLength(row.sql) <= 100000, `D1 SQL bytes=${Buffer.byteLength(row.sql)}`);
    if (observed.readOnly) {
      assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'exact SAVE/read/retirement replay must be read-only');
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
      catch (error) { observed.batchErrors.push(String(error)); diagnostic(`Actual D1 batch failed: ${String(error)}`); throw error; }
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
async function fixture(t, { schemaVersion = 2, lifetime = 15000 } = {}) {
  const memory = true, optional = true, custody = true, maximum = true, operationCap = 100;
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-schema-alternatives-d1-')), egress = [], media = [];
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
    ...optionalSchema, ...(schemaVersion === 2 ? SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA : SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA),
    ...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_PLAN_CUSTODY_SCHEMA, ...SPONSOR_NATIVE_IMAGE_READ_INDEXES.map(index => index.sql)]) await DB.prepare(sql).run();
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
  observed.records.length = 0; observed.batches.length = 0; observed.batchErrors.length = 0;
  return { DB, env, observed, session, proof, terms, sourcePolicy, prepared, committed, inventory, native, release, subject, compiled, approvalId,
    originalEvents, sourceContext, input, memory, optional, custody, maximum, schemaVersion,
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
    schemaVersion: f.schemaVersion, observedStatements: phase.length, maxBindings: Math.max(...phase.map(row => row.parameters)),
    maxSqlBytes: Math.max(...phase.map(row => row.sqlBytes)), maxBoundTextBytes: Math.max(...phase.map(row => row.maxBoundTextBytes)),
    maxStatementBoundTextBytes: Math.max(...phase.map(row => row.totalBoundTextBytes)) }));
}
const retire = f => retireExpiredGuestImageOutput(f.env, { sessionId: f.session.sessionId });

const isSave = records => records.some(row => /INSERT INTO output_commands\b/u.test(row.sql));
function saveReceipt(f, saved, replayed) {
  assert.deepEqual(Object.keys(saved).sort(), ['status', 'documentId', 'requirementId', 'commandKey', 'eventId', 'revision', 'replayed', 'planConfirmed', 'admissionCommitted', 'generationAvailable', 'custodyTransferred'].sort());
  assert.equal(saved.status, 'saved'); assert.equal(saved.documentId, f.prepared.plan.documentId); assert.equal(saved.revision, 9); assert.equal(saved.replayed, replayed);
  for (const key of ['planConfirmed', 'admissionCommitted', 'generationAvailable', 'custodyTransferred']) assert.equal(saved[key], false);
  assert.ok(Object.isFrozen(saved)); for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken, payer]) assert.ok(!JSON.stringify(saved).includes(secret));
}
async function onlySaveChanged(f, saved, before) {
  const after = await snapshot(f.DB), allowed = new Set(['events', 'event_private_payloads', 'output_commands', 'experience_sponsor_resource_receipts']);
  assert.deepEqual(after.schema, before.schema, 'SAVE cannot provision or switch a schema variant');
  for (const [table, content] of Object.entries(before.contents)) {
    if (!allowed.has(table)) assert.deepEqual(after.contents[table], content, `unchanged ${table}`);
    else { assert.equal(after.contents[table].length, content.length + 1, `exactly one new ${table} row`); assert.deepEqual(after.contents[table].slice(0, -1), content); }
  }
  const event = after.contents.events.at(-1), body = after.contents.event_private_payloads.at(-1), command = after.contents.output_commands.at(-1), resource = after.contents.experience_sponsor_resource_receipts.at(-1);
  assert.equal(event.event_id, saved.eventId); assert.equal(event.sequence, 9); assert.equal(event.type, 'BlockCreated');
  assert.equal(event.client_id, 'server:guest-output'); assert.equal(event.actor, f.session.guestSubject); assert.equal(event.correlation_id, saved.commandKey);
  assert.equal(body.private_event_id, saved.eventId); assert.equal(body.owner_id, f.session.guestSubject); assert.equal(body.document_id, saved.documentId); assert.equal(body.redacted_at, null);
  const payload = JSON.parse(body.private_json), envelope = payload.output_command_envelope;
  assert.equal(payload.block_id, saved.requirementId); assert.equal(envelope.action, 'save'); assert.equal(envelope.blockId, saved.requirementId);
  assert.equal(envelope.experienceBinding.draftHash, f.prepared.plan.draftHash);
  assert.equal(command.event_id, saved.eventId); assert.equal(command.command_key, saved.commandKey); assert.equal(command.actor_user_id, f.session.guestSubject);
  assert.equal(command.request_digest, (await digest(envelope)).slice(7)); assert.equal(command.action, 'save');
  assert.equal(resource.resource_id, saved.commandKey + ':text'); assert.equal(resource.actor_user_id, f.session.guestSubject);
  assert.equal(resource.payload_digest, await digest(envelope)); assert.equal(resource.text_bytes, Buffer.byteLength(canonicalJson(f.sourceContext.snapshot)));
  assert.equal(resource.operation, 'text-intake'); assert.equal(resource.issued_grant_id, null);
  assert.deepEqual((await f.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  return after;
}
async function replaceEmptyAttemptSchemaWithV2(f) {
  assert.deepEqual(await rows(f.DB, 'experience_sponsor_intake_read_attempts', true), []);
  // This explicit isolated fixture switch models an administrator changing an
  // empty schema between witness capture and mutation. Application code never
  // performs a migration, replacement or re-provisioning.
  await f.DB.prepare('DROP TABLE experience_sponsor_intake_read_attempts').run();
  for (const sql of SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA) await f.DB.prepare(sql).run();
  f.schemaVersion = 2;
  const rowsNow = await snapshot(f.DB);
  assert.ok(rowsNow.schema.some(row => row.name === 'experience_sponsor_intake_read_attempts' && row.sql === SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA[0]));
  return rowsNow;
}

test('local workerd D1 accepts complete V2 for native SAVE, replay, read and due retirement with full optional families', { timeout: 120000 }, async t => {
  const f = await fixture(t), before = await snapshot(f.DB), start = f.observed.records.length;
  assert.ok(before.schema.some(row => row.name === 'experience_sponsor_intake_read_attempts' && row.sql === SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA[0]));
  const saved = await f.save(); saveReceipt(f, saved, false); const afterSave = await onlySaveChanged(f, saved, before);
  f.observed.readOnly = true; assert.deepEqual(await f.read(), { ...saved, replayed: true }); assert.deepEqual(await f.save(), { ...saved, replayed: true });
  assert.deepEqual(await snapshot(f.DB), afterSave); f.observed.readOnly = false;
  await due(f); await revokeAndDrift(f); await retireSource(f, saved);
  const beforeRetirement = await snapshot(f.DB), began = await databaseNow(f), result = await retire(f), ended = await databaseNow(f);
  const { after, retired } = await onlyTailChanged(f, saved, beforeRetirement, began, ended); receipt(f, saved, result, retired, false);
  f.observed.readOnly = true; receipt(f, saved, await retire(f), retired, true); assert.deepEqual(await snapshot(f.DB), after);
  metrics(t, f, start);
});

test('local workerd D1 refuses a late V1-to-V2 schema switch and accepts a fresh explicit V2 SAVE', { timeout: 120000 }, async t => {
  const f = await fixture(t, { schemaVersion: 1, lifetime: 120000 }), before = await snapshot(f.DB), start = f.observed.records.length;
  let switched = null, attempts = 0;
  f.observed.beforeBatch = async (_items, records) => {
    if (!isSave(records)) return;
    attempts++; assert.equal(attempts, 1, 'uncertain/stale schema handling cannot automatically submit a second SAVE');
    switched = await replaceEmptyAttemptSchemaWithV2(f);
    assert.deepEqual(switched.contents, before.contents, 'explicit fixture schema replacement leaves all data unchanged');
  };
  await assert.rejects(f.save()); assert.equal(attempts, 1); assert.ok(switched); f.observed.beforeBatch = null;
  assert.equal(f.observed.batchErrors.length, 1); assert.match(f.observed.batchErrors[0], /CHECK constraint failed: passed=1/u);
  assert.equal(f.observed.batches.filter(statements => statements.some(sql => /INSERT INTO output_commands\b/u.test(sql))).length, 1,
    'exactly one proposed SAVE reaches the actual native batch');
  assert.deepEqual(await snapshot(f.DB), switched, 'stale-schema batch rolls back all proposed SAVE and resource writes');
  f.observed.readOnly = true; assert.equal(await f.read(), null); assert.deepEqual(await snapshot(f.DB), switched); f.observed.readOnly = false;
  const saved = await f.save(); saveReceipt(f, saved, false); const after = await onlySaveChanged(f, saved, switched);
  f.observed.readOnly = true; assert.deepEqual(await f.read(), { ...saved, replayed: true }); assert.deepEqual(await f.save(), { ...saved, replayed: true });
  assert.deepEqual(await snapshot(f.DB), after); metrics(t, f, start);
});
