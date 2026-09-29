import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Proposed finite actual-core qualification. Owner executes only after the
// three extracted modules + nine existing pure dependencies are reviewed/pinned.
// No sliced source, injected authority/privacy function, native job/provider or
// aggregate runtime/ledger import is permitted. SQL schema/data are disposable.
const rootInput = process.env.FORMA_EXPERIENCE_CORE_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_CORE_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'output-command-core-local-sqlite');
const modulePaths = [
  'worker/output-command-core.ts', 'worker/event-write-primitives.ts', 'worker/policy-version.ts',
  'worker/event-privacy.ts', 'worker/access-policy.ts', 'worker/canvas-governance-policy.ts',
  'worker/image-adapter-evaluation-evidence.ts', 'src/platform/capabilities.ts',
  'src/model/output-requirement-events.ts', 'src/model/presentation-candidates.ts',
  'src/model/generation-execution-evidence.ts', 'src/model/provider-submission.ts',
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
  value: function forbiddenCoreFetch() { forbiddenFetchAttempts++; throw Error('Network forbidden in actual-core qualification'); },
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
  assert.ok(allowed.has(file), `Unreviewed core dependency: ${file}`);
  return nextResolve(pathToFileURL(file).href, context);
}, load(url, context, nextLoad) {
  const file = realpathSync(fileURLToPath(url));
  assert.ok(allowed.has(file), `Unreviewed loaded core dependency: ${file}`);
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
  try { assert.equal(forbiddenFetchAttempts, 0, 'A forbidden fetch was attempted, even if a core catch swallowed its error'); }
  finally { cleanup(); }
});
let core, primitives, POLICY_VERSION;
try {
  core = await import(pathToFileURL(resolve(root, 'worker/output-command-core.ts')).href);
  primitives = await import(pathToFileURL(resolve(root, 'worker/event-write-primitives.ts')).href);
  ({ POLICY_VERSION } = await import(pathToFileURL(resolve(root, 'worker/policy-version.ts')).href));
} catch (error) { cleanup(); throw error; }
// Keep the guard through tests: an unexpected late import must also fail closed.

