import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Proposed finite project-context qualification; authored here, not executed.
// Actual R7 Request/SQL principal feeds the actual R8 context resolver. No
// successful principal/access/context DTO, membership callback, schema bootstrap,
// mixed module, provider, native job or endpoint dispatch is permitted.
const rootInput = process.env.FORMA_EXPERIENCE_PROJECT_CONTEXT_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_PROJECT_CONTEXT_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-project-request-context-local-sqlite');
const modulePaths = [
  'worker/project-request-context.ts', 'worker/principal-request-core.ts', 'worker/policy-version.ts', 'worker/access-policy.ts',
  'src/platform/capabilities.ts', 'worker/canvas-governance-policy.ts', 'worker/image-adapter-evaluation-evidence.ts',
];
assert.deepEqual(manifest.modules.map(entry => entry.path).sort(), [...modulePaths].sort(), 'Exact reviewed closure only');
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
  value: function forbiddenContextFetch() { forbiddenFetchAttempts++; throw Error('Network forbidden in project-context qualification'); },
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
  assert.ok(allowed.has(file), `Unreviewed request-context dependency: ${file}`);
  return nextResolve(pathToFileURL(file).href, context);
}, load(url, context, nextLoad) {
  const file = realpathSync(fileURLToPath(url));
  assert.ok(allowed.has(file), `Unreviewed loaded request-context dependency: ${file}`);
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
  try { assert.equal(forbiddenFetchAttempts, 0, 'A forbidden fetch was attempted, even if a request-context catch swallowed its error'); }
  finally { cleanup(); }
});
let principalModule, contextModule, POLICY_VERSION;
try {
  principalModule = await import(pathToFileURL(resolve(root, 'worker/principal-request-core.ts')).href);
  contextModule = await import(pathToFileURL(resolve(root, 'worker/project-request-context.ts')).href);
  ({ POLICY_VERSION } = await import(pathToFileURL(resolve(root, 'worker/policy-version.ts')).href));
} catch (error) { cleanup(); throw error; }
// Keep the guard through tests: an unexpected late import must also fail closed.

