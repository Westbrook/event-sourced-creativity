import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';

registerOutputSourceImports();
const [{ ensureSchema, readWorkspaceEvents, appendAuditEvent, streamHead }, { GUEST_CUSTODY_SCHEMA, GUEST_DB_NOW, issueGuestClaimSession, readGuestCustodyTerms },
  { GUEST_SOURCE_SCHEMA, readGuestSourcePolicy, prepareGuestImageSource, commitGuestImageSource },
  { inspectGuestContextInventory, guestContextInventoryData }, { saveGuestImageRequirement, readGuestImageRequirement },
  { GUEST_CONTEXT_ADOPTION_SCHEMA }, { GUEST_PLAN_CUSTODY_SCHEMA },
  { retireExpiredGuestImageSource }, { retireExpiredClaimedGuestImageOutput },
  { GUEST_IMAGE_CLAIM_SCHEMA, claimGuestImageSave }, { inspectGuestImageSaveInventory }, { foldEvents },
  { handleWorkspaces }, { handleEvents }, { handleOutputRequirements },
  { SPONSOR_ENTITLEMENT_SCHEMA }, { SPONSOR_RESOURCE_SCHEMA }, { SPONSOR_APPROVAL_SCHEMA },
  { approveGuestSponsorCampaign, revokeGuestSponsorCampaign }, { compileGuestSponsorApprovalProposal },
  { preflightOutputImageSlidesTarget }, { sponsorImageTransport }, { registeredExperience, initialValues },
  { canonicalJson, digest }, { POLICY_VERSION }, { authoritativeCreativeContext },
  { SPONSOR_ISSUER_SCHEMA }, { SPONSOR_DRIVER_SCHEMA }, { SPONSOR_INTAKE_SCHEMA },
  { SPONSOR_READ_POLICY_SCHEMA }, { SPONSOR_READ_APPROVAL_SCHEMA }, { SPONSOR_READ_ATTEMPT_SCHEMA },
  { SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA }, { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA, SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA }, { SPONSOR_NATIVE_IMAGE_READ_INDEXES }] = await Promise.all([
  import('../worker/runtime.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'), import('../worker/experience-guest-image-output.ts'),
  import('../worker/experience-guest-context-adoption.ts'), import('../worker/experience-guest-plan-custody.ts'),
  import('../worker/experience-guest-source-retirement.ts'), import('../worker/experience-guest-claimed-image-output-retirement.ts'),
  import('../worker/experience-guest-image-claim.ts'), import('../worker/experience-guest-image-claim-inventory.ts'), import('../src/model/events.ts'),
  import('../worker/workspaces-api.ts'), import('../worker/events-api.ts'), import('../worker/output-requirements-api.ts'),
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
  const handles = new WeakMap(), observed = { records: [], batches: [], batchErrors: [], statementErrors: [], readOnly: false, beforeBatch: null, afterBatch: null };
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
  function statementError(method, error, row) {
    const detail = { method, name: error?.name ?? 'unknown', message: String(error?.message ?? error),
      cause: error?.cause?.message ?? null, sqlSha256: createHash('sha256').update(row.sql).digest('hex'),
      sqlBytes: Buffer.byteLength(row.sql), parameters: row.bindings.length };
    observed.statementErrors.push(detail); diagnostic(`Actual D1 statement failed: ${JSON.stringify(detail)}`);
  }
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings };
    const wrapped = {
      bind(...args) { return wrap(statement.bind(...args), sql, args); },
      async first(...args) { record(row); try { return await statement.first(...args); } catch (error) { diagnostic(`Actual D1 read failed: ${String(error)}; bindings=${bindings.length}; bytes=${Buffer.byteLength(sql)}`); throw error; } },
      async all(...args) { record(row); try { return await statement.all(...args); } catch (error) { statementError('all', error, row); throw error; } },
      async run(...args) { record(row); try { return await statement.run(...args); } catch (error) { statementError('run', error, row); throw error; } },
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
async function fixture(t, { memory = true, maximum = true, lifetime = 30000 } = {}) {
  const schemaVersion = 2, optional = true, custody = true, operationCap = 100;
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-claimed-image-retirement-d1-')), egress = [], media = [];
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
    ...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_PLAN_CUSTODY_SCHEMA, ...GUEST_IMAGE_CLAIM_SCHEMA, ...SPONSOR_NATIVE_IMAGE_READ_INDEXES.map(index => index.sql)]) await DB.prepare(sql).run();
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
  const saveInventory = await inspectGuestImageSaveInventory(claimRequest(), env, { proof });
  const claimInput = { sessionId: session.sessionId, requestId: 'synthetic-retirement-claim', approvedManifestDigest: saveInventory.manifestDigest, proof };
  const claimed = await claimGuestImageSave(claimRequest(), env, claimInput);
  assert.equal(claimed.status, 'image-save-claimed'); assert.equal(claimed.planRetention, 'retained');
  assert.equal(claimed.contextCustodyTransferred, true); assert.equal(claimed.requirementCustodyTransferred, true);
  assert.equal(claimed.generationAvailable, false); assert.equal(claimed.miniAppClaimComplete, false);
  assert.equal(claimed.receipt.destinationUserId, destination);
  assert.equal(claimed.receipt.replayed, true, 'claim coordinator returns a freshly proven canonical reread receipt');
  assert.equal(claimed.receipt.revision, targetHead + prepared.plan.events.length + 1);
  assert.notEqual(claimed.receipt.eventId, saved.eventId);
  assert.deepEqual(await readWorkspaceEvents(env, prepared.plan.streamId), guestHistory, 'genuine claim preserves original guest history');
  assert.deepEqual((await readWorkspaceEvents(env, targetStream)).slice(0, targetHead), targetHistory, 'native existing canonical history survives claim');
  assert.equal((await rows(DB, 'experience_guest_image_claims')).length, 1);
  assert.equal((await rows(DB, 'experience_guest_plan_custodies')).length, 1);
  observed.records.length = 0; observed.batches.length = 0; observed.batchErrors.length = 0;
  return { DB, env, observed, session, proof, terms, sourcePolicy, prepared, committed, inventory, native, release, subject, compiled, approvalId,
    originalEvents, sourceContext, input, memory, optional, custody, maximum, schemaVersion, saved, guestHistory, targetHead, targetHistory, claimed, claimInput,
    save: () => saveGuestImageRequirement(request(), env, input), read: () => readGuestImageRequirement(request(), env, input) };
}