const writeColumns = primitives.EVENT_WRITE_COLUMNS.split(',');
const transactionTables = ['events', 'event_private_payloads', 'event_write_stage', 'output_commands', 'output_atomic_assertions', 'test_command_effects', 'project_event_scopes', 'project_resource_scopes'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const secret = 'Private qualification text · α 👩🏽‍💻';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(user_id TEXT PRIMARY KEY,role TEXT NOT NULL,consent_version TEXT);
    CREATE TABLE organizations(organization_id TEXT PRIMARY KEY,status TEXT NOT NULL);
    CREATE TABLE organization_projects(project_access_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE project_migration_states(project_access_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,status TEXT NOT NULL,last_owner_sequence INTEGER,updated_at TEXT);
    CREATE TABLE organization_memberships(membership_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL,accepted_at TEXT,revoked_at TEXT);
    CREATE TABLE project_memberships(membership_id TEXT PRIMARY KEY,project_access_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL,revoked_at TEXT,role TEXT NOT NULL);
    CREATE TABLE project_context_sessions(context_id TEXT PRIMARY KEY,principal_user_id TEXT NOT NULL,project_access_id TEXT NOT NULL,organization_id TEXT NOT NULL,revoked_at TEXT,expires_at TEXT NOT NULL);
    CREATE TABLE capability_grants(grant_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,capability TEXT NOT NULL,scope_type TEXT NOT NULL,organization_id TEXT,project_access_id TEXT,status TEXT NOT NULL,revoked_at TEXT,expires_at TEXT);
    CREATE TABLE pilot_cohorts(cohort_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE pilot_participants(participant_id TEXT PRIMARY KEY,cohort_id TEXT NOT NULL,organization_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL,revoked_at TEXT,role TEXT NOT NULL);
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT,recorded_at TEXT,actor TEXT,client_id TEXT,correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER,type TEXT,payload TEXT NOT NULL,UNIQUE(stream_id,sequence));
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY REFERENCES events(event_id),owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT NOT NULL,created_at TEXT,redacted_at TEXT);
    CREATE TABLE event_write_stage(${writeColumns.map(name => `${name} ${['sequence', 'schema_version'].includes(name) ? 'INTEGER' : 'TEXT'}`).join(',')});
    CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER NOT NULL CHECK(passed=1));
    CREATE TABLE output_commands(scope_key TEXT,actor_user_id TEXT,command_key TEXT,request_digest TEXT,action TEXT,event_id TEXT REFERENCES events(event_id),created_at TEXT,PRIMARY KEY(scope_key,actor_user_id,command_key));
    CREATE TABLE test_command_effects(command_key TEXT PRIMARY KEY,event_id TEXT REFERENCES events(event_id),private_marker TEXT NOT NULL);
    CREATE TABLE project_event_scopes(event_id TEXT PRIMARY KEY REFERENCES events(event_id),project_access_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,source_stream_id TEXT,source_sequence INTEGER,project_sequence INTEGER,actor_user_id TEXT,created_at TEXT,UNIQUE(project_access_id,organization_id,project_sequence));
    CREATE TABLE project_resource_scopes(project_access_id TEXT,resource_kind TEXT,resource_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,visibility TEXT,source_event_id TEXT REFERENCES events(event_id),actor_user_id TEXT,created_at TEXT);
  `);
  db.exec(primitives.EVENT_WRITE_STAGE_TRIGGER_SQL); // Actual extracted trigger, not a fixture reimplementation.
  return db;
}

// D1-shaped transport over real local SQLite. Reuses the task-owned R2 adapter
// pattern, not its injected policy/privacy functions or synthetic native tables.
function prepared(db, sql, bindings = []) {
  return { bind(...values) { return prepared(db, sql, values); },
    async first() { return db.prepare(sql).get(...bindings) ?? null; },
    async all() { return { results: db.prepare(sql).all(...bindings), success: true }; },
    run() { return db.prepare(sql).run(...bindings); },
  };
}
function harness(t, kind = 'personal') {
  const db = database(); t.after(() => db.close());
  const state = { attempts: 0, committed: 0, rolledBack: 0, beforeBatch: null, loseNextAcknowledgment: false };
  const env = { DB: { prepare: sql => prepared(db, sql), async batch(statements) {
    state.attempts++; const before = state.beforeBatch; state.beforeBatch = null; before?.();
    db.exec('BEGIN');
    try { for (const statement of statements) statement.run(); db.exec('COMMIT'); state.committed++; }
    catch (error) { db.exec('ROLLBACK'); state.rolledBack++; throw error; }
    if (state.loseNextAcknowledgment) { state.loseNextAcknowledgment = false; throw Error('Disposable adapter lost committed acknowledgment'); }
    return statements.map(() => ({ success: true }));
  } } };
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('author-1', 'creator', POLICY_VERSION);
  db.prepare('INSERT INTO users VALUES(?,?,?)').run('other-actor', 'creator', POLICY_VERSION);
  const scope = { kind, key: kind + ':qualification-scope', ownerUserId: 'author-1', actorUserId: 'author-1', projectId: 'project-1', documentId: 'document-1',
    organizationId: kind === 'project' ? 'organization-1' : null, projectAccessId: kind === 'project' ? 'access-1' : null, contextId: kind === 'project' ? 'context-1' : null };
  if (kind === 'project') {
    db.exec(`INSERT INTO organizations VALUES('organization-1','active');
      INSERT INTO organization_projects VALUES('access-1','organization-1','project-1','author-1','active');
      INSERT INTO project_migration_states VALUES('access-1','organization-1','author-1','active',0,NULL);
      INSERT INTO organization_memberships VALUES('member-1','organization-1','author-1','active','2026-01-01T00:00:00.000Z',NULL);
      INSERT INTO pilot_cohorts VALUES('cohort-1','organization-1','active');
      INSERT INTO pilot_participants VALUES('participant-1','cohort-1','organization-1','author-1','active',NULL,'participant');`);
    db.prepare('INSERT INTO project_context_sessions VALUES(?,?,?,?,?,?)').run('context-1', 'author-1', 'access-1', 'organization-1', null, new Date(Date.now() + 600000).toISOString());
  }
  const input = () => {
    const key = 'logical-intake:qualification', retainedEnvelope = { action: 'qualification', documentId: scope.documentId,
      expectedRevision: 'output:0', clientMutationId: key, request: { authoredText: secret, orderedFacts: ['First', 'Second', 'Third'] } };
    return { scope, permission: 'author', expectedHead: 0, expectedProjectHead: 0, key, digest: digest(retainedEnvelope), action: 'qualification', retainedEnvelope,
      events: [{ type: 'CoreQualificationStarted', payload: { authored_note: secret } }, { type: 'CoreQualificationRecorded', payload: { authored_note: secret } }],
      buildSidecars: events => ({ statements: [env.DB.prepare('INSERT INTO test_command_effects VALUES(?,?,?)').bind(key, events.at(-1).eventId, secret)] }),
    };
  };
  const count = table => { assert.ok(transactionTables.includes(table)); return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count); };
  const assertEmptyWrites = () => { for (const table of transactionTables) assert.equal(count(table), 0, table); };
  const insertSource = () => {
    const event = primitives.makeEvent('creative:author-1', 1, 'user:author-1', 'server:qualification', 'source-1', 'CoreSourceFixture', { project_id: scope.projectId, document_id: scope.documentId, authored_note: secret });
    db.prepare(`INSERT INTO event_write_stage(${primitives.EVENT_WRITE_COLUMNS}) VALUES(${writeColumns.map(() => '?').join(',')})`).run(...primitives.eventWriteBindings(event));
    return event;
  };
  return { db, env, state, scope, input, count, assertEmptyWrites, insertSource };
}
function association(h, command) {
  const row = h.db.prepare(`SELECT command.command_key,command.request_digest,command.event_id,body.private_json,event.payload AS public_json,effect.private_marker
    FROM output_commands command JOIN events event ON event.event_id=command.event_id
    JOIN event_private_payloads body ON body.private_event_id=command.event_id
    JOIN test_command_effects effect ON effect.command_key=command.command_key AND effect.event_id=command.event_id`).get();
  assert.equal(row.command_key, command.key); assert.equal(row.request_digest, command.digest);
  assert.deepEqual(JSON.parse(row.private_json).output_command_envelope, command.retainedEnvelope);
  assert.equal(row.private_marker, secret);
  assert.equal(h.count('output_commands'), 1); assert.equal(h.count('test_command_effects'), 1);
  for (const event of h.db.prepare('SELECT event_id,payload FROM events').all()) {
    assert.equal(event.payload.includes(secret), false); assert.equal(event.payload.includes('output_command_envelope'), false);
    assert.equal(JSON.parse(event.payload)._private_ref, event.event_id);
  }
  assert.equal(h.count('event_write_stage'), 0); assert.equal(h.count('output_atomic_assertions'), 0);
  return row;
}

test('actual core, real event privacy and trigger atomically retain exact envelope and ordinary sidecar', async t => {
  for (const kind of ['personal', 'project']) {
    const h = harness(t, kind), command = h.input(), result = await core.commitOutputCommand(h.env, command);
    assert.equal(result.replayed, false); assert.equal(h.state.committed, 1);
    assert.equal(association(h, command).event_id, result.receipt.eventId);
    assert.equal(h.count('events'), 2); assert.equal(h.count('event_private_payloads'), 2);
    assert.equal(Object.hasOwn(result.events[0].payload, 'output_command_envelope'), false);
    assert.deepEqual(result.events.at(-1).payload.output_command_envelope, command.retainedEnvelope);
    assert.equal(h.count('project_event_scopes'), kind === 'project' ? 2 : 0);
    if (kind === 'project') assert.equal(h.db.prepare('SELECT last_owner_sequence FROM project_migration_states').get().last_owner_sequence, 2);
  }
});
test('same actor/scope exact retry and local interleaving converge on the original receipt', async t => {
  const h = harness(t), command = h.input();
  const results = await Promise.all([core.commitOutputCommand(h.env, command), core.commitOutputCommand(h.env, h.input())]);
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  assert.equal(results[0].receipt.eventId, results[1].receipt.eventId);
  assert.equal(h.state.committed, 1); assert.equal(h.state.rolledBack, 1);
  const retry = await core.commitOutputCommand(h.env, h.input());
  assert.equal(retry.replayed, true); assert.deepEqual(retry.events, []); assert.equal(retry.receipt.eventId, results[0].receipt.eventId);
  assert.equal(h.state.attempts, 2); association(h, command);
});
test('committed acknowledgment loss resolves original content without replacement writes', async t => {
  const h = harness(t), command = h.input(); h.state.loseNextAcknowledgment = true;
  const result = await core.commitOutputCommand(h.env, command), retry = await core.commitOutputCommand(h.env, h.input());
  assert.equal(result.replayed, true); assert.equal(retry.receipt.eventId, result.receipt.eventId);
  assert.deepEqual(result.receipt.payload.output_command_envelope, command.retainedEnvelope);
  assert.equal(h.state.attempts, 1); assert.equal(h.state.committed, 1); association(h, command);
});
test('different complete-envelope digest conflicts in the same logical namespace', async t => {
  const h = harness(t), original = h.input(); await core.commitOutputCommand(h.env, original);
  const changed = h.input(); changed.retainedEnvelope.request.authoredText = 'Different private text'; changed.digest = digest(changed.retainedEnvelope);
  await assert.rejects(core.commitOutputCommand(h.env, changed), { code: 'mutation_key_reused_with_different_content' });
  assert.equal(h.state.attempts, 1); association(h, original);
  // Digest construction is the caller's responsibility; this test does not claim the core recomputes it.
});
test('receipt namespaces and event identities isolate actors and scopes, without claiming principal authentication', async t => {
  const h = harness(t), command = h.input(), result = await core.commitOutputCommand(h.env, command);
  for (const scope of [{ ...h.scope, actorUserId: 'other-actor' }, { ...h.scope, key: 'different-scope' }])
    assert.equal(await core.readOutputCommand(h.env, scope, command.key, command.digest), null);
  for (const scope of [{ ...h.scope, documentId: 'different-document' }, { ...h.scope, projectId: 'different-project' }, { ...h.scope, ownerUserId: 'different-owner' }])
    await assert.rejects(core.readOutputCommand(h.env, scope, command.key, command.digest), { code: 'output_command_scope_mismatch' });
  const proof = core.outputCommandReceiptAssertion(h.scope, result.receipt);
  assert.equal(h.db.prepare(`SELECT (${proof.sql}) AS ok`).get(...proof.bindings).ok, 1);
  const altered = core.outputCommandReceiptAssertion(h.scope, { ...result.receipt, eventId: 'different-event' });
  assert.equal(h.db.prepare(`SELECT (${altered.sql}) AS ok`).get(...altered.bindings).ok, 0);
  assert.equal(h.state.attempts, 1);
});
test('real personal authority denies new writes after consent, role or custody changes', async t => {
  for (const mutate of [h => h.db.exec("UPDATE users SET consent_version='obsolete' WHERE user_id='author-1'"),
    h => h.db.exec("UPDATE users SET role='viewer' WHERE user_id='author-1'"),
    h => h.db.exec("INSERT INTO organization_projects VALUES('access-new','organization-new','project-1','author-1','active')")]) {
    const h = harness(t); h.state.beforeBatch = () => mutate(h);
    await assert.rejects(core.commitOutputCommand(h.env, h.input()), { code: 'output_revision_or_authority_changed' });
    assert.equal(h.state.committed, 0); assert.equal(h.state.rolledBack, 1); h.assertEmptyWrites();
  }
});
test('real project access and pilot SQL deny expired/revoked context, membership and reviewer authoring', async t => {
  for (const mutate of [h => h.db.exec("UPDATE project_context_sessions SET expires_at='2000-01-01T00:00:00.000Z'"),
    h => h.db.exec("UPDATE project_context_sessions SET revoked_at='2026-01-01T00:00:00.000Z'"),
    h => h.db.exec("UPDATE organization_memberships SET status='revoked'"),
    h => h.db.exec("UPDATE pilot_participants SET role='reviewer'"),
    h => h.db.exec('DELETE FROM pilot_participants')]) {
    const h = harness(t, 'project'); h.state.beforeBatch = () => mutate(h);
    await assert.rejects(core.commitOutputCommand(h.env, h.input()), { code: 'output_revision_or_authority_changed' });
    h.assertEmptyWrites(); assert.equal(h.db.prepare('SELECT last_owner_sequence FROM project_migration_states').get().last_owner_sequence, 0);
  }
});
test('real stream and project-head guards reject stale new commands', async t => {
  const stream = harness(t); stream.state.beforeBatch = () => stream.insertSource();
  await assert.rejects(core.commitOutputCommand(stream.env, stream.input()), { code: 'output_revision_or_authority_changed' });
  assert.equal(stream.count('events'), 1); assert.equal(stream.count('output_commands'), 0); assert.equal(stream.count('test_command_effects'), 0);
  const project = harness(t, 'project'), command = project.input(); command.expectedProjectHead = 1;
  await assert.rejects(core.commitOutputCommand(project.env, command), { code: 'output_revision_or_authority_changed' }); project.assertEmptyWrites();
});
test('actual retained private-body assertions reject changed source bytes inside the transaction', async t => {
  const h = harness(t), source = h.insertSource();
  const raw = h.db.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(source.eventId).private_json;
  core.rememberOutputPrivateBody(h.scope, source.eventId, raw);
  const command = h.input(); command.expectedHead = 1; command.sourceAssertions = core.retainedOutputBodyAssertions(h.scope);
  assert.ok(command.sourceAssertions.length > 0);
  h.state.beforeBatch = () => h.db.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify({ changed: 'Different private text' }), source.eventId);
  await assert.rejects(core.commitOutputCommand(h.env, command), { code: 'output_revision_or_authority_changed' });
  assert.equal(h.count('events'), 1); assert.equal(h.count('output_commands'), 0); assert.equal(h.count('test_command_effects'), 0);
});
test('late sidecar assertion rolls back actual events, privacy rows and command association', async t => {
  const h = harness(t), command = h.input(), witness = command.buildSidecars;
  command.buildSidecars = events => ({ ...witness(events), assertions: [{ sql: '0' }] });
  await assert.rejects(core.commitOutputCommand(h.env, command), { code: 'output_revision_or_authority_changed' });
  assert.equal(h.state.rolledBack, 1); h.assertEmptyWrites();
  assert.deepEqual(core.retainedOutputBodyAssertions(h.scope), []);
});
test('missing, redacted or wrongly owned private content cannot become a content replay or replacement', async t => {
  for (const mode of ['missing', 'redacted', 'wrong-owner']) {
    const h = harness(t), command = h.input(), first = await core.commitOutputCommand(h.env, command);
    if (mode === 'missing') h.db.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(first.receipt.eventId);
    if (mode === 'redacted') h.db.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(first.receipt.eventId);
    if (mode === 'wrong-owner') h.db.prepare("UPDATE event_private_payloads SET owner_id='other-actor' WHERE private_event_id=?").run(first.receipt.eventId);
    await assert.rejects(core.readOutputCommand(h.env, h.scope, command.key, command.digest), { code: 'original_command_content_unavailable' });
    const replay = await core.commitOutputCommand(h.env, h.input());
    assert.equal(replay.replayed, true); assert.equal(replay.receipt.privateUnavailable, true); assert.deepEqual(replay.receipt.payload, {}); assert.deepEqual(replay.events, []);
    assert.equal(h.state.attempts, 1); assert.equal(h.count('events'), 2); assert.equal(h.count('test_command_effects'), 1);
  }
});
test('omitting retainedEnvelope preserves generic command payload shape through actual privacy', async t => {
  const h = harness(t), command = h.input(); delete command.retainedEnvelope;
  const result = await core.commitOutputCommand(h.env, command);
  for (const event of result.events) assert.equal(Object.hasOwn(event.payload, 'output_command_envelope'), false);
  const replay = await core.readOutputCommand(h.env, h.scope, command.key, command.digest);
  assert.equal(Object.hasOwn(replay.payload, 'output_command_envelope'), false);
  for (const row of h.db.prepare('SELECT payload FROM events').all()) assert.equal(row.payload.includes(secret), false);
});
