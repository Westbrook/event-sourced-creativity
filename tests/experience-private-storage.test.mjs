import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual local private-storage composition. Authored source; owner runs only after review.
// No mixed Runtime/lifecycle/native entry, authority DTO, canned SQL/count/receipt,
// positive guard or successful storage result is supplied by this harness.
const rootInput = process.env.FORMA_EXPERIENCE_PRIVATE_STORAGE_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_PRIVATE_STORAGE_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-private-storage-local-sqlite');
const modulePaths = [
  "src/experiences/video-reference.ts",
  "src/experiences/contracts.ts",
  "src/experiences/video-reference-plan.ts",
  "src/experiences/scene-context.ts",
  "src/experiences/model3d-reference.ts",
  "src/experiences/model3d-reference-plan.ts",
  "worker/output-proof-capacity-diagnostic.ts",
  "worker/scene-source-generation.ts",
  "worker/scene-job-source-witness.ts",
  "src/model/reference-composition-media-url.ts",
  "src/model/model3d-view.ts",
  "db/scene-source-generation-tables.ts",
  "db/scene-source-generations.ts",
  "src/experiences/catalog.ts",
  "src/experiences/compiler.ts",
  "src/experiences/image-ratio.ts",
  "src/experiences/intake.ts",
  "src/model/generation-execution-evidence.ts",
  "src/model/output-requirement-events.ts",
  "src/model/presentation-candidates.ts",
  "src/model/provider-submission.ts",
  "src/platform/capabilities.ts",
  "worker/access-policy.ts",
  "worker/canvas-governance-policy.ts",
  "worker/event-privacy.ts",
  "worker/event-write-primitives.ts",
  "worker/experience-intake-read.ts",
  "worker/image-adapter-evaluation-evidence.ts",
  "worker/intake-authority.ts",
  "worker/memory-document-job-origin-schema.ts",
  "worker/memory-native-boundary.ts",
  "worker/memory-native-origin-schema.ts",
  "worker/output-admission-reads.ts",
  "worker/output-command-core.ts",
  "worker/output-governance-witness.ts",
  "worker/pilot-policy-primitives.ts",
  "worker/policy-version.ts",
  "worker/principal-request-core.ts",
  "worker/private-content-identity.ts",
  "worker/private-content-storage.ts",
  "worker/project-request-context.ts"
];
const fixtureBuiltins = { 'tests/fixtures/private-storage-sqlite.mjs': ['node:assert/strict', 'node:sqlite'] };
assert.deepEqual(manifest.modules.map(entry => entry.path).sort(), [...modulePaths].sort());
assert.deepEqual(manifest.fixtures.map(entry => entry.path).sort(), Object.keys(fixtureBuiltins));
assert.equal(Object.hasOwn(manifest, 'extensionlessEdges'), false, 'This actual closure has explicit .ts edges only');
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
  throwFailures(cleanupLoader(), 'Private storage loader exit cleanup failed');
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
let readPrincipal, continueExperienceAuthorization, readDraft, join, projectIntakeAuthority;
let registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan, canonicalJson;
let storePrivateContent, nativeStructuredOriginSchema, nativeDocumentJobOriginSchema, nativeMemoryFingerprint;
let POLICY_VERSION, createPrivateStorageSqlite;
try {
  // Own guard, hook, after-hook registration and initial imports in one setup.
  process.once('exit', cleanupLoaderAtExit);
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    enumerable: originalFetchDescriptor?.enumerable ?? true,
    value() { forbiddenFetchAttempts++; throw Error('Network forbidden in private-storage qualification'); },
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
      const file = specifier.startsWith('file:') ? exactFile(specifier)
        : realpathSync(resolve(dirname(fileURLToPath(context.parentURL)), specifier));
      assert.ok(allowed.has(file), `Unreviewed private-storage dependency: ${file}`);
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
      assert.ok(entry, `Unreviewed loaded private-storage source: ${file}`);
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
    throwFailures(errors, 'Private storage loader verification and cleanup failed');
  });
  ({ readExistingPrincipalRequest: readPrincipal } = await load('worker/principal-request-core.ts'));
  ({ continueExperienceAuthorization, readDraft, join } = await load('worker/experience-intake-read.ts'));
  ({ projectIntakeAuthority } = await load('worker/intake-authority.ts'));
  ({ registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan } = await load('src/experiences/intake.ts'));
  ({ canonicalJson } = await load('src/experiences/compiler.ts'));
  ({ storePrivateContent } = await load('worker/private-content-storage.ts'));
  ({ nativeStructuredOriginSchema, nativeMemoryFingerprint } = await load('worker/memory-native-origin-schema.ts'));
  ({ nativeDocumentJobOriginSchema } = await load('worker/memory-document-job-origin-schema.ts'));
  ({ POLICY_VERSION } = await load('worker/policy-version.ts'));
  ({ createPrivateStorageSqlite } = await load('tests/fixtures/private-storage-sqlite.mjs'));
} catch (error) {
  throwFailures(cleanupLoader([error]), 'Private storage loader setup and cleanup failed');
}
// Hooks and the fail-closed fetch guard remain installed throughout actual tests.

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const AUTHOR = 'r15-author', EMAIL = 'r15-author@example.test', NAME = 'R15 Author';
const PRIVATE_MARKER = 'R15 private authored botanical subject';
const issuedResults = new WeakMap(), issuedAuthorizations = new WeakSet();

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
    if (result.kind === 'timeout') { h.sql.retire(); throw Error(`Private storage fixture deadline: ${label}`); }
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
function fixture(t, schema = 'absent') {
  let sql;
  function closeOwned(errors) {
    for (const action of [() => sql?.retire(), () => sql?.close()]) {
      try { action(); } catch (error) { errors.push(error); }
    }
  }
  try {
    sql = createPrivateStorageSqlite({ schema });
    const h = { sql, env: { DB: sql.DB }, pending: new Set() };
    h.action = (work, label = 'actual action') => track(h, work, label);
    h.read = async (work, label = 'actual read') => {
      const before = sql.snapshot(), errors = [];
      let value;
      try { value = await h.action(work, label); } catch (error) { errors.push(error); }
      try {
        if (!sql.state.retired) assert.deepEqual(sql.snapshot(), before, 'The actual reader must not write, repair or replace');
      } catch (error) { errors.push(error); }
      throwFailures(errors, 'Private storage read and snapshot check failed');
      return value;
    };
    t.after(async () => {
      const errors = [];
      try { assert.equal(await drain(h), true, 'Retirement is containment, not a completed operation'); }
      catch (error) { errors.push(error); }
      for (const [name, message] of [
        ['forbiddenWrites', 'No production write outside the exact private insert/cleanup batch'],
        ['reentrantAttempts', 'No reentrant fixture connection access'],
        ['lateReadAttempts', 'No production access after retirement'],
      ]) {
        try { assert.equal(sql.state[name], 0, message); } catch (error) { errors.push(error); }
      }
      closeOwned(errors);
      throwFailures(errors, 'Private storage fixture verification and cleanup failed');
    });
    h.principal = sql.seedPrincipal(POLICY_VERSION, { actorId: AUTHOR, email: EMAIL, name: NAME });
    return h;
  } catch (error) {
    const errors = [error]; closeOwned(errors);
    throwFailures(errors, 'Private storage fixture setup and cleanup failed');
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
      values.subject = { value: changed ? 'R15 changed private subject' : PRIVATE_MARKER, provenance: 'authored' };
      values.ratio = { value: { width: 3, height: 2 }, provenance: 'authored' };
    } else {
      values.claim = { value: changed ? 'R15 changed claim' : 'R15 five-slide botanical claim', provenance: 'authored' };
      values.evidence = { value: [{ id: 'e3', text: 'Third evidence' }, { id: 'e1', text: 'First evidence' }, { id: 'e2', text: 'Second evidence' }], provenance: 'authored' };
    }
    const validated = await validateIntakeRequest({ intentId: intentFor(output), experienceId: output, releaseHash: release.releaseHash, values });
    assert.ok(validated, 'Actual registered recipe and typed decisions must validate');
    return buildExperiencePlan(auth.user.userId, validated.request, validated.release);
  }, 'actual registered validation and plan builder');
}

