import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual native save/confirm/preflight/commit code, real in-memory schema and
// real atomic batch. Original cases omit the bridge; capacity cases invoke only
// actual read-only Scene preflight with a non-secret configuration sentinel.
// No authority/source replacement, real credentials, provider call or persisted
// DB/media. This qualifies native guards and preflight, not paid generation.
const root = realpathSync(process.env.FORMA_SCENE_RENEWAL_CANDIDATE_ROOT);
const manifest = JSON.parse(readFileSync(process.env.FORMA_SCENE_RENEWAL_REVIEWED_MANIFEST, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-scene-renewal-native-transaction');
assert.equal(manifest.root, root);
const packageRoot = realpathSync(resolve(root, 'node_modules'));
assert.equal(manifest.packageRoot, packageRoot);
for (const metadata of manifest.packageMetadata) {
  assert.equal(createHash('sha256').update(readFileSync(metadata.path)).digest('hex'), metadata.sha256);
}
assert.equal(realpathSync(manifest.test.path), realpathSync(fileURLToPath(import.meta.url)));
assert.equal(createHash('sha256').update(readFileSync(manifest.test.path)).digest('hex'), manifest.test.sha256);
const pins = new Map(), names = new Map();
const within = (base, file) => { const local = relative(base, file); return !isAbsolute(local) && local !== '..' && !local.startsWith('..' + sep); };
for (const entry of manifest.modules) {
  const path = realpathSync(resolve(root, entry.path));
  assert.ok(within(root, path) || within(packageRoot, path), 'Source must be donor-contained or exact installed package bytes');
  assert.ok(!pins.has(path));
  const bytes = readFileSync(path);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
  pins.set(path, entry.sha256); names.set(path, entry.path);
}
const edges = new Map(manifest.edges.map(edge => [JSON.stringify([edge.parent, edge.specifier]), edge.target]));
const entrypoints = new Set(['worker/runtime.ts', 'worker/output-requirements-api.ts', 'worker/experience-output-binding.ts',
  'worker/experience-scene-renewal.ts', 'worker/experience-scene-renewal-proof.ts', 'worker/experience-output-originals.ts',
  'worker/experience-scene-recipe.ts', 'src/model/output-scene-contract.ts', 'worker/output-scene-source.ts',
  'worker/experience-intake-read.ts', 'worker/output-command-core.ts', 'tests/output-server-test-helpers.mjs',
  'worker/experience-output-api.ts', 'worker/experience-intake-api.ts', 'src/experiences/intake.ts',
  'worker/output-scene-preflight.ts']);
let forbidden = 0;
const restorers = [];
// Before ANY production or package import. All attempted work fails, and the
// counter survives catches. No successful provider response is fabricated.
for (const name of ['fetch', 'WebSocket', 'setTimeout', 'setInterval']) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: function forbiddenWork() { forbidden++; throw Error(`forbidden_native_confirmation_work:${name}`); } });
  restorers.push(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
}
const self = realpathSync(fileURLToPath(import.meta.url));
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL?.startsWith('file:') ? realpathSync(fileURLToPath(context.parentURL)) : null;
    let target;
    if (parent === self) {
      assert.ok(specifier.startsWith('file:'), 'Test may import only explicit pinned entries');
      const path = realpathSync(fileURLToPath(specifier));
      assert.ok(entrypoints.has(names.get(path)), `Unlisted entry: ${path}`);
      target = names.get(path);
    } else {
      assert.ok(names.has(parent), `Unpinned parent: ${parent}`);
      target = edges.get(JSON.stringify([names.get(parent), specifier]));
      assert.ok(target, `Unlisted dependency: ${names.get(parent)} -> ${specifier}`);
    }
    if (target.startsWith('node:')) {
      assert.ok(manifest.builtins.includes(target));
      // Only the audited SQLite fixture helper imports Node builtin capabilities.
      assert.equal(names.get(parent), 'tests/output-server-test-helpers.mjs');
      return nextResolve(target, context);
    }
    const file = realpathSync(resolve(root, target));
    assert.ok(pins.has(file));
    // CommonJS require hooks accept absolute paths, not file: specifiers.
    // The path still comes only from the pinned parent/edge allowlist.
    return nextResolve(file, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('node:')) { assert.ok(manifest.builtins.includes(url)); return nextLoad(url, context); }
    const file = realpathSync(fileURLToPath(url));
    assert.ok(pins.has(file));
    const loaded = nextLoad(url, context), source = loaded.source;
    assert.ok(source != null, `Missing exact loaded bytes: ${file}`);
    const bytes = typeof source === 'string' ? Buffer.from(source) : ArrayBuffer.isView(source)
      ? Buffer.from(source.buffer, source.byteOffset, source.byteLength) : Buffer.from(source);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pins.get(file));
    return loaded;
  },
});
let cleaned = false;
function cleanup() { if (cleaned) return; cleaned = true; hook.deregister(); restorers.reverse().forEach(restore => restore()); }
process.once('exit', cleanup);
after(() => { try { assert.equal(forbidden, 0, 'No swallowed network/background attempts'); } finally { cleanup(); } });
const load = path => import(pathToFileURL(resolve(root, path)).href);
const runtime = await load('worker/runtime.ts');
const native = await load('worker/output-requirements-api.ts');
const binding = await load('worker/experience-output-binding.ts');
const renewal = await load('worker/experience-scene-renewal.ts');
const proof = await load('worker/experience-scene-renewal-proof.ts');
const originals = await load('worker/experience-output-originals.ts');
const { createExperienceSceneRecipe } = await load('worker/experience-scene-recipe.ts');
const { createSceneOutputContract } = await load('src/model/output-scene-contract.ts');
const { outputScenePreparationIdentity } = await load('worker/output-scene-source.ts');
const { retainedGuard } = await load('worker/experience-intake-read.ts');
const { outputCommandReceiptAssertion } = await load('worker/output-command-core.ts');
const { outputTestDatabase } = await load('tests/output-server-test-helpers.mjs');
const { handleExperienceOutput } = await load('worker/experience-output-api.ts');
const { handleExperienceIntake } = await load('worker/experience-intake-api.ts');
const { registeredExperience, initialValues } = await load('src/experiences/intake.ts');
const { preflightOutputSceneTarget, outputScenePreflightProof } = await load('worker/output-scene-preflight.ts');
const execution = { waitUntil() { forbidden++; throw Error('unexpected_background_work'); } };
const owner = 'dev-local-creative', project = 'renewal-project', documentId = 'renewal-document';
const stream = `creative:${owner}`, draftId = `experience-draft-${'c'.repeat(64)}`;
const rootBinding = { version: 1, draftId, draftHash: `sha256:${'a'.repeat(64)}`, releaseHash: `sha256:${'b'.repeat(64)}`,
  requestHash: `sha256:${'d'.repeat(64)}`, sourceBindingHash: `sha256:${'e'.repeat(64)}`, output: 'scene',
  projectId: project, documentId, streamId: stream };
