import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual local fresh-intake-join composition. Authored source; owner runs only after review.
// No mixed Runtime/lifecycle/native entry, authority DTO, canned SQL/count/receipt,
// positive guard, seeded target draft or successful storage result is supplied by this harness.
const rootInput = process.env.FORMA_EXPERIENCE_FRESH_INTAKE_JOIN_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_FRESH_INTAKE_JOIN_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-fresh-intake-join-local-sqlite');
const modulePaths = [
  "db/scene-source-generation-tables.ts",
  "db/scene-source-generations.ts",
  "src/experiences/catalog.ts",
  "src/experiences/compiler.ts",
  "src/experiences/contracts.ts",
  "src/experiences/image-ratio.ts",
  "src/experiences/intake.ts",
  "src/experiences/model3d-reference-plan.ts",
  "src/experiences/model3d-reference.ts",
  "src/experiences/scene-context.ts",
  "src/experiences/video-reference-plan.ts",
  "src/experiences/video-reference.ts",
  "src/model/block-types.ts",
  "src/model/generation-execution-evidence.ts",
  "src/model/model3d-view.ts",
  "src/model/output-requirement-events.ts",
  "src/model/presentation-candidates.ts",
  "src/model/project-intake.ts",
  "src/model/provider-submission.ts",
  "src/model/reference-composition-media-url.ts",
  "src/platform/capabilities.ts",
  "worker/access-policy.ts",
  "worker/canvas-governance-policy.ts",
  "worker/event-append.ts",
  "worker/event-privacy.ts",
  "worker/event-read-primitives.ts",
  "worker/event-stream-read.ts",
  "worker/event-write-primitives.ts",
  "worker/experience-intake-body.ts",
  "worker/experience-intake-read.ts",
  "worker/experience-sponsor-admission.ts",
  "worker/experience-sponsor-entitlement.ts",
  "worker/experience-sponsor-intake-classification.ts",
  "worker/experience-sponsor-intake-command.ts",
  "worker/experience-sponsor-intake-read-attempts.ts",
  "worker/experience-sponsor-intake-read-policy.ts",
  "worker/experience-sponsor-intake-read-sql.ts",
  "worker/experience-sponsor-intake-reads.ts",
  "worker/experience-sponsor-policy.ts",
  "worker/image-adapter-evaluation-evidence.ts",
  "worker/intake-authority.ts",
  "worker/memory-document-job-origin-schema.ts",
  "worker/memory-native-boundary.ts",
  "worker/memory-native-origin-schema.ts",
  "worker/output-admission-reads.ts",
  "worker/output-command-core.ts",
  "worker/output-governance-witness.ts",
  "worker/output-proof-capacity-diagnostic.ts",
  "worker/pilot-policy-primitives.ts",
  "worker/policy-version.ts",
  "worker/principal-request-core.ts",
  "worker/private-content-identity.ts",
  "worker/private-content-storage.ts",
  "worker/project-intake-diagnostic.ts",
  "worker/project-intake-read.ts",
  "worker/project-intake.ts",
  "worker/project-request-context.ts",
  "worker/scene-job-source-witness.ts",
  "worker/scene-source-generation.ts",
  "src/model/combined-context.ts",
  "src/model/context-adaptation.ts",
  "src/model/fal-image-identity.ts",
  "src/model/generation-budget.ts",
  "src/model/image-format.ts",
  "src/model/managed-production.ts",
  "src/model/output-execution-policy.ts",
  "src/model/output-fal-image-contract.ts",
  "src/model/output-source-policy.ts",
  "src/model/presentation-count-policy.ts",
  "src/model/presentation-delivery.ts",
  "src/model/presentation-source.ts",
  "src/model/prompt-policy.ts",
  "src/model/replay-development.ts",
  "src/model/video-adapter.ts",
  "worker/experience-sponsor-approval.ts",
  "worker/experience-sponsor-campaign.ts",
  "worker/experience-sponsor-image-evidence.ts",
  "worker/experience-sponsor-image-format.ts",
  "worker/experience-sponsor-resources.ts",
  "worker/fal-image-identity.ts",
  "worker/image-adapter-selection.ts",
  "worker/openai-image-route-contract.ts",
  "worker/openai-text-cost.ts",
  "worker/output-disclosure-proof.ts",
  "worker/output-fal-image-contract.ts",
  "worker/output-image-budget.ts",
  "worker/output-image-slides-preflight.ts",
  "worker/output-read-state.ts",
  "worker/presentation-model-routing.ts",
  "worker/replay-cost.ts",
  "src/model/model3d-assets.ts",
  "src/model/model3d-static-policy.ts",
  "src/model/model3d.ts",
  "src/model/output-audio-contract.ts",
  "src/model/output-model3d-contract.ts",
  "src/model/output-narrative-contract.ts",
  "src/model/output-requirements.ts",
  "src/model/output-scene-contract.ts",
  "src/model/output-storyboard-contract.ts",
  "src/model/output-video-contract.ts",
  "worker/experience-audio-recipe.ts",
  "worker/experience-model3d-recipe.ts",
  "worker/experience-model3d-replacement.ts",
  "worker/experience-narrative-recipe.ts",
  "worker/experience-output-binding.ts",
  "worker/experience-output-recipe.ts",
  "worker/experience-scene-recipe.ts",
  "worker/experience-scene-renewal.ts",
  "worker/experience-sponsor-image-confirmation-native.ts",
  "worker/experience-storyboard-recipe.ts",
  "worker/experience-video-recipe.ts"
];
const fixtureBuiltins = { 'tests/fixtures/fresh-intake-join-sqlite.mjs': ['node:assert/strict', 'node:sqlite'] };
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
  throwFailures(cleanupLoader(), 'Fresh intake join loader exit cleanup failed');
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
let readPrincipal, continueExperienceAuthorization, readDraft, retainedGuard, join, projectIntakeAuthority;
let registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan, receiptPrefix, experienceDocumentRoute;
let canonicalJson, commitAtomicIntake, storePrivateContent, POLICY_VERSION, primitives, createFreshIntakeJoinSqlite;
try {
  // Own guard, hook, after-hook registration and initial imports in one setup.
  process.once('exit', cleanupLoaderAtExit);
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    enumerable: originalFetchDescriptor?.enumerable ?? true,
    value() { forbiddenFetchAttempts++; throw Error('Network forbidden in fresh-intake-join qualification'); },
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
      assert.ok(allowed.has(file), `Unreviewed fresh-intake-join dependency: ${file}`);
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
      assert.ok(entry, `Unreviewed loaded fresh-intake-join source: ${file}`);
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
    throwFailures(errors, 'Fresh intake join loader verification and cleanup failed');
  });
  ({ readExistingPrincipalRequest: readPrincipal } = await load('worker/principal-request-core.ts'));
  ({ continueExperienceAuthorization, readDraft, retainedGuard, join } = await load('worker/experience-intake-read.ts'));
  ({ registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan, receiptPrefix, experienceDocumentRoute } = await load('src/experiences/intake.ts'));
  ({ canonicalJson } = await load('src/experiences/compiler.ts'));
  ({ commitAtomicIntake } = await load('worker/project-intake.ts'));
  ({ projectIntakeAuthority } = await load('worker/intake-authority.ts'));
  ({ storePrivateContent } = await load('worker/private-content-storage.ts'));
  ({ POLICY_VERSION } = await load('worker/policy-version.ts'));
  primitives = await load('worker/event-write-primitives.ts');
  ({ createFreshIntakeJoinSqlite } = await load('tests/fixtures/fresh-intake-join-sqlite.mjs'));
} catch (error) {
  throwFailures(cleanupLoader([error]), 'Fresh intake join loader setup and cleanup failed');
}
// Hooks and the fail-closed fetch guard remain installed throughout actual tests.

