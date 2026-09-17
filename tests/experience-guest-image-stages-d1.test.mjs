import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';
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
  { compileGuestSponsorApprovalProposal },
  { preflightOutputImageSlidesTarget }, { sponsorImageTransport }, { registeredExperience, initialValues, experienceResourceId },
  { canonicalJson, digest }, { POLICY_VERSION }, { authoritativeCreativeContext },
  { SPONSOR_ISSUER_SCHEMA }, { SPONSOR_DRIVER_SCHEMA }, { SPONSOR_INTAKE_SCHEMA },
  { SPONSOR_READ_POLICY_SCHEMA }, { SPONSOR_READ_APPROVAL_SCHEMA }, { SPONSOR_READ_ATTEMPT_SCHEMA },
  { SPONSOR_INTAKE_READ_POLICY_SCHEMA }, { SPONSOR_INTAKE_READ_APPROVAL_SCHEMA }, { SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA }] = await Promise.all([
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
  ...SPONSOR_INTAKE_READ_POLICY_SCHEMA, ...SPONSOR_INTAKE_READ_APPROVAL_SCHEMA, ...SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA];

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
    // helpers. Every application statement is still qualified before D1.
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
async function fixture(t, { memory = false, optional = false, maximum = false, operationCap = 100, lifetime = 120000 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-guest-stages-d1-')), egress = [], media = [];
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
  // setup only. No canonical guest row or lifecycle/session helper is used.
  await ensureSchema(env);
  for (const sql of [...GUEST_CUSTODY_SCHEMA, ...GUEST_SOURCE_SCHEMA, ...SPONSOR_ENTITLEMENT_SCHEMA, ...SPONSOR_RESOURCE_SCHEMA, ...SPONSOR_APPROVAL_SCHEMA,
    ...(optional ? optionalSchema : SPONSOR_DRIVER_SCHEMA)]) await DB.prepare(sql).run();
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
  if (maximum || optional) {
    // Local workerd's SQLite build can be more permissive than deployed D1.
    // Compile the exact actual SQL against the approved deployment ceilings,
    // then forward the same statement to real workerd D1. No row data is sent
    // to the compiler, and the compiler never manufactures D1 results.
    const schema = (await DB.prepare(`SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END`).all()).results.map(row => row.sql);
    observed.qualify = row => {
      const key = createHash('sha256').update(JSON.stringify([schema, row.sql])).digest('hex');
      let result = strictQualificationCache.get(key);
      if (!result) {
        result = compileSqliteExpressionDepth(null, row.sql, { schema, functions: [], queryLimits: strictLimits });
        strictQualificationCache.set(key, result);
      }
      assert.equal(result.ok, true, `strict deployment SQL qualification: ${result.error ?? ''}\n${row.sql.slice(0,220)}`);
      assert.equal(result.parameterCount, row.bindings.length, 'compiler measures actual bound-parameter count');
      observed.strictQualifications.push({ key, parameters: result.parameterCount, sqlBytes: result.statementBytes });
    };
  }
  observed.records.length = 0; observed.batches.length = 0;
  return { raw, DB, env, observed, session, proof, terms, sourcePolicy, prepared, committed, inventory, native, release, subject, compiled, approvalId,
    originalEvents, sourceContext, input, memory, optional, maximum,
    review: () => prepareGuestImageConfirmation(request(), env, input),
    confirm: review => confirmGuestImageRequirement(request(), env, { ...input, reviewedRequirementDigest: review.reviewedRequirementDigest, explicitRequirementsConfirmation: true }),
    preflight: () => preflightGuestImage(request(), env, input), quote: () => readGuestImagePreflight(request(), env, input),
    save: () => saveGuestImageRequirement(request(), env, input), read: () => readGuestImageRequirement(request(), env, input) };
}

const stageTables=new Set(['events','event_private_payloads','output_commands','output_plan_revisions','output_plan_targets','output_preflights',
  'experience_sponsor_resource_receipts','experience_sponsor_driver_intents','experience_sponsor_driver_stages']);
function unchangedExcept(before,after,allowed=stageTables){
  assert.deepEqual(after.schema,before.schema,'dormant stages never install or change schema');
  for(const [table,value]of Object.entries(before.contents))if(!allowed.has(table))assert.deepEqual(after.contents[table],value,`unchanged ${table}`);
}
const isConfirmation=records=>records.some(row=>/^INSERT INTO output_plan_revisions\(/u.test(row.sql));
const isReservation=records=>records.some(row=>/^INSERT INTO experience_sponsor_driver_stages\(/u.test(row.sql));
const isQuote=records=>records.some(row=>/^INSERT INTO output_preflights\(/u.test(row.sql));
function injectBeforeFinalGuard(f,items,records,sql){
  const indexes=records.flatMap((row,index)=>/^\s*INSERT INTO output_atomic_assertions\b/u.test(row.sql)?[index]:[]);
  assert.ok(indexes.length>=2);const result=[...items];result.splice(indexes.at(-1),0,f.DB.prepare(sql));return result;
}
function metrics(t,f){
  t.diagnostic(JSON.stringify({engine:'Wrangler-pinned Miniflare/workerd D1',applicationExecution:'Node-hosted native source functions',localOnly:true,
    memory:f.memory,optionalSponsorFamilies:f.optional,originalPrefix:f.prepared.plan.events.length,policyMaximumEvents:f.sourcePolicy.maximumEvents,
    subjectCharacters:f.subject.length,subjectUtf8Bytes:Buffer.byteLength(f.subject),sourceSnapshotUtf8Bytes:Buffer.byteLength(canonicalJson(f.sourceContext.snapshot)),
    explicitApprovedMaximumMicrousd:f.compiled.policy.templates[0].maximumMicrousd,
    strictDeploymentQualifiedStatements:f.observed.strictQualifications.length,strictDeploymentUniqueSql:new Set(f.observed.strictQualifications.map(row=>row.key)).size,
    executedStatements:f.observed.records.length,maxBindings:Math.max(...f.observed.records.map(row=>row.parameters)),
    maxSqlBytes:Math.max(...f.observed.records.map(row=>row.sqlBytes)),maxBoundTextBytes:Math.max(...f.observed.records.map(row=>row.maxBoundTextBytes)),
    maxStatementBoundTextBytes:Math.max(...f.observed.records.map(row=>row.totalBoundTextBytes)),applicationBatches:f.observed.batches.length}));
}
async function confirmed(f){
  const saved=await f.save(),review=await f.review(),confirmation=await f.confirm(review);
  assert.equal(saved.status,'saved');assert.equal(confirmation.status,'confirmed');assert.equal(confirmation.revision,f.committed.head+2);
  return {saved,review,confirmation};
}
async function footprint(f,before,result){
  const after=await snapshot(f.DB);unchangedExcept(before,after);
  assert.deepEqual(after.contents.events.slice(0,f.committed.head),before.contents.events);
  assert.deepEqual(after.contents.event_private_payloads.slice(0,f.committed.head),before.contents.event_private_payloads);
  assert.equal(after.contents.events.length,f.committed.head+3);
  assert.deepEqual(after.contents.events.slice(-3).map(row=>row.type),['BlockCreated','OutputPlanConfirmed','OutputPlanPreflighted']);
  assert.ok(after.contents.events.slice(-3).every(row=>row.actor===f.session.guestSubject&&row.client_id==='server:guest-output'));
  assert.ok(after.contents.event_private_payloads.slice(-3).every(row=>row.owner_id===f.session.guestSubject&&row.redacted_at===null));
  assert.deepEqual(after.contents.output_commands.map(row=>row.action),['save','confirm','preflight']);
  assert.equal(after.contents.output_plan_revisions.length,1);assert.equal(after.contents.output_plan_targets.length,1);assert.equal(after.contents.output_preflights.length,1);
  assert.equal(after.contents.output_plan_revisions[0].source_head,f.committed.head+1);assert.equal(after.contents.output_plan_targets[0].ordinal,0);
  assert.equal(after.contents.output_preflights[0].preflight_id,result.preflight.id);assert.equal(after.contents.output_preflights[0].terms_digest,result.preflight.termsDigest);
  assert.equal(after.contents.experience_sponsor_driver_intents.length,1);assert.equal(after.contents.experience_sponsor_driver_stages.length,1);
  assert.equal(after.contents.experience_sponsor_driver_stages[0].stage,'preflight');
  const receipts=after.contents.experience_sponsor_resource_receipts,bytes=Buffer.byteLength(canonicalJson(f.sourceContext.snapshot));
  assert.equal(receipts.length,3);assert.deepEqual(receipts.map(row=>row.operation),['text-intake','text-intake','preflight']);
  assert.ok(receipts.every(row=>row.actor_user_id===f.session.guestSubject&&row.text_bytes===bytes&&row.issued_grant_id===null));
  assert.equal(new Set(receipts.map(row=>row.resource_id)).size,3);
  const intent=after.contents.experience_sponsor_driver_intents[0];assert.equal(receipts[1].resource_id,`${intent.driver_id}:text`);assert.equal(receipts[2].resource_id,`${intent.driver_id}:preflight`);
  assert.equal(receipts[1].intent_key,intent.intent_key);assert.equal(receipts[2].intent_key,intent.intent_key);assert.equal(receipts[1].payload_digest,receipts[2].payload_digest);
  assert.equal(result.revision,f.committed.head+3);assert.equal(result.status,'quoted');assert.equal(result.preflight.operationAttempts[after.contents.output_plan_targets[0].target_id].ordinal,0);
  const retained=JSON.parse(after.contents.event_private_payloads.at(-1).private_json);assert.deepEqual(retained.preflight,result.preflight);
  const {termsDigest,...quote}=result.preflight;assert.equal(termsDigest,(await digest(quote)).slice(7));
  assert.ok(Date.parse(result.preflight.expiresAt)<=Date.parse(f.prepared.expiresAt));
  for(const table of ['output_execution_grants','output_operation_slots','output_provider_calls','output_assets','output_results'])assert.deepEqual(after.contents[table],[]);
  assert.deepEqual(after.contents.users.map(row=>row.user_id),[payer]);
  for(const secret of [f.proof.sessionToken,f.proof.claimToken])assert.equal(JSON.stringify(after).includes(secret),false,'bearers are never durable history');
  return after;
}

for(const memory of [false,true])test(`actual local workerd D1 completes and exactly reopens maximum reachable guest Image stages with ${memory?'complete':'absent'} Memory`,{timeout:120000},async t=>{
  const f=await fixture(t,{memory,maximum:true}),before=await snapshot(f.DB);
  assert.equal(f.subject.length,f.release.interactions.subject.maxLength);assert.equal(f.prepared.plan.events.length,8,'maximum reachable current Image prefix, not policy capacity 16');
  const {review,confirmation}=await confirmed(f);assert.equal(await f.quote(),null);
  const quote=await f.preflight();assert.equal(quote.replayed,false);assert.equal(quote.planRevisionId,confirmation.planRevisionId);
  const after=await footprint(f,before,quote);f.observed.readOnly=true;
  assert.deepEqual(await f.quote(),{...quote,replayed:true});assert.deepEqual(await f.preflight(),{...quote,replayed:true});
  assert.deepEqual(await f.confirm(review),{...confirmation,replayed:true});
  await assert.rejects(f.read(),'the original first-SAVE reader remains restricted to N+1');await assert.rejects(f.save());
  assert.deepEqual(await snapshot(f.DB),after,'exact replay changes no creative, financial or accounting rows');
  assert.equal(f.observed.batches.filter(sqls=>sqls.some(sql=>/^INSERT INTO experience_sponsor_driver_stages\(/u.test(sql))).length,1);
  assert.equal(f.observed.batches.filter(sqls=>sqls.some(sql=>/^INSERT INTO output_preflights\(/u.test(sql))).length,1);
  metrics(t,f);
});

test('local workerd behavior and strict deployed D1 ceilings are qualified separately',{timeout:120000},async t=>{
  const f=await fixture(t);
  const probes=[
    {name:'function arguments 34',sql:`SELECT json_object(${Array.from({length:17},(_,i)=>`'k${i}',${i}`).join(',')})`,bindings:[]},
    {name:'expression depth above 100',sql:`SELECT ${'1 AND ('.repeat(101)}1${')'.repeat(101)}`,bindings:[]},
    {name:'parameters 101',sql:`SELECT ${Array.from({length:101},()=>'?').join(',')}`,bindings:Array(101).fill(1)},
    {name:'raw SQL bytes above 100000',sql:`SELECT 1 /*${'x'.repeat(100000)}*/`,bindings:[]},
  ];
  const observed=[];
  for(const probe of probes){
    const strict=compileSqliteExpressionDepth(null,probe.sql,{schema:[],functions:[],bindings:probe.bindings,queryLimits:strictLimits});
    assert.equal(strict.ok,false,`strict helper rejects ${probe.name}`);
    let local='accepted';try{await f.raw.prepare(probe.sql).bind(...probe.bindings).first();}catch(error){local=String(error);}
    observed.push({probe:probe.name,strictRejection:strict.error,actualLocalWorkerd:local});
  }
  t.diagnostic(JSON.stringify({strictDeploymentLimits:{...strictLimits,expressionDepth:100},localEngineObservations:observed}));
});

test('actual local workerd D1 refuses partial Memory before review or either new stage',{timeout:120000},async t=>{
  const f=await fixture(t);await f.save();const review=await f.review();
  await f.DB.prepare('CREATE TABLE memory_native_answer_origins(id TEXT PRIMARY KEY)').run();const before=await snapshot(f.DB);
  await assert.rejects(f.review());await assert.rejects(f.confirm(review));await assert.rejects(f.preflight());assert.deepEqual(await snapshot(f.DB),before);metrics(t,f);
});

test('lost actual D1 reservation ACK retains one charged N+2 claim and never reconstructs quote permission',{timeout:120000},async t=>{
  const f=await fixture(t);await confirmed(f);const before=await snapshot(f.DB);let attempts=0,constructionEntries=0;
  Object.defineProperty(f.env,'OPENAI_API_KEY',{configurable:true,get(){constructionEntries++;throw Error('quote construction entered without the original dense reservation ACK');}});
  await assert.rejects(templateFor(f.env,f.release,f.sourceContext,f.prepared.plan),/quote construction entered/);
  assert.equal(constructionEntries,1,'positive control enters the same native quote configuration boundary');constructionEntries=0;
  f.observed.afterBatch=records=>{if(isReservation(records)){attempts++;throw Error('Synthetic lost reservation ACK after real commit');}};
  await assert.rejects(f.preflight(),/Synthetic lost reservation ACK/);f.observed.afterBatch=null;assert.equal(attempts,1);
  const after=await snapshot(f.DB);unchangedExcept(before,after,new Set(['experience_sponsor_resource_receipts','experience_sponsor_driver_stages']));
  assert.equal(after.contents.experience_sponsor_resource_receipts.length,3);assert.equal(after.contents.experience_sponsor_driver_stages.length,1);
  assert.equal(after.contents.events.length,f.committed.head+2);assert.equal(after.contents.output_preflights.length,0);assert.equal(after.contents.output_commands.length,2);
  f.observed.readOnly=true;await assert.rejects(f.preflight());await assert.rejects(f.quote());assert.equal(constructionEntries,0,'lost ACK and retries never enter native quote configuration/construction');assert.deepEqual(await snapshot(f.DB),after);
  metrics(t,f);
});

test('lost actual D1 quote ACK returns only the retained original without another claim or quote',{timeout:120000},async t=>{
  const f=await fixture(t,{optional:true});const before=await snapshot(f.DB);await confirmed(f);let attempts=0;
  f.observed.afterBatch=records=>{if(isQuote(records)){attempts++;throw Error('Synthetic lost quote ACK after real commit');}};
  const result=await f.preflight();f.observed.afterBatch=null;assert.equal(result.replayed,true);assert.equal(attempts,1);
  const after=await footprint(f,before,result);f.observed.readOnly=true;assert.deepEqual(await f.preflight(),result);assert.deepEqual(await f.quote(),result);
  assert.deepEqual(await snapshot(f.DB),after);metrics(t,f);
});

for(const stage of ['confirmation','reservation','quote'])test(`actual D1 late source revocation rolls back ${stage} and retains exactly the preceding state`,{timeout:120000},async t=>{
  const f=await fixture(t);await f.save();const review=await f.review();if(stage!=='confirmation')await f.confirm(review);
  const before=await snapshot(f.DB),predicate=stage==='confirmation'?isConfirmation:stage==='reservation'?isReservation:isQuote;let attempts=0;
  f.observed.beforeBatch=(items,records)=>{if(predicate(records)){attempts++;return injectBeforeFinalGuard(f,items,records,`UPDATE experience_guest_source_policies SET revoked_at_ms=${GUEST_DB_NOW}`);}};
  await assert.rejects(stage==='confirmation'?f.confirm(review):f.preflight());f.observed.beforeBatch=null;assert.equal(attempts,1);
  assert.ok(f.observed.batchFailures.some(error=>/CHECK constraint failed/iu.test(error)),'the real authority after-proof CHECK must fail; unrelated UNIQUE/FK errors do not qualify');
  const after=await snapshot(f.DB);
  if(stage==='quote'){
    unchangedExcept(before,after,new Set(['experience_sponsor_resource_receipts','experience_sponsor_driver_stages']));
    assert.equal(after.contents.experience_sponsor_resource_receipts.length,3);assert.equal(after.contents.experience_sponsor_driver_stages.length,1);
    assert.equal(after.contents.output_preflights.length,0);await assert.rejects(f.preflight());assert.deepEqual(await snapshot(f.DB),after,'quote failure preserves the charged unknown claim');
  }else assert.deepEqual(after,before,'native event/sidecars/debit and fixture revocation roll back together');
  metrics(t,f);
});
