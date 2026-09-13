import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual local atomic-intake composition. Authored source; owner runs only after review.
// No mixed Runtime/lifecycle/native entry, authority DTO, canned SQL/count/receipt,
// positive guard or fresh private-storage result is supplied by this harness.
const rootInput = process.env.FORMA_EXPERIENCE_ATOMIC_INTAKE_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_ATOMIC_INTAKE_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-atomic-intake-local-sqlite');
const modulePaths = [
  "src/experiences/catalog.ts",
  "src/experiences/compiler.ts",
  "src/experiences/image-ratio.ts",
  "src/experiences/intake.ts",
  "src/model/block-types.ts",
  "src/model/generation-execution-evidence.ts",
  "src/model/output-requirement-events.ts",
  "src/model/presentation-candidates.ts",
  "src/model/project-intake.ts",
  "src/model/provider-submission.ts",
  "src/platform/capabilities.ts",
  "worker/access-policy.ts",
  "worker/canvas-governance-policy.ts",
  "worker/event-append.ts",
  "worker/event-privacy.ts",
  "worker/event-read-primitives.ts",
  "worker/event-stream-read.ts",
  "worker/event-write-primitives.ts",
  "worker/experience-intake-read.ts",
  "worker/image-adapter-evaluation-evidence.ts",
  "worker/intake-authority.ts",
  "worker/policy-version.ts",
  "worker/principal-request-core.ts",
  "worker/project-intake-read.ts",
  "worker/project-intake.ts",
  "worker/project-request-context.ts"
];
const fixtureBuiltins = { 'tests/fixtures/atomic-intake-sqlite.mjs': ['node:assert/strict', 'node:sqlite'] };
const extensionlessEdges = [{ from: 'src/model/project-intake.ts', specifier: './block-types', to: 'src/model/block-types.ts' }];
assert.deepEqual(manifest.modules.map(entry => entry.path).sort(), [...modulePaths].sort());
assert.deepEqual(manifest.fixtures.map(entry => entry.path).sort(), Object.keys(fixtureBuiltins));
assert.deepEqual(manifest.extensionlessEdges, extensionlessEdges, 'Only the exact existing extensionless edge is admitted');
const allowed = new Map(), fixtureFiles = new Map(), loadedFiles = new Set();
for (const entry of [...manifest.modules, ...manifest.fixtures]) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  const file = realpathSync(resolve(root, entry.path)), local = relative(root, file);
  assert.ok(!local.startsWith('..' + sep) && !isAbsolute(local));
  assert.ok(!allowed.has(file), 'No module-cache alias or duplicate reviewed path');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), entry.sha256, `Changed reviewed source: ${entry.path}`);
  allowed.set(file, entry);
  if (Object.hasOwn(fixtureBuiltins, entry.path)) {
    assert.deepEqual(entry.builtins, fixtureBuiltins[entry.path], 'Exact fixture-only builtin closure');
    fixtureFiles.set(file, new Set(entry.builtins));
  }
}
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let forbiddenFetchAttempts = 0, fetchInstalled = false, fetchRestored = false, hookActive = false, hook;
function throwFailures(errors, message) {
  // Array membership preserves any thrown value, including undefined.
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, message);
}
function cleanupLoader(errors = []) {
  try {
    if (hookActive) { hook.deregister(); hookActive = false; }
  } catch (error) { errors.push(error); }
  try {
    if (fetchInstalled && !fetchRestored) {
      if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
      else delete globalThis.fetch;
      fetchRestored = true;
    }
  } catch (error) { errors.push(error); }
  return errors;
}
function cleanupLoaderAtExit() {
  throwFailures(cleanupLoader(), 'Atomic intake loader exit cleanup failed');
}
function exactFile(url) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'file:');
  assert.equal(parsed.search, ''); assert.equal(parsed.hash, '');
  const file = realpathSync(fileURLToPath(parsed));
  assert.equal(pathToFileURL(file).href, url, 'One exact URL per loaded module; no aliases');
  return file;
}
const load = name => import(pathToFileURL(resolve(root, name)).href);
let readPrincipal, continueExperienceAuthorization, readDraft, retainedGuard;
let registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan, receiptPrefix, experienceDocumentRoute;
let canonicalJson, commitAtomicIntake, POLICY_VERSION, primitives, createAtomicIntakeSqlite;
try {
  // Own guard, hook, after-hook registration and initial imports in one setup.
  process.once('exit', cleanupLoaderAtExit);
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    enumerable: originalFetchDescriptor?.enumerable ?? true,
    value() { forbiddenFetchAttempts++; throw Error('Network forbidden in atomic-intake qualification'); },
  });
  fetchInstalled = true;
  hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('node:')) {
        const parent = exactFile(context.parentURL);
        assert.ok(fixtureFiles.get(parent)?.has(specifier), `Forbidden runtime builtin: ${specifier}`);
        return nextResolve(specifier, context);
      }
      assert.ok(specifier.startsWith('file:') || specifier.startsWith('./') || specifier.startsWith('../'), `No package/protocol fallback: ${specifier}`);
      assert.ok(!specifier.includes('?') && !specifier.includes('#'));
      const parentFile = context.parentURL ? exactFile(context.parentURL) : null;
      const edge = extensionlessEdges.find(entry => parentFile === resolve(root, entry.from) && specifier === entry.specifier);
      const file = edge ? realpathSync(resolve(root, edge.to)) : specifier.startsWith('file:') ? exactFile(specifier)
        : realpathSync(resolve(dirname(fileURLToPath(context.parentURL)), specifier));
      assert.ok(allowed.has(file), `Unreviewed atomic-intake dependency: ${file}`);
      if (context.parentURL && context.parentURL !== import.meta.url) {
        const parent = exactFile(context.parentURL);
        assert.ok(allowed.has(parent));
        assert.ok(!fixtureFiles.has(file), 'Production/fixture modules cannot import fixture helpers');
      }
      return nextResolve(pathToFileURL(file).href, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) {
        assert.ok(Object.values(fixtureBuiltins).some(names => names.includes(url)));
        return nextLoad(url, context);
      }
      const file = exactFile(url), entry = allowed.get(file);
      assert.ok(entry, `Unreviewed loaded atomic-intake source: ${file}`);
      const result = nextLoad(url, context), source = result.source;
      assert.ok(source !== undefined && source !== null);
      const bytes = typeof source === 'string' ? Buffer.from(source)
        : ArrayBuffer.isView(source) ? Buffer.from(source.buffer, source.byteOffset, source.byteLength) : Buffer.from(source);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `Loaded bytes changed: ${entry.path}`);
      loadedFiles.add(entry.path);
      return result; // Exactly the returned bytes checked above; no second source read.
    },
  });
  hookActive = true;
  after(() => {
    const errors = [];
    try {
      assert.equal(forbiddenFetchAttempts, 0, 'Forbidden fetch attempts remain failures even if swallowed');
    } catch (error) { errors.push(error); }
    try {
      assert.deepEqual([...loadedFiles].sort(), [...modulePaths, ...Object.keys(fixtureBuiltins)].sort(), 'Actual loaded finite graph includes every selected path and no extras');
    } catch (error) { errors.push(error); }
    cleanupLoader(errors);
    throwFailures(errors, 'Atomic intake loader verification and cleanup failed');
  });
  ({ readExistingPrincipalRequest: readPrincipal } = await load('worker/principal-request-core.ts'));
  ({ continueExperienceAuthorization, readDraft, retainedGuard } = await load('worker/experience-intake-read.ts'));
  ({ registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan, receiptPrefix, experienceDocumentRoute } = await load('src/experiences/intake.ts'));
  ({ canonicalJson } = await load('src/experiences/compiler.ts'));
  ({ commitAtomicIntake } = await load('worker/project-intake.ts'));
  ({ POLICY_VERSION } = await load('worker/policy-version.ts'));
  primitives = await load('worker/event-write-primitives.ts');
  ({ createAtomicIntakeSqlite } = await load('tests/fixtures/atomic-intake-sqlite.mjs'));
} catch (error) {
  throwFailures(cleanupLoader([error]), 'Atomic intake loader setup and cleanup failed');
}
// Hooks and the fail-closed fetch guard remain installed throughout actual tests.