const { readExistingPrincipalRequest: readPrincipal, hasCapability } = principalModule;
const { readProjectRequestContext: resolveContext, hasProjectContextCookie, projectContextCookie } = contextModule;
const issuedPrincipals = new WeakSet();
// Never call completePrincipalRequest with a fixture DTO. Every result below
// originates in a real Request and the actual reader's SQL/access path.
const PAST = '2000-01-01T00:00:00.000Z', FUTURE = '2999-01-01T00:00:00.000Z';
const AUTHOR = 'author-1', EMAIL = 'author@example.test', NAME = 'Author One';
const tables = ['users', 'capability_grants', 'organizations', 'organization_memberships', 'organization_projects',
  'project_memberships', 'pilot_cohorts', 'pilot_participants', 'organization_security_policies',
  'organization_identity_bindings', 'canvas_governance_requirements', 'project_event_scopes', 'events',
  'event_private_payloads', 'impersonation_sessions', 'replay_personas', 'project_context_sessions', 'project_migration_states'];
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
    CREATE TABLE events(event_id TEXT PRIMARY KEY,type TEXT,payload TEXT);
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY,private_json TEXT,redacted_at TEXT);
    CREATE TABLE impersonation_sessions(impersonation_id TEXT PRIMARY KEY,actor_user_id TEXT,persona_id TEXT,fictional_user_id TEXT,status TEXT,expires_at TEXT,updated_at TEXT,replay_session_id TEXT,started_at TEXT);
    CREATE TABLE replay_personas(persona_id TEXT PRIMARY KEY,display_name TEXT,status TEXT);
    CREATE TABLE project_context_sessions(context_id TEXT PRIMARY KEY,principal_user_id TEXT,organization_id TEXT,project_access_id TEXT,expires_at TEXT,revoked_at TEXT);
    CREATE TABLE project_migration_states(project_access_id TEXT,organization_id TEXT,status TEXT,PRIMARY KEY(project_access_id,organization_id));
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
function prepared(db, state, sql, bindings = []) {
  return { bind(...values) { return prepared(db, state, sql, values); },
    async first() {
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Request reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      return db.prepare(sql).get(...bindings) ?? null;
    },
    async all() {
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Request reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      return { results: db.prepare(sql).all(...bindings), success: true };
    },
    run() { state.forbiddenWrites++; throw Error('Request reader attempted a lifecycle write'); },
  };
}
function harness(t, options = {}) {
  const db = database(), state = { reads: [], forbiddenWrites: 0 };
  const env = { DB: { prepare: sql => prepared(db, state, sql),
    async batch() { state.forbiddenWrites++; throw Error('Request reader attempted a lifecycle batch'); },
    async exec() { state.forbiddenWrites++; throw Error('Request reader attempted schema/write execution'); },
  } };
  const h = { db, state, env, snapshot() {
    const schema = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const present = new Set(schema.map(row => row.name));
    return { schema, rows: Object.fromEntries(tables.map(table => [table,
      present.has(table) ? db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() : null])) };
  } };
  if (options.user !== false) user(h, options.user ?? {});
  t.after(() => { try { assert.equal(state.forbiddenWrites, 0, 'A lifecycle/schema write was attempted, even if swallowed'); }
    finally { db.close(); } });
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
async function principal(h, request = requestFor(), options = { account: 'principal' }) {
  const before = h.snapshot();
  try {
    const result = await readPrincipal(request, h.env, 'creator', options);
    assert.equal(Object.hasOwn(result, 'kind'), false, 'Lifecycle-required is outside this context fixture');
    assert.equal(result.response, null, 'A real R7 principal success is required before context resolution');
    assert.ok(result.user && result.principal);
    issuedPrincipals.add(result.user);
    return result.user;
  } finally { assert.deepEqual(h.snapshot(), before, 'Principal reader must not perform lifecycle work'); }
}
async function context(h, request, actor) {
  assert.ok(issuedPrincipals.has(actor), 'Only an actual R7-issued user object can enter this fixture');
  const before = h.snapshot();
  try { return await resolveContext(request, h.env, actor); }
  finally { assert.deepEqual(h.snapshot(), before, 'Context resolution must not mutate selection, membership or lifecycle state'); }
}
async function refused(result, request, error = 'project_access_revoked', status = 403) {
  assert.equal(result.context, null); assert.ok(result.response instanceof Response);
  assert.equal(result.response.status, status); assert.deepEqual(await result.response.json(), { error });
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  assert.equal(result.response.headers.get('set-cookie'), `forma_project_context=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  assert.equal(result.response.headers.get('cache-control'), status === 403 ? 'private, no-store' : null);
}
function organization(h, values = {}) {
  insert(h, 'organizations', { organization_id: 'org-1', name: 'Qualification organization', owner_user_id: 'owner-1', status: 'active', updated_at: PAST, ...values });
}
function member(h, values = {}) {
  insert(h, 'organization_memberships', { membership_id: 'membership-1', organization_id: 'org-1', user_id: AUTHOR,
    role: 'member', status: 'active', accepted_at: PAST, revoked_at: null, updated_at: PAST, ...values });
}
function project(h, { membershipRole = 'member', projectRole = 'editor' } = {}) {
  user(h, { user_id: 'owner-1', email: 'owner@example.test', display_name: 'Owner One' });
  organization(h); member(h, { role: membershipRole });
  member(h, { membership_id: 'owner-membership', user_id: 'owner-1', role: 'owner' });
  insert(h, 'organization_projects', { project_access_id: 'access-1', organization_id: 'org-1', project_id: 'project-1',
    owner_user_id: 'owner-1', status: 'active', updated_at: PAST });
  insert(h, 'project_memberships', { membership_id: 'project-member-1', project_access_id: 'access-1', organization_id: 'org-1',
    project_id: 'project-1', user_id: AUTHOR, role: projectRole, status: 'active', revoked_at: null, updated_at: PAST });
}
function impersonation(h, { session = {}, persona = {}, fictional = {} } = {}) {
  user(h, { user_id: 'fictional-1', email: 'fictional@example.test', display_name: 'Stored fictional name', role: 'creator', ...fictional });
  insert(h, 'replay_personas', { persona_id: 'persona-1', display_name: 'Fictional persona', status: 'ready', ...persona });
  insert(h, 'impersonation_sessions', { impersonation_id: 'impersonation-1', actor_user_id: AUTHOR, persona_id: 'persona-1',
    fictional_user_id: 'fictional-1', status: 'active', expires_at: FUTURE, updated_at: PAST,
    replay_session_id: 'replay-1', started_at: PAST, ...session });
}

function cohort(h, values = {}) {
  insert(h, 'pilot_cohorts', { cohort_id: 'cohort-1', organization_id: 'org-1', status: 'active', starts_at: PAST,
    ends_at: FUTURE, created_at: PAST, participant_cap_microusd: 1, ...values });
  // No configured-cohort environment is set: this lane exercises the context
  // membership predicate, not R7's separate configured-entry/date policy.
}
function participant(h, values = {}) {
  insert(h, 'pilot_participants', { participant_id: 'participant-1', cohort_id: 'cohort-1', organization_id: 'org-1',
    email_normalized: EMAIL, user_id: AUTHOR, status: 'active', revoked_at: null, role: 'participant', ...values });
}
function setup(t, role = 'editor') {
  const h = harness(t); project(h, { projectRole: role === 'viewer' ? 'viewer' : 'editor' });
  if (role === 'owner') {
    h.db.prepare('UPDATE organizations SET owner_user_id=?').run(AUTHOR);
    h.db.prepare('UPDATE organization_projects SET owner_user_id=?').run(AUTHOR);
    h.db.prepare('UPDATE organization_memberships SET role=? WHERE user_id=?').run('owner', AUTHOR);
    h.db.prepare('DELETE FROM project_memberships WHERE user_id=?').run(AUTHOR);
  }
  if (role === 'reviewer') { cohort(h); participant(h, { role: 'reviewer' }); }
  insert(h, 'project_migration_states', { project_access_id: 'access-1', organization_id: 'org-1', status: 'active' });
  insert(h, 'project_context_sessions', { context_id: 'context-1', principal_user_id: AUTHOR,
    organization_id: 'org-1', project_access_id: 'access-1', expires_at: FUTURE, revoked_at: null });
  return h;
}
const selection = (values = {}) => requestFor({ ...values,
  headers: { cookie: 'forma_project_context=context-1', ...values.headers } });
const contextReads = h => h.state.reads.filter(row => /FROM project_context_sessions context\b/u.test(row.sql));
function accepted(result, { role = 'editor', principalUserId = AUTHOR, ownerUserId = 'owner-1' } = {}) {
  assert.equal(result.response, null);
  const permissions = role === 'viewer' ? ['project.read']
    : role === 'owner' ? ['project.read', 'project.author', 'project.library.manage', 'project.output.request', 'project.review.approve']
      : ['project.read', 'project.author', 'project.library.manage', 'project.output.request'];
  assert.deepEqual(result.context, { contextId: 'context-1', organizationId: 'org-1', projectAccessId: 'access-1',
    projectId: 'project-1', ownerUserId, principalUserId, role, permissions, expiresAt: FUTURE });
}

test('absent/empty/malformed first context cookie returns absence before impersonation and without context SQL', async t => {
  for (const cookie of [null, '', 'forma_project_context=', 'forma_project_context=%broken',
    'forma_project_context_extra=context-1', 'forma_project_context=; forma_project_context=context-1',
    'forma_project_context=%broken; forma_project_context=context-1', 'forma_impersonation=stale-session']) {
    const h = setup(t), request = requestFor({ headers: { cookie } }), actor = await principal(h, request);
    assert.equal(hasProjectContextCookie(request), false);
    assert.deepEqual(await context(h, request, actor), { context: null, response: null });
    assert.equal(contextReads(h).length, 0);
  }
  const h = setup(t); impersonation(h);
  const request = requestFor({ headers: { cookie: 'forma_impersonation=impersonation-1' } });
  const fictional = await principal(h, request, { account: 'effective' });
  assert.equal(fictional.fictional, true);
  assert.deepEqual(await context(h, request, fictional), { context: null, response: null });
  assert.equal(contextReads(h).length, 0);
});

test('actual R7 owner/editor/viewer/reviewer projections feed the real context resolver with catalog-ordered permissions', async t => {
  for (const kind of ['owner', 'editor', 'viewer', 'reviewer']) {
    const h = setup(t, kind), request = selection(), actor = await principal(h, request);
    const role = kind === 'reviewer' ? 'viewer' : kind;
    accepted(await context(h, request, actor), { role, ownerUserId: kind === 'owner' ? AUTHOR : 'owner-1' });
    assert.equal(actor.access.projects[0].role, role);
    if (kind === 'reviewer') {
      assert.equal(h.db.prepare('SELECT role FROM project_memberships').get().role, 'editor');
      assert.equal(hasCapability(actor, 'project.author', { organizationId: 'org-1', projectAccessId: 'access-1' }), false);
    }
    const reads = contextReads(h); assert.equal(reads.length, 1);
    assert.deepEqual(reads[0].bindings.slice(0, 5), [AUTHOR, AUTHOR, AUTHOR, 'context-1', AUTHOR]);
    assert.match(reads[0].bindings[5], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    assert.deepEqual(reads[0].bindings.slice(6), [AUTHOR, AUTHOR]);
  }
  // Shared selection success is not the PERSONAL-only mini-app's acceptance.
});

test('cookie presence/encoding is one-pass and rejection clears only the browser cookie with exact protocol attributes', async t => {
  const h = setup(t);
  const encoded = selection({ headers: { cookie: 'forma_project_context=context%2D1' } });
  assert.equal(hasProjectContextCookie(encoded), true);
  accepted(await context(h, encoded, await principal(h, encoded)));
  for (const cookie of ['forma_project_context=context%252D1',
    'forma_project_context=missing; forma_project_context=context-1', 'forma_project_context=context+1']) {
    const request = selection({ headers: { cookie } });
    assert.equal(hasProjectContextCookie(request), true);
    await refused(await context(h, request, await principal(h, request)), request);
  }
  for (const protocol of ['http:', 'https:']) {
    const request = selection({ url: `${protocol}//qualification.invalid/api/projects`, headers: { cookie: 'forma_project_context=missing' } });
    await refused(await context(h, request, await principal(h, request)), request);
    assert.equal(projectContextCookie(request, 'context /+%', 120),
      `forma_project_context=context%20%2F%2B%25; Path=/; HttpOnly; SameSite=Lax; Max-Age=120${protocol === 'https:' ? '; Secure' : ''}`);
  }
  assert.equal(h.db.prepare('SELECT revoked_at FROM project_context_sessions WHERE context_id=?').get('context-1').revoked_at, null);
});

