import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Proposed finite intake-authority/original-receipt qualification; authored here, not executed.
// Actual R7 Request/SQL authorization feeds actual readOriginal then reply. No
// successful authority/receipt DTO, positive option guard, schema bootstrap,
// mixed module, provider, native job or endpoint dispatch is permitted.
const rootInput = process.env.FORMA_EXPERIENCE_INTAKE_AUTHORITY_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_INTAKE_AUTHORITY_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-intake-authority-local-sqlite');
const modulePaths = [
  'worker/intake-authority.ts', 'worker/project-intake-read.ts', 'worker/event-read-primitives.ts',
  'src/model/project-intake.ts', 'src/model/block-types.ts', 'worker/principal-request-core.ts', 'worker/policy-version.ts', 'worker/access-policy.ts',
  'src/platform/capabilities.ts', 'worker/canvas-governance-policy.ts', 'worker/image-adapter-evaluation-evidence.ts',
];
assert.deepEqual(manifest.modules.map(entry => entry.path).sort(), [...modulePaths].sort(), 'Exact reviewed closure only');
assert.deepEqual(manifest.extensionlessEdges, [{ from: 'src/model/project-intake.ts', specifier: './block-types', to: 'src/model/block-types.ts' }],
  'Exactly one reviewed extensionless model edge; no generic resolution fallback');
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
  value: function forbiddenIntakeFetch() { forbiddenFetchAttempts++; throw Error('Network forbidden in intake-authority qualification'); },
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
  const parentFile = context.parentURL?.startsWith('file:') ? realpathSync(fileURLToPath(context.parentURL)) : null;
  // Sole reviewed extensionless edge. No generic extension guessing/fallback.
  const mapped = specifier === './block-types' && parentFile === resolve(root, 'src/model/project-intake.ts')
    ? resolve(root, 'src/model/block-types.ts') : null;
  const file = realpathSync(mapped ?? (specifier.startsWith('file:') ? fileURLToPath(specifier)
    : resolve(dirname(fileURLToPath(context.parentURL)), specifier)));
  assert.ok(allowed.has(file), `Unreviewed intake-reader dependency: ${file}`);
  return nextResolve(pathToFileURL(file).href, context);
}, load(url, context, nextLoad) {
  const file = realpathSync(fileURLToPath(url));
  assert.ok(allowed.has(file), `Unreviewed loaded intake-reader dependency: ${file}`);
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
  try { assert.equal(forbiddenFetchAttempts, 0, 'A forbidden fetch was attempted, even if an intake-reader catch swallowed its error'); }
  finally { cleanup(); }
});
let principalModule, intakeReadModule, intakeModel, authorityModule, POLICY_VERSION;
try {
  principalModule = await import(pathToFileURL(resolve(root, 'worker/principal-request-core.ts')).href);
  intakeReadModule = await import(pathToFileURL(resolve(root, 'worker/project-intake-read.ts')).href);
  intakeModel = await import(pathToFileURL(resolve(root, 'src/model/project-intake.ts')).href);
  authorityModule = await import(pathToFileURL(resolve(root, 'worker/intake-authority.ts')).href);
  ({ POLICY_VERSION } = await import(pathToFileURL(resolve(root, 'worker/policy-version.ts')).href));
} catch (error) { cleanup(); throw error; }
// Keep the guard through tests: an unexpected late import must also fail closed.