const AUTHOR = 'r16-author', EMAIL = 'r16-author@example.test', NAME = 'R16 Author';
const PRIVATE_MARKER = 'R16 private botanical subject';
const issuedResults = new WeakMap(), issuedAuthorizations = new WeakMap(), issuedDrafts = new WeakMap();
function delayResult(milliseconds, value) {
  let timer;
  const promise = new Promise(resolve => { timer = setTimeout(() => resolve(value), milliseconds); });
  return { promise, dispose() { clearTimeout(timer); } };
}
function track(h, work, label) {
  const pending = Promise.resolve().then(work);
  const observed = pending.then(value => ({ kind: 'fulfilled', value }), error => ({ kind: 'rejected', error }));
  h.pending.add(observed); observed.then(() => h.pending.delete(observed));
  const timer = delayResult(5000, { kind: 'timeout' });
  return Promise.race([observed, timer.promise]).then(result => {
    if (result.kind === 'timeout') { h.sql.retire(); throw Error(`Fresh intake join deadline: ${label}`); }
    if (result.kind === 'rejected') throw result.error;
    return result.value;
  }).finally(() => timer.dispose());
}
async function drain(h) {
  const timer = delayResult(5000, false);
  try {
    const complete = await Promise.race([Promise.all([...h.pending]).then(() => true), timer.promise]);
    if (!complete) h.sql.retire();
    return complete;
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
    sql = createFreshIntakeJoinSqlite({ primitives });
    const h = { sql, env: { DB: sql.DB }, pending: new Set() };
    h.action = (work, label = 'actual action') => track(h, work, label);
    h.read = async (work, label = 'actual read') => {
      const before = sql.snapshot(), errors = []; let result;
      try { result = await h.action(work, label); } catch (error) { errors.push(error); }
      try {
        if (!sql.state.retired) assert.deepEqual(sql.snapshot(), before, 'Actual read must not write, replace or repair the joined database');
      } catch (error) { errors.push(error); }
      throwFailures(errors, 'Fresh intake join read and snapshot verification failed');
      return result;
    };
    t.after(async () => {
      const errors = [];
      try { assert.equal(await drain(h), true, 'Timeout retirement is not completed qualification'); }
      catch (error) { errors.push(error); }
      for (const name of ['forbiddenWrites', 'reentrantAttempts', 'lateReadAttempts', 'pendingFaults', 'duplicateFaultArms', 'faultArmRefusals']) {
        try { assert.equal(sql.state[name], 0, `Unexpected fixture observation: ${name}`); } catch (error) { errors.push(error); }
      }
      try {
        assert.ok(sql.state.fixtureMutations.every(item => /^(?:INSERT INTO users\b|UPDATE users\b)/u.test(item.sql.trim())),
          'Fixture arrangement never seeds/copies a target draft, event, private envelope or receipt');
      } catch (error) { errors.push(error); }
      closeOwned(errors); throwFailures(errors, 'Fresh intake join fixture verification and cleanup failed');
    });
    h.principal = sql.seedPrincipal(POLICY_VERSION, { actorId: AUTHOR, email: EMAIL, name: NAME });
    assert.deepEqual(sql.rows('SELECT * FROM private_content'), []);
    assert.deepEqual(sql.rows('SELECT * FROM events'), []);
    assert.deepEqual(sql.rows('SELECT * FROM event_client_receipts'), []);
    assert.deepEqual(sql.rows("SELECT name FROM sqlite_schema WHERE type='table' AND name IN('memory_structured_answer_origins','memory_structured_answer_originals','memory_structured_answer_ledger_revisions','memory_document_job_answer_origins','memory_document_job_origin_dependencies')"), []);
    return h;
  } catch (error) {
    const errors = [error]; closeOwned(errors); throwFailures(errors, 'Fresh intake join setup and cleanup failed');
  }
}
async function authorize(h, phase, draftId) {
  assert.ok(['save', 'commit', 'check'].includes(phase));
  const suffix = phase === 'save' ? '' : `/${encodeURIComponent(draftId)}/${phase === 'check' ? 'receipt' : 'commit'}`;
  const request = new Request(`https://qualification.invalid/api/experiences/drafts${suffix}`, {
    method: phase === 'check' ? 'GET' : 'POST', headers: h.principal.headers,
  }); // Only real Request identity parsing is claimed; no HTTP request is sent.
  const result = await h.read(() => readPrincipal(request, h.env, 'creator', { account: 'principal' }), `actual ${phase} R7 principal`);
  issuedResults.set(result, request);
  assert.equal(Object.hasOwn(result, 'kind'), false, 'Lifecycle-required stays unqualified, never normalized');
  assert.equal(issuedResults.get(result), request);
  const auth = await h.read(() => continueExperienceAuthorization(request, h.env, result), `actual ${phase} continuation`);
  assert.equal(auth instanceof Response, false, 'Current phase must genuinely authorize');
  assert.equal(auth.user, result.user); assert.equal(auth.principal, result.user); assert.equal(auth.impersonation, null);
  issuedAuthorizations.set(auth, { request, result, phase });
  return auth;
}
async function buildPlan(h, auth, output) {
  assert.equal(issuedAuthorizations.get(auth)?.phase, 'save');
  return h.read(async () => {
    const release = await registeredExperience(output); assert.ok(release);
    const values = initialValues(release);
    if (output === 'image') {
      values.subject = { value: PRIVATE_MARKER, provenance: 'authored' };
      values.ratio = { value: { width: 3, height: 2 }, provenance: 'authored' };
    } else {
      values.claim = { value: 'R16 five-slide botanical claim', provenance: 'authored' };
      values.evidence = { value: [{ id: 'e3', text: 'Third evidence' }, { id: 'e1', text: 'First evidence' }, { id: 'e2', text: 'Second evidence' }], provenance: 'authored' };
    }
    const intentId = `00000000-0000-4000-8000-${output === 'image' ? '000000000001' : '000000000002'}`;
    const validated = await validateIntakeRequest({ intentId, experienceId: output, releaseHash: release.releaseHash, values });
    assert.ok(validated);
    return buildExperiencePlan(auth.user.userId, validated.request, validated.release);
  }, 'actual registered validator/compiler/plan');
}
// Pinned literal composition from the actual endpoint save branch. The endpoint
// itself, its body/origin parsing and prepared/error response wrappers do not run.
const DAILY_LIMIT_SQL = `(SELECT COUNT(*) FROM private_content WHERE owner_id=? AND kind='experience-draft' AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))<50`;
async function store(h, auth, plan) {
  assert.equal(issuedAuthorizations.get(auth)?.phase, 'save');
  assert.equal(row(h, plan.draftId), null, 'Only the actual fresh store may create this target draft');
  const guard = join(projectIntakeAuthority(h.env, auth, plan), { sql: DAILY_LIMIT_SQL, bindings: [auth.user.userId] });
  return h.action(() => storePrivateContent(h.env, auth.user.userId, 'experience-draft', canonicalJson(plan),
    undefined, guard, undefined, { contentId: plan.draftId }), 'actual fresh private store');
}
function row(h, draftId) { return h.sql.rows('SELECT * FROM private_content WHERE content_id=?', draftId)[0] ?? null; }
function eventTables(h) {
  return Object.fromEntries(['events', 'event_private_payloads', 'event_client_receipts', 'event_write_stage'].map(table =>
    [table, h.sql.rows(`SELECT * FROM ${table} ORDER BY rowid`)]));
}
async function retained(h, auth, plan) {
  assert.ok(issuedAuthorizations.has(auth));
  const draft = await h.read(() => readDraft(h.env, auth, plan.draftId), 'actual stored draft identity/hash/custody read');
  assert.ok(draft); assert.deepEqual(draft.plan, plan); assert.equal(draft.content, canonicalJson(plan));
  const saved = row(h, plan.draftId); assert.ok(saved);
  assert.equal(saved.owner_id, auth.user.userId); assert.equal(saved.kind, 'experience-draft'); assert.equal(saved.redacted_at, null);
  assert.equal(saved.content, draft.content); assert.equal(saved.expires_at, draft.expiresAt);
  assert.equal(Date.parse(saved.expires_at) - Date.parse(saved.created_at), 30 * 86_400_000);
  issuedDrafts.set(draft, auth);
  return draft;
}
async function setup(t, output = 'image') {
  const h = fixture(t), auth = await authorize(h, 'save'), plan = await buildPlan(h, auth, output);
  assert.equal(row(h, plan.draftId), null); assert.deepEqual(eventTables(h).events, []);
  return { h, auth, plan };
}
async function commitPhase(h, saveAuth, plan, action = 'commit') {
  const auth = await authorize(h, action, plan.draftId);
  assert.notEqual(auth, saveAuth); assert.notEqual(issuedAuthorizations.get(auth).request, issuedAuthorizations.get(saveAuth).request);
  const draft = await retained(h, auth, plan);
  // Current registration/review comparisons follow the selected endpoint source
  // with genuine retained/compiler values, not fabricated authority or HTTP.
  if (action === 'commit') {
    assert.equal(draft.plan.draftHash, plan.draftHash);
    const release = await h.read(() => registeredExperience(draft.plan.request.experienceId), 'actual current registered release');
    assert.ok(release); assert.equal(release.releaseHash, draft.plan.release.releaseHash);
  }
  return { auth, draft, action };
}
async function commit(h, phase) {
  const { auth, draft, action } = phase, plan = draft.plan;
  assert.equal(issuedDrafts.get(draft), auth); assert.equal(issuedAuthorizations.get(auth).phase, action);
  const response = await h.action(() => commitAtomicIntake(h.env, auth,
    { projectId: plan.projectId, documentId: plan.documentId, events: structuredClone(plan.events) }, action,
    { receiptPrefix: receiptPrefix(plan.draftId), clientId: 'web:experience-intake', correlationPrefix: 'experience-intake:',
      guard: retainedGuard(auth, plan, draft.content) }), `actual atomic intake ${action}`);
  assert.ok(response instanceof Response); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await h.action(() => response.json(), 'actual original receipt Response body');
  return { response, body };
}
function complete(h, phase, result) {
  const { auth, draft } = phase, plan = draft.plan, { response, body } = result;
  assert.equal(response.status, 200); assert.equal(body.status, 'complete');
  assert.equal(body.projectId, plan.projectId); assert.equal(body.documentId, plan.documentId); assert.deepEqual(body.rejected, []);
  assert.equal(body.appended.length, plan.events.length); assert.equal(body.head, plan.events.length);
  const tables = eventTables(h);
  assert.equal(tables.events.length, plan.events.length); assert.equal(tables.event_private_payloads.length, plan.events.length);
  assert.equal(tables.event_client_receipts.length, plan.events.length); assert.deepEqual(tables.event_write_stage, []);
  for (const [index, event] of body.appended.entries()) {
    const expected = plan.events[index], saved = tables.events.find(row => row.event_id === event.eventId);
    const privateRow = tables.event_private_payloads.find(row => row.private_event_id === event.eventId);
    const receipt = tables.event_client_receipts.find(row => row.client_event_id === expected.payload.client_event_id);
    assert.ok(saved && privateRow && receipt);
    assert.equal(event.sequence, index + 1); assert.equal(saved.sequence, event.sequence);
    assert.equal(event.streamId, auth.user.streamId); assert.equal(event.actor, 'user');
    assert.equal(event.clientId, 'web:experience-intake'); assert.equal(event.correlationId, `experience-intake:${plan.projectId}`);
    assert.equal(event.type, expected.type); assert.deepEqual(event.payload, expected.payload); assert.equal(event.compensatesEventId, null);
    assert.equal(privateRow.owner_id, auth.user.userId); assert.equal(privateRow.redacted_at, null);
    assert.deepEqual(JSON.parse(privateRow.private_json), expected.payload);
    assert.equal(receipt.event_id, event.eventId); assert.equal(receipt.stream_id, auth.user.streamId); assert.equal(receipt.sequence, event.sequence);
    assert.deepEqual(JSON.parse(saved.payload), JSON.parse(primitives.eventWriteBindings(event)[12]));
  }
  assert.equal(new Set(body.appended.map(event => event.eventId)).size, plan.events.length);
  const document = body.appended.find(event => event.type === 'DocumentCreated');
  assert.equal(document.payload.document_id, plan.documentId);
  assert.equal(new URL(experienceDocumentRoute(plan), 'https://qualification.invalid').pathname.split('/')[2], encodeURIComponent(document.payload.document_id));
  assert.ok(body.appended.some(event => event.type === 'EmptyCanvasChosen'));
}
function counts(h, { intakeCommits = 1, intakeRollbacks = 0, storageAck = 0, intakeAck = 0 } = {}) {
  assert.deepEqual(h.sql.state.perFamily.storage, { attempts: 1, commits: 1, rollbacks: 0, lostAckThrows: storageAck });
  assert.deepEqual(h.sql.state.perFamily.intake, { attempts: 1, commits: intakeCommits, rollbacks: intakeRollbacks, lostAckThrows: intakeAck });
  assert.equal(h.sql.state.batchAttempts, 2);
  assert.deepEqual(h.sql.state.batches.map(batch => [batch.family, batch.familyOrdinal]), [['storage', 1], ['intake', 1]]);
  assert.deepEqual(h.sql.state.batches[0].statements.map(statement => statement.changes), [1, 0], 'Ordinary cleanup ran under real absence, with no eligible history');
  assert.equal(h.sql.state.reads.filter(item => / AS schema_json/u.test(item.sql)).length, 2, 'Actual storage-owned dynamic schema readers both ran');
  assert.equal(h.sql.state.batches[0].statements[1].bindings.filter(value => value === '[]').length, 2,
    'Actual cleanup binds both witnessed empty-schema records');
}
function consumedFault(h, kind, family) {
  assert.equal(h.sql.state.faults.length, 1); assert.equal(h.sql.state.pendingFaults, 0);
  const fault = h.sql.state.faults[0];
  assert.equal(fault.kind, kind); assert.equal(fault.family, family); assert.equal(fault.ordinal, 1);
  assert.equal(fault.matched, true); assert.equal(fault.consumed, true); assert.equal(fault.failed, false);
  assert.equal(fault.matchAttempt, family === 'storage' ? 1 : 2);
  assert.equal(fault[kind === 'ack' ? 'fired' : 'applied'], true);
}

