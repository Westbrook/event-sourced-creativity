import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Proposed finite retained-draft qualification; authored here, not executed.
// Actual same-Request R7 result feeds the production post-auth continuation and
// real retained reader. No supplied successful authority, lifecycle continuation,
// substituted crypto/rows/guards, mixed HTTP/writer/native module or provider.
const rootInput = process.env.FORMA_EXPERIENCE_RETAINED_DRAFT_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_RETAINED_DRAFT_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-retained-draft-local-sqlite');
const modulePaths = [
  'worker/experience-intake-read.ts', 'worker/principal-request-core.ts', 'worker/project-request-context.ts',
  'worker/intake-authority.ts', 'worker/policy-version.ts', 'worker/access-policy.ts',
  'src/platform/capabilities.ts', 'worker/canvas-governance-policy.ts', 'worker/image-adapter-evaluation-evidence.ts',
  'src/experiences/intake.ts', 'src/experiences/catalog.ts', 'src/experiences/compiler.ts', 'src/experiences/image-ratio.ts',
];
assert.deepEqual(manifest.modules.map(entry => entry.path).sort(), [...modulePaths].sort(), 'Exact reviewed thirteen-path closure only');
assert.equal(Object.hasOwn(manifest, 'extensionlessEdges'), false, 'This closure has explicit .ts imports only');
const allowed = new Set(), expectedHashes = new Map();
for (const entry of manifest.modules) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
  const file = realpathSync(resolve(root, entry.path)), local = relative(root, file);
  assert.ok(!local.startsWith('..' + sep) && !isAbsolute(local), 'Reviewed source must be in the integrated checkout');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), entry.sha256, `Changed reviewed source: ${entry.path}`);
  allowed.add(file); expectedHashes.set(file, entry.sha256);
}
// Forbidden-side-effect tripwire only: never a fabricated provider response.
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let forbiddenFetchAttempts = 0, fetchRestored = false;
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, enumerable: originalFetchDescriptor?.enumerable ?? true,
  value: function forbiddenDraftFetch() { forbiddenFetchAttempts++; throw Error('Network forbidden in retained-draft qualification'); },
});
function restoreFetch() {
  if (fetchRestored) return;
  fetchRestored = true;
  if (originalFetchDescriptor) Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
  else delete globalThis.fetch;
}
process.once('exit', restoreFetch);
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  // The reviewed production closure imports no runtime Node built-ins.
  assert.ok(!specifier.startsWith('node:') && !/^[a-z]+:/iu.test(specifier.replace(/^file:/u, '')), `Unreviewed dependency: ${specifier}`);
  const file = realpathSync(specifier.startsWith('file:') ? fileURLToPath(specifier)
    : resolve(dirname(fileURLToPath(context.parentURL)), specifier));
  assert.ok(allowed.has(file), `Unreviewed retained-draft dependency: ${file}`);
  return nextResolve(pathToFileURL(file).href, context);
}, load(url, context, nextLoad) {
  const file = realpathSync(fileURLToPath(url));
  assert.ok(allowed.has(file), `Unreviewed loaded retained-draft dependency: ${file}`);
  const loaded = nextLoad(url, context), source = loaded.source;
  assert.ok(source !== null && source !== undefined, `Missing source bytes: ${file}`);
  const bytes = typeof source === 'string' ? Buffer.from(source)
    : ArrayBuffer.isView(source) ? Buffer.from(source.buffer, source.byteOffset, source.byteLength)
      : Buffer.from(source);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHashes.get(file), `Loaded source differs from reviewed pin: ${file}`);
  return loaded; // Return exactly the bytes verified above, not a second filesystem read.
} });
let hookActive = true;
function cleanup() {
  restoreFetch();
  if (hookActive) { hookActive = false; hook.deregister(); }
}
process.once('exit', cleanup);
after(() => {
  try { assert.equal(forbiddenFetchAttempts, 0, 'A forbidden fetch was attempted, even if an retained-draft catch swallowed its error'); }
  finally { cleanup(); }
});
let principalModule, draftModule, intakeModule, compilerModule, POLICY_VERSION;
try {
  principalModule = await import(pathToFileURL(resolve(root, 'worker/principal-request-core.ts')).href);
  draftModule = await import(pathToFileURL(resolve(root, 'worker/experience-intake-read.ts')).href);
  intakeModule = await import(pathToFileURL(resolve(root, 'src/experiences/intake.ts')).href);
  compilerModule = await import(pathToFileURL(resolve(root, 'src/experiences/compiler.ts')).href);
  ({ POLICY_VERSION } = await import(pathToFileURL(resolve(root, 'worker/policy-version.ts')).href));
} catch (error) { cleanup(); throw error; }
// Keep the guard through tests: an unexpected late import must also fail closed.