test('a real different principal cannot reuse another principal session even with valid shared membership', async t => {
  const h = setup(t);
  user(h, { user_id: 'other-1', email: 'other@example.test', display_name: 'Other One' });
  member(h, { membership_id: 'other-membership', user_id: 'other-1' });
  insert(h, 'project_memberships', { membership_id: 'other-project-member', project_access_id: 'access-1', organization_id: 'org-1',
    project_id: 'project-1', user_id: 'other-1', role: 'editor', status: 'active', revoked_at: null, updated_at: PAST });
  const request = selection({ headers: { 'oai-authenticated-user-id': 'other-1', 'oai-authenticated-user-email': 'other@example.test',
    'oai-authenticated-user-full-name': encodeURIComponent('Other One') } });
  const actor = await principal(h, request);
  assert.equal(actor.userId, 'other-1'); assert.equal(actor.access.projects[0].projectAccessId, 'access-1');
  await refused(await context(h, request, actor), request);
  assert.deepEqual(contextReads(h)[0].bindings.slice(0, 5), ['other-1', 'other-1', 'other-1', 'context-1', 'other-1']);
});

test('fresh context SQL rejects missing/expired/revoked/mismatched sessions using the actual earlier principal', async t => {
  for (const change of ['missing', 'expired', 'revoked', 'principal', 'organization', 'project_access']) {
    const h = setup(t), request = selection(), actor = await principal(h, request);
    if (change === 'missing') h.db.prepare('DELETE FROM project_context_sessions').run();
    if (change === 'expired') h.db.prepare('UPDATE project_context_sessions SET expires_at=?').run(PAST);
    if (change === 'revoked') h.db.prepare('UPDATE project_context_sessions SET revoked_at=?').run(PAST);
    if (change === 'principal') h.db.prepare('UPDATE project_context_sessions SET principal_user_id=?').run('other-1');
    if (change === 'organization') h.db.prepare('UPDATE project_context_sessions SET organization_id=?').run('other-org');
    if (change === 'project_access') h.db.prepare('UPDATE project_context_sessions SET project_access_id=?').run('other-access');
    await refused(await context(h, request, actor), request); assert.equal(contextReads(h).length, 1);
  }
});