// Exact inline expression and binding composition selected from the canonical
// experience-intake-api.ts:48. This is a disclosed fixture composition seam,
// not an exported endpoint/helper or proof that its HTTP handler ran.
const DAILY_LIMIT_SQL = `(SELECT COUNT(*) FROM private_content WHERE owner_id=? AND kind='experience-draft' AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day'))<50`;
function storageGuard(h, auth, plan) {
  assert.ok(issuedAuthorizations.has(auth));
  const authority = projectIntakeAuthority(h.env, auth, plan);
  const storageLimit = { sql: DAILY_LIMIT_SQL, bindings: [auth.user.userId] };
  return join(authority, storageLimit); // Both real SQL predicates run in the actual identity insert.
}
async function save(h, auth, plan) {
  assert.ok(issuedAuthorizations.has(auth));
  const content = canonicalJson(plan), guard = storageGuard(h, auth, plan);
  return h.action(() => storePrivateContent(h.env, auth.user.userId, 'experience-draft', content,
    undefined, guard, undefined, { contentId: plan.draftId }), 'actual fresh private store');
}
async function retained(h, auth, id) {
  assert.ok(issuedAuthorizations.has(auth));
  return h.read(() => readDraft(h.env, auth, id), 'actual retained private draft');
}
function row(h, id) { return h.sql.rows('SELECT * FROM private_content WHERE content_id=?', id)[0] ?? null; }
function registryRows(h) {
  return h.sql.rows("SELECT name FROM sqlite_schema WHERE type='table' AND name IN('memory_structured_answer_origins','memory_structured_answer_originals','memory_structured_answer_ledger_revisions','memory_document_job_answer_origins','memory_document_job_origin_dependencies') ORDER BY name");
}
const schemaReads = h => h.sql.state.reads.filter(item => / AS schema_json/u.test(item.sql));
async function schemaEvidence(h, present) {
  const before = schemaReads(h).length;
  const structured = await h.read(() => nativeStructuredOriginSchema(h.env), 'actual structured schema evidence');
  const documentJob = await h.read(() => nativeDocumentJobOriginSchema(h.env), 'actual document-job schema evidence');
  assert.equal(schemaReads(h).length - before, 2);
  assert.equal(structured.present, present); assert.equal(documentJob.present, present);
  const hashes = ['ff2850772729b5650c41f4eda69cef6a6e3f2944782d0c9e5b5c1ffd5616d30c',
    '1478ba9179bae3863d36aff46ed6dd073de0d0f7dd3d189711af1e13627b93e8'];
  for (const [index, evidence] of [structured, documentJob].entries()) {
    assert.match(evidence.guard.condition, / IS \?$/u);
    assert.equal(evidence.guard.bindings.length, 1);
    const schema = JSON.parse(evidence.guard.bindings[0]);
    assert.equal(schema.length, present ? [34, 16][index] : 0);
    if (present) assert.equal(await h.read(() => nativeMemoryFingerprint(schema), 'actual returned schema fingerprint'), hashes[index]);
    else assert.equal(evidence.guard.bindings[0], '[]', 'Real witnessed absence, not an unavailable-schema catch');
  }
  assert.equal(registryRows(h).length, present ? 5 : 0);
  return { structured, documentJob };
}
function scopedContent(h, id) {
  h.sql.insert('project_resource_scopes', { project_access_id: 'r15-fixture-access', resource_kind: 'content', resource_id: id,
    organization_id: 'r15-fixture-organization', project_id: 'r15-fixture-project', owner_user_id: AUTHOR,
    visibility: 'actor_private', source_event_id: null, actor_user_id: AUTHOR, created_at: PAST });
}
function cleanupHistory(h) {
  const items = [
    { content_id: 'r15-expired-ordinary', owner_id: AUTHOR, kind: 'prompt', expires_at: PAST },
    { content_id: 'r15-live-ordinary', owner_id: AUTHOR, kind: 'prompt', expires_at: FUTURE },
    { content_id: 'r15-other-owner', owner_id: 'r15-other', kind: 'prompt', expires_at: PAST },
    { content_id: 'r15-scoped-expired', owner_id: AUTHOR, kind: 'prompt', expires_at: PAST },
    { content_id: 'r15-durable-expired', owner_id: AUTHOR, kind: 'document-artifact', expires_at: PAST },
  ];
  for (const item of items) h.sql.insert('private_content', { ...item, content: `Owned local history ${item.content_id}`, created_at: PAST, redacted_at: null });
  scopedContent(h, 'r15-scoped-expired');
  return Object.fromEntries(items.map(item => [item.content_id, row(h, item.content_id)]));
}
function cleanupOnlyExpected(h, history, createdAt) {
  for (const [id, before] of Object.entries(history)) {
    const after = row(h, id);
    const expected = id === 'r15-expired-ordinary'
      ? Object.assign(Object.create(Object.getPrototypeOf(before)), before, { content: '', redacted_at: createdAt }) : before;
    assert.deepEqual(after, expected,
      `Actual ordinary cleanup and unchanged sentinel: ${id}`);
  }
}
async function setup(t, { output = 'image', schema = 'absent' } = {}) {
  const h = fixture(t, schema), auth = await authorize(h), plan = await buildPlan(h, auth, output);
  return { h, auth, plan };
}
async function savedOriginal(h, auth, plan, stored) {
  assert.equal(stored.contentId, plan.draftId);
  const saved = row(h, plan.draftId); assert.ok(saved);
  assert.equal(saved.owner_id, auth.user.userId); assert.equal(saved.kind, 'experience-draft');
  assert.equal(saved.content, canonicalJson(plan)); assert.equal(saved.redacted_at, null);
  assert.equal(saved.expires_at, stored.expiresAt);
  assert.equal(Date.parse(saved.expires_at) - Date.parse(saved.created_at), 30 * 86_400_000,
    'Actual creation clock plus default thirty-day retention, not a patched Date');
  const read = await retained(h, auth, plan.draftId); assert.ok(read);
  assert.deepEqual(read.plan, plan); assert.equal(read.content, saved.content); assert.equal(read.expiresAt, saved.expires_at);
  return { row: saved, read };
}
function oneCommitted(h, cleanupChanges = 1) {
  assert.equal(h.sql.state.readBatches, 1, 'The exact schema observations share one read-only batch');
  assert.equal(h.sql.state.batchAttempts, 1); assert.equal(h.sql.state.committedBatches, 1); assert.equal(h.sql.state.rolledBackBatches, 0);
  assert.deepEqual(h.sql.state.batches[0].statements.map(item => item.changes), [1, cleanupChanges]);
}

