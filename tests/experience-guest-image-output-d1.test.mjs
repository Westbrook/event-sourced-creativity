import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [{ ensureSchema, readWorkspaceEvents }, { GUEST_CUSTODY_SCHEMA, GUEST_DB_NOW, issueGuestClaimSession, readGuestCustodyTerms },
  { GUEST_SOURCE_SCHEMA, readGuestSourcePolicy, prepareGuestImageSource, commitGuestImageSource },
  { inspectGuestContextInventory, guestContextInventoryData }, { saveGuestImageRequirement, readGuestImageRequirement },
  { SPONSOR_ENTITLEMENT_SCHEMA }, { SPONSOR_RESOURCE_SCHEMA }, { SPONSOR_APPROVAL_SCHEMA }, { approveGuestSponsorCampaign },
  { compileGuestSponsorApprovalProposal, compileGuestSponsorSessionBinding, compileGuestSponsorSourceBinding, deriveGuestSponsorDriver },
  { preflightOutputImageSlidesTarget }, { sponsorImageTransport }, { registeredExperience, initialValues, experienceResourceId },
  { canonicalJson, digest }, { POLICY_VERSION }, { authoritativeCreativeContext }, { foldEvents },
  { outputRequirements, normalizePlanSuggestions }, { createExperienceOutputRecipe },
  { experienceOutputBinding, experienceOutputCommandKey, experienceOutputEnvelope }, { publicEventPayload },
  { SPONSOR_ISSUER_SCHEMA }, { SPONSOR_DRIVER_SCHEMA }, { SPONSOR_INTAKE_SCHEMA },
  { SPONSOR_READ_POLICY_SCHEMA }, { SPONSOR_READ_APPROVAL_SCHEMA }, { SPONSOR_READ_ATTEMPT_SCHEMA },
  { SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA }, { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA }, { SPONSOR_NATIVE_IMAGE_READ_INDEXES }] = await Promise.all([
  import('../worker/runtime.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'), import('../worker/experience-guest-image-output.ts'),
  import('../worker/experience-sponsor-entitlement.ts'), import('../worker/experience-sponsor-resources.ts'),
  import('../worker/experience-sponsor-approval.ts'), import('../worker/experience-guest-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-contract.ts'), import('../worker/output-image-slides-preflight.ts'),
  import('../worker/experience-sponsor-image-evidence.ts'), import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'),
  import('../worker/policy-version.ts'), import('../worker/context-authority.ts'), import('../src/model/events.ts'),
  import('../worker/output-trusted-context.ts'), import('../worker/experience-output-recipe.ts'),
  import('../worker/experience-output-binding.ts'), import('../worker/event-privacy.ts'),
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
      assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'SAVE replay or read must be read-only');
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
async function fixture(t, { memory = false, optional = false, maximum = false, operationCap = 100, lifetime = 120000 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-output-d1-')), egress = [], media = [];
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
    originalEvents, sourceContext, input, memory, optional, maximum,
    save: () => saveGuestImageRequirement(request(), env, input), read: () => readGuestImageRequirement(request(), env, input) };
}
function expectReceipt(f, value, replayed) {
  assert.deepEqual(Object.keys(value).sort(), ['status', 'documentId', 'requirementId', 'commandKey', 'eventId', 'revision', 'replayed', 'planConfirmed', 'admissionCommitted', 'generationAvailable', 'custodyTransferred'].sort());
  assert.equal(value.status, 'saved'); assert.equal(value.documentId, f.prepared.plan.documentId); assert.equal(value.revision, 9); assert.equal(value.replayed, replayed);
  for (const field of ['planConfirmed', 'admissionCommitted', 'generationAvailable', 'custodyTransferred']) assert.equal(value[field], false);
  assert.ok(Object.isFrozen(value));
  for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken, payer]) assert.ok(!JSON.stringify(value).includes(secret));
}
async function expectedEnvelope(f) {
  const plan = f.prepared.plan, requirementId = await experienceResourceId(plan.draftId, 'native-output-requirement');
  const recipe = createExperienceOutputRecipe({ output: 'image', requirementId, deliverableId: await experienceResourceId(plan.draftId, 'native-output-deliverable'),
    variantId: await experienceResourceId(plan.draftId, 'native-output-variant'), aspectRatio: { width: 1, height: 1 } });
  const sessionRow = (await rows(f.DB, 'experience_guest_sessions'))[0], sourceRow = (await rows(f.DB, 'experience_guest_sources'))[0];
  const session = await compileGuestSponsorSessionBinding({ domain: 'forma-sponsor-guest-session@1', sessionId: sessionRow.session_id,
    guestSubject: sessionRow.guest_subject, projectId: plan.projectId, documentId: plan.documentId, sessionPolicyId: sessionRow.policy_id,
    sessionTermsDigest: sessionRow.terms_digest, expiresAtMs: sessionRow.expires_at_ms });
  const source = await compileGuestSponsorSourceBinding({ domain: 'forma-sponsor-guest-source@1', sessionDigest: session.sessionDigest,
    sourcePolicyId: sourceRow.policy_id, sourcePolicyDigest: sourceRow.policy_digest, draftId: plan.draftId, draftHash: plan.draftHash,
    requestDigest: sourceRow.request_digest, contentDigest: f.native.manifest.contentDigest, releaseHash: plan.release.releaseHash,
    sourceHead: f.native.manifest.sourceHead, sourceEventIds: [...f.native.manifest.sourceEventIds], expiresAtMs: Date.parse(f.native.manifest.expiresAt) });
  const driver = await deriveGuestSponsorDriver({ version: 1, action: 'run-guest-sponsored-image', campaignId: f.compiled.policy.campaignId,
    sessionId: sessionRow.session_id, documentId: plan.documentId, draftId: plan.draftId, draftHash: plan.draftHash, guestSourceDigest: source.guestSourceDigest });
  const binding = await experienceOutputBinding(plan), commandKey = await experienceOutputCommandKey(binding, 'save');
  const envelope = await experienceOutputEnvelope(binding, 'save', 8, { blockId: requirementId, spec: recipe.spec,
    planSuggestions: normalizePlanSuggestions(recipe.spec, undefined, false), guestSponsorPreparation: { protocol: 'guest-image-source@1',
      campaignId: f.compiled.policy.campaignId, approvalId: f.approvalId, termsDigest: f.compiled.termsDigest, policyDigest: f.compiled.policyDigest,
      session: session.binding, source: source.binding, driver: driver.command } });
  return { envelope, requirementId, commandKey, recipe, session };
}
async function assertFootprint(f, before, result) {
  const after = await snapshot(f.DB), expected = await expectedEnvelope(f), guest = f.session.guestSubject, plan = f.prepared.plan;
  const allowed = new Set(['events', 'event_private_payloads', 'output_commands', 'experience_sponsor_resource_receipts']);
  assert.deepEqual(after.schema, before.schema, 'SAVE cannot install or change any schema');
  for (const [table, content] of Object.entries(before.contents)) if (!allowed.has(table)) assert.deepEqual(after.contents[table], content, `unchanged ${table}`);
  assert.equal(result.requirementId, expected.requirementId); assert.equal(result.commandKey, expected.commandKey);
  assert.equal(after.contents.events.length, before.contents.events.length + 1);
  assert.deepEqual(after.contents.events.slice(0, -1), before.contents.events);
  assert.equal(after.contents.event_private_payloads.length, before.contents.event_private_payloads.length + 1);
  assert.deepEqual(after.contents.event_private_payloads.slice(0, -1), before.contents.event_private_payloads);
  const event = after.contents.events.at(-1), body = after.contents.event_private_payloads.at(-1);
  assert.equal(event.event_id, result.eventId); assert.equal(event.sequence, 9); assert.equal(event.type, 'BlockCreated');
  assert.equal(event.stream_id, plan.streamId); assert.equal(event.actor, guest); assert.equal(event.client_id, 'server:guest-output');
  assert.equal(event.correlation_id, expected.commandKey); assert.equal(event.causation_id, null); assert.equal(event.compensates_event_id, null); assert.equal(event.schema_version, 1);
  const payload = JSON.parse(body.private_json), publicPayload = JSON.parse(event.payload);
  assert.deepEqual(payload, { block_id: expected.requirementId, type: 'output', scope: 'document', position: `z-output-${expected.requirementId}`,
    handle: `output/${expected.requirementId}`, properties: { text: expected.recipe.spec.original_text, subtype: expected.recipe.spec.label,
      output_spec: expected.recipe.spec, output_plan_suggestions: normalizePlanSuggestions(expected.recipe.spec, undefined, false), authority: 'authored' },
    project_id: plan.projectId, document_id: plan.documentId, actor_user_id: guest, output_command_envelope: expected.envelope });
  assert.deepEqual(publicPayload, publicEventPayload(result.eventId, payload, true).payload);
  assert.equal(body.private_event_id, result.eventId); assert.equal(body.owner_id, guest); assert.equal(body.project_id, plan.projectId); assert.equal(body.document_id, plan.documentId); assert.equal(body.redacted_at, null); assert.equal(body.created_at, event.recorded_at);
  assert.equal(publicPayload.properties, undefined); assert.equal(publicPayload.output_command_envelope, undefined); assert.ok(publicPayload._private_ref);
  for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken]) { assert.ok(!event.payload.includes(secret)); assert.ok(!body.private_json.includes(secret)); }
  const commands = after.contents.output_commands;
  assert.equal(commands.length, 1); assert.deepEqual(commands[0], { scope_key: `personal:${guest}:${plan.projectId}`, actor_user_id: guest,
    command_key: expected.commandKey, request_digest: (await digest(expected.envelope)).slice(7), action: 'save', event_id: result.eventId, created_at: event.recorded_at });
  const resources = after.contents.experience_sponsor_resource_receipts;
  assert.equal(resources.length, 1); const resource = resources[0];
  assert.deepEqual({ ...resource, recorded_at_ms: 0 }, { resource_id: `${expected.commandKey}:text`, campaign_id: f.compiled.policy.campaignId,
    policy_digest: f.compiled.policyDigest, limits_digest: await digest(f.compiled.policy.resources), actor_user_id: guest, session_digest: expected.session.sessionDigest,
    operation: 'text-intake', intent_key: expected.commandKey, payload_digest: await digest(expected.envelope), text_bytes: Buffer.byteLength(canonicalJson(f.sourceContext.snapshot)), issued_grant_id: null, recorded_at_ms: 0 });
  assert.ok(Number.isSafeInteger(resource.recorded_at_ms)); assert.ok(resource.recorded_at_ms >= f.compiled.policy.startsAtMs);
  assert.ok(resource.recorded_at_ms < Math.min(f.compiled.policy.expiresAtMs, f.compiled.policy.resources.expiresAtMs, f.session.expiresAtMs, Date.parse(f.prepared.expiresAt)));
  const reopened = await readWorkspaceEvents(f.env, plan.streamId), projection = foldEvents(reopened, Number.POSITIVE_INFINITY, plan.documentId, plan.projectId);
  const requirements = outputRequirements(projection); assert.equal(requirements.length, 1); assert.deepEqual(requirements[0].spec, expected.recipe.spec);
  assert.ok(!JSON.stringify(requirements[0].spec).includes('"kind":"confirmed"'));
  assert.deepEqual(reopened.slice(0, -1), f.originalEvents);
  return after;
}
function metrics(t, f) {
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', memory: f.memory, optionalSponsorFamilies: f.optional,
    originalPrefix: f.prepared.plan.events.length, sourceMaximumEvents: f.sourcePolicy.maximumEvents, subjectCharacters: f.subject.length, subjectUtf8Bytes: Buffer.byteLength(f.subject),
    executedStatements: f.observed.records.length, maxBindings: Math.max(...f.observed.records.map(row => row.parameters)),
    maxSqlBytes: Math.max(...f.observed.records.map(row => row.sqlBytes)), maxBoundTextBytes: Math.max(...f.observed.records.map(row => row.maxBoundTextBytes)),
    maxStatementBoundTextBytes: Math.max(...f.observed.records.map(row => row.totalBoundTextBytes)), applicationBatches: f.observed.batches.length }));
}
const isSave = records => records.some(row => /INSERT INTO output_commands\b/u.test(row.sql));
function injectBeforeFinalGuard(f, items, records, sql) {
  const indexes = records.flatMap((row, index) => /^\s*INSERT INTO output_atomic_assertions\b/u.test(row.sql) ? [index] : []);
  assert.ok(indexes.length >= 2); const result = [...items]; result.splice(indexes.at(-1), 0, f.DB.prepare(sql)); return result;
}

