import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test as nativeTest } from 'node:test';
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises';
import { copyWriterFixture, genuineReservation, installCopyWriterGuards, claimOwner, attemptTable }
  from './experience-guest-image-result-copy-writer.test.mjs';
import { snapshot, rows, knownPngOracle, deferred, payer } from './helpers/guest-image-result-media-fixture.mjs';
import { guardInventory, changes } from './helpers/guest-image-result-inventory-fixture.mjs';
import { pngChunk, join as joinPngBytes } from './output-asset-fixtures.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportSynthetic } from './helpers/model3d-workerd-snapshot.mjs';

// SOURCE-AUTHORED ONLY: this file depends on the qualified local copy-writer
// fixture being composed into this checkout. Do not import a sibling checkout:
// copy/ready tokens belong to one actual worker module graph. The imported
// fixture's directlyInvoked gate does not register its unrelated writer tests.
// No positive custody, revision, capability, canonical event or receipt is
// fabricated here. Real source/SAVE/Run, copy, and claim producers create it.
const [api, media, custody, copyContract, sceneVersion, principal, intakeAuthority, eventRead, presentation] = await Promise.all([
  import('../worker/experience-guest-image-result-claim-source.ts'),
  import('../worker/experience-guest-image-result-media.ts'),
  import('../worker/experience-guest-image-result-custody.ts'),
  import('../worker/experience-guest-image-result-copy-contract.ts'),
  import('../worker/scene-source-generation.ts'),
  import('../worker/principal-request-core.ts'),
  import('../worker/intake-authority.ts'),
  import('../worker/event-read-primitives.ts'),
  import('../src/model/guest-image-result-presentation.ts'),
]);
const closers = new WeakMap();
const test = (name, run) => nativeTest(name, { timeout: 30000, concurrency: false }, async t => {
  const owned = []; closers.set(t, owned);
  try { await run(t); } finally { for (const close of owned.reverse()) close(); }
});
const track = (t, close) => { closers.get(t).push(close); return close; };
const hash = value => createHash('sha256').update(value).digest('hex');
const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu;
const claimTables = new Set(['events', 'event_private_payloads', 'event_write_stage', 'event_client_receipts', 'output_commands', 'private_content',
  'experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_image_stage_custodies',
  'experience_guest_image_stage_copies', 'experience_guest_image_result_custodies', 'experience_guest_image_result_copies',
  'experience_guest_sessions', attemptTable]);
const destinationState = new WeakMap();
class DestinationObject {
  constructor(raw, state) { destinationState.set(this, { raw, state }); }
  get key() { return destinationState.get(this).raw.key; }
  get version() { return destinationState.get(this).raw.version; }
  get size() { return destinationState.get(this).raw.size; }
  get etag() { return destinationState.get(this).raw.etag; }
  get httpEtag() { return destinationState.get(this).raw.httpEtag; }
  get uploaded() { return destinationState.get(this).raw.uploaded; }
  get customMetadata() { return destinationState.get(this).raw.metadata; }
  get httpMetadata() { return destinationState.get(this).raw.httpMetadata; }
  writeHttpMetadata(headers) {
    const value = destinationState.get(this); assert.ok(value, 'native metadata receiver retained');
    value.state.metadataCalls++; headers.set('content-type', value.raw.httpMetadata.contentType);
  }
}
class DestinationBody extends DestinationObject {
  get body() { return destinationState.get(this).raw.body; }
}
const storedSnapshot = objects => [...objects].map(([key, value]) => ({ key, ...value,
  bytes: Buffer.from(value.bytes).toString('base64'), metadata: structuredClone(value.metadata) }));

/** Read guards cannot inherit the publication write allowlist. All native raw
 * entry points are guarded, and caught violations still fail fixture cleanup.
 * Fault hooks only alter returned observations, or explicitly recorded local
 * fixture state; they never replace a positive authority/capability API. */
function phaseGuard(t, f, objects, { publication = false } = {}) {
  const io = guardInventory(f, t, { database: false, snapshotDatabase: false });
  const original = { prepare: f.DB.prepare, batch: f.DB.batch };
  const blocked = new Map(['exec', 'dump'].map(key => [key, Object.getOwnPropertyDescriptor(f.DB, key)]));
  const initial = snapshot(f), initialObjects = storedSnapshot(objects);
  let expected = initial, expectedChanges = changes(f), active = new Set(), closed = false;
  const handles = new WeakMap(), violations = [], statements = [], calls = [], pending = new Set();
  const state = { beforeGet: null, beforeHead: null, readTransform: null, batchTransform: null, getTransform: null, headTransform: null,
    metadataCalls: 0, streamReads: 0, streamCancels: 0, streamEofs: 0, streamChunkCount: null, chunks: [], fixtureMutations: [] };
  const denied = operation => { violations.push(operation); throw Error('claimed current fixture blocked ' + operation); };
  const conform = fn => { try { return fn(); } catch (error) { violations.push(String(error)); throw error; } };
  const qualify = (sql, bindings, method) => conform(() => {
    assert.equal(typeof sql, 'string'); assert.ok(Buffer.byteLength(sql) <= 100000); assert.ok(bindings.length <= 100);
    const inserted = /^\s*INSERT INTO ([a-z_]+)\b/u.exec(sql)?.[1], updated = /^\s*UPDATE ([a-z_]+) SET\b/u.exec(sql)?.[1];
    if (inserted || updated) {
      assert.equal(publication, true, 'current reads never mutate'); assert.equal(method, 'batch');
      assert.ok(claimTables.has(inserted ?? updated)); if (updated) assert.ok(['experience_guest_sessions', attemptTable].includes(updated));
      assert.doesNotMatch(sql, /;|--|\/\*/u); assert.equal([...sql.matchAll(new RegExp(mutation.source, 'giu'))].length, 1);
    } else { assert.match(sql, /^\s*(?:SELECT|WITH)\b/iu); assert.doesNotMatch(sql, mutation); }
    statements.push({ sql, bindings: [...bindings], method, inserted, updated });
  });
  function wrap(statement, sql, bindings = []) {
    handles.set(statement, { sql, bindings });
    const bind = statement.bind, direct = statement.execute;
    if (typeof direct === 'function') statement.execute = function (...args) {
      if (!active.has(this)) return denied('unobserved Statement.execute'); return direct.apply(this, args);
    };
    if (typeof statement.raw === 'function') statement.raw = () => denied('Statement.raw');
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql, values); };
    for (const method of ['first', 'all', 'run']) {
      const execute = statement[method]; if (typeof execute !== 'function') continue;
      statement[method] = function (...args) {
        if (method === 'run') return denied('Statement.run outside batch');
        qualify(sql, bindings, method); const previous = active; active = new Set([this]);
        try {
          const result = execute.apply(this, args);
          return state.readTransform ? Promise.resolve(result).then(value => state.readTransform(value, { sql, bindings, method })) : result;
        } finally { active = previous; }
      };
    }
    return statement;
  }
  f.DB.prepare = function (sql) { return wrap(original.prepare.call(this, sql), sql); };
  f.DB.batch = async function (prepared) {
    conform(() => { assert.ok(Array.isArray(prepared)); assert.ok(prepared.length <= 512); });
    const items = prepared.map(statement => {
      const captured = handles.get(statement); if (!captured) return denied('unknown DB batch handle');
      qualify(captured.sql, captured.bindings, 'batch'); return captured;
    });
    const previous = active; active = new Set(prepared);
    let result; try { result = await original.batch.call(this, prepared); } finally { active = previous; }
    return state.batchTransform ? state.batchTransform(result, items) : result;
  };
  for (const method of blocked.keys()) Object.defineProperty(f.DB, method, { configurable: true, writable: true, value: () => denied('DB.' + method) });
  const object = key => conform(() => {
    assert.equal(key, rows(f, attemptTable)[0].destination_key, 'only exact canonical destination key');
    const value = objects.get(key); assert.ok(value); return value;
  });
  const settle = operation => { pending.add(operation); void operation.finally(() => pending.delete(operation)).catch(() => undefined); return operation; };
  f.env.MEDIA.head = function (key, options) {
    conform(() => { assert.equal(this, f.env.MEDIA); assert.equal(options, undefined);
      assert.equal(calls.filter(call => call.kind === 'head').length, 0, 'one exact destination HEAD'); });
    calls.push({ kind: 'head', key }); const stored = object(key);
    return settle((async () => { await state.beforeHead?.();
      const raw = { ...stored, metadata: { ...stored.metadata }, httpMetadata: { ...stored.httpMetadata } };
      return new DestinationObject(state.headTransform ? state.headTransform(raw) : raw, state);
    })());
  };
  if (!publication) f.env.MEDIA.get = function (key, options) {
    conform(() => { assert.equal(this, f.env.MEDIA); assert.equal(options, undefined);
      assert.equal(calls.filter(call => call.kind === 'get').length, 0, 'one exact current PNG GET'); });
    calls.push({ kind: 'get', key }); const stored = object(key);
    return settle((async () => { await state.beforeGet?.();
      const captured = { ...stored, metadata: { ...stored.metadata }, httpMetadata: { ...stored.httpMetadata }, bytes: stored.bytes.slice() };
      const raw = state.getTransform ? state.getTransform(captured) : captured; let offset = 0, emitted = 0;
      const desiredChunks = state.streamChunkCount;
      if (desiredChunks !== null) conform(() => {
        assert.ok(Number.isSafeInteger(desiredChunks) && desiredChunks > 0 && desiredChunks <= raw.bytes.length);
      });
      const body = new ReadableStream({ pull(controller) {
        state.streamReads++; if (offset === raw.bytes.length) { state.streamEofs++; controller.close(); return; }
        // Optional exact distribution changes transport segmentation only. The
        // genuine stored PNG, size, metadata, hashes and all authority stay fixed.
        const width = desiredChunks === null ? 4096 : Math.ceil((raw.bytes.length - offset) / (desiredChunks - emitted));
        const chunk = raw.bytes.slice(offset, Math.min(offset + width, raw.bytes.length)); offset += chunk.length; emitted++;
        if (desiredChunks !== null) conform(() => { assert.ok(chunk.length > 0); assert.ok(emitted <= desiredChunks); });
        state.chunks.push(chunk); controller.enqueue(chunk);
      }, cancel() { state.streamCancels++; } }, { highWaterMark: 0 });
      return new DestinationBody({ ...raw, body }, state);
    })());
  };
  function preserved() {
    assert.deepEqual(violations, []); io.assertUntouched(); assert.deepEqual(storedSnapshot(objects), initialObjects, 'reader cannot rewrite any destination object');
    if (!publication) { assert.deepEqual(snapshot(f), expected, 'no hidden current-read writes'); assert.equal(changes(f), expectedChanges); }
    else {
      const after = snapshot(f); assert.deepEqual(after.schema, initial.schema);
      for (const [table, value] of Object.entries(initial.contents)) {
        if (!claimTables.has(table)) assert.deepEqual(after.contents[table], value, table + ' unchanged by publication');
        else if (!['experience_guest_sessions', attemptTable].includes(table))
          for (const prior of value) assert.ok(after.contents[table].some(row => JSON.stringify(row) === JSON.stringify(prior)), table + ' original row preserved');
      }
      const claims = after.contents.experience_guest_image_result_custodies;
      assert.ok(claims.length <= 1);
      const sessions = initial.contents.experience_guest_sessions.map(value => Object.assign(Object.create(Object.getPrototypeOf(value)), value));
      if (claims.length) {
        const own = sessions.find(row => row.session_id === claims[0].session_id); assert.ok(own);
        assert.equal(own.revoked_at_ms, null); own.revoked_at_ms = claims[0].created_at_ms;
        assert.equal(claims[0].destination_user_id, claimOwner);
      }
      assert.deepEqual(after.contents.experience_guest_sessions, sessions, 'only exact original guest tombstone changes');
      const prior = initial.contents[attemptTable][0], current = after.contents[attemptTable][0];
      assert.equal(after.contents[attemptTable].length, 1);
      for (const column of copyContract.GUEST_IMAGE_RESULT_COPY_IMMUTABLE_COLUMNS)
        assert.equal(current[column], prior[column], column + ' remains immutable');
    }
  }
  const close = track(t, () => {
    if (closed) return; closed = true;
    try { assert.equal(pending.size, 0, 'native storage work settled before fixture cleanup'); preserved(); }
    finally { f.DB.prepare = original.prepare; f.DB.batch = original.batch;
      for (const [method, descriptor] of blocked) { if (descriptor) Object.defineProperty(f.DB, method, descriptor); else delete f.DB[method]; }
      io.close(); }
  });
  t.after(() => { assert.equal(closed, true); assert.deepEqual(violations, []); });
  return { state, calls, statements, close, preserved, count: kind => calls.filter(call => call.kind === kind).length,
    async settle() { await Promise.allSettled([...pending]); },
    fixtureMutation(label, operation) {
      assert.equal(publication, false); assert.deepEqual(snapshot(f), expected); assert.equal(changes(f), expectedChanges);
      state.fixtureMutations.push(label); operation();
      expected = snapshot(f); expectedChanges = changes(f);
    } };
}