const { draftHash, releaseHash, requestHash, sourceBindingHash } = rootBinding;
const contract = createSceneOutputContract({ draftId, draftHash, releaseHash, requestHash, sourceBindingHash });
const recipe = createExperienceSceneRecipe({ output: 'scene', requirementId: 'renewal-requirement', deliverableId: 'renewal-scene', contract });
const request = new Request('http://localhost/api/output-requirements');
const financialTables = ['output_execution_grants', 'output_operation_slots', 'document_jobs', 'budget_reservations', 'cost_budget_reservations', 'output_provider_calls'];
async function fixture(t) {
  const state = outputTestDatabase(':memory:'); t.after(() => state.sqlite.close());
  await runtime.ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(owner, 'creative@local.forma', 'Local creative', now, now, now);
  await runtime.appendEvents(state.env, [
    runtime.makeEvent(stream, 0, `user:${owner}`, 'test', 'seed', 'ProjectCreated', { project_id: project, name: 'Renewal' }),
    runtime.makeEvent(stream, 0, `user:${owner}`, 'test', 'seed', 'DocumentCreated', { project_id: project, document_id: documentId, title: 'Scene', handle: 'scene' }),
    runtime.makeEvent(stream, 0, `user:${owner}`, 'test', 'seed', 'BlockCreated', { project_id: project, document_id: documentId, block_id: 'source', scope: 'document', type: 'direction', position: 'a0', handle: 'direction/source', properties: { text: 'Two mechanics repair a bicycle in one workshop.', authority: 'authored', weight: 1 } }),
  ]);
  state.context = async () => {
    const trusted = await native.loadOutputTrustedContext(request, state.env, documentId, 'author');
    assert.ok(!(trusted instanceof Response), trusted instanceof Response ? await trusted.text() : '');
    assert.equal(trusted.scope.ownerUserId, owner);
    return trusted;
  };
  state.command = async (selected, phase, fields = {}, trusted = null) => {
    trusted ??= await state.context();
    const body = await binding.experienceOutputEnvelope(selected, phase, trusted.ownerHead, fields);
    const result = await native.outputExperienceCommands.execute(trusted, body, undefined, execution);
    assert.ok(!(result instanceof Response), result instanceof Response ? await result.text() : '');
    return { result, body, trusted };
  };
  await state.command(rootBinding, 'save', { blockId: recipe.spec.id, spec: recipe.spec });
  // Only fixture time is moved. Old native receipts are created by production
  // confirm/preflight code and are never edited to simulate expiry afterward.
  const RealDate = Date, old = Date.now() - 1_200_000;
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [old])); } static now() { return old; } };
  try {
    const confirmed = await state.command(rootBinding, 'confirm');
    await state.command(rootBinding, 'preflight', { planRevisionId: confirmed.result.receipt.payload.plan_revision_id, targetIds: [recipe.targetId] });
  } finally { globalThis.Date = RealDate; }
  state.retainedPlan = { draftId, draftHash, documentId, projectId: project };
  state.retainedContent = JSON.stringify(state.retainedPlan);
  state.retainedExpiry = new Date(Date.now() + 3_600_000).toISOString();
  state.sqlite.prepare("INSERT INTO private_content VALUES(?,?, 'experience-draft',?,?,?,NULL)")
    .run(draftId, owner, state.retainedContent, now, state.retainedExpiry);
  state.prepare = async () => {
    const trusted = await state.context(), lineage = await originals.readExperienceOutputLineage(trusted, rootBinding);
    const predecessor = originals.scenePreparationPredecessor(lineage.binding, lineage.originals);
    assert.ok(predecessor);
    const cycle = await renewal.scenePreparationSuccessor(rootBinding, predecessor);
    const requestIds = [];
    for (const witness of lineage.witnesses.filter(w => w.receipt.action === 'confirm')) {
      requestIds.push((await outputScenePreparationIdentity(contract, witness.receipt.payload.confirmed_plan, recipe.targetId)).requestId);
    }
    const identity = await outputScenePreparationIdentity(contract, lineage.originals.confirm.receipt.payload.confirmed_plan, recipe.targetId);
    trusted.sourceAssertions.push(retainedGuard({ user: trusted.principal }, state.retainedPlan, state.retainedContent),
      ...lineage.witnesses.map(w => outputCommandReceiptAssertion(trusted.scope, w.receipt)),
      proof.sceneRenewalIndexAssertion(trusted.scope, draftId, lineage.cycleCommandKeys),
      proof.sceneRenewalNoExecutionAssertion(trusted.scope, requestIds),
      proof.sceneRenewalWindowAssertion(trusted.scope, draftId, identity.expiresAt, state.retainedExpiry),
      proof.sceneRenewalPredecessorAssertion(trusted.scope, predecessor));
    const selected = { ...rootBinding, preparationCycle: cycle };
    const body = await binding.experienceOutputEnvelope(selected, 'confirm', trusted.ownerHead);
    return { trusted, body, selected, lineage, requestIds };
  };
  const batch = state.DB.batch.bind(state.DB);
  state.DB.batch = async statements => {
    const writes = statements.some(statement => /^INSERT INTO output_commands\b/u.test(statement.sql.trim()));
    const before = writes ? state.beforeBatch : null;
    if (writes) state.beforeBatch = null;
    if (before) { await before(statements); state.raceApplied = true; }
    const result = await batch(statements);
    if (writes && state.loseAcknowledgment) { state.loseAcknowledgment = false; throw Error('lost_acknowledgment_after_commit'); }
    return result;
  };
  state.run = candidate => native.outputExperienceCommands.execute(candidate.trusted, candidate.body, undefined, execution);
  state.count = table => Number(state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  state.assertUnpaid = () => { for (const table of financialTables) assert.equal(state.count(table), 0, table); assert.equal(state.media.size, 0); };
  return state;
}