test('private-storage: failed schema read batch writes nothing and cannot consume the later lost-write ACK',async t=>{
  const {h,auth,plan}=await setup(t),before=h.sql.snapshot();h.sql.loseNextCommitAck();
  const db=h.sql.DB;
  await assert.rejects(db.batch([
    db.prepare('SELECT (SELECT json_group_array(name) FROM sqlite_schema) AS schema_json'),
    db.prepare('SELECT (SELECT json_group_array(name) FROM sqlite_schema) AS schema_json'),
    db.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='memory_native_answer_origins') AS origins INVALID SQL"),
  ]));
  assert.deepEqual(h.sql.snapshot(),before);assert.equal(h.sql.state.batchAttempts,0);assert.equal(h.sql.state.lostAckThrows,0);
  await rejectedSave(h,auth,plan,/acknowledgement lost/u);
  assert.equal(h.sql.state.committedBatches,1);assert.equal(h.sql.state.lostAckThrows,1);
  assert.ok(row(h,plan.draftId),'Only the actual later save commits before losing its ACK');
});
async function rejectedSave(h, auth, plan, message) {
  let value;
  try { await save(h, auth, plan); } catch (error) { value = error; }
  assert.ok(value instanceof Error, 'An actual failed store must not manufacture success');
  assert.match(value.message, message);
  return value;
}
function quotaHistory(h, count) {
  // Declared synthetic counted history, not validated plan/draft fixtures. Real
  // SQLite clock positions all rows safely inside the inline last-day window.
  for (let index = 0; index < count; index++) {
    h.sql.mutate("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,'experience-draft',?,strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'),?,NULL)",
      `r15-quota-${index}`, AUTHOR, 'Synthetic quota history', FUTURE);
  }
}

