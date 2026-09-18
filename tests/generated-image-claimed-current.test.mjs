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