test('native concurrent confirmation creates one deterministic successor and preserves original save', async t => {
  const s = await fixture(t), first = await s.prepare(), second = await s.prepare();
  assert.deepEqual(first.body, second.body);
  const before = s.count('output_plan_revisions');
  const results = await Promise.all([s.run(first), s.run(second)]);
  assert.equal(new Set(results.map(result => result.receipt.eventId)).size, 1);
  assert.equal(s.count('output_plan_revisions'), before + 1);
  const lineage = await originals.readExperienceOutputLineage(await s.context(), rootBinding);
  assert.equal(lineage.binding.preparationCycle.ordinal, 1);
  assert.equal(lineage.originals.save.receipt.eventId, first.lineage.originals.save.receipt.eventId);
  assert.equal(lineage.originals.preflight, undefined, 'Confirmation cannot fabricate a renewed quote');
  s.assertUnpaid();
});

test('lost native acknowledgment replays the exact child without another confirmation', async t => {
  const s = await fixture(t), candidate = await s.prepare();
  s.loseAcknowledgment = true;
  const first = await s.run(candidate), count = s.count('output_plan_revisions');
  assert.equal(s.loseAcknowledgment, false, 'Lost response occurs after the actual native write batch');
  const replay = await s.run(candidate);
  assert.equal(replay.receipt.eventId, first.receipt.eventId);
  assert.equal(s.count('output_plan_revisions'), count);
  s.assertUnpaid();
});

const drifts = {
  'predecessor plan source changed': (s, c) => s.sqlite.prepare("UPDATE output_plan_revisions SET source_digest=? WHERE plan_revision_id=?").run('f'.repeat(64), c.lineage.originals.confirm.receipt.payload.plan_revision_id),
  'predecessor requirement digest changed': (s, c) => s.sqlite.prepare("UPDATE output_plan_revisions SET requirements_digest=? WHERE plan_revision_id=?").run('f'.repeat(64), c.lineage.originals.confirm.receipt.payload.plan_revision_id),
  'retention shortened but still unexpired': s => s.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now() + 60_000).toISOString(), draftId),
  'retention extended': s => s.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now() + 7_200_000).toISOString(), draftId),
  'retained draft deleted': s => s.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(draftId),
  'retained draft redacted': s => s.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(), draftId),
  'retained draft body changed': s => s.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(draftId),
  'retained draft owner changed': s => s.sqlite.prepare("UPDATE private_content SET owner_id='different-owner' WHERE content_id=?").run(draftId),
  'private confirmation bytes changed': (s, c) => s.sqlite.prepare("UPDATE event_private_payloads SET private_json=private_json||' ' WHERE private_event_id=?").run(c.lineage.originals.confirm.receipt.eventId),
  'private confirmation deleted': (s, c) => s.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(c.lineage.originals.confirm.receipt.eventId),
  'ancestor receipt index changed': (s, c) => s.sqlite.prepare("UPDATE output_commands SET request_digest=? WHERE event_id=?").run('f'.repeat(64), c.lineage.originals.confirm.receipt.eventId),
  'new cycle index': (s, c) => s.sqlite.prepare(`INSERT INTO output_commands SELECT scope_key,actor_user_id,?,request_digest,action,event_id,created_at FROM output_commands WHERE event_id=?`).run(c.body.clientMutationId.replace(/:confirm$/, ':preflight'), c.lineage.originals.confirm.receipt.eventId),
  'authority withdrawn': s => s.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(owner),
  'owner source head changed': async s => runtime.appendEvents(s.env, [runtime.makeEvent(stream, 0, `user:${owner}`, 'test', 'race', 'BlockPropertyEdited', { project_id: project, document_id: documentId, block_id: 'source', property: 'text', value: 'Changed source' })]),
  'direct native authorization event': async s => runtime.appendEvents(s.env, [runtime.makeEvent(stream, 0, `user:${owner}`, 'test', 'race', 'OutputExecutionAuthorized', { project_id: project, document_id: documentId, grant_id: 'race-grant' })]),
};
for (const [name, change] of Object.entries(drifts)) test(`native confirmation rolls back on ${name}`, async t => {
  const s = await fixture(t), candidate = await s.prepare(), plans = s.count('output_plan_revisions');
  s.beforeBatch = () => change(s, candidate);
  await assert.rejects(() => s.run(candidate));
  assert.equal(s.raceApplied, true, 'Race must occur immediately before the actual native write transaction');
  assert.equal(s.count('output_plan_revisions'), plans);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS count FROM output_commands WHERE command_key=?').get(candidate.body.clientMutationId).count, 0);
  assert.equal(s.count('event_write_stage'), 0);
  s.assertUnpaid();
});

test('partial successor resumes native preflight without another confirmation or paid action', async t => {
  const s = await fixture(t), candidate = await s.prepare();
  await s.run(candidate);
  const plans = s.count('output_plan_revisions');
  const trusted = await s.context(), lineage = await originals.readExperienceOutputLineage(trusted, rootBinding);
  assert.equal(lineage.originals.preflight, undefined);
  trusted.sourceAssertions.push(...lineage.witnesses.map(w => outputCommandReceiptAssertion(trusted.scope, w.receipt)),
    proof.sceneRenewalIndexAssertion(trusted.scope, draftId, lineage.cycleCommandKeys));
  const prepared = await s.command(lineage.binding, 'preflight', { planRevisionId: lineage.originals.confirm.receipt.payload.plan_revision_id, targetIds: [recipe.targetId] }, trusted);
  const resumed = await originals.readExperienceOutputLineage(await s.context(), rootBinding);
  assert.equal(resumed.originals.preflight.receipt.eventId, prepared.result.receipt.eventId);
  assert.equal(resumed.originals.confirm.receipt.eventId, lineage.originals.confirm.receipt.eventId);
  assert.equal(s.count('output_plan_revisions'), plans);
  assert.equal(resumed.originals.authorize, undefined);
  assert.equal(resumed.originals.run, undefined);
  assert.equal(resumed.originals.preflight.receipt.payload.preflight.targets[0].available, false, 'No execution bridge was supplied');
  s.assertUnpaid();
});

test('a retained window equal to fifteen minutes refuses native confirmation', async t => {
  const s = await fixture(t);
  const expires = s.sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes') AS expiry").get().expiry;
  s.retainedExpiry = expires;
  s.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(expires, draftId);
  const candidate = await s.prepare(), plans = s.count('output_plan_revisions');
  await assert.rejects(() => s.run(candidate));
  assert.equal(s.count('output_plan_revisions'), plans);
  s.assertUnpaid();
});