test('fresh-intake-join: actual fresh Image and Slides storage precedes a separately authorized Document commit', async t => {
  for (const output of ['image', 'slides']) {
    const { h, auth, plan } = await setup(t, output);
    const stored = await store(h, auth, plan), saved = await retained(h, auth, plan);
    assert.equal(stored.contentId, plan.draftId); assert.equal(stored.expiresAt, saved.expiresAt);
    const originalRow = row(h, plan.draftId); assert.deepEqual(eventTables(h).events, []);
    assert.equal(h.sql.state.perFamily.intake.attempts, 0);
    const phase = await commitPhase(h, auth, plan), result = await commit(h, phase);
    complete(h, phase, result); counts(h);
    assert.equal(h.sql.state.batches[1].statements.length, 2 * plan.events.length);
    assert.ok(h.sql.state.batches[1].statements.every(statement => statement.changes === 1));
    assert.deepEqual(row(h, plan.draftId), originalRow); assert.equal(h.sql.state.faults.length, 0);
    if (output === 'image') assert.deepEqual(plan.request.values.ratio.value, { width: 3, height: 2 });
    else {
      assert.equal(plan.release.output.result, '5 slides');
      assert.deepEqual(plan.request.values.evidence.value.map(item => item.id), ['e3', 'e1', 'e2']);
      assert.equal(result.body.appended.find(event => event.payload.handle === 'format/experience-deliverable').payload.properties.text, '5 slides');
    }
  }
});