const FUTURE = '2999-01-01T00:00:00.000Z';
const AUTHOR = 'r14-author', EMAIL = 'r14-author@example.test', NAME = 'R14 Author';
const PRIVATE_MARKER = 'R14 private authored botanical subject';
const issuedResults = new WeakMap(), issuedAuthorizations = new WeakSet(), issuedDrafts = new WeakMap();

function delayResult(milliseconds, value) {
  let timer;
  const promise = new Promise(resolve => { timer = setTimeout(() => resolve(value), milliseconds); });
  return { promise, dispose() { clearTimeout(timer); } };
}
function track(h, work, label) {
  const pending = Promise.resolve().then(work);
  const observed = pending.then(value => ({ kind: 'fulfilled', value }), error => ({ kind: 'rejected', error }));
  h.pending.add(observed);
  observed.then(() => h.pending.delete(observed));
  const timer = delayResult(5000, { kind: 'timeout' });
  return Promise.race([observed, timer.promise]).then(result => {
    if (result.kind === 'timeout') { h.sql.retire(); throw Error(`Atomic intake fixture deadline: ${label}`); }
    if (result.kind === 'rejected') throw result.error;
    return result.value;
  }).finally(() => timer.dispose());
}
async function drain(h) {
  const timer = delayResult(5000, false);
  try {
    const drained = await Promise.race([Promise.all([...h.pending]).then(() => true), timer.promise]);
    if (!drained) h.sql.retire();
    return drained;
  } finally { timer.dispose(); }
}
function fixture(t) {
  let sql;
  function closeOwned(errors) {
    for (const action of [() => sql?.retire(), () => sql?.close()]) {
      try { action(); } catch (error) { errors.push(error); }
    }
  }
  try {
    sql = createAtomicIntakeSqlite({ primitives });
    const h = { sql, env: { DB: sql.DB }, pending: new Set() };
    h.action = (work, label = 'actual action') => track(h, work, label);
    h.read = async (work, label = 'actual read') => {
      const before = sql.snapshot(), errors = [];
      let value;
      try { value = await h.action(work, label); } catch (error) { errors.push(error); }
      try {
        if (!sql.state.retired) assert.deepEqual(sql.snapshot(), before, 'The actual reader must not write, repair or replace');
      } catch (error) { errors.push(error); }
      throwFailures(errors, 'Atomic intake read and snapshot check failed');
      return value;
    };
    t.after(async () => {
      const errors = [];
      try { assert.equal(await drain(h), true, 'Retirement is containment, not a completed operation'); }
      catch (error) { errors.push(error); }
      for (const [name, message] of [
        ['forbiddenWrites', 'No production write outside the exact append/receipt batch'],
        ['reentrantAttempts', 'No reentrant fixture connection access'],
        ['lateReadAttempts', 'No production access after retirement'],
      ]) {
        try { assert.equal(sql.state[name], 0, message); } catch (error) { errors.push(error); }
      }
      closeOwned(errors);
      throwFailures(errors, 'Atomic intake fixture verification and cleanup failed');
    });
    h.principal = sql.seedPrincipal(POLICY_VERSION, { actorId: AUTHOR, email: EMAIL, name: NAME });
    return h;
  } catch (error) {
    const errors = [error]; closeOwned(errors);
    throwFailures(errors, 'Atomic intake fixture setup and cleanup failed');
  }
}
function requestFor(h) {
  return new Request('https://qualification.invalid/api/experiences/drafts', { headers: h.principal.headers });
}
async function authorize(h) {
  const request = requestFor(h);
  const result = await h.read(() => readPrincipal(request, h.env, 'creator', { account: 'principal' }), 'actual R7 existing principal');
  issuedResults.set(result, request);
  assert.equal(Object.hasOwn(result, 'kind'), false, 'Lifecycle-required remains unqualified; no synthetic completion');
  assert.equal(issuedResults.get(result), request);
  const auth = await h.read(() => continueExperienceAuthorization(request, h.env, result), 'actual R10 continuation');
  assert.equal(auth instanceof Response, false, 'This arrangement must actually authorize under current SQL/policy');
  assert.equal(auth.user, result.user); assert.equal(auth.principal, result.user); assert.equal(auth.impersonation, null);
  issuedAuthorizations.add(auth);
  return auth;
}
const intentFor = output => `00000000-0000-4000-8000-${output === 'image' ? '000000000001' : '000000000002'}`;
async function buildPlan(h, auth, output = 'image', changed = false) {
  assert.ok(issuedAuthorizations.has(auth));
  return h.read(async () => {
    const release = await registeredExperience(output); assert.ok(release);
    const values = initialValues(release);
    if (output === 'image') {
      values.subject = { value: changed ? 'R14 changed private subject' : PRIVATE_MARKER, provenance: 'authored' };
      values.ratio = { value: { width: 3, height: 2 }, provenance: 'authored' };
    } else {
      values.claim = { value: changed ? 'R14 changed claim' : 'R14 five-slide botanical claim', provenance: 'authored' };
      values.evidence = { value: [{ id: 'e3', text: 'Third evidence' }, { id: 'e1', text: 'First evidence' }, { id: 'e2', text: 'Second evidence' }], provenance: 'authored' };
    }
    const validated = await validateIntakeRequest({ intentId: intentFor(output), experienceId: output, releaseHash: release.releaseHash, values });
    assert.ok(validated, 'Actual registered recipe and typed decisions must validate');
    return buildExperiencePlan(auth.user.userId, validated.request, validated.release);
  }, 'actual registered validation and plan builder');
}
function arrangeRetainedDraft(h, auth, plan) {
  assert.ok(issuedAuthorizations.has(auth));
  const content = canonicalJson(plan);
  // Declared pre-existing private row. This does not call or qualify fresh storage.
  h.sql.insert('private_content', { content_id: plan.draftId, owner_id: auth.user.userId, kind: 'experience-draft',
    content, redacted_at: null, expires_at: FUTURE });
  return content;
}
async function retained(h, auth, plan) {
  assert.ok(issuedAuthorizations.has(auth));
  const value = await h.read(() => readDraft(h.env, auth, plan.draftId), 'actual retained draft/hash/custody reader');
  assert.ok(value); assert.deepEqual(value.plan, plan); assert.equal(value.expiresAt, FUTURE);
  issuedDrafts.set(value, auth);
  return value;
}
async function setup(t, output = 'image') {
  const h = fixture(t), auth = await authorize(h), plan = await buildPlan(h, auth, output);
  const content = arrangeRetainedDraft(h, auth, plan), draft = await retained(h, auth, plan);
  assert.equal(draft.content, content);
  return { h, auth, plan: draft.plan, draft };
}
async function commit(h, auth, draft, action = 'commit') {
  assert.equal(issuedDrafts.get(draft), auth, 'Commit receives actual readDraft output and its actual authorization');
  const plan = draft.plan;
  // Same internal call/options as experience-intake-api. No successful guard DTO:
  // the retained SQL predicate and bindings are produced by the actual R10 helper.
  const response = await h.action(() => commitAtomicIntake(h.env, auth,
    { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone(plan.events) }, action,
    { receiptPrefix: receiptPrefix(plan.draftId), clientId: 'web:experience-intake', correlationPrefix: 'experience-intake:',
      guard: retainedGuard(auth, plan, draft.content) }), `actual internal ${action}`);
  assert.ok(response instanceof Response);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await h.action(() => response.json(), 'actual receipt response body');
  return { response, body, plan };
}
function failure(result, status, error) {
  assert.equal(result.response.status, status);
  assert.deepEqual(result.body, { status: 'unknown', projectId: result.plan.projectId, documentId: result.plan.documentId, error });
}
function eventTables(h) {
  return Object.fromEntries(['events', 'event_private_payloads', 'event_client_receipts', 'event_write_stage'].map(table =>
    [table, h.sql.rows(`SELECT * FROM ${table} ORDER BY rowid`)]));
}
function completed(h, auth, draft, result) {
  const { plan } = draft, { body, response } = result;
  assert.equal(response.status, 200); assert.equal(body.status, 'complete');
  assert.equal(body.projectId, plan.projectId); assert.equal(body.documentId, plan.documentId); assert.deepEqual(body.rejected, []);
  assert.equal(body.appended.length, plan.events.length); assert.equal(body.head, plan.events.length);
  const tables = eventTables(h);
  assert.equal(tables.events.length, plan.events.length); assert.equal(tables.event_private_payloads.length, plan.events.length);
  assert.equal(tables.event_client_receipts.length, plan.events.length); assert.deepEqual(tables.event_write_stage, []);
  for (const [index, event] of body.appended.entries()) {
    const source = plan.events[index], row = tables.events.find(row => row.event_id === event.eventId);
    const privateRow = tables.event_private_payloads.find(row => row.private_event_id === event.eventId);
    const receipt = tables.event_client_receipts.find(row => row.client_event_id === source.payload.client_event_id);
    assert.ok(row && privateRow && receipt);
    assert.equal(event.sequence, index + 1); assert.equal(row.sequence, event.sequence);
    assert.equal(event.streamId, auth.user.streamId); assert.equal(event.actor, 'user');
    assert.equal(event.clientId, 'web:experience-intake'); assert.equal(event.correlationId, `experience-intake:${plan.projectId}`);
    assert.equal(event.type, source.type); assert.deepEqual(event.payload, source.payload); assert.equal(event.compensatesEventId, null);
    assert.equal(privateRow.owner_id, auth.user.userId); assert.equal(privateRow.redacted_at, null);
    assert.deepEqual(JSON.parse(privateRow.private_json), source.payload);
    assert.equal(receipt.stream_id, auth.user.streamId); assert.equal(receipt.event_id, event.eventId); assert.equal(receipt.sequence, event.sequence);
    assert.deepEqual(JSON.parse(row.payload), JSON.parse(primitives.eventWriteBindings(event)[12]), 'Actual privacy projection persisted by real trigger');
  }
  assert.equal(new Set(body.appended.map(event => event.eventId)).size, plan.events.length);
  const document = body.appended.find(event => event.type === 'DocumentCreated');
  assert.equal(document.payload.document_id, plan.documentId);
  const route = experienceDocumentRoute(plan);
  assert.equal(new URL(route, 'https://qualification.invalid').pathname.split('/')[2], encodeURIComponent(document.payload.document_id));
  assert.ok(body.appended.some(event => event.type === 'EmptyCanvasChosen'));
  assert.equal(body.appended.filter(event => event.type === 'BlockCreated').length, plan.release.definition.decisions.length + 1);
  return tables;
}
function singleCommittedBatch(h, eventCount) {
  assert.equal(h.sql.state.batchAttempts, 1); assert.equal(h.sql.state.committedBatches, 1); assert.equal(h.sql.state.rolledBackBatches, 0);
  const batch = h.sql.state.batches[0];
  assert.equal(batch.statements.length, eventCount * 2);
  assert.ok(batch.statements.every(statement => statement.changes === 1), 'Counts are returned by each actual SQLite run, not total trigger changes');
}
function rolledBack(h, baseline) {
  assert.equal(h.sql.state.batchAttempts, 1); assert.equal(h.sql.state.committedBatches, 0); assert.equal(h.sql.state.rolledBackBatches, 1);
  assert.deepEqual(h.sql.snapshot(), baseline, 'Full event/private/stage/non-root receipt rollback, including exact baseline rows');
  const batch = h.sql.state.batches[0];
  assert.ok(Object.hasOwn(batch, 'failure'), 'Caught append failure remains independently observed');
  assert.match(String(batch.failure?.message ?? batch.failure), /NOT NULL constraint failed: event_client_receipts.event_id/u);
  assert.deepEqual(h.sql.rows('SELECT * FROM event_write_stage'), []);
}