async function publishedFixture(t, options = {}) {
  const f = await copyWriterFixture(t, options), writer = installCopyWriterGuards(f, t); let ready;
  try {
    const { reservation } = await genuineReservation(f, writer);
    const copied = await media.copyGuestImageResultMedia(f.request, f.env, reservation);
    assert.equal(copied.status, 'ready'); ready = copied.ready;
    assert.equal(writer.count('put'), 1); assert.equal(writer.count('get'), 1);
  } finally { writer.close(); }
  const publication = phaseGuard(t, f, writer.state.objects, { publication: true }); let claimed;
  try {
    claimed = await api.claimGuestImageResult(f.request, f.env, ready);
    assert.equal(claimed.status, 'claimed'); assert.equal(claimed.custodyTransferred, true);
    assert.equal(publication.count('head'), 1); assert.equal(publication.count('get'), 0);
  } finally { await publication.settle(); publication.close(); }
  const values = rows(f, 'experience_guest_image_result_custodies'); assert.equal(values.length, 1);
  const row = values[0], lineage = JSON.parse(row.lineage_json), attempt = rows(f, attemptTable)[0];
  assert.equal(attempt.state, 'published'); assert.equal(attempt.published_claim_digest, row.lineage_digest);
  assert.equal(row.destination_user_id, claimOwner); assert.equal(row.generation_id, f.completed.body.generation_id);
  assert.equal(rows(f, 'experience_guest_sessions').find(value => value.session_id === row.session_id).revoked_at_ms, row.created_at_ms);
  const canonical = rows(f, 'events').find(value => value.event_id === row.claim_event_id); assert.ok(canonical);
  const privateEvent = rows(f, 'event_private_payloads').find(value => value.private_event_id === row.claim_event_id);
  const payload = JSON.parse(privateEvent.private_json), planner = lineage.resultCopies.find(value => value.role === 'planner');
  const plannerBody = rows(f, 'private_content').find(value => value.content_id === planner.content_id).content;
  f.controller.abort(); assert.equal(f.request.signal.aborted, true, 'original guest/copy request is retired');
  const controller = new AbortController(); track(t, () => controller.abort());
  const origin = new URL(f.request.url).origin;
  const request = new Request(origin + '/api/generated-images/' + encodeURIComponent(row.output_id), {
    method: 'GET', headers: { origin, 'oai-authenticated-user-id': claimOwner,
      'oai-authenticated-user-email': claimOwner + '@example.invalid' }, signal: controller.signal,
  });
  assert.equal(request.signal.aborted, false); assert.equal(request.body, null); assert.equal(new URL(request.url).search, '');
  // Explicit local fixture preparation only: ensureSchema does not install
  // migration 0038, and current GET must never install it or activate an epoch.
  const migration = readFileSync(new URL('../drizzle/0038_scene_source_generations.sql', import.meta.url), 'utf8');
  for (const sql of migration.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) f.sqlite.exec(sql);
  const preparation = guardInventory(f, t, { database: false, snapshotDatabase: false }), beforeEpoch = snapshot(f);
  try {
    const auth = await principal.readExistingPrincipalRequest(request, f.env, 'creator', { account: 'principal' });
    assert.equal(Object.hasOwn(auth, 'kind'), false); assert.equal(Boolean(auth.response), false); assert.ok(auth.user);
    assert.equal(principal.requireConsent(auth.user), null); assert.equal(auth.user.userId, claimOwner);
    const authority = intakeAuthority.projectIntakeAuthority(f.env, { user: auth.user, principal: auth.user, impersonation: null },
      { projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId });
    const version = await sceneVersion.captureSceneSourceVersion(f.env, { streamId: auth.user.streamId }, [authority]);
    assert.equal(version.streamId, 'creative:' + claimOwner); assert.equal(version.epoch, 1);
    const afterEpoch = snapshot(f); assert.deepEqual(afterEpoch.schema, beforeEpoch.schema);
    for (const [table, value] of Object.entries(beforeEpoch.contents))
      if (table !== 'scene_source_epoch') assert.deepEqual(afterEpoch.contents[table], value, table + ' preserved by explicit fixture preparation');
    assert.equal(afterEpoch.contents.scene_source_epoch.length, 1);
  } finally { preparation.close(); }
  return { f, objects: writer.state.objects, row, lineage, attempt, canonical, payload, plannerBody, claimed, request, controller };
}
const open = (t, value) => phaseGuard(t, value.f, value.objects);
const read = value => custody.readGuestImageResultCurrentSnapshot(value.request, value.f.env, { outputId: value.row.output_id });
function assertOriginal(value, snapshot) {
  assert.ok(snapshot); assert.equal(snapshot.status, 'current');
  assert.equal(snapshot.ownerId, claimOwner); assert.equal(snapshot.projectId, value.f.session.projectId);
  assert.equal(snapshot.documentId, value.f.session.documentId); assert.equal(snapshot.outputId, value.f.completed.body.object_id);
  assert.equal(snapshot.generationId, value.row.generation_id); assert.equal(snapshot.sourceEventId, value.row.claim_event_id);
  assert.equal(snapshot.contentRef, value.payload.output_ref); assert.equal(snapshot.rawJson, value.plannerBody);
  assert.equal(snapshot.contentSha256, hash(value.plannerBody)); assert.equal(snapshot.revision, 0); assert.equal(snapshot.editEventId, null);
  assert.deepEqual(snapshot.claim, value.claimed.completedReview);
  const png = knownPngOracle(value.f.mediaOracle.bytes);
  assert.deepEqual(snapshot.media, { url: value.payload.media_url, mediaType: 'image/png', sha256: png.sha256,
    width: png.width, height: png.height, byteLength: png.size });
  assert.deepEqual(snapshot.sources, []); assert.deepEqual(snapshot.sourceIds, [], 'reading never synthesizes an adopted reference');
  assert.equal(Object.hasOwn(snapshot, 'sessionToken'), false); assert.equal(Object.hasOwn(snapshot, 'claimToken'), false);
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.claim));
}

// These exercise the real fresh owner/current reader, not the already accepted
// 97 pure protocol cases. Revision > 0 acceptance awaits the actual edit writer;
// a hand-authored revision row cannot supply an authoritative positive here.
test('genuine claimed original current snapshot uses fresh personal authority and exact original IDs/hash without writes', async t => {
  const value = await publishedFixture(t), guard = open(t, value), before = snapshot(value.f);
  const result = await read(value); assertOriginal(value, result);
  assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 1); assert.ok(guard.state.streamReads > 0);
  assert.deepEqual(snapshot(value.f), before); guard.preserved();
  assert.equal(value.request.headers.has('cookie'), false); assert.equal(value.request.headers.has('authorization'), false);
});

test('current image needs only its retained planner while canonical prompt and stage bodies are unavailable', async t => {
  const value = await publishedFixture(t);
  const prompt = value.lineage.resultCopies.find(copy => copy.role === 'prompt'); assert.ok(prompt);
  const unavailable = [...new Set([prompt.content_id, ...value.lineage.stageCopies.map(copy => copy.content_id),
    ...value.lineage.resultCopies.map(copy => copy.original_content_id)])];
  assert.ok(unavailable.every(id => typeof id === 'string' && id.length > 0));
  assert.equal(unavailable.includes(value.payload.output_ref), false);
  for (const id of unavailable) assert.ok(rows(value.f, 'private_content').some(row => row.content_id === id));
  for (const id of unavailable) value.f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(), id);
  assert.ok(Date.parse(value.lineage.canonical.expiresAt) > Date.now());
  const guard = open(t, value), result = await read(value); assertOriginal(value, result);
  assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 1);
  assert.equal(rows(value.f, 'private_content').find(row => row.content_id === value.payload.output_ref).redacted_at, null);
});

for (const fault of ['claim ID', 'lineage digest', 'custody owner']) test('current reader refuses a changed retained ' + fault + ' observation', async t => {
  const value = await publishedFixture(t), guard = open(t, value); let reached = 0;
  guard.state.readTransform = row => {
    if (!row || row.custody_id !== value.row.custody_id || !Object.hasOwn(row, 'lineage_json')) return row;
    reached++; return { ...row, ...(fault === 'claim ID' ? { claim_event_id: '00000000-0000-4000-8000-000000000099' }
      : fault === 'lineage digest' ? { lineage_digest: 'sha256:' + '0'.repeat(64) } : { destination_user_id: 'foreign-personal-owner' }) };
  };
  assert.equal(await read(value), null); assert.ok(reached > 0); assert.equal(guard.count('get'), 0);
});

// Both observations remain valid canonical event values and are joined to their
// own observed private row. Only the native witness page is perturbed; the real
// published graph, exact envelope digest, source counter and stored rows remain
// unchanged. This exercises the separate observed-event versus proved-graph join.
for (const fault of ['canonical timestamp', 'retained title']) test('current reader rejects a valid observed ' + fault + ' that differs from the proved claim before PNG GET', async t => {
  const value = await publishedFixture(t), guard = open(t, value); let reached = 0;
  guard.state.batchTransform = (result, items) => result.map((ack, index) => {
    if (!/SELECT sequence,witness FROM budgeted/u.test(items[index].sql)) return ack;
    assert.equal(ack.success, true); assert.ok(Array.isArray(ack.results));
    return { ...ack, results: ack.results.map(cell => {
      assert.equal(typeof cell.witness, 'string'); const observed = JSON.parse(cell.witness);
      if (observed.event_id !== value.row.claim_event_id) return cell;
      reached++; const before = structuredClone(observed), payload = JSON.parse(observed.private_json);
      if (fault === 'canonical timestamp') {
        // The earlier genuine completion time is a valid alternate canonical
        // timestamp, but it is not the actual publication timestamp in lineage.
        assert.ok(payload.original_created_at < observed.recorded_at);
        observed.occurred_at = payload.original_created_at; observed.recorded_at = payload.original_created_at;
        const restored = { ...observed, occurred_at: before.occurred_at, recorded_at: before.recorded_at };
        assert.deepEqual(restored, before, 'only the two equal canonical header times differ');
      } else {
        const title = payload.title === 'Different observed title' ? 'Another observed title' : 'Different observed title';
        const changed = { ...payload, title }; observed.private_json = JSON.stringify(changed);
        assert.deepEqual({ ...changed, title: payload.title }, payload, 'every other private payload field remains exact');
        assert.deepEqual({ ...observed, private_json: before.private_json }, before, 'every other native witness field remains exact');
      }
      const decoded = eventRead.serializeEvent(observed);
      assert.ok(presentation.parseGuestImageResultClaimEvent(decoded), 'the differing observation is structurally valid canonical data');
      assert.notDeepEqual(decoded, eventRead.serializeEvent({ ...value.canonical, private_json: JSON.stringify(value.payload) }));
      return { ...cell, witness: JSON.stringify(observed) };
    }) };
  });
  assert.equal(await read(value), null); assert.equal(reached, 1, 'the actual canonical native witness cell was altered');
  assert.equal(guard.statements.filter(item => item.method === 'batch' && /^\s*SELECT 1 AS current WHERE /u.test(item.sql)).length, 0,
    'the observed/proved canonical join refuses before any before-GET whole-graph proof statement is dispatched');
  assert.equal(guard.count('get'), 0); assert.equal(guard.count('head'), 0); guard.preserved();
});

// Add one real ancillary PNG chunk before IEND inside the synthetic provider
// response seam, before native Run/copy/claim persists any bytes or receipts.
// It preserves the genuine 1024x1024 fixture pixels while admitting >=65,537
// one-byte chunks. No claimed body, authority or storage receipt is fabricated.
function streamBoundaryImage(original) {
  knownPngOracle(original);
  const targetBytes = 131072, tail = original.slice(-12);
  assert.deepEqual([...tail], [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
  const padding = new Uint8Array(targetBytes - original.length - 12).fill(120);
  assert.ok(padding.length > 9); padding.set(new TextEncoder().encode('Boundary\0'));
  const transformed = joinPngBytes(original.slice(0, -12), pngChunk('tEXt', padding), tail);
  assert.equal(transformed.length, targetBytes); knownPngOracle(transformed); return transformed;
}

test('genuine current PNG accepts exactly 65,536 nonempty transport chunks followed by EOF', async t => {
  const value = await publishedFixture(t, { imageTransform: streamBoundaryImage }), guard = open(t, value);
  assert.equal(value.f.mediaOracle.bytes.length, 131072); guard.state.streamChunkCount = 65536;
  const result = await read(value); assertOriginal(value, result);
  assert.equal(guard.state.chunks.length, 65536); assert.ok(guard.state.chunks.every(chunk => chunk.length > 0));
  assert.equal(guard.state.chunks.reduce((sum, chunk) => sum + chunk.length, 0), value.f.mediaOracle.bytes.length);
  assert.equal(hash(Buffer.concat(guard.state.chunks)), value.f.mediaOracle.sha256);
  assert.equal(guard.state.streamReads, 65537); assert.equal(guard.state.streamEofs, 1); assert.equal(guard.state.streamCancels, 0);
  assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 1); guard.preserved();
});

test('genuine current PNG refuses 65,537 nonempty transport chunks when EOF would exceed its fixed read limit', async t => {
  const value = await publishedFixture(t, { imageTransform: streamBoundaryImage }), guard = open(t, value);
  assert.equal(value.f.mediaOracle.bytes.length, 131072); guard.state.streamChunkCount = 65537;
  assert.equal(await read(value), null);
  assert.equal(guard.state.chunks.length, 65537); assert.ok(guard.state.chunks.every(chunk => chunk.length > 0));
  assert.equal(guard.state.chunks.reduce((sum, chunk) => sum + chunk.length, 0), value.f.mediaOracle.bytes.length);
  assert.equal(hash(Buffer.concat(guard.state.chunks)), value.f.mediaOracle.sha256, 'refusal is segmentation capacity, not corrupt or truncated bytes');
  assert.equal(guard.state.streamReads, 65537); assert.equal(guard.state.streamEofs, 0);
  assert.equal(guard.state.streamCancels, 1); assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 0); guard.preserved();
});

for (const fault of ['ownerId', 'custodyId', 'sha256', 'extra']) test('current original PNG refuses wrong exact metadata: ' + fault, async t => {
  const value = await publishedFixture(t), guard = open(t, value); let reached = 0;
  guard.state.getTransform = raw => { reached++; raw.metadata = { ...raw.metadata,
    [fault]: fault === 'sha256' ? '0'.repeat(64) : 'foreign-metadata-value' }; return raw; };
  assert.equal(await read(value), null); assert.equal(reached, 1); assert.equal(guard.count('get'), 1);
});