test('fresh-intake-join: committed storage ACK loss recovers the actual retained draft before event commit', async t => {
  const { h, auth, plan } = await setup(t);
  h.sql.loseCommitAck({ family: 'storage', ordinal: 1 });
  let failure;
  try { await store(h, auth, plan); } catch (error) { failure = error; }
  assert.ok(failure instanceof Error); assert.equal(failure.code, 'FIXTURE_FRESH_INTAKE_JOIN_STORAGE_POST_COMMIT_ACK_LOST');
  assert.equal(h.sql.state.perFamily.storage.attempts, 1); assert.equal(h.sql.state.perFamily.intake.attempts, 0);
  const saved = await retained(h, auth, plan), originalRow = row(h, plan.draftId);
  assert.equal(saved.content, canonicalJson(plan)); assert.deepEqual(eventTables(h).events, []);
  const phase = await commitPhase(h, auth, plan), result = await commit(h, phase);
  complete(h, phase, result); counts(h, { storageAck: 1 }); consumedFault(h, 'ack', 'storage');
  assert.deepEqual(row(h, plan.draftId), originalRow);
});

test('fresh-intake-join: event ACK loss preserves one original through freshly authorized check and duplicate commit', async t => {
  const { h, auth, plan } = await setup(t);
  await store(h, auth, plan); await retained(h, auth, plan); const originalRow = row(h, plan.draftId);
  const phase = await commitPhase(h, auth, plan);
  h.sql.loseCommitAck({ family: 'intake', ordinal: 1 });
  const result = await commit(h, phase); complete(h, phase, result);
  counts(h, { intakeAck: 1 }); consumedFault(h, 'ack', 'intake');
  const before = h.sql.snapshot();
  for (const action of ['check', 'commit']) {
    const recoveryPhase = await commitPhase(h, auth, plan, action);
    assert.notEqual(issuedAuthorizations.get(recoveryPhase.auth).request, issuedAuthorizations.get(phase.auth).request);
    const recovered = await commit(h, recoveryPhase);
    assert.equal(recovered.response.status, 200); assert.deepEqual(recovered.body, result.body); assert.deepEqual(h.sql.snapshot(), before);
  }
  counts(h, { intakeAck: 1 }); assert.deepEqual(row(h, plan.draftId), originalRow);
});