test('a late authorization index with no stream-head change blocks native renewal', async t => {
  const s = await fixture(t), candidate = await s.prepare(), plans = s.count('output_plan_revisions');
  s.beforeBatch = () => s.sqlite.prepare(`INSERT INTO output_commands SELECT scope_key,actor_user_id,'native-authorization-race',request_digest,'authorize',event_id,created_at FROM output_commands WHERE event_id=?`)
    .run(candidate.lineage.originals.confirm.receipt.eventId);
  await assert.rejects(() => s.run(candidate));
  assert.equal(s.raceApplied, true);
  assert.equal(await runtime.streamHead(s.env, stream), candidate.trusted.ownerHead);
  assert.equal(s.count('output_plan_revisions'), plans);
  s.assertUnpaid();
});

// Real mini-app intake and prepare/read handlers. No test constructs the renewal
// sourceAssertions here: the product handler must assemble and enforce them.
async function httpFixture(t, { capacity = false, originalAgeMs = 1_200_000, largeHistory = false } = {}) {
  const state = outputTestDatabase(':memory:'); t.after(() => state.sqlite.close());
  if (capacity) state.capacity = instrumentScenePreflightCapacity(state);
  await runtime.ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(owner, 'creative@local.forma', 'Local creative', now, now, now);
  if (largeHistory) {
    // Genuine historical events precede the actual intake and confirmation;
    // they are not forged source assertions or changes to saved receipts.
    await runtime.appendEvents(state.env, Array.from({length:34}, (_, index) =>
      runtime.makeEvent(stream, 0, `user:${owner}`, 'test', 'earlier-projects', 'ProjectCreated',
        {project_id:`earlier-${index}`,name:'Earlier work '+ 'x'.repeat(65536)})));
    state.historyEventId = state.sqlite.prepare("SELECT event_id FROM events WHERE correlation_id='earlier-projects' ORDER BY sequence LIMIT 1").get().event_id;
    const historical = state.sqlite.prepare("SELECT SUM(length(CAST(private_json AS BLOB))) AS bytes FROM event_private_payloads WHERE owner_id=?").get(owner);
    assert.ok(historical.bytes > 2_000_000, 'The native fixture must exceed the former single-value proof limit');
  }
  const release = await registeredExperience('scene');
  const intent = { intentId: '00000000-0000-4000-8000-000000000091', experienceId: 'scene', releaseHash: release.releaseHash,
    values: {...initialValues(release), ...Object.fromEntries(Object.entries({characterA:'Mara', goalA:'Repair a bicycle',
      characterB:'Eli', goalB:'Keep a gift secret', location:'A bicycle workshop', secret:'The new wheel is a gift'})
      .map(([key,value]) => [key,{value,provenance:'authored'}]))} };
  const post = (path, body) => new Request('http://localhost' + path, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const saved = await handleExperienceIntake(post('/api/experiences/drafts', intent), state.env);
  assert.equal(saved.status,200,await saved.clone().text());
  state.plan = (await saved.json()).plan;
  const committed = await handleExperienceIntake(post(`/api/experiences/drafts/${state.plan.draftId}/commit`, {draftHash:state.plan.draftHash}),state.env);
  assert.equal(committed.status,200,await committed.clone().text());
  assert.equal((await committed.json()).status,'complete');
  state.path = `/api/experiences/drafts/${state.plan.draftId}/output`;
  state.send = (body) => handleExperienceOutput(body === undefined ? new Request('http://localhost'+state.path)
    : post(state.path+'/prepare',body),state.env,execution,state.bridge);
  const RealDate = Date, old = Date.now()-originalAgeMs;
  globalThis.Date = class extends RealDate { constructor(...args) {super(...(args.length?args:[old]));} static now(){return old;} };
  try {
    const response = await state.send({draftHash:state.plan.draftHash,explicitRequirementsConfirmation:true});
    assert.equal(response.status,200,await response.clone().text());
  } finally {globalThis.Date=RealDate;}
  state.read = async () => {const response=await state.send();assert.equal(response.status,200,await response.clone().text());return response.json();};
  state.expired = await state.read();
  assert.equal(state.expired.permitted.renewPreparation,true);
  state.body = {draftHash:state.plan.draftHash,explicitRequirementsConfirmation:true,
    renewal:{predecessorPreflightId:state.expired.preflight.id,explicitRenewal:true}};
  state.count = table => Number(state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  state.assertUnpaid = () => {for(const table of financialTables)assert.equal(state.count(table),0,table);assert.equal(state.media.size,0);};
  return state;
}

test('actual mini-app HTTP renewal retains one Document, appends one cycle and never auto-authorizes', async t => {
  const s = await httpFixture(t), events=s.count('events'), plans=s.count('output_plan_revisions');
  const rootReceipts=s.sqlite.prepare("SELECT * FROM output_commands ORDER BY command_key").all();
  await s.read();assert.equal(s.count('events'),events,'GET cannot renew');
  const response=await s.send(s.body);assert.equal(response.status,200,await response.clone().text());
  const renewed=await response.json();
  assert.equal(renewed.documentId,s.plan.documentId);
  assert.notEqual(renewed.plan.revisionId,s.expired.plan.revisionId);
  assert.notEqual(renewed.preflight.id,s.expired.preflight.id);
  assert.equal(renewed.permitted.renewPreparation??false,false);
  assert.equal(renewed.permitted.authorize,false,'No provider bridge supplied');
  assert.equal(renewed.permitted.run,false);
  assert.equal(s.count('output_plan_revisions'),plans+1);
  for(const row of rootReceipts)assert.deepEqual(s.sqlite.prepare('SELECT * FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?').get(row.scope_key,row.actor_user_id,row.command_key),row);
  const replay=await s.send(s.body);assert.equal(replay.status,200,await replay.clone().text());
  assert.equal((await replay.json()).preflight.id,renewed.preflight.id);
  assert.equal(s.count('output_plan_revisions'),plans+1);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentCreated'").get().count,1);
  s.assertUnpaid();
});

test('actual mini-app handler rejects forged predecessor and financial renewal fields without writes', async t => {
  const s=await httpFixture(t),events=s.count('events');
  for(const body of [{...s.body,renewal:{...s.body.renewal,predecessorPreflightId:'foreign'}},
    {...s.body,renewal:{...s.body.renewal,explicitRenewal:false}}, {...s.body,sceneCostConsent:{confirmed:true}}]) {
    const response=await s.send(body);assert.ok([400,403,409].includes(response.status));
    assert.equal(s.count('events'),events);
  }
  s.assertUnpaid();
});

test('actual mini-app renewal rolls back when retention changes between offer and native commit', async t => {
  const s=await httpFixture(t),plans=s.count('output_plan_revisions'),batch=s.DB.batch.bind(s.DB);let raced=false;
  s.DB.batch=async statements=>{
    if(!raced&&statements.some(statement=>/^INSERT INTO output_commands\b/u.test(statement.sql.trim())&&statement.bindings[2]?.startsWith('scene-cycle-v1:'))){
      s.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run(new Date(Date.now()+60_000).toISOString(),s.plan.draftId);raced=true;
    }
    return batch(statements);
  };
  const response=await s.send(s.body);assert.equal(raced,true);assert.equal(response.status,409,await response.clone().text());
  assert.equal(s.count('output_plan_revisions'),plans);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands WHERE command_key LIKE 'scene-cycle-v1:%'").get().count,0);
  s.assertUnpaid();
});

// Test-only SQL/response observation. Every statement still executes through
// the reviewed in-memory SQLite adapter and its BEGIN IMMEDIATE atomic batch.
// This records counts and SQL text, never source values or credentials.
function instrumentScenePreflightCapacity(state) {
  const observed = { bindingCounts: [], proofBatches: [], active: null, faults: 0 };
  const prepare = state.DB.prepare.bind(state.DB), batch = state.DB.batch.bind(state.DB);
  function track(statement) {
    const bind = statement.bind.bind(statement), execute = statement.execute.bind(statement);
    statement.bind = (...values) => {
      observed.bindingCounts.push(values.length);
      assert.ok(values.length <= 100, `D1 statement exceeds 100 bindings: ${values.length}`);
      return track(bind(...values));
    };
    statement.execute = kind => {
      assert.ok(statement.bindings.length <= 100, 'Every executed SQLite statement stays within D1 binding capacity');
      return execute(kind);
    };
    return statement;
  }
  state.DB.prepare = sql => track(prepare(sql));
  state.DB.batch = async statements => {
    const active = observed.active, last = statements.at(-1);
    // Select only the actual preflight's final proof batch, by its canonical
    // terminal deadline predicate and exact selected plan's deadline. Other
    // batches, reads, source readers, guards and result values are untouched.
    const selected = active && statements.length > 1
      && statements.every(statement => statement.sql.startsWith('SELECT CASE WHEN ('))
      && last.sql === "SELECT CASE WHEN (? > strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE 0 END AS current"
      && last.bindings.length === 1 && last.bindings[0] === active.expiresAt;
    const result = await batch(statements);
    if (!selected) return result;
    const record = { statements: statements.length, counts: statements.map(statement => statement.bindings.length),
      totalBindings: statements.reduce((sum, statement) => sum + statement.bindings.length, 0),
      successfulRows: result.length === statements.length && result.every(row => row.success !== false && Number(row.results[0]?.current) === 1) };
    observed.proofBatches.push(record); active.batches++;
    assert.equal(record.successfulRows, true, 'Negative cases start from real successful SQLite predicates');
    assert.ok(record.counts.every(count => count <= 100));
    if (!active.fault) return result;
    observed.faults++;
    if (active.fault === 'missing-result') return result.slice(0, -1);
    if (active.fault === 'sparse-result') { const sparse = [...result]; delete sparse[0]; return sparse; }
    if (active.fault === 'null-result') return [null, ...result.slice(1)];
    if (active.fault === 'nonarray-result') return { length: result.length };
    if (active.fault === 'string-current') return result.map((row, index) => index === 0 ? { ...row, results: [{ current: '1' }] } : row);
    if (active.fault === 'extra-proof-row') return result.map((row, index) => index === 0 ? { ...row, results: [{ current: 1 }, { current: 1 }] } : row);
    if (active.fault === 'false-predicate') return result.map((row, index) => index === 0 ? { ...row, results: [{ current: 0 }] } : row);
    if (active.fault === 'failed-result') return result.map((row, index) => index === 0 ? { ...row, success: false } : row);
    if (active.fault === 'expired-after-batch') {
      // Only the JS clock crosses expiry after the real atomic batch returned.
      // SQLite receipts and stored deadlines are not edited. Restored before
      // the bridge returns to the HTTP handler, even if preflight throws.
      active.restoreNow = Date.now;
      Date.now = () => Date.parse(active.expiresAt);
      return result;
    }
    assert.fail('Unknown targeted proof fault');
  };
  return observed;
}

function attachRealScenePreflight(state, fault = null) {
  assert.ok(state.capacity);
  // Public non-secret sentinel; satisfies configuration presence only. All
  // network and background tripwires remain installed before product imports.
  state.env.OPENAI_API_KEY = 'fixture-not-a-provider-key';
  const forbiddenBridge = () => { forbidden++; throw Error('unexpected_paid_scene_bridge_method'); };
  const returned = [];
  state.bridge = {
    async preflight(input) {
      assert.equal(state.capacity.active, null);
      const active = { expiresAt: new Date(Date.parse(input.confirmedPlan.confirmedAt) + 900_000).toISOString(), fault, batches: 0, restoreNow: null };
      state.capacity.active = active;
      try {
        // Unmodified actual input and production function; no provider or
        // source-reader replacement, precomputed target or fabricated success.
        const target = await preflightOutputSceneTarget(input);
        returned.push({ target, proof: outputScenePreflightProof(target), batches: active.batches });
        return target;
      } finally {
        if (active.restoreNow) Date.now = active.restoreNow;
        state.capacity.active = null;
      }
    },
    prepareAdmission: forbiddenBridge, dispatch: forbiddenBridge,
    resolveResult: forbiddenBridge, cleanupExpiredOrRevoked: forbiddenBridge,
  };
  return returned;
}

test('actual HTTP Scene preflight preserves complete history above two megabytes without enlarging the requested Scene', async t => {
  const s = await httpFixture(t, {capacity:true,largeHistory:true}), returned = attachRealScenePreflight(s);
  const response = await s.send(s.body);
  assert.equal(response.status,200,await response.clone().text());
  const result = await response.json();
  assert.equal(result.documentId,s.plan.documentId);
  assert.equal(result.preflight.targets[0].available,true);
  assert.equal(result.preflight.targets[0].reasonCode,'output_scene_ready');
  assert.ok(result.sceneCostPreview);
  assert.equal(result.permitted.authorize,true);
  assert.equal(result.permitted.run,false);
  assert.equal(returned.length,1);
  const prepared = returned[0].proof?.prepared;
  assert.ok(prepared);
  assert.ok(JSON.stringify(prepared.effectiveSnapshot).length < 100_000, 'Unrelated historical bodies are proof, not Scene prompt content');
  assert.ok(returned[0].proof.sourceAssertions.some(a => a.sql.includes('hex(substr')), 'The actual preflight retains complete byte-piece assertions');
  for(const a of returned[0].proof.sourceAssertions) for(const value of a.bindings ?? [])
    if(typeof value==='string') assert.ok(Buffer.byteLength(value)<=128*1024,'No source proof silently recombines the history into one large binding');
  s.assertUnpaid();assert.equal(forbidden,0);
});

test('actual HTTP large-history preparation refuses an old no-head body edit during complete proof capture', async t => {
  const s = await httpFixture(t, {capacity:true,largeHistory:true});
  attachRealScenePreflight(s);
  const batch = s.DB.batch.bind(s.DB); let raced = false;
  s.DB.batch = async statements => {
    if(!raced && statements.some(statement => statement.sql.startsWith('SELECT CASE WHEN (WITH source AS NOT MATERIALIZED')
      && statement.sql.includes('hex(substr'))) {
      const head = s.sqlite.prepare('SELECT MAX(sequence) AS head FROM events WHERE stream_id=?').get(stream).head;
      const original = s.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(s.historyEventId).private_json;
      assert.equal(original[20000],'x');
      const changed = original.slice(0,20000)+'y'+original.slice(20001);
      assert.equal(Buffer.byteLength(changed),Buffer.byteLength(original),'No metadata/length shortcut can detect this later-chunk edit');
      s.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(changed,s.historyEventId);
      assert.equal(s.sqlite.prepare('SELECT length(CAST(private_json AS BLOB)) AS bytes FROM event_private_payloads WHERE private_event_id=?').get(s.historyEventId).bytes,Buffer.byteLength(original));
      assert.equal(s.sqlite.prepare('SELECT MAX(sequence) AS head FROM events WHERE stream_id=?').get(stream).head,head);
      raced = true;
    }
    return batch(statements);
  };
  const response = await s.send(s.body);
  assert.equal(raced,true,'The mutation targets the actual complete history check');
  assert.equal(response.status,409,await response.clone().text());
  const result = await response.json();
  assert.equal(result.error,'output_source_changed_during_read');
  // Confirmation can commit before preparation; the historical mutation itself
  // must not append an event, create a quote, authorize or dispatch anything.
  assert.equal(s.count('output_preflights'),1,'Only the retained original preflight remains');
  s.assertUnpaid();assert.equal(forbidden,0);
});

test('actual HTTP Scene hydration rejects a transient historical edit even when restored before its read returns', async t => {
  const s=await httpFixture(t,{capacity:true,largeHistory:true});
  attachRealScenePreflight(s);
  const batch=s.DB.batch.bind(s.DB);let raced=false,restored=false;
  s.DB.batch=async statements=>{
    const joined=statements.some(statement=>statement.sql.startsWith('SELECT * FROM events') && statement.sql.includes('event_private_payloads'))
      && statements.some(statement=>statement.sql.startsWith('SELECT CASE WHEN (WITH source AS NOT MATERIALIZED') && statement.sql.includes('hex(substr'));
    if(raced||!joined)return batch(statements);
    raced=true;
    const original=s.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(s.historyEventId).private_json;
    const head=s.sqlite.prepare('SELECT MAX(sequence) AS head FROM events WHERE stream_id=?').get(stream).head;
    assert.equal(original[20000],'x');const changed=original.slice(0,20000)+'y'+original.slice(20001);
    assert.equal(Buffer.byteLength(changed),Buffer.byteLength(original));
    s.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(changed,s.historyEventId);
    try {
      // Actual page and exact proof execute together with the changed body.
      // Restore only after SQLite produced those rows, before the caller sees them.
      return await batch(statements);
    } finally {
      s.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(original,s.historyEventId);
      assert.equal(s.sqlite.prepare('SELECT MAX(sequence) AS head FROM events WHERE stream_id=?').get(stream).head,head);
      assert.equal(s.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(s.historyEventId).private_json,original);
      restored=true;
    }
  };
  const response=await s.send(s.body);
  assert.equal(raced,true,'Source hydration must be joined to the original complete history proof');
  assert.equal(restored,true);
  assert.equal(response.status,409,await response.clone().text());
  assert.equal((await response.json()).error,'output_source_changed_during_read');
  assert.equal(s.count('output_preflights'),1);
  s.assertUnpaid();assert.equal(forbidden,0);
});

for(const fault of ['missing-page','failed-head','malformed-head']) test(`actual HTTP Scene joined hydration refuses ${fault} without accepting partial source`,async t=>{
  const s=await httpFixture(t,{capacity:true,largeHistory:true});
  attachRealScenePreflight(s);
  const batch=s.DB.batch.bind(s.DB);let faulted=false;
  s.DB.batch=async statements=>{
    const joined=statements.some(statement=>statement.sql.startsWith('SELECT * FROM events')&&statement.sql.includes('event_private_payloads'))
      && statements.some(statement=>statement.sql.startsWith('SELECT CASE WHEN (WITH source AS NOT MATERIALIZED')&&statement.sql.includes('hex(substr'));
    const actual=await batch(statements);
    if(faulted||!joined)return actual;
    faulted=true;
    assert.equal(actual[0].success,true);assert.equal(actual[1].success,true);
    assert.ok(actual.slice(2).every(row=>row.success===true&&row.results[0]?.current===1));
    // Negative transport-result controls only; every source/proof SQL above
    // actually succeeded, and none of the authority predicate rows are changed.
    if(fault==='missing-page')return [undefined,...actual.slice(1)];
    if(fault==='failed-head')return [actual[0],{...actual[1],success:false},...actual.slice(2)];
    return [actual[0],{...actual[1],results:[{head:'not-a-head'}]},...actual.slice(2)];
  };
  const response=await s.send(s.body);
  assert.equal(faulted,true);
  assert.equal(response.status,409,await response.clone().text());
  assert.equal((await response.json()).error,'output_source_changed_during_read');
  assert.equal(s.count('output_preflights'),1);
  s.assertUnpaid();assert.equal(forbidden,0);
});

test('real Scene successor preflight survives cumulative original and renewal proof bindings', async t => {
  const s = await httpFixture(t, { capacity: true });
  // The inherited fixture deliberately makes the original expired preparation
  // with no bridge. It is not evidence of a previously available provider quote.
  assert.equal(s.expired.preflight.targets[0].available, false);
  const originalCommands = s.sqlite.prepare('SELECT * FROM output_commands ORDER BY command_key').all();
  const beforePlans = s.count('output_plan_revisions'), returned = attachRealScenePreflight(s);
  const response = await s.send(s.body);
  assert.equal(response.status, 200, await response.clone().text());
  const renewed = await response.json();
  assert.equal(renewed.status, 'review');
  assert.equal(renewed.preflight.targets[0].available, true);
  assert.equal(renewed.preflight.targets[0].reasonCode, 'output_scene_ready');
  assert.ok(renewed.sceneCostPreview);
  assert.equal(renewed.sceneCostPreview.documentId, s.plan.documentId);
  assert.ok(Date.parse(renewed.preflight.expiresAt) > Date.now());
  assert.ok(Date.parse(renewed.sceneCostPreview.expiresAt) > Date.now());
  assert.equal(renewed.permitted.authorize, true, 'Fresh terms may be reviewed; the test never authorizes');
  assert.equal(renewed.permitted.run, false);
  assert.equal(renewed.original, null); assert.equal(renewed.grant, null);
  assert.equal(renewed.documentId, s.plan.documentId);
  assert.notEqual(renewed.plan.revisionId, s.expired.plan.revisionId);
  assert.notEqual(renewed.preflight.id, s.expired.preflight.id);
  assert.equal(s.count('output_plan_revisions'), beforePlans + 1);
  assert.equal(returned.length, 1);
  assert.equal(returned[0].batches, 1, 'All final source assertions share one atomic batch');
  assert.ok(returned[0].proof, 'Actual preflight retains its original admission/dispatch proof object');
  const finalBatch = s.capacity.proofBatches.at(-1);
  t.diagnostic(JSON.stringify({proofStatements:finalBatch.statements,totalBindings:finalBatch.totalBindings,maximumStatementBindings:Math.max(...finalBatch.counts)}));
  assert.ok(finalBatch.totalBindings > 100, 'This must exercise the original combined-statement regression');
  assert.equal(finalBatch.statements, returned[0].proof.sourceAssertions.length);
  assert.equal(finalBatch.totalBindings, returned[0].proof.sourceAssertions.reduce((sum, value) => sum + (value.bindings?.length ?? 0), 0));
  assert.ok(s.capacity.bindingCounts.length > 0);
  assert.ok(s.capacity.bindingCounts.every(count => count <= 100));
  for (const row of originalCommands) assert.deepEqual(s.sqlite.prepare('SELECT * FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?').get(row.scope_key, row.actor_user_id, row.command_key), row);
  const passive = await s.read();
  assert.equal(passive.preflight.id, renewed.preflight.id);
  assert.equal(returned.length, 1, 'GET does not run another preflight');
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentCreated'").get().count, 1);
  s.assertUnpaid(); assert.equal(forbidden, 0);
});

// Both historical cycles are made by the actual HTTP handler at historical
// fixture times, without a provider bridge. Their unavailable preflights are
// immutable originals, not evidence of historically available provider quotes.
// SQLite retains its real clock; only the new second successor uses the actual
// Scene preflight and current SQL/JS deadlines. No saved receipt is backdated.
async function secondRenewalFixture(t) {
  const s = await httpFixture(t, {capacity:true, originalAgeMs:2_400_000});
  const RealDate=Date, firstTime=Date.now()-1_200_000;
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[firstTime]));} static now(){return firstTime;}};
  let first;
  try {
    const response=await s.send(s.body);assert.equal(response.status,200,await response.clone().text());
    first=await response.json();
  } finally {globalThis.Date=RealDate;}
  s.firstExpired=await s.read();
  assert.equal(s.firstExpired.preflight.id,first.preflight.id);
  assert.notEqual(first.preflight.id,s.expired.preflight.id);
  assert.equal(s.firstExpired.permitted.renewPreparation,true);
  assert.equal(s.firstExpired.preflight.targets[0].available,false);
  const trusted=await native.loadOutputTrustedContext(new Request('http://localhost'),s.env,s.plan.documentId,'author');
  assert.ok(!(trusted instanceof Response));
  const rootBinding=await binding.experienceOutputBinding(s.plan);
  const lineage=await originals.readExperienceOutputLineage(trusted,rootBinding);
  assert.equal(lineage.binding.preparationCycle.ordinal,1);
  const predecessor=originals.scenePreparationPredecessor(lineage.binding,lineage.originals);
  assert.ok(predecessor);assert.equal(predecessor.preflight.preflightId,first.preflight.id);
  s.expectedCycle=await renewal.scenePreparationSuccessor(rootBinding,predecessor);
  assert.equal(s.expectedCycle.ordinal,2);
  s.rootBinding=rootBinding;
  s.secondBody={draftHash:s.plan.draftHash,explicitRequirementsConfirmation:true,
    renewal:{predecessorPreflightId:first.preflight.id,explicitRenewal:true}};
  s.ancestors={
    commands:s.sqlite.prepare('SELECT * FROM output_commands ORDER BY command_key').all(),
    plans:s.sqlite.prepare('SELECT * FROM output_plan_revisions ORDER BY revision').all(),
    preflights:s.sqlite.prepare('SELECT * FROM output_preflights ORDER BY preflight_id').all(),
    bodies:s.sqlite.prepare('SELECT * FROM event_private_payloads ORDER BY private_event_id').all(),
  };
  assert.equal(s.ancestors.plans.length,2);assert.equal(s.ancestors.preflights.length,2);
  s.assertAncestors=()=>{
    for(const row of s.ancestors.commands)assert.deepEqual(s.sqlite.prepare('SELECT * FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?').get(row.scope_key,row.actor_user_id,row.command_key),row);
    for(const row of s.ancestors.plans)assert.deepEqual(s.sqlite.prepare('SELECT * FROM output_plan_revisions WHERE scope_key=? AND plan_revision_id=?').get(row.scope_key,row.plan_revision_id),row);
    for(const row of s.ancestors.preflights)assert.deepEqual(s.sqlite.prepare('SELECT * FROM output_preflights WHERE scope_key=? AND preflight_id=?').get(row.scope_key,row.preflight_id),row);
    for(const row of s.ancestors.bodies)assert.deepEqual(s.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(row.private_event_id),row);
  };
  s.assertUnpaid();return s;
}

