import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual native save/confirm/preflight/commit code, real in-memory schema and
// real atomic batch. No bridge, HTTP fixture success, authority override, source
// replacement, provider credentials or persisted DB/media. This qualifies native
// confirmation guards, NOT the mini-app HTTP journey or provider execution.
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
  'worker/experience-output-api.ts', 'worker/experience-intake-api.ts', 'src/experiences/intake.ts']);
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
async function httpFixture(t) {
  const state = outputTestDatabase(':memory:'); t.after(() => state.sqlite.close());
  await runtime.ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(owner, 'creative@local.forma', 'Local creative', now, now, now);
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
    : post(state.path+'/prepare',body),state.env,execution,undefined);
  const RealDate = Date, old = Date.now()-1_200_000;
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