test('current reader refuses native schema drift without installing or repairing tables', async t => {
  const value = await publishedFixture(t);
  value.f.sqlite.exec('ALTER TABLE artifact_revisions ADD COLUMN unexpected_claimed_column TEXT');
  const guard = open(t, value); assert.equal(await read(value), null); assert.equal(guard.count('get'), 0);
});

test('current reader refuses a redacted retained planner without generic or guest fallback', async t => {
  const value = await publishedFixture(t);
  value.f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(), value.payload.output_ref);
  const guard = open(t, value); assert.equal(await read(value), null); assert.equal(guard.count('get'), 0);
});

test('current reader refuses revoked personal consent', async t => {
  const value = await publishedFixture(t);
  value.f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run('revoked-consent', claimOwner);
  const guard = open(t, value); assert.equal(await read(value), null); assert.equal(guard.count('get'), 0);
});

test('a valid consented foreign personal principal reaches the owner/output lookup and cannot read the claim', async t => {
  const value = await publishedFixture(t), guard = open(t, value);
  assert.notEqual(payer, claimOwner); assert.ok(rows(value.f, 'users').some(row => row.user_id === payer));
  const headers = new Headers(value.request.headers); headers.set('oai-authenticated-user-id', payer);
  headers.set('oai-authenticated-user-email', payer + '@example.invalid');
  const request = new Request(value.request.url, { headers });
  const auth = await principal.readExistingPrincipalRequest(request, value.f.env, 'creator', { account: 'principal' });
  assert.equal(Object.hasOwn(auth, 'kind'), false); assert.equal(Boolean(auth.response), false); assert.ok(auth.user);
  assert.equal(auth.user.userId, payer); assert.equal(principal.requireConsent(auth.user), null);
  const start = guard.statements.length;
  assert.equal(await custody.readGuestImageResultCurrentSnapshot(request, value.f.env, { outputId: value.row.output_id }), null);
  assert.ok(guard.statements.slice(start).some(item => /\bFROM experience_guest_image_result_custodies\b/u.test(item.sql)
    && item.bindings.includes(payer) && item.bindings.includes(value.row.output_id)), 'valid foreign principal reached exact output/owner lookup');
  assert.equal(guard.count('get'), 0);
});

for (const at of ['GET', 'HEAD']) test('revocation during the current PNG ' + at + ' cannot disclose a previously qualified snapshot', async t => {
  const value = await publishedFixture(t), guard = open(t, value); let reached = 0;
  guard.state[at === 'GET' ? 'beforeGet' : 'beforeHead'] = () => {
    reached++; guard.fixtureMutation('personal consent revoked during ' + at, () => {
      value.f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run('revoked-during-read', claimOwner);
    });
  };
  assert.equal(await read(value), null); assert.equal(reached, 1); assert.equal(guard.count('get'), 1);
  if (at === 'HEAD') assert.equal(guard.count('head'), 1);
  assert.deepEqual(guard.state.fixtureMutations, ['personal consent revoked during ' + at]);
});

test('final current HEAD identity mismatch refuses the already inspected PNG', async t => {
  const value = await publishedFixture(t), guard = open(t, value); let reached = 0;
  guard.state.headTransform = raw => { reached++; return { ...raw, version: raw.version + '-replaced' }; };
  assert.equal(await read(value), null); assert.equal(reached, 1); assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 1);
  assert.ok(guard.state.streamReads > 0);
});

test('aborted current request settles before a late R2 GET and retires its late body', async t => {
  const value = await publishedFixture(t), guard = open(t, value), entered = deferred(), release = deferred();
  guard.state.beforeGet = async () => { entered.resolve(); await release.promise; };
  const pending = read(value);
  try {
    await Promise.race([entered.promise, delay(5000).then(() => { throw Error('current reader never reached its real destination GET'); })]);
    value.controller.abort();
    const result = await Promise.race([pending, delay(1000).then(() => { throw Error('foreground waited for late native R2 settlement'); })]);
    assert.equal(result, null); assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 0);
  } finally {
    release.resolve(); await guard.settle(); await pending;
    // Allow the actual late-result disposer to finish, with a finite bound.
    for (let count = 0; count < 100 && guard.state.streamCancels === 0; count++) await turn();
  }
  assert.equal(guard.state.streamReads, 0); assert.equal(guard.state.streamCancels, 1);
});

for (const fault of ['query', 'POST body', 'different output', 'selector extra']) test('current snapshot requires its exact GET route and closed selector: ' + fault, async t => {
  const value = await publishedFixture(t), guard = open(t, value);
  let request = value.request, input = { outputId: value.row.output_id };
  if (fault === 'query') request = new Request(value.request.url + '?custody=untrusted', { headers: value.request.headers });
  if (fault === 'POST body') request = new Request(value.request.url, { method: 'POST', headers: value.request.headers, body: '{}' });
  if (fault === 'different output') input.outputId = 'object-ffffffff';
  if (fault === 'selector extra') input.claim = value.claimed.completedReview;
  assert.equal(await custody.readGuestImageResultCurrentSnapshot(request, value.f.env, input), null); assert.equal(guard.count('get'), 0);
});


for (const phase of ['before PNG', 'after PNG']) test('current reader rejects a truncated whole-graph proof ACK ' + phase, async t => {
  const value = await publishedFixture(t), guard = open(t, value); let reached = 0;
  guard.state.batchTransform = (result, items) => {
    const proof = items.length > 3 && items.every(item => /^\s*SELECT 1 AS current WHERE /u.test(item.sql));
    if (!proof || (phase === 'before PNG' ? guard.count('get') !== 0 : guard.count('head') !== 1)) return result;
    reached++; assert.ok(Array.isArray(result) && result.length > 3); return result.slice(1);
  };
  assert.equal(await read(value), null); assert.equal(reached, 1, 'actual whole-graph proof boundary reached');
  assert.equal(guard.count('get'), phase === 'before PNG' ? 0 : 1);
  if (phase === 'after PNG') assert.equal(guard.count('head'), 1);
});