const { readExistingPrincipalRequest: readPrincipal } = principalModule;
const { continueExperienceAuthorization, readDraft } = draftModule;
const { registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan, experienceDraftId } = intakeModule;
const { canonicalJson, digest } = compilerModule;
const issuedResults = new WeakMap(), issuedAuthorizations = new WeakSet();
// Never call completePrincipalRequest with a fixture DTO. Every result below
// originates in a real Request and the actual reader's SQL/access path.
const PAST = '2000-01-01T00:00:00.000Z', FUTURE = '2999-01-01T00:00:00.000Z';
const AUTHOR = 'author-1', EMAIL = 'author@example.test', NAME = 'Author One';
const tables = ['users', 'capability_grants', 'organizations', 'organization_memberships', 'organization_projects',
  'project_memberships', 'pilot_cohorts', 'pilot_participants', 'organization_security_policies',
  'organization_identity_bindings', 'canvas_governance_requirements', 'project_event_scopes', 'events',
  'event_private_payloads', 'impersonation_sessions', 'replay_personas', 'project_resource_scopes',
  'project_context_sessions', 'project_migration_states', 'private_content', 'private_content_retention_scopes'];
function database() {
  const db = new DatabaseSync(':memory:');
  // Explicit disposable schema only. No cost counters, lifecycle writer or
  // real creator content is supplied. The actual principal SQL remains intact.
  db.exec(`
    CREATE TABLE users(user_id TEXT PRIMARY KEY,email TEXT,display_name TEXT,role TEXT,consent_version TEXT,consented_at TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE capability_grants(grant_id TEXT PRIMARY KEY,user_id TEXT,capability TEXT,scope_type TEXT,organization_id TEXT,project_access_id TEXT,status TEXT,revoked_at TEXT,expires_at TEXT,updated_at TEXT);
    CREATE TABLE organizations(organization_id TEXT PRIMARY KEY,name TEXT,owner_user_id TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE organization_memberships(membership_id TEXT PRIMARY KEY,organization_id TEXT,user_id TEXT,role TEXT,status TEXT,accepted_at TEXT,revoked_at TEXT,updated_at TEXT);
    CREATE TABLE organization_projects(project_access_id TEXT PRIMARY KEY,organization_id TEXT,project_id TEXT,owner_user_id TEXT,status TEXT,updated_at TEXT);
    CREATE TABLE project_memberships(membership_id TEXT PRIMARY KEY,project_access_id TEXT,organization_id TEXT,project_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT,updated_at TEXT);
    CREATE TABLE pilot_cohorts(cohort_id TEXT PRIMARY KEY,organization_id TEXT,status TEXT,starts_at TEXT,ends_at TEXT,created_at TEXT,participant_cap_microusd INTEGER);
    CREATE TABLE pilot_participants(participant_id TEXT PRIMARY KEY,cohort_id TEXT,organization_id TEXT,email_normalized TEXT,user_id TEXT,status TEXT,revoked_at TEXT,role TEXT);
    CREATE TABLE organization_security_policies(organization_id TEXT PRIMARY KEY,authentication_source TEXT,allowed_domains_json TEXT,require_mfa INTEGER,version INTEGER,updated_at TEXT);
    CREATE TABLE organization_identity_bindings(organization_id TEXT,user_id TEXT,status TEXT,authentication_source TEXT,subject TEXT,updated_at TEXT,PRIMARY KEY(organization_id,user_id));
    CREATE TABLE canvas_governance_requirements(requirement_id TEXT PRIMARY KEY,status TEXT,details_json TEXT,evidence_ref TEXT);
    CREATE TABLE project_event_scopes(project_access_id TEXT,organization_id TEXT,event_id TEXT,project_sequence INTEGER);
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT,sequence INTEGER,occurred_at TEXT,recorded_at TEXT,
      actor TEXT,client_id TEXT,correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER,type TEXT,payload TEXT,UNIQUE(stream_id,sequence));
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,owner_id TEXT,private_json TEXT,redacted_at TEXT);
    CREATE TABLE impersonation_sessions(impersonation_id TEXT PRIMARY KEY,actor_user_id TEXT,persona_id TEXT,fictional_user_id TEXT,status TEXT,expires_at TEXT,updated_at TEXT,replay_session_id TEXT,started_at TEXT);
    CREATE TABLE replay_personas(persona_id TEXT PRIMARY KEY,display_name TEXT,status TEXT);
    CREATE TABLE project_resource_scopes(owner_user_id TEXT,resource_kind TEXT,resource_id TEXT,PRIMARY KEY(owner_user_id,resource_kind,resource_id));
    CREATE TABLE project_context_sessions(context_id TEXT PRIMARY KEY,principal_user_id TEXT,organization_id TEXT,project_access_id TEXT,expires_at TEXT,revoked_at TEXT);
    CREATE TABLE project_migration_states(project_access_id TEXT,organization_id TEXT,status TEXT,PRIMARY KEY(project_access_id,organization_id));
    CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT,redacted_at TEXT,expires_at TEXT);
    CREATE TABLE private_content_retention_scopes(content_id TEXT PRIMARY KEY);
  `);
  return db;
}
function insert(h, table, values) {
  assert.ok(tables.includes(table));
  const keys = Object.keys(values); assert.ok(keys.every(key => /^[a-z_]+$/u.test(key)));
  h.db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(values));
}
function user(h, values = {}) {
  insert(h, 'users', { user_id: AUTHOR, email: EMAIL, display_name: NAME, role: 'creator',
    consent_version: POLICY_VERSION, consented_at: PAST, created_at: PAST, updated_at: PAST, ...values });
}
function assertReadable(state) {
  if (state.retired) { state.lateReadAttempts++; throw Error('Retained draft fixture retired'); }
}
function prepared(db, state, sql, bindings = []) {
  return { bind(...values) { return prepared(db, state, sql, values); },
    async first() {
      assertReadable(state);
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Intake reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      if (state.gate && /^SELECT 1 AS current WHERE /u.test(sql)) await state.gate.beforeFinal(sql, bindings);
      assertReadable(state); // Retirement may have occurred while the existing gate was awaited.
      return db.prepare(sql).get(...bindings) ?? null; // Always the actual SQLite row/null.
    },
    async all() {
      assertReadable(state);
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Intake reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      return { results: db.prepare(sql).all(...bindings), success: true };
    },
    run() { state.forbiddenWrites++; throw Error('Intake reader attempted a lifecycle write'); },
  };
}
function harness(t, options = {}) {
  const db = database(), state = { reads: [], forbiddenWrites: 0, gate: null, retired: false, lateReadAttempts: 0 };
  let closed = false;
  const env = { DB: { prepare: sql => prepared(db, state, sql),
    async batch() { state.forbiddenWrites++; throw Error('Intake reader attempted a lifecycle batch'); },
    async exec() { state.forbiddenWrites++; throw Error('Intake reader attempted schema/write execution'); },
  } };
  const h = { db, state, env, close() {
    state.retired = true; state.gate?.dispose(); state.gate = null;
    if (!closed) { closed = true; db.close(); }
  }, snapshot() {
    const schema = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const present = new Set(schema.map(row => row.name));
    return { schema, rows: Object.fromEntries(tables.map(table => [table,
      present.has(table) ? db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() : null])) };
  } };
  if (options.user !== false) user(h, options.user ?? {});
  t.after(() => { try { assert.equal(state.forbiddenWrites, 0, 'A lifecycle/schema write was attempted, even if swallowed'); }
    finally { h.close(); } });
  return h;
}
function requestFor({ url = 'https://qualification.invalid/api/experiences/drafts', method = 'GET', identity = true, headers = {} } = {}) {
  const values = new Headers(identity ? {
    'oai-authenticated-user-id': AUTHOR, 'oai-authenticated-user-email': EMAIL,
    'oai-authenticated-user-full-name': encodeURIComponent(NAME),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  } : {});
  for (const [key, value] of Object.entries(headers)) { if (value === null) values.delete(key); else values.set(key, value); }
  return new Request(url, { method, headers: values }); // Constructed only; never fetched.
}
async function rawAuthorization(h, request) {
  const before = h.snapshot();
  try {
    const result = await readPrincipal(request, h.env, 'creator', { account: 'principal' });
    issuedResults.set(result, request);
    return result;
  } finally { assert.deepEqual(h.snapshot(), before, 'Actual R7 fixture entry must not perform lifecycle writes'); }
}
async function continueAuthorization(h, request, result) {
  assert.equal(issuedResults.get(result), request, 'Exact R7 result and same Request must enter the continuation');
  assert.equal(Object.hasOwn(result, 'kind'), false, 'Lifecycle-required is unqualified, never completed authorization');
  const before = h.snapshot();
  try {
    const value = await continueExperienceAuthorization(request, h.env, result);
    if (!(value instanceof Response)) issuedAuthorizations.add(value);
    return value;
  } finally { assert.deepEqual(h.snapshot(), before, 'Actual continuation must be read-only'); }
}
async function authorization(h, request = requestFor()) {
  const result = await rawAuthorization(h, request), value = await continueAuthorization(h, request, result);
  assert.equal(value instanceof Response, false, 'Fixture requires actual post-auth personal success');
  assert.equal(value.user, result.user); assert.equal(value.principal, result.user); assert.equal(value.impersonation, null);
  return value;
}
async function retained(h, auth, id) {
  assert.ok(issuedAuthorizations.has(auth), 'Retained read needs actual production-continuation output');
  const before = h.snapshot();
  try { return await readDraft(h.env, auth, id); }
  finally { assert.deepEqual(h.snapshot(), before, 'Retained read must not replace, repair or mutate'); }
}
const PRIVATE_MARKER = 'Qualification private subject';
const intentFor = (output, suffix = 1) => `00000000-0000-4000-8000-${(output === 'image' ? 1000 + suffix : 2000 + suffix).toString(16).padStart(12, '0')}`;
async function planFor(auth, output = 'image', suffix = 1) {
  assert.ok(issuedAuthorizations.has(auth));
  const release = await registeredExperience(output); assert.ok(release);
  const values = initialValues(release);
  if (output === 'image') {
    values.subject = { value: PRIVATE_MARKER, provenance: 'authored' };
    values.ratio = { value: { width: 3, height: 2 }, provenance: 'authored' };
  } else {
    values.claim = { value: 'Qualification private claim', provenance: 'authored' };
    values.evidence = { value: [{ id: 'e3', text: 'Third evidence' }, { id: 'e1', text: 'First evidence' }, { id: 'e2', text: 'Second evidence' }], provenance: 'authored' };
  }
  const validated = await validateIntakeRequest({ intentId: intentFor(output, suffix), experienceId: output,
    releaseHash: release.releaseHash, values });
  assert.ok(validated, 'Fixture must pass actual registered compiler/intake validation');
  return buildExperiencePlan(auth.user.userId, validated.request, validated.release);
}
function seed(h, auth, plan, values = {}) {
  assert.ok(issuedAuthorizations.has(auth));
  const row = { content_id: plan.draftId, owner_id: auth.user.userId, kind: 'experience-draft',
    content: canonicalJson(plan), redacted_at: null, expires_at: FUTURE, ...values };
  insert(h, 'private_content', row); return row;
}
async function setup(t, output = 'image', options = {}) {
  const h = harness(t, options), auth = await authorization(h), plan = await planFor(auth, output), row = seed(h, auth, plan);
  return { h, auth, plan, row };
}
const initialReads = h => h.state.reads.filter(row => /^SELECT content,expires_at FROM private_content /u.test(row.sql));
const finalReads = h => h.state.reads.filter(row => /^SELECT 1 AS current WHERE /u.test(row.sql));
const contextReads = h => h.state.reads.filter(row => /FROM project_context_sessions context\b/u.test(row.sql));
function accepted(value, plan, row) {
  assert.ok(value); assert.deepEqual(value.plan, plan); assert.equal(value.content, row.content); assert.equal(value.expiresAt, row.expires_at);
  return value;
}
async function responseIs(value, status, body, cache = null) {
  assert.ok(value instanceof Response); assert.equal(value.status, status); assert.deepEqual(await value.json(), body);
  assert.equal(value.headers.get('cache-control'), cache);
}
function projectContext(h) {
  user(h, { user_id: 'owner-1', email: 'owner@example.test', display_name: 'Owner One' });
  insert(h, 'organizations', { organization_id: 'org-1', name: 'Qualification organization', owner_user_id: 'owner-1', status: 'active', updated_at: PAST });
  for (const [id, userId, role] of [['member-1', AUTHOR, 'member'], ['owner-member', 'owner-1', 'owner']]) {
    insert(h, 'organization_memberships', { membership_id: id, organization_id: 'org-1', user_id: userId,
      role, status: 'active', accepted_at: PAST, revoked_at: null, updated_at: PAST });
  }
  insert(h, 'organization_projects', { project_access_id: 'access-1', organization_id: 'org-1', project_id: 'shared-project',
    owner_user_id: 'owner-1', status: 'active', updated_at: PAST });
  insert(h, 'project_memberships', { membership_id: 'project-member', project_access_id: 'access-1', organization_id: 'org-1',
    project_id: 'shared-project', user_id: AUTHOR, role: 'editor', status: 'active', revoked_at: null, updated_at: PAST });
  insert(h, 'project_migration_states', { project_access_id: 'access-1', organization_id: 'org-1', status: 'active' });
  insert(h, 'project_context_sessions', { context_id: 'context-1', principal_user_id: AUTHOR, organization_id: 'org-1',
    project_access_id: 'access-1', expires_at: FUTURE, revoked_at: null });
}
function impersonation(h) {
  user(h, { user_id: 'fictional-1', email: 'fictional@example.test', display_name: 'Stored fictional name' });
  insert(h, 'replay_personas', { persona_id: 'persona-1', display_name: 'Fictional persona', status: 'ready' });
  insert(h, 'impersonation_sessions', { impersonation_id: 'impersonation-1', actor_user_id: AUTHOR, persona_id: 'persona-1',
    fictional_user_id: 'fictional-1', status: 'active', expires_at: FUTURE, updated_at: PAST, replay_session_id: 'replay-1', started_at: PAST });
}
function removal(h, auth, plan, { type = 'DocumentRemoved', stream = auth.user.streamId, id, payload } = {}) {
  insert(h, 'events', { event_id: id ?? 'qualification-removal', stream_id: stream, sequence: 99, occurred_at: PAST, recorded_at: PAST,
    actor: 'user', client_id: 'qualification', correlation_id: 'qualification-removal', causation_id: null, compensates_event_id: null,
    schema_version: 1, type, payload: payload ?? JSON.stringify(type === 'DocumentRemoved' ? { document_id: plan.documentId } : { project_id: plan.projectId }) });
}
async function rehash(plan) {
  const { draftHash, ...base } = plan; return { ...base, draftHash: await digest(base) };
}