test('private-storage: absent additive schemas save actual Image and Slides drafts and perform ordinary cleanup', async t => {
  for (const output of ['image', 'slides']) {
    const { h, auth, plan } = await setup(t, { output }), history = cleanupHistory(h);
    await schemaEvidence(h, false);
    const beforeSchemaReads = schemaReads(h).length, eventsBefore = h.sql.rows('SELECT * FROM events ORDER BY rowid');
    const stored = await save(h, auth, plan), original = await savedOriginal(h, auth, plan, stored);
    assert.equal(schemaReads(h).length - beforeSchemaReads, 2, 'Store performs its own real dynamic schema reads');
    oneCommitted(h); cleanupOnlyExpected(h, history, original.row.created_at);
    assert.deepEqual(h.sql.rows('SELECT * FROM events ORDER BY rowid'), eventsBefore);
    assert.equal(h.sql.state.lostAckThrows, 0);
  }
});

test('private-storage: exact-present empty canonical registries retain fingerprints and join actual store cleanup', async t => {
  for (const output of ['image', 'slides']) {
    const { h, auth, plan } = await setup(t, { output, schema: 'exact-present' }), history = cleanupHistory(h);
    const direct = await schemaEvidence(h, true), beforeSchemaReads = schemaReads(h).length;
    const before = h.sql.snapshot();
    const stored = await save(h, auth, plan), original = await savedOriginal(h, auth, plan, stored);
    assert.equal(schemaReads(h).length - beforeSchemaReads, 2, 'Direct evidence did not replace the store own-schema join');
    oneCommitted(h); cleanupOnlyExpected(h, history, original.row.created_at);
    const after = h.sql.snapshot(); assert.deepEqual(after.schema, before.schema);
    for (const registry of registryRows(h)) assert.deepEqual(h.sql.rows(`SELECT * FROM ${registry.name}`), []);
    const actualCleanup = h.sql.state.batches[0].statements[1];
    assert.ok(actualCleanup.bindings.includes(direct.structured.guard.bindings[0]));
    assert.ok(actualCleanup.bindings.includes(direct.documentJob.guard.bindings[0]));
    assert.deepEqual(h.sql.rows('SELECT * FROM events ORDER BY rowid'), before.rows.events);
  }
});