// This private fixture uses the agreed dormant claim API to produce every
// immutable receipt; it never seeds a claimed mapping or approval. Runtime
// remains held until both source owners declare a runnable frozen candidate.

async function captureSqlSchema(DB) {
  return (await DB.prepare("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name").all()).results.map(row => row.sql);
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

async function databaseNow(f) { return (await f.DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value; }
async function due(f) {
  const deadline = performance.now() + 60000;
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
  assert.deepEqual(result, { status: 'retired', scope: 'claimed-first-save-original-guest-body', sessionId: f.session.sessionId,
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
  assert.deepEqual(after, expected, 'only the exact SAVE private bytes and redaction marker may change; all source, canonical destination, retained plan, claim mapping, public, command, resource, account, financial and schema history is retained');
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

async function revokePayer(f) {
  const response = await revokeGuestSponsorCampaign(new Request(`${origin}/unregistered-payer-revoke`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'oai-authenticated-user-id': payer, 'oai-authenticated-user-email': `${payer}@example.invalid` },
    body: JSON.stringify({ version: 1, action: 'revoke-guest-sponsor-campaign', campaignId: f.compiled.policy.campaignId,
      policyDigest: f.compiled.policyDigest, confirmation: 'REVOKE_GUEST_SPONSOR_CAMPAIGN' }) }), f.env);
  assert.equal(response.status, 'revoked');
}
const isRetirement = records => records.some(row => /^\s*UPDATE event_private_payloads SET private_json\s*=\s*''/iu.test(row.sql));
const retire = f => retireExpiredClaimedGuestImageOutput(f.env, { sessionId: f.session.sessionId });

async function changeCanonicalTarget(f) {
  const block = foldEvents(await readWorkspaceEvents(f.env, targetStream), Infinity, f.prepared.plan.documentId, f.prepared.plan.projectId)
    .libraryBlocks.find(item => item.id === f.claimed.receipt.requirementId);
  assert.ok(block, 'genuine claimed SAVE creates the canonical requirement');
  const changedText = 'A revised canonical requirement retained after original cleanup';
  // Native event writes exercise later canonical history independently of HTTP
  // editing permissions, UI behavior or current sponsored generation authority.
  await appendAuditEvent(f.env, targetStream, 'user', 'BlockPropertyEdited', { project_id: f.prepared.plan.projectId,
    document_id: f.prepared.plan.documentId, block_id: block.id, property_path: 'text', old_value: block.properties.text, new_value: changedText });
  let projection = foldEvents(await readWorkspaceEvents(f.env, targetStream), Infinity, f.prepared.plan.documentId, f.prepared.plan.projectId);
  assert.equal(projection.libraryBlocks.find(item => item.id === block.id).properties.text, changedText);
  await appendAuditEvent(f.env, targetStream, 'user', 'BlockRemoved', { project_id: f.prepared.plan.projectId,
    document_id: f.prepared.plan.documentId, block_id: block.id });
  projection = foldEvents(await readWorkspaceEvents(f.env, targetStream), Infinity, f.prepared.plan.documentId, f.prepared.plan.projectId);
  assert.ok(!projection.libraryBlocks.some(item => item.id === block.id), 'native fold confirms the later requirement removal');
  assert.equal(await streamHead(f.env, targetStream), f.claimed.receipt.revision + 2);
}
function metrics(t, f, start) {
  const phase = f.observed.records.slice(start);
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', memory: f.memory, optionalSponsorFamilies: f.optional,
    optionalCustodyFamilies: f.custody, sponsorSchemaVersion: f.schemaVersion, existingCanonicalHead: f.targetHead,
    retirementPhaseObservedStatements: phase.length, maxBindings: Math.max(...phase.map(row => row.parameters)),
    maxSqlBytes: Math.max(...phase.map(row => row.sqlBytes)), maxBoundTextBytes: Math.max(...phase.map(row => row.maxBoundTextBytes)),
    maxStatementBoundTextBytes: Math.max(...phase.map(row => row.totalBoundTextBytes)) }));
}