test('atomic intake: fresh Image and exact-five Slides persist the actual plan/events/private envelopes/receipts', async t => {
  for (const output of ['image', 'slides']) {
    const { h, auth, plan, draft } = await setup(t, output);
    const result = await commit(h, auth, draft);
    completed(h, auth, draft, result); singleCommittedBatch(h, plan.events.length);
    assert.equal(h.sql.state.lostAckThrows, 0);
    const decisions = result.body.appended.filter(event => event.type === 'BlockCreated' && event.payload.properties?.experience_value !== undefined);
    for (const decision of plan.release.definition.decisions) {
      const saved = decisions.find(event => event.payload.properties.experience_binding === decision.bindingSlot);
      assert.ok(saved); assert.deepEqual(saved.payload.properties.experience_value, plan.request.values[decision.id].value);
      assert.equal(saved.payload.properties.experience_release, plan.release.releaseHash);
    }
    if (output === 'image') assert.deepEqual(plan.request.values.ratio.value, { width: 3, height: 2 });
    else {
      assert.equal(plan.release.output.result, '5 slides');
      assert.deepEqual(plan.request.values.evidence.value.map(item => item.id), ['e3', 'e1', 'e2']);
      assert.equal(result.body.appended.find(event => event.payload.handle === 'format/experience-deliverable').payload.properties.text, '5 slides');
    }
    assert.equal(h.sql.rows('SELECT content FROM private_content WHERE content_id=?', plan.draftId)[0].content, draft.content);
  }
});