test('fresh-intake-join: event-boundary authority drift rolls back only intake and preserves the freshly saved draft', async t => {
  const { h, auth, plan } = await setup(t);
  await store(h, auth, plan); await retained(h, auth, plan); const originalRow = row(h, plan.draftId);
  const phase = await commitPhase(h, auth, plan);
  h.sql.beforeBatch({ family: 'intake', ordinal: 1, label: 'Creator role changes after original/head reads',
    mutations: [{ sql: 'UPDATE users SET role=? WHERE user_id=?', bindings: ['viewer', auth.user.userId] }] });
  const result = await commit(h, phase);
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.body, { status: 'unknown', projectId: plan.projectId, documentId: plan.documentId, error: 'project_intake_authority_changed' });
  counts(h, { intakeCommits: 0, intakeRollbacks: 1 }); consumedFault(h, 'before', 'intake');
  const batch = h.sql.state.batches[1];
  assert.match(batch.failure?.message, /NOT NULL constraint failed: event_client_receipts.event_id/u);
  assert.deepEqual(h.sql.snapshot(), batch.preBatchArrangement.baseline);
  assert.deepEqual(row(h, plan.draftId), originalRow);
  for (const rows of Object.values(eventTables(h))) assert.deepEqual(rows, []);
  assert.equal(h.sql.rows('SELECT role FROM users WHERE user_id=?', auth.user.userId)[0].role, 'viewer');
});