// The only timing seam: one shot immediately before the final actual SELECT.
// It returns no row or authority decision, and never changes crypto or bindings.
function preFinalGate() {
  let calls = 0, disposed = false, enteredResolve, enteredReject, releaseResolve, releaseTimer;
  let entryTimer;
  const entered = new Promise((resolve, reject) => {
    enteredResolve = resolve; enteredReject = reject;
    entryTimer = setTimeout(() => reject(Error('Final SQL gate was not reached within 5 seconds')), 5000);
  });
  void entered.catch(() => undefined); // Cleanup may reject an unconsumed early-failure wait.
  function release() { clearTimeout(releaseTimer); releaseResolve?.(); }
  return { entered, get calls() { return calls; },
    async beforeFinal(sql, bindings) {
      assert.equal(disposed, false); assert.equal(++calls, 1, 'Pre-final gate is one-shot');
      assert.match(sql, /^SELECT 1 AS current WHERE /u); clearTimeout(entryTimer);
      enteredResolve({ sql, bindings: [...bindings] });
      await new Promise((resolve, reject) => {
        releaseResolve = resolve;
        releaseTimer = setTimeout(() => reject(Error('Final SQL gate was not released within 5 seconds')), 5000);
      });
    }, release,
    dispose() {
      if (disposed) return;
      disposed = true; clearTimeout(entryTimer); release();
      if (calls === 0) enteredReject(Error('Final SQL gate disposed before entry'));
    },
  };
}
async function drainRead(h, pending, timeoutMs = 5000) {
  if (!pending) return;
  // Observe both outcomes indefinitely, without awaiting indefinitely or
  // substituting an outcome in the original production promise.
  const settled = Promise.resolve(pending).then(() => true, () => true);
  let timer;
  try {
    const drained = await Promise.race([settled,
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    if (!drained) {
      h.state.retired = true; // Every later production SELECT refuses before SQLite, even after DB close.
      throw Error('Retained reader did not drain within cleanup bound; fixture retired');
    }
  } finally { clearTimeout(timer); }
}
async function interleaveBeforeFinal(h, auth, id, mutateFixture) {
  assert.ok(issuedAuthorizations.has(auth)); assert.equal(h.state.gate, null);
  const gate = preFinalGate(); h.state.gate = gate;
  let expected = h.snapshot(), pending;
  try {
    pending = readDraft(h.env, auth, id);
    void pending.catch(() => undefined); // Observe a late real failure even after retirement.
    // A real early result/error fails the phase expectation promptly, not after
    // a dangling timer; the production promise itself is never replaced.
    const finalStatement = await Promise.race([gate.entered, pending.then(() => { throw Error('Reader completed before final SQL gate'); })]);
    assert.equal(initialReads(h).length, 1); assert.equal(finalReads(h).length, 1);
    mutateFixture(h); expected = h.snapshot(); // Explicit local fixture write, not production behavior.
    gate.release();
    const result = await pending;
    assert.equal(gate.calls, 1);
    return { result, finalStatement };
  } finally {
    gate.dispose();
    try { await drainRead(h, pending); }
    finally {
      h.state.gate = null;
      assert.deepEqual(h.snapshot(), expected, 'Only the explicitly recorded fixture mutation may change SQLite');
    }
  }
}

test('actual R7 denied results are forwarded unchanged before consent, selection or retained reads', async t => {
  const cases = [
    { h: harness(t), request: requestFor({ identity: false }), error: 'authentication_required', status: 401 },
    { h: harness(t, { user: { role: 'viewer' } }), request: requestFor(), error: 'insufficient_role', status: 403 },
  ];
  const acting = harness(t); impersonation(acting);
  cases.push({ h: acting, request: requestFor({ headers: { cookie: 'forma_impersonation=impersonation-1' } }),
    error: 'return_to_principal_before_internal_access', status: 409 });
  for (const item of cases) {
    const raw = await rawAuthorization(item.h, item.request); assert.ok(raw.response instanceof Response);
    const response = await continueAuthorization(item.h, item.request, raw);
    assert.equal(response, raw.response, 'The actual original denied Response is forwarded by identity');
    assert.equal(response.status, item.status); assert.equal((await response.json()).error, item.error);
    assert.equal(contextReads(item.h).length, 0); assert.equal(initialReads(item.h).length, 0);
  }
});

test('lifecycle-required remains unqualified and never enters the post-auth continuation', async t => {
  const h = harness(t, { user: false }), request = requestFor(), raw = await rawAuthorization(h, request);
  assert.equal(raw.kind, 'lifecycle-required'); assert.equal(raw.reason, 'missing-account');
  for (const key of ['user', 'principal', 'impersonation', 'response']) assert.equal(Object.hasOwn(raw, key), false);
  assert.equal(contextReads(h).length, 0); assert.equal(initialReads(h).length, 0);
  // Deliberately no continuation call, fabricated lifecycle success or DTO.
});

test('actual consent refusal precedes even a selected-context lookup', async t => {
  const h = harness(t, { user: { consent_version: 'previous-policy' } }); projectContext(h);
  const request = requestFor({ headers: { cookie: 'forma_project_context=context-1' } });
  const raw = await rawAuthorization(h, request); assert.equal(raw.response, null);
  const value = await continueAuthorization(h, request, raw);
  await responseIs(value, 428, { error: 'pilot_terms_required', policyVersion: POLICY_VERSION });
  assert.equal(contextReads(h).length, 0); assert.equal(initialReads(h).length, 0);
});

test('real shared selection is refused and actual R8 selection errors keep their headers and status', async t => {
  const h = harness(t); projectContext(h);
  const request = requestFor({ headers: { cookie: 'forma_project_context=context-1' } });
  const raw = await rawAuthorization(h, request), shared = await continueAuthorization(h, request, raw);
  await responseIs(shared, 403, { error: 'personal_author_required' }, 'private, no-store');
  assert.equal(contextReads(h).length, 1); assert.equal(initialReads(h).length, 0);
  for (const [cookie, status, error, cache] of [
    ['forma_project_context=missing', 403, 'project_access_revoked', 'private, no-store'],
    ['forma_project_context=context-1; forma_impersonation=nonexistent', 409, 'project_context_impersonation_unavailable', null],
  ]) {
    const request = requestFor({ headers: { cookie } }), raw = await rawAuthorization(h, request);
    assert.equal(raw.response, null); // A stale impersonation cookie is not a live R7 session.
    const result = await continueAuthorization(h, request, raw);
    assert.equal(result.headers.get('set-cookie'), 'forma_project_context=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
    await responseIs(result, status, { error }, cache);
  }
});

test('real registered Image ratio and exact-five Slides plans retain immutable original identities without generation', async t => {
  for (const output of ['image', 'slides']) {
    const { h, auth, plan, row } = await setup(t, output);
    assert.equal(auth.user, auth.principal); assert.equal(auth.impersonation, null);
    assert.equal(plan.release.qualification, 'context-authoring');
    assert.equal(plan.draftId, await experienceDraftId(auth.user.userId, plan.request.intentId));
    if (output === 'image') {
      assert.deepEqual(plan.request.values.ratio, { value: { width: 3, height: 2 }, provenance: 'authored' });
      const ratio = plan.events.find(event => event.payload.properties?.experience_binding === 'ratio').payload.properties;
      assert.deepEqual(ratio.experience_value, { width: 3, height: 2 }); assert.equal(ratio.authority, 'authored');
    } else {
      assert.equal(plan.release.output.result, '5 slides'); assert.equal(plan.events.at(-1).payload.properties.text, '5 slides');
      assert.deepEqual(plan.request.values.evidence.value.map(item => item.id), ['e3', 'e1', 'e2']);
    }
    const first = accepted(await retained(h, auth, plan.draftId), plan, row);
    assert.deepEqual(accepted(await retained(h, auth, plan.draftId), plan, row), first);
    assert.equal(initialReads(h).length, 2); assert.equal(finalReads(h).length, 2);
    assert.deepEqual(initialReads(h)[0].bindings.slice(0, 2), [plan.draftId, AUTHOR]);
    assert.ok(finalReads(h)[0].bindings.includes(row.content));
  }
});

test('initial row absence, owner/kind/expiry/redaction and changed base authority return null', async t => {
  const changes = [
    (h, plan) => h.db.prepare('DELETE FROM private_content WHERE content_id=?').run(plan.draftId),
    h => h.db.prepare('UPDATE private_content SET owner_id=?').run('another-owner'),
    h => h.db.prepare('UPDATE private_content SET kind=?').run('another-kind'),
    h => h.db.prepare('UPDATE private_content SET expires_at=?').run(PAST),
    h => h.db.prepare('UPDATE private_content SET redacted_at=?').run(PAST),
    h => h.db.prepare('UPDATE users SET updated_at=? WHERE user_id=?').run(FUTURE, AUTHOR),
  ];
  for (const change of changes) {
    const { h, auth, plan } = await setup(t); change(h, plan);
    assert.equal(await retained(h, auth, plan.draftId), null); assert.equal(finalReads(h).length, 0);
  }
  const { h, auth, plan } = await setup(t);
  assert.equal(await retained(h, auth, `experience-draft-${'f'.repeat(64)}`), null);
  user(h, { user_id: 'second-1', email: 'second@example.test', display_name: 'Second One' });
  const other = await authorization(h, requestFor({ headers: { 'oai-authenticated-user-id': 'second-1',
    'oai-authenticated-user-email': 'second@example.test', 'oai-authenticated-user-full-name': encodeURIComponent('Second One') } }));
  assert.equal(await retained(h, other, plan.draftId), null); assert.equal(finalReads(h).length, 0);
});

test('actual plan parse/identity/output/version checks refuse corrupted retained originals before final SQL', async t => {
  const cases = [
    async () => ({ content: '{' }), async () => ({ content: 'null' }),
    async plan => { const changed = structuredClone(plan); delete changed.release.output; return { content: canonicalJson(changed) }; },
    async plan => ({ content: canonicalJson(await rehash({ ...plan, version: 2 })) }),
    async plan => ({ content: canonicalJson(await rehash({ ...plan, release: { ...plan.release, output: { ...plan.release.output, output: 'video' } } })) }),
    async plan => ({ content: canonicalJson(await rehash({ ...plan, streamId: 'creative:another-owner' })) }),
    async plan => ({ content: canonicalJson(await rehash({ ...plan, request: { ...plan.request, intentId: intentFor('image', 9) } })) }),
    async plan => ({ id: 'invalid-draft', content: canonicalJson(await rehash({ ...plan, draftId: 'invalid-draft' })) }),
    async plan => { const id = `experience-draft-${'e'.repeat(64)}`; return { id, content: canonicalJson(await rehash({ ...plan, draftId: id })) }; },
    async plan => ({ content: canonicalJson({ ...plan, draftId: `experience-draft-${'e'.repeat(64)}` }) }),
  ];
  for (const corrupt of cases) {
    const { h, auth, plan } = await setup(t), change = await corrupt(plan), id = change.id ?? plan.draftId;
    h.db.prepare('UPDATE private_content SET content_id=?,content=?').run(id, change.content);
    assert.equal(await retained(h, auth, id), null); assert.equal(finalReads(h).length, 0);
  }
});

test('actual canonical SHA-256 rejects changed base values or hash without claiming full catalog/schema revalidation', async t => {
  const changes = [
    plan => { const changed = structuredClone(plan); changed.request.values.subject.value = 'Changed subject'; return changed; },
    plan => ({ ...plan, events: [...plan.events].reverse() }),
    plan => ({ ...plan, draftHash: `sha256:${'0'.repeat(64)}` }),
    plan => ({ ...plan, draftHash: 3 }),
    plan => { const changed = structuredClone(plan); delete changed.draftHash; return changed; },
  ];
  for (const change of changes) {
    const { h, auth, plan } = await setup(t);
    h.db.prepare('UPDATE private_content SET content=?').run(canonicalJson(change(plan)));
    assert.equal(await retained(h, auth, plan.draftId), null); assert.equal(finalReads(h).length, 0);
  }
});

test('freshly read equivalent JSON formatting is accepted but the exact retained content string is returned', async t => {
  const { h, auth, plan, row } = await setup(t);
  const content = JSON.stringify(Object.fromEntries(Object.entries(plan).reverse()), null, 2);
  assert.notEqual(content, row.content); h.db.prepare('UPDATE private_content SET content=?').run(content);
  accepted(await retained(h, auth, plan.draftId), plan, { ...row, content });
});

test('broad content, retention, project and Document custody refuses regardless of another owner or inactive metadata', async t => {
  const cases = [
    (h, plan) => insert(h, 'project_resource_scopes', { owner_user_id: 'other-owner', resource_kind: 'content', resource_id: plan.draftId }),
    (h, plan) => insert(h, 'private_content_retention_scopes', { content_id: plan.draftId }),
    (h, plan) => insert(h, 'organization_projects', { project_access_id: 'foreign-custody', organization_id: 'unjoined-org',
      project_id: plan.projectId, owner_user_id: 'other-owner', status: 'inactive', updated_at: PAST }),
    (h, plan) => insert(h, 'project_resource_scopes', { owner_user_id: 'other-owner', resource_kind: 'document', resource_id: plan.documentId }),
  ];
  for (const change of cases) {
    const { h, auth, plan } = await setup(t); change(h, plan);
    assert.equal(await retained(h, auth, plan.draftId), null);
    assert.equal(initialReads(h).length, 1); assert.equal(finalReads(h).length, 1);
  }
  const { h, auth, plan, row } = await setup(t);
  insert(h, 'project_resource_scopes', { owner_user_id: 'other-owner', resource_kind: 'image', resource_id: plan.documentId });
  insert(h, 'private_content_retention_scopes', { content_id: 'unrelated-content' });
  accepted(await retained(h, auth, plan.draftId), plan, row);
});

test('same-stream removal uses the actual matching public IDs without a private or folded-state replacement', async t => {
  for (const type of ['DocumentRemoved', 'ProjectRemoved']) {
    const { h, auth, plan } = await setup(t); removal(h, auth, plan, { type });
    // An unrelated private payload does not supersede the real public removal predicate.
    insert(h, 'event_private_payloads', { private_event_id: 'qualification-removal', owner_id: AUTHOR,
      private_json: JSON.stringify({ document_id: 'other-document', project_id: 'other-project' }), redacted_at: null });
    assert.equal(await retained(h, auth, plan.draftId), null); assert.equal(finalReads(h).length, 1);
  }
  for (const options of [{ stream: 'creative:another-owner' }, { payload: '{"document_id":"another-document"}' },
    { type: 'QualificationWitness', payload: '{}' }]) {
    const { h, auth, plan, row } = await setup(t); removal(h, auth, plan, options);
    accepted(await retained(h, auth, plan.draftId), plan, row);
  }
});

test('one-shot pre-final SQL scheduling preserves real digest/rows while current bytes, custody or authority changes refuse', async t => {
  const changes = [
    (h, plan) => h.db.prepare('UPDATE private_content SET content=?').run(JSON.stringify(plan, null, 2)),
    h => h.db.prepare('UPDATE private_content SET expires_at=?').run(PAST),
    h => h.db.prepare('UPDATE private_content SET owner_id=?').run('another-owner'),
    h => h.db.prepare('UPDATE private_content SET redacted_at=?').run(PAST),
    (h, plan) => insert(h, 'project_resource_scopes', { owner_user_id: 'other-owner', resource_kind: 'content', resource_id: plan.draftId }),
    (h, plan) => insert(h, 'private_content_retention_scopes', { content_id: plan.draftId }),
    (h, plan, auth) => removal(h, auth, plan),
    h => h.db.prepare('UPDATE users SET updated_at=? WHERE user_id=?').run(FUTURE, AUTHOR),
  ];
  for (const change of changes) {
    const { h, auth, plan, row } = await setup(t);
    const value = await interleaveBeforeFinal(h, auth, plan.draftId, h => change(h, plan, auth));
    assert.equal(value.result, null);
    assert.ok(value.finalStatement.bindings.includes(row.content), 'Final real SQL retains the originally observed string');
    assert.equal(h.state.gate, null);
  }
});

test('current expiry liveness is not stronger expiry equality and returns the initially observed expiry', async t => {
  const { h, auth, plan, row } = await setup(t), differentFuture = '2998-01-01T00:00:00.000Z';
  const value = await interleaveBeforeFinal(h, auth, plan.draftId,
    h => h.db.prepare('UPDATE private_content SET expires_at=?').run(differentFuture));
  accepted(value.result, plan, row);
  assert.equal(h.db.prepare('SELECT expires_at FROM private_content').get().expires_at, differentFuture);
  assert.equal(value.result.expiresAt, FUTURE); assert.equal(h.state.gate, null);
});

test('actual initial/final SQLite failures propagate rather than becoming plan-null or a formatted HTTP error', async t => {
  const initial = await setup(t); initial.h.db.exec('DROP TABLE private_content');
  await assert.rejects(() => retained(initial.h, initial.auth, initial.plan.draftId), /no such table: private_content/u);
  assert.equal(finalReads(initial.h).length, 0);
  const final = await setup(t);
  await assert.rejects(() => interleaveBeforeFinal(final.h, final.auth, final.plan.draftId,
    h => h.db.exec('DROP TABLE private_content_retention_scopes')), /no such table: private_content_retention_scopes/u);
  assert.equal(final.h.state.gate, null);
  const malformed = await setup(t); removal(malformed.h, malformed.auth, malformed.plan, { payload: '{' });
  await assert.rejects(() => retained(malformed.h, malformed.auth, malformed.plan.draftId), /malformed JSON/iu);
  assert.equal(finalReads(malformed.h).length, 1);
});

test('the one-shot timing fixture releases/disposes on early validation and assertion failure without replacing production results', async t => {
  const early = await setup(t); early.h.db.prepare('UPDATE private_content SET content=?').run('{');
  let mutated = false;
  await assert.rejects(() => interleaveBeforeFinal(early.h, early.auth, early.plan.draftId, () => { mutated = true; }),
    /Reader completed before final SQL gate/u);
  assert.equal(mutated, false); assert.equal(early.h.state.gate, null); assert.equal(finalReads(early.h).length, 0);
  const aborted = await setup(t);
  await assert.rejects(() => interleaveBeforeFinal(aborted.h, aborted.auth, aborted.plan.draftId,
    () => { throw Error('qualification_fixture_assertion'); }), /qualification_fixture_assertion/u);
  assert.equal(aborted.h.state.gate, null);
  // The released SQL really completes against its unchanged rows. Its result is
  // discarded on fixture failure, not replaced with null or approved authority.
  accepted(await retained(aborted.h, aborted.auth, aborted.plan.draftId), aborted.plan, aborted.row);
});

// Containment-helper-only negative case. This inert promise is never supplied
// to readDraft, Web Crypto, an authority guard or a successful production path.
test('cleanup drainage is bounded and a retired fixture refuses late SQL before a closed database', async t => {
  const h = harness(t); let rejectLate;
  const unsettled = new Promise((_resolve, reject) => { rejectLate = reject; });
  await assert.rejects(() => drainRead(h, unsettled, 5), /did not drain within cleanup bound/u);
  assert.equal(h.state.retired, true); h.close();
  await assert.rejects(() => h.env.DB.prepare('SELECT 1 AS current').first(), /Retained draft fixture retired/u);
  assert.equal(h.state.lateReadAttempts, 1);
  rejectLate(Error('qualification_late_rejection')); // Existing rejection observer remains attached.
  await Promise.resolve();
});
