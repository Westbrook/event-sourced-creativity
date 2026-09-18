import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Proposed finite existing-account qualification; authored here, not executed.
// Actual request reader, SQL/access/impersonation and separate real helpers only.
// No supplied completion DTO, successful lifecycle callback, schema bootstrap,
// mixed pilot/Runtime import, provider, native job or HTTP endpoint dispatch.
const rootInput = process.env.FORMA_EXPERIENCE_PRINCIPAL_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_PRINCIPAL_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-existing-principal-local-sqlite');
const modulePaths = [
  'worker/principal-request-core.ts', 'worker/policy-version.ts', 'worker/access-policy.ts',
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
  value: function forbiddenPrincipalFetch() { forbiddenFetchAttempts++; throw Error('Network forbidden in existing-principal qualification'); },
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
  assert.ok(allowed.has(file), `Unreviewed principal-reader dependency: ${file}`);
  return nextResolve(pathToFileURL(file).href, context);
}, load(url, context, nextLoad) {
  const file = realpathSync(fileURLToPath(url));
  assert.ok(allowed.has(file), `Unreviewed loaded principal-reader dependency: ${file}`);
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
  try { assert.equal(forbiddenFetchAttempts, 0, 'A forbidden fetch was attempted, even if a principal-reader catch swallowed its error'); }
  finally { cleanup(); }
});
let principalModule, POLICY_VERSION;
try {
  principalModule = await import(pathToFileURL(resolve(root, 'worker/principal-request-core.ts')).href);
  ({ POLICY_VERSION } = await import(pathToFileURL(resolve(root, 'worker/policy-version.ts')).href));
} catch (error) { cleanup(); throw error; }
// Keep the guard through tests: an unexpected late import must also fail closed.

