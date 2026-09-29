import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

// Portable actual-D1 fixture derived from the accepted stage-history harness.
// It runs native source functions against real workerd D1, blocks provider/media
// egress, and installs inert schema only into its disposable synthetic database.
// No runtime Git, donor imports, fake claim rows or storage substitutes.
registerOutputSourceImports();
const [{ ensureSchema, readWorkspaceEvents, appendAuditEvent, streamHead }, { GUEST_CUSTODY_SCHEMA, GUEST_DB_NOW, issueGuestClaimSession, readGuestCustodyTerms },
  { GUEST_SOURCE_SCHEMA, readGuestSourcePolicy, prepareGuestImageSource, commitGuestImageSource },
  { inspectGuestContextInventory, guestContextInventoryData }, { saveGuestImageRequirement, readGuestImageRequirement },
  { SPONSOR_ENTITLEMENT_SCHEMA }, { SPONSOR_RESOURCE_SCHEMA }, { SPONSOR_APPROVAL_SCHEMA }, { approveGuestSponsorCampaign },
  { compileGuestSponsorApprovalProposal },
  { preflightOutputImageSlidesTarget }, { sponsorImageTransport }, { registeredExperience, initialValues, experienceResourceId },
  { canonicalJson, digest }, { POLICY_VERSION }, { authoritativeCreativeContext },
  { SPONSOR_ISSUER_SCHEMA }, { SPONSOR_DRIVER_SCHEMA }, { SPONSOR_INTAKE_SCHEMA },
  { SPONSOR_READ_POLICY_SCHEMA }, { SPONSOR_READ_APPROVAL_SCHEMA }, { SPONSOR_READ_ATTEMPT_SCHEMA },
  { SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA }, { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA, SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA }] = await Promise.all([
  import('../worker/runtime.ts'), import('../worker/experience-guest-session.ts'), import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'), import('../worker/experience-guest-image-output.ts'),
  import('../worker/experience-sponsor-entitlement.ts'), import('../worker/experience-sponsor-resources.ts'),
  import('../worker/experience-sponsor-approval.ts'), import('../worker/experience-guest-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-contract.ts'), import('../worker/output-image-slides-preflight.ts'),
  import('../worker/experience-sponsor-image-evidence.ts'), import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'),
  import('../worker/policy-version.ts'), import('../worker/context-authority.ts'),
  import('../worker/experience-sponsor-issuer.ts'), import('../worker/experience-sponsor-driver.ts'), import('../worker/experience-sponsor-intake.ts'),
  import('../worker/experience-sponsor-read-policy.ts'), import('../worker/experience-sponsor-read-approval.ts'), import('../worker/experience-sponsor-read-attempts.ts'),
  import('../worker/experience-sponsor-intake-read-policy.ts'), import('../worker/experience-sponsor-intake-read-approval.ts'), import('../worker/experience-sponsor-intake-read-attempts.ts'),
]);
const [{prepareGuestImageConfirmation,confirmGuestImageRequirement},{preflightGuestImage,readGuestImagePreflight}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../worker/experience-guest-image-preflight.ts')]);
const [{createExperienceOutputRecipe},{compileOutputPlan}]=await Promise.all([import('../worker/experience-output-recipe.ts'),import('../src/model/output-plan.ts')]);
const [{ inspectGuestImageStageClaimInventory }, { claimGuestImageStages },
  { GUEST_IMAGE_STAGE_CUSTODY_SCHEMA, readClaimedGuestImageStageHistory }, { retireExpiredClaimedGuestImageStage },
  { retireExpiredGuestImageSource }, { GUEST_CONTEXT_ADOPTION_SCHEMA }, { GUEST_IMAGE_CLAIM_SCHEMA },
  { GUEST_PLAN_CUSTODY_SCHEMA }, { SPONSOR_NATIVE_IMAGE_READ_INDEXES }, { handleWorkspaces }, { handleEvents },
  { handleOutputRequirements }] = await Promise.all([
  import('../worker/experience-guest-image-stage-claim-inventory.ts'), import('../worker/experience-guest-image-stage-claim.ts'),
  import('../worker/experience-guest-image-stage-custody.ts'), import('../worker/experience-guest-claimed-image-stage-retirement.ts'),
  import('../worker/experience-guest-source-retirement.ts'), import('../worker/experience-guest-context-adoption.ts'),
  import('../worker/experience-guest-image-claim.ts'), import('../worker/experience-guest-plan-custody.ts'),
  import('../worker/experience-sponsor-native-image-read.ts'), import('../worker/workspaces-api.ts'), import('../worker/events-api.ts'),
  import('../worker/output-requirements-api.ts'),
]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid', payer = 'synthetic-payer', destination = 'synthetic-destination', targetStream = `creative:${destination}`, time = '2020-01-01T00:00:00.000Z';
const strictQualificationCache = new Map();
const strictLimits = { functionArguments: 32, parameters: 100, sqlBytes: 100000 };
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const request = () => new Request(`${origin}/unregistered-guest-image-output`, { method: 'POST', headers: { origin } });
const canonicalRequest = (method = 'POST') => new Request(`${origin}/unregistered-stage-claim`, { method, headers: { origin,
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
  const handles = new WeakMap(), observed = { records: [], batches: [], batchFailures: [], strictQualifications: [], harnessViolations: [], qualify: null, readOnly: false, beforeBatch: null, afterBatch: null, schema: null, capturedFailure: false };
  function record(row) {
    try {
    if (!observed.capturedFailure && process.env.FORMA_D1_FAILED_QUERY_CAPTURE && (row.bindings.length > 100 || Buffer.byteLength(row.sql) > 100000)) {
      // Opt-in local evidence for a refused synthetic query only. The original
      // hard limits below still reject it; no query or binding is rewritten.
      writeFileSync(process.env.FORMA_D1_FAILED_QUERY_CAPTURE, JSON.stringify({ sql: row.sql, bindings: row.bindings, schema: observed.schema,
        limits: strictLimits, expressionDepth: 100, parameters: row.bindings.length, sqlBytes: Buffer.byteLength(row.sql) }, null, 2) + '\n', { flag: 'wx' });
      observed.capturedFailure = true;
    }
    if (row.bindings.length > 100 || Buffer.byteLength(row.sql) > 100000) diagnostic(`Actual statement exceeds D1 limits: bindings=${row.bindings.length}; SQL bytes=${Buffer.byteLength(row.sql)}`);
    assert.ok(row.bindings.length <= 100, `D1 bindings=${row.bindings.length}`); assert.ok(Buffer.byteLength(row.sql) <= 100000, `D1 SQL bytes=${Buffer.byteLength(row.sql)}`);
    if (observed.readOnly) {
      assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'exact stage replay or read must be read-only');
      assert.doesNotMatch(row.sql, /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu);
    }
    // These exact SELECTs are emitted only by this file's all-table verification
    // helpers. Exact application SQL is retained for strict qualification after
    // the time-sensitive phase; actual D1 executes every original binding.
    if (!/^SELECT \* FROM "[A-Za-z_][A-Za-z0-9_]*"(?: ORDER BY rowid)?$/u.test(row.sql) && row.sql !== 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name') observed.qualify?.(row);
    } catch (error) {
      observed.harnessViolations.push({ sql: row.sql.slice(0, 220), error: String(error) });
      throw error;
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
      async all(...args) { record(row); try { return await statement.all(...args); } catch (error) { diagnostic(`Actual D1 all failed: ${String(error)}; bindings=${bindings.length}; bytes=${Buffer.byteLength(sql)}; SQL=${sql.slice(0, 160)}`); throw error; } },
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
      catch (error) { observed.batchFailures.push(String(error)); diagnostic(`Actual D1 batch failed: ${String(error)}`); throw error; }
      if (observed.afterBatch) result = await observed.afterBatch(rows, result) ?? result;
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

async function templateFor(env, release, sourceContext, sourcePlan) {
  // This is an explicitly approved synthetic maximum-source policy. Derive the
  // actual closed recipe/target and real source bytes before payer approval;
  // never raise a template budget after the protected quote is attempted.
  const recipe = createExperienceOutputRecipe({ output: 'image',
    requirementId: await experienceResourceId(sourcePlan.draftId, 'native-output-requirement'),
    deliverableId: await experienceResourceId(sourcePlan.draftId, 'native-output-deliverable'),
    variantId: await experienceResourceId(sourcePlan.draftId, 'native-output-variant'), aspectRatio: { width: 1, height: 1 } });
  const plan = compileOutputPlan([recipe.spec], { document_id: sourcePlan.documentId, source_revision: 'a'.repeat(64),
    requirement_revision: 'b'.repeat(64), count_policies: {}, suggested_counts: {}, max_targets: 1 });
  assert.deepEqual(plan.issues, []); assert.equal(plan.targets.length, 1);
  const offered = await preflightOutputImageSlidesTarget({ env, target: plan.targets[0], context: { snapshot: sourceContext.snapshot } });
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
async function fixture(t, { memory = false, optional = false, maximum = false, operationCap = 100, lifetime = 30000, attemptVersion = 1 } = {}) {
  assert.ok(attemptVersion === 1 || attemptVersion === 2, 'closed native attempt schema version');
  const attemptSchema = attemptVersion === 2 ? SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA : SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA;
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-stage-custody-d1-')), egress = [], media = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default {fetch(){return new Response('Local D1 fixture only.',{status:404});}};",
    d1Databases: ['Output'], d1Persist: directory, log: new Log(LogLevel.NONE),
    outboundService: req => { egress.push(req.url); throw Error('Worker egress forbidden.'); },
  });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); assert.deepEqual(media, []); });
  const raw = await mf.getD1Database('Output'), observed = observedDatabase(raw, message => t.diagnostic(message)), DB = observed.DB;
  t.after(() => assert.deepEqual(observed.harnessViolations, [], 'application rejection must never swallow a harness read-only or SQL-limit failure'));
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Application fetch forbidden.'); });
  const env = { DB, OPENAI_API_KEY: 'no-network-fixture', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: 'gpt-image-2',
    MEDIA: Object.fromEntries(['get', 'head', 'put', 'delete', 'list'].map(method => [method, () => { media.push(method); throw Error('Media forbidden.'); }])),
    ASSETS: { fetch() { egress.push('assets'); throw Error('Assets forbidden.'); } } };
  // Inert DDL and existing synthetic payer/destination rows are fixture setup.
  // Guest sessions, source, stages and canonical claims use their actual writers.
  await ensureSchema(env);
  for (const sql of [...GUEST_CUSTODY_SCHEMA, ...GUEST_SOURCE_SCHEMA, ...SPONSOR_ENTITLEMENT_SCHEMA, ...SPONSOR_RESOURCE_SCHEMA, ...SPONSOR_APPROVAL_SCHEMA,
    ...(optional ? [...optionalSchema, ...attemptSchema] : SPONSOR_DRIVER_SCHEMA),
    ...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_IMAGE_CLAIM_SCHEMA, ...GUEST_PLAN_CUSTODY_SCHEMA,
    ...GUEST_IMAGE_STAGE_CUSTODY_SCHEMA, ...SPONSOR_NATIVE_IMAGE_READ_INDEXES.map(index => index.sql)]) await DB.prepare(sql).run();
  if (memory) for (const name of ['0027_memory_native_origins.sql', '0033_memory_structured_answer_provenance.sql', '0034_memory_document_job_origins.sql'])
    await DB.batch(statements(await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8')).map(sql => DB.prepare(sql)));
  for (const actor of [payer, destination]) await DB.prepare('INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(actor, `${actor}@example.invalid`, actor, 'creator', POLICY_VERSION, time, time, time).run();
  await appendAuditEvent(env, targetStream, 'user', 'ProjectCreated', { project_id: 'synthetic-existing-project', name: 'Existing canonical work' });
  const targetHead = await streamHead(env, targetStream), targetHistory = await readWorkspaceEvents(env, targetStream);
  assert.equal(targetHead, 1);
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
  const originalEvents = await readWorkspaceEvents(env, prepared.plan.streamId), sourceContext = authoritativeCreativeContext(originalEvents, {
    projectId: prepared.plan.projectId, documentId: prepared.plan.documentId });
  const template = await templateFor(env, release, sourceContext, prepared.plan), allowance = { maximumOperations: operationCap, maximumTextBytes: 1000000,
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
  assert.deepEqual((await rows(DB, 'users')).map(row => row.user_id), [payer, destination]);
  // Qualification runs after the history/retirement phase: compiling exact SQL
  // must not consume the original short source lifetime before native writes.
  const schema = (await DB.prepare(`SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name`).all()).results.map(row => row.sql);
  observed.schema = schema;
  observed.records.length = 0; observed.batches.length = 0;
  return { raw, DB, env, observed, session, proof, terms, sourcePolicy, prepared, committed, inventory, native, release, subject, compiled, approvalId,
    originalEvents, sourceContext, input, memory, optional, maximum, attemptVersion, schema, targetHead, targetHistory,
    review: () => prepareGuestImageConfirmation(request(), env, input),
    confirm: review => confirmGuestImageRequirement(request(), env, { ...input, reviewedRequirementDigest: review.reviewedRequirementDigest, explicitRequirementsConfirmation: true }),
    preflight: () => preflightGuestImage(request(), env, input), quote: () => readGuestImagePreflight(request(), env, input),
    save: () => saveGuestImageRequirement(request(), env, input), read: () => readGuestImageRequirement(request(), env, input) };
}

const isReservation = records => records.some(row => /^INSERT INTO experience_sponsor_driver_stages\(/u.test(row.sql));
const isClaim = records => records.some(row => /INSERT INTO experience_guest_image_stage_custodies\b/u.test(row.sql));
const retire = f => retireExpiredClaimedGuestImageStage(f.env, { sessionId: f.session.sessionId });
const databaseNow = async f => (await f.DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value;
const withoutProof = input => ({ sessionId: input.sessionId, requestId: input.requestId, approvedManifestDigest: input.approvedManifestDigest });
const roles = state => state === 'confirmed' ? ['confirmation'] : state === 'quoted' ? ['confirmation', 'quote', 'construction'] : ['confirmation', 'construction'];
async function due(f) {
  const deadline = performance.now() + 45000;
  while (await databaseNow(f) < Date.parse(f.prepared.expiresAt)) {
    assert.ok(performance.now() < deadline, 'real D1 source deadline becomes due without any expiry rewrite');
    await delay(50);
  }
}
function tailEvents(f, state) {
  const tails = state.contents.events.filter(row => row.stream_id === f.prepared.plan.streamId && row.sequence > f.committed.head).sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(tails.map(row => row.type), f.stageState === 'quoted' ? ['BlockCreated', 'OutputPlanConfirmed', 'OutputPlanPreflighted'] : ['BlockCreated', 'OutputPlanConfirmed']);
  assert.equal(tails.at(-1).sequence, f.stageHead); return tails;
}
async function prepareState(f, state) {
  f.saved = await f.save(); const review = await f.review(), confirmed = await f.confirm(review);
  assert.equal(f.saved.status, 'saved'); assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.revision, f.committed.head + 2);
  if (state === 'quoted') { const quoted = await f.preflight(); assert.equal(quoted.status, 'quoted'); assert.equal(quoted.replayed, false); }
  if (state === 'preflight-claimed-unknown') {
    let attempts = 0;
    f.observed.afterBatch = records => { if (isReservation(records)) { attempts++; throw Error('Synthetic lost construction ACK after real commit'); } };
    try { await assert.rejects(f.preflight(), /Synthetic lost construction ACK/u); } finally { f.observed.afterBatch = null; }
    assert.equal(attempts, 1);
  }
  f.stageState = state; f.stageHead = f.committed.head + (state === 'quoted' ? 3 : 2);
  const snapshotBefore = await snapshot(f.DB); tailEvents(f, snapshotBefore);
  assert.equal(snapshotBefore.contents.experience_sponsor_resource_receipts.length, state === 'confirmed' ? 2 : 3);
  assert.equal(snapshotBefore.contents.output_preflights.length, state === 'quoted' ? 1 : 0);
  assert.deepEqual(snapshotBefore.contents.users.map(row => row.user_id), [payer, destination]);
  for (const table of ['output_execution_grants', 'output_operation_slots', 'output_provider_calls', 'output_assets', 'output_results']) assert.deepEqual(snapshotBefore.contents[table], []);
  // Prove the getter observes actual quote configuration, then forbid any
  // historical claim/read/cleanup from constructing another native quote.
  let entries = 0;
  const originalProviderDescriptor = Object.getOwnPropertyDescriptor(f.env, 'OPENAI_API_KEY'); assert.ok(originalProviderDescriptor);
  Object.defineProperty(f.env, 'OPENAI_API_KEY', { configurable: true, get() { entries++; const error = Error('History entered quote construction'); f.quoteConfigurationError = error.stack; throw error; } });
  await assert.rejects(templateFor(f.env, f.release, f.sourceContext, f.prepared.plan), /History entered quote construction/u);
  assert.equal(entries, 1); entries = 0; f.quoteConfigurationError = null;
  f.assertNoConstruction = () => assert.equal(entries, 0);
  const historicalProviderDescriptor = Object.getOwnPropertyDescriptor(f.env, 'OPENAI_API_KEY');
  f.withOrdinaryNativeEnvironment = async run => {
    f.assertNoConstruction();
    // Ordinary governed source validation copies env at capacity.ts:55. The
    // exact original descriptor permits that native continuation only; the
    // historical claim/read/cleanup sentinel is restored even on failure.
    Object.defineProperty(f.env, 'OPENAI_API_KEY', originalProviderDescriptor);
    try { return await run(); }
    finally { Object.defineProperty(f.env, 'OPENAI_API_KEY', historicalProviderDescriptor); f.assertNoConstruction(); }
  };
  f.observed.records.length = 0; f.observed.batches.length = 0;
  f.claimRequest = canonicalRequest();
  const inventory = await inspectGuestImageStageClaimInventory(f.claimRequest, f.env, { proof: f.proof });
  assert.equal(inventory.stageState, state); assert.equal(inventory.stageHead, f.stageHead);
  f.claimInput = { sessionId: f.session.sessionId, requestId: 'synthetic-stage-claim', approvedManifestDigest: inventory.manifestDigest, proof: f.proof };
  return inventory;
}
function assertClaim(f, result, replayed = false) {
  assert.equal(result.status, 'image-stage-history-claimed'); assert.equal(result.sessionId, f.session.sessionId);
  assert.equal(result.stageState, f.stageState); assert.equal(result.contextCustodyTransferred, true);
  assert.equal(result.requirementCustodyTransferred, true); assert.equal(result.stageHistoryCustodyTransferred, true);
  assert.equal(result.historyRetention, 'retained'); assert.equal(result.planRetention, 'not-attempted');
  assert.equal(result.generationAvailable, false); assert.equal(result.miniAppClaimComplete, false); assert.equal(result.replayed, replayed);
  assert.equal(result.receipt.destinationUserId, destination); assert.equal(result.receipt.projectId, f.session.projectId);
  assert.equal(result.receipt.documentId, f.session.documentId); assert.equal(result.receipt.requirementId, f.saved.requirementId);
  assert.equal(result.receipt.manifestDigest, f.claimInput.approvedManifestDigest); assert.equal(result.receipt.revision, f.targetHead + f.committed.head + 1);
  for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken, payer, 'private_json', 'guestSponsorPreparation']) assert.equal(JSON.stringify(result).includes(secret), false);
}
async function assertClaimFootprint(f, before, claimed) {
  const after = await snapshot(f.DB); assert.deepEqual(after.schema, before.schema);
  const changed = new Set(['events', 'event_private_payloads', 'event_client_receipts', 'private_content', 'output_commands', 'experience_guest_claim_leases',
    'experience_guest_sessions', 'experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_image_stage_custodies', 'experience_guest_image_stage_copies']);
  for (const [table, prior] of Object.entries(before.contents)) if (!changed.has(table)) assert.deepEqual(after.contents[table], prior, `unchanged ${table}`);
  for (const table of ['events', 'event_private_payloads', 'event_client_receipts', 'private_content', 'output_commands']) for (const prior of before.contents[table])
    assert.ok(after.contents[table].some(row => canonicalJson(row) === canonicalJson(prior)), `original ${table} row preserved`);
  for (const [table, count] of [['events', f.committed.head + 1], ['event_private_payloads', f.committed.head + 1], ['event_client_receipts', f.committed.head],
    ['private_content', roles(f.stageState).length], ['output_commands', 1]]) assert.equal(after.contents[table].length, before.contents[table].length + count, `exact ${table} delta`);
  const canonical = await readWorkspaceEvents(f.env, targetStream); assert.deepEqual(canonical.slice(0, f.targetHead), f.targetHistory);
  const added = after.contents.events.filter(row => row.stream_id === targetStream && row.sequence > f.targetHead);
  assert.deepEqual(added.map(row => row.sequence), Array.from({ length: f.committed.head + 1 }, (_, i) => f.targetHead + i + 1));
  assert.ok(added.slice(0, -1).every(row => row.actor === 'user' && row.client_id === 'server:guest-context-adoption'));
  assert.equal(added.at(-1).actor, `user:${destination}`); assert.equal(added.at(-1).event_id, claimed.receipt.eventId);
  assert.equal(added.at(-1).type, 'BlockCreated'); assert.ok(!added.some(row => ['OutputPlanConfirmed', 'OutputPlanPreflighted'].includes(row.type)));
  for (let i = 0; i < f.prepared.plan.events.length; i++) assert.deepEqual(canonical[f.targetHead + i].payload,
    { ...f.prepared.plan.events[i].payload, client_event_id: `guest-context-adoption:v1:${f.session.sessionId}:${i}` });
  const originalSave = before.contents.event_private_payloads.find(row => row.private_event_id === f.saved.eventId);
  assert.deepEqual(canonical.at(-1).payload.properties, JSON.parse(originalSave.private_json).properties);
  const context = after.contents.experience_guest_context_adoptions[0], save = after.contents.experience_guest_image_claims[0], stage = after.contents.experience_guest_image_stage_custodies[0];
  const session = after.contents.experience_guest_sessions[0];
  assert.equal(stage.context_lineage_digest, context.lineage_digest); assert.equal(stage.save_lineage_digest, save.lineage_digest);
  for (const row of [context, save, stage]) {
    assert.equal(row.manifest_digest, f.claimInput.approvedManifestDigest); assert.equal(row.lease_id, claimed.receipt.leaseId);
    assert.equal(row.request_id, f.claimInput.requestId); assert.equal(row.created_at_ms, session.revoked_at_ms);
  }
  assert.deepEqual({ ...session, revoked_at_ms: null }, { ...before.contents.experience_guest_sessions[0], revoked_at_ms: null });
  const lineage = JSON.parse(stage.lineage_json); assert.equal(lineage.source.state, f.stageState); assert.equal(lineage.source.originalPayerUserId, payer);
  assert.deepEqual(lineage.copies.map(row => row.role), roles(f.stageState));
  for (const role of roles(f.stageState)) {
    const manifest = after.contents.experience_guest_image_stage_copies.find(row => row.role === role);
    const body = after.contents.private_content.find(row => row.content_id === manifest.content_id);
    assert.equal(body.kind, 'guest-image-stage-history'); assert.equal(body.owner_id, destination); assert.equal(body.redacted_at, null);
    assert.equal(manifest.created_at, body.created_at); assert.equal(manifest.expires_at, body.expires_at);
    assert.equal(manifest.byte_length, Buffer.byteLength(body.content)); assert.equal(manifest.original_digest, await digest(body.content));
    assert.ok(Date.parse(body.expires_at) > Date.parse(f.prepared.expiresAt), 'native canonical retention is independent from original source expiry');
    if (role !== 'construction') {
      const event = tailEvents(f, before).find(row => row.type === (role === 'confirmation' ? 'OutputPlanConfirmed' : 'OutputPlanPreflighted'));
      assert.equal(body.content, before.contents.event_private_payloads.find(row => row.private_event_id === event.event_id).private_json);
    } else {
      const copied = JSON.parse(body.content); assert.deepEqual(copied.stage, before.contents.experience_sponsor_driver_stages[0]);
      assert.ok(before.contents.experience_sponsor_resource_receipts.some(row => canonicalJson(row) === canonicalJson(copied.resource)));
    }
  }
  assert.deepEqual((await f.DB.prepare('PRAGMA foreign_key_check').all()).results, []); return after;
}
async function assertHistory(f) {
  const before = await snapshot(f.DB); f.observed.readOnly = true;
  try {
    const history = await readClaimedGuestImageStageHistory(canonicalRequest('GET'), f.env, { sessionId: f.session.sessionId });
    assert.equal(history.kind, 'guest-image-stage-history'); assert.equal(history.documentId, f.session.documentId); assert.equal(history.stageState, f.stageState);
    assert.equal(history.generationAvailable, false); assert.equal(history.miniAppClaimComplete, false);
    assert.deepEqual(history.components.map(row => row.role), roles(f.stageState));
    assert.deepEqual(history.provenance, { guestSubject: f.session.guestSubject, originalPayerUserId: payer,
      originalSourceExpiresAt: f.prepared.expiresAt, originalQuoteExpiresAt: before.contents.output_preflights[0]?.expires_at ?? null });
    for (const component of history.components) {
      const mapping = before.contents.experience_guest_image_stage_copies.find(row => row.role === component.role);
      assert.equal(component.content, before.contents.private_content.find(row => row.content_id === mapping.content_id).content);
    }
    assert.deepEqual(await snapshot(f.DB), before); return history;
  } finally { f.observed.readOnly = false; }
}
async function assertOnlyTailsChanged(f, before, result) {
  const after = await snapshot(f.DB), ids = new Set(tailEvents(f, before).map(row => row.event_id)), expected = structuredClone(before);
  expected.contents.event_private_payloads = expected.contents.event_private_payloads.map(row => {
    if (!ids.has(row.private_event_id)) return row;
    const erased = after.contents.event_private_payloads.find(value => value.private_event_id === row.private_event_id);
    assert.equal(erased.private_json, ''); assert.equal(new Date(erased.redacted_at).toISOString(), erased.redacted_at);
    assert.ok(Date.parse(erased.redacted_at) >= Date.parse(f.prepared.expiresAt));
    if (row.redacted_at !== null) assert.equal(erased.redacted_at, row.redacted_at);
    return { ...row, private_json: '', redacted_at: erased.redacted_at };
  });
  assert.deepEqual(after, expected, 'only original N+1/N+2/(N+3) bytes and native tombstones change; all canonical, financial, schema and resource rows survive');
  assert.equal(result.scope, 'claimed-original-image-stage-private-bodies'); assert.equal(result.stageState, f.stageState);
  assert.deepEqual(result.tails.map(row => row.eventId), [...ids]); return after;
}
async function retireSourceExactly(f) {
  const before = await snapshot(f.DB), expected = structuredClone(before), ids = new Set(f.committed.eventIds);
  const result = await retireExpiredGuestImageSource(f.env, { sessionId: f.session.sessionId }); assert.equal(result.status, 'retired');
  const after = await snapshot(f.DB);
  for (const [table, key, field] of [['private_content', 'content_id', 'content'], ['event_private_payloads', 'private_event_id', 'private_json']]) {
    expected.contents[table] = expected.contents[table].map(row => {
      if (table === 'private_content' ? row[key] !== f.prepared.plan.draftId : !ids.has(row[key])) return row;
      const erased = after.contents[table].find(value => value[key] === row[key]); assert.equal(erased[field], ''); assert.equal(new Date(erased.redacted_at).toISOString(), erased.redacted_at);
      return { ...row, [field]: '', redacted_at: erased.redacted_at };
    });
  }
  assert.deepEqual(after, expected, 'source helper erases only original source draft and prefix, preserving original stage tails and every canonical copy');
}
function qualify(t, f) {
  const verificationScan = sql => /^SELECT \* FROM "[A-Za-z_][A-Za-z0-9_]*"(?: ORDER BY rowid)?$/u.test(sql) || sql === 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name';
  const records = f.observed.records.filter(row => /^(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b/iu.test(row.sql.trim()) && !verificationScan(row.sql));
  const unique = new Map(records.map(row => [row.sql, row])); assert.ok(unique.size > 0);
  for (const row of unique.values()) {
    const key = createHash('sha256').update(JSON.stringify([f.schema, row.sql, strictLimits])).digest('hex');
    let compiled = strictQualificationCache.get(key);
    if (!compiled) { compiled = compileSqliteExpressionDepth(null, row.sql, { schema: f.schema, functions: [], limit: 100, queryLimits: strictLimits }); strictQualificationCache.set(key, compiled); }
    assert.equal(compiled.ok, true, `${compiled.error ?? ''}\n${row.sql.slice(0, 220)}`); assert.equal(compiled.limit, 100);
    assert.deepEqual(compiled.queryLimits, strictLimits); assert.equal(compiled.parameterCount, row.parameters);
  }
  assert.deepEqual(f.observed.harnessViolations, []); f.assertNoConstruction();
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', applicationExecution: 'Node-hosted native source functions', localOnly: true,
    stageState: f.stageState, sourceHead: f.committed.head, stageHead: f.stageHead, canonicalStartHead: f.targetHead,
    memory: f.memory, optionalSponsorFamilies: f.optional, subjectCharacters: f.subject.length, subjectUtf8Bytes: Buffer.byteLength(f.subject),
    exactStatements: records.length, strictUniqueSql: unique.size, expressionDepth: 100, ...strictLimits,
    maxBindings: Math.max(...records.map(row => row.parameters)), maxSqlBytes: Math.max(...records.map(row => row.sqlBytes)) }));
}
for (const scenario of [
  { state: 'confirmed', sourceFirst: true, memory: false, optional: false, maximum: false, attemptVersion: 1 },
  { state: 'preflight-claimed-unknown', sourceFirst: false, memory: false, optional: true, maximum: false, attemptVersion: 1 },
  { state: 'quoted', sourceFirst: true, memory: true, optional: true, maximum: true, attemptVersion: 2 },
]) test(`actual local D1 claims ${scenario.state} and preserves canonical custody during ${scenario.sourceFirst ? 'source-first' : 'tail-first'} cleanup`, { timeout: 180000 }, async t => {
  const f = await fixture(t, scenario); await prepareState(f, scenario.state); const before = await snapshot(f.DB);
  const claimed = await claimGuestImageStages(f.claimRequest, f.env, f.claimInput);
  // Read directly before asserting the source-free availability flag so any
  // bounded-body/proof failure retains its original source stack in this test.
  await assertHistory(f); assertClaim(f, claimed);
  await assertClaimFootprint(f, before, claimed);
  const current = await snapshot(f.DB); f.observed.readOnly = true;
  try {
    const replayed = await claimGuestImageStages(canonicalRequest(), f.env, withoutProof(f.claimInput)); assertClaim(f, replayed, true);
    assert.deepEqual(replayed.receipt, claimed.receipt); await assert.rejects(retire(f)); assert.deepEqual(await snapshot(f.DB), current);
  } finally { f.observed.readOnly = false; }
  await due(f); if (scenario.sourceFirst) await retireSourceExactly(f);
  const beforeCleanup = await snapshot(f.DB), retired = await retire(f); assert.equal(retired.replayed, false);
  await assertOnlyTailsChanged(f, beforeCleanup, retired); if (!scenario.sourceFirst) await retireSourceExactly(f);
  await assertHistory(f);
  const after = await snapshot(f.DB); f.observed.readOnly = true;
  try { const replay = await retire(f); assert.equal(replay.replayed, true); assert.ok(replay.tails.every(row => row.replayed)); assert.deepEqual(await snapshot(f.DB), after); }
  finally { f.observed.readOnly = false; }
  qualify(t, f);
});

test('actual local D1 stage claim rolls back late original drift and resolves one lost ACK without a second copy', { timeout: 180000 }, async t => {
  const f = await fixture(t, { lifetime: 120000, memory: true, optional: true });
  const inventory = await prepareState(f, 'quoted');
  const { acquireGuestImageStageClaimLease } = await import('../worker/experience-guest-claim-lease.ts');
  await acquireGuestImageStageClaimLease(f.claimRequest, f.env, { proof: f.proof, requestId: f.claimInput.requestId, inventory });
  const before = await snapshot(f.DB), original = tailEvents(f, before).at(-1).event_id; let injected = 0;
  f.observed.beforeBatch = (items, records) => {
    if (!isClaim(records)) return;
    injected++; const guards = records.flatMap((row, index) => /^\s*INSERT INTO output_atomic_assertions\b/u.test(row.sql) ? [index] : []);
    const revocation = records.findIndex(row => /^UPDATE experience_guest_sessions SET revoked_at_ms=/u.test(row.sql));
    assert.ok(guards.length >= 2 && revocation > guards[0] && revocation < guards.at(-1));
    assert.ok(records.slice(revocation + 1).some(row => /guest_stage|stage_claim|event_private_payloads/u.test(row.sql)), 'source after-proofs still follow the final native mutation');
    const changed = [...items];
    // Every canonical write and revocation has run; every source after-proof is
    // still pending. Appending after the final assertion would test no guard.
    changed.splice(revocation + 1, 0, f.DB.prepare("UPDATE event_private_payloads SET owner_id='synthetic-foreign-owner' WHERE private_event_id=?").bind(original));
    return changed;
  };
  try { await assert.rejects(claimGuestImageStages(f.claimRequest, f.env, f.claimInput)); } finally { f.observed.beforeBatch = null; }
  assert.equal(injected, 1); assert.ok(f.observed.batchFailures.some(error => /CHECK constraint failed/iu.test(error)));
  assert.deepEqual(await snapshot(f.DB), before, 'actual final proof rolls back canonical copies, revocation, mappings and injected original drift');
  let attempts = 0, lost = 0;
  f.observed.beforeBatch = (_items, records) => { if (isClaim(records)) attempts++; };
  f.observed.afterBatch = records => { if (isClaim(records)) { lost++; throw Error('Synthetic lost stage claim ACK after real commit'); } };
  let claimed;
  try { claimed = await claimGuestImageStages(f.claimRequest, f.env, f.claimInput); } finally { f.observed.beforeBatch = null; f.observed.afterBatch = null; }
  assert.equal(attempts, 1); assert.equal(lost, 1); assertClaim(f, claimed, true);
  const after = await assertClaimFootprint(f, before, claimed); await assertHistory(f); f.observed.readOnly = true;
  try { assertClaim(f, await claimGuestImageStages(canonicalRequest(), f.env, withoutProof(f.claimInput)), true); assert.deepEqual(await snapshot(f.DB), after); }
  finally { f.observed.readOnly = false; }
  qualify(t, f);
});

async function governAndContinue(f) {
  const headers = extra => ({ origin, 'oai-authenticated-user-id': destination, 'oai-authenticated-user-email': `${destination}@example.invalid`, ...extra });
  const workspace = (path, body) => handleWorkspaces(new Request(`${origin}/api/workspaces/${path.join('/')}`, { method: 'POST',
    headers: headers(body ? { 'content-type': 'application/json' } : {}), ...(body ? { body: JSON.stringify(body) } : {}) }), f.env, path);
  const created = await workspace([], { name: 'Canonical stage history workspace' }), createdBody = await created.json();
  assert.equal(created.status, 201, JSON.stringify(createdBody)); const { organizationId } = createdBody;
  const attached = await workspace([organizationId, 'projects'], { projectId: f.prepared.plan.projectId }), attachedBody = await attached.json();
  assert.equal(attached.status, 201, JSON.stringify(attachedBody)); const { projectAccessId } = attachedBody;
  const opened = await workspace([organizationId, 'projects', projectAccessId, 'context']); assert.equal(opened.status, 200, await opened.clone().text());
  const cookie = opened.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const refreshed = await handleEvents(new Request(`${origin}/api/events`, { headers: headers({ cookie }) }), f.env); assert.equal(refreshed.status, 200, await refreshed.clone().text());
  const output = async body => {
    const base = '/api/output-requirements', path = body ? base : `${base}?documentId=${encodeURIComponent(f.prepared.plan.documentId)}`;
    const response = await handleOutputRequirements(new Request(`${origin}${path}`, { method: body ? 'POST' : 'GET',
      headers: headers({ cookie, ...(body ? { 'content-type': 'application/json' } : {}) }), ...(body ? { body: JSON.stringify(body) } : {}) }),
      f.env, base, { waitUntil() { assert.fail('native governed SAVE/confirm cannot start provider/background work'); } });
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify({ value, quoteConfigurationError: f.quoteConfigurationError })); return value;
  };
  const initial = await output(), requirement = initial.requirements.find(row => row.blockId === f.claimed.receipt.requirementId); assert.ok(requirement);
  const spec = structuredClone(requirement.spec); spec.label = 'Governed canonical Image';
  await output({ action: 'save', documentId: f.session.documentId, blockId: f.claimed.receipt.requirementId, spec,
    clientMutationId: 'governed-stage-history-save', expectedRevision: initial.revision });
  const changed = await output(); assert.equal(changed.requirements.find(row => row.blockId === f.claimed.receipt.requirementId).spec.label, spec.label);
  await output({ action: 'confirm', documentId: f.session.documentId, clientMutationId: 'governed-stage-history-confirm', expectedRevision: changed.revision });
  const plans = (await rows(f.DB, 'output_plan_revisions')).filter(row => row.scope_key === `project:${organizationId}:${projectAccessId}`);
  assert.equal(plans.length, 1); assert.equal(plans[0].owner_user_id, destination); assert.equal(plans[0].scope_kind, 'project');
}
test('actual local D1 native governed continuation permits original source and stage cleanup while personal history read refuses', { timeout: 180000 }, async t => {
  const f = await fixture(t, { memory: true, optional: true, attemptVersion: 2, lifetime: 40000 }); await prepareState(f, 'quoted');
  f.claimed = await claimGuestImageStages(f.claimRequest, f.env, f.claimInput); assertClaim(f, f.claimed); await assertHistory(f);
  const noExecution = ['budget_reservations', 'cost_budget_reservations', 'document_jobs', 'output_execution_grants', 'output_provider_calls', 'experience_sponsor_resource_receipts'];
  const before = Object.fromEntries(await Promise.all(noExecution.map(async table => [table, await rows(f.DB, table)])));
  await f.withOrdinaryNativeEnvironment(() => governAndContinue(f));
  for (const table of noExecution) assert.deepEqual(await rows(f.DB, table), before[table], `${table} remains unchanged`);
  const governed = await snapshot(f.DB); f.observed.readOnly = true;
  try { await assert.rejects(readClaimedGuestImageStageHistory(canonicalRequest('GET'), f.env, { sessionId: f.session.sessionId })); assert.deepEqual(await snapshot(f.DB), governed); }
  finally { f.observed.readOnly = false; }
  await due(f); await retireSourceExactly(f);
  const beforeCleanup = await snapshot(f.DB), result = await retire(f); const after = await assertOnlyTailsChanged(f, beforeCleanup, result);
  f.observed.readOnly = true;
  try { assert.equal((await retire(f)).replayed, true); assert.deepEqual(await snapshot(f.DB), after); }
  finally { f.observed.readOnly = false; }
  qualify(t, f);
});

// This is only SQL/value equivalence for an incomplete pure predicate. These
// deliberately nullable adverse rows never stand in for a completed claim.
test('actual local D1 six-operand body tuple preserves scalar positive and every field tamper type and null refusal', { timeout: 120000 }, async t => {
  const { guestImageStageCopyBodyProof } = await import('../worker/experience-guest-image-stage-custody.ts');
  const { nativeMemoryAnswerExclusion } = await import('../worker/memory-native-boundary.ts');
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-stage-tuple-d1-')), egress = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default {fetch(){return new Response('Local predicate fixture only.',{status:404});}};", d1Databases: ['Output'], d1Persist: directory,
    log: new Log(LogLevel.NONE), outboundService: req => { egress.push(req.url); throw Error('Worker egress forbidden.'); } });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); });
  const raw = await mf.getD1Database('Output'), observed = observedDatabase(raw, message => t.diagnostic(message)), DB = observed.DB, env = { DB };
  t.after(() => assert.deepEqual(observed.harnessViolations, []));
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Application fetch forbidden.'); });
  const schema = [
    'CREATE TABLE private_content(content_id TEXT,owner_id TEXT,kind TEXT,content TEXT,created_at TEXT,expires_at TEXT,redacted_at TEXT)',
    'CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT)', 'CREATE TABLE private_content_retention_scopes(content_id TEXT)',
    'CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT,actor TEXT)',
  ];
  for (const sql of schema) await DB.prepare(sql).run();
  const owner = 'synthetic-canonical-owner', body = '{"history":"é🦆"}', copy = { session_id: 'synthetic-tuple-session', role: 'confirmation',
    content_id: `guest-image-stage-history-${'a'.repeat(64)}`, original_digest: `sha256:${'b'.repeat(64)}`, byte_length: Buffer.byteLength(body),
    created_at: '2000-01-01T00:00:00.000Z', expires_at: '2999-01-01T00:00:00.000Z' };
  const row = { content_id: copy.content_id, owner_id: owner, kind: 'guest-image-stage-history', content: body, created_at: copy.created_at, expires_at: copy.expires_at, redacted_at: null };
  await DB.prepare(`INSERT INTO private_content(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  const exclusion = await nativeMemoryAnswerExclusion(env, { answerAlias: 'content' });
  // Exact original scalar predicate retained independently as the comparison
  // oracle; the six operands match the current helper's single JSON tuple.
  const oldProof = (capturedOwner = owner, capturedCopy = copy, capturedBody = body) => ({
    sql: `EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND content.owner_id=?
      AND content.kind='guest-image-stage-history' AND content.content=? AND length(CAST(content.content AS BLOB))=?
      AND content.created_at=? AND content.expires_at=? AND content.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND content.redacted_at IS NULL AND (NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=content.content_id)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=content.content_id)) AND (${exclusion.sql}))`,
    bindings: [capturedCopy.content_id, capturedOwner, capturedBody, capturedCopy.byte_length, capturedCopy.created_at, capturedCopy.expires_at, ...exclusion.bindings],
  });
  const next = guestImageStageCopyBodyProof(owner, copy, body, exclusion), prior = oldProof();
  assert.equal(prior.bindings.length - next.bindings.length, 5); assert.deepEqual(next.bindings.slice(1), exclusion.bindings);
  let comparisons = 0, capturedRefusals = 0;
  const value = async proof => (await DB.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...proof.bindings).first()).current;
  async function compare(expected) { assert.equal(await value(prior), expected); assert.equal(await value(next), expected); comparisons++; }
  await compare(1);
  for (const [field, changed] of [['content_id', 'different-content'], ['owner_id', 'different-owner'], ['content', '{"history":"é🦅"}'],
    ['content', body + ' '], ['created_at', '2000-01-01T00:00:01.000Z'], ['expires_at', '2999-01-01T00:00:01.000Z']]) {
    await DB.prepare(`UPDATE private_content SET ${field}=?`).bind(changed).run(); await compare(0);
    await DB.prepare(`UPDATE private_content SET ${field}=?`).bind(row[field]).run(); await compare(1);
  }
  for (const field of ['content_id', 'owner_id', 'content', 'created_at', 'expires_at']) for (const changed of [null, 17]) {
    await DB.prepare(`UPDATE private_content SET ${field}=?`).bind(changed).run(); await compare(0);
    await DB.prepare(`UPDATE private_content SET ${field}=?`).bind(row[field]).run();
  }
  assert.equal(await value(oldProof(owner, { ...copy, byte_length: copy.byte_length + 1 })), 0);
  assert.throws(() => guestImageStageCopyBodyProof(owner, { ...copy, byte_length: copy.byte_length + 1 }, body, exclusion), /body_unavailable/u); capturedRefusals++;
  for (const changed of [null, undefined, 17, true, {}, []]) {
    assert.throws(() => guestImageStageCopyBodyProof(changed, copy, body, exclusion), /body_unavailable/u); capturedRefusals++;
    assert.throws(() => guestImageStageCopyBodyProof(owner, copy, changed, exclusion), /body_unavailable/u); capturedRefusals++;
    for (const field of ['content_id', 'byte_length', 'created_at', 'expires_at']) {
      assert.throws(() => guestImageStageCopyBodyProof(owner, { ...copy, [field]: changed }, body, exclusion), /body_unavailable/u); capturedRefusals++;
    }
  }
  for (const changed of [String(copy.byte_length), NaN, Infinity, copy.byte_length + 0.5]) {
    assert.throws(() => guestImageStageCopyBodyProof(owner, { ...copy, byte_length: changed }, body, exclusion), /body_unavailable/u); capturedRefusals++;
  }
  await DB.prepare('UPDATE private_content SET content_id=NULL,owner_id=NULL,content=NULL,created_at=NULL,expires_at=NULL').run();
  const allNull = { ...copy, content_id: null, created_at: null, expires_at: null, byte_length: null };
  assert.equal(await value(oldProof(null, allNull, null)), 0);
  assert.throws(() => guestImageStageCopyBodyProof(null, allNull, null, exclusion), /body_unavailable/u); capturedRefusals++;
  const proofs = [prior, next].map(proof => `SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`);
  for (const sql of proofs) {
    const compiled = compileSqliteExpressionDepth(null, sql, { schema, functions: [], limit: 100, queryLimits: strictLimits });
    assert.equal(compiled.ok, true, compiled.error); assert.equal(compiled.limit, 100); assert.deepEqual(compiled.queryLimits, strictLimits);
  }
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', scope: 'incomplete exact body predicate; no custody authority', comparisons,
    capturedRefusals, tupleOperands: 6, savedBindings: 5, priorBindings: prior.bindings.length, tupleBindings: next.bindings.length,
    expressionDepth: 100, ...strictLimits }));
});

test('actual local D1 five-operand metadata tuple preserves scalar identity length type and null refusal', { timeout: 120000 }, async t => {
  const { guestImageStageCopyMetadataProof } = await import('../worker/experience-guest-image-stage-custody.ts');
  const { nativeMemoryAnswerExclusion } = await import('../worker/memory-native-boundary.ts');
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-stage-metadata-d1-')), egress = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default {fetch(){return new Response('Local predicate fixture only.',{status:404});}};", d1Databases: ['Output'], d1Persist: directory,
    log: new Log(LogLevel.NONE), outboundService: req => { egress.push(req.url); throw Error('Worker egress forbidden.'); } });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); });
  const raw = await mf.getD1Database('Output'), observed = observedDatabase(raw, message => t.diagnostic(message)), DB = observed.DB, env = { DB };
  t.after(() => assert.deepEqual(observed.harnessViolations, []));
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Application fetch forbidden.'); });
  // No declared affinity in this adverse table: D1 numeric bindings stay REAL;
  // explicit CAST below also probes INTEGER. This proves SQL type/null equivalence only;
  // these nullable rows are never completed claim or disclosure authority.
  const schema = ['CREATE TABLE private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)',
    'CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT)', 'CREATE TABLE private_content_retention_scopes(content_id TEXT)',
    'CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT,actor TEXT)'];
  for (const sql of schema) await DB.prepare(sql).run();
  const owner = 'synthetic-canonical-owner', body = '{"history":"é🦆"}', copy = { session_id: 'synthetic-metadata-session', role: 'confirmation',
    content_id: `guest-image-stage-history-${'a'.repeat(64)}`, original_digest: `sha256:${'b'.repeat(64)}`, byte_length: Buffer.byteLength(body),
    created_at: '2000-01-01T00:00:00.000Z', expires_at: '2999-01-01T00:00:00.000Z' };
  const row = { content_id: copy.content_id, owner_id: owner, kind: 'guest-image-stage-history', content: body, created_at: copy.created_at, expires_at: copy.expires_at, redacted_at: null };
  await DB.prepare(`INSERT INTO private_content(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  const exclusion = await nativeMemoryAnswerExclusion(env, { answerAlias: 'content' });
  const oldProof = (capturedOwner = owner, capturedCopy = copy) => ({
    sql: `EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND content.owner_id=?
      AND content.kind='guest-image-stage-history' AND content.redacted_at IS NULL AND content.created_at=? AND content.expires_at=?
      AND content.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND length(CAST(content.content AS BLOB))=? AND (NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=content.content_id)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=content.content_id)) AND (${exclusion.sql}))`,
    bindings: [capturedCopy.content_id, capturedOwner, capturedCopy.created_at, capturedCopy.expires_at, capturedCopy.byte_length, ...exclusion.bindings],
  });
  const prior = oldProof(), next = guestImageStageCopyMetadataProof(owner, copy, exclusion);
  assert.equal(prior.bindings.length - next.bindings.length, 4); assert.deepEqual(next.bindings.slice(1), exclusion.bindings);
  let comparisons = 0, capturedRefusals = 0;
  const value = async proof => (await DB.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...proof.bindings).first()).current;
  async function compare(expected) { assert.equal(await value(prior), expected); assert.equal(await value(next), expected); comparisons++; }
  await compare(1);
  for (const [field, changed] of [['content_id', 'different-content'], ['owner_id', 'different-owner'], ['created_at', '2000-01-01T00:00:01.000Z'],
    ['expires_at', '2999-01-01T00:00:01.000Z'], ['content', body + ' ']]) {
    await DB.prepare(`UPDATE private_content SET ${field}=?`).bind(changed).run(); await compare(0);
    await DB.prepare(`UPDATE private_content SET ${field}=?`).bind(row[field]).run(); await compare(1);
  }
  // Metadata intentionally knows byte count, not byte identity; the unchanged
  // later digest and six-field exact body predicate own private byte fidelity.
  const sameBytes = '{"history":"é🦅"}'; assert.equal(Buffer.byteLength(sameBytes), Buffer.byteLength(body));
  await DB.prepare('UPDATE private_content SET content=?').bind(sameBytes).run(); await compare(1);
  await DB.prepare('UPDATE private_content SET content=?').bind(body).run();
  for (const field of ['content_id', 'owner_id', 'content', 'created_at', 'expires_at']) for (const [expression, changed, storageType] of [
    ['?', null, 'null'], ['?', 17, 'real'], ['CAST(? AS INTEGER)', 17, 'integer'],
  ]) {
    await DB.prepare(`UPDATE private_content SET ${field}=${expression}`).bind(changed).run();
    assert.equal((await DB.prepare(`SELECT typeof(${field}) AS storageType FROM private_content`).first()).storageType, storageType);
    await compare(0); await DB.prepare(`UPDATE private_content SET ${field}=?`).bind(row[field]).run();
  }
  const wrongLength = { ...copy, byte_length: copy.byte_length + 1 };
  assert.equal(await value(oldProof(owner, wrongLength)), 0); assert.equal(await value(guestImageStageCopyMetadataProof(owner, wrongLength, exclusion)), 0);
  assert.equal(await value(guestImageStageCopyMetadataProof(owner, { ...copy, byte_length: Number(`${copy.byte_length}.0`) }, exclusion)), 1);
  for (const changed of [null, undefined, 17, true, {}, []]) {
    assert.throws(() => guestImageStageCopyMetadataProof(changed, copy, exclusion), /body_unavailable/u); capturedRefusals++;
    for (const field of ['content_id', 'created_at', 'expires_at']) {
      assert.throws(() => guestImageStageCopyMetadataProof(owner, { ...copy, [field]: changed }, exclusion), /body_unavailable/u); capturedRefusals++;
    }
  }
  for (const changed of [null, undefined, String(copy.byte_length), true, {}, [], NaN, Infinity, copy.byte_length + 0.5]) {
    assert.throws(() => guestImageStageCopyMetadataProof(owner, { ...copy, byte_length: changed }, exclusion), /body_unavailable/u); capturedRefusals++;
  }
  await DB.prepare('UPDATE private_content SET content_id=NULL,owner_id=NULL,content=NULL,created_at=NULL,expires_at=NULL').run();
  const allNull = { ...copy, content_id: null, created_at: null, expires_at: null, byte_length: null };
  assert.equal(await value(oldProof(null, allNull)), 0); assert.throws(() => guestImageStageCopyMetadataProof(null, allNull, exclusion), /body_unavailable/u); capturedRefusals++;
  for (const proof of [prior, next]) {
    const sql = `SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`;
    const compiled = compileSqliteExpressionDepth(null, sql, { schema, functions: [], limit: 100, queryLimits: strictLimits });
    assert.equal(compiled.ok, true, compiled.error); assert.equal(compiled.limit, 100); assert.deepEqual(compiled.queryLimits, strictLimits);
  }
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', scope: 'incomplete metadata predicate; no byte identity or custody authority', comparisons,
    capturedRefusals, tupleOperands: 5, savedBindings: 4, priorBindings: prior.bindings.length, tupleBindings: next.bindings.length,
    storedTypesAsserted: ['null', 'real', 'integer'], equalByteChangedContentAllowed: true, expressionDepth: 100, ...strictLimits }));
});