for (const memory of [false, true]) test(`local workerd D1 saves and reopens maximum-input guest Image requirement with ${memory ? 'complete' : 'absent'} Memory and optional sponsor families absent`, { timeout: 120000 }, async t => {
  const f = await fixture(t, { memory, maximum: true }), before = await snapshot(f.DB);
  f.observed.readOnly = true; assert.equal(await f.read(), null); assert.deepEqual(await snapshot(f.DB), before); f.observed.readOnly = false;
  const result = await f.save(); expectReceipt(f, result, false); const after = await assertFootprint(f, before, result);
  f.observed.readOnly = true;
  assert.deepEqual(await f.read(), { ...result, replayed: true }); assert.deepEqual(await f.save(), { ...result, replayed: true });
  await assert.rejects(inspectGuestContextInventory(request(), f.env, { proof: f.proof }), 'original context-only inventory must still refuse the output successor');
  assert.deepEqual(await snapshot(f.DB), after, 'exact read/retry consumes no second preparation operation'); metrics(t, f);
});

test('local workerd D1 complete optional sponsor schema SAVE rolls back late source-policy revocation then resolves lost ACK without duplicate work', { timeout: 120000 }, async t => {
  const f = await fixture(t, { optional: true }), before = await snapshot(f.DB); let attempts = 0;
  f.observed.beforeBatch = (items, records) => {
    if (!isSave(records)) return; attempts++;
    return injectBeforeFinalGuard(f, items, records, `UPDATE experience_guest_source_policies SET revoked_at_ms=${GUEST_DB_NOW}`);
  };
  await assert.rejects(f.save()); assert.equal(attempts, 1); assert.deepEqual(await snapshot(f.DB), before, 'final currentness CHECK rolls back resource receipt/event/body/command and source-policy fixture change');
  f.observed.beforeBatch = null; let lost = 0;
  f.observed.afterBatch = records => { if (isSave(records)) { lost++; throw Error('Synthetic lost SAVE acknowledgment after real commit'); } };
  const result = await f.save(); expectReceipt(f, result, true); assert.equal(lost, 1); f.observed.afterBatch = null;
  await assertFootprint(f, before, result);
  await f.DB.prepare("UPDATE users SET consent_version='synthetic-expired-consent' WHERE user_id=?").bind(payer).run();
  const changed = await snapshot(f.DB); f.observed.readOnly = true;
  await assert.rejects(f.read()); await assert.rejects(f.save()); assert.deepEqual(await snapshot(f.DB), changed, 'changed current payer denies original recovery without repairing history');
  metrics(t, f);
});