test('fresh membership/owner/project/organization/migration predicates reject revocation after genuine principal resolution', async t => {
  for (const change of ['member_missing', 'member_unaccepted', 'member_revoked', 'owner_missing', 'owner_unaccepted', 'owner_revoked',
    'project_member_missing', 'project_member_revoked', 'project_member_mismatch', 'project_inactive', 'organization_inactive',
    'migration_missing', 'migration_inactive', 'migration_organization', 'migration_access']) {
    const h = setup(t), request = selection(), actor = await principal(h, request);
    if (change === 'member_missing') h.db.prepare('DELETE FROM organization_memberships WHERE membership_id=?').run('membership-1');
    if (change === 'member_unaccepted') h.db.prepare('UPDATE organization_memberships SET accepted_at=NULL WHERE membership_id=?').run('membership-1');
    if (change === 'member_revoked') h.db.prepare('UPDATE organization_memberships SET revoked_at=? WHERE membership_id=?').run(PAST, 'membership-1');
    if (change === 'owner_missing') h.db.prepare('DELETE FROM organization_memberships WHERE membership_id=?').run('owner-membership');
    if (change === 'owner_unaccepted') h.db.prepare('UPDATE organization_memberships SET accepted_at=NULL WHERE membership_id=?').run('owner-membership');
    if (change === 'owner_revoked') h.db.prepare('UPDATE organization_memberships SET revoked_at=? WHERE membership_id=?').run(PAST, 'owner-membership');
    if (change === 'project_member_missing') h.db.prepare('DELETE FROM project_memberships').run();
    if (change === 'project_member_revoked') h.db.prepare('UPDATE project_memberships SET revoked_at=?').run(PAST);
    if (change === 'project_member_mismatch') h.db.prepare('UPDATE project_memberships SET project_id=?').run('other-project');
    if (change === 'project_inactive') h.db.prepare('UPDATE organization_projects SET status=?').run('inactive');
    if (change === 'organization_inactive') h.db.prepare('UPDATE organizations SET status=?').run('inactive');
    if (change === 'migration_missing') h.db.prepare('DELETE FROM project_migration_states').run();
    if (change === 'migration_inactive') h.db.prepare('UPDATE project_migration_states SET status=?').run('migrating');
    if (change === 'migration_organization') h.db.prepare('UPDATE project_migration_states SET organization_id=?').run('other-org');
    if (change === 'migration_access') h.db.prepare('UPDATE project_migration_states SET project_access_id=?').run('other-access');
    await refused(await context(h, request, actor), request);
  }
  // Migration tests cover exactly the current access/org/status join, not
  // nonexistent project/owner/head/expiry guards or last-await disclosure.
});