test('actual HTTP second Scene renewal preserves both ancestors and preflights the deterministic cycle two',async t=>{
  const s=await secondRenewalFixture(t),returned=attachRealScenePreflight(s);
  const response=await s.send(s.secondBody);assert.equal(response.status,200,await response.clone().text());
  const renewed=await response.json();
  assert.equal(renewed.status,'review');assert.equal(renewed.documentId,s.plan.documentId);
  assert.equal(renewed.preflight.targets[0].available,true);assert.equal(renewed.preflight.targets[0].reasonCode,'output_scene_ready');
  assert.equal(renewed.permitted.authorize,true);assert.equal(renewed.permitted.run,false);
  assert.equal(renewed.original,null);assert.equal(renewed.grant,null);assert.ok(renewed.sceneCostPreview);
  assert.ok(Date.parse(renewed.sceneCostPreview.expiresAt)>Date.now());
  assert.notEqual(renewed.preflight.id,s.firstExpired.preflight.id);assert.notEqual(renewed.plan.revisionId,s.firstExpired.plan.revisionId);
  const trusted=await native.loadOutputTrustedContext(new Request('http://localhost'),s.env,s.plan.documentId,'author');
  assert.ok(!(trusted instanceof Response));
  const lineage=await originals.readExperienceOutputLineage(trusted,s.rootBinding);
  assert.deepEqual(lineage.binding.preparationCycle,s.expectedCycle);
  assert.equal(lineage.cycleCommandKeys.length,4);
  assert.equal(lineage.originals.preflight.receipt.payload.preflight_id,renewed.preflight.id);
  assert.equal(s.count('output_plan_revisions'),3);assert.equal(s.count('output_preflights'),3);
  assert.equal(returned.length,1);assert.ok(returned[0].proof);assert.equal(returned[0].batches,1);
  assert.ok(s.capacity.bindingCounts.every(count=>count<=100));s.assertAncestors();
  const counts={events:s.count('events'),commands:s.count('output_commands'),plans:s.count('output_plan_revisions'),preflights:s.count('output_preflights')};
  const replay=await s.send(s.secondBody);assert.equal(replay.status,200,await replay.clone().text());
  assert.equal((await replay.json()).preflight.id,renewed.preflight.id);
  assert.equal((await s.read()).preflight.id,renewed.preflight.id);assert.equal(returned.length,1);
  assert.deepEqual({events:s.count('events'),commands:s.count('output_commands'),plans:s.count('output_plan_revisions'),preflights:s.count('output_preflights')},counts);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentCreated'").get().count,1);
  s.assertAncestors();s.assertUnpaid();assert.equal(forbidden,0);
});