const { readExistingPrincipalRequest: readPrincipal } = principalModule;
const { readOriginal, reply } = intakeReadModule;
const { projectIntake, projectIntakeReceiptPrefix, projectIntakeReceiptKey, projectIntakeValue } = intakeModel;
const { configuredPilotAdmissionGuard, projectIntakeAuthority } = authorityModule;
const issuedAuthorizations = new WeakSet();
// Never call completePrincipalRequest with a fixture DTO. Every result below
// originates in a real Request and the actual reader's SQL/access path.
const PAST = '2000-01-01T00:00:00.000Z', FUTURE = '2999-01-01T00:00:00.000Z';
const AUTHOR = 'author-1', EMAIL = 'author@example.test', NAME = 'Author One';
const tables = ['users', 'capability_grants', 'organizations', 'organization_memberships', 'organization_projects',
  'project_memberships', 'pilot_cohorts', 'pilot_participants', 'organization_security_policies',
  'organization_identity_bindings', 'canvas_governance_requirements', 'project_event_scopes', 'events',
  'event_private_payloads', 'impersonation_sessions', 'replay_personas', 'event_client_receipts', 'project_resource_scopes'];
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
    CREATE TABLE event_client_receipts(stream_id TEXT,client_event_id TEXT,event_id TEXT NOT NULL,sequence INTEGER,PRIMARY KEY(stream_id,client_event_id));
    CREATE TABLE project_resource_scopes(owner_user_id TEXT,resource_kind TEXT,resource_id TEXT,PRIMARY KEY(owner_user_id,resource_kind,resource_id));
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
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Intake reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      return db.prepare(sql).get(...bindings) ?? null;
    },
    async all() {
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Intake reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      return { results: db.prepare(sql).all(...bindings), success: true };
    },
    run() { state.forbiddenWrites++; throw Error('Intake reader attempted a lifecycle write'); },
  };
}
function harness(t, options = {}) {
  const db = database(), state = { reads: [], forbiddenWrites: 0 };
  const env = { DB: { prepare: sql => prepared(db, state, sql),
    async batch() { state.forbiddenWrites++; throw Error('Intake reader attempted a lifecycle batch'); },
    async exec() { state.forbiddenWrites++; throw Error('Intake reader attempted schema/write execution'); },
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
async function authorization(h, request = requestFor(), options = { account: 'principal' }, minimum = 'creator') {
  const before = h.snapshot();
  try {
    const result = await readPrincipal(request, h.env, minimum, options);
    assert.equal(Object.hasOwn(result, 'kind'), false, 'Lifecycle-required is unqualified and cannot supply intake authority');
    assert.equal(result.response, null, 'Only a real R7 existing-account result can supply intake authority');
    assert.ok(result.user && result.principal);
    issuedAuthorizations.add(result);
    return result; // Original authorization object, never a supplied/mutated authority DTO.
  } finally { assert.deepEqual(h.snapshot(), before, 'R7 linkage must remain read-only'); }
}
async function readAndReply(h, auth, intake, options) {
  assert.ok(issuedAuthorizations.has(auth), 'Only an actual R7-issued authorization object can enter this fixture');
  const before = h.snapshot();
  try {
    const state = await readOriginal(h.env, auth, intake, options);
    const response = reply(intake, state); // Actual returned state; no fabricated ReceiptState.
    return { state, response };
  } finally { assert.deepEqual(h.snapshot(), before, 'Receipt read/formatter must not append, replace, repair or mutate'); }
}
function uuid(number) { return `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`; }
const PROJECT = uuid(1001), DOCUMENT = uuid(1002), PRIVATE_TITLE = 'Qualification private title';
function intakeFor({ projectId = PROJECT, documentId = DOCUMENT, title = PRIVATE_TITLE } = {}) {
  const value = projectIntake([
    { type: 'ProjectCreated', payload: { project_id: projectId, name: 'Qualification project', state: 'active' } },
    { type: 'DocumentCreated', payload: { project_id: projectId, document_id: documentId, handle: 'qualification-document', title } },
    { type: 'EmptyCanvasChosen', payload: { project_id: projectId, document_id: documentId, source_surface: 'projects' } },
  ]);
  assert.ok(value, 'Fixture must pass the actual minimal intake grammar');
  return value;
}
function seedOriginal(h, auth, intake, { sequenceOffset = 0, idOffset = 0 } = {}) {
  assert.ok(issuedAuthorizations.has(auth));
  return intake.events.map((input, index) => {
    const eventId = uuid(2000 + idOffset + index), sequence = sequenceOffset + (index + 1) * 10;
    const row = { event_id: eventId, stream_id: auth.user.streamId, sequence, occurred_at: PAST, recorded_at: PAST,
      actor: 'user', client_id: 'qualification:retained-intake', correlation_id: `project-intake:${intake.projectId}`,
      causation_id: null, compensates_event_id: null, schema_version: 1, type: input.type, payload: '{"qualification_public":"redacted"}' };
    insert(h, 'events', row);
    insert(h, 'event_private_payloads', { private_event_id: eventId, owner_id: auth.user.userId,
      private_json: JSON.stringify(input.payload), redacted_at: null });
    insert(h, 'event_client_receipts', { stream_id: auth.user.streamId, client_event_id: input.payload.client_event_id,
      event_id: eventId, sequence });
    return { row, input };
  });
}
function expectedEvent({ row, input }) {
  return { eventId: row.event_id, streamId: row.stream_id, sequence: row.sequence, occurredAt: row.occurred_at,
    recordedAt: row.recorded_at, actor: row.actor, clientId: row.client_id, correlationId: row.correlation_id,
    causationId: row.causation_id, compensatesEventId: row.compensates_event_id, schemaVersion: row.schema_version,
    type: row.type, payload: input.payload };
}
async function completed(result, intake, seeded, head = seeded.at(-1).row.sequence) {
  assert.equal(result.state.authorized, true); assert.equal(result.state.seen, true); assert.equal(result.state.complete, true);
  assert.equal(result.response.status, 200); assert.equal(result.response.headers.get('cache-control'), 'private, no-store');
  const events = seeded.map(expectedEvent);
  assert.deepEqual(result.state.events, events); assert.equal(result.state.head, head);
  const body = await result.response.json();
  assert.deepEqual(body, { status: 'complete', projectId: intake.projectId, documentId: intake.documentId,
    appended: events, rejected: [], head });
  return body;
}
async function unavailable(result, intake, error = 'project_intake_original_unavailable', status = 409) {
  assert.equal(result.state.complete, false); assert.deepEqual(result.state.events, []);
  assert.equal(result.response.status, status); assert.equal(result.response.headers.get('cache-control'), 'private, no-store');
  const text = await result.response.text(); assert.equal(text.includes(PRIVATE_TITLE), false, 'Failure must not disclose retained title');
  assert.deepEqual(JSON.parse(text), { status: 'unknown', projectId: intake.projectId, documentId: intake.documentId, error });
}
const receiptReads = h => h.state.reads.filter(row => /FROM json_each\(\?\) expected/u.test(row.sql));
function organization(h, values = {}) {
  insert(h, 'organizations', { organization_id: 'org-1', name: 'Qualification organization', owner_user_id: 'owner-1', status: 'active', updated_at: PAST, ...values });
}
function member(h, values = {}) {
  insert(h, 'organization_memberships', { membership_id: 'membership-1', organization_id: 'org-1', user_id: AUTHOR,
    role: 'member', status: 'active', accepted_at: PAST, revoked_at: null, updated_at: PAST, ...values });
}
function project(h) {
  organization(h); member(h); member(h, { membership_id: 'owner-membership', user_id: 'owner-1', role: 'owner' });
  insert(h, 'organization_projects', { project_access_id: 'access-1', organization_id: 'org-1', project_id: 'other-project',
    owner_user_id: 'owner-1', status: 'active', updated_at: PAST });
  insert(h, 'project_memberships', { membership_id: 'project-member-1', project_access_id: 'access-1', organization_id: 'org-1',
    project_id: 'other-project', user_id: AUTHOR, role: 'editor', status: 'active', revoked_at: null, updated_at: PAST });
}
function pilot(h, { cohort = {}, withParticipant = true } = {}) {
  h.env.FORMA_PILOT_COHORT_ID = 'cohort-1';
  if (!h.db.prepare('SELECT 1 FROM organizations WHERE organization_id=?').get('org-1')) organization(h);
  insert(h, 'pilot_cohorts', { cohort_id: 'cohort-1', organization_id: 'org-1', status: 'active', starts_at: PAST,
    ends_at: FUTURE, created_at: PAST, participant_cap_microusd: 1, ...cohort });
  if (withParticipant) insert(h, 'pilot_participants', { participant_id: 'participant-1', cohort_id: 'cohort-1', organization_id: 'org-1',
    email_normalized: EMAIL, user_id: AUTHOR, status: 'active', revoked_at: null, role: 'participant' });
}
function impersonation(h, { fictional = {} } = {}) {
  user(h, { user_id: 'fictional-1', email: 'fictional@example.test', display_name: 'Stored fictional name', role: 'creator', ...fictional });
  insert(h, 'replay_personas', { persona_id: 'persona-1', display_name: 'Fictional persona', status: 'ready' });
  insert(h, 'impersonation_sessions', { impersonation_id: 'impersonation-1', actor_user_id: AUTHOR, persona_id: 'persona-1',
    fictional_user_id: 'fictional-1', status: 'active', expires_at: FUTURE, updated_at: PAST, replay_session_id: 'replay-1', started_at: PAST });
}
const impersonationRequest = () => requestFor({ headers: { cookie: 'forma_impersonation=impersonation-1' } });
// Evaluate the actual emitted configured predicate against the same local SQL;
// this is an assertion of that guard, never an injected successful authority.
async function configuredAllows(h, auth) {
  const before = h.snapshot(), guard = configuredPilotAdmissionGuard(h.env, auth.principal);
  try { return Boolean(await h.env.DB.prepare(`SELECT 1 AS admitted WHERE ${guard.sql}`).bind(...guard.bindings).first()); }
  finally { assert.deepEqual(h.snapshot(), before); }
}

test('actual creator/admin Request and parser produce the exact original receipt without replacement', async t => {
  for (const role of ['creator', 'admin']) {
    const h = harness(t, { user: { role } }), auth = await authorization(h), intake = intakeFor();
    assert.equal(auth.user, auth.principal); assert.equal(auth.impersonation, null);
    assert.deepEqual(intake.events.map(event => event.payload.client_event_id), [0, 1, 2].map(index => projectIntakeReceiptKey(PROJECT, index)));
    const seeded = seedOriginal(h, auth, intake);
    const first = await completed(await readAndReply(h, auth, intake), intake, seeded);
    assert.deepEqual(await completed(await readAndReply(h, auth, intake), intake, seeded), first);
    assert.equal(receiptReads(h).length, 2);
    const read = receiptReads(h)[0], guard = projectIntakeAuthority(h.env, auth, intake);
    const prefix = projectIntakeReceiptPrefix(PROJECT), stream = auth.user.streamId;
    assert.deepEqual(read.bindings, [stream, prefix.length, prefix, stream,
      JSON.stringify(intake.events.map(event => event.payload.client_event_id)), stream, AUTHOR, ...guard.bindings]);
  }
});

test('absent originals, other prefixes and other principal namespaces remain unconfirmed rather than replaceable', async t => {
  const h = harness(t), auth = await authorization(h), intake = intakeFor();
  let result = await readAndReply(h, auth, intake);
  assert.equal(result.state.authorized, true); assert.equal(result.state.seen, false); assert.equal(result.state.head, 0);
  await unavailable(result, intake, 'project_intake_unconfirmed');
  const other = intakeFor({ projectId: uuid(1101), documentId: uuid(1102) });
  seedOriginal(h, auth, other);
  result = await readAndReply(h, auth, intake);
  assert.equal(result.state.seen, false); assert.equal(result.state.head, 30);
  await unavailable(result, intake, 'project_intake_unconfirmed');
  user(h, { user_id: 'second-1', email: 'second@example.test', display_name: 'Second One' });
  const second = await authorization(h, requestFor({ headers: { 'oai-authenticated-user-id': 'second-1',
    'oai-authenticated-user-email': 'second@example.test', 'oai-authenticated-user-full-name': encodeURIComponent('Second One') } }));
  const secondIntake = intakeFor(); seedOriginal(h, second, secondIntake, { idOffset: 10 });
  result = await readAndReply(h, auth, intake);
  assert.equal(result.state.seen, false); await unavailable(result, intake, 'project_intake_unconfirmed');
});

test('partial, extra and damaged receipt/event links are seen-unavailable with no partial event disclosure', async t => {
  const cases = [
    h => h.db.prepare('DELETE FROM event_client_receipts WHERE client_event_id=?').run(projectIntakeReceiptKey(PROJECT, 1)),
    h => insert(h, 'event_client_receipts', { stream_id: `creative:${AUTHOR}`, client_event_id: projectIntakeReceiptPrefix(PROJECT) + 'extra', event_id: uuid(9999), sequence: 9999 }),
    h => h.db.prepare('DELETE FROM events WHERE event_id=?').run(uuid(2001)),
    h => h.db.prepare('UPDATE event_client_receipts SET event_id=? WHERE client_event_id=?').run(uuid(9999), projectIntakeReceiptKey(PROJECT, 1)),
    h => h.db.prepare('UPDATE event_client_receipts SET sequence=99 WHERE client_event_id=?').run(projectIntakeReceiptKey(PROJECT, 1)),
    h => h.db.prepare('UPDATE event_client_receipts SET client_event_id=? WHERE client_event_id=?').run(projectIntakeReceiptPrefix(PROJECT) + 'rekeyed', projectIntakeReceiptKey(PROJECT, 1)),
    h => h.db.prepare('UPDATE events SET stream_id=? WHERE event_id=?').run('creative:other', uuid(2001)),
    h => h.db.prepare('UPDATE events SET actor=? WHERE event_id=?').run('assistant', uuid(2001)),
    h => h.db.prepare('UPDATE events SET type=? WHERE event_id=?').run('DocumentRenamed', uuid(2001)),
    h => h.db.prepare('UPDATE events SET compensates_event_id=? WHERE event_id=?').run(uuid(9000), uuid(2001)),
  ];
  for (const change of cases) {
    const h = harness(t), auth = await authorization(h), intake = intakeFor(); seedOriginal(h, auth, intake); change(h);
    const result = await readAndReply(h, auth, intake);
    assert.equal(result.state.authorized, true); assert.equal(result.state.seen, true); await unavailable(result, intake);
  }
  const h = harness(t), auth = await authorization(h), intake = intakeFor();
  insert(h, 'event_client_receipts', { stream_id: auth.user.streamId, client_event_id: projectIntakeReceiptPrefix(PROJECT) + 'dangling', event_id: uuid(9999), sequence: 9999 });
  const dangling = await readAndReply(h, auth, intake); assert.equal(dangling.state.seen, true); await unavailable(dangling, intake);
});

test('retained private owner/redaction/body failures cannot fall back to a valid public payload', async t => {
  const cases = [
    h => h.db.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(uuid(2001)),
    h => h.db.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run('second-1', uuid(2001)),
    h => h.db.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?').run(PAST, uuid(2001)),
    h => h.db.prepare('UPDATE event_private_payloads SET private_json=NULL WHERE private_event_id=?').run(uuid(2001)),
    h => h.db.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run('{', uuid(2001)),
    h => h.db.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run('null', uuid(2001)),
    h => h.db.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run('[]', uuid(2001)),
    (h, intake) => h.db.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?')
      .run(JSON.stringify({ ...intake.events[1].payload, title: 'Changed title' }), uuid(2001)),
    (h, intake) => h.db.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?')
      .run(JSON.stringify({ ...intake.events[1].payload, additional: { value: true } }), uuid(2001)),
  ];
  for (const change of cases) {
    const h = harness(t), auth = await authorization(h), intake = intakeFor(); seedOriginal(h, auth, intake);
    h.db.prepare('UPDATE events SET payload=? WHERE event_id=?').run(JSON.stringify(intake.events[1].payload), uuid(2001));
    change(h, intake);
    const result = await readAndReply(h, auth, intake); assert.equal(result.state.seen, true); await unavailable(result, intake);
  }
});

test('canonical private values accept JSON presentation differences without claiming digest or byte identity', async t => {
  const h = harness(t), auth = await authorization(h), intake = intakeFor(), seeded = seedOriginal(h, auth, intake);
  const payload = intake.events[1].payload;
  h.db.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?')
    .run(JSON.stringify(Object.fromEntries(Object.entries(payload).reverse()), null, 2), uuid(2001));
  h.db.prepare('UPDATE events SET payload=? WHERE event_id=?').run('not-json-public', uuid(2001));
  await completed(await readAndReply(h, auth, intake), intake, seeded);
  // Actual pure helper compatibility; these are not accepted intake grammar fixtures.
  assert.equal(projectIntakeValue({ z: 1, a: { b: 2, omitted: undefined } }), projectIntakeValue({ a: { b: 2 }, z: 1 }));
  assert.notEqual(projectIntakeValue({ list: ['one', 'two'] }), projectIntakeValue({ list: ['two', 'one'] }));
  assert.equal(projectIntakeValue(undefined), 'null');
});

test('original reply preserves stream-wide head and retained serialized metadata without inventing metadata checks', async t => {
  const h = harness(t), auth = await authorization(h), intake = intakeFor(), seeded = seedOriginal(h, auth, intake);
  const row = seeded[1].row;
  Object.assign(row, { client_id: 'qualification:other-client', correlation_id: 'qualification:other-correlation',
    causation_id: uuid(8888), schema_version: 7, occurred_at: '2001-01-01T00:00:00.000Z', recorded_at: '2002-01-01T00:00:00.000Z' });
  h.db.prepare('UPDATE events SET client_id=?,correlation_id=?,causation_id=?,schema_version=?,occurred_at=?,recorded_at=? WHERE event_id=?')
    .run(row.client_id, row.correlation_id, row.causation_id, row.schema_version, row.occurred_at, row.recorded_at, row.event_id);
  insert(h, 'events', { ...seeded[0].row, event_id: uuid(2999), sequence: 99, type: 'QualificationWitness', payload: '{}' });
  await completed(await readAndReply(h, auth, intake), intake, seeded, 99);
});

test('actual low-role and stale-consent principals are refused by intake authority without fabricated snapshots', async t => {
  for (const role of ['viewer', 'agent']) {
    const h = harness(t, { user: { role } });
    // Real viewer-minimum R7 resolution exercises the intake guard's own creator
    // fence; it is NOT a successful creator-minimum endpoint authorization.
    const auth = await authorization(h, requestFor(), { account: 'principal' }, 'viewer'), intake = intakeFor();
    seedOriginal(h, auth, intake);
    assert.deepEqual(projectIntakeAuthority(h.env, auth, intake), { sql: '0', bindings: [] });
    const result = await readAndReply(h, auth, intake);
    assert.equal(result.state.authorized, false); assert.equal(result.state.seen, false);
    await unavailable(result, intake, 'project_intake_authority_changed', 403);
  }
  const h = harness(t, { user: { consent_version: 'previous-policy' } }), auth = await authorization(h), intake = intakeFor();
  seedOriginal(h, auth, intake); // R7 request resolution does not imply requireConsent.
  await unavailable(await readAndReply(h, auth, intake), intake, 'project_intake_authority_changed', 403);
});

test('current SQL account, epoch and grant changes invalidate the captured real principal', async t => {
  const cases = [
    h => h.db.prepare('DELETE FROM users WHERE user_id=?').run(AUTHOR),
    h => h.db.prepare('UPDATE users SET role=? WHERE user_id=?').run('admin', AUTHOR),
    h => h.db.prepare('UPDATE users SET updated_at=? WHERE user_id=?').run(FUTURE, AUTHOR),
    h => h.db.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run('previous-policy', AUTHOR),
    h => insert(h, 'capability_grants', { grant_id: 'grant-1', user_id: AUTHOR, capability: 'design.docs.read', scope_type: 'synthetic',
      organization_id: null, project_access_id: null, status: 'active', revoked_at: null, expires_at: null, updated_at: PAST }),
    // Inactive grant changes only the raw aggregate epoch, not active grants.
    h => insert(h, 'capability_grants', { grant_id: 'grant-1', user_id: AUTHOR, capability: 'design.docs.read', scope_type: 'synthetic',
      organization_id: null, project_access_id: null, status: 'revoked', revoked_at: PAST, expires_at: null, updated_at: FUTURE }),
  ];
  for (const change of cases) {
    const h = harness(t), auth = await authorization(h), intake = intakeFor(); seedOriginal(h, auth, intake); change(h);
    const result = await readAndReply(h, auth, intake);
    assert.equal(result.state.authorized, false); assert.equal(result.state.head, 0);
    await unavailable(result, intake, 'project_intake_authority_changed', 403);
  }
});

test('real organization, project and identity-policy SQL aggregates remain bound to the captured snapshot', async t => {
  const cases = [
    { setup: h => { organization(h); member(h); }, change: h => h.db.prepare('UPDATE organizations SET name=?').run('Changed organization') },
    { setup: h => { organization(h); member(h); }, change: h => h.db.prepare('UPDATE organization_memberships SET revoked_at=? WHERE user_id=?').run(PAST, AUTHOR) },
    { setup: project, change: h => h.db.prepare('UPDATE project_memberships SET role=? WHERE user_id=?').run('viewer', AUTHOR) },
    { setup: h => { organization(h); member(h);
      insert(h, 'organization_security_policies', { organization_id: 'org-1', authentication_source: 'openai-workspace',
        allowed_domains_json: '["example.test"]', require_mfa: 0, version: 1, updated_at: PAST });
      insert(h, 'organization_identity_bindings', { organization_id: 'org-1', user_id: AUTHOR, status: 'active',
        authentication_source: 'openai-workspace', subject: AUTHOR, updated_at: PAST });
    }, change: h => h.db.prepare('UPDATE organization_security_policies SET version=2').run() },
  ];
  for (const { setup, change } of cases) {
    const h = harness(t); setup(h);
    const auth = await authorization(h), intake = intakeFor(), seeded = seedOriginal(h, auth, intake);
    await completed(await readAndReply(h, auth, intake), intake, seeded);
    change(h); await unavailable(await readAndReply(h, auth, intake), intake, 'project_intake_authority_changed', 403);
  }
});

test('personal project and Document custody use the exact owner/resource predicates at the original read', async t => {
  for (const kind of ['project', 'document']) {
    const h = harness(t), auth = await authorization(h), intake = intakeFor(), seeded = seedOriginal(h, auth, intake);
    // Nonmatching owner/resource rows do not become an invented broader denial.
    if (kind === 'project') insert(h, 'organization_projects', { project_access_id: 'custody-1', organization_id: 'unjoined-org',
      project_id: PROJECT, owner_user_id: 'other-owner', status: 'inactive', updated_at: PAST });
    else insert(h, 'project_resource_scopes', { owner_user_id: AUTHOR, resource_kind: 'image', resource_id: DOCUMENT });
    await completed(await readAndReply(h, auth, intake), intake, seeded);
    if (kind === 'project') h.db.prepare('UPDATE organization_projects SET owner_user_id=? WHERE project_access_id=?').run(AUTHOR, 'custody-1');
    else h.db.prepare('UPDATE project_resource_scopes SET resource_kind=?').run('document');
    // The personal predicates intentionally have no status/organization join.
    await unavailable(await readAndReply(h, auth, intake), intake, 'project_intake_authority_changed', 403);
  }
});

test('actual configured pilot guard rechecks enrollment, organization and live cohort state after principal capture', async t => {
  for (const status of ['active', 'paused']) {
    const h = harness(t); pilot(h, { cohort: { status } });
    const auth = await authorization(h), intake = intakeFor(), seeded = seedOriginal(h, auth, intake);
    assert.equal(await configuredAllows(h, auth), true);
    await completed(await readAndReply(h, auth, intake), intake, seeded);
  }
  const changes = [
    h => h.db.prepare('UPDATE pilot_participants SET status=?').run('inactive'),
    h => h.db.prepare('UPDATE pilot_participants SET revoked_at=?').run(PAST),
    h => h.db.prepare('UPDATE pilot_participants SET email_normalized=?').run('other@example.test'),
    h => h.db.prepare('UPDATE pilot_participants SET user_id=?').run('other-user'),
    h => h.db.prepare('UPDATE pilot_participants SET organization_id=?').run('other-org'),
    h => h.db.prepare('UPDATE pilot_cohorts SET status=?').run('closed'),
    h => h.db.prepare('UPDATE pilot_cohorts SET ends_at=?').run(PAST),
    h => h.db.prepare('UPDATE pilot_cohorts SET starts_at=?').run(FUTURE),
    h => h.db.prepare('UPDATE organizations SET status=?').run('inactive'),
    h => h.db.prepare('DELETE FROM pilot_cohorts').run(),
  ];
  for (const change of changes) {
    const h = harness(t); pilot(h);
    const auth = await authorization(h), intake = intakeFor(); seedOriginal(h, auth, intake); change(h);
    assert.equal(await configuredAllows(h, auth), false, 'The actual configured SQL predicate, not a synthetic authority result, refuses');
    await unavailable(await readAndReply(h, auth, intake), intake, 'project_intake_authority_changed', 403);
  }
});

test('configured email breakglass and exact owner recovery stay separate from general intake authority', async t => {
  const bypass = harness(t); pilot(bypass, { withParticipant: false });
  bypass.env.FORMA_ADMIN_EMAILS = ` other@example.test, ${EMAIL.toUpperCase()} `;
  const auth = await authorization(bypass), intake = intakeFor(), seeded = seedOriginal(bypass, auth, intake);
  assert.equal(auth.user.role, 'creator'); assert.equal(await configuredAllows(bypass, auth), true);
  await completed(await readAndReply(bypass, auth, intake), intake, seeded);
  bypass.env.FORMA_ADMIN_EMAILS = '';
  assert.equal(await configuredAllows(bypass, auth), false);
  await unavailable(await readAndReply(bypass, auth, intake), intake, 'project_intake_authority_changed', 403);
  for (const cohort of [{ status: 'closed' }, { ends_at: PAST }, { starts_at: FUTURE }]) {
    const h = harness(t); pilot(h, { cohort, withParticipant: false }); member(h, { role: 'owner' });
    const owner = await authorization(h), original = intakeFor(), saved = seedOriginal(h, owner, original);
    assert.equal(await configuredAllows(h, owner), true);
    await completed(await readAndReply(h, owner, original), original, saved);
    insert(h, 'pilot_cohorts', { cohort_id: 'successor', organization_id: 'org-1', status: 'active', starts_at: PAST,
      ends_at: FUTURE, created_at: '2001-01-01T00:00:00.000Z', participant_cap_microusd: 1 });
    assert.equal(await configuredAllows(h, owner), false);
    await unavailable(await readAndReply(h, owner, original), original, 'project_intake_authority_changed', 403);
  }
});

test('a configured successor uses its actual current enrollment and cannot reuse the closed cohort participant', async t => {
  const h = harness(t); pilot(h, { cohort: { status: 'closed' } });
  insert(h, 'pilot_cohorts', { cohort_id: 'successor', organization_id: 'org-1', status: 'paused', starts_at: PAST,
    ends_at: FUTURE, created_at: '2001-01-01T00:00:00.000Z', participant_cap_microusd: 1 });
  insert(h, 'pilot_participants', { participant_id: 'successor-member', cohort_id: 'successor', organization_id: 'org-1',
    email_normalized: EMAIL, user_id: AUTHOR, status: 'active', revoked_at: null, role: 'participant' });
  const auth = await authorization(h), intake = intakeFor(), seeded = seedOriginal(h, auth, intake);
  assert.equal(await configuredAllows(h, auth), true); await completed(await readAndReply(h, auth, intake), intake, seeded);
  h.db.prepare('DELETE FROM pilot_participants WHERE participant_id=?').run('successor-member');
  assert.equal(await configuredAllows(h, auth), false);
  await unavailable(await readAndReply(h, auth, intake), intake, 'project_intake_authority_changed', 403);
});

test('actual effective impersonation retains actor authority and the fictional original stream/owner', async t => {
  for (const role of ['creator', 'viewer']) {
    const h = harness(t); impersonation(h, { fictional: { role } });
    const auth = await authorization(h, impersonationRequest(), { account: 'effective' }), intake = intakeFor();
    assert.equal(auth.impersonation.actor, auth.principal); assert.equal(auth.user, auth.impersonation.fictionalUser);
    assert.equal(auth.user.fictional, true); assert.equal(auth.user.userId, 'fictional-1');
    assert.equal(auth.user.billingUserId, AUTHOR); assert.equal(auth.user.role, role);
    const seeded = seedOriginal(h, auth, intake);
    await completed(await readAndReply(h, auth, intake), intake, seeded);
    const read = receiptReads(h).at(-1);
    assert.equal(read.bindings[0], 'creative:fictional-1'); assert.equal(read.bindings[6], 'fictional-1');
    assert.equal(read.bindings[7], AUTHOR); // Actual actor snapshot query binding.
    h.db.prepare('UPDATE event_private_payloads SET owner_id=?').run(AUTHOR);
    await unavailable(await readAndReply(h, auth, intake), intake); // Actor ownership is not effective ownership.
  }
});

test('impersonation session/persona/fictional state and both actors custody remain current at receipt read', async t => {
  const changes = [
    h => h.db.prepare('UPDATE impersonation_sessions SET status=?').run('ended'),
    h => h.db.prepare('UPDATE impersonation_sessions SET expires_at=?').run(PAST),
    h => h.db.prepare('UPDATE impersonation_sessions SET actor_user_id=?').run('other-actor'),
    h => h.db.prepare('UPDATE impersonation_sessions SET fictional_user_id=?').run('other-fictional'),
    h => h.db.prepare('UPDATE impersonation_sessions SET persona_id=?').run('other-persona'),
    h => h.db.prepare('UPDATE impersonation_sessions SET replay_session_id=?').run('other-replay'),
    h => h.db.prepare('UPDATE replay_personas SET status=?').run('retired'),
    h => h.db.prepare('UPDATE users SET role=? WHERE user_id=?').run('viewer', 'fictional-1'),
    h => h.db.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run('previous-policy', 'fictional-1'),
    h => h.db.prepare('UPDATE users SET consented_at=? WHERE user_id=?').run(FUTURE, 'fictional-1'),
    h => h.db.prepare('DELETE FROM users WHERE user_id=?').run('fictional-1'),
    h => h.db.prepare('UPDATE users SET updated_at=? WHERE user_id=?').run(FUTURE, AUTHOR),
    ...[AUTHOR, 'fictional-1'].flatMap(owner => [
      h => insert(h, 'organization_projects', { project_access_id: 'custody-1', organization_id: 'unjoined-org', project_id: PROJECT,
        owner_user_id: owner, status: 'inactive', updated_at: PAST }),
      h => insert(h, 'project_resource_scopes', { owner_user_id: owner, resource_kind: 'document', resource_id: DOCUMENT }),
    ]),
  ];
  for (const change of changes) {
    const h = harness(t); impersonation(h);
    const auth = await authorization(h, impersonationRequest(), { account: 'effective' }), intake = intakeFor();
    seedOriginal(h, auth, intake); change(h);
    const result = await readAndReply(h, auth, intake); assert.equal(result.state.authorized, false);
    await unavailable(result, intake, 'project_intake_authority_changed', 403);
  }
});

test('a deliberately denying additional option guard establishes conjunction only, never positive caller authority', async t => {
  const h = harness(t), auth = await authorization(h), intake = intakeFor(); seedOriginal(h, auth, intake);
  const options = { receiptPrefix: projectIntakeReceiptPrefix(PROJECT), clientId: 'qualification:unused-read-client',
    correlationPrefix: 'qualification:unused-read-correlation', guard: { sql: '? = 1', bindings: [0] } };
  const result = await readAndReply(h, auth, intake, options);
  assert.equal(receiptReads(h).at(-1).bindings.at(-1), 0);
  await unavailable(result, intake, 'project_intake_authority_changed', 403);
});

test('actual SQLite read failures propagate without a formatted receipt or schema/bootstrap fallback', async t => {
  const h = harness(t), auth = await authorization(h), intake = intakeFor(); seedOriginal(h, auth, intake);
  h.db.exec('DROP TABLE event_client_receipts'); // Explicit fixture corruption only.
  await assert.rejects(() => readAndReply(h, auth, intake), error => {
    assert.match(String(error.message), /no such table: event_client_receipts/u);
    return true;
  });
  assert.equal(receiptReads(h).length, 1);
});