test('local workerd D1 concurrent identical guest SAVEs resolve exactly one native event and one resource debit', { timeout: 120000 }, async t => {
  const f = await fixture(t), before = await snapshot(f.DB); let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  f.observed.beforeBatch = async (_items, records) => {
    if (!isSave(records)) return;
    arrivals++; if (arrivals === 2) release();
    await barrier;
  };
  const results = await Promise.all([f.save(), f.save()]); f.observed.beforeBatch = null;
  assert.equal(arrivals, 2, 'both genuine stale contenders finish their empty-state pre-reads before either native write');
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  for (const result of results) expectReceipt(f, result, result.replayed);
  assert.deepEqual({ ...results[0], replayed: true }, { ...results[1], replayed: true });
  await assertFootprint(f, before, results[0]); metrics(t, f);
});

test('local workerd D1 denies partial optional sponsor schemas and missing required resources without installation or writes', { timeout: 120000 }, async t => {
  const f = await fixture(t);
  await f.DB.prepare(SPONSOR_DRIVER_SCHEMA[0]).run(); const partial = await snapshot(f.DB); f.observed.readOnly = true;
  await assert.rejects(f.save()); await assert.rejects(f.read()); assert.deepEqual(await snapshot(f.DB), partial);
  f.observed.readOnly = false; await f.DB.prepare('DROP TABLE experience_sponsor_driver_intents').run();
  await f.DB.prepare('DROP TABLE experience_sponsor_resource_policies').run(); const missing = await snapshot(f.DB); f.observed.readOnly = true;
  await assert.rejects(f.save()); await assert.rejects(f.read()); assert.deepEqual(await snapshot(f.DB), missing);
  metrics(t, f);
});