test('private-storage: duplicate and changed intent preserve the exact stored original and lifetime', async t => {
  const { h, auth, plan } = await setup(t), history = cleanupHistory(h);
  const stored = await save(h, auth, plan), original = await savedOriginal(h, auth, plan, stored);
  cleanupOnlyExpected(h, history, original.row.created_at);
  const before = h.sql.snapshot();
  for (const changed of [false, true]) {
    const candidate = await buildPlan(h, auth, 'image', changed);
    assert.equal(candidate.draftId, plan.draftId);
    if (changed) { assert.notEqual(candidate.draftHash, plan.draftHash); assert.notEqual(canonicalJson(candidate), original.row.content); }
    else assert.deepEqual(candidate, plan);
    await rejectedSave(h, auth, candidate, /UNIQUE constraint failed: private_content.content_id/u);
    assert.deepEqual(h.sql.snapshot(), before);
    const recovered = await retained(h, auth, candidate.draftId);
    assert.deepEqual(recovered, original.read, 'Actual retained original, never replacement or renewed expiry');
  }
  assert.equal(h.sql.state.batchAttempts, 3); assert.equal(h.sql.state.committedBatches, 1); assert.equal(h.sql.state.rolledBackBatches, 2);
});

test('private-storage: actual current authority and exact forty-nine/fifty daily quota control insertion', async t => {
  const denied = await setup(t); cleanupHistory(denied.h);
  denied.h.sql.mutate('UPDATE users SET role=? WHERE user_id=?', 'viewer', denied.auth.user.userId);
  const deniedBefore = denied.h.sql.snapshot();
  const authError = await rejectedSave(denied.h, denied.auth, denied.plan, /^project_private_content_access_revoked$/u);
  assert.match(authError.cause?.message, /NOT NULL constraint failed: private_content.content/u);
  assert.deepEqual(denied.h.sql.snapshot(), deniedBefore); assert.equal(row(denied.h, denied.plan.draftId), null);
  assert.equal(denied.h.sql.state.batchAttempts, 1); assert.equal(denied.h.sql.state.committedBatches, 0); assert.equal(denied.h.sql.state.rolledBackBatches, 1);
  for (const count of [49, 50]) {
    const { h, auth, plan } = await setup(t), history = cleanupHistory(h); quotaHistory(h, count);
    const before = h.sql.snapshot();
    if (count === 49) {
      const stored = await save(h, auth, plan), original = await savedOriginal(h, auth, plan, stored);
      oneCommitted(h); cleanupOnlyExpected(h, history, original.row.created_at);
      assert.equal(h.sql.rows("SELECT COUNT(*) AS total FROM private_content WHERE owner_id=? AND kind='experience-draft'", AUTHOR)[0].total, 50);
    } else {
      const error = await rejectedSave(h, auth, plan, /^project_private_content_access_revoked$/u);
      assert.match(error.cause?.message, /NOT NULL constraint failed: private_content.content/u);
      assert.deepEqual(h.sql.snapshot(), before); assert.equal(await retained(h, auth, plan.draftId), null);
      assert.equal(h.sql.state.batchAttempts, 1); assert.equal(h.sql.state.committedBatches, 0); assert.equal(h.sql.state.rolledBackBatches, 1);
    }
  }
});