// Actual local source, approval, SAVE and claim all precede cleanup. This test
// does not issue provider calls, activate public guest routes or alter money.
for (const memory of [false, true]) test(`local workerd D1 retires only the due claimed guest tail with ${memory ? 'complete Memory, tail-first' : 'absent Memory, source-first'} after canonical removal and payer revocation`, { timeout: 180000 }, async t => {
  const f = await fixture(t, { memory }), saved = f.saved, early = await snapshot(f.DB);
  f.observed.readOnly = true;
  await assert.rejects(retire(f), /guest_claimed_image_output_retirement_not_due/u);
  assert.deepEqual(await snapshot(f.DB), early, 'claimed-tail retirement cannot erase before the original source deadline');
  f.observed.readOnly = false;
  await changeCanonicalTarget(f); await revokePayer(f); await due(f);
  if (!memory) await retireSource(f, saved);
  const before = await snapshot(f.DB), schema = await captureSqlSchema(f.DB), phaseStart = f.observed.records.length, start = await databaseNow(f);
  const result = await retire(f), finish = await databaseNow(f), actualRetirement = f.observed.records.slice(phaseStart);
  const { after, retired } = await onlyTailChanged(f, saved, before, start, finish); receipt(f, saved, result, retired, false);
  f.observed.readOnly = true;
  const replayStart = f.observed.records.length; receipt(f, saved, await retire(f), retired, true);
  actualRetirement.push(...f.observed.records.slice(replayStart));
  assert.deepEqual(await snapshot(f.DB), after, 'exact replay retains the original tombstone and all canonical/payer history');
  f.observed.readOnly = false;
  if (memory) {
    await retireSource(f, saved);
    const complete = await snapshot(f.DB); f.observed.readOnly = true;
    receipt(f, saved, await retire(f), retired, true);
    assert.deepEqual(await snapshot(f.DB), complete, 'tail-first then original source cleanup leaves claimed canonical copies and the first tombstone unchanged');
  }
  qualifyActualSqlShapes(t, actualRetirement, schema);
  metrics(t, f, phaseStart);
});