const { readExistingPrincipalRequest: readPrincipal, requireConsent, hasCapability } = principalModule;
// Never call completePrincipalRequest with a fixture DTO. Every result below
// originates in a real Request and the actual reader's SQL/access path.
const PAST = '2000-01-01T00:00:00.000Z', FUTURE = '2999-01-01T00:00:00.000Z';
const AUTHOR = 'author-1', EMAIL = 'author@example.test', NAME = 'Author One';
const tables = ['users', 'capability_grants', 'organizations', 'organization_memberships', 'organization_projects',
  'project_memberships', 'pilot_cohorts', 'pilot_participants', 'organization_security_policies',
  'organization_identity_bindings', 'canvas_governance_requirements', 'project_event_scopes', 'events',
  'event_private_payloads', 'impersonation_sessions', 'replay_personas'];
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
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Principal reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      if (state.failNextRead) { state.failNextRead = false; throw Error('qualification_sql_read_failed'); }
      return db.prepare(sql).get(...bindings) ?? null;
    },
    async all() {
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Principal reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      return { results: db.prepare(sql).all(...bindings), success: true };
    },
    run() { state.forbiddenWrites++; throw Error('Principal reader attempted a lifecycle write'); },
  };
}
function harness(t, options = {}) {
  const db = database(), state = { reads: [], forbiddenWrites: 0, failNextRead: false };
  const env = { DB: { prepare: sql => prepared(db, state, sql),
    async batch() { state.forbiddenWrites++; throw Error('Principal reader attempted a lifecycle batch'); },
    async exec() { state.forbiddenWrites++; throw Error('Principal reader attempted schema/write execution'); },
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
async function read(h, request = requestFor(), minimum = 'creator', options = { account: 'principal' }) {
  const before = h.snapshot();
  try { return await readPrincipal(request, h.env, minimum, options); }
  finally { assert.deepEqual(h.snapshot(), before, 'Existing-account reader must not provision, update, link or initialize schema/counters'); }
}
function resolved(result, userId = AUTHOR) {
  assert.equal(Object.hasOwn(result, 'kind'), false);
  assert.equal(result.response, null);
  assert.equal(result.user.userId, userId);
  assert.ok(result.principal && typeof result.principal.access.permissionEpoch === 'string');
  return result.user;
}
async function denied(result, code, status) {
  assert.equal(Object.hasOwn(result, 'kind'), false);
  assert.ok(result.response instanceof Response); assert.equal(result.response.status, status);
  const body = await result.response.json(); assert.equal(body.error, code); assert.equal(result.user, null);
  return body;
}
function lifecycle(result, reason) {
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'reason', 'identity', 'row', 'admittedParticipant'].sort());
  assert.equal(result.kind, 'lifecycle-required'); assert.equal(result.reason, reason);
  for (const key of ['user', 'principal', 'impersonation', 'response']) assert.equal(Object.hasOwn(result, key), false);
  return result;
}
function organization(h, values = {}) {
  insert(h, 'organizations', { organization_id: 'org-1', name: 'Qualification organization', owner_user_id: 'owner-1', status: 'active', updated_at: PAST, ...values });
}
function member(h, values = {}) {
  insert(h, 'organization_memberships', { membership_id: 'membership-1', organization_id: 'org-1', user_id: AUTHOR,
    role: 'member', status: 'active', accepted_at: PAST, revoked_at: null, updated_at: PAST, ...values });
}
function pilot(h, { cohort = {}, participant = {}, withParticipant = true } = {}) {
  h.env.FORMA_PILOT_COHORT_ID = 'cohort-1';
  if (!h.db.prepare('SELECT 1 FROM organizations WHERE organization_id=?').get('org-1')) organization(h);
  insert(h, 'pilot_cohorts', { cohort_id: 'cohort-1', organization_id: 'org-1', status: 'active', starts_at: PAST,
    ends_at: FUTURE, created_at: PAST, participant_cap_microusd: 1, ...cohort });
  if (withParticipant) insert(h, 'pilot_participants', { participant_id: 'participant-1', cohort_id: 'cohort-1', organization_id: 'org-1',
    email_normalized: EMAIL, user_id: AUTHOR, status: 'active', revoked_at: null, role: 'participant', ...participant });
}
function project(h, { membershipRole = 'member', projectRole = 'editor' } = {}) {
  organization(h); member(h, { role: membershipRole });
  member(h, { membership_id: 'owner-membership', user_id: 'owner-1', role: 'owner' });
  insert(h, 'organization_projects', { project_access_id: 'access-1', organization_id: 'org-1', project_id: 'project-1',
    owner_user_id: 'owner-1', status: 'active', updated_at: PAST });
  insert(h, 'project_memberships', { membership_id: 'project-member-1', project_access_id: 'access-1', organization_id: 'org-1',
    project_id: 'project-1', user_id: AUTHOR, role: projectRole, status: 'active', revoked_at: null, updated_at: PAST });
}
function policy(h, values = {}, { ownsData = true, binding = {} } = {}) {
  organization(h, { owner_user_id: ownsData ? AUTHOR : 'other-owner' }); member(h);
  insert(h, 'organization_security_policies', { organization_id: 'org-1', authentication_source: 'openai-workspace',
    allowed_domains_json: '["example.test"]', require_mfa: 0, version: 1, updated_at: PAST, ...values });
  if (binding !== false) insert(h, 'organization_identity_bindings', { organization_id: 'org-1', user_id: AUTHOR,
    status: 'active', authentication_source: 'openai-workspace', subject: AUTHOR, updated_at: PAST, ...binding });
}
function impersonation(h, { session = {}, persona = {}, fictional = {} } = {}) {
  user(h, { user_id: 'fictional-1', email: 'fictional@example.test', display_name: 'Stored fictional name', role: 'creator', ...fictional });
  insert(h, 'replay_personas', { persona_id: 'persona-1', display_name: 'Fictional persona', status: 'ready', ...persona });
  insert(h, 'impersonation_sessions', { impersonation_id: 'impersonation-1', actor_user_id: AUTHOR, persona_id: 'persona-1',
    fictional_user_id: 'fictional-1', status: 'active', expires_at: FUTURE, updated_at: PAST,
    replay_session_id: 'replay-1', started_at: PAST, ...session });
}
const impersonationRequest = (values = {}) => requestFor({ ...values,
  headers: { cookie: 'forma_impersonation=impersonation-1', ...values.headers } });
const impersonationReads = h => h.state.reads.filter(row => /FROM impersonation_sessions\b/u.test(row.sql)).length;
const principalReads = h => h.state.reads.filter(row => /FROM \(SELECT \* FROM users WHERE user_id=\?\) principal/u.test(row.sql)).length;

test('actual existing creator/admin requests resolve from SQL with exact snapshots and no lifecycle work', async t => {
  for (const role of ['creator', 'admin']) {
    const h = harness(t, { user: { role } }), result = await read(h), actor = resolved(result);
    assert.equal(actor, result.principal); assert.equal(result.impersonation, null);
    assert.equal(actor.email, EMAIL); assert.equal(actor.displayName, NAME); assert.equal(actor.role, role);
    assert.equal(actor.streamId, `creative:${AUTHOR}`);
    assert.equal(actor.consentVersion, POLICY_VERSION);
    assert.deepEqual(actor.authorizationSnapshot, { updatedAt: PAST, rawEpoch: PAST, grants: '[]', organizations: '[]', projects: '[]',
      identityPolicies: '[]', canvasRequirements: 0 });
    assert.match(actor.access.permissionEpoch, /^[a-f0-9]{64}$/u);
    assert.equal(hasCapability(actor, 'self.profile.read'), true);
    assert.equal(hasCapability(actor, 'project.author'), false); // No selected/admitted project scope.
    assert.equal(principalReads(h), 1); assert.equal(impersonationReads(h), 0);
  }
});

test('hosted absent/partial identity and bare Cloudflare email fail before SQL and preserve early result shape', async t => {
  for (const headers of [{}, { 'oai-authenticated-user-id': AUTHOR }, { 'oai-authenticated-user-email': EMAIL },
    { 'cf-access-authenticated-user-email': EMAIL }]) {
    const h = harness(t), result = await read(h, requestFor({ identity: false, headers }), 'invalid-minimum');
    await denied(result, 'authentication_required', 401);
    assert.equal(Object.hasOwn(result, 'principal'), false); assert.equal(Object.hasOwn(result, 'impersonation'), false);
    assert.equal(h.state.reads.length, 0);
  }
});

test('local fallback and trusted-header precedence follow parsed URL hostname without bootstrapping a local account', async t => {
  const h = harness(t);
  user(h, { user_id: 'dev-local-creative', email: 'creative@local.forma', display_name: 'Local creative' });
  for (const hostname of ['localhost', '127.0.0.1']) {
    const url = `http://${hostname}/api/experiences/drafts`;
    resolved(await read(h, requestFor({ url, identity: false })), 'dev-local-creative');
    resolved(await read(h, requestFor({ url, identity: false, headers: { 'oai-authenticated-user-id': 'partial' } })), 'dev-local-creative');
    resolved(await read(h, requestFor({ url })), AUTHOR);
  }
  for (const hostname of ['localhost.', '[::1]']) await denied(await read(h,
    requestFor({ url: `http://${hostname}/api/experiences/drafts`, identity: false })), 'authentication_required', 401);
});

test('name marker/percent decoding and email-prefix fallback preserve exact observed identity', async t => {
  for (const [encoded, marker, expected] of [[encodeURIComponent('Renée + One'), 'percent-encoded-utf-8', 'Renée + One'],
    ['Ren%C3%A9e', 'wrong-marker', 'AUTHOR'], ['%broken', 'percent-encoded-utf-8', 'AUTHOR'],
    ['Name+One', 'percent-encoded-utf-8', 'Name+One'], [null, null, 'AUTHOR']]) {
    const h = harness(t, { user: { display_name: expected } });
    const actor = resolved(await read(h, requestFor({ headers: { 'oai-authenticated-user-email': 'AUTHOR@EXAMPLE.TEST',
      'oai-authenticated-user-full-name': encoded, 'oai-authenticated-user-full-name-encoding': marker } })));
    assert.equal(actor.email, EMAIL); assert.equal(actor.displayName, expected);
  }
});

test('missing account and allowed profile change return disjoint lifecycle-required before final role validation', async t => {
  const missing = harness(t, { user: false });
  const result = lifecycle(await read(missing, requestFor(), 'invalid-minimum'), 'missing-account');
  assert.equal(result.row, null); assert.equal(result.admittedParticipant, null);
  assert.deepEqual(result.identity, { userId: AUTHOR, email: EMAIL, displayName: NAME, source: 'openai-workspace' });
  for (const changed of [{ email: 'previous@example.test' }, { display_name: 'Previous name' }]) {
    const h = harness(t, { user: { role: 'invalid-role', ...changed } });
    const next = lifecycle(await read(h, requestFor(), 'invalid-minimum'), 'profile-update');
    assert.equal(next.row.user_id, AUTHOR); assert.equal(next.row.role, 'invalid-role');
    for (const [key, value] of Object.entries(changed)) assert.equal(next.row[key], value);
    assert.equal(next.identity.email, EMAIL); assert.equal(next.identity.displayName, NAME);
  }
});

test('unlinked admitted participant is lifecycle-required, after missing-account/profile precedence and before role validation', async t => {
  for (const [userOptions, reason] of [[false, 'missing-account'], [{ role: 'invalid-role', display_name: 'Previous name' }, 'profile-update'],
    [{ role: 'invalid-role' }, 'participant-link']]) {
    const h = harness(t, { user: userOptions }); pilot(h, { participant: { user_id: null } });
    const result = lifecycle(await read(h, requestFor(), 'invalid-minimum'), reason);
    assert.equal(result.admittedParticipant.participant_id, 'participant-1'); assert.equal(result.admittedParticipant.user_id, null);
    assert.equal(result.admittedParticipant.cohort_id, 'cohort-1');
    assert.equal(h.db.prepare('SELECT user_id FROM pilot_participants').get().user_id, null);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='cost_budget_counters'").get().count, 0);
  }
});

test('active and paused configured cohorts admit an already linked account through real entry SQL', async t => {
  for (const status of ['active', 'paused']) {
    const h = harness(t); pilot(h, { cohort: { status } });
    resolved(await read(h)); assert.equal(principalReads(h), 1);
    assert.ok(h.state.reads.some(row => /FROM pilot_cohorts cohort JOIN organizations/u.test(row.sql)));
  }
});

test('configured pilot denial precedes account lookup/profile/role and preserves exact participation checks', async t => {
  const variants = [
    { withParticipant: false }, { participant: { status: 'revoked' } }, { participant: { revoked_at: PAST } },
    { participant: { user_id: 'different-user' } }, { participant: { email_normalized: 'other@example.test' } },
    { cohort: { ends_at: PAST } }, { cohort: { starts_at: FUTURE } }, { cohort: { status: 'closed' } },
  ];
  for (const options of variants) {
    const h = harness(t, { user: { display_name: 'Previous name', role: 'invalid-role' } }); pilot(h, options);
    const result = await read(h, requestFor(), 'invalid-minimum');
    await denied(result, 'pilot_participant_required', 403);
    assert.equal(Object.hasOwn(result, 'principal'), false); assert.equal(principalReads(h), 0);
  }
  const h = harness(t); pilot(h); h.db.prepare('UPDATE organizations SET status=?').run('inactive');
  await denied(await read(h), 'pilot_participant_required', 403); assert.equal(principalReads(h), 0);
});

test('configured breakglass and exact owner-recovery exceptions remain distinct from general account authority', async t => {
  const bypass = harness(t); pilot(bypass, { withParticipant: false });
  bypass.env.FORMA_ADMIN_EMAILS = ` other@example.test, ${EMAIL.toUpperCase()} `;
  resolved(await read(bypass)); // Existing creator role is unchanged; this is not an admin promotion.
  assert.equal((await read(bypass)).principal.role, 'creator');
  for (const cohort of [{ status: 'closed' }, { ends_at: PAST }, { starts_at: FUTURE }]) {
    const h = harness(t); pilot(h, { cohort, withParticipant: false }); member(h, { role: 'owner' });
    resolved(await read(h));
    insert(h, 'pilot_cohorts', { cohort_id: 'successor', organization_id: 'org-1', status: 'active', starts_at: PAST,
      ends_at: FUTURE, created_at: '2001-01-01T00:00:00.000Z', participant_cap_microusd: 1 });
    await denied(await read(h), 'pilot_participant_required', 403);
  }
});

test('a successor cohort uses its actual enrollment and does not reuse a closed-cohort participant', async t => {
  const h = harness(t); pilot(h, { cohort: { status: 'closed' } });
  insert(h, 'pilot_cohorts', { cohort_id: 'successor', organization_id: 'org-1', status: 'active', starts_at: PAST,
    ends_at: FUTURE, created_at: '2001-01-01T00:00:00.000Z', participant_cap_microusd: 1 });
  await denied(await read(h), 'pilot_participant_required', 403);
  insert(h, 'pilot_participants', { participant_id: 'successor-member', cohort_id: 'successor', organization_id: 'org-1',
    email_normalized: EMAIL, user_id: AUTHOR, status: 'active', revoked_at: null, role: 'participant' });
  resolved(await read(h));
});

test('invalid/insufficient roles retain result shapes and precede impersonation, while the default minimum remains viewer', async t => {
  for (const [role, minimum] of [['invalid-role', 'creator'], ['creator', 'invalid-minimum']]) {
    const h = harness(t, { user: { role } }), result = await read(h, impersonationRequest(), minimum);
    await denied(result, 'invalid_account_role', 403);
    assert.equal(result.principal, null); assert.equal(result.impersonation, null); assert.equal(impersonationReads(h), 0);
  }
  for (const role of ['viewer', 'agent']) {
    const h = harness(t, { user: { role } }); impersonation(h);
    const result = await read(h, impersonationRequest(), 'creator');
    assert.deepEqual(await denied(result, 'insufficient_role', 403), { error: 'insufficient_role', required: 'creator', role });
    assert.equal(result.principal.role, role); assert.equal(result.impersonation, null); assert.equal(impersonationReads(h), 0);
    const before = h.snapshot(); resolved(await readPrincipal(requestFor(), h.env));
    assert.deepEqual(h.snapshot(), before); // Actual omitted arguments exercise the production default, not a fixture default.
  }
});

test('real identity policies deny custody before profile/role on source/domain/MFA/binding failures', async t => {
  const variants = [
    [{ authentication_source: 'cloudflare-access' }, {}], [{ authentication_source: 'unknown-source' }, {}],
    [{ allowed_domains_json: '["other.test"]' }, {}], [{ allowed_domains_json: '["EXAMPLE.TEST"]' }, {}],
    [{ allowed_domains_json: '{invalid' }, {}], [{ allowed_domains_json: '{}' }, {}], [{ require_mfa: 1 }, {}],
    [{}, { status: 'revoked' }], [{}, { authentication_source: 'local-development' }], [{}, { subject: 'other-subject' }],
  ];
  for (const [values, binding] of variants) {
    const h = harness(t, { user: { role: 'invalid-role', display_name: 'Previous name' } });
    policy(h, values, { binding });
    const result = await read(h, requestFor(), 'invalid-minimum');
    await denied(result, 'organization_identity_policy_required', 403);
    assert.equal(result.principal, null); assert.equal(result.impersonation, null);
  }
  for (const binding of [{}, false]) {
    const h = harness(t); policy(h, {}, { binding });
    const actor = resolved(await read(h));
    assert.deepEqual(actor.access.deniedOrganizationIds, []);
    assert.equal(actor.access.organizations[0].organizationId, 'org-1');
  }
  // Missing binding is not automatically denied by the existing predicate.
});

test('non-custodial policy denial narrows scopes, while changed email plus a denied organization is refused', async t => {
  const h = harness(t); policy(h, { allowed_domains_json: '["other.test"]' }, { ownsData: false });
  const actor = resolved(await read(h));
  assert.deepEqual(actor.access.deniedOrganizationIds, ['org-1']);
  assert.deepEqual(actor.access.organizations, []); assert.deepEqual(actor.access.projects, []);
  assert.equal(actor.access.identityPolicyDeniedCustody, false);
  assert.equal(hasCapability(actor, 'self.profile.read'), true);
  assert.equal(hasCapability(actor, 'workspace.member.read', { organizationId: 'org-1' }), false);
  h.db.prepare('UPDATE users SET email=? WHERE user_id=?').run('previous@example.test', AUTHOR);
  await denied(await read(h), 'organization_identity_policy_required', 403);
  h.db.prepare('UPDATE users SET email=?,display_name=? WHERE user_id=?').run(EMAIL, 'Previous name', AUTHOR);
  lifecycle(await read(h), 'profile-update'); // Name-only update is not the extra changed-email denial.
});

test('real grant filtering preserves scope/status/expiry and fresh permission-epoch changes without denying the creator', async t => {
  const h = harness(t), baseline = resolved(await read(h));
  assert.equal(hasCapability(baseline, 'design.docs.read'), false);
  insert(h, 'capability_grants', { grant_id: 'grant-1', user_id: AUTHOR, capability: 'design.docs.read', scope_type: 'synthetic',
    organization_id: null, project_access_id: null, status: 'active', revoked_at: null, expires_at: FUTURE, updated_at: PAST });
  const active = resolved(await read(h));
  assert.equal(hasCapability(active, 'design.docs.read'), true);
  assert.notEqual(active.access.permissionEpoch, baseline.access.permissionEpoch);
  assert.equal(active.access.grants.length, 1);
  for (const change of [{ status: 'revoked' }, { revoked_at: PAST }, { expires_at: PAST },
    { scope_type: 'self' }, { organization_id: 'unexpected-org' }]) {
    h.db.prepare('UPDATE capability_grants SET status=?,revoked_at=NULL,expires_at=?,scope_type=?,organization_id=NULL WHERE grant_id=?')
      .run('active', FUTURE, 'synthetic', 'grant-1');
    for (const [key, value] of Object.entries(change)) {
      assert.ok(['status', 'revoked_at', 'expires_at', 'scope_type', 'organization_id'].includes(key));
      h.db.prepare(`UPDATE capability_grants SET ${key}=? WHERE grant_id=?`).run(value, 'grant-1');
    }
    const changed = resolved(await read(h));
    assert.equal(changed.role, 'creator'); assert.equal(hasCapability(changed, 'design.docs.read'), false);
    assert.notEqual(changed.access.permissionEpoch, active.access.permissionEpoch);
  }
  // Far-past expiry is an actual SQL predicate input, not a simulated clock or
  // proof about a same-request revocation/final-disclosure race.
});

test('real membership/project SQL scopes capabilities and revocation removes access without a global account denial', async t => {
  const scope = { organizationId: 'org-1', projectAccessId: 'access-1' };
  for (const change of ['member_revoked', 'owner_revoked', 'project_member_revoked', 'organization_inactive', 'project_inactive']) {
    const h = harness(t); project(h);
    const before = resolved(await read(h));
    assert.equal(hasCapability(before, 'project.author', scope), true);
    assert.equal(hasCapability(before, 'project.author'), false);
    assert.equal(hasCapability(before, 'project.author', { ...scope, organizationId: 'other-org' }), false);
    assert.equal(before.access.projects[0].projectName, ''); // No creator-content fixture.
    if (change === 'member_revoked') h.db.prepare('UPDATE organization_memberships SET revoked_at=? WHERE membership_id=?').run(PAST, 'membership-1');
    if (change === 'owner_revoked') h.db.prepare('UPDATE organization_memberships SET revoked_at=? WHERE membership_id=?').run(PAST, 'owner-membership');
    if (change === 'project_member_revoked') h.db.prepare('UPDATE project_memberships SET revoked_at=?').run(PAST);
    if (change === 'organization_inactive') h.db.prepare('UPDATE organizations SET status=?').run('inactive');
    if (change === 'project_inactive') h.db.prepare('UPDATE organization_projects SET status=?').run('inactive');
    const after = resolved(await read(h));
    assert.equal(hasCapability(after, 'project.author', scope), false);
    assert.equal(hasCapability(after, 'self.profile.read'), true);
    assert.deepEqual(after.access.projects, []);
    assert.notEqual(after.access.permissionEpoch, before.access.permissionEpoch);
  }
  const reviewer = harness(t); project(reviewer); pilot(reviewer, { participant: { role: 'reviewer' } });
  const actor = resolved(await read(reviewer));
  assert.equal(actor.access.projects[0].role, 'viewer');
  assert.equal(hasCapability(actor, 'project.author', scope), false);
  assert.equal(hasCapability(actor, 'project.read', scope), true);
});

test('authorization snapshot retains actual SQL aggregates/epoch rather than a supplied access DTO', async t => {
  const h = harness(t); project(h);
  const updated = '2002-01-01T00:00:00.000Z';
  insert(h, 'capability_grants', { grant_id: 'grant-1', user_id: AUTHOR, capability: 'design.docs.read', scope_type: 'synthetic',
    organization_id: null, project_access_id: null, status: 'active', revoked_at: null, expires_at: FUTURE, updated_at: updated });
  const actor = resolved(await read(h)), snapshot = actor.authorizationSnapshot;
  assert.equal(snapshot.updatedAt, PAST); assert.equal(snapshot.rawEpoch, updated);
  assert.deepEqual(JSON.parse(snapshot.grants), [{ capability: 'design.docs.read', scope: 'synthetic', organizationId: null,
    projectAccessId: null, expiresAt: FUTURE }]);
  assert.deepEqual(JSON.parse(snapshot.organizations), [{ organizationId: 'org-1', name: 'Qualification organization', role: 'member' }]);
  assert.deepEqual(JSON.parse(snapshot.projects), [{ projectAccessId: 'access-1', projectId: 'project-1', projectName: '',
    organizationId: 'org-1', role: 'editor' }]);
  assert.equal(snapshot.identityPolicies, '[]'); assert.equal(snapshot.canvasRequirements, 0);
  const second = resolved(await read(h));
  assert.deepEqual(second.authorizationSnapshot, snapshot); assert.equal(second.access.permissionEpoch, actor.access.permissionEpoch);
});

test('consent remains a separate real helper: stale/missing version is428 but no new implicit reader gate exists', async t => {
  for (const version of [null, 'previous-policy', POLICY_VERSION]) {
    for (const consentedAt of [null, PAST]) {
      const h = harness(t, { user: { consent_version: version, consented_at: consentedAt } });
      const actor = resolved(await read(h)), before = h.snapshot(), response = requireConsent(actor);
      if (version === POLICY_VERSION) assert.equal(response, null);
      else {
        assert.equal(response.status, 428);
        assert.deepEqual(await response.json(), { error: 'pilot_terms_required', policyVersion: POLICY_VERSION });
      }
      assert.deepEqual(h.snapshot(), before);
    }
  }
});

test('cookie first-match and single-decode semantics suppress only the appropriate impersonation query', async t => {
  for (const cookie of [null, '', 'forma_impersonation=', 'forma_impersonation=%broken',
    'forma_impersonation_extra=impersonation-1', 'forma_impersonation=; forma_impersonation=impersonation-1',
    'forma_impersonation=%broken; forma_impersonation=impersonation-1']) {
    const h = harness(t); impersonation(h);
    resolved(await read(h, requestFor({ headers: { cookie } })));
    assert.equal(impersonationReads(h), 0);
  }
  for (const cookie of ['forma_impersonation=missing; forma_impersonation=impersonation-1',
    'forma_impersonation=impersonation%252D1']) {
    const h = harness(t); impersonation(h);
    resolved(await read(h, requestFor({ headers: { cookie } })));
    assert.equal(impersonationReads(h), 1);
  }
  const h = harness(t); impersonation(h);
  await denied(await read(h, requestFor({ headers: { cookie: 'forma_impersonation=impersonation%2D1' } })),
    'return_to_principal_before_internal_access', 409);
});

test('actual impersonation joins require matching actor, active unexpired session, ready persona and fictional user', async t => {
  for (const [kind, options] of [
    ['actor', { session: { actor_user_id: 'other-actor' } }], ['status', { session: { status: 'revoked' } }],
    ['expiry', { session: { expires_at: PAST } }], ['persona_status', { persona: { status: 'draft' } }],
    ['missing_persona', {}], ['missing_user', {}],
  ]) {
    const h = harness(t); impersonation(h, options);
    if (kind === 'missing_persona') h.db.prepare('DELETE FROM replay_personas').run();
    if (kind === 'missing_user') h.db.prepare('DELETE FROM users WHERE user_id=?').run('fictional-1');
    const result = await read(h, impersonationRequest()); resolved(result);
    assert.equal(result.impersonation, null); assert.equal(impersonationReads(h), 1);
  }
});

test('principal-only account mode rejects active impersonation except the exact existing pathname exception', async t => {
  const h = harness(t); impersonation(h);
  const result = await read(h, impersonationRequest());
  await denied(result, 'return_to_principal_before_internal_access', 409);
  assert.equal(result.principal.userId, AUTHOR); assert.equal(result.impersonation.impersonationId, 'impersonation-1');
  const before = impersonationReads(h);
  const exact = await read(h, impersonationRequest({ url: 'https://qualification.invalid/api/impersonation' }));
  resolved(exact); assert.equal(exact.impersonation, null); assert.equal(impersonationReads(h), before);
  await denied(await read(h, impersonationRequest({ url: 'https://qualification.invalid/api/impersonation/' })),
    'return_to_principal_before_internal_access', 409);
});

test('effective impersonation preserves real principal/billing identity and exact per-mutation confirmation', async t => {
  const h = harness(t); impersonation(h, { fictional: { role: 'viewer', consent_version: 'previous-policy' } });
  const result = await read(h, impersonationRequest(), 'creator', { account: 'effective' });
  const effective = resolved(result, 'fictional-1');
  assert.equal(result.principal.userId, AUTHOR); assert.equal(result.principal.role, 'creator');
  assert.equal(result.impersonation.actor, result.principal);
  assert.equal(effective.billingUserId, AUTHOR); assert.equal(effective.fictional, true);
  assert.equal(effective.streamId, 'creative:fictional-1'); assert.equal(effective.displayName, 'Fictional persona');
  assert.equal(effective.role, 'viewer'); assert.ok(effective.access.capabilities.includes('project.author'));
  assert.equal(effective.consentVersion, 'previous-policy'); // No implicit consent or fictional-role minimum gate.
  for (const confirmation of [null, 'I understand', 'i understand, continue', 'I understand,  continue']) {
    await denied(await read(h, impersonationRequest({ method: 'POST', headers: { 'x-forma-impersonation-confirmation': confirmation } }),
      'creator', { account: 'effective' }), 'impersonation_confirmation_required', 428);
  }
  resolved(await read(h, impersonationRequest({ method: 'POST', headers: { 'x-forma-impersonation-confirmation': 'I understand, continue' } }),
    'creator', { account: 'effective' }), 'fictional-1');
  // These are inert Request classifications only. No mutation endpoint is run.
});

test('effective-account mutation exemptions retain exact methods/path rules without dispatching any endpoint', async t => {
  const h = harness(t); impersonation(h);
  for (const method of ['GET', 'HEAD', 'OPTIONS']) resolved(await read(h, impersonationRequest({ method }),
    'creator', { account: 'effective' }), 'fictional-1');
  for (const path of ['/api/impersonation/end', '/api/replay-sessions/example', '/api/admin/example', '/api/session',
    '/api/document-jobs/example/run', '/api/document-jobs/example/ack']) {
    resolved(await read(h, impersonationRequest({ method: 'POST', url: `https://qualification.invalid${path}` }),
      'creator', { account: 'effective' }), 'fictional-1');
  }
  for (const path of ['/api/session/', '/api/document-jobs/example/run/']) await denied(await read(h,
    impersonationRequest({ method: 'POST', url: `https://qualification.invalid${path}` }), 'creator', { account: 'effective' }),
  'impersonation_confirmation_required', 428);
});

test('actual missing-schema failure is not bootstrapped; synthetic transport failure tests propagation only', async t => {
  const missing = harness(t); missing.db.exec('DROP TABLE users');
  await assert.rejects(() => read(missing), /no such table: users/u); // Actual SQLite prepare/lookup failure.
  assert.equal(missing.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='users'").get().count, 0);
  const transport = harness(t); transport.state.failNextRead = true;
  await assert.rejects(() => read(transport), /qualification_sql_read_failed/u);
  assert.equal(transport.state.failNextRead, false);
  // This second synthetic exception is propagation/effect-guard evidence only,
  // not a successful SQL query, policy computation or principal acceptance.
});
