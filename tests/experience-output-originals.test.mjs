import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Proposed finite indexed-original qualification; authored here, not executed.
// Owner runs only the integrated and reviewed exact runtime closure. Actual R4
// core/privacy and extracted original-reader functions; no native job, successful
// dispatch, authority substitute, aggregate Runtime/ledger or HTTP wrapper import.
const rootInput = process.env.FORMA_EXPERIENCE_ORIGINALS_CANDIDATE_ROOT;
const manifestInput = process.env.FORMA_EXPERIENCE_ORIGINALS_REVIEWED_MANIFEST;
assert.ok(rootInput && manifestInput, 'Explicit integrated checkout and reviewed source manifest required');
const root = realpathSync(rootInput);
const manifest = JSON.parse(readFileSync(manifestInput, 'utf8'));
assert.equal(manifest.reviewedFor, 'experience-output-originals-local-sqlite');
const modulePaths = [
  'worker/output-command-core.ts', 'worker/event-write-primitives.ts', 'worker/policy-version.ts',
  'worker/event-privacy.ts', 'worker/access-policy.ts', 'worker/canvas-governance-policy.ts',
  'worker/image-adapter-evaluation-evidence.ts', 'src/platform/capabilities.ts',
  'src/model/output-requirement-events.ts', 'src/model/presentation-candidates.ts',
  'src/model/generation-execution-evidence.ts', 'src/model/provider-submission.ts',
  'worker/experience-output-originals.ts', 'worker/experience-output-binding.ts',
  'worker/experience-scene-renewal.ts',
  'src/experiences/compiler.ts', 'src/experiences/image-ratio.ts',
  'src/experiences/video-reference.ts', 'src/experiences/contracts.ts',
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
  value: function forbiddenOriginalsFetch() { forbiddenFetchAttempts++; throw Error('Network forbidden in indexed-original qualification'); },
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
  assert.ok(allowed.has(file), `Unreviewed original-reader dependency: ${file}`);
  return nextResolve(pathToFileURL(file).href, context);
}, load(url, context, nextLoad) {
  const file = realpathSync(fileURLToPath(url));
  assert.ok(allowed.has(file), `Unreviewed loaded original-reader dependency: ${file}`);
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
  try { assert.equal(forbiddenFetchAttempts, 0, 'A forbidden fetch was attempted, even if an original-reader catch swallowed its error'); }
  finally { cleanup(); }
});
let core, primitives, originals, bindingHelpers, compiler, renewal;
try {
  core = await import(pathToFileURL(resolve(root, 'worker/output-command-core.ts')).href);
  primitives = await import(pathToFileURL(resolve(root, 'worker/event-write-primitives.ts')).href);
  originals = await import(pathToFileURL(resolve(root, 'worker/experience-output-originals.ts')).href);
  bindingHelpers = await import(pathToFileURL(resolve(root, 'worker/experience-output-binding.ts')).href);
  compiler = await import(pathToFileURL(resolve(root, 'src/experiences/compiler.ts')).href);
  renewal = await import(pathToFileURL(resolve(root, 'worker/experience-scene-renewal.ts')).href);
} catch (error) { cleanup(); throw error; }
// Keep the guard through tests: an unexpected late import must also fail closed.

const { readExperienceOutputOriginal: readOriginal, readExperienceOutputOriginals: readOrderedOriginals,
  experienceOutputPhases: phases } = originals;
const { experienceOutputBinding, experienceOutputCommandKey, experienceOutputEnvelope } = bindingHelpers;
const writeColumns = primitives.EVENT_WRITE_COLUMNS.split(',');
const tables = ['events', 'event_private_payloads', 'event_write_stage', 'output_commands'];
const privateMarker = 'Original qualification text · α 👩🏽‍💻';