test('effective cohort enrollment is rechecked by context SQL without substituting R7 entry-date semantics', async t => {
  for (const status of ['active', 'paused', 'closed']) {
    const h = setup(t), request = selection(), actor = await principal(h, request);
    cohort(h, { status });
    await refused(await context(h, request, actor), request);
    participant(h); accepted(await context(h, request, actor));
  }
  for (const change of ['wrong_user', 'wrong_organization', 'inactive', 'revoked', 'missing']) {
    const h = setup(t); cohort(h); participant(h);
    const request = selection(), actor = await principal(h, request);
    if (change === 'wrong_user') h.db.prepare('UPDATE pilot_participants SET user_id=?').run('other-1');
    if (change === 'wrong_organization') h.db.prepare('UPDATE pilot_participants SET organization_id=?').run('other-org');
    if (change === 'inactive') h.db.prepare('UPDATE pilot_participants SET status=?').run('inactive');
    if (change === 'revoked') h.db.prepare('UPDATE pilot_participants SET revoked_at=?').run(PAST);
    if (change === 'missing') h.db.prepare('DELETE FROM pilot_participants').run();
    await refused(await context(h, request, actor), request);
  }
});

test('closed-cohort successor behavior uses actual status-only context policy, not an invented date window', async t => {
  const h = setup(t), request = selection(), actor = await principal(h, request);
  cohort(h, { status: 'closed' });
  cohort(h, { cohort_id: 'successor', status: 'active', starts_at: FUTURE, ends_at: FUTURE });
  participant(h, { cohort_id: 'successor' });
  accepted(await context(h, request, actor));
  h.db.prepare('UPDATE pilot_cohorts SET status=? WHERE cohort_id=?').run('inactive', 'successor');
  await refused(await context(h, request, actor), request);
  // Context policy contains no cohort date check. Configured pilot entry and
  // full endpoint composition are separate; this preserves the existing seam.
});

