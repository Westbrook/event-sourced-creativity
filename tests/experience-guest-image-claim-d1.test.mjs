import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';

registerOutputSourceImports();
const [{ ensureSchema, readWorkspaceEvents, appendAuditEvent, streamHead }, { GUEST_CUSTODY_SCHEMA, GUEST_DB_NOW, issueGuestClaimSession, readGuestCustodyTerms },
  { GUEST_SOURCE_SCHEMA, readGuestSourcePolicy, prepareGuestImageSource, commitGuestImageSource },
  { inspectGuestContextInventory, guestContextInventoryData }, { saveGuestImageRequirement, readGuestImageRequirement },
  { inspectGuestImageSaveInventory, GUEST_IMAGE_SAVE_CLAIM_SCHEMA }, { acquireGuestImageSaveClaimLease }, { claimGuestImageSave, readGuestImageClaim },
  { GUEST_CONTEXT_ADOPTION_SCHEMA }, { GUEST_PLAN_CUSTODY_SCHEMA }, { handleOutputRequirements }, { handleExperienceIntake },
  { SPONSOR_ENTITLEMENT_SCHEMA }, { SPONSOR_RESOURCE_SCHEMA }, { SPONSOR_APPROVAL_SCHEMA },
  { approveGuestSponsorCampaign }, { compileGuestSponsorApprovalProposal },
  { preflightOutputImageSlidesTarget }, { sponsorImageTransport }, { registeredExperience, initialValues },
  { canonicalJson, digest }, { POLICY_VERSION }, { authoritativeCreativeContext },
  { SPONSOR_ISSUER_SCHEMA }, { SPONSOR_DRIVER_SCHEMA }, { SPONSOR_INTAKE_SCHEMA },
  { SPONSOR_READ_POLICY_SCHEMA }, { SPONSOR_READ_APPROVAL_SCHEMA }, { SPONSOR_READ_ATTEMPT_SCHEMA },
  { SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA }, { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA, SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA }, { SPONSOR_NATIVE_IMAGE_READ_INDEXES }] = await Promise.all([
  import('../worker/runtime.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'), import('../worker/experience-guest-image-output.ts'),
  import('../worker/experience-guest-image-claim-inventory.ts'), import('../worker/experience-guest-claim-lease.ts'), import('../worker/experience-guest-image-claim.ts'),
  import('../worker/experience-guest-context-adoption.ts'), import('../worker/experience-guest-plan-custody.ts'), import('../worker/output-requirements-api.ts'), import('../worker/experience-intake-api.ts'),
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
const origin = 'https://guest.example.invalid', payer = 'synthetic-payer', destination = 'synthetic-destination', targetStream = `creative:${destination}`, time = '2020-01-01T00:00:00.000Z';
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const request = () => new Request(`${origin}/unregistered-guest-image-output`, { method: 'POST', headers: { origin } });
const claimRequest = () => new Request(`${origin}/unregistered-image-claim`, { method: 'POST', headers: { origin,
  'oai-authenticated-user-id': destination, 'oai-authenticated-user-email': `${destination}@example.invalid` } });
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
async function fixture(t, { memory = true, maximum = true, lifetime = 120000 } = {}) {
  const schemaVersion = 2, optional = true, custody = true, operationCap = 100;
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-image-claim-d1-')), egress = [], media = [];
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
  // Schema installation and the existing synthetic payer/destination rows are
  // fixture setup only. No canonical guest or lifecycle/session helper is used.
  await ensureSchema(env);
  for (const sql of [...GUEST_CUSTODY_SCHEMA, ...GUEST_SOURCE_SCHEMA, ...SPONSOR_ENTITLEMENT_SCHEMA, ...SPONSOR_RESOURCE_SCHEMA, ...SPONSOR_APPROVAL_SCHEMA,
    ...optionalSchema, ...(schemaVersion === 2 ? SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA : SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA),
    ...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_PLAN_CUSTODY_SCHEMA, ...GUEST_IMAGE_SAVE_CLAIM_SCHEMA, ...SPONSOR_NATIVE_IMAGE_READ_INDEXES.map(index => index.sql)]) await DB.prepare(sql).run();
  if (memory) for (const name of ['0027_memory_native_origins.sql', '0033_memory_structured_answer_provenance.sql', '0034_memory_document_job_origins.sql'])
    await DB.batch(statements(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8')).map(sql => DB.prepare(sql)));
  for (const actor of [payer, destination]) await DB.prepare('INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(actor, `${actor}@example.invalid`, actor, 'creator', POLICY_VERSION, time, time, time).run();
  await appendAuditEvent(env, targetStream, 'user', 'ProjectCreated', { project_id: 'synthetic-existing-one', name: 'Existing canonical work one' });
  await appendAuditEvent(env, targetStream, 'user', 'ProjectCreated', { project_id: 'synthetic-existing-two', name: 'Existing canonical work two' });
  const targetHead = await streamHead(env, targetStream); assert.equal(targetHead, 2);
  const targetHistory = await readWorkspaceEvents(env, targetStream);
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
  assert.deepEqual((await rows(DB, 'users')).map(row => row.user_id).sort(), [destination, payer]);
  const saved = await saveGuestImageRequirement(request(), env, input); assert.equal(saved.replayed, false);
  assert.equal(saved.revision, prepared.plan.events.length + 1);
  const guestHistory = await readWorkspaceEvents(env, prepared.plan.streamId);
  assert.equal(guestHistory.length, prepared.plan.events.length + 1);
  observed.records.length = 0; observed.batches.length = 0; observed.batchErrors.length = 0;
  return { DB, env, observed, session, proof, terms, sourcePolicy, prepared, committed, inventory, native, release, subject, compiled, approvalId,
    originalEvents, sourceContext, input, memory, optional, custody, maximum, schemaVersion, saved, guestHistory, targetHead, targetHistory,
    save: () => saveGuestImageRequirement(request(), env, input), read: () => readGuestImageRequirement(request(), env, input) };
}

async function captureSqlSchema(DB) {
  return (await DB.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name").all()).results.map(row => row.sql);
}
function qualifyActualSqlShapes(t, records, schema) {
  const queries = [...new Set(records.map(row => row.sql).filter(sql => /^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b/iu.test(sql)))];
  assert.ok(queries.length > 0);
  for (const sql of queries) {
    const compiled = compileSqliteExpressionDepth(null, sql, { schema, functions: [], limit: 100,
      queryLimits: { functionArguments: 32, parameters: 100, sqlBytes: 100000 } });
    assert.equal(compiled.ok, true, compiled.error);
    assert.equal(compiled.limit, 100); assert.deepEqual(compiled.queryLimits, { functionArguments: 32, parameters: 100, sqlBytes: 100000 });
  }
  t.diagnostic(JSON.stringify({ qualification: 'independent Python SQLite EXPLAIN of exact emitted SQL and captured actual DDL',
    uniqueStatements: queries.length, expressionDepthLimit: 100, functionArgumentLimit: 32, parameterLimit: 100, sqlByteLimit: 100000 }));
}

function metrics(t, f) {
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', memory: f.memory, sourceHead: f.committed.head,
    sourceSaveHead: f.saved.revision, existingTargetHead: f.targetHead, executedStatements: f.observed.records.length,
    maxBindings: Math.max(...f.observed.records.map(row => row.parameters)), maxSqlBytes: Math.max(...f.observed.records.map(row => row.sqlBytes)),
    maxBoundTextBytes: Math.max(...f.observed.records.map(row => row.maxBoundTextBytes)),
    maxStatementBoundTextBytes: Math.max(...f.observed.records.map(row => row.totalBoundTextBytes)), applicationBatches: f.observed.batches.length }));
}
for (const memory of [false, true]) test(`local workerd D1 genuine N+1 inventory and typed lease canary with ${memory ? 'complete' : 'absent'} Memory`, { timeout: 180000 }, async t => {
  const f = await fixture(t, { memory }), before = await snapshot(f.DB), schema = await captureSqlSchema(f.DB);
  f.observed.readOnly = true;
  const inventory = await inspectGuestImageSaveInventory(request(), f.env, { proof: f.proof });
  assert.deepEqual(Object.keys(inventory).sort(), ['version', 'sessionId', 'guestSubject', 'projectId', 'documentId', 'draftHash', 'sourceHead', 'sourceSaveHead', 'expiresAt', 'manifestDigest'].sort());
  assert.equal(inventory.version, 1); assert.equal(inventory.sessionId, f.session.sessionId); assert.equal(inventory.guestSubject, f.session.guestSubject);
  assert.equal(inventory.projectId, f.prepared.plan.projectId); assert.equal(inventory.documentId, f.prepared.plan.documentId);
  assert.equal(inventory.draftHash, f.prepared.plan.draftHash); assert.equal(inventory.sourceHead, f.prepared.plan.events.length);
  assert.equal(inventory.sourceSaveHead, f.saved.revision); assert.equal(inventory.expiresAt, f.prepared.expiresAt);
  assert.match(inventory.manifestDigest, /^sha256:[a-f0-9]{64}$/u); assert.ok(Object.isFrozen(inventory));
  assert.deepEqual(await snapshot(f.DB), before, 'inventory only reads the existing genuine N+1 source'); f.observed.readOnly = false;
  const input = { proof: f.proof, requestId: 'synthetic-image-claim', inventory };
  const lease = await acquireGuestImageSaveClaimLease(claimRequest(), f.env, input);
  assert.deepEqual(Object.keys(lease).sort(), ['version', 'status', 'leaseId', 'acquisition', 'destinationUserId', 'guestSubject', 'projectId', 'documentId', 'manifestDigest', 'expiresAtMs', 'custodyTransferred'].sort());
  assert.equal(lease.version, 1); assert.ok(Object.isFrozen(lease)); assert.equal(lease.guestSubject, f.session.guestSubject);
  assert.equal(lease.projectId, f.prepared.plan.projectId); assert.equal(lease.documentId, f.prepared.plan.documentId);
  for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken, payer]) assert.ok(!JSON.stringify(lease).includes(secret));
  assert.equal(lease.status, 'claiming'); assert.equal(lease.destinationUserId, destination); assert.equal(lease.manifestDigest, inventory.manifestDigest);
  assert.equal(lease.acquisition, 1); assert.equal(lease.custodyTransferred, false);
  const after = await snapshot(f.DB); assert.deepEqual(after.schema, before.schema);
  for (const [table, rowsBefore] of Object.entries(before.contents)) if (table !== 'experience_guest_claim_leases')
    assert.deepEqual(after.contents[table], rowsBefore, `unchanged ${table}`);
  assert.equal(after.contents.experience_guest_claim_leases.length, 1);
  const leaseRow = after.contents.experience_guest_claim_leases[0];
  assert.equal(leaseRow.session_id, f.session.sessionId); assert.equal(leaseRow.lease_id, lease.leaseId);
  assert.equal(leaseRow.destination_user_id, destination); assert.equal(leaseRow.request_id, input.requestId);
  assert.deepEqual(JSON.parse(leaseRow.request_ids_json), [input.requestId]); assert.equal(leaseRow.manifest_digest, inventory.manifestDigest);
  assert.equal(leaseRow.acquisitions, 1); assert.equal(leaseRow.expires_at_ms, lease.expiresAtMs);
  assert.ok(Number.isSafeInteger(leaseRow.created_at_ms)); assert.ok(leaseRow.created_at_ms >= 0);
  assert.ok(leaseRow.created_at_ms < leaseRow.expires_at_ms); assert.ok(leaseRow.expires_at_ms <= f.session.expiresAtMs);
  f.observed.readOnly = true; assert.deepEqual(await acquireGuestImageSaveClaimLease(claimRequest(), f.env, input), lease);
  assert.deepEqual(await snapshot(f.DB), after); metrics(t, f); qualifyActualSqlShapes(t, f.observed.records, schema);
});

const claimBatch = records => records.some(row => /INSERT INTO experience_guest_image_claims\b/u.test(row.sql));
const claimInput = (f, inventory) => ({ sessionId: f.session.sessionId, requestId: 'synthetic-image-claim', approvedManifestDigest: inventory.manifestDigest, proof: f.proof });
const withoutProof = input => ({ sessionId: input.sessionId, requestId: input.requestId, approvedManifestDigest: input.approvedManifestDigest });
function expectClaim(f, claimed, input) {
  assert.deepEqual(Object.keys(claimed).sort(), ['version', 'status', 'contextCustodyTransferred', 'requirementCustodyTransferred', 'generationAvailable', 'miniAppClaimComplete', 'receipt', 'planRetention', 'retained'].sort());
  assert.equal(claimed.version, 1); assert.equal(claimed.status, 'image-save-claimed');
  assert.equal(claimed.contextCustodyTransferred, true); assert.equal(claimed.requirementCustodyTransferred, true);
  assert.equal(claimed.generationAvailable, false); assert.equal(claimed.miniAppClaimComplete, false);
  assert.equal(claimed.planRetention, 'retained', 'full canonical SAVE and retained original plan must pass the joined current proof');
  assert.deepEqual(claimed.retained.plan, f.prepared.plan); assert.ok(Object.isFrozen(claimed));
  const receipt = claimed.receipt;
  assert.deepEqual(Object.keys(receipt).sort(), ['version', 'status', 'sessionId', 'destinationUserId', 'leaseId', 'requestId', 'manifestDigest', 'projectId', 'documentId', 'requirementId', 'eventId', 'commandKey', 'revision', 'route', 'contextCustodyTransferred', 'requirementCustodyTransferred', 'generationAvailable', 'miniAppClaimComplete', 'replayed'].sort());
  assert.equal(receipt.version, 1); assert.equal(receipt.status, 'image-save-adopted'); assert.ok(Object.isFrozen(receipt));
  assert.equal(receipt.replayed, true, 'receipt describes a canonical current reread, including on the initial invocation');
  assert.equal(receipt.contextCustodyTransferred, true); assert.equal(receipt.requirementCustodyTransferred, true);
  assert.equal(receipt.generationAvailable, false); assert.equal(receipt.miniAppClaimComplete, false);
  assert.equal(receipt.sessionId, f.session.sessionId); assert.equal(receipt.destinationUserId, destination);
  assert.equal(receipt.requestId, input.requestId); assert.equal(receipt.manifestDigest, input.approvedManifestDigest);
  assert.equal(receipt.projectId, f.session.projectId); assert.equal(receipt.documentId, f.session.documentId);
  assert.equal(receipt.requirementId, f.saved.requirementId); assert.equal(receipt.revision, f.targetHead + f.committed.head + 1);
  assert.notEqual(receipt.commandKey, f.saved.commandKey); assert.notEqual(receipt.eventId, f.saved.eventId);
  assert.ok(receipt.route.includes(f.session.documentId));
  for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken, payer, 'private_json', 'guestSponsorPreparation']) assert.ok(!JSON.stringify(receipt).includes(secret));
  assert.equal(claimed.retained.custody.head, receipt.revision - 1);
  assert.equal(claimed.retained.custody.eventIds.length, f.committed.head);
  assert.equal(claimed.retained.generationAvailable, false); assert.equal(claimed.retained.miniAppClaimComplete, false);
  return receipt;
}
async function verifyClaimFootprint(f, before, claimed) {
  const after = await snapshot(f.DB), receipt = claimed.receipt;
  assert.deepEqual(after.schema, before.schema);
  const changed = new Set(['events', 'event_private_payloads', 'event_client_receipts', 'private_content', 'output_commands', 'experience_guest_claim_leases', 'experience_guest_sessions', 'experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_plan_custodies']);
  for (const [table, prior] of Object.entries(before.contents)) if (!changed.has(table)) assert.deepEqual(after.contents[table], prior, `unchanged ${table}`);
  for (const table of ['events', 'event_private_payloads', 'event_client_receipts', 'private_content', 'output_commands']) for (const prior of before.contents[table])
    assert.ok(after.contents[table].some(row => canonicalJson(row) === canonicalJson(prior)), `original ${table} row preserved`);
  assert.deepEqual(await readWorkspaceEvents(f.env, f.prepared.plan.streamId), f.guestHistory);
  const canonical = await readWorkspaceEvents(f.env, targetStream);
  assert.deepEqual(canonical.slice(0, f.targetHead), f.targetHistory);
  for (const [table, count] of [['events', f.committed.head + 1], ['event_private_payloads', f.committed.head + 1], ['event_client_receipts', f.committed.head], ['private_content', 1]])
    assert.equal(after.contents[table].length, before.contents[table].length + count, `exact global ${table} delta`);
  for (let i = 0; i < f.prepared.plan.events.length; i++) {
    const original = f.prepared.plan.events[i], copied = canonical[f.targetHead + i];
    assert.equal(copied.type, original.type);
    assert.deepEqual(copied.payload, { ...original.payload, client_event_id: `guest-context-adoption:v1:${f.session.sessionId}:${i}` });
  }
  const added = after.contents.events.filter(row => row.stream_id === targetStream && row.sequence > f.targetHead);
  assert.equal(added.length, f.committed.head + 1);
  assert.deepEqual(added.map(row => row.sequence), Array.from({ length: f.committed.head + 1 }, (_, i) => f.targetHead + i + 1));
  assert.ok(added.every(row => !f.guestHistory.some(original => original.eventId === row.event_id)));
  assert.ok(added.slice(0, -1).every(row => row.actor === 'user' && row.client_id === 'server:guest-context-adoption'));
  const tail = added.at(-1); assert.equal(tail.event_id, receipt.eventId); assert.equal(tail.actor, `user:${destination}`);
  assert.equal(tail.client_id, 'server:output-requirements'); assert.equal(tail.correlation_id, receipt.commandKey);
  const bodies = after.contents.event_private_payloads.filter(row => added.some(event => event.event_id === row.private_event_id));
  assert.equal(bodies.length, added.length); assert.ok(bodies.every(row => row.owner_id === destination && row.project_id === f.session.projectId && row.redacted_at === null));
  const prefixReceipts = after.contents.event_client_receipts.filter(row => row.stream_id === targetStream);
  assert.equal(prefixReceipts.length - before.contents.event_client_receipts.filter(row => row.stream_id === targetStream).length, f.committed.head);
  assert.ok(!prefixReceipts.some(row => row.event_id === tail.event_id));
  const sourceTail = f.guestHistory.at(-1), targetTail = canonical.at(-1);
  assert.deepEqual(targetTail.payload.properties, sourceTail.payload.properties);
  const envelope = targetTail.payload.output_command_envelope;
  assert.deepEqual(Object.keys(envelope).sort(), ['action', 'documentId', 'expectedRevision', 'clientMutationId', 'blockId', 'spec', 'planSuggestions', 'guestImageClaim'].sort());
  assert.equal(envelope.action, 'save'); assert.equal(envelope.expectedRevision, `output:${receipt.revision - 1}`);
  assert.equal(envelope.clientMutationId, receipt.commandKey); assert.equal(envelope.blockId, f.saved.requirementId);
  assert.deepEqual(envelope.spec, sourceTail.payload.output_command_envelope.spec);
  assert.deepEqual(envelope.planSuggestions, sourceTail.payload.output_command_envelope.planSuggestions);
  assert.equal(after.contents.output_commands.length, before.contents.output_commands.length + 1);
  const command = after.contents.output_commands.find(row => row.event_id === receipt.eventId);
  assert.equal(command.actor_user_id, destination); assert.equal(command.scope_key, `personal:${destination}:${f.session.projectId}`);
  assert.equal(command.command_key, receipt.commandKey); assert.equal(command.action, 'save');
  assert.equal(command.request_digest, (await digest(envelope)).slice(7)); assert.equal(command.created_at, tail.recorded_at);
  const sourceCommand = before.contents.output_commands.find(row => row.event_id === f.saved.eventId);
  assert.deepEqual(envelope.guestImageClaim, { version: 1, sessionId: f.session.sessionId, manifestDigest: receipt.manifestDigest, sourceCommandKey: sourceCommand.command_key, sourceRequestDigest: sourceCommand.request_digest, sourceEventId: f.saved.eventId, guestSubject: f.session.guestSubject });
  for (const table of ['experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_plan_custodies']) assert.equal(after.contents[table].length, 1);
  const adoption = after.contents.experience_guest_context_adoptions[0], mapping = after.contents.experience_guest_image_claims[0];
  assert.equal(mapping.context_lineage_digest, adoption.lineage_digest);
  const prefix = JSON.parse(adoption.lineage_json); assert.equal(prefix.version, 1); assert.equal(prefix.sourceHead, f.committed.head);
  assert.equal(prefix.targetStart, f.targetHead + 1); assert.equal(prefix.targetHead, receipt.revision - 1);
  assert.equal(after.contents.experience_guest_sessions.length, before.contents.experience_guest_sessions.length);
  const session = after.contents.experience_guest_sessions[0];
  assert.deepEqual({ ...session, revoked_at_ms: null }, { ...before.contents.experience_guest_sessions[0], revoked_at_ms: null });
  assert.equal(session.revoked_at_ms, adoption.created_at_ms); assert.equal(mapping.created_at_ms, adoption.created_at_ms);
  const retained = after.contents.experience_guest_plan_custodies[0], copy = after.contents.private_content.find(row => row.content_id === retained.content_id);
  assert.notEqual(copy.content_id, f.prepared.plan.draftId); assert.equal(copy.owner_id, destination); assert.equal(copy.kind, 'experience-draft');
  assert.equal(copy.content, canonicalJson(f.prepared.plan)); assert.equal(retained.draft_hash, f.prepared.plan.draftHash);
  assert.equal(after.contents.experience_guest_claim_leases.length, 1); assert.equal(after.contents.experience_guest_claim_leases[0].acquisitions, 1);
  return after;
}
async function nativeOutput(f, body) {
  const path = '/api/output-requirements', url = body ? `${origin}${path}` : `${origin}${path}?documentId=${encodeURIComponent(f.session.documentId)}`;
  const headers = new Headers(claimRequest().headers); if (body) headers.set('content-type', 'application/json');
  const response = await handleOutputRequirements(new Request(url, { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}) }), f.env, path,
    { waitUntil() { assert.fail('unexpected background/provider work'); } });
  const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
}
for (const memory of [false, true]) test(`local workerd D1 full image claim with ${memory ? 'complete' : 'absent'} Memory`, { timeout: 180000 }, async t => {
  const f = await fixture(t, { memory }), before = await snapshot(f.DB), schema = await captureSqlSchema(f.DB);
  f.observed.records.length = 0;
  const inventory = await inspectGuestImageSaveInventory(request(), f.env, { proof: f.proof }), input = claimInput(f, inventory);
  const claimed = await claimGuestImageSave(claimRequest(), f.env, input);
  metrics(t, f); expectClaim(f, claimed, input); const operationRecords = [...f.observed.records];
  const after = await verifyClaimFootprint(f, before, claimed); f.observed.records.length = 0; f.observed.readOnly = true;
  assert.deepEqual(await readGuestImageClaim(claimRequest(), f.env, { sessionId: f.session.sessionId }), claimed.receipt);
  const replayed = await claimGuestImageSave(claimRequest(), f.env, withoutProof(input)); expectClaim(f, replayed, input);
  assert.deepEqual(replayed.receipt, claimed.receipt); operationRecords.push(...f.observed.records);
  assert.deepEqual(await snapshot(f.DB), after);
  if (memory) {
    f.observed.readOnly = false;
    const original = await nativeOutput(f), spec = structuredClone(original.requirements[0].spec); spec.label = 'Edited canonical Image requirement';
    const edit = { action: 'save', documentId: f.session.documentId, blockId: f.saved.requirementId, spec, expectedRevision: original.revision, clientMutationId: 'synthetic-native-edit' };
    assert.equal((await nativeOutput(f, edit)).replayed, false);
    const edited = await snapshot(f.DB); f.observed.readOnly = true;
    const current = await nativeOutput(f); assert.equal(current.requirements[0].blockId, f.saved.requirementId); assert.deepEqual(current.requirements[0].spec, spec);
    assert.deepEqual(await readGuestImageClaim(claimRequest(), f.env, { sessionId: f.session.sessionId }), claimed.receipt);
    expectClaim(f, await claimGuestImageSave(claimRequest(), f.env, withoutProof(input)), input);
    assert.equal((await nativeOutput(f, edit)).replayed, true); assert.deepEqual(await snapshot(f.DB), edited);
    f.observed.records.length = 0;
    const draftGet = () => handleExperienceIntake(new Request(`${origin}/api/experiences/drafts/${f.prepared.plan.draftId}`, { headers: claimRequest().headers }), f.env);
    const reopened = await draftGet(); assert.equal(reopened.status, 200);
    const reopenedBody = await reopened.json(); assert.equal(reopenedBody.status, 'context-only');
    assert.deepEqual(reopenedBody.plan, f.prepared.plan); assert.deepEqual(reopenedBody.custody, claimed.retained.custody);
    assert.equal(reopenedBody.generationAvailable, false); assert.equal(reopenedBody.miniAppClaimComplete, false);
    operationRecords.push(...f.observed.records); assert.deepEqual(await snapshot(f.DB), edited);
    f.observed.readOnly = false;
    const block = f.prepared.plan.events.find(event => event.type === 'BlockCreated').payload.block_id;
    await f.DB.prepare('INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind('synthetic-foreign-access', 'block', block, 'synthetic-foreign-org', 'synthetic-foreign-project', 'synthetic-foreign-owner', 'collaborative_output', null, 'synthetic-foreign-actor', time).run();
    const enrolled = await snapshot(f.DB); f.observed.records.length = 0; f.observed.readOnly = true;
    const denied = await draftGet(); assert.equal(denied.status, 404);
    const deniedBody = await denied.json(); assert.equal(Object.hasOwn(deniedBody, 'plan'), false); assert.equal(Object.hasOwn(deniedBody, 'custody'), false);
    assert.ok(!JSON.stringify(deniedBody).includes(f.subject));
    await assert.rejects(readGuestImageClaim(claimRequest(), f.env, { sessionId: f.session.sessionId }));
    await assert.rejects(claimGuestImageSave(claimRequest(), f.env, withoutProof(input)));
    operationRecords.push(...f.observed.records); assert.deepEqual(await snapshot(f.DB), enrolled);
  }
  qualifyActualSqlShapes(t, operationRecords, schema);
});

test('local workerd D1 late canonical ownership failure rolls back the whole copy, and explicit retry survives one lost acknowledgment', { timeout: 180000 }, async t => {
  const f = await fixture(t), inventory = await inspectGuestImageSaveInventory(request(), f.env, { proof: f.proof }), input = claimInput(f, inventory);
  await acquireGuestImageSaveClaimLease(claimRequest(), f.env, { proof: f.proof, requestId: input.requestId, inventory });
  const before = await snapshot(f.DB), schema = await captureSqlSchema(f.DB); f.observed.records.length = 0;
  let failures = 0;
  f.observed.beforeBatch = (items, records) => {
    if (!claimBatch(records)) return;
    failures++; const at = records.findIndex(row => /INSERT INTO experience_guest_image_claims\b/u.test(row.sql));
    assert.ok(at >= 0); assert.ok(records.slice(at + 1).some(row => /^\s*INSERT INTO output_atomic_assertions\b/u.test(row.sql)));
    const result = [...items]; result.splice(at + 1, 0, f.DB.prepare("UPDATE event_private_payloads SET owner_id='synthetic-foreign-owner' WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? ORDER BY sequence DESC LIMIT 1)").bind(targetStream)); return result;
  };
  await assert.rejects(claimGuestImageSave(claimRequest(), f.env, input)); assert.equal(failures, 1);
  assert.equal(f.observed.batchErrors.length, 1); assert.match(f.observed.batchErrors[0], /CHECK constraint failed/u);
  const operationRecords = [...f.observed.records]; assert.deepEqual(await snapshot(f.DB), before, 'native D1 rolls back every copy, receipt, revoke and injected late mutation');
  f.observed.beforeBatch = null; let committed = 0;
  f.observed.afterBatch = records => { if (claimBatch(records)) { committed++; throw Error('Synthetic lost acknowledgment after native D1 claim commit'); } };
  f.observed.records.length = 0;
  const claimed = await claimGuestImageSave(claimRequest(), f.env, input); expectClaim(f, claimed, input); assert.equal(committed, 1);
  operationRecords.push(...f.observed.records); f.observed.afterBatch = null;
  const after = await verifyClaimFootprint(f, before, claimed); f.observed.readOnly = true; f.observed.records.length = 0;
  expectClaim(f, await claimGuestImageSave(claimRequest(), f.env, withoutProof(input)), input); operationRecords.push(...f.observed.records);
  assert.deepEqual(await snapshot(f.DB), after); metrics(t, f); qualifyActualSqlShapes(t, operationRecords, schema);
});

test('local workerd D1 concurrent identical claims converge on one native copy and original sponsor text receipt', { timeout: 180000 }, async t => {
  const f = await fixture(t), inventory = await inspectGuestImageSaveInventory(request(), f.env, { proof: f.proof }), input = claimInput(f, inventory);
  await acquireGuestImageSaveClaimLease(claimRequest(), f.env, { proof: f.proof, requestId: input.requestId, inventory });
  const before = await snapshot(f.DB), schema = await captureSqlSchema(f.DB); f.observed.records.length = 0;
  let arrivals = 0; const gate = Promise.withResolvers(), timeout = setTimeout(() => gate.reject(Error('Both pending claim copies did not arrive')), 15000);
  t.after(() => clearTimeout(timeout));
  f.observed.beforeBatch = async (_items, records) => {
    if (!claimBatch(records)) return; arrivals++; if (arrivals === 2) { clearTimeout(timeout); gate.resolve(); } await gate.promise;
  };
  const results = await Promise.all([claimGuestImageSave(claimRequest(), f.env, input), claimGuestImageSave(claimRequest(), f.env, input)]);
  assert.equal(arrivals, 2, 'both calls reached the native pending-copy boundary before either could commit'); f.observed.beforeBatch = null;
  results.forEach(result => expectClaim(f, result, input)); assert.deepEqual(results[0].receipt, results[1].receipt);
  const operationRecords = [...f.observed.records]; await verifyClaimFootprint(f, before, results[0]);
  assert.equal((await rows(f.DB, 'experience_sponsor_resource_receipts')).length, 1); metrics(t, f); qualifyActualSqlShapes(t, operationRecords, schema);
});