test('second Scene renewal rolls back on unrelated owner-head advance at native confirmation',async t=>{
  const s=await secondRenewalFixture(t),returned=attachRealScenePreflight(s),batch=s.DB.batch.bind(s.DB);
  const counts={events:s.count('events'),commands:s.count('output_commands'),plans:s.count('output_plan_revisions'),preflights:s.count('output_preflights')};
  const secondKey=await binding.experienceOutputCommandKey({...s.rootBinding,preparationCycle:s.expectedCycle},'confirm');
  let raced=false,headBefore=-1,headAfter=-1;
  s.DB.batch=async statements=>{
    if(!raced&&statements.some(statement=>/^INSERT INTO output_commands\b/u.test(statement.sql.trim())&&statement.bindings[2]===secondKey)){
      raced=true;headBefore=await runtime.streamHead(s.env,s.plan.streamId);
      await runtime.appendEvents(s.env,[runtime.makeEvent(s.plan.streamId,0,`user:${owner}`,'test','second-renewal-owner-head-race','ProjectCreated',
        {project_id:'unrelated-renewal-race-project',name:'Unrelated concurrent project'})]);
      headAfter=await runtime.streamHead(s.env,s.plan.streamId);
    }
    return batch(statements);
  };
  const response=await s.send(s.secondBody);assert.equal(raced,true);assert.equal(headAfter,headBefore+1);
  assert.equal(response.status,409,await response.clone().text());assert.equal((await response.json()).error,'output_revision_or_authority_changed');
  assert.equal(s.count('events'),counts.events+1,'Only the independent competing event persists');
  assert.equal(s.count('output_commands'),counts.commands);assert.equal(s.count('output_plan_revisions'),counts.plans);assert.equal(s.count('output_preflights'),counts.preflights);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS count FROM output_commands WHERE command_key=?').get(secondKey).count,0);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS count FROM events WHERE correlation_id=?').get(secondKey).count,0);
  assert.equal(returned.length,0,'The rejected confirmation never reaches a preflight or paid bridge');
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentCreated'").get().count,1);
  s.assertAncestors();s.assertUnpaid();assert.equal(forbidden,0);
});