test('atomic intake: passive check and stable duplicate recover without a replacement append', async t => {
  const { h, auth, plan, draft } = await setup(t), before = h.sql.snapshot();
  failure(await commit(h, auth, draft, 'check'), 409, 'project_intake_unconfirmed');
  assert.equal(h.sql.state.batchAttempts, 0); assert.deepEqual(h.sql.snapshot(), before);
  const original = await commit(h, auth, draft); completed(h, auth, draft, original);
  const committed = h.sql.snapshot();
  for (const action of ['check', 'commit']) {
    const recovered = await commit(h, auth, draft, action);
    assert.equal(recovered.response.status, 200); assert.deepEqual(recovered.body, original.body);
    assert.deepEqual(h.sql.snapshot(), committed);
  }
  singleCommittedBatch(h, plan.events.length);
});

test('atomic intake: changed retained intent under the same identity refuses original replacement', async t => {
  const { h, auth, plan, draft } = await setup(t);
  const original = await commit(h, auth, draft); completed(h, auth, draft, original);
  const currentAuth = await authorize(h), changed = await buildPlan(h, currentAuth, 'image', true);
  assert.equal(changed.draftId, plan.draftId); assert.equal(changed.projectId, plan.projectId); assert.equal(changed.documentId, plan.documentId);
  assert.notEqual(changed.draftHash, plan.draftHash);
  h.sql.mutate('UPDATE private_content SET content=? WHERE content_id=?', canonicalJson(changed), plan.draftId);
  const currentDraft = await retained(h, currentAuth, changed), before = h.sql.snapshot(), attempts = h.sql.state.batchAttempts;
  failure(await commit(h, currentAuth, currentDraft), 409, 'project_intake_original_unavailable');
  assert.equal(h.sql.state.batchAttempts, attempts); assert.deepEqual(h.sql.snapshot(), before);
  assert.deepEqual(eventTables(h).events.map(row => row.event_id), original.body.appended.map(event => event.eventId));
});

