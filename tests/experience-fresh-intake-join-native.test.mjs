import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile } from 'node:child_process';
import { readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { installNativeFreshIntakeLoader, loadNativeFreshIntake, sha256, throwFailures } from './helpers/fresh-intake-join-native.mjs';

const manifestPath = process.env.FORMA_FRESH_INTAKE_NATIVE_SOURCE_MANIFEST;
assert.ok(manifestPath, 'Explicit pinned native source manifest required');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const self = fileURLToPath(import.meta.url);
assert.equal(sha256(readFileSync(self)), manifest.testSha256, 'Native case/loader controls source pin mismatch');
const mode = process.env.FORMA_FRESH_INTAKE_NATIVE_MODE;
assert.ok(['cases', 'guards', 'control'].includes(mode), 'Choose the focused cases or isolated loader guards explicitly');

async function control(name) {
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const originalRoot = process.env.FORMA_SOURCE_ROOT, hadRoot = Object.hasOwn(process.env, 'FORMA_SOURCE_ROOT');
  const originalListeners = process.listeners('exit');
  const input = structuredClone(manifest);
  input.recordPath = resolve(dirname(manifest.recordPath), `control-${name}-graph.json`);
  const clean = () => {
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'fetch'), originalFetch);
    assert.equal(Object.hasOwn(process.env, 'FORMA_SOURCE_ROOT'), hadRoot);
    assert.equal(process.env.FORMA_SOURCE_ROOT, originalRoot);
    assert.deepEqual(process.listeners('exit'), originalListeners);
  };
  if (name === 'wrong-head') {
    input.head = '0'.repeat(input.head.length);
    await assert.rejects(installNativeFreshIntakeLoader(input), /Pinned native HEAD mismatch/u);
  } else if (name === 'wrong-overlay') {
    const first = Object.keys(input.overlays)[0];
    assert.ok(first, 'This focused control requires the explicitly pinned authoring overlay');
    input.overlays[first] = '0'.repeat(64);
    await assert.rejects(installNativeFreshIntakeLoader(input), /Pinned overlay mismatch/u);
  } else if (name === 'setup-failure') {
    const primary = new Error('deliberate-native-loader-setup-failure');
    await assert.rejects(installNativeFreshIntakeLoader(input, { injectSetupFailure: primary }), error => error === primary);
  } else if (name === 'record-symlink') {
    const target = resolve(input.sourceRoot, 'worker/policy-version.ts'), before = readFileSync(target);
    symlinkSync(target, input.recordPath);
    try {
      await assert.rejects(installNativeFreshIntakeLoader(input), /Record target must be new/u);
      assert.deepEqual(readFileSync(target), before, 'Evidence path cannot overwrite pinned source');
    } finally { unlinkSync(input.recordPath); }
  } else {
    const loader = await installNativeFreshIntakeLoader(input);
    try {
      if (name === 'escape') {
        const external = resolve(dirname(input.recordPath), 'outside-root-probe.mjs');
        writeFileSync(external, 'globalThis.__freshIntakeEscaped = true;\n');
        await assert.rejects(loader.load(pathToFileURL(external).href), /module-root refused/u);
        assert.equal(globalThis.__freshIntakeEscaped, undefined, 'Outside source did not execute');
      } else if (name === 'network') {
        await assert.rejects(loader.load('node:net'), /network-builtin refused/u);
      } else if (name === 'fetch') {
        assert.throws(() => globalThis.fetch('https://qualification.invalid/forbidden'), /Network forbidden/u);
      } else assert.fail('Unknown native loader control');
      assert.throws(() => loader.finish(), /Caught forbidden (?:fetch attempts|imports)/u,
        'Swallowed refusal must not produce green qualification');
    } finally { clean(); }
  }
  clean();
  // Importing the builtin after cleanup proves the network-import hook is gone;
  // no socket is constructed and no request is made.
  await import('node:net');
  writeFileSync(resolve(dirname(input.recordPath), `control-${name}-result.json`), JSON.stringify({ name, passed: true,
    descriptorRestored: true, sourceRootRestored: true, exitListenersRestored: true, noConnectionCreated: true }) + '\n');
}

if (mode === 'control') {
  await control(process.env.FORMA_FRESH_INTAKE_NATIVE_CONTROL);
} else if (mode === 'guards') {
  const run = promisify(execFile);
  test('native fresh-intake loader integrity and cleanup controls', async t => {
    for (const name of ['wrong-head', 'wrong-overlay', 'escape', 'network', 'fetch', 'setup-failure', 'record-symlink']) {
      await t.test(name, async () => {
        const result = await run(process.execPath, ['--experimental-transform-types', self], {
          env: { ...process.env, FORMA_FRESH_INTAKE_NATIVE_MODE: 'control', FORMA_FRESH_INTAKE_NATIVE_CONTROL: name },
          timeout: 30_000, maxBuffer: 1024 * 1024,
        });
        assert.equal(result.stdout, '');
      });
    }
  });
} else {
  // The entire original case/support tail remains byte-identical. This runner
  // replaces only the frozen finite-loader setup, and makes no endpoint claim.
  const legacy = readFileSync(resolve(manifest.sourceRoot, 'tests/experience-fresh-intake-join.test.mjs'), 'utf8');
  const tail = legacy.slice(legacy.indexOf("const AUTHOR = 'r16-author'"));
  assert.equal(sha256(tail), manifest.originalCaseTailSha256);
  const own = readFileSync(self, 'utf8');
  const ownTail = own.slice(own.indexOf("const AUTHOR = 'r16-author'", own.indexOf('// BEGIN ORIGINAL CASE SUPPORT')),
    own.lastIndexOf('// END ORIGINAL CASE SUPPORT'));
  assert.equal(ownTail, tail, 'Original four cases and supporting assertions remain byte-identical');
  const { loader, readPrincipal, continueExperienceAuthorization, readDraft, retainedGuard, join,
    registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan, receiptPrefix, experienceDocumentRoute,
    canonicalJson, commitAtomicIntake, projectIntakeAuthority, storePrivateContent, POLICY_VERSION, primitives,
    createFreshIntakeJoinSqlite } = await loadNativeFreshIntake(manifest);
  after(() => loader.finish());
  // BEGIN ORIGINAL CASE SUPPORT
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
// END ORIGINAL CASE SUPPORT
}