// Native current successor. Source-authoring is not a passing qualification.
// The accepted c55691e7 claim fixture is copied into this private lexical block;
// its original host guard/runtime and genuine positive producer flow remain
// intact. No supplier test module is imported and no sibling checkout is used.
// Select one new native case at a time after coherent source/closure review.
{
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const phase = (name, detail = {}) => process.stderr.write(`[guest-result-current-d1] ${JSON.stringify({
  phase: name, pid: process.pid, ppid: process.ppid, runnerPgid: process.env.FORMA_TEST_PGID ?? null, ...detail })}\n`);
async function finite(pending, milliseconds, label) {
  let timer;
  try { return await Promise.race([pending, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('copy_fixture_timeout:' + label)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

// Reversible guard derived from the accepted byte-reader D1 fixture. The host
// transport checks and borrowed-dispatcher ownership are unchanged. This direct
// Worker adaptation removes the synchronous proxy transform and refuses every
// Node Worker construction. It does not claim arbitrary child-process/OS isolation.
let activeHostGuard = false;
function installHostNetworkGuard(miniflareEntry) {
  assert.equal(activeHostGuard, false, 'a previous owned runtime must finish cleanup before another starts');
  activeHostGuard = true;
  const require = createRequire(import.meta.url), mfRequire = createRequire(miniflareEntry);
  const net = require('node:net'), tls = require('node:tls'), http = require('node:http'), https = require('node:https');
  const dns = require('node:dns'), dgram = require('node:dgram'), workerThreads = require('node:worker_threads');
  const patches = [], events = [], allowed = {}, state = { phase: 'setup', restored: false };
  const hadCfFlag = Object.hasOwn(process.env, 'CLOUDFLARE_CF_FETCH_ENABLED'), previousCfFlag = process.env.CLOUDFLARE_CF_FETCH_ENABLED;
  let undici, previousDispatcher, installedDispatcher, identity, controls;
  function patch(object, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    assert.ok(!descriptor || Object.hasOwn(descriptor, 'value'), `guard replacement requires a data property: ${name}`);
    Object.defineProperty(object, name, descriptor ? { ...descriptor, value } : { value, writable: true, configurable: true });
    patches.push(() => { if (descriptor) Object.defineProperty(object, name, descriptor); else delete object[name]; });
  }
  function restore() {
    if (state.restored) return;
    const failures = [];
    if (undici && previousDispatcher) {
      try { undici.setGlobalDispatcher(previousDispatcher); } catch (error) { failures.push(error); }
    }
    // Restore the borrowed dispatcher by identity; never close or destroy it.
    for (const undo of [...patches].reverse()) { try { undo(); } catch (error) { failures.push(error); } }
    try { syncBuiltinESMExports(); } catch (error) { failures.push(error); }
    try { if (hadCfFlag) process.env.CLOUDFLARE_CF_FETCH_ENABLED = previousCfFlag; else delete process.env.CLOUDFLARE_CF_FETCH_ENABLED; }
    catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'host guard restoration failed');
    state.restored = true; activeHostGuard = false;
  }
  function deny(transport, target) {
    const error = new Error(`FORMA_HOST_EGRESS_DENIED ${transport} ${String(target)}`); error.code = 'FORMA_HOST_EGRESS_DENIED';
    events.push({ phase: state.phase, transport, target: String(target) }); throw error;
  }
  function host(transport, value) {
    const hostname = String(value ?? 'localhost').toLowerCase();
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) deny(transport, hostname);
    allowed[transport] = (allowed[transport] ?? 0) + 1; return hostname;
  }
  function origin(transport, value) {
    let url; try { url = new URL(String(value)); } catch { deny(transport, 'invalid origin'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) deny(transport, 'invalid origin');
    host(transport, url.hostname);
  }
  function socket(transport, args) {
    let values = args; if (Array.isArray(values[0])) values = values[0]; const first = values[0]; let options;
    if (first && typeof first === 'object') options = first;
    else if (typeof first === 'number' || typeof first === 'string' && /^\d+$/u.test(first)) {
      options = { port: first, host: typeof values[1] === 'string' ? values[1] : 'localhost' };
    } else deny(transport, 'unsupported socket arguments');
    if (options.path !== undefined || options.socketPath !== undefined || options.fd !== undefined
      || options.lookup !== undefined || options.socket !== undefined) deny(transport, 'unreviewed socket path/fd/lookup/socket');
    if (!Number.isInteger(Number(options.port)) || Number(options.port) < 1 || Number(options.port) > 65535) deny(transport, 'invalid port');
    host(transport, options.host ?? options.hostname ?? 'localhost');
  }
  function request(transport, args) {
    const first = args[0]; let options = {};
    if (typeof first === 'string' || first instanceof URL) { origin(transport, first); if (args[1] && typeof args[1] === 'object') options = args[1]; }
    else if (first && typeof first === 'object') options = first;
    else deny(transport, 'invalid request arguments');
    if (options.socketPath !== undefined) deny(transport, 'unreviewed socket path');
    if (options.hostname !== undefined) host(transport, options.hostname);
    else if (options.host !== undefined) {
      let url; try { url = new URL('http://' + options.host); } catch { deny(transport, 'invalid host'); } host(transport, url.hostname);
    } else if (typeof first !== 'string' && !(first instanceof URL)) host(transport, 'localhost');
  }
  function lookupValue(name, options) {
    const hostname = host('dns.lookup', name), family = typeof options === 'number' ? options : options?.family;
    const ipv6 = hostname === '::1' || hostname === '[::1]' || hostname === 'localhost' && family === 6;
    const value = { address: ipv6 ? '::1' : '127.0.0.1', family: ipv6 ? 6 : 4 }; return options?.all ? [value] : value;
  }
  try {
    process.env.CLOUDFLARE_CF_FETCH_ENABLED = 'false';
    for (const name of ['connect', 'createConnection']) {
      const original = net[name]; patch(net, name, function (...args) { socket('net.' + name, args); return original.apply(this, args); });
    }
    const socketConnect = net.Socket.prototype.connect;
    patch(net.Socket.prototype, 'connect', function (...args) { socket('net.Socket.connect', args); return socketConnect.apply(this, args); });
    const tlsConnect = tls.connect; patch(tls, 'connect', function (...args) { socket('tls.connect', args); return tlsConnect.apply(this, args); });
    for (const [label, module] of [['http', http], ['https', https]]) for (const name of ['request', 'get']) {
      const original = module[name]; patch(module, name, function (...args) { request(label + '.' + name, args); return original.apply(this, args); });
    }
    patch(dns, 'lookup', function (name, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      if (typeof callback !== 'function') throw new TypeError('lookup callback required');
      let value; try { value = lookupValue(name, options); } catch (error) { queueMicrotask(() => callback(error)); return; }
      queueMicrotask(() => Array.isArray(value) ? callback(null, value) : callback(null, value.address, value.family));
    });
    patch(dns.promises, 'lookup', async (name, options) => lookupValue(name, options));
    // Native getnameinfo bypasses socket guards; neither form is needed here.
    patch(dns, 'lookupService', (...args) => deny('dns.lookupService', args[0] ?? ''));
    patch(dns.promises, 'lookupService', async (...args) => deny('dns.promises.lookupService', args[0] ?? ''));
    for (const object of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
      for (const name of Object.getOwnPropertyNames(object)) if ((name === 'reverse' || name.startsWith('resolve')) && typeof object[name] === 'function') {
        patch(object, name, (...args) => deny('dns.' + name, args[0] ?? ''));
      }
    }
    for (const name of ['send', 'connect']) patch(dgram.Socket.prototype, name, () => deny('dgram.' + name, 'UDP is unnecessary for this fixture'));
    const nativeFetch = globalThis.fetch;
    patch(globalThis, 'fetch', function (input, ...args) {
      origin('global.fetch', typeof input === 'string' || input instanceof URL ? input : input.url); return nativeFetch.call(this, input, ...args);
    });
    syncBuiltinESMExports();
    const undiciEntry = mfRequire.resolve('undici'); undici = mfRequire('undici'); previousDispatcher = undici.getGlobalDispatcher();
    class LoopbackDispatcher extends undici.Dispatcher {
      dispatch(options, handler) { origin('miniflare.undici.dispatch', options.origin); return previousDispatcher.dispatch(options, handler); }
      close() { return deny('miniflare.undici.close', 'borrowed dispatcher cannot be closed by fixture'); }
      destroy() { return deny('miniflare.undici.destroy', 'borrowed dispatcher cannot be destroyed by fixture'); }
    }
    installedDispatcher = new LoopbackDispatcher(); undici.setGlobalDispatcher(installedDispatcher);

    // This fixture never requests a lazy binding proxy. Any new Node realm is
    // refused rather than running an unguarded worker or rewriting vendor code.
    patch(workerThreads, 'Worker', class RefusedFixtureWorker {
      constructor() { deny('worker_threads.Worker', 'direct dispatch fixture must not create a Node Worker'); }
    });
    syncBuiltinESMExports();
    identity = { miniflareEntry, miniflareEntrySha256: sha(readFileSync(miniflareEntry)),
      undiciEntry, undiciEntrySha256: sha(readFileSync(undiciEntry)),
      undiciVersion: mfRequire('undici/package.json').version, bindingAccess: 'direct-dispatch-only' };

  } catch (error) {
    try { restore(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'partial host guard install failed'); }
    throw error;
  }
  return {
    identity, restore, setPhase(value) { state.phase = value; },
    snapshot() { return { identity, phase: state.phase, restored: state.restored, denials: structuredClone(events), allowed: structuredClone(allowed),
      bindingAccess: 'direct-dispatch-only' }; },
    async verifyGuards() {
      state.phase = 'guard-selfcheck'; const expected = [];
      async function rejected(name, action) {
        const before = events.length; let refused = false;
        try { await action(); } catch { refused = true; }
        assert.ok(refused && events.length === before + 1, `host guard selfcheck: ${name}`); expected.push(name);
      }
      await rejected('actual Miniflare undici global dispatcher', () => undici.fetch('https://forbidden.invalid/guard'));
      await rejected('Node global fetch', () => globalThis.fetch('https://forbidden.invalid/guard'));
      await rejected('Node http request', () => http.request('http://forbidden.invalid/guard'));
      await rejected('Node https request', () => https.request('https://forbidden.invalid/guard'));
      await rejected('Node net connector', () => net.connect({ host: 'forbidden.invalid', port: 443 }));
      await rejected('Node TLS connector', () => tls.connect({ host: 'forbidden.invalid', port: 443 }));
      await rejected('Node DNS lookup', () => dns.promises.lookup('forbidden.invalid'));
      await rejected('Node DNS callback lookupService', () => dns.lookupService('192.0.2.1', 443, () => assert.fail('Denied lookupService callback must not run')));
      await rejected('Node DNS promise lookupService', () => dns.promises.lookupService('192.0.2.1', 443));
      await rejected('Node Worker construction', () => new workerThreads.Worker('unused', { eval: true }));
      controls = expected; state.phase = 'runtime'; return { expectedBlockedControls: [...expected], denials: structuredClone(events) };
    },
    assertContained() {
      assert.equal(controls?.length, 10); assert.equal(events.length, 10);
      assert.ok(events.every(row => row.phase === 'guard-selfcheck'), 'no unexpected setup, runtime or disposal host denial');
    },
  };
}


// This function is serialized as fixture source and bundled with the selected
// production exports. Its body runs only inside workerd. The JSON boundary holds
// synthetic rows, proof strings and PNG bytes, never an opaque authority token.
function fixtureWorker({ inventory, core, media, custody, principal, intakeAuthority, sceneVersion, sceneEpochActivateSql, sceneMigration }) {
  const requireFact = (value, message) => { if (!value) throw Error('copy_fixture:' + message); };
  const encoder = new TextEncoder();
  const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const same = (actual, expected, label) => requireFact(stable(actual) === stable(expected), label);
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const quote = name => '"' + name.replaceAll('"', '""') + '"';
  const attemptTable = 'experience_guest_image_result_copy_attempts', leaseTable = 'experience_guest_claim_leases';
  async function snapshot(db, tables) {
    const output = {};
    for (const name of tables) {
      const columns = (await db.prepare(`PRAGMA table_info(${quote(name)})`).all()).results.map(row => row.name);
      const expressions = ['CAST(rowid AS TEXT) AS original_rowid', ...columns.map((column, i) => `quote(${quote(column)}) AS c${i}`)];
      output[name] = (await db.prepare(`SELECT ${expressions.join(',')} FROM ${quote(name)} ORDER BY rowid`).all()).results;
    }
    return output;
  }
  async function install(db, exported) {
    requireFact(exported.schema.length <= 512 && exported.inserts.length <= 2048, 'snapshot bounds');
    await db.batch(exported.schema.filter(row => row.type === 'table').map(row => db.prepare(row.sql)));
    await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'), ...exported.inserts.map(sql => db.prepare(sql))]);
    const secondary = exported.schema.filter(row => row.sql && row.type !== 'table');
    if (secondary.length) await db.batch(secondary.map(row => db.prepare(row.sql)));
    same((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'fixture foreign keys');
    same(await snapshot(db, exported.tables), exported.rows, 'native rowids/scalars exactly installed');
    const names = new Set(exported.schema.map(row => row.name));
    const schema = (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
    same(schema.filter(row => names.has(row.name)), exported.schema, 'native schema exactly installed');
  }
  let used = false;
  return { async fetch(incoming, bindings) {
    requireFact(!used && incoming.method === 'POST' && new URL(incoming.url).pathname === '/qualify', 'single fixture request');
    used = true;
    const raw = await incoming.text(); requireFact(encoder.encode(raw).length <= 16 * 1024 * 1024, 'fixture input bound');
    const input = JSON.parse(raw), db = bindings.DB, bucket = bindings.MEDIA;
    requireFact(input.mode === 'positive' && ['original-positive', 'metadata-owner-refusal'].includes(input.currentCase), 'fixed native current case');
    const retained = input.mode.startsWith('retained-');
    const bytes = Uint8Array.from(atob(input.source.base64), char => char.charCodeAt(0));
    requireFact(bytes.length <= 20 * 1024 * 1024 && await hash(bytes) === input.source.sha256, 'synthetic source byte hash');
    await install(db, input.snapshot);
    const sourceSetup = await bucket.put(input.source.key, bytes, {
      customMetadata: input.source.metadata, httpMetadata: input.source.httpMetadata, onlyIf: { etagDoesNotMatch: '*' },
    });
    requireFact(sourceSetup !== null, 'fixture source setup has a native ACK');
    const sourceVersion = sourceSetup.version;
    const calls = [], violations = [], trace = [], sqlForms = new Map(), handles = new WeakMap();
    let traceBytes = 0, sqlBytes = 0, step = 'inventory', injected = 0, rollbackSnapshot = null, finalBatchSize = null, injectionError = null;
    const count = kind => calls.filter(row => row.kind === kind).length;
    const reject = message => { violations.push(message); throw Error('copy_fixture_guard:' + message); };
    const currentRow = () => db.prepare(`SELECT * FROM ${attemptTable}`).first();
    const record = (sql, values, method) => {
      const inserted = /^\s*INSERT INTO (experience_guest_claim_leases|experience_guest_image_result_copy_attempts|event_write_stage|event_client_receipts|output_commands|private_content|experience_guest_context_adoptions|experience_guest_image_claims|experience_guest_image_stage_custodies|experience_guest_image_stage_copies|experience_guest_image_result_custodies|experience_guest_image_result_copies)\s*\(/u.exec(sql)?.[1];
      const updated = /^\s*UPDATE (experience_guest_image_result_copy_attempts|experience_guest_sessions)\s+SET\b/u.exec(sql)?.[1] ?? null;
      const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/giu;
      if (encoder.encode(sql).length > 100000 || values.length > 100) reject('native SQL bounds');
      if (inserted || updated) {
        if (method !== 'batch' || /;|--|\/\*/u.test(sql) || [...sql.matchAll(mutation)].length !== 1) reject('mutation outside exact transactional table allocation');
        if (inserted && ![attemptTable, leaseTable].includes(inserted) && !['claim', 'retained-claim'].includes(step)
          || updated === 'experience_guest_sessions' && !['claim', 'retained-claim'].includes(step)) reject('claim mutation outside final claim');
      } else if (!/^\s*(?:SELECT|WITH)\b/iu.test(sql) || mutation.test(sql)) reject('unallocated SQL');
      const key = JSON.stringify([sql, values]);
      if (!sqlForms.has(key)) {
        sqlBytes += encoder.encode(key).length;
        if (sqlForms.size >= 4096 || sqlBytes > 32 * 1024 * 1024) reject('SQL evidence bound');
        sqlForms.set(key, { sql, bindings: [...values] });
      }
      const item = { step, method, inserted: inserted ?? null, updated, form: [...sqlForms.keys()].indexOf(key), parameters: values.length };
      traceBytes += encoder.encode(JSON.stringify(item)).length;
      if (trace.length >= 16384 || traceBytes > 2 * 1024 * 1024) reject('SQL trace bound');
      trace.push(item);
    };
    function statement(sql, values = []) {
      const native = values.length ? db.prepare(sql).bind(...values) : db.prepare(sql);
      const wrapped = {
        bind(...next) { return statement(sql, next); },
        async first(...args) { record(sql, values, 'first'); return native.first(...args); },
        async all(...args) { record(sql, values, 'all'); return native.all(...args); },
        async run(...args) { record(sql, values, 'run'); return native.run(...args); },
        raw() { return reject('DB.raw'); },
      };
      handles.set(wrapped, { native, sql, values }); return wrapped;
    }
    const observedDB = {
      prepare: sql => statement(sql),
      async batch(statements) {
        requireFact(Array.isArray(statements) && statements.length > 0 && statements.length <= 511, 'native batch bound');
        const items = statements.map(value => handles.get(value));
        if (items.some(value => !value)) return reject('foreign native statement');
        for (const item of items) record(item.sql, item.values, 'batch');
        const publication = ['claim', 'retained-claim'].includes(step) && items.some(item => /^\s*INSERT INTO experience_guest_image_result_custodies\s*\(/u.test(item.sql));
        if (publication) {
          requireFact(finalBatchSize === null, 'one physical final publication batch'); finalBatchSize = items.length;
          const row = await currentRow(); requireFact(row.state === 'ready', 'genuine persisted ready row precedes publication');
          if (['claim-rollback', 'foreign-null-envelope', 'foreign-lineage-alias'].includes(input.mode)) {
            const before = await snapshot(db, input.snapshot.tables), extra = [];
            const descriptor = JSON.parse(row.descriptor_json), m = descriptor.manifest;
            if (input.mode === 'claim-rollback') extra.push(db.prepare("SELECT json_extract('not-json','$')"));
            if (input.mode === 'foreign-null-envelope') extra.push(db.prepare(`INSERT INTO event_private_payloads
              (private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at) VALUES(?,?,NULL,?,?,?,NULL)`)
              .bind(crypto.randomUUID(), 'synthetic-foreign-owner', m.documentId, '{}', new Date().toISOString()));
            if (input.mode === 'foreign-lineage-alias') {
              const session = await db.prepare('SELECT * FROM experience_guest_sessions WHERE session_id=?').bind(row.session_id).first();
              const foreign = { ...session, session_id: crypto.randomUUID(), guest_subject: 'guest:' + crypto.randomUUID(),
                project_id: crypto.randomUUID(), document_id: crypto.randomUUID(), session_hash: 'sha256:' + '1'.repeat(64),
                claim_hash: 'sha256:' + '2'.repeat(64) };
              const keys = Object.keys(foreign);
              extra.push(db.prepare(`INSERT INTO experience_guest_sessions(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).bind(...keys.map(key => foreign[key])));
              // All four typed identities are valid text. The cross-session
              // original session reference is a real alias, not copied prose.
              const lineage = JSON.stringify({ sessionId: m.sessionId, guestSubject: foreign.guest_subject,
                projectId: foreign.project_id, documentId: foreign.document_id });
              extra.push(db.prepare(`INSERT INTO experience_guest_context_adoptions
                (session_id,destination_user_id,lease_id,request_id,manifest_digest,lineage_json,lineage_digest,created_at_ms)
                VALUES(?,?,?,?,?,?,?,?)`).bind(foreign.session_id, 'synthetic-foreign-owner', crypto.randomUUID(), crypto.randomUUID(),
                row.manifest_digest, lineage, 'sha256:' + '3'.repeat(64), Date.now()));
            }
            requireFact(items.length + extra.length <= 511, 'fixture fault injection also respects native batch bound');
            let lastMutation = -1;
            for (const [index, item] of items.entries()) if (/^\s*(?:INSERT|UPDATE)\b/u.test(item.sql)) lastMutation = index;
            requireFact(lastMutation >= 0 && lastMutation < items.length - 1, 'whole graph after assertions follow last write');
            // Fixture-owned rows are inserted after all canonical writes and
            // before the unmodified production after proofs. They confer no
            // capability and must roll back with the entire candidate graph.
            const native = items.map(item => item.native);
            native.splice(input.mode === 'claim-rollback' ? native.length : lastMutation + 1, 0, ...extra);
            injected++;
            try { await db.batch(native); }
            catch (error) {
              injectionError = String(error);
              requireFact(/malformed JSON/iu.test(injectionError), 'rollback reached a throwing proof rather than failing fixture DDL/constraints');
              rollbackSnapshot = await snapshot(db, input.snapshot.tables);
              same(rollbackSnapshot, before, 'native final batch rolled back every table, rowid and scalar'); throw error;
            }
            return reject('fixture final rollback or foreign graph unexpectedly passed');
          }
        }
        let result;
        try { result = await db.batch(items.map(item => item.native)); }
        catch (error) {
          if (['claim', 'retained-claim'].includes(step)) reportNativeFailure(error, 'native-batch');
          throw error;
        }
        if (publication && input.mode === 'claim-ack-lost') {
          requireFact((await currentRow())?.state === 'published', 'whole graph persisted before injected ACK loss');
          injected++; return null;
        }
        return result;
      },
      exec() { return reject('DB.exec'); }, dump() { return reject('DB.dump'); },
    };
    async function checkKey(key, kind) {
      if (key === input.source.key) {
        if (!['get', 'head'].includes(kind)) return reject('source mutation');
        return 'source';
      }
      const row = await currentRow();
      if (!row || key !== row.destination_key || !['copy', 'claim', 'retained-claim'].includes(step)) return reject('unallocated storage key');
      if (step === 'retained-claim' && !['get', 'head'].includes(kind)) return reject('retained retry is strictly read only before the claim');
      if (step === 'claim' && kind !== 'head') return reject('final claim may only inspect the already verified destination HEAD');
      return 'destination';
    }
    const observedBucket = {
      async get(key, ...args) {
        const target = await checkKey(key, 'get'); calls.push({ kind: target + '-get', key });
        // Preserve native object/body/accessor/method identity and receivers. No
        // plain-object spread, proxy hydration or synthesized stream is used.
        const value = await Reflect.apply(bucket.get, bucket, [key, ...args]);
        if (step === 'retained-claim' && input.mode === 'retained-cleanup-race' && target === 'destination') {
          requireFact(injected === 0, 'one exact fixture-owned cleanup race');
          const prior = await currentRow(); requireFact(prior.state === 'ready', 'genuine ready precedes race');
          await db.prepare(`UPDATE ${attemptTable} SET state='cleanup_pending',row_version=row_version+1,updated_at_ms=? WHERE attempt_id=? AND state='ready'`)
            .bind(Date.now(), prior.attempt_id).run();
          requireFact((await currentRow()).state === 'cleanup_pending', 'fixture cleanup fence persisted'); injected++;
        }
        return value;
      },
      async head(key, ...args) {
        const target = await checkKey(key, 'head'); calls.push({ kind: target + '-head', key });
        return Reflect.apply(bucket.head, bucket, [key, ...args]);
      },
      async put(key, value, options) {
        if (await checkKey(key, 'put') !== 'destination' || count('destination-put')) return reject('more than one app PUT');
        const row = await currentRow();
        requireFact(row.state === 'writing' && row.put_outcome === 'pending', 'native writing row precedes app PUT');
        requireFact(value instanceof ArrayBuffer && value.byteLength === bytes.byteLength, 'actual admitted PUT backing buffer');
        same([...new Uint8Array(value)], [...bytes], 'exact original PUT bytes');
        same(options, { onlyIf: { etagDoesNotMatch: '*' }, customMetadata: JSON.parse(row.destination_metadata_json), httpMetadata: { contentType: 'image/png' } }, 'native conditional PUT options');
        calls.push({ kind: 'destination-put', key });
        const result = await Reflect.apply(bucket.put, bucket, [key, value, options]);
        return result;
      },
      async delete(key, ...args) {
        if (await checkKey(key, 'delete') !== 'destination') return reject('wrong DELETE key');
        const row = await currentRow();
        requireFact(row.state === 'cleanup_pending' && row.put_outcome === 'success', 'irreversible fence and known settlement precede DELETE');
        calls.push({ kind: 'destination-delete', key });
        return Reflect.apply(bucket.delete, bucket, [key, ...args]);
      },
      list() { return reject('MEDIA.list'); }, createMultipartUpload() { return reject('MEDIA.multipart'); },
    };
    const env = { DB: observedDB, MEDIA: observedBucket,
      OPENAI_API_KEY: 'no-network-fixture', OPENAI_MODEL: 'gpt-5.6-terra', OPENAI_IMAGE_MODEL: 'gpt-image-2',
      ASSETS: { fetch() { return reject('ASSETS.fetch'); } } };
    const controller = new AbortController();
    const request = new Request(input.request.url, { method: 'POST', headers: input.request.headers, signal: controller.signal });
    const inspected = await inventory.inspectGuestImageResultInventory(request, env, { proof: input.proof });
    step = 'lease';
    const leased = await core.acquireGuestImageResultClaimSource(request, env, { inventory: inspected, requestId: crypto.randomUUID() });
    step = 'source-media';
    const observed = await media.readLeasedGuestImageResultMedia(request, env, leased);
    step = 'reserve';
    const reserved = await media.reserveGuestImageResultMedia(request, env, observed);
    requireFact(reserved.status === 'reserved', 'genuine fixed reserve succeeded');
    const reservedRow = await currentRow(); requireFact(reservedRow?.state === 'reserved', 'native reserved row');
    const reservedLeaseRows = (await db.prepare(`SELECT * FROM ${leaseTable}`).all()).results;
    step = 'copy';
    const outcome = await media.copyGuestImageResultMedia(request, env, reserved.reservation);
    requireFact(outcome.status === 'ready', 'genuine source, lease, bytes, reservation and writer reach ready');
    const readyReview = core.guestImageResultReadyReview(request, env, outcome.ready), readyRow = await currentRow();
    requireFact(readyRow.state === 'ready' && readyRow.put_outcome === 'success', 'known ACK and separate native readback recorded');
    const readySnapshot = await snapshot(db, input.snapshot.tables);
    const readySession = await db.prepare('SELECT * FROM experience_guest_sessions WHERE session_id=?').bind(readyRow.session_id).first();
    step = retained ? 'retained-claim' : 'claim';
    const freshRequest = retained ? new Request(input.request.url, { method: 'POST', headers: input.request.headers }) : null;
    const retryInput = { proof: input.proof, selector: { version: 1, attemptId: readyRow.attempt_id, custodyId: readyRow.custody_id, manifestDigest: readyRow.manifest_digest } };
    if (retained) controller.abort();
    let claimed = null, claimError = null;
    const positiveMode = ['positive', 'claim-ack-lost', 'retained-positive'].includes(input.mode);
    // Keep the original captured error unchanged. Only known constant error
    // tokens cross the diagnostic boundary; native errors may embed row data.
    const diagnosticState = (originalText, rowState) => {
      const boundedText = originalText === null ? null : originalText.slice(0, 4096), lower = boundedText?.toLowerCase();
      const recognized = boundedText !== null
        && /^(?:Error: )?(?:guest_image_result_[a-z_]+|copy_fixture(?:_guard)?:[a-z_]+)$/u.test(boundedText);
      return {
        errorText: boundedText === null ? null : recognized ? boundedText : '[unrecognized error text redacted]',
        errorTextRedacted: boundedText !== null && (!recognized || boundedText.length !== originalText.length),
        claimedStatus: claimed === null ? null : claimed.status === 'claimed' ? 'claimed' : 'unexpected',
        nativeErrorTokens: ['D1_ERROR', 'SQLITE_ERROR', 'SQLITE_CONSTRAINT', 'SQLITE_TOOBIG', 'SQLITE_RANGE', 'SQLITE_BUSY', 'SQLITE_INTERRUPT']
          .filter(token => boundedText !== null && new RegExp('\\b' + token + '\\b', 'u').test(boundedText)),
        nativeFailureReasons: ['expression tree is too large', 'expression tree too large', 'too many sql variables', 'sql logic error',
          'too many terms in compound select', 'no such table', 'no such column', 'malformed json'].filter(reason => lower?.includes(reason)),
        rowState: ['reserved', 'writing', 'ready', 'cleanup_pending', 'deleted', 'published'].includes(rowState) ? rowState : null,
        lastConfirmedNativeTransition: 'ready', finalBatchSize, injected, attemptedSqlTraceCount: trace.length,
        lastAttemptedSqlStep: ['inventory', 'lease', 'source-media', 'reserve', 'copy', 'claim', 'retained-claim'].includes(trace.at(-1)?.step)
          ? trace.at(-1).step : null,
        lastAttemptedSqlForm: Number.isSafeInteger(trace.at(-1)?.form) ? trace.at(-1).form : null,
      };
    };
    function reportNativeFailure(error, boundary, capturedText) {
      if (!positiveMode) return;
      try {
        const ownErrorToken = name => {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(error, name);
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
            const value = descriptor.value;
            if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
            return typeof value === 'string' && /^(?:[A-Za-z]{1,64}Error|Error|[A-Z][A-Z_]{0,127}|guest_image_result_[a-z_]{1,128})$/u.test(value) ? value : null;
          } catch { return null; }
        };
        console.error('[guest-result-claim-d1-native-failure] ' + JSON.stringify({ boundary,
          ...diagnosticState(capturedText ?? String(error), null), errorName: ownErrorToken('name'), errorCode: ownErrorToken('code') }));
      } catch { /* Diagnostic failure must not replace the original native error. */ }
    }
    try { claimed = retained ? await core.retryGuestImageResultClaim(freshRequest, env, retryInput)
      : await core.claimGuestImageResult(request, env, outcome.ready); }
    catch (error) {
      claimError = String(error);
      reportNativeFailure(error, 'claim-catch', claimError);
    }
    const callsBeforeReplay = calls.length, traceBeforeReplay = trace.length;
    let replayRefused = false;
    try { if (retained) await core.retryGuestImageResultClaim(freshRequest, env, retryInput);
      else await core.claimGuestImageResult(request, env, outcome.ready); } catch { replayRefused = true; }
    requireFact(replayRefused && calls.length === callsBeforeReplay && trace.length === traceBeforeReplay,
      'spent ready cannot dispatch SQL, media or another claim');
    step = 'fixture-verification';
    const row = await currentRow();
    requireFact(row !== null, 'one persisted attempt remains');
    const attemptRows = (await db.prepare(`SELECT * FROM ${attemptTable}`).all()).results;
    const leaseRows = (await db.prepare(`SELECT * FROM ${leaseTable}`).all()).results;
    requireFact(attemptRows.length === 1 && leaseRows.length === 1, 'single native lease and attempt');
    same(leaseRows, reservedLeaseRows, 'complete native lease remains unchanged throughout copy and claim');
    const immutableColumns = ['attempt_id', 'custody_id', 'session_id', 'destination_user_id', 'lease_id', 'lease_acquisition',
      'request_id', 'manifest_digest', 'descriptor_json', 'descriptor_digest', 'lease_snapshot_json', 'source_expires_at_ms',
      'destination_key', 'writer_nonce', 'content_sha256', 'byte_length', 'mime_type', 'width', 'height', 'destination_metadata_json', 'created_at_ms'];
    requireFact(Object.keys(row).length === 30, 'complete accepted native attempt row');
    for (const name of immutableColumns) same(row[name], reservedRow[name], 'immutable native attempt value:' + name);
    const destination = await bucket.get(row.destination_key);
    const destinationReceipt = destination === null ? null : { version: destination.version, etag: destination.etag,
      size: destination.size, sha256: await hash(await destination.arrayBuffer()), metadata: destination.customMetadata };
    const original = await bucket.get(input.source.key);
    requireFact(original !== null && original.version === sourceVersion && await hash(await original.arrayBuffer()) === input.source.sha256, 'original native object preserved');
    same(original.customMetadata, input.source.metadata, 'original native metadata preserved');
    const after = await snapshot(db, input.snapshot.tables);
    const changedTables = [attemptTable, leaseTable, 'experience_guest_sessions', 'events', 'event_private_payloads', 'event_client_receipts',
      'output_commands', 'private_content', 'experience_guest_context_adoptions', 'experience_guest_image_claims',
      'experience_guest_image_stage_custodies', 'experience_guest_image_stage_copies', 'experience_guest_image_result_custodies',
      'experience_guest_image_result_copies'];
    for (const [name, before] of Object.entries(input.snapshot.rows)) {
      if (!changedTables.includes(name)) same(after[name], before, 'untouched table:' + name);
    }
    const canonical = {};
    for (const table of ['experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_image_stage_custodies',
      'experience_guest_image_stage_copies', 'experience_guest_image_result_custodies', 'experience_guest_image_result_copies'])
      canonical[table] = (await db.prepare(`SELECT * FROM ${quote(table)}`).all()).results;
    const session = await db.prepare('SELECT * FROM experience_guest_sessions WHERE session_id=?').bind(row.session_id).first();
    const descriptor = JSON.parse(row.descriptor_json), destinationStream = 'creative:' + row.destination_user_id;
    const events = (await db.prepare('SELECT * FROM events WHERE stream_id=? ORDER BY sequence').bind(destinationStream).all()).results;
    const contents = (await db.prepare('SELECT * FROM private_content WHERE owner_id=? ORDER BY content_id').bind(row.destination_user_id).all()).results;
    if (['positive', 'claim-ack-lost', 'retained-positive'].includes(input.mode)) {
      if (!(claimed?.status === 'claimed' && claimError === null && row.state === 'published'))
        throw Error('copy_fixture:exact complete winner accepted:' + JSON.stringify({ boundary: 'winner-assertion', ...diagnosticState(claimError, row.state) }));
      requireFact(claimed?.status === 'claimed' && claimError === null && row.state === 'published', 'exact complete winner accepted');
      requireFact(session.revoked_at_ms === row.published_at_ms && row.published_claim_digest === canonical.experience_guest_image_result_custodies[0]?.lineage_digest,
        'same atomic native tombstone, publication and canonical digest');
      same({ ...session, revoked_at_ms: readySession.revoked_at_ms }, readySession, 'every original session value except the one tombstone is preserved');
      requireFact(after.experience_guest_sessions.length === readySnapshot.experience_guest_sessions.length, 'no extra session created by claim');
      requireFact(events.length === descriptor.manifest.sourceHead + 2 && events.at(-1).type === 'GuestImageResultClaimed', 'N+2 canonical events');
      requireFact(contents.length === 5, 'five canonical body copies');
      for (const table of ['experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_image_stage_custodies', 'experience_guest_image_result_custodies'])
        requireFact(canonical[table].length === 1, 'one canonical mapping:' + table);
      requireFact(canonical.experience_guest_image_stage_copies.length === 3 && canonical.experience_guest_image_result_copies.length === 2, 'three plus two copy rows');
      const lineage = JSON.parse(canonical.experience_guest_image_result_custodies[0].lineage_json);
      for (const copy of [...lineage.stageCopies, ...lineage.resultCopies]) {
        const content = contents.find(value => value.content_id === copy.content_id);
        requireFact(content && content.owner_id === row.destination_user_id && content.redacted_at === null
          && content.created_at === copy.created_at && content.expires_at === copy.expires_at
          && encoder.encode(content.content).length === copy.byte_length, 'native canonical content/receipt association');
        // Contract digests hash canonical JSON strings, not raw UTF-8 bytes.
        requireFact('sha256:' + await hash(encoder.encode(JSON.stringify(content.content))) === copy.original_digest, 'exact copied body digest');
      }
      // Canonical append-only additions must not rewrite an original row. The
      // one guest-session tombstone is the sole allowed source-row update.
      for (const name of ['events', 'event_private_payloads', 'event_client_receipts', 'output_commands', 'private_content'])
        for (const before of input.snapshot.rows[name]) requireFact(after[name].some(value => stable(value) === stable(before)), 'original row preserved:' + name);
    } else if (input.mode === 'retained-cleanup-race') {
      requireFact(claimed === null && claimError !== null && injected === 1 && finalBatchSize === null && row.state === 'cleanup_pending',
        'fresh retry observes cleanup fence and does not publish');
      const expected = structuredClone(readySnapshot);
      expected[attemptTable] = after[attemptTable];
      same(after, expected, 'only fixture-owned attempt fence changed; no canonical write, lease refresh or revocation');
      requireFact(session.revoked_at_ms === null && events.length === 0 && contents.length === 0, 'no partial graph after fresh retry race');
    } else {
      requireFact(claimed === null && claimError !== null && injected === 1 && finalBatchSize !== null && rollbackSnapshot !== null,
        'control reached actual final batch and native rollback');
      same(after, readySnapshot, 'all candidate events, bodies, mappings, publication and revocation rolled back');
      same(row, readyRow, 'complete known-success ready tuple preserved after rollback');
      requireFact(session.revoked_at_ms === null && events.length === 0 && contents.length === 0, 'no partial visible canonical graph');
    }
    same((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'final foreign keys');
    same(violations, [], 'no swallowed fixture guard violation');
    requireFact(count('source-get') === 1 && count('source-head') === 1, 'one native source GET/HEAD');
    // Measured from the actual emitted constructor and executions. JSON byte
    // counts below describe these retained fixture bindings, not a replacement
    // for production's complete own-data envelope accounting or a new gate.
    const forms = [...sqlForms.values()];
    const nativeBudgetObservation = {
      statements: trace.length, finalBatchStatements: finalBatchSize,
      maxSqlUtf8Bytes: Math.max(...forms.map(item => encoder.encode(item.sql).length)),
      maxBindingArrayJsonBytes: Math.max(...forms.map(item => encoder.encode(JSON.stringify(item.bindings)).length)),
      claimStatements: trace.filter(item => ['claim', 'retained-claim'].includes(item.step)).length,
      claimSqlUtf8Bytes: trace.filter(item => ['claim', 'retained-claim'].includes(item.step))
        .reduce((total, item) => total + encoder.encode(forms[item.form].sql).length, 0),
      claimBindingArrayJsonBytes: trace.filter(item => ['claim', 'retained-claim'].includes(item.step))
        .reduce((total, item) => total + encoder.encode(JSON.stringify(forms[item.form].bindings)).length, 0),
    };
    const receipt = { mode: input.mode, status: claimed?.status ?? null, claimError, claimed, readyReview, row, readyRow, reservedRow, nativeBudgetObservation,
      destination: destinationReceipt, injected, injectionError, rolledBack: rollbackSnapshot !== null, replayRefused, finalBatchSize,
      canonical, session, events, contents, calls, trace, fixtureStorageCalls: { sourceSetupPut: 1, sourceVerificationGet: 1, destinationVerificationGet: 1 },
      sqlForms: [...sqlForms.values()], sourceVersion, unchangedTables: input.snapshot.tables.filter(name => !changedTables.includes(name)),
      sourceSha256: input.source.sha256, preservedRowsSha256: await hash(encoder.encode(stable(Object.fromEntries(Object.entries(after).filter(([name]) => !changedTables.includes(name)))))) };
    // Separate current-read phase; genuine native publication above is unchanged.
    requireFact(input.mode === 'positive'
      && ['original-positive', 'metadata-owner-refusal'].includes(input.currentCase),
    'fixed original-current case');
    requireFact(receipt.status === 'claimed' && row.state === 'published', 'genuine publication precedes current');
    const retainedCustody = canonical.experience_guest_image_result_custodies[0];
    const retainedLineage = JSON.parse(retainedCustody.lineage_json);
    const originalPlan = contents.find(value => value.content_id === retainedLineage.resultCopies.find(copy => copy.role === 'planner').content_id);
    requireFact(originalPlan && originalPlan.owner_id === row.destination_user_id, 'genuine retained planner');
    const originalClaim = receipt.claimed.completedReview;
    const claimPayloadRow = await db.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=? AND owner_id=?')
      .bind(retainedCustody.claim_event_id, row.destination_user_id).first();
    requireFact(claimPayloadRow && typeof claimPayloadRow.private_json === 'string', 'genuine canonical private claim');
    const originalClaimPayload = JSON.parse(claimPayloadRow.private_json);
    const expectedCurrent = Object.freeze({
      ownerId: row.destination_user_id,
      projectId: retainedLineage.copy.manifest.projectId,
      documentId: retainedLineage.copy.manifest.documentId,
      outputId: retainedCustody.output_id,
      generationId: retainedCustody.generation_id,
      claimEventId: retainedCustody.claim_event_id,
      key: row.destination_key,
    });
    controller.abort();
    requireFact(request.signal.aborted, 'original producer request retired');
    const currentController = new AbortController();
    const currentOrigin = new URL(request.url).origin;
    const currentRequest = new Request(currentOrigin + '/api/generated-images/' + encodeURIComponent(expectedCurrent.outputId), {
      method: 'GET', headers: { origin: currentOrigin,
        'oai-authenticated-user-id': expectedCurrent.ownerId,
        'oai-authenticated-user-email': expectedCurrent.ownerId + '@example.invalid' },
      signal: currentController.signal,
    });
    requireFact(!currentRequest.signal.aborted && currentRequest.body === null
      && new URL(currentRequest.url).search === '' && !currentRequest.headers.has('cookie')
      && !currentRequest.headers.has('authorization'), 'fresh personal GET with no guest or project-context authority');

    // Exact local fixture DDL only; no application operation installs this schema.
    const preMigrationRows = await snapshot(db, input.snapshot.tables);
    const sceneStatements = sceneMigration.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean);
    requireFact(sceneStatements.length > 0 && sceneStatements.length <= 64, 'pinned scene migration bound');
    await db.batch(sceneStatements.map(sql => db.prepare(sql)));
    same(await snapshot(db, input.snapshot.tables), preMigrationRows, 'scene DDL preserves all preexisting rows');

    async function fullCurrentState() {
      const schema = (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
      const tempSchema = (await db.prepare('SELECT type,name,tbl_name,sql FROM temp.sqlite_schema ORDER BY type,name').all()).results;
      const discovered = schema.filter(value => value.type === 'table').map(value => value.name).sort();
      const tables = [...input.snapshot.tables, 'scene_source_epoch', 'scene_source_generations'].sort();
      requireFact(discovered.length <= 512 && new Set(discovered).size === discovered.length
        && new Set(tables).size === tables.length, 'complete bounded native table roster');
      // Installed workerd reserves these exact internal tables; D1 denies their
      // row/PRAGMA access. Preserve their complete catalog definitions, while
      // snapshotting every exported application table and both actual scene tables.
      const protectedNames = new Set(['_cf_KV', '_cf_METADATA']);
      requireFact(tables.every(name => discovered.includes(name) && !protectedNames.has(name))
        && discovered.every(name => tables.includes(name) || protectedNames.has(name)), 'exact application and protected native table roster');
      const protectedPlatformTables = schema.filter(value => value.type === 'table' && protectedNames.has(value.name));
      return { schema, tempSchema, tables, protectedPlatformTables, rows: await snapshot(db, tables) };
    }
    function currentReject(message) {
      const value = 'current:' + message;
      // The enclosing fixture rechecks this same ledger at final response. A
      // production catch-to-null never turns a forbidden operation into a pass.
      violations.push(value);
      throw Error('copy_fixture_guard:' + value);
    }
    function readonlyCurrentSql(sql) {
      if (typeof sql !== 'string' || !/^\s*SELECT\b/iu.test(sql)) return false;
      let delimiter = '';
      for (let index = 0; index < sql.length; index++) {
        const character = sql[index];
        if (delimiter) {
          if (character === delimiter) {
            if (delimiter !== ']' && sql[index + 1] === delimiter) index++;
            else delimiter = '';
          }
        } else if (["'", '"', '`'].includes(character)) delimiter = character;
        else if (character === '[') delimiter = ']';
        else if (character === ';' || sql.slice(index, index + 2) === '--' || sql.slice(index, index + 2) === '/*') return false;
      }
      return delimiter === '';
    }
    function makeCurrentDbFacet(phaseName, permitEpochActivation = false) {
      const originals = new WeakMap(), pending = new Set();
      const observation = { phase: phaseName, statements: 0, wrappers: 0, batches: 0,
        maxBatch: 0, maxSqlBytes: 0, maxBindingBytes: 0, activationBatches: 0 };
      let active = true;
      const checkActive = () => { if (!active) currentReject(phaseName + ':stale-facet'); };
      function validate(sql, bindings) {
        checkActive();
        if (typeof sql !== 'string' || encoder.encode(sql).length > 100000
          || !Array.isArray(bindings) || bindings.length > 100
          || bindings.some(value => value !== null && typeof value !== 'string'
            && !(typeof value === 'number' && Number.isFinite(value)))
          || encoder.encode(JSON.stringify(bindings)).length > 1048576
          || !(readonlyCurrentSql(sql) || permitEpochActivation && sql === sceneEpochActivateSql && bindings.length === 0))
          currentReject(phaseName + ':sql-or-bindings');
      }
      function recordCurrent(query, method) {
        validate(query.sql, query.bindings);
        if (++observation.statements > 2186) currentReject(phaseName + ':statement-cap');
        const key = JSON.stringify([query.sql, query.bindings]);
        if (!sqlForms.has(key)) {
          sqlBytes += encoder.encode(key).length;
          if (sqlForms.size >= 4096 || sqlBytes > 32 * 1024 * 1024) currentReject('shared-sql-evidence-cap');
          sqlForms.set(key, { sql: query.sql, bindings: [...query.bindings] });
        }
        const entry = { step: phaseName, method, inserted: null, updated: null,
          form: [...sqlForms.keys()].indexOf(key), parameters: query.bindings.length };
        traceBytes += encoder.encode(JSON.stringify(entry)).length;
        if (trace.length >= 16384 || traceBytes > 2 * 1024 * 1024) currentReject('shared-trace-cap');
        trace.push(entry);
        observation.maxSqlBytes = Math.max(observation.maxSqlBytes, encoder.encode(query.sql).length);
        observation.maxBindingBytes = Math.max(observation.maxBindingBytes, encoder.encode(JSON.stringify(query.bindings)).length);
      }
      function dispatch(work) {
        checkActive();
        const value = work();
        const promise = Promise.resolve(value);
        pending.add(promise);
        promise.then(() => pending.delete(promise), () => pending.delete(promise));
        return promise;
      }
      function statement(sql, bindings = []) {
        validate(sql, bindings);
        if (++observation.wrappers > 4372) currentReject(phaseName + ':prepare-bind-cap');
        const actual = db.prepare(sql);
        const native = bindings.length ? actual.bind(...bindings) : actual;
        const item = Object.freeze({ native, sql, bindings: Object.freeze([...bindings]) });
        const wrapped = Object.freeze({
          bind(...values) { checkActive(); return statement(sql, values); },
          first(...args) {
            if (args.length > 1 || args.length && typeof args[0] !== 'string'
              || !readonlyCurrentSql(sql)) currentReject(phaseName + ':first');
            recordCurrent(item, 'first');
            return dispatch(() => Reflect.apply(native.first, native, args));
          },
          all(...args) {
            if (args.length || !readonlyCurrentSql(sql)) currentReject(phaseName + ':all');
            recordCurrent(item, 'all');
            return dispatch(() => Reflect.apply(native.all, native, []));
          },
          run() { return currentReject(phaseName + ':run'); },
          raw() { return currentReject(phaseName + ':raw'); },
        });
        originals.set(wrapped, item);
        return wrapped;
      }
      const database = Object.freeze({
        prepare(...args) { if (args.length !== 1) return currentReject(phaseName + ':prepare-arity'); return statement(args[0]); },
        batch(...args) {
          checkActive();
          const queries = args[0];
          if (args.length !== 1 || !Array.isArray(queries) || queries.length < 1 || queries.length > 210)
            currentReject(phaseName + ':batch-shape');
          const selected = [];
          // Resolve/validate every member before any native dispatch. No array holes,
          // stale producer handles, raw native handles or partially executed prefix.
          for (let index = 0; index < queries.length; index++) {
            const slot = Object.getOwnPropertyDescriptor(queries, index);
            const item = slot && Object.hasOwn(slot, 'value') ? originals.get(slot.value) : null;
            if (!item) currentReject(phaseName + ':foreign-or-sparse-batch');
            validate(item.sql, item.bindings); selected.push(item);
          }
          const activations = selected.filter(item => item.sql === sceneEpochActivateSql);
          if (activations.length && (!permitEpochActivation || activations.length !== 1
            || selected.length !== 4 || selected[2].sql !== sceneEpochActivateSql
            || observation.activationBatches !== 0)) currentReject(phaseName + ':activation-shape');
          if (activations.length) observation.activationBatches++;
          if (observation.statements + selected.length > 2186) currentReject(phaseName + ':batch-statement-cap');
          for (const item of selected) recordCurrent(item, 'batch');
          observation.batches++; observation.maxBatch = Math.max(observation.maxBatch, selected.length);
          return dispatch(() => Reflect.apply(db.batch, db, [selected.map(item => item.native)]));
        },
        exec() { return currentReject(phaseName + ':exec'); },
        dump() { return currentReject(phaseName + ':dump'); },
        withSession() { return currentReject(phaseName + ':withSession'); },
      });
      return Object.freeze({ database, observation,
        seal() { active = false; },
        async settle() { await Promise.allSettled([...pending]); requireFact(pending.size === 0, 'current native DB settlement'); },
      });
    }

    // Local source preparation has an explicit, separate authority/activation facet.
    // Current-read never inherits this exception or any producer/source allowance.
    const beforeEpoch = await fullCurrentState();
    const setupFacet = makeCurrentDbFacet('current-fixture-scene-setup', true);
    const setupEnv = { ...env, DB: setupFacet.database, MEDIA: Object.freeze({
      get() { return currentReject('setup:MEDIA.get'); }, head() { return currentReject('setup:MEDIA.head'); },
      put() { return currentReject('setup:MEDIA.put'); }, delete() { return currentReject('setup:MEDIA.delete'); },
      list() { return currentReject('setup:MEDIA.list'); }, createMultipartUpload() { return currentReject('setup:MEDIA.multipart'); },
      resumeMultipartUpload() { return currentReject('setup:MEDIA.resume-multipart'); },
    }) };
    let sceneVersionReceipt;
    try {
      const auth = await principal.readExistingPrincipalRequest(currentRequest, setupEnv, 'creator', { account: 'principal' });
      requireFact(!Object.hasOwn(auth, 'kind') && !auth.response && auth.user
        && principal.requireConsent(auth.user) === null && auth.user.userId === expectedCurrent.ownerId,
      'real consented claimant for explicit source preparation');
      const authority = intakeAuthority.projectIntakeAuthority(setupEnv,
        { user: auth.user, principal: auth.user, impersonation: null },
        { projectId: expectedCurrent.projectId, documentId: expectedCurrent.documentId });
      sceneVersionReceipt = await sceneVersion.captureSceneSourceVersion(setupEnv, { streamId: auth.user.streamId }, [authority]);
      requireFact(sceneVersionReceipt.streamId === 'creative:' + expectedCurrent.ownerId
        && sceneVersionReceipt.epoch === 1 && setupFacet.observation.activationBatches === 1, 'one genuine fixture source epoch');
    } finally { setupFacet.seal(); await setupFacet.settle(); }
    const afterEpoch = await fullCurrentState();
    same(afterEpoch.schema, beforeEpoch.schema, 'source preparation schema unchanged');
    same(afterEpoch.tempSchema, beforeEpoch.tempSchema, 'source preparation temp schema unchanged');
    for (const table of beforeEpoch.tables) if (table !== 'scene_source_epoch')
      same(afterEpoch.rows[table], beforeEpoch.rows[table], 'source preparation preserves:' + table);
    requireFact(afterEpoch.rows.scene_source_epoch.length === 1, 'one prepared epoch row');

    // A negative control changes actual local R2 state BEFORE the read-only baseline.
    // Positive authority/custody/pairs are never fabricated. The bytes come from one
    // genuine destination GET; the mutation and verification are fixture-only IO.
    const fixtureFault = { get: 0, put: 0, head: 0, applied: false };
    if (input.currentCase === 'metadata-owner-refusal') {
      const actual = await Reflect.apply(bucket.get, bucket, [expectedCurrent.key]); fixtureFault.get++;
      requireFact(actual && actual.version === receipt.destination.version && actual.size === row.byte_length, 'genuine destination before metadata fault');
      const actualBytes = await Reflect.apply(actual.arrayBuffer, actual, []);
      requireFact(await hash(actualBytes) === row.content_sha256, 'actual persisted PNG retained in metadata fault');
      const headers = new Headers(); Reflect.apply(actual.writeHttpMetadata, actual, [headers]);
      const originalMetadata = Reflect.get(actual, 'customMetadata', actual);
      requireFact(originalMetadata.ownerId === expectedCurrent.ownerId, 'real original owner metadata');
      const alteredMetadata = { ...originalMetadata, ownerId: 'fixture-foreign-owner' };
      const replaced = await Reflect.apply(bucket.put, bucket, [expectedCurrent.key, actualBytes,
        { onlyIf: { etagMatches: actual.etag }, customMetadata: alteredMetadata, httpMetadata: headers }]); fixtureFault.put++;
      requireFact(replaced !== null, 'fixture metadata replacement native ACK');
      const verified = await Reflect.apply(bucket.head, bucket, [expectedCurrent.key]); fixtureFault.head++;
      requireFact(verified && verified.version === replaced.version && verified.size === actual.size, 'actual persisted metadata replacement');
      same(verified.customMetadata, alteredMetadata, 'exact one-field custom metadata fault');
      fixtureFault.applied = true;
    }
    const beforeCurrent = await fullCurrentState();
    const currentFacet = makeCurrentDbFacet('current-read');
    const storageCalls = [], storagePending = new Set();
    let storageActive = true, nativeGetSettled = false, nativeGetReturnedObject = false;
    function nativeCurrentStorage(kind, args) {
      if (!storageActive || args.length !== 1 || args[0] !== expectedCurrent.key
        || kind === 'get' && storageCalls.length !== 0
        || kind === 'head' && (storageCalls.length !== 1 || storageCalls[0] !== 'get'
          || !nativeGetSettled || !nativeGetReturnedObject)) currentReject('storage:' + kind);
      storageCalls.push(kind);
      const promise = Promise.resolve(Reflect.apply(bucket[kind], bucket, args));
      storagePending.add(promise);
      promise.then(value => {
        if (kind === 'get') { nativeGetSettled = true; nativeGetReturnedObject = value !== null; }
        storagePending.delete(promise);
      }, () => { if (kind === 'get') nativeGetSettled = true; storagePending.delete(promise); });
      // Baseline passes the genuine native R2 object and body through unchanged.
      // Do not claim fixture-owned stream EOF/segment/cancel observations here.
      return promise;
    }
    const currentBucket = Object.freeze({
      get(...args) { return nativeCurrentStorage('get', args); },
      head(...args) { return nativeCurrentStorage('head', args); },
      put() { return currentReject('storage:put'); }, delete() { return currentReject('storage:delete'); },
      list() { return currentReject('storage:list'); }, createMultipartUpload() { return currentReject('storage:multipart'); },
      resumeMultipartUpload() { return currentReject('storage:resume-multipart'); },
    });
    const currentEnv = { ...env, DB: currentFacet.database, MEDIA: currentBucket };
    let result;
    try {
      result = await custody.readGuestImageResultCurrentSnapshot(currentRequest, currentEnv, { outputId: expectedCurrent.outputId });
    } finally {
      currentController.abort(); currentFacet.seal(); storageActive = false;
      await currentFacet.settle(); await Promise.allSettled([...storagePending]);
      requireFact(storagePending.size === 0, 'current native storage settlement');
    }
    const afterCurrent = await fullCurrentState();
    same(afterCurrent, beforeCurrent, 'every application/scene rowid/scalar and complete main/temp catalog unchanged by current read');
    same((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'current fixture foreign keys');
    same(violations, [], 'no swallowed or late fixture guard violation');
    if (input.currentCase === 'original-positive') {
      requireFact(result && result.status === 'current' && Object.isFrozen(result) && Object.isFrozen(result.claim), 'actual frozen current snapshot');
      for (const name of ['ownerId', 'projectId', 'documentId', 'outputId', 'generationId'])
        same(result[name], expectedCurrent[name], 'exact original current:' + name);
      same(result.sourceEventId, expectedCurrent.claimEventId, 'same canonical claim event');
      same(result.contentRef, originalPlan.content_id, 'same retained planner reference');
      same(result.rawJson, originalPlan.content, 'exact original planner bytes');
      same(result.contentSha256, await hash(encoder.encode(originalPlan.content)), 'actual original planner hash');
      same(result.claim, originalClaim, 'same genuine completed custody review');
      same(result.revision, 0, 'original revision'); same(result.editEventId, null, 'no invented edit');
      same(result.media, { url: originalClaimPayload.media_url, mediaType: 'image/png', sha256: row.content_sha256,
        width: row.width, height: row.height, byteLength: row.byte_length }, 'exact original PNG identity');
      same(result.sources, [], 'no invented local reference'); same(result.sourceIds, [], 'no invented source IDs');
      requireFact(!Object.hasOwn(result, 'sessionToken') && !Object.hasOwn(result, 'claimToken'), 'no guest token in snapshot');
      same(storageCalls, ['get', 'head'], 'one native destination GET then HEAD');
    } else {
      same(result, null, 'persisted metadata-owner change refused');
      same(storageCalls, ['get'], 'metadata refusal reaches native GET and never reaches HEAD');
    }
    // Snapshot/catalog and raw fixture setup IO are separate from application IO.
    // Shared form/trace arrays are refreshed after both newly introduced phases.
    receipt.sqlForms = [...sqlForms.values()];
    receipt.nativeBudgetObservation.scope = 'producer-before-current-fixture-setup';
    receipt.aggregateNativeBudgetObservation = {
      statements: trace.length,
      maxSqlUtf8Bytes: Math.max(...receipt.sqlForms.map(form => encoder.encode(form.sql).length)),
      maxBindingArrayJsonBytes: Math.max(...receipt.sqlForms.map(form => encoder.encode(JSON.stringify(form.bindings)).length)),
    };
    receipt.current = {
      case: input.currentCase, status: result === null ? 'refused' : 'current',
      snapshot: result, sourceVersion: sceneVersionReceipt,
      setup: setupFacet.observation, fixtureFault,
      protectedPlatformTables: beforeCurrent.protectedPlatformTables,
      protectedPlatformData: 'unavailable through native D1; catalog definitions compared, internal rows not inspected',
      database: currentFacet.observation, storageCalls,
      unchangedRowsAndSchemaSha256: await hash(encoder.encode(JSON.stringify(beforeCurrent))),
      originalProducerRequestAborted: request.signal.aborted,
      attribution: 'dormant direct current-reader entrypoint; genuine same-Worker inventory/reserve/copy/claim; actual local D1/native R2; original native GET object/body; synthetic provider production; no public route/UI/provider/invoice acceptance',
    };
    same(violations, [], 'final current fixture denial ledger remains empty');
    // Existing final JSON response limit (36 MiB), host cleanup, source bookends,
    // SQL qualification, and unexpected-denial assertions remain mandatory.
    const response = JSON.stringify(receipt); requireFact(encoder.encode(response).length <= 36 * 1024 * 1024, 'fixture response bound');
    return new Response(response, { headers: { 'content-type': 'application/json' } });
  } };
}

const fixturePaths = [
  'tests/generated-image-claimed-current.test.mjs', 'drizzle/0038_scene_source_generations.sql',
  'tests/experience-guest-image-result-claim-d1.test.mjs',
  'tests/experience-guest-image-result-copy-writer-d1-r2.test.mjs',
  'tests/experience-guest-image-result-copy-writer.test.mjs',
  'tests/helpers/guest-image-result-media-fixture.mjs', 'tests/helpers/guest-image-result-inventory-fixture.mjs',
  'tests/helpers/guest-image-run-fixture.mjs', 'tests/helpers/guest-image-admission-fixture.mjs',
  'tests/helpers/guest-image-issuer-fixture.mjs', 'tests/helpers/guest-image-stage-fixture.mjs',
  'tests/helpers/model3d-workerd-snapshot.mjs', 'tests/helpers/d1-expression-depth.mjs',
  'tests/output-execution-test-helpers.mjs', 'tests/output-server-test-helpers.mjs',
  'package.json', 'pnpm-lock.yaml',
];
async function pinFiles(paths) {
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await readFile(resolve(root, path)))])));
}

async function bundleWorker() {
  const repoRequire = createRequire(resolve(root, 'package.json'));
  const wranglerRequire = createRequire(repoRequire.resolve('wrangler'));
  const esbuildEntry = wranglerRequire.resolve('esbuild'), esbuild = wranglerRequire('esbuild');
  const sceneMigrationText = await readFile(resolve(nativeHarnessRoot,
    'drizzle/0038_scene_source_generations.sql'), 'utf8');
  const source = `import * as inventory from './worker/experience-guest-image-result-inventory.ts';\n`
    + `import * as core from './worker/experience-guest-image-result-claim-source.ts';\n`
    + `import * as media from './worker/experience-guest-image-result-media.ts';\n`
    + `import * as custody from './worker/experience-guest-image-result-custody.ts';\n`
    + `import * as principal from './worker/principal-request-core.ts';\n`
    + `import * as intakeAuthority from './worker/intake-authority.ts';\n`
    + `import * as sceneVersion from './worker/scene-source-generation.ts';\n`
    + `import { SCENE_SOURCE_EPOCH_ACTIVATE_SQL as sceneEpochActivateSql } from './db/scene-source-generations.ts';\n`
    + `export default (${nativeCurrentFixtureWorker.toString()})({inventory,core,media,custody,principal,intakeAuthority,sceneVersion,sceneEpochActivateSql,sceneMigration:${JSON.stringify(sceneMigrationText)}});\n`;
  const dependencyRoot = await realpath(resolve(root, 'node_modules'));
  const inputs = new Map(); let totalBytes = 0;
  // Bounds admit one finite selected source closure; they are fixture tooling
  // bounds, not an application claim/source/accounting allowance. No package is
  // installed, stubbed, rewritten or imported by Node here. Only node:crypto
  // remains external, supplied natively by workerd's nodejs_compat flag.
  let result;
  try { result = await finite(esbuild.build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root,
    sourcefile: 'guest-image-current-native-fixture-entry.mjs', loader: 'js' }, bundle: true, write: false,
    platform: 'browser', format: 'esm', target: 'es2022', treeShaking: true, metafile: true, logLevel: 'silent',
    external: ['node:crypto'],
    plugins: [{ name: 'finite-unmodified-selected-closure', setup(build) {
      build.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, async args => {
        const path = await realpath(args.path), local = relative(root, path);
        const dependency = relative(dependencyRoot, path);
        const inRepository = ['worker' + sep, 'src' + sep, 'db' + sep].some(prefix => local.startsWith(prefix));
        const inDependencies = dependency !== '' && dependency !== '..' && !dependency.startsWith('..' + sep);
        assert.ok(inRepository || inDependencies, 'bundle input is a selected repo/dependency file: ' + local);
        const bytes = await readFile(path);
        if (!inputs.has(path)) {
          totalBytes += bytes.byteLength; assert.ok(inputs.size < 640 && totalBytes <= 16 * 1024 * 1024, 'selected source closure bound');
          inputs.set(path, { path, sha256: sha(bytes), bytes: bytes.byteLength });
        } else assert.equal(inputs.get(path).sha256, sha(bytes), 'input bytes stable during bundle');
        const extension = extname(path), loader = extension === '.json' ? 'json' : /tsx$/u.test(extension) ? 'tsx'
          : /ts$/u.test(extension) ? 'ts' : /jsx$/u.test(extension) ? 'jsx' : 'js';
        return { contents: bytes, loader, resolveDir: dirname(path) };
      });
    } }],
  }), 30000, 'selected-module-bundle');
  } finally { esbuild.stop(); }
  assert.equal(result.errors.length, 0); assert.equal(result.warnings.length, 0);
  assert.equal(result.outputFiles.length, 1); assert.ok(result.outputFiles[0].contents.byteLength <= 8 * 1024 * 1024);
  const nativeCryptoImport = item => item.external === true && item.path === 'node:crypto' && item.kind === 'import-statement';
  // These exact pinned declarations are erased types, verified independently
  // against their AST and emitted bundle. They are input metadata only; the
  // emitted Worker allowlist below still permits only native node:crypto.
  const inputOnlyTypes = [
    { importer: 'worker/generated-image-api.ts', path: '../src/model/events.ts', sha256: 'd3f7b4091fa2394243995cad4e7a11ea088afbafa402b299540ad3a767d3e4e6' },
    { importer: 'worker/output-scene-completion.ts', path: './output-scene-preflight-contract.ts', sha256: '3025254f97eb1b07750577b00673c61436fa814a9208493a8c13ba83e3f572bd' },
  ];
  const inputOnlyRecords = Object.entries(result.metafile.inputs).flatMap(([importer, value]) =>
    value.imports.filter(item => item.external && !nativeCryptoImport(item)).map(item => ({ importer, ...item })));
  assert.equal(inputOnlyRecords.length, inputOnlyTypes.length, 'exact erased-type input roster: ' + JSON.stringify(inputOnlyRecords.slice(0, 8)));
  for (const expected of inputOnlyTypes) {
    const matches = inputOnlyRecords.filter(item => item.importer === expected.importer && item.path === expected.path
      && item.kind === 'import-statement' && item.external === true);
    assert.equal(matches.length, 1, 'one exact reviewed erased-type input: ' + expected.importer + ': ' + JSON.stringify(inputOnlyRecords.slice(0, 8)));
    assert.equal(inputs.get(await realpath(resolve(root, expected.importer)))?.sha256, expected.sha256, 'erased-type source bytes unchanged');
  }
  assert.ok(Object.values(result.metafile.outputs).every(value => value.imports.every(nativeCryptoImport)), 'no unresolved arbitrary Worker import');
  const nativeExternalImports = Object.values(result.metafile.outputs).flatMap(value => value.imports);
  const sourceInputs = [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path));
  const receipt = { entrySha256: sha(source), outputSha256: sha(result.outputFiles[0].contents), outputBytes: result.outputFiles[0].contents.byteLength,
    sourceBytes: totalBytes, dependencyRoot, sourceInputs, nativeExternalImports, verifiedInputOnlyTypes: inputOnlyTypes, metafileSha256: sha(JSON.stringify(result.metafile)),
    esbuildEntry, esbuildEntrySha256: sha(await readFile(esbuildEntry)), esbuildVersion: esbuild.version };
  phase('selected-closure-bundle', receipt);
  return { script: result.outputFiles[0].text, receipt, sceneMigrationText, async assertUnchanged() {
    for (const input of sourceInputs) assert.equal(sha(await readFile(input.path)), input.sha256, 'bundle source stable: ' + input.path);
  } };
}

async function ownedRuntime(t, label, script, egress) {
  const repoRequire = createRequire(resolve(root, 'package.json'));
  const wranglerRequire = createRequire(repoRequire.resolve('wrangler')), entry = wranglerRequire.resolve('miniflare');
  const guard = installHostNetworkGuard(entry); let mf, constructionAttempted = false, cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    const failures = []; let disposed = !constructionAttempted;
    guard.setPhase('dispose');
    if (mf) {
      try { await finite(mf.dispose(), 10000, label + ':dispose'); disposed = true; }
      catch (error) { failures.push(error); }
    }
    phase('host-network-guard-final', { label, ...guard.snapshot(), constructionAttempted,
      runtimeHandleAcquired: !!mf, ownedRuntimeDisposed: disposed });
    try { guard.assertContained(); } catch (error) { failures.push(error); }
    try { assert.deepEqual(egress, [], 'caught Worker egress remains a fixture failure'); } catch (error) { failures.push(error); }
    if (disposed) {
      try { guard.restore(); phase('host-network-guard-restored', { label, restored: guard.snapshot().restored }); }
      catch (error) { failures.push(error); }
    } else phase('host-network-guard-retained', { label, reason: 'disposal unconfirmed; isolated runner must terminate owned process group; do not reuse process' });
    if (failures.length) throw new AggregateError(failures, 'owned direct Worker cleanup or containment failed');
  })();
  // Registered before guard probes, Miniflare loading and constructor dispatch.
  t.after(cleanup);
  phase('host-network-guard-ready', { label, ...guard.identity, ...await guard.verifyGuards() });
  const { Miniflare, Log, LogLevel } = wranglerRequire('miniflare');
  constructionAttempted = true;
  mf = new Miniflare({ cf: false, modules: true, script, compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE), d1Databases: { DB: 'synthetic-copy-writer' },
    r2Buckets: ['MEDIA'], outboundService: request => {
      egress.push({ method: request.method, url: request.url }); throw Error('FORMA_WORKER_EGRESS_DENIED');
    } });
  return { mf, cleanup };
}

const nativeHarnessRoot = root;
const nativeCurrentPhase = phase, nativeCurrentFinite = finite;
const nativeCurrentPinFiles = pinFiles, nativeCurrentFixturePaths = fixturePaths;
const nativeCurrentFixtureWorker = fixtureWorker, nativeCurrentBundle = bundleWorker;
const nativeCurrentOwnedRuntime = ownedRuntime;

async function qualifyNativeCurrent(t, currentCase) {
  assert.ok(['original-positive', 'metadata-owner-refusal'].includes(currentCase));
  // Prerequisite outside this code: root has accepted the exact composed source
  // and its atomic producer qualification. Do not execute a mutable supplier
  // checkout, accept a default stale pin, or introduce a sibling runtime import.
  const before = await nativeCurrentPinFiles(nativeCurrentFixturePaths);
  nativeCurrentPhase('source-bookend-before', { currentCase, sourcePins: before });
  t.after(async () => {
    const after = await nativeCurrentPinFiles(nativeCurrentFixturePaths);
    nativeCurrentPhase('source-bookend-after', { currentCase, sourcePins: after });
    assert.deepEqual(after, before, 'current fixture/compiler dependencies remain fixed');
  });
  const bundle = await nativeCurrentBundle();
  t.after(() => bundle.assertUnchanged());
  // Already imported by the existing current test through the supplier's
  // directlyInvoked gate; this runs genuine synthetic Run/source producers.
  const f = await copyWriterFixture(t, { inventory: false });
  const exported = exportSynthetic(f.sqlite);
  const payload = {
    mode: 'positive', currentCase, snapshot: exported, proof: f.proof,
    request: { url: f.request.url, headers: [...f.request.headers] },
    source: { key: f.mediaOracle.key, sha256: f.mediaOracle.sha256,
      base64: Buffer.from(f.mediaOracle.bytes).toString('base64'),
      metadata: f.mediaOracle.metadata, httpMetadata: f.mediaOracle.httpMetadata },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 16 * 1024 * 1024);
  // Capabilities, adapters and request objects never cross the JSON boundary.
  // A new real inventory/lease/read/reserve/copy/claim runs inside the Worker.
  t.mock.reset();
  const egress = [], runtime = await nativeCurrentOwnedRuntime(t, currentCase, bundle.script, egress);
  let result;
  try {
    const response = await nativeCurrentFinite(runtime.mf.dispatchFetch('http://fixture.invalid/qualify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }), 45000, currentCase + ':dispatch');
    const body = await nativeCurrentFinite(response.text(), 5000, currentCase + ':response');
    assert.equal(response.status, 200, body.slice(0, 2048));
    assert.ok(Buffer.byteLength(body) <= 36 * 1024 * 1024);
    result = JSON.parse(body);
  } finally { await runtime.cleanup(); }

  // Prepare actual recorded statement forms only after owned runtime disposal.
  // The exact 0038 schema must exist here too; omission gives false SQL failure.
  const schema = exported.schema.filter(row => row.sql).sort((left, right) => {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    return rank[left.type] - rank[right.type] || left.name.localeCompare(right.name);
  }).map(row => row.sql);
  const sceneSql = bundle.sceneMigrationText.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean);
  const { createMediaSqlQualifier } = await import('./helpers/guest-image-result-media-fixture.mjs');
  const qualifier = await createMediaSqlQualifier([...schema, ...sceneSql]);
  for (const form of result.sqlForms) qualifier.qualify(form.sql, form.bindings);
  qualifier.assertVerified();
  const sqlMetrics = qualifier.metrics();
  assert.ok(sqlMetrics.uniqueSql > 0 && sqlMetrics.maxBindings <= 100 && sqlMetrics.maxSqlBytes <= 100000);
  assert.equal(result.status, 'claimed'); assert.equal(result.row.state, 'published');
  assert.equal(result.sourceSha256, f.mediaOracle.sha256);
  assert.ok(result.unchangedTables.includes('output_native_storage_writes')
    && result.unchangedTables.includes('output_provider_calls'));
  assert.equal(result.current.case, currentCase);
  assert.equal(result.current.originalProducerRequestAborted, true);
  assert.equal(result.current.database.phase, 'current-read');
  assert.equal(result.current.database.activationBatches, 0);
  assert.ok(result.current.database.statements > 0 && result.current.database.statements <= 2186);
  assert.ok(result.current.database.maxBatch <= 210);
  assert.match(result.current.unchangedRowsAndSchemaSha256, /^[a-f0-9]{64}$/u);
  if (currentCase === 'original-positive') {
    assert.equal(result.current.status, 'current');
    assert.deepEqual(result.current.storageCalls, ['get', 'head']);
    assert.deepEqual(result.current.fixtureFault, { get: 0, put: 0, head: 0, applied: false });
  } else {
    assert.equal(result.current.status, 'refused'); assert.equal(result.current.snapshot, null);
    assert.deepEqual(result.current.storageCalls, ['get']);
    assert.deepEqual(result.current.fixtureFault, { get: 1, put: 1, head: 1, applied: true });
  }
  nativeCurrentPhase('native-current-qualification-receipt', {
    currentCase, current: result.current, sqlMetrics,
    bundleSha256: bundle.receipt.outputSha256,
    sourcePins: before, sourceVersion: result.sourceVersion,
    attribution: 'native current direct entrypoint; synthetic source/Run production; actual local D1 and R2; no route activation, live provider call, invoice, browser journey or native segmentation acceptance',
  });
  return result;
}

// Do not use the old synthetic `test` wrapper (30-second timeout and unrelated
// fixture closers). The two independently selectable names avoid replaying the
// unrelated synthetic/atomic rosters. Execute positive first; root decides when
// the second native qualification is justified after its receipt.
// These two names are selected independently by the contained native runner.
nativeTest('native claimed image current: original published result', { timeout: 180000, concurrency: false }, async t => {
  await qualifyNativeCurrent(t, 'original-positive');
});
nativeTest('native claimed image current: persisted owner metadata change is refused', { timeout: 180000, concurrency: false }, async t => {
  await qualifyNativeCurrent(t, 'metadata-owner-refusal');
});

}