test('atomic intake: actual root resource collision rolls back all event/private/non-root receipt writes', async t => {
  const { h, auth, plan, draft } = await setup(t);
  const prior = primitives.makeEvent(auth.user.streamId, 1, 'user', 'fixture:arrangement', 'fixture:collision',
    'ProjectCreated', { project_id: plan.projectId, name: 'Earlier local fixture project', state: 'active' });
  h.sql.stageEvent(prior); // Actual R4 bindings and trigger; explicitly prior fixture arrangement.
  const before = h.sql.snapshot();
  failure(await commit(h, auth, draft), 409, 'project_intake_unconfirmed');
  rolledBack(h, before);
  const batch = h.sql.state.batches[0];
  assert.ok(batch.statements.slice(0, -1).every(statement => statement.changes === 1), 'New events/private bodies and child receipts were actually attempted before root refusal');
  assert.equal(h.sql.rows('SELECT event_id FROM events')[0].event_id, prior.eventId);
});

test('atomic intake: post-COMMIT lost acknowledgement resolves only the real committed original', async t => {
  const { h, auth, plan, draft } = await setup(t);
  h.sql.loseNextCommitAck();
  const result = await commit(h, auth, draft);
  completed(h, auth, draft, result); singleCommittedBatch(h, plan.events.length);
  assert.equal(h.sql.state.lostAckThrows, 1);
  assert.equal(h.sql.state.batches[0].ackError.code, 'FIXTURE_POST_COMMIT_ACK_LOST');
  assert.equal(h.sql.state.reads.filter(row => /SELECT expected.value AS requested_key/u.test(row.sql)).length, 2,
    'Actual initial and post-COMMIT-error original receipt SQL both ran');
  const before = h.sql.snapshot();
  const recovered = await commit(h, auth, draft, 'check');
  assert.deepEqual(recovered.body, result.body); assert.deepEqual(h.sql.snapshot(), before);
  assert.equal(h.sql.state.batchAttempts, 1);
});

