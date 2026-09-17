import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { outputTestDatabase, registerOutputSourceImports } from '../tests/output-server-test-helpers.mjs';
import { readLocalMigrations } from './lib/local-migrations.mjs';

// Focused source/SQLite qualification. The native producer and its private
// WeakMap are real; only denied I/O and late-fault observation are intercepted.
const imports = registerOutputSourceImports();
const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let network = 0, media = 0, assets = 0;
globalThis.fetch = () => { network++; throw Error('sponsored_scene_handoff_network_forbidden'); };
after(() => {
  Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
  imports.deregister();
  assert.deepEqual({ network, media, assets }, { network: 0, media: 0, assets: 0 });
});
const [runtime, policy, intakeApi, outputApi, intake, nativeBridge, requirements, preflight, disclosure, handoff] = await Promise.all([
  import('../worker/runtime.ts'), import('../worker/policy-version.ts'), import('../worker/experience-intake-api.ts'),
  import('../worker/experience-output-api.ts'), import('../src/experiences/intake.ts'), import('../worker/output-document-execution.ts'),
  import('../worker/output-requirements-api.ts'), import('../worker/output-scene-preflight.ts'),
  import('../worker/output-disclosure-proof.ts'), import('../worker/output-scene-sponsored-handoff.ts'),
]);
const [ledger, witness, eventPrimitives] = await Promise.all([
  import('../worker/output-requirements-ledger.ts'), import('../worker/scene-job-source-witness.ts'), import('../worker/event-write-primitives.ts'),
]);
const actor = 'dev-local-creative', stream = `creative:${actor}`;
const post = (path, body, signal) => new Request(`http://localhost${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}),
});
const financialRows = f => Object.fromEntries(['document_jobs', 'output_execution_grants', 'output_operation_slots',
  'budget_reservations', 'cost_budget_reservations', 'output_provider_calls'].map(table =>
  [table, f.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));

async function fixture(t, { controller = new AbortController() } = {}) {
  const f = outputTestDatabase();
  t.after(() => f.sqlite.close());
  for (const method of ['get', 'head', 'put', 'delete', 'list']) f.env.MEDIA[method] = () => { media++; throw Error('media_forbidden'); };
  f.env.ASSETS.fetch = () => { assets++; throw Error('assets_forbidden'); };
  await runtime.ensureSchema(f.env);
  for (const migration of readLocalMigrations(new URL('../drizzle/', import.meta.url)).filter(value => value.tag === '0038_scene_source_generations'))
    for (const sql of migration.sql.split('--> statement-breakpoint')) if (sql.trim()) f.sqlite.exec(sql);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)")
    .run(actor, 'qualification@invalid', 'Synthetic handoff qualification', policy.POLICY_VERSION, now, now, now);
  Object.assign(f.env, { OPENAI_API_KEY: 'synthetic-presence-no-egress', OPENAI_MODEL: 'gpt-5.6-terra' });
  const release = await intake.registeredExperience('scene');
  const intent = { intentId: '00000000-0000-4000-8000-000000000093', experienceId: 'scene', releaseHash: release.releaseHash,
    values: { ...intake.initialValues(release), ...Object.fromEntries(Object.entries({ characterA: 'Mara', goalA: 'Repair a bicycle',
      characterB: 'Eli', goalB: 'Keep a gift secret', location: 'A bicycle workshop', secret: 'The new wheel is a gift' })
      .map(([key, value]) => [key, { value, provenance: 'authored' }])) } };
  let response = await intakeApi.handleExperienceIntake(post('/api/experiences/drafts', intent), f.env);
  assert.equal(response.status, 200, await response.clone().text());
  const { plan } = await response.json();
  response = await intakeApi.handleExperienceIntake(post(`/api/experiences/drafts/${plan.draftId}/commit`, { draftHash: plan.draftHash }), f.env);
  assert.equal(response.status, 200, await response.clone().text());
  const execution = { waitUntil() { throw Error('background_execution_forbidden'); } };
  response = await outputApi.handleExperienceOutput(post(`/api/experiences/drafts/${plan.draftId}/output/prepare`, {
    draftHash: plan.draftHash, explicitRequirementsConfirmation: true,
  }), f.env, execution, nativeBridge.outputDocumentExecutionBridge);
  assert.equal(response.status, 200, await response.clone().text());
  const ready = await response.json(), documentId = f.sqlite.prepare('SELECT document_id FROM output_plan_revisions').get().document_id;
  const command = { documentId, action: 'authorize', expectedRevision: `output:${f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(stream).n}`,
    clientMutationId: 'scene-native-handoff', preflightId: ready.preflight.id, termsDigest: ready.preflight.termsDigest,
    maximumMicrousd: ready.preflight.maximumMicrousd, explicitAuthorization: true, sceneCostConsent: { ...ready.sceneCostPreview, confirmed: true } };
  const request = post('/api/output-requirements', command, controller.signal);
  const trusted = await requirements.loadOutputTrustedContext(request, f.env, documentId, 'request');
  assert.ok(!(trusted instanceof Response));
  command.expectedRevision = `output:${trusted.ownerHead}`;
  const confirmedPlan = await requirements.outputExperienceCommands.readConfirmedPlan(trusted, ready.preflight.planRevisionId);
  const source = { request, env: f.env, scope: trusted.scope, principal: trusted.principal, confirmedPlan,
    target: confirmedPlan.plan.targets[0], context: trusted.context, ownerHead: trusted.ownerHead, sourceEvents: trusted.events,
    sourceAssertions: [...trusted.sourceAssertions, ...disclosure.outputActiveSourceDeadlineAssertions(trusted.context)],
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest };
  const counters = { batches: 0, reductions: 0 };
  const originalBatch = f.DB.batch.bind(f.DB);
  f.DB.batch = async statements => {
    counters.batches++;
    if (statements[0]?.sql.includes('WITH source AS NOT MATERIALIZED') && statements[0].sql.includes('COUNT(*) AS count')) counters.reductions++;
    await f.beforeBatch?.(statements);
    const result = await originalBatch(statements);
    return f.afterBatch ? await f.afterBatch(result, statements) : result;
  };
  return Object.assign(f, { ready, plan, documentId, command, request, trusted, source, controller, counters, execution });
}
const prepare = f => handoff.prepareSceneSponsorAdmission({ source: f.source, command: f.command, quote: f.ready.preflight });
const evidence = (f, handle, trusted = f.trusted, command = f.command) => handoff.requireSceneSponsorAdmissionForEvidence(handle, trusted, command);
const target = (f, handle, source = f.source, quote = f.ready.preflight, consent = f.command.sceneCostConsent) =>
  handoff.requireSceneSponsorAdmissionForTarget(handle, source, quote, consent);

test('one genuine preparation supplies the same original object to both admission consumers', async t => {
  const f = await fixture(t), before = financialRows(f), handle = await prepare(f);
  const original = await evidence(f, handle), second = await target(f, handle);
  assert.strictEqual(second, original);
  assert.ok(preflight.outputScenePreflightProof(original)?.prepared.sourceVersion);
  assert.equal(f.counters.reductions, 1, 'accessors revalidate the original proof without another history reduction');
  const clonedData = { ...structuredClone(Object.fromEntries(Object.entries(f.trusted).filter(([key]) => !['request', 'env', 'governanceWitness'].includes(key)))),
    request: f.request, env: f.env, governanceWitness: f.trusted.governanceWitness };
  assert.strictEqual(await evidence(f, handle, clonedData), original, 'trusted-data copies preserve original Request/env authority');
  assert.deepEqual(financialRows(f), before);
  assert.equal(JSON.stringify(handle).includes('instanceNonce'), false);
  assert.equal(JSON.stringify(handle).includes('private_json'), false);
});

test('copied handles and copied native preflights cannot supply producer authority', async t => {
  const f = await fixture(t), handle = await prepare(f), native = await evidence(f, handle), before = financialRows(f);
  for (const forged of [{}, { ...handle }, structuredClone(handle), JSON.parse(JSON.stringify(handle)), native, { ...native }, structuredClone(native)]) {
    await assert.rejects(evidence(f, forged));
    await assert.rejects(target(f, forged));
  }
  assert.equal(f.counters.reductions, 1);
  assert.deepEqual(financialRows(f), before);
});

for (const kind of ['request', 'environment', 'database', 'command', 'quote', 'consent', 'source'])
test(`admission handle refuses ${kind} substitution without preparing again`, async t => {
  const f = await fixture(t), handle = await prepare(f), before = financialRows(f);
  if (kind === 'request') await assert.rejects(evidence(f, handle, { ...f.trusted, request: new Request(f.request) }));
  if (kind === 'environment') await assert.rejects(evidence(f, handle, { ...f.trusted, env: { ...f.env } }));
  if (kind === 'database') {
    const old = f.env.DB; f.env.DB = { ...old };
    try { await assert.rejects(evidence(f, handle)); } finally { f.env.DB = old; }
  }
  if (kind === 'command') await assert.rejects(evidence(f, handle, f.trusted, { ...f.command, clientMutationId: 'another-command' }));
  if (kind === 'quote') await assert.rejects(target(f, handle, f.source, { ...f.ready.preflight, termsDigest: 'changed' }));
  if (kind === 'consent') await assert.rejects(target(f, handle, f.source, f.ready.preflight, { ...f.command.sceneCostConsent, confirmed: false }));
  if (kind === 'source') await assert.rejects(target(f, handle, { ...f.source, sourceDigest: 'changed' }));
  assert.equal(f.counters.reductions, 1);
  assert.deepEqual(financialRows(f), before);
});

test('caller-supplied source version cannot select or recapture a preparation baseline', async t => {
  const f = await fixture(t), before = financialRows(f);
  for (const change of [{ sceneSourceVersion: {} }, { sceneUseVersionedHistory: true }, { sceneUseVersionedHistory: false }])
    await assert.rejects(handoff.prepareSceneSponsorAdmission({ source: { ...f.source, ...change }, command: f.command, quote: f.ready.preflight }));
  assert.equal(f.counters.reductions, 0);
  assert.deepEqual(financialRows(f), before);
});

test('already aborted preparation refuses before native reads', async t => {
  const f = await fixture(t); f.controller.abort();
  await assert.rejects(prepare(f));
  assert.equal(f.counters.batches, 0);
  assert.equal(f.counters.reductions, 0);
});

for (const consumer of ['evidence', 'target']) test(`original request cancellation after a real ${consumer} read refuses the handle`, async t => {
  const f = await fixture(t), handle = await prepare(f); let reached = false;
  f.afterBatch = results => { reached = true; f.controller.abort(); return results; };
  await assert.rejects(consumer === 'evidence' ? evidence(f, handle) : target(f, handle));
  assert.equal(reached, true);
  assert.equal(f.counters.reductions, 1);
});

test('a changed source generation invalidates the preparation instead of rebasing it', async t => {
  const f = await fixture(t), handle = await prepare(f), before = financialRows(f);
  f.sqlite.prepare("UPDATE scene_source_generations SET generation=generation+1 WHERE scope_kind='stream' AND scope_key=?").run(stream);
  await assert.rejects(evidence(f, handle));
  await assert.rejects(target(f, handle));
  assert.equal(f.counters.reductions, 1);
  assert.deepEqual(financialRows(f), before);
});

async function runFixture(t) {
  const f = await fixture(t);
  // Existing ordinary admission supplies only synthetic original job/slot/quote
  // custody. These tests do not stand in for a sponsor financial authority test.
  await requirements.outputExperienceCommands.execute(f.trusted, f.command, nativeBridge.outputDocumentExecutionBridge, f.execution);
  const job = f.sqlite.prepare('SELECT * FROM document_jobs').get();
  assert.ok(job?.scene_source_version_json);
  const row = f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE job_id=?').get(job.job_id);
  const slot = ledger.outputSlotFromRow(f.trusted.scope.key, row);
  const command = { documentId: f.documentId, action: 'run', grantId: slot.grantId, clientMutationId: 'scene-handoff-run',
    expectedRevision: `output:${f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(stream).n}` };
  const controller = new AbortController(), request = post('/api/output-requirements', command, controller.signal);
  const trusted = await requirements.loadOutputTrustedContext(request, f.env, f.documentId, 'request');
  assert.ok(!(trusted instanceof Response));
  const source = { ...f.source, request, scope: trusted.scope, principal: trusted.principal, context: trusted.context,
    ownerHead: trusted.ownerHead, sourceEvents: trusted.events,
    sourceAssertions: [...trusted.sourceAssertions, ...disclosure.outputActiveSourceDeadlineAssertions(trusted.context)],
    sourceDigest: trusted.sourceDigest, requirementsDigest: trusted.requirementsDigest };
  return Object.assign(f, { job, slot, runCommand: command, runRequest: request, runTrusted: trusted, runSource: source, runController: controller });
}
const prepareRun = f => handoff.prepareSceneSponsorRun({ source: f.runSource, command: f.runCommand, quote: f.ready.preflight,
  slot: f.slot, correlationId: f.job.correlation_id });
const runEvidence = (f, handle) => handoff.requireSceneSponsorRunPreparation(handle, f.runTrusted, f.runCommand);
const transactionInput = (f, raw = f.job.scene_source_version_json) => ({ request: f.runRequest, env: f.env, scope: f.runTrusted.scope,
  slot: f.slot, correlationId: f.job.correlation_id, raw });
const guards = (f, assertions) => assertions.flatMap(value => ledger.outputAssertionStatements(f.env, value));
const stage = (f, event) => f.env.DB.prepare(`INSERT INTO event_write_stage(${eventPrimitives.EVENT_WRITE_COLUMNS}) VALUES(${eventPrimitives.eventWriteBindings(event).map(() => '?').join(',')})`)
  .bind(...eventPrimitives.eventWriteBindings(event));

async function commitRun(f, handle) {
  const captured = await runEvidence(f, handle), assertions = handoff.sceneSponsorRunTransaction(handle, transactionInput(f));
  await ledger.commitOutputCommand(f.env, { scope: f.runTrusted.scope, permission: 'request', expectedHead: f.runTrusted.ownerHead,
    expectedProjectHead: f.runTrusted.projectHead, key: f.runCommand.clientMutationId, digest: 'scene-handoff-run-fixture', action: 'run', assertions,
    sceneJobRuns: [{ slot: f.slot, version: captured.receipt.witness.successor, previousRaw: captured.receipt.raw }],
    events: [{ type: 'OutputExecutionRunRequested', payload: { grant_id: f.slot.grantId, job_ids: [f.slot.jobId] } }],
    buildSidecars: () => ({ statements: [f.env.DB.prepare("UPDATE output_execution_grants SET status='active' WHERE grant_id=?").bind(f.slot.grantId),
      f.env.DB.prepare("UPDATE output_operation_slots SET status='queued' WHERE slot_id=?").bind(f.slot.slotId)], assertions: [] }) });
  return witness.readSceneJobSourceWitness(f.env, f.runTrusted.scope, f.slot, f.job.correlation_id);
}

test('Run preparation binds the exact original receipt and transaction guards', async t => {
  const f = await runFixture(t), before = financialRows(f), handle = await prepareRun(f), captured = await runEvidence(f, handle);
  assert.strictEqual(captured.nativePreflight, (await runEvidence(f, handle)).nativePreflight);
  assert.equal(captured.receipt.raw, f.job.scene_source_version_json);
  assert.equal(captured.receipt.witness.phase, 'admission');
  assert.deepEqual(preflight.outputScenePreflightProof(captured.nativePreflight).prepared.sourceVersion, captured.receipt.witness.successor);
  const assertions = handoff.sceneSponsorRunTransaction(handle, transactionInput(f));
  await f.env.DB.batch(guards(f, assertions));
  for (const change of [{ raw: JSON.stringify(JSON.parse(captured.receipt.raw), null, 1) }, { correlationId: 'other' },
    { slot: { ...f.slot, jobId: 'other' } }, { request: new Request(f.runRequest) }, { env: { ...f.env } }])
    assert.throws(() => handoff.sceneSponsorRunTransaction(handle, { ...transactionInput(f), ...change }));
  assert.deepEqual(financialRows(f), before);
});

test('committed Run advances only the native witness and expires the predecessor handle', async t => {
  const f = await runFixture(t), handle = await prepareRun(f), old = await runEvidence(f, handle), before = financialRows(f);
  const next = await commitRun(f, handle);
  assert.equal(next.witness.phase, 'run');
  assert.deepEqual(next.witness.predecessor, old.receipt.witness.successor);
  assert.ok(next.witness.successor.streamGeneration > old.receipt.witness.successor.streamGeneration);
  await assert.rejects(runEvidence(f, handle));
  assert.deepEqual(financialRows(f), before, 'Run makes no second job, slot, hold or provider call');
});

test('Run refuses a changed exact receipt instead of selecting a new source baseline', async t => {
  const f = await runFixture(t), handle = await prepareRun(f), reductions = f.counters.reductions;
  const raw = JSON.stringify(JSON.parse(f.job.scene_source_version_json), null, 1);
  f.sqlite.prepare('UPDATE document_jobs SET scene_source_version_json=? WHERE job_id=?').run(raw, f.job.job_id);
  await assert.rejects(runEvidence(f, handle));
  await assert.rejects(f.env.DB.batch(guards(f, handoff.sceneSponsorRunTransaction(handle, transactionInput(f)))));
  assert.equal(f.counters.reductions, reductions);
});

async function dispatchFixture(t) {
  const f = await runFixture(t), handle = await prepareRun(f), run = await commitRun(f, handle);
  const correlationId = `${f.slot.jobId}:attempt:1`;
  const claim = witness.prepareSceneJobSourceClaim(f.env, { scope: f.runTrusted.scope, slot: f.slot,
    previousRaw: run.raw, previousCorrelationId: f.slot.jobId, correlationId });
  const result = await f.env.DB.batch([...guards(f, claim.before), f.env.DB.prepare("UPDATE document_jobs SET status='running',attempt_count=1,correlation_id=?,lease_expires_at=? WHERE job_id=?")
    .bind(correlationId, new Date(Date.now() + 120000).toISOString(), f.slot.jobId), ...claim.after]);
  claim.acknowledge(result.slice(-claim.after.length));
  const controller = new AbortController();
  const owner = handoff.createSceneSponsorDispatchOwner({ env: f.env, scope: f.runTrusted.scope, slot: f.slot, correlationId });
  return Object.assign(f, { correlationId, dispatchController: controller, dispatchOwner: owner });
}
async function currentDispatch(f) {
  const receipt = await witness.readSceneJobSourceWitness(f.env, f.runTrusted.scope, f.slot, f.correlationId);
  const authority = requirements.prepareOutputExecutionProof(f.runTrusted.scope,
    await requirements.resolveOutputExecutionAuthority(f.env, f.runTrusted.scope, f.slot));
  const nativePreflight = await nativeBridge.preflightOutputNativeTarget({ env: f.env, request: new Request('https://output-execution.invalid'),
    scope: f.runTrusted.scope, principal: f.runTrusted.principal, confirmedPlan: authority.confirmedPlan, target: authority.target,
    context: authority.context, sourceEvents: authority.events, sourceAssertions: authority.assertions, sourceDigest: authority.sourceDigest,
    requirementsDigest: authority.requirementsDigest, ownerHead: authority.sourceEpoch.head, sceneSourceVersion: receipt.witness.successor });
  assert.equal(nativePreflight.available, true, JSON.stringify(nativePreflight));
  const prepared = preflight.outputScenePreflightProof(nativePreflight).prepared;
  const evidence = await handoff.prepareSceneSponsorDispatchEvidence(f.dispatchOwner, { nativePreflight, receiptRaw: receipt.raw, signal: f.dispatchController.signal });
  return { evidence, prepared, nativePreflight, receipt };
}

test('dispatch evidence requires the real prepared object and later runtime signal', async t => {
  const f = await dispatchFixture(t), pair = await currentDispatch(f);
  const bound = handoff.requireSceneSponsorDispatchEvidence(pair.evidence, pair.prepared);
  assert.equal(bound.jobId, f.slot.jobId); assert.equal(bound.correlationId, f.correlationId);
  await f.env.DB.batch(guards(f, bound.assertions));
  for (const copied of [{ ...pair.prepared }, structuredClone(pair.prepared)])
    assert.throws(() => handoff.requireSceneSponsorDispatchEvidence(pair.evidence, copied));
  await assert.rejects(handoff.prepareSceneSponsorDispatchEvidence(f.dispatchOwner, { nativePreflight: { ...pair.nativePreflight }, receiptRaw: pair.receipt.raw, signal: f.dispatchController.signal }));
  await assert.rejects(handoff.prepareSceneSponsorDispatchEvidence(f.dispatchOwner, { nativePreflight: pair.nativePreflight, receiptRaw: pair.receipt.raw, signal: new AbortController().signal }));
  f.dispatchController.abort();
  assert.throws(() => handoff.requireSceneSponsorDispatchEvidence(pair.evidence, pair.prepared));
});

test('accepted native execution successor invalidates old dispatch evidence and admits a genuine fresh proof', async t => {
  const f = await dispatchFixture(t), first = await currentDispatch(f), before = financialRows(f);
  const nextSequence = f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(stream).n + 1;
  const event = eventPrimitives.makeEvent(stream, nextSequence, `user:${actor}`, 'scene-handoff-test', f.correlationId, 'DocumentRenderRequested',
    { project_id: f.runTrusted.scope.projectId, document_id: f.documentId, artifact_kind: 'scene' });
  const transition = witness.prepareSceneJobSourceTransition(f.env, { scope: f.runTrusted.scope, slot: f.slot, correlationId: f.correlationId,
    predecessor: first.receipt.witness.successor, previousRaw: first.receipt.raw, phase: 'execution', events: [event] });
  const result = await f.env.DB.batch([...guards(f, transition.before), stage(f, event), ...transition.after]);
  transition.acknowledge(result.slice(-transition.after.length));
  handoff.invalidateSceneSponsorDispatch(f.dispatchOwner);
  assert.throws(() => handoff.requireSceneSponsorDispatchEvidence(first.evidence, first.prepared));
  const next = await currentDispatch(f);
  assert.equal(next.receipt.witness.phase, 'execution');
  assert.deepEqual(next.receipt.witness.predecessor, first.receipt.witness.successor);
  assert.ok(next.prepared.sourceVersion.streamGeneration > first.prepared.sourceVersion.streamGeneration);
  await f.env.DB.batch(guards(f, handoff.requireSceneSponsorDispatchEvidence(next.evidence, next.prepared).assertions));
  assert.deepEqual(financialRows(f), before);
});

test('dispatch final read observes abort without issuing usable evidence', async t => {
  const f = await dispatchFixture(t), pair = await currentDispatch(f); let reached = false;
  f.afterBatch = results => { reached = true; f.dispatchController.abort(); return results; };
  await assert.rejects(handoff.prepareSceneSponsorDispatchEvidence(f.dispatchOwner, { nativePreflight: pair.nativePreflight,
    receiptRaw: pair.receipt.raw, signal: f.dispatchController.signal }));
  assert.equal(reached, true);
});

for (const kind of ['command', 'quote', 'request', 'database']) test(`admission consumer refuses late ${kind} replacement after a real batch`, async t => {
  const f = await fixture(t), handle = await prepare(f), originalDb = f.env.DB, originalRequest = f.trusted.request;
  const originalMutation = f.command.clientMutationId, originalTerms = f.ready.preflight.termsDigest;
  let reached = false;
  f.afterBatch = results => {
    reached = true;
    if (kind === 'command') f.command.clientMutationId = 'late-command';
    if (kind === 'quote') f.ready.preflight.termsDigest = 'late-quote';
    if (kind === 'request') f.trusted.request = new Request(originalRequest);
    if (kind === 'database') f.env.DB = { ...originalDb };
    return results;
  };
  try { await assert.rejects(kind === 'quote' ? target(f, handle) : evidence(f, handle)); }
  finally { f.env.DB = originalDb; f.trusted.request = originalRequest; f.command.clientMutationId = originalMutation; f.ready.preflight.termsDigest = originalTerms; }
  assert.equal(reached, true);
  assert.equal(f.counters.reductions, 1);
});

for (const kind of ['missing', 'sparse', 'failed', 'false', 'extra']) test(`handoff rejects a ${kind} real-batch acknowledgment`, async t => {
  const f = await fixture(t), handle = await prepare(f); let reached = false;
  f.afterBatch = results => {
    reached = true;
    if (kind === 'missing') return results.slice(0, -1);
    if (kind === 'sparse') delete results[0];
    if (kind === 'failed') results[0].success = false;
    if (kind === 'false') results[0].results = [{ current: 0 }];
    if (kind === 'extra') results.push({ success: true, results: [{ current: 1 }] });
    return results;
  };
  await assert.rejects(evidence(f, handle));
  assert.equal(reached, true);
  assert.equal(f.counters.reductions, 1);
});

test('Run request cancellation after its exact witness read stops native preparation', async t => {
  const f = await runFixture(t), before = financialRows(f), reductions = f.counters.reductions; let reads = 0;
  f.afterBatch = results => { reads++; f.runController.abort(); return results; };
  await assert.rejects(prepareRun(f));
  assert.equal(reads, 1);
  assert.equal(f.counters.reductions, reductions);
  assert.deepEqual(financialRows(f), before);
});

test('unrelated source change cannot mint dispatch evidence from the former genuine proof', async t => {
  const f = await dispatchFixture(t), pair = await currentDispatch(f), before = financialRows(f), reductions = f.counters.reductions;
  f.sqlite.prepare("UPDATE scene_source_generations SET generation=generation+1 WHERE scope_kind='stream' AND scope_key=?").run(stream);
  await assert.rejects(handoff.prepareSceneSponsorDispatchEvidence(f.dispatchOwner, { nativePreflight: pair.nativePreflight,
    receiptRaw: pair.receipt.raw, signal: f.dispatchController.signal }));
  assert.equal(f.counters.reductions, reductions);
  assert.deepEqual(financialRows(f), before);
});

test('dispatch abort between the checked batch helper and factory continuation refuses evidence', async t => {
  const f = await dispatchFixture(t), pair = await currentDispatch(f), actualBatch = f.DB.batch.bind(f.DB), order = [];
  let finalBatches = 0;
  f.DB.batch = async statements => {
    const results = await actualBatch(statements);
    assert.ok(statements.length > 0 && statements.every(statement => statement.sql.startsWith('SELECT CASE WHEN (')));
    finalBatches++;
    // Resolving this async batch queues check()'s continuation behind the first
    // microtask. That task queues abort behind check(), but ahead of the caller
    // resumed by check()'s completion. Removing only the factory's post-await
    // current() would therefore return a handle after this abort.
    queueMicrotask(() => {
      order.push('first-microtask');
      queueMicrotask(() => { order.push('abort'); f.dispatchController.abort(); });
    });
    // Observe the helper inspecting the unchanged real SQLite result. No row,
    // success value, source assertion, or native proof is manufactured.
    return new Proxy(results, { getOwnPropertyDescriptor(target, key) {
      if (key === 'length') order.push('helper-inspected-real-batch');
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
  };
  await assert.rejects(handoff.prepareSceneSponsorDispatchEvidence(f.dispatchOwner, { nativePreflight: pair.nativePreflight,
    receiptRaw: pair.receipt.raw, signal: f.dispatchController.signal }), /sponsor_scene_handoff_changed/);
  assert.equal(finalBatches, 1);
  assert.deepEqual(order, ['first-microtask', 'helper-inspected-real-batch', 'abort']);
  t.diagnostic(`Observed continuation order: ${order.join(' -> ')}`);
});

test('an own aborted=false property cannot conceal admission request cancellation', async t => {
  const f = await fixture(t); f.controller.abort();
  Object.defineProperty(f.request.signal, 'aborted', { value: false });
  assert.equal(f.request.signal.aborted, false);
  assert.equal(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get.call(f.request.signal), true);
  await assert.rejects(prepare(f), /sponsor_scene_handoff_changed/);
  assert.equal(f.counters.batches, 0);
});

test('an own aborted=false property cannot conceal dispatch cancellation', async t => {
  const f = await dispatchFixture(t), pair = await currentDispatch(f); f.dispatchController.abort();
  Object.defineProperty(f.dispatchController.signal, 'aborted', { value: false });
  assert.equal(f.dispatchController.signal.aborted, false);
  assert.equal(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get.call(f.dispatchController.signal), true);
  assert.throws(() => handoff.requireSceneSponsorDispatchEvidence(pair.evidence, pair.prepared), /sponsor_scene_handoff_changed/);
});
