import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

// Bounded fixture derived from the accepted stages D1 harness, SHA-256
// 6be56ff4eb28c90c7c9a8169ab811238b0382600390c5579083a0a4009af9de5.
// Timing/tombstone checks follow the accepted N1 retirement D1 harness,
// e4c6b86708425eca6293eaaaa158f0bad6eaf64b9841f0258b835bda2092c469.
// Provenance is documentation only: no runtime Git, worktree or donor imports.
registerOutputSourceImports();
const [{ ensureSchema, readWorkspaceEvents }, { GUEST_CUSTODY_SCHEMA, GUEST_DB_NOW, issueGuestClaimSession, readGuestCustodyTerms },
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
const [{inspectGuestImageStageInventory,guestImageStageInventoryData},{retireExpiredUnclaimedGuestImageStages},
  {retireExpiredGuestImageSource}]=await Promise.all([
  import('../worker/experience-guest-image-stage-inventory.ts'),import('../worker/experience-guest-image-stage-retirement.ts'),
  import('../worker/experience-guest-source-retirement.ts')]);
const requireWrangler = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const origin = 'https://guest.example.invalid', payer = 'synthetic-payer', time = '2020-01-01T00:00:00.000Z';
const strictQualificationCache = new Map();
const strictLimits = { functionArguments: 32, parameters: 100, sqlBytes: 100000 };
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
  const handles = new WeakMap(), observed = { records: [], batches: [], batchFailures: [], strictQualifications: [], harnessViolations: [], qualify: null, readOnly: false, beforeBatch: null, afterBatch: null };
  function record(row) {
    try {
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
async function fixture(t, { memory = false, optional = false, maximum = false, operationCap = 100, lifetime = 20000, attemptVersion = 1 } = {}) {
  assert.ok(attemptVersion === 1 || attemptVersion === 2, 'closed native attempt schema version');
  const attemptSchema = attemptVersion === 2 ? SPONSOR_INTAKE_READ_ATTEMPT_V2_SCHEMA : SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA;
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-stage-history-d1-')), egress = [], media = [];
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
  // Schema installation and the one existing synthetic payer row are fixture
  // setup only. No canonical guest user row or unrelated user-session
  // initializer is used; the native guest-session writer runs below.
  await ensureSchema(env);
  for (const sql of [...GUEST_CUSTODY_SCHEMA, ...GUEST_SOURCE_SCHEMA, ...SPONSOR_ENTITLEMENT_SCHEMA, ...SPONSOR_RESOURCE_SCHEMA, ...SPONSOR_APPROVAL_SCHEMA,
    ...(optional ? [...optionalSchema, ...attemptSchema] : SPONSOR_DRIVER_SCHEMA)]) await DB.prepare(sql).run();
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
  assert.deepEqual((await rows(DB, 'users')).map(row => row.user_id), [payer]);
  // Qualification runs after the history/retirement phase: compiling exact SQL
  // must not consume the original short source lifetime before native writes.
  const schema = (await DB.prepare(`SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name`).all()).results.map(row => row.sql);
  observed.records.length = 0; observed.batches.length = 0;
  return { raw, DB, env, observed, session, proof, terms, sourcePolicy, prepared, committed, inventory, native, release, subject, compiled, approvalId,
    originalEvents, sourceContext, input, memory, optional, maximum, attemptVersion, schema,
    review: () => prepareGuestImageConfirmation(request(), env, input),
    confirm: review => confirmGuestImageRequirement(request(), env, { ...input, reviewedRequirementDigest: review.reviewedRequirementDigest, explicitRequirementsConfirmation: true }),
    preflight: () => preflightGuestImage(request(), env, input), quote: () => readGuestImagePreflight(request(), env, input),
    save: () => saveGuestImageRequirement(request(), env, input), read: () => readGuestImageRequirement(request(), env, input) };
}

const isReservation = records => records.some(row => /^INSERT INTO experience_sponsor_driver_stages\(/u.test(row.sql));
const isRetirement = records => records.some(row => /^\s*UPDATE event_private_payloads SET private_json\s*=\s*''/iu.test(row.sql));
const inspect = f => inspectGuestImageStageInventory(request(), f.env, { proof: f.proof });
const retire = f => retireExpiredUnclaimedGuestImageStages(f.env, { sessionId: f.session.sessionId });
const databaseNow = async f => (await f.DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value;
async function due(f) {
  const deadline = performance.now() + 30000;
  while (await databaseNow(f) < Date.parse(f.prepared.expiresAt)) {
    assert.ok(performance.now() < deadline, 'the original real D1 deadline must become due without rewriting expiry');
    await delay(50);
  }
}
function canonicalTime(value) { assert.equal(typeof value, 'string'); assert.equal(new Date(value).toISOString(), value); }
function tailEvents(f, state) {
  const tails = state.contents.events.filter(row => row.stream_id === f.prepared.plan.streamId && row.sequence > f.committed.head).sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(tails.map(row => row.type), f.stageState === 'quoted' ? ['BlockCreated', 'OutputPlanConfirmed', 'OutputPlanPreflighted'] : ['BlockCreated', 'OutputPlanConfirmed']);
  assert.equal(tails.at(-1).sequence, f.stageHead);
  return tails;
}
async function prepareState(f, stageState) {
  const saved = await f.save(), review = await f.review(), confirmed = await f.confirm(review);
  assert.equal(saved.status, 'saved'); assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.revision, f.committed.head + 2);
  let quoted = null, reservationAttempts = 0;
  if (stageState === 'quoted') { quoted = await f.preflight(); assert.equal(quoted.status, 'quoted'); assert.equal(quoted.replayed, false); }
  if (stageState === 'preflight-claimed-unknown') {
    f.observed.afterBatch = records => { if (isReservation(records)) { reservationAttempts++; throw Error('Synthetic history fixture lost reservation ACK after real commit'); } };
    try { await assert.rejects(f.preflight(), /Synthetic history fixture lost reservation ACK/u); }
    finally { f.observed.afterBatch = null; }
    assert.equal(reservationAttempts, 1);
  }
  f.stageState = stageState; f.stageHead = f.committed.head + (stageState === 'quoted' ? 3 : 2);
  const state = await snapshot(f.DB); tailEvents(f, state);
  assert.equal(state.contents.output_commands.length, stageState === 'quoted' ? 3 : 2);
  assert.equal(state.contents.output_plan_revisions.length, 1); assert.equal(state.contents.output_plan_targets.length, 1);
  assert.equal(state.contents.output_preflights.length, stageState === 'quoted' ? 1 : 0);
  assert.equal(state.contents.experience_sponsor_driver_intents.length, 1);
  assert.equal(state.contents.experience_sponsor_driver_stages.length, stageState === 'confirmed' ? 0 : 1);
  assert.equal(state.contents.experience_sponsor_resource_receipts.length, stageState === 'confirmed' ? 2 : 3);
  for (const table of ['output_execution_grants', 'output_operation_slots', 'output_provider_calls', 'output_assets', 'output_results']) assert.deepEqual(state.contents[table], []);
  assert.deepEqual(state.contents.users.map(row => row.user_id), [payer]);
  // A positive control proves this sentinel observes the real native quote path.
  // History and cleanup must not re-enter current provider configuration.
  let constructionEntries = 0;
  Object.defineProperty(f.env, 'OPENAI_API_KEY', { configurable: true, get() { constructionEntries++; throw Error('History re-entered native quote configuration'); } });
  await assert.rejects(templateFor(f.env, f.release, f.sourceContext, f.prepared.plan), /History re-entered native quote configuration/u);
  assert.equal(constructionEntries, 1); constructionEntries = 0;
  f.assertNoConstruction = () => assert.equal(constructionEntries, 0, 'history/retirement must never reconstruct a native quote');
  return { saved, review, confirmed, quoted };
}
async function inspectExactly(f) {
  const before = await snapshot(f.DB); f.observed.readOnly = true;
  let inventory;
  try { inventory = await inspect(f); }
  finally { f.observed.readOnly = false; }
  assert.equal(inventory.version, 1); assert.equal(inventory.sessionId, f.session.sessionId); assert.equal(inventory.documentId, f.prepared.plan.documentId);
  assert.equal(inventory.sourceHead, f.committed.head); assert.equal(inventory.sourceSaveHead, f.committed.head + 1);
  assert.equal(inventory.stageHead, f.stageHead); assert.equal(inventory.stageState, f.stageState); assert.equal(inventory.expiresAt, f.prepared.expiresAt);
  assert.match(inventory.manifestDigest, /^sha256:[a-f0-9]{64}$/u);
  const captured = guestImageStageInventoryData(f.env, inventory);
  assert.ok(captured.manifest && captured.proof); assert.equal(await digest(captured.manifest), inventory.manifestDigest);
  for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken]) assert.equal(JSON.stringify(inventory).includes(secret), false, 'summary discloses no creative source or bearers');
  assert.deepEqual(await snapshot(f.DB), before, 'inventory changes no schema, custody, history or accounting'); f.assertNoConstruction();
  return inventory;
}
async function assertOnlyTailsChanged(f, before, start, finish) {
  const after = await snapshot(f.DB), ids = new Set(tailEvents(f, before).map(row => row.event_id)), expected = structuredClone(before);
  expected.contents.event_private_payloads = expected.contents.event_private_payloads.map(row => {
    if (!ids.has(row.private_event_id)) return row;
    const erased = after.contents.event_private_payloads.find(value => value.private_event_id === row.private_event_id);
    assert.ok(erased); assert.equal(erased.private_json, ''); canonicalTime(erased.redacted_at);
    if (row.redacted_at !== null) assert.equal(erased.redacted_at, row.redacted_at, 'existing tombstone timestamp is immutable');
    else assert.ok(Date.parse(erased.redacted_at) >= Math.max(start, Date.parse(f.prepared.expiresAt)) && Date.parse(erased.redacted_at) <= finish);
    return { ...row, private_json: '', redacted_at: erased.redacted_at };
  });
  assert.deepEqual(after, expected, 'only the exact original output private bytes/tombstones change; all source, native sidecars, payer, resource, financial and schema history survives');
  assert.deepEqual((await f.DB.prepare('PRAGMA foreign_key_check').all()).results, []);
  return after;
}
function assertReceipt(f, result, before, after, replayed) {
  assert.deepEqual(Object.keys(result).sort(), ['status', 'scope', 'sessionId', 'documentId', 'stageState', 'stageHead', 'tails', 'replayed'].sort());
  assert.equal(result.status, 'retired'); assert.equal(result.scope, 'unclaimed-original-image-stage-private-bodies');
  assert.equal(result.sessionId, f.session.sessionId); assert.equal(result.documentId, f.prepared.plan.documentId);
  assert.equal(result.stageState, f.stageState); assert.equal(result.stageHead, f.stageHead); assert.equal(result.replayed, replayed);
  assert.ok(Object.isFrozen(result)); assert.deepEqual(result.tails.map(row => row.eventId), tailEvents(f, before).map(row => row.event_id));
  for (const tail of result.tails) {
    assert.deepEqual(Object.keys(tail).sort(), ['eventId', 'redactedAt', 'replayed']); assert.equal(typeof tail.replayed, 'boolean');
    assert.equal(tail.redactedAt, after.contents.event_private_payloads.find(row => row.private_event_id === tail.eventId).redacted_at);
  }
  for (const secret of [f.subject, f.proof.sessionToken, f.proof.claimToken, payer]) assert.equal(JSON.stringify(result).includes(secret), false);
}
async function retireSourceExactly(f) {
  const before = await snapshot(f.DB), expected = structuredClone(before), ids = new Set(f.committed.eventIds);
  const result = await retireExpiredGuestImageSource(f.env, { sessionId: f.session.sessionId });
  assert.equal(result.status, 'retired'); assert.equal(result.eventCount, ids.size);
  const after = await snapshot(f.DB);
  expected.contents.private_content = expected.contents.private_content.map(row => {
    if (row.content_id !== f.prepared.plan.draftId) return row;
    const erased = after.contents.private_content.find(value => value.content_id === row.content_id); assert.equal(erased.content, ''); canonicalTime(erased.redacted_at);
    return { ...row, content: '', redacted_at: erased.redacted_at };
  });
  expected.contents.event_private_payloads = expected.contents.event_private_payloads.map(row => {
    if (!ids.has(row.private_event_id)) return row;
    const erased = after.contents.event_private_payloads.find(value => value.private_event_id === row.private_event_id); assert.equal(erased.private_json, ''); canonicalTime(erased.redacted_at);
    return { ...row, private_json: '', redacted_at: erased.redacted_at };
  });
  assert.deepEqual(after, expected, 'unchanged source helper retires only original draft/prefix and preserves every stage tail');
}
function qualify(t, f) {
  const verificationScan = sql => /^SELECT \* FROM "[A-Za-z_][A-Za-z0-9_]*"(?: ORDER BY rowid)?$/u.test(sql) || sql === 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name';
  const records = f.observed.records.filter(row => /^(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b/iu.test(row.sql.trim()) && !verificationScan(row.sql));
  assert.ok(records.length > 0); const unique = new Map(records.map(row => [row.sql, row]));
  for (const row of unique.values()) {
    const key = createHash('sha256').update(JSON.stringify([f.schema, row.sql, strictLimits])).digest('hex');
    let compiled = strictQualificationCache.get(key);
    if (!compiled) { compiled = compileSqliteExpressionDepth(null, row.sql, { schema: f.schema, functions: [], limit: 100, queryLimits: strictLimits }); strictQualificationCache.set(key, compiled); }
    assert.equal(compiled.ok, true, `${compiled.error ?? ''}\n${row.sql.slice(0, 220)}`);
    assert.equal(compiled.limit, 100); assert.deepEqual(compiled.queryLimits, strictLimits); assert.equal(compiled.parameterCount, row.parameters);
  }
  assert.deepEqual(f.observed.harnessViolations, []); f.assertNoConstruction();
  t.diagnostic(JSON.stringify({ engine: 'Wrangler-pinned Miniflare/workerd D1', applicationExecution: 'Node-hosted native source functions', localOnly: true,
    stageState: f.stageState, sourceHead: f.committed.head, stageHead: f.stageHead, memory: f.memory, optionalSponsorFamilies: f.optional,
    intakeReadAttemptSchemaVersion: f.attemptVersion, subjectCharacters: f.subject.length, subjectUtf8Bytes: Buffer.byteLength(f.subject),
    observedHistoryStatements: records.length, strictDeploymentUniqueSql: unique.size, expressionDepth: 100, ...strictLimits,
    maxBindings: Math.max(...records.map(row => row.parameters)), maxSqlBytes: Math.max(...records.map(row => row.sqlBytes)) }));
}

for (const scenario of [
  { state: 'confirmed', sourceFirst: true, memory: false, optional: false, maximum: false, attemptVersion: 1 },
  { state: 'preflight-claimed-unknown', sourceFirst: false, memory: false, optional: true, maximum: false, attemptVersion: 1 },
  { state: 'quoted', sourceFirst: true, memory: true, optional: true, maximum: true, attemptVersion: 2 },
]) test(`actual local D1 inventories and retires unclaimed ${scenario.state} with ${scenario.sourceFirst ? 'source-first' : 'tail-first'} cleanup`, { timeout: 180000 }, async t => {
  const f = await fixture(t, scenario); await prepareState(f, scenario.state); f.observed.records.length = 0;
  await inspectExactly(f);
  const early = await snapshot(f.DB); f.observed.readOnly = true;
  try { await assert.rejects(retire(f), /not_due/u); } finally { f.observed.readOnly = false; }
  assert.deepEqual(await snapshot(f.DB), early, 'original source deadline cannot be shortened or renewed');
  await due(f);
  if (scenario.sourceFirst) await retireSourceExactly(f);
  const before = await snapshot(f.DB), start = await databaseNow(f), result = await retire(f), finish = await databaseNow(f);
  const after = await assertOnlyTailsChanged(f, before, start, finish); assertReceipt(f, result, before, after, false);
  assert.ok(result.tails.every(tail => tail.replayed === false));
  if (!scenario.sourceFirst) await retireSourceExactly(f);
  const complete = await snapshot(f.DB); f.observed.readOnly = true;
  const replay = await retire(f); assertReceipt(f, replay, complete, complete, true); assert.ok(replay.tails.every(tail => tail.replayed === true));
  await assert.rejects(inspect(f)); assert.deepEqual(await snapshot(f.DB), complete, 'retirement replay preserves every original tombstone and cannot re-enable live inventory');
  qualify(t, f);
});

test('actual local D1 late tail drift rolls back all erasure and a lost ACK returns original tombstones once', { timeout: 180000 }, async t => {
  const f = await fixture(t); await prepareState(f, 'quoted'); await due(f); f.observed.records.length = 0;
  const before = await snapshot(f.DB), eventId = tailEvents(f, before).at(-1).event_id; let injected = 0, layout = null;
  f.observed.beforeBatch = (items, records) => {
    if (!isRetirement(records)) return;
    injected++; const guards = records.flatMap((row, index) => /^\s*INSERT INTO output_atomic_assertions\b/u.test(row.sql) ? [index] : []);
    const erasures = records.flatMap((row, index) => isRetirement([row]) ? [index] : []); layout = { guards, erasures };
    const changed = [...items]; changed.splice(erasures.at(-1) + 1, 0, f.DB.prepare("UPDATE event_private_payloads SET owner_id='synthetic-foreign-owner' WHERE private_event_id=?").bind(eventId)); return changed;
  };
  await assert.rejects(retire(f)); f.observed.beforeBatch = null; assert.equal(injected, 1);
  assert.ok(layout && layout.guards.length >= 2 && layout.erasures.length > 0);
  assert.ok(layout.erasures.every(index => index > layout.guards[0] && index < layout.guards.at(-1)), 'every native erasure is after the before proof and before the final after proof');
  assert.ok(f.observed.batchFailures.some(error => /CHECK constraint failed/iu.test(error)), 'actual final proof fails; unrelated SQL errors do not qualify');
  assert.deepEqual(await snapshot(f.DB), before, 'late proof failure rolls back all tail erasure, timestamps and injected ownership drift');
  let attempts = 0, lost = 0;
  f.observed.beforeBatch = (_items, records) => { if (isRetirement(records)) attempts++; };
  f.observed.afterBatch = records => { if (isRetirement(records)) { lost++; throw Error('Synthetic lost stage retirement ACK after real commit'); } };
  const start = await databaseNow(f), result = await retire(f), finish = await databaseNow(f);
  f.observed.beforeBatch = null; f.observed.afterBatch = null; assert.equal(attempts, 1); assert.equal(lost, 1);
  const after = await assertOnlyTailsChanged(f, before, start, finish); assertReceipt(f, result, before, after, true);
  f.observed.readOnly = true; const replay = await retire(f); assertReceipt(f, replay, after, after, true);
  assert.ok(replay.tails.every(tail => tail.replayed === true)); assert.deepEqual(await snapshot(f.DB), after);
  qualify(t, f);
});