test('atomic intake: stale head receives one total attempt without rebasing or replacing', async t => {
  const { h, auth, draft } = await setup(t);
  const concurrent = primitives.makeEvent(auth.user.streamId, 1, 'user', 'fixture:arrangement', 'fixture:head-change',
    'ProjectCreated', { project_id: 'r14-unrelated-project', name: 'Unrelated local fixture project', state: 'active' });
  h.sql.beforeNextBatch({ label: 'Unrelated head change after actual head read', stageEvents: [concurrent] });
  failure(await commit(h, auth, draft), 409, 'project_intake_unconfirmed');
  const batch = h.sql.state.batches[0];
  rolledBack(h, batch.preBatchArrangement.baseline);
  assert.equal(h.sql.state.arrangements.length, 1); assert.equal(batch.preBatchArrangement.applied, true);
  assert.equal(batch.statements[0].changes, 0, 'Actual first stage INSERT sees the changed head');
  assert.equal(h.sql.rows('SELECT event_id FROM events')[0].event_id, concurrent.eventId);
  assert.deepEqual(h.sql.rows('SELECT * FROM event_client_receipts'), []);
});

test('atomic intake: current authority and retained custody are rechecked in the real write transaction', async t => {
  for (const kind of ['authority', 'custody']) {
    const { h, auth, plan, draft } = await setup(t);
    const mutations = kind === 'authority'
      ? [{ sql: 'UPDATE users SET role=? WHERE user_id=?', bindings: ['viewer', auth.user.userId] }]
      : [{ sql: 'INSERT INTO private_content_retention_scopes(content_id) VALUES(?)', bindings: [plan.draftId] }];
    h.sql.beforeNextBatch({ label: `Current ${kind} mutation after original read`, mutations });
    failure(await commit(h, auth, draft), 403, 'project_intake_authority_changed');
    rolledBack(h, h.sql.state.batches[0].preBatchArrangement.baseline);
    assert.equal(h.sql.state.arrangements.length, 1); assert.equal(h.sql.state.batches[0].preBatchArrangement.applied, true);
    assert.deepEqual(h.sql.rows('SELECT * FROM event_client_receipts'), []);
  }
});