test('valid live context rows still require actual scoped capability from a fresh R7 access projection', async t => {
  const h = setup(t), request = selection();
  accepted(await context(h, request, await principal(h, request)));
  insert(h, 'organization_security_policies', { organization_id: 'org-1', authentication_source: 'cloudflare-access',
    allowed_domains_json: '[]', require_mfa: 0, version: 1, updated_at: PAST });
  const actor = await principal(h, request); // Non-custodial denial strips scopes but does not deny this creator.
  assert.equal(actor.access.identityPolicyDeniedCustody, false); assert.deepEqual(actor.access.deniedOrganizationIds, ['org-1']);
  assert.equal(hasCapability(actor, 'project.read', { organizationId: 'org-1', projectAccessId: 'access-1' }), false);
  await refused(await context(h, request, actor), request);
});

test('role-only changes use a fresh actual R7 projection and preserve read-only selection instead of global account denial', async t => {
  const h = setup(t), request = selection();
  accepted(await context(h, request, await principal(h, request)));
  h.db.prepare('UPDATE project_memberships SET role=?').run('viewer');
  const actor = await principal(h, request);
  accepted(await context(h, request, actor), { role: 'viewer' });
  assert.equal(actor.role, 'creator');
  // This is fresh Request→principal→context linkage, not a claim that context
  // alone refreshes a previously supplied principal's capability projection.
});

test('raw stale impersonation and actual R7 fictional users are rejected before context SQL with exact409 headers', async t => {
  const h = setup(t);
  const stale = selection({ headers: { cookie: 'forma_project_context=context-1; forma_impersonation=nonexistent-session' } });
  const actor = await principal(h, stale);
  assert.equal(actor.userId, AUTHOR); assert.equal(actor.fictional, undefined);
  await refused(await context(h, stale, actor), stale, 'project_context_impersonation_unavailable', 409);
  assert.equal(contextReads(h).length, 0);
  const malformed = selection({ headers: { cookie: 'forma_project_context=context-1; forma_impersonation=%broken' } });
  accepted(await context(h, malformed, await principal(h, malformed)));
  impersonation(h);
  const effectiveRequest = selection({ headers: { cookie: 'forma_project_context=context-1; forma_impersonation=impersonation-1' } });
  const fictional = await principal(h, effectiveRequest, { account: 'effective' });
  assert.equal(fictional.fictional, true); assert.equal(fictional.userId, 'fictional-1');
  const before = contextReads(h).length;
  await refused(await context(h, effectiveRequest, fictional), effectiveRequest, 'project_context_impersonation_unavailable', 409);
  // A separate resolver input isolates the fictional flag; it still uses the
  // exact R7-produced object, never {...principal, fictional:true}. This is not
  // a claimed same-HTTP-request endpoint journey.
  const withoutImpersonationCookie = selection();
  await refused(await context(h, withoutImpersonationCookie, fictional), withoutImpersonationCookie,
    'project_context_impersonation_unavailable', 409);
  assert.equal(contextReads(h).length, before);
});

test('actual missing context schema propagates a SQLite error without clearing it into a successful or revoked context', async t => {
  const h = setup(t), request = selection(), actor = await principal(h, request);
  h.db.exec('DROP TABLE project_context_sessions');
  await assert.rejects(() => context(h, request, actor), /no such table: project_context_sessions/u);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='project_context_sessions'").get().count, 0);
});