test('actual local D1 bounded body-set equals independent body predicates for every row and exclusion', { timeout: 120000 }, async t => {
  const { guestImageStageCopyBodyProof, guestImageStageCopyBodiesProof } = await import('../worker/experience-guest-image-stage-custody.ts');
  const { nativeMemoryAnswerExclusion } = await import('../worker/memory-native-boundary.ts');
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-stage-body-set-d1-')), egress = [];
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    script: "export default {fetch(){return new Response('Local predicate fixture only.',{status:404});}};", d1Databases: ['Output'], d1Persist: directory,
    log: new Log(LogLevel.NONE), outboundService: req => { egress.push(req.url); throw Error('Worker egress forbidden.'); } });
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); assert.deepEqual(egress, []); });
  const raw = await mf.getD1Database('Output'), observed = observedDatabase(raw, message => t.diagnostic(message)), DB = observed.DB, env = { DB };
  t.after(() => assert.deepEqual(observed.harnessViolations, []));
  t.mock.method(globalThis, 'fetch', req => { egress.push(typeof req === 'string' ? req : req?.url); throw Error('Application fetch forbidden.'); });
  // Adverse rows exercise only incomplete value predicates, never claim or
  // disclosure authority. No affinity permits true storage-type negatives.
  const schema = ['CREATE TABLE private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)',
    'CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT)', 'CREATE TABLE private_content_retention_scopes(content_id TEXT)',
    'CREATE TABLE events(event_id TEXT,type TEXT,payload TEXT,actor TEXT)'];
  for (const sql of schema) await DB.prepare(sql).run();
  const owner = 'synthetic-canonical-owner', contents = [0, 1, 2].map(index => `{"history":"é🦆","component":${index}}`);
  const copies = ['confirmation', 'quote', 'construction'].map((role, index) => ({ session_id: 'synthetic-body-set-session', role,
    content_id: `guest-image-stage-history-${String(index + 1).repeat(64)}`, original_digest: `sha256:${'b'.repeat(64)}`, byte_length: Buffer.byteLength(contents[index]),
    created_at: '2000-01-01T00:00:00.000Z', expires_at: '2999-01-01T00:00:00.000Z' }));
  const rows = copies.map((copy, index) => ({ content_id: copy.content_id, owner_id: owner, kind: 'guest-image-stage-history', content: contents[index],
    created_at: copy.created_at, expires_at: copy.expires_at, redacted_at: null }));
  const insertRow = row => DB.prepare(`INSERT INTO private_content(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  for (const row of rows) await insertRow(row);
  const native = await nativeMemoryAnswerExclusion(env, { answerAlias: 'content' });
  const shapes = new Set(); let comparisons = 0, capturedRefusals = 0;
  async function value(proof) {
    const sql = `SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS current`; shapes.add(sql);
    return (await DB.prepare(sql).bind(...proof.bindings).first()).current;
  }
  function oldProof(selectedCopies, selectedBodies, exclusion) {
    const parts = selectedCopies.map((copy, index) => guestImageStageCopyBodyProof(owner, copy, selectedBodies[index], exclusion));
    return { sql: parts.map(part => `(${part.sql})`).join(' AND '), bindings: parts.flatMap(part => part.bindings) };
  }
  async function compare(expected, selectedCopies = copies, selectedBodies = contents, exclusion = native) {
    const prior = oldProof(selectedCopies, selectedBodies, exclusion), next = guestImageStageCopyBodiesProof(owner, selectedCopies, selectedBodies, exclusion);
    assert.equal(await value(prior), expected); assert.equal(await value(next), expected); comparisons++;
  }
  for (const count of [1, 2, 3]) await compare(1, copies.slice(0, count), contents.slice(0, count));
  for (let index = 0; index < copies.length; index++) {
    const copy = copies[index], row = rows[index];
    for (const [field, changed] of [['content_id', 'different-content'], ['owner_id', 'different-owner'],
      ['content', contents[index].replace('🦆', '🦅')], ['content', contents[index] + ' '],
      ['created_at', '2000-01-01T00:00:01.000Z'], ['expires_at', '2999-01-01T00:00:01.000Z']]) {
      await DB.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).bind(changed, copy.content_id).run(); await compare(0);
      await DB.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).bind(row[field], field === 'content_id' ? changed : copy.content_id).run(); await compare(1);
    }
    for (const field of ['owner_id', 'content', 'created_at', 'expires_at']) for (const changed of [null, 17]) {
      await DB.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).bind(changed, copy.content_id).run(); await compare(0);
      await DB.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).bind(row[field], copy.content_id).run();
    }
    await DB.prepare('UPDATE private_content SET content_id=NULL WHERE content_id=?').bind(copy.content_id).run(); await compare(0);
    await DB.prepare('UPDATE private_content SET content_id=? WHERE content_id IS NULL').bind(copy.content_id).run();
    await DB.prepare('DELETE FROM private_content WHERE content_id=?').bind(copy.content_id).run(); await compare(0); await insertRow(row); await compare(1);
    for (const admitted of [1, 0, null]) {
      const exclusion = { sql: `(${native.sql}) AND (CASE WHEN content.content_id=? THEN ? ELSE 1 END)`, bindings: [...native.bindings, copy.content_id, admitted] };
      await compare(admitted === 1 ? 1 : 0, copies, contents, exclusion);
    }
  }
  function refused(selectedCopies, selectedBodies) {
    assert.throws(() => guestImageStageCopyBodiesProof(owner, selectedCopies, selectedBodies, native), /body_unavailable/u); capturedRefusals++;
  }
  refused([], []); refused([...copies, copies[0]], [...contents, contents[0]]); refused(copies, contents.slice(0, 2));
  const duplicateId = copies.map(copy => ({ ...copy })); duplicateId[1].content_id = duplicateId[0].content_id; refused(duplicateId, contents);
  const duplicateRole = copies.map(copy => ({ ...copy })); duplicateRole[1].role = duplicateRole[0].role; refused(duplicateRole, contents);
  const sparseCopies = [...copies]; delete sparseCopies[1]; refused(sparseCopies, contents);
  const sparseBodies = [...contents]; delete sparseBodies[1]; refused(copies, sparseBodies);
  const accessorBodies = [...contents]; Object.defineProperty(accessorBodies, '1', { get() { throw Error('body accessor must not be evaluated'); }, enumerable: true }); refused(copies, accessorBodies);
  const decoratedBodies = [...contents]; decoratedBodies.extra = 'unexpected'; refused(copies, decoratedBodies);
  for (const index of [0, 1, 2]) {
    const wrongLength = copies.map(copy => ({ ...copy })); wrongLength[index].byte_length++; refused(wrongLength, contents);
    for (const invalid of [null, 17, '\ud800']) { const badBodies = [...contents]; badBodies[index] = invalid; refused(copies, badBodies); }
    for (const field of ['content_id', 'byte_length', 'created_at', 'expires_at']) { const invalid = copies.map(copy => ({ ...copy })); invalid[index][field] = null; refused(invalid, contents); }
  }
  for (const sql of shapes) {
    const compiled = compileSqliteExpressionDepth(null, sql, { schema, functions: [], limit: 100, queryLimits: strictLimits });
    assert.equal(compiled.ok, true, compiled.error); assert.equal(compiled.limit, 100); assert.deepEqual(compiled.queryLimits, strictLimits);
  }
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', scope: 'bounded incomplete body-set predicate; no custody authority',
    positiveCounts: [1, 2, 3], comparisons, capturedRefusals, perRowExclusion: ['true', 'false', 'null'], strictUniqueSql: shapes.size,
    expressionDepth: 100, ...strictLimits, maxBindings: Math.max(...observed.records.map(row => row.parameters)) }));
});