test('local workerd D1 pre-existing resource-cap exhaustion cannot leave a guest SAVE or isolated preparation receipt', { timeout: 120000 }, async t => {
  const f = await fixture(t, { operationCap: 1 });
  await f.DB.prepare(`INSERT INTO experience_sponsor_resource_receipts VALUES(?,?,?,?,?,?,?,?,?,?,NULL,${GUEST_DB_NOW})`)
    .bind('synthetic-other-resource', f.compiled.policy.campaignId, f.compiled.policyDigest, await digest(f.compiled.policy.resources), 'synthetic-other-actor', `sha256:${'d'.repeat(64)}`,
      'text-intake', 'synthetic-other-intent', `sha256:${'e'.repeat(64)}`, 1).run();
  const before = await snapshot(f.DB); await assert.rejects(f.save()); assert.deepEqual(await snapshot(f.DB), before);
  assert.equal(await f.read(), null, 'failed SAVE remains a provably empty original'); metrics(t, f);
});

test('local workerd D1 original source retention expiry denies saved requirement recovery without deleting history', { timeout: 120000 }, async t => {
  const f = await fixture(t, { lifetime: 15000 }), before = await snapshot(f.DB);
  const result = await f.save(); expectReceipt(f, result, false); const after = await assertFootprint(f, before, result);
  f.observed.readOnly = true;
  while ((await f.DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value < Date.parse(f.prepared.expiresAt))
    await new Promise(resolve => setTimeout(resolve, 50));
  await assert.rejects(f.read()); await assert.rejects(f.save());
  assert.deepEqual(await snapshot(f.DB), after, 'expired recovery neither reconstructs source nor deletes the original SAVE/accounting/history');
  metrics(t, f);
});

async function insertForeignDriverStage(f, commandJson) {
  const foreign = { action: 'run-sponsored-image', campaignId: f.compiled.policy.campaignId, documentId: 'synthetic-foreign-document',
    planRevisionId: 'synthetic-foreign-plan', targetId: 'synthetic-foreign-target', intentKey: 'synthetic-foreign-intent' };
  await f.DB.prepare(`INSERT INTO experience_sponsor_driver_intents VALUES(?,?,?,?,?,?,?,?,?,?,?,${GUEST_DB_NOW})`)
    .bind('synthetic-foreign-driver', f.compiled.policy.campaignId, 'synthetic-foreign-actor', `sha256:${'a'.repeat(64)}`,
      'synthetic-foreign-intent', 'synthetic-foreign-document', canonicalJson(foreign), (await digest(foreign)).slice(7), `sha256:${'b'.repeat(64)}`, `sha256:${'c'.repeat(64)}`, 1).run();
  await f.DB.prepare('INSERT INTO experience_sponsor_driver_stages VALUES(?,?,?,?)')
    .bind('synthetic-foreign-driver', 'preflight', commandJson, 'a'.repeat(64)).run();
}

test('local workerd D1 permits the exact optional native actor-history index and bounded unrelated driver history', { timeout: 120000 }, async t => {
  const f = await fixture(t, { optional: true });
  for (const definition of SPONSOR_NATIVE_IMAGE_READ_INDEXES) await f.DB.prepare(definition.sql).run();
  await insertForeignDriverStage(f, canonicalJson({ action: 'preflight', documentId: 'synthetic-foreign-document' }));
  const before = await snapshot(f.DB); f.observed.readOnly = true; assert.equal(await f.read(), null); f.observed.readOnly = false;
  const result = await f.save(); expectReceipt(f, result, false); const after = await assertFootprint(f, before, result);
  f.observed.readOnly = true; assert.deepEqual(await f.read(), { ...result, replayed: true }); assert.deepEqual(await snapshot(f.DB), after);
  metrics(t, f);
});

test('local workerd D1 unclassifiable retained driver and issuer JSON denies empty and saved source without changing history', { timeout: 120000 }, async t => {
  for (const kind of ['invalid-driver-before', 'oversize-issuer-after']) {
    const f = await fixture(t, { optional: true });
    if (kind === 'invalid-driver-before') await insertForeignDriverStage(f, '{invalid');
    else {
      const result = await f.save(); expectReceipt(f, result, false);
      const hidden = canonicalJson({ documentId: f.prepared.plan.documentId, projectId: 'synthetic-foreign-project', ownerUserId: 'synthetic-foreign-owner',
        actorUserId: 'synthetic-foreign-actor', payerUserId: payer, sessionDigest: `sha256:${'a'.repeat(64)}`, padding: 'é'.repeat(32768) });
      assert.ok(Buffer.byteLength(hidden) > 65536);
      // Fixture-only retained native rows with valid foreign-key structure. No
      // issuer/admission, financial reservation or provider function is called.
      await f.DB.prepare('INSERT INTO experience_sponsor_grants VALUES(?,?,?,?,?,?,?,?,?,1)')
        .bind('synthetic-foreign-grant', f.compiled.policy.campaignId, f.compiled.policyDigest, 'synthetic-foreign-actor', `sha256:${'a'.repeat(64)}`,
          'synthetic-foreign-intent', `sha256:${'b'.repeat(64)}`, f.compiled.policy.startsAtMs + 1, f.compiled.policy.expiresAtMs).run();
      await f.DB.prepare('INSERT INTO experience_sponsor_issuances VALUES(?,?,?,?,?,?,?,?,?)')
        .bind('synthetic-foreign-grant', f.compiled.policy.campaignId, 'synthetic-foreign-actor', 'synthetic-foreign-intent', f.compiled.policyDigest,
          canonicalJson({ documentId: 'synthetic-foreign-document' }), 'a'.repeat(64), `sha256:${'b'.repeat(64)}`, hidden).run();
    }
    assert.deepEqual((await f.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
    const before = await snapshot(f.DB); f.observed.readOnly = true;
    await assert.rejects(f.read(), kind); await assert.rejects(f.save(), kind);
    assert.deepEqual(await snapshot(f.DB), before, 'unclassifiable retained history cannot be silently treated as unrelated, repaired or removed');
    t.diagnostic(kind); metrics(t, f);
  }
});