test('local workerd D1 claimed-tail late CHECK failure rolls back erasure and lost ACK recovers one original tombstone', { timeout: 180000 }, async t => {
  const f = await fixture(t, { memory: false }), saved = f.saved; await due(f);
  const before = await snapshot(f.DB), phaseStart = f.observed.records.length; let injected = 0;
  f.observed.beforeBatch = (items, records) => {
    if (!isRetirement(records)) return;
    injected++;
    const guards = records.flatMap((row, index) => /^\s*INSERT INTO output_atomic_assertions\b/u.test(row.sql) ? [index] : []);
    assert.equal(guards.length, 2, 'complete BEFORE and AFTER proofs enclose the real retirement update');
    const updateIndex = records.findIndex(row => /^\s*UPDATE event_private_payloads SET private_json\s*=\s*''/iu.test(row.sql));
    assert.ok(updateIndex > guards[0] && updateIndex < guards[1]);
    const changed = [...items];
    changed.splice(guards[1], 0, f.DB.prepare("UPDATE event_private_payloads SET owner_id='synthetic-unrelated-owner' WHERE private_event_id=?").bind(saved.eventId));
    return changed;
  };
  await assert.rejects(retire(f), /guest_claimed_image_output_retirement_unavailable/u); assert.equal(injected, 1);
  assert.equal(f.observed.batchErrors.length, 1); assert.match(f.observed.batchErrors[0], /CHECK constraint failed: passed=1/u);
  assert.deepEqual(await snapshot(f.DB), before, 'late actual CHECK failure rolls back guest erasure, tombstone and injected owner drift');
  f.observed.beforeBatch = null; let attempts = 0, lost = 0;
  f.observed.beforeBatch = (_items, records) => { if (isRetirement(records)) attempts++; };
  f.observed.afterBatch = records => { if (isRetirement(records)) { lost++; throw Error('Synthetic claimed-tail lost acknowledgment after native commit'); } };
  const start = await databaseNow(f), result = await retire(f), finish = await databaseNow(f);
  assert.equal(attempts, 1); assert.equal(lost, 1); f.observed.beforeBatch = null; f.observed.afterBatch = null;
  const { after, retired } = await onlyTailChanged(f, saved, before, start, finish); receipt(f, saved, result, retired, true);
  f.observed.readOnly = true; receipt(f, saved, await retire(f), retired, true);
  assert.deepEqual(await snapshot(f.DB), after, 'lost ACK and canonical tombstone replay never issue a second mutation');
  metrics(t, f, phaseStart);
});