function database() {
  const db = new DatabaseSync(':memory:');
  // Minimal local tables for this exact read. Not a deployed schema/migration.
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE events(event_id TEXT PRIMARY KEY,stream_id TEXT NOT NULL,sequence INTEGER NOT NULL,occurred_at TEXT,recorded_at TEXT,actor TEXT,client_id TEXT,correlation_id TEXT,causation_id TEXT,compensates_event_id TEXT,schema_version INTEGER,type TEXT,payload TEXT NOT NULL,UNIQUE(stream_id,sequence));
    CREATE TABLE event_private_payloads(private_event_id TEXT PRIMARY KEY REFERENCES events(event_id),owner_id TEXT NOT NULL,project_id TEXT,document_id TEXT,private_json TEXT,created_at TEXT,redacted_at TEXT);
    CREATE TABLE event_write_stage(${writeColumns.map(name => `${name} ${['sequence', 'schema_version'].includes(name) ? 'INTEGER' : 'TEXT'}`).join(',')});
    CREATE TABLE output_commands(scope_key TEXT,actor_user_id TEXT,command_key TEXT,request_digest TEXT,action TEXT,event_id TEXT REFERENCES events(event_id),created_at TEXT,PRIMARY KEY(scope_key,actor_user_id,command_key));
  `);
  db.exec(primitives.EVENT_WRITE_STAGE_TRIGGER_SQL); // Actual extracted trigger/privacy, not a fixture algorithm.
  return db;
}

// Real local SQLite transport. The production-facing port permits SELECT only;
// direct fixture setup/corruption is explicit and separate from reader actions.
function prepared(db, state, sql, bindings = []) {
  return { bind(...values) { return prepared(db, state, sql, values); },
    async first() {
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Original reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      const row = db.prepare(sql).get(...bindings) ?? null;
      const interleave = state.afterNextRead; state.afterNextRead = null;
      interleave?.(); // Controlled fixture mutation after the actual SQL read.
      return row;
    },
    async all() {
      if (!/^\s*SELECT\b/iu.test(sql)) { state.forbiddenWrites++; throw Error('Original reader attempted a non-SELECT'); }
      state.reads.push({ sql, bindings: [...bindings] });
      return { results: db.prepare(sql).all(...bindings), success: true };
    },
    run() { state.forbiddenWrites++; throw Error('Original reader attempted a write'); },
  };
}
function harness(t) {
  const db = database(), state = { reads: [], forbiddenWrites: 0, afterNextRead: null };
  const scope = { kind: 'personal', key: 'personal:original-qualification', ownerUserId: 'author-1', actorUserId: 'author-1',
    projectId: 'project-1', documentId: 'document-1', organizationId: null, projectAccessId: null, contextId: null };
  const env = { DB: { prepare: sql => prepared(db, state, sql),
    async batch() { state.forbiddenWrites++; throw Error('Original reader attempted a batch'); },
    async exec() { state.forbiddenWrites++; throw Error('Original reader attempted schema/write execution'); },
  } };
  t.after(() => {
    try { assert.equal(state.forbiddenWrites, 0, 'Reader write attempts are forbidden, including swallowed failures'); }
    finally { core.resetRetainedOutputPrivateBodies(scope); db.close(); }
  });
  // Only consumed members; no fake current principal, accepted quote or full
  // OutputTrustedContext is supplied or inferred from a successful lookup.
  const trusted = { env, scope };
  const snapshot = () => Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  return { db, state, scope, env, trusted, snapshot };
}
async function bindingFor(output = 'image') {
  return experienceOutputBinding({
    draftId: `experience-draft-${'a'.repeat(64)}`, draftHash: `sha256:${'b'.repeat(64)}`,
    release: { releaseHash: `sha256:${'c'.repeat(64)}`, output: { output } },
    request: { qualification: true, output, authored: { note: privateMarker, ratio: { width: 1, height: 1 } } },
    events: [{ type: 'OriginalQualificationSource', payload: { note: privateMarker } }],
    projectId: 'project-1', documentId: 'document-1', streamId: 'creative:author-1',
  });
}
async function seed(h, binding, phase = 'save', phasePayload = {}) {
  const sequence = Number(h.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM events').get().next);
  const envelope = await experienceOutputEnvelope(binding, phase, 0, { qualification: { note: privateMarker, order: ['one', 'two'] } });
  const key = await experienceOutputCommandKey(binding, phase), digest = (await compiler.digest(envelope)).slice(7);
  const payload = { project_id: h.scope.projectId, document_id: h.scope.documentId, qualification_note: privateMarker,
    output_command_envelope: envelope, ...phasePayload };
  // Ordinary witness only. A phase named run/authorize does NOT prepare a job,
  // reserve funds, record consent or dispatch anything in this read fixture.
  const event = primitives.makeEvent(binding.streamId, sequence, `user:${h.scope.actorUserId}`,
    'server:output-requirements', key, 'ExperienceOriginalQualification', payload);
  h.db.prepare(`INSERT INTO event_write_stage(${primitives.EVENT_WRITE_COLUMNS}) VALUES(${writeColumns.map(() => '?').join(',')})`)
    .run(...primitives.eventWriteBindings(event));
  h.db.prepare('INSERT INTO output_commands VALUES(?,?,?,?,?,?,?)')
    .run(h.scope.key, h.scope.actorUserId, key, digest, phase, event.eventId, event.recordedAt);
  return { envelope, key, digest, event, payload, sequence };
}
async function unchangedRead(h, binding, phase = 'save', trusted = h.trusted) {
  const before = h.snapshot();
  try { return await readOriginal(trusted, binding, phase); }
  finally { assert.deepEqual(h.snapshot(), before, 'Original lookup must not write a replacement or alter retained records'); }
}
function replacePrivate(h, saved, value) {
  h.db.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?')
    .run(typeof value === 'string' ? value : JSON.stringify(value), saved.event.eventId);
}
async function rewriteEnvelope(h, saved, mutate, updateDigest = false) {
  const envelope = structuredClone(saved.envelope); mutate(envelope);
  replacePrivate(h, saved, { ...saved.payload, output_command_envelope: envelope });
  if (updateDigest) h.db.prepare('UPDATE output_commands SET request_digest=? WHERE command_key=?')
    .run((await compiler.digest(envelope)).slice(7), saved.key);
}
const unavailable = error => error instanceof Error && !(error instanceof core.OutputConflictError)
  && error.message === 'experience_output_original_unavailable' && error.code === 'experience_output_original_unavailable' && error.status === 410;
const envelopeUnavailable = error => error instanceof Error && !(error instanceof core.OutputConflictError)
  && error.message === 'experience_output_original_envelope_unavailable' && error.code === undefined && error.status === undefined;
const coreError = (code, status) => error => error instanceof core.OutputConflictError && error.code === code && error.status === status;

test('exact Image and Slides index/receipt/private-envelope association returns the retained original without public envelope leakage', async t => {
  for (const output of ['image', 'slides']) {
    const h = harness(t), binding = await bindingFor(output), saved = await seed(h, binding);
    const found = await unchangedRead(h, binding);
    assert.deepEqual(found.envelope, saved.envelope);
    assert.deepEqual({ sequence: found.sequence, digest: found.digest, eventId: found.receipt.eventId,
      action: found.receipt.action, key: found.receipt.key, requestDigest: found.receipt.requestDigest, createdAt: found.receipt.createdAt },
    { sequence: saved.sequence, digest: saved.digest, eventId: saved.event.eventId,
      action: 'save', key: saved.key, requestDigest: saved.digest, createdAt: saved.event.recordedAt });
    assert.deepEqual(found.receipt.payload, saved.payload);
    assert.equal(found.receipt.privateUnavailable, undefined);
    assert.deepEqual(await unchangedRead(h, binding), found);
    const publicPayload = JSON.parse(h.db.prepare('SELECT payload FROM events WHERE event_id=?').get(saved.event.eventId).payload);
    assert.equal(Object.hasOwn(publicPayload, 'output_command_envelope'), false);
    assert.equal(JSON.stringify(publicPayload).includes(privateMarker), false);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM output_commands').get().count, 1);
    found.envelope.qualification.note = 'Changed returned copy';
    assert.deepEqual((await unchangedRead(h, binding)).envelope, saved.envelope);
  }
});

test('no matching command index is null even when an unrelated original exists', async t => {
  const h = harness(t), binding = await bindingFor();
  assert.equal(await unchangedRead(h, binding), null);
  await seed(h, binding);
  assert.equal(await unchangedRead(h, binding, 'confirm'), null);
  const otherDraft = { ...binding, draftId: `experience-draft-${'d'.repeat(64)}` };
  assert.equal(await unchangedRead(h, otherDraft), null);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM output_commands').get().count, 1);
});

test('an existing index with missing event or invalid indexed sequence/digest stays unavailable, never absent', async t => {
  for (const corruption of ['missing_event', 'zero_sequence', 'fractional_sequence', 'text_sequence', 'missing_digest']) {
    const h = harness(t), binding = await bindingFor(), saved = await seed(h, binding);
    if (corruption === 'missing_event') {
      // Deliberate disposable corruption; normal fixture writes keep FKs on.
      h.db.exec('PRAGMA foreign_keys=OFF');
      h.db.prepare('DELETE FROM events WHERE event_id=?').run(saved.event.eventId);
      h.db.exec('PRAGMA foreign_keys=ON');
    } else if (corruption === 'missing_digest') {
      h.db.prepare('UPDATE output_commands SET request_digest=NULL WHERE command_key=?').run(saved.key);
    } else {
      const value = corruption === 'zero_sequence' ? 0 : corruption === 'fractional_sequence' ? 1.5 : 'invalid-sequence';
      h.db.prepare('UPDATE events SET sequence=? WHERE event_id=?').run(value, saved.event.eventId);
    }
    await assert.rejects(() => unchangedRead(h, binding), unavailable, corruption);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM output_commands').get().count, 1);
  }
});

test('missing, redacted or differently scoped private body behind an index is retained-unavailable', async t => {
  for (const corruption of ['missing', 'redacted', 'owner', 'project', 'document', 'null_json']) {
    const h = harness(t), binding = await bindingFor(), saved = await seed(h, binding);
    const id = saved.event.eventId;
    if (corruption === 'missing') h.db.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(id);
    if (corruption === 'redacted') h.db.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?').run('2026-01-01T00:00:00.000Z', id);
    if (corruption === 'owner') h.db.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run('other-owner', id);
    if (corruption === 'project') h.db.prepare('UPDATE event_private_payloads SET project_id=? WHERE private_event_id=?').run('other-project', id);
    if (corruption === 'document') h.db.prepare('UPDATE event_private_payloads SET document_id=? WHERE private_event_id=?').run('other-document', id);
    if (corruption === 'null_json') h.db.prepare('UPDATE event_private_payloads SET private_json=NULL WHERE private_event_id=?').run(id);
    await assert.rejects(() => unchangedRead(h, binding), unavailable, corruption);
  }
});

test('malformed or non-object private JSON preserves actual core parser/error behavior', async t => {
  for (const raw of ['{not-json', 'null', '[]', '42']) {
    const h = harness(t), binding = await bindingFor(), saved = await seed(h, binding);
    replacePrivate(h, saved, raw);
    await assert.rejects(() => unchangedRead(h, binding), raw === '{not-json' ? SyntaxError
      : coreError('output_private_evidence_unavailable', 410));
  }
});

test('complete envelope, binding, revision and digest failures preserve the validator error without a fabricated status', async t => {
  const mutations = [
    value => { value.action = 'confirm'; }, value => { value.documentId = 'other-document'; },
    value => { value.clientMutationId = 'replacement-key'; }, value => { value.expectedRevision = 'output:01'; },
    value => { value.expectedRevision = `output:${Number.MAX_SAFE_INTEGER + 1}`; },
    value => { value.experienceBinding.sourceBindingHash = `sha256:${'e'.repeat(64)}`; },
    value => { value.experienceBinding.unrecognized = true; },
  ];
  for (const mutate of mutations) {
    const h = harness(t), binding = await bindingFor(), saved = await seed(h, binding);
    await rewriteEnvelope(h, saved, mutate, true); // Digest matches bad shape; actual envelope guard must reject it.
    await assert.rejects(() => unchangedRead(h, binding), envelopeUnavailable);
  }
  {
    const h = harness(t), binding = await bindingFor(), saved = await seed(h, binding);
    await rewriteEnvelope(h, saved, value => { delete value.experienceBinding; }, true);
    // Preserve the current canonicalJson(undefined) error, not an invented
    // envelope-validator status or a newly normalized production error.
    await assert.rejects(() => unchangedRead(h, binding), error => error instanceof TypeError
      && error.message === 'invalid_json' && error.code === undefined && error.status === undefined);
  }
  for (const corruption of ['missing_envelope', 'changed_field_old_digest', 'wrong_index_digest']) {
    const h = harness(t), binding = await bindingFor(), saved = await seed(h, binding);
    if (corruption === 'missing_envelope') replacePrivate(h, saved, { project_id: h.scope.projectId, document_id: h.scope.documentId });
    if (corruption === 'changed_field_old_digest') await rewriteEnvelope(h, saved, value => { value.qualification.note = 'Changed retained field'; });
    if (corruption === 'wrong_index_digest') h.db.prepare('UPDATE output_commands SET request_digest=? WHERE command_key=?').run('f'.repeat(64), saved.key);
    await assert.rejects(() => unchangedRead(h, binding), envelopeUnavailable, corruption);
  }
});

test('lookup namespace absence differs from an indexed receipt with wrong actor/scope/event metadata', async t => {
  const h = harness(t), binding = await bindingFor(); await seed(h, binding);
  for (const change of [{ key: 'other-scope' }, { actorUserId: 'other-actor' }]) {
    assert.equal(await unchangedRead(h, binding, 'save', { env: h.env, scope: { ...h.scope, ...change } }), null);
  }
  for (const change of [{ ownerUserId: 'other-owner' }, { projectId: 'other-project' }, { documentId: 'other-document' }]) {
    await assert.rejects(() => unchangedRead(h, binding, 'save', { env: h.env, scope: { ...h.scope, ...change } }),
      coreError('output_command_scope_mismatch', 403));
  }
  for (const [column, value] of [['actor', 'user:other-actor'], ['stream_id', 'creative:other-owner'],
    ['client_id', 'other-client'], ['correlation_id', 'other-key']]) {
    const local = harness(t), localBinding = await bindingFor(), saved = await seed(local, localBinding);
    assert.ok(['actor', 'stream_id', 'client_id', 'correlation_id'].includes(column));
    local.db.prepare(`UPDATE events SET ${column}=? WHERE event_id=?`).run(value, saved.event.eventId);
    await assert.rejects(() => unchangedRead(local, localBinding), coreError('output_command_scope_mismatch', 403));
  }
});

test('phase-specific identity and action are checked by the real reader, without executing a phase', async t => {
  assert.deepEqual(phases, ['save', 'confirm', 'preflight', 'authorize', 'run']);
  const h = harness(t), binding = await bindingFor(), keys = new Set();
  for (const phase of phases) {
    const saved = await seed(h, binding, phase), found = await unchangedRead(h, binding, phase);
    keys.add(saved.key); assert.equal(found.receipt.action, phase); assert.equal(found.envelope.action, phase);
    assert.equal(found.receipt.eventId, saved.event.eventId);
  }
  assert.equal(keys.size, 5);
  const saveKey = await experienceOutputCommandKey(binding, 'save');
  h.db.prepare('UPDATE output_commands SET action=? WHERE command_key=?').run('confirm', saveKey);
  await assert.rejects(() => unchangedRead(h, binding), unavailable);
  // This is per-phase lookup, not ordered-gap validation or execute/resume.
});

test('a changed release/request/source binding cannot escape the original logical stage key or create a replacement', async t => {
  for (const field of ['draftHash', 'releaseHash', 'requestHash', 'sourceBindingHash']) {
    const h = harness(t), binding = await bindingFor(), saved = await seed(h, binding);
    const changed = { ...binding, [field]: `sha256:${'e'.repeat(64)}` };
    assert.equal(await experienceOutputCommandKey(changed, 'save'), saved.key);
    await assert.rejects(() => unchangedRead(h, changed), envelopeUnavailable);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM output_commands').get().count, 1);
    assert.equal(h.db.prepare('SELECT event_id FROM output_commands WHERE command_key=?').get(saved.key).event_id, saved.event.eventId);
  }
});

test('a digest or event association changing between index and receipt reads fails with the original error', async t => {
  for (const change of ['digest', 'missing_event', 'different_receipt_event']) {
    const h = harness(t), binding = await bindingFor(), saved = await seed(h, binding);
    let replacementEvent = null;
    if (change === 'different_receipt_event') {
      // An ordinary local witness with the same metadata/envelope. No new command
      // intent is created by the production reader; this mutation is the fixture.
      replacementEvent = primitives.makeEvent(binding.streamId, 2, `user:${h.scope.actorUserId}`,
        'server:output-requirements', saved.key, 'ExperienceOriginalQualification', saved.payload);
      h.db.prepare(`INSERT INTO event_write_stage(${primitives.EVENT_WRITE_COLUMNS}) VALUES(${writeColumns.map(() => '?').join(',')})`)
        .run(...primitives.eventWriteBindings(replacementEvent));
    }
    h.state.afterNextRead = () => {
      if (change === 'digest') h.db.prepare('UPDATE output_commands SET request_digest=? WHERE command_key=?').run('f'.repeat(64), saved.key);
      if (change === 'missing_event') {
        h.db.exec('PRAGMA foreign_keys=OFF');
        h.db.prepare('DELETE FROM events WHERE event_id=?').run(saved.event.eventId);
        h.db.exec('PRAGMA foreign_keys=ON');
      }
      if (change === 'different_receipt_event') h.db.prepare('UPDATE output_commands SET event_id=? WHERE command_key=?').run(replacementEvent.eventId, saved.key);
    };
    await assert.rejects(() => readOriginal(h.trusted, binding, 'save'), change === 'digest'
      ? coreError('mutation_key_reused_with_different_content', 409) : unavailable);
    assert.equal(h.state.afterNextRead, null);
    assert.equal(h.state.forbiddenWrites, 0);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM output_commands').get().count, 1);
  }
});

test('changed retained private bytes under the same read scope preserve the R4 private-evidence conflict', async t => {
  const h = harness(t), binding = await bindingFor(), saved = await seed(h, binding);
  const found = await unchangedRead(h, binding);
  assert.deepEqual(found.envelope, saved.envelope);
  // Semantically identical JSON but different exact bytes. Existing evidence
  // retention is byte-sensitive; no replacement body is reconstructed here.
  replacePrivate(h, saved, JSON.stringify(saved.payload, null, 2));
  await assert.rejects(() => unchangedRead(h, binding), coreError('output_private_evidence_changed', 409));
});

test('actual ordered reader returns no originals or the exact contiguous retained prefix without writes', async t => {
  for (let length = 0; length <= phases.length; length++) {
    const h = harness(t), binding = await bindingFor(), saved = [];
    for (const phase of phases.slice(0, length)) saved.push(await seed(h, binding, phase));
    const before = h.snapshot(), found = await readOrderedOriginals(h.trusted, binding);
    assert.deepEqual(h.snapshot(), before);
    assert.deepEqual(Object.keys(found), phases.slice(0, length));
    for (const [index, phase] of phases.slice(0, length).entries()) {
      assert.equal(found[phase].receipt.eventId, saved[index].event.eventId);
      assert.equal(found[phase].receipt.key, saved[index].key);
      assert.equal(found[phase].sequence, saved[index].sequence);
      assert.deepEqual(found[phase].envelope, saved[index].envelope);
    }
  }
});

test('actual ordered reader rejects a found phase after a missing predecessor with the unchanged gap error', async t => {
  // Fixture data only. Ordering enforcement is exclusively the actual exported
  // production helper, never a test reimplementation of its missing-phase loop.
  for (const present of [['confirm'], ['save', 'preflight'], ['save', 'confirm', 'authorize'],
    ['save', 'confirm', 'preflight', 'run']]) {
    const h = harness(t), binding = await bindingFor();
    for (const phase of present) await seed(h, binding, phase);
    const before = h.snapshot();
    await assert.rejects(() => readOrderedOriginals(h.trusted, binding), error => error instanceof Error
      && !(error instanceof core.OutputConflictError) && error.message === 'experience_output_stage_evidence_unavailable'
      && error.code === 'experience_output_stage_evidence_unavailable' && error.status === 410);
    assert.deepEqual(h.snapshot(), before, 'Gap detection must not backfill or replace a missing phase');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM output_commands').get().count, present.length);
  }
});

async function seedScenePreparation(h, binding, name) {
  const plan = {revisionId: `plan-${name}`, sourceDigest: 'source-1', requirementsDigest: 'requirements-1'};
  await seed(h, binding, 'confirm', {plan_revision_id: plan.revisionId, confirmed_plan: plan});
  await seed(h, binding, 'preflight', {plan_revision_id: plan.revisionId, preflight_id: `preflight-${name}`,
    preflight: {id: `preflight-${name}`, planRevisionId: plan.revisionId, sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest}});
}
async function lineage(h, binding) {
  const before = h.snapshot();
  try { return await originals.readExperienceOutputLineage(h.trusted, binding); }
  finally { assert.deepEqual(h.snapshot(), before, 'Lineage lookup must not mutate originals'); }
}
async function sceneRoot(t) {
  const h = harness(t), binding = await bindingFor('scene');
  await seed(h, binding); await seedScenePreparation(h, binding, 'root');
  const original = await lineage(h, binding);
  const predecessor = originals.scenePreparationPredecessor(binding, original.originals);
  const child = {...binding, preparationCycle: await renewal.scenePreparationSuccessor(binding, predecessor)};
  return {h, binding, child, original};
}

test('Scene lineage retains root v1 parity and every predecessor witness when selecting a partial or complete successor', async t => {
  const {h, binding, child, original} = await sceneRoot(t);
  assert.deepEqual(original.binding, binding); assert.equal(original.witnesses.length, 3);
  await seed(h, child, 'confirm', {plan_revision_id: 'plan-child', confirmed_plan: {revisionId: 'plan-child', sourceDigest: 'source-1', requirementsDigest: 'requirements-1'}});
  const partial = await lineage(h, binding);
  assert.equal(partial.binding.preparationCycle.id, child.preparationCycle.id);
  assert.equal(partial.originals.save.receipt.eventId, original.originals.save.receipt.eventId);
  assert.equal(partial.originals.preflight, undefined); assert.equal(partial.witnesses.length, 4);
  await seed(h, child, 'preflight', {plan_revision_id: 'plan-child', preflight_id: 'preflight-child', preflight: {
    id: 'preflight-child', planRevisionId: 'plan-child', sourceDigest: 'source-1', requirementsDigest: 'requirements-1'}});
  const complete = await lineage(h, binding);
  assert.equal(complete.witnesses.length, 5);
  assert.deepEqual(complete.witnesses.slice(0, 3), original.witnesses);
  assert.equal(complete.originals.preflight.receipt.payload.preflight.id, 'preflight-child');
});

test('Scene lineage refuses a successor phase hole and an orphan with a foreign predecessor instead of falling back', async t => {
  for (const kind of ['hole', 'orphan']) {
    const {h, binding, child} = await sceneRoot(t);
    if (kind === 'hole') await seed(h, child, 'preflight');
    else {
      const altered = {...child.preparationCycle.predecessor, confirmation: {...child.preparationCycle.predecessor.confirmation, eventId: 'foreign'}};
      await seed(h, {...binding, preparationCycle: await renewal.scenePreparationSuccessor(binding, altered)}, 'confirm');
    }
    await assert.rejects(() => lineage(h, binding), /experience_scene_renewal_lineage_unavailable/);
  }
});

test('Scene lineage refuses an indexed successor with unavailable private body, never selecting the retained root', async t => {
  const {h, binding, child} = await sceneRoot(t), saved = await seed(h, child, 'confirm');
  h.db.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?').run('2026-09-13T00:00:00.000Z', saved.event.eventId);
  await assert.rejects(() => lineage(h, binding), /experience_output_original_unavailable/);
});

test('Scene lineage refuses a child after any predecessor authorization even when a child index exists', async t => {
  const {h, binding, child} = await sceneRoot(t);
  await seed(h, binding, 'authorize'); await seed(h, child, 'confirm');
  await assert.rejects(() => lineage(h, binding), /experience_scene_renewal_lineage_unavailable/);
});