for (const fault of ['missing-result', 'false-predicate', 'failed-result', 'expired-after-batch', 'sparse-result', 'null-result', 'nonarray-result', 'string-current', 'extra-proof-row'])
test(`real Scene preflight refuses ${fault} after its actual source-proof batch`, async t => {
  const s = await httpFixture(t, { capacity: true }), returned = attachRealScenePreflight(s, fault);
  const response = await s.send(s.body);
  assert.equal(response.status, 200, await response.clone().text());
  const renewed = await response.json();
  assert.equal(s.capacity.faults, 1, 'Exactly one selected final proof batch is faulted');
  assert.equal(returned.length, 1); assert.equal(returned[0].batches, 1);
  assert.equal(returned[0].target.available, false);
  assert.equal(returned[0].target.reasonCode, 'output_scene_source_changed');
  assert.equal(returned[0].proof, null, 'Rejected source proof cannot attach an admission/dispatch proof');
  assert.equal(renewed.preflight.targets[0].available, false);
  assert.equal(renewed.permitted.authorize, false); assert.equal(renewed.permitted.run, false);
  assert.equal(renewed.original, null); assert.equal(renewed.grant, null);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='DocumentCreated'").get().count, 1);
  s.assertUnpaid(); assert.equal(forbidden, 0);
});