test('local workerd D1 governed canonical Project SAVE and confirm preserve due original guest cleanup with complete Memory', { timeout: 180000 }, async t => {
  const f = await fixture(t), saved = f.saved;
  const noExecutionTables = ['budget_reservations', 'cost_budget_reservations', 'document_jobs', 'output_execution_grants', 'output_provider_calls'];
  const noExecutionBefore = Object.fromEntries(await Promise.all(noExecutionTables.map(async table => [table, await rows(f.DB, table)])));
  const headers = extra => ({ origin, 'oai-authenticated-user-id': destination,
    'oai-authenticated-user-email': `${destination}@example.invalid`, ...extra });
  const workspace = (path, body) => handleWorkspaces(new Request(`${origin}/api/workspaces/${path.join('/')}`, { method: 'POST',
    headers: headers(body ? { 'content-type': 'application/json' } : {}), ...(body ? { body: JSON.stringify(body) } : {}) }), f.env, path);
  const created = await workspace([], { name: 'Claimed canonical workspace' }), createdBody = await created.json();
  assert.equal(created.status, 201, JSON.stringify(createdBody)); const { organizationId } = createdBody;
  const attached = await workspace([organizationId, 'projects'], { projectId: f.prepared.plan.projectId }), attachedBody = await attached.json();
  if (attached.status !== 201) {
    const lastStatements = f.observed.records.slice(-8).map(row => ({ sqlSha256: createHash('sha256').update(row.sql).digest('hex'),
      sqlPrefixWithLiteralsRemoved: row.sql.replace(/'(?:''|[^'])*'/gu, "'…'").slice(0, 160), parameters: row.parameters,
      sqlBytes: row.sqlBytes, minimizedMarker: row.sql.includes('minimized'), verifiedMarker: row.sql.includes('verified') }));
    const migration = (await f.DB.prepare('SELECT status,last_owner_sequence FROM project_migration_states WHERE organization_id=? AND owner_user_id=?')
      .bind(organizationId, destination).all()).results;
    const projects = (await f.DB.prepare('SELECT status FROM organization_projects WHERE organization_id=? AND owner_user_id=?')
      .bind(organizationId, destination).all()).results;
    const scopeCounts = {};
    for (const table of ['project_event_scopes', 'project_resource_scopes']) scopeCounts[table] =
      (await f.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE organization_id=? AND owner_user_id=?`).bind(organizationId, destination).first()).count;
    t.diagnostic(JSON.stringify({ kind: 'native-governed-enrollment-refusal', status: attached.status,
      migration, projects, scopeCounts, lastStatements, actualD1Errors: f.observed.statementErrors, actualBatchErrors: f.observed.batchErrors }));
  }
  assert.equal(attached.status, 201, JSON.stringify(attachedBody)); const { projectAccessId } = attachedBody;
  const opened = await workspace([organizationId, 'projects', projectAccessId, 'context']);
  assert.equal(opened.status, 200, await opened.clone().text()); const cookie = opened.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const refreshed = await handleEvents(new Request(`${origin}/api/events`, { headers: headers({ cookie }) }), f.env);
  assert.equal(refreshed.status, 200, await refreshed.clone().text());
  const output = async body => {
    const base = '/api/output-requirements', path = body ? base : `${base}?documentId=${encodeURIComponent(f.prepared.plan.documentId)}`;
    const response = await handleOutputRequirements(new Request(`${origin}${path}`, { method: body ? 'POST' : 'GET',
      headers: headers({ cookie, ...(body ? { 'content-type': 'application/json' } : {}) }), ...(body ? { body: JSON.stringify(body) } : {}) }),
    f.env, base, { waitUntil() { assert.fail('governed SAVE/confirm cannot start background or provider work'); } });
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
  };
  const initial = await output(), requirement = initial.requirements.find(row => row.blockId === f.claimed.receipt.requirementId);
  assert.ok(requirement, 'native governed read finds the actual claimed canonical requirement');
  const spec = structuredClone(requirement.spec); spec.label = 'Governed canonical Image';
  await output({ action: 'save', documentId: f.prepared.plan.documentId, blockId: f.claimed.receipt.requirementId,
    spec, clientMutationId: 'governed-canonical-save', expectedRevision: initial.revision });
  const changed = await output(); assert.equal(changed.requirements.find(row => row.blockId === f.claimed.receipt.requirementId).spec.label, spec.label);
  await output({ action: 'confirm', documentId: f.prepared.plan.documentId, clientMutationId: 'governed-canonical-confirm', expectedRevision: changed.revision });
  const scope = `project:${organizationId}:${projectAccessId}`;
  const plans = (await rows(f.DB, 'output_plan_revisions')).filter(row => row.scope_key === scope);
  assert.equal(plans.length, 1); assert.equal(plans[0].owner_user_id, destination); assert.equal(plans[0].scope_kind, 'project');
  assert.equal(plans[0].document_id, f.prepared.plan.documentId); assert.equal(plans[0].project_id, f.prepared.plan.projectId);
  for (const table of noExecutionTables) assert.deepEqual(await rows(f.DB, table), noExecutionBefore[table], `${table} unchanged by synthetic native governance, SAVE and confirm`);
  await revokePayer(f); await due(f); await retireSource(f, saved);
  const before = await snapshot(f.DB), schema = await captureSqlSchema(f.DB), phaseStart = f.observed.records.length, start = await databaseNow(f);
  const result = await retire(f), finish = await databaseNow(f), actualRetirement = f.observed.records.slice(phaseStart);
  const { after, retired } = await onlyTailChanged(f, saved, before, start, finish); receipt(f, saved, result, retired, false);
  f.observed.readOnly = true; const replayStart = f.observed.records.length;
  receipt(f, saved, await retire(f), retired, true); actualRetirement.push(...f.observed.records.slice(replayStart));
  assert.deepEqual(await snapshot(f.DB), after, 'governed canonical plan, target history, payer, immutable claims and original tombstone survive replay unchanged');
  qualifyActualSqlShapes(t, actualRetirement, schema); metrics(t, f, phaseStart);
});