test('private-storage: actual later cleanup UPDATE failure rolls back the earlier fresh insert', async t => {
  const { h, auth, plan } = await setup(t); cleanupHistory(h);
  h.sql.armCleanupFailure('r15-expired-ordinary');
  const before = h.sql.snapshot();
  await rejectedSave(h, auth, plan, /private_storage_fixture_cleanup_failure/u);
  assert.equal(h.sql.state.batchAttempts, 1); assert.equal(h.sql.state.committedBatches, 0); assert.equal(h.sql.state.rolledBackBatches, 1);
  const statements = h.sql.state.batches[0].statements;
  assert.equal(statements.length, 2); assert.equal(statements[0].changes, 1);
  assert.match(statements[1].failure?.message, /private_storage_fixture_cleanup_failure/u);
  assert.deepEqual(h.sql.snapshot(), before); assert.equal(await retained(h, auth, plan.draftId), null);
});

test('private-storage: committed save with lost acknowledgement requires explicit original read recovery', async t => {
  const { h, auth, plan } = await setup(t), history = cleanupHistory(h);
  h.sql.loseNextCommitAck();
  const error = await rejectedSave(h, auth, plan, /acknowledgement lost after actual COMMIT/u);
  assert.equal(error.code, 'FIXTURE_PRIVATE_STORAGE_POST_COMMIT_ACK_LOST'); oneCommitted(h);
  assert.equal(h.sql.state.lostAckThrows, 1);
  assert.equal(h.sql.state.reads.filter(item => /^SELECT content,expires_at FROM private_content/u.test(item.sql)).length, 0,
    'Generic store neither disguises its failure nor automatically recovers/resubmits');
  const before = h.sql.snapshot(), recovered = await retained(h, auth, plan.draftId); assert.ok(recovered);
  assert.deepEqual(recovered.plan, plan); assert.equal(recovered.content, canonicalJson(plan));
  const persisted = row(h, plan.draftId);
  assert.equal(recovered.expiresAt, persisted.expires_at);
  assert.equal(Date.parse(persisted.expires_at) - Date.parse(persisted.created_at), 30 * 86_400_000);
  cleanupOnlyExpected(h, history, persisted.created_at);
  assert.deepEqual(h.sql.snapshot(), before); assert.equal(h.sql.state.batchAttempts, 1);
});

test('private-storage: newly saved draft loses retained-read eligibility after expiry or custody changes', async t => {
  for (const kind of ['expiry', 'custody']) {
    const { h, auth, plan } = await setup(t);
    const stored = await save(h, auth, plan); await savedOriginal(h, auth, plan, stored); oneCommitted(h, 0);
    if (kind === 'expiry') h.sql.mutate('UPDATE private_content SET expires_at=? WHERE content_id=?', PAST, plan.draftId);
    else scopedContent(h, plan.draftId);
    const before = h.sql.snapshot();
    assert.equal(await retained(h, auth, plan.draftId), null); assert.deepEqual(h.sql.snapshot(), before);
    assert.equal(h.sql.state.batchAttempts, 1); assert.equal(h.sql.state.committedBatches, 1);
  }
});
