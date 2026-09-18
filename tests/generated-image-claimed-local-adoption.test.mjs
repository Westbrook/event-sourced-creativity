import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as nativeTest } from 'node:test';
import { pathToFileURL } from 'node:url';
import { copyWriterFixture, genuineReservation, installCopyWriterGuards, claimOwner, attemptTable }
  from './experience-guest-image-result-copy-writer.test.mjs';
import { snapshot as databaseSnapshot, rows, knownPngOracle } from './helpers/guest-image-result-media-fixture.mjs';
import { guardInventory, changes } from './helpers/guest-image-result-inventory-fixture.mjs';

// SOURCE-AUTHORED ONLY. The gated copy-writer fixture and its reviewed closure
// must be composed into this checkout before execution. No sibling-worktree
// import, fabricated custody, constructed positive pair, or injected authority
// is a substitute. These are local SQLite/fake-native-R2 cases, not workerd
// evidence. The original current suite remains unchanged and is not imported.
const [api, media, custody, copyContract, sceneVersion, principal, intakeAuthority, eventAppend, eventWrite, eventRead, localAdoption] = await Promise.all([
  import('../worker/experience-guest-image-result-claim-source.ts'),
  import('../worker/experience-guest-image-result-media.ts'),
  import('../worker/experience-guest-image-result-custody.ts'),
  import('../worker/experience-guest-image-result-copy-contract.ts'),
  import('../worker/scene-source-generation.ts'),
  import('../worker/principal-request-core.ts'),
  import('../worker/intake-authority.ts'),
  import('../worker/event-append.ts'),
  import('../worker/event-write-primitives.ts'),
  import('../worker/event-read-primitives.ts'),
  import('../worker/generated-image-claimed-local-adoption.ts'),
]);
const directlyInvoked = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
const test = (name, run) => nativeTest(name, { timeout: 30000, concurrency: false }, run);
const hash = value => createHash('sha256').update(value).digest('hex');
const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu;
const claimTables = new Set(['events', 'event_private_payloads', 'event_write_stage', 'event_client_receipts', 'output_commands', 'private_content',
  'experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_image_stage_custodies',
  'experience_guest_image_stage_copies', 'experience_guest_image_result_custodies', 'experience_guest_image_result_copies',
  'experience_guest_sessions', attemptTable]);
const appendTables = new Set(['events', 'event_private_payloads', 'event_write_stage', 'scene_source_generations']);
const objectState = new WeakMap();
class DestinationObject {
  constructor(raw, state) { objectState.set(this, { raw, state }); }
  get key() { return objectState.get(this).raw.key; }
  get version() { return objectState.get(this).raw.version; }
  get size() { return objectState.get(this).raw.size; }
  get etag() { return objectState.get(this).raw.etag; }
  get httpEtag() { return objectState.get(this).raw.httpEtag; }
  get uploaded() { return objectState.get(this).raw.uploaded; }
  get customMetadata() { return objectState.get(this).raw.metadata; }
  get httpMetadata() { return objectState.get(this).raw.httpMetadata; }
  writeHttpMetadata(headers) {
    const value = objectState.get(this); assert.ok(value, 'preserve native metadata receiver');
    value.state.metadataCalls++; headers.set('content-type', value.raw.httpMetadata.contentType);
  }
}
class DestinationBody extends DestinationObject { get body() { return objectState.get(this).raw.body; } }
const storedSnapshot = objects => [...objects].map(([key, value]) => ({ key, ...value,
  bytes: Buffer.from(value.bytes).toString('base64'), metadata: structuredClone(value.metadata) }));

/** Transplanted reviewed current-reader guard pattern, with a separate exact
 * stage-only append mode. Read phases never inherit either write allowlist.
 * All caught forbidden operations remain teardown failures. Every phase is
 * explicitly closed before the returned fixture enters another writer. */
function phaseGuard(t, f, objects, { publication = false, appendTypes = null, noMedia = false } = {}) {
  assert.equal(publication && appendTypes !== null, false);
  const io = guardInventory(f, t, { database: false, snapshotDatabase: false });
  const original = { prepare: f.DB.prepare, batch: f.DB.batch };
  const blocked = new Map(['exec', 'dump'].map(key => [key, Object.getOwnPropertyDescriptor(f.DB, key)]));
  const initial = databaseSnapshot(f), initialObjects = storedSnapshot(objects), initialChanges = changes(f);
  const handles = new WeakMap(), violations = [], statements = [], calls = [], batches = [], pending = new Set();
  let active = new Set(), closed = false;
  const state = { metadataCalls: 0, streamReads: 0, streamCancels: 0, streamEofs: 0, chunks: [],
    readTransform: null, batchTransform: null, batchFault: null, getTransform: null, headTransform: null };
  const denied = operation => { violations.push(operation); throw Error('claimed adoption fixture blocked ' + operation); };
  const conform = fn => { try { return fn(); } catch (error) { violations.push(String(error)); throw error; } };
  const qualify = (sql, bindings, method) => conform(() => {
    assert.equal(typeof sql, 'string'); assert.ok(Buffer.byteLength(sql) <= 100000); assert.ok(bindings.length <= 100);
    const inserted = /^\s*INSERT INTO ([a-z_]+)\b/u.exec(sql)?.[1], updated = /^\s*UPDATE ([a-z_]+) SET\b/u.exec(sql)?.[1];
    if (inserted || updated) {
      assert.equal(method, 'batch');
      if (publication) {
        assert.ok(claimTables.has(inserted ?? updated));
        if (updated) assert.ok(['experience_guest_sessions', attemptTable].includes(updated));
      } else {
        assert.ok(appendTypes, 'read phases cannot write'); assert.equal(inserted, 'event_write_stage'); assert.equal(updated, undefined);
        assert.ok(appendTypes.some(type => bindings.includes(type)), 'only this phase\'s exact native event types');
      }
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
    conform(() => { assert.ok(Array.isArray(prepared)); assert.ok(prepared.length <= (appendTypes ? 421 : 512)); });
    const items = prepared.map(statement => {
      const captured = handles.get(statement); if (!captured) return denied('unknown DB batch handle');
      qualify(captured.sql, captured.bindings, 'batch'); return captured;
    });
    const stageIndexes = items.flatMap((item, index) => /^\s*INSERT INTO event_write_stage\b/u.test(item.sql) ? [index] : []);
    const batch = { items, publication: stageIndexes.length > 0, statementEnd: statements.length,
      completed: false, failed: false, injectedFault: null };
    batches.push(batch); let actual = prepared;
    if (state.batchFault !== null && batch.publication) {
      conform(() => {
        assert.equal(publication, false); assert.deepEqual(appendTypes, ['ReferenceIngested', 'BlockCreated']);
        assert.equal(stageIndexes.length, 2); assert.equal(stageIndexes[1], stageIndexes[0] + 1);
        assert.ok(['second-stage', 'trailing-proof'].includes(state.batchFault));
      });
      actual = [...prepared]; batch.injectedFault = state.batchFault;
      if (state.batchFault === 'second-stage') {
        const index = stageIndexes[1], item = items[index], bindings = [...item.bindings];
        // Named negative only: collide with the first actual event's ID in the
        // second native stage INSERT. The real trigger/unique constraint must
        // fail after the first stage ran, rolling the entire transaction back.
        bindings[0] = items[stageIndexes[0]].bindings[0];
        actual[index] = original.prepare.call(this, item.sql).bind(...bindings);
        batch.actualFault = { index, sql: item.sql, bindings };
      } else {
        const index = stageIndexes[1] + 1;
        conform(() => { assert.ok(index < items.length - 1); assert.ok(items[index].sql.startsWith('SELECT CASE WHEN ')); });
        const sql = "SELECT CASE WHEN 0 THEN 1 ELSE json('fixture_adoption_trailing_failure') END AS current";
        // Replace one existing trailing assertion, after both real native
        // stages, with a real throwing SQLite assertion in the same batch.
        actual[index] = original.prepare.call(this, sql); batch.actualFault = { index, sql, bindings: [] };
      }
    }
    const previous = active; active = new Set(actual);
    let result;
    try { result = await original.batch.call(this, actual); batch.completed = true; }
    catch (error) { batch.failed = true; batch.error = String(error); throw error; }
    finally { active = previous; }
    return state.batchTransform ? state.batchTransform(result, { items, publication: batch.publication, record: batch }) : result;
  };
  for (const method of blocked.keys()) Object.defineProperty(f.DB, method, { configurable: true, writable: true, value: () => denied('DB.' + method) });
  const object = key => conform(() => {
    assert.equal(key, rows(f, attemptTable)[0].destination_key, 'only actual canonical destination key');
    const value = objects.get(key); assert.ok(value); return value;
  });
  const settle = operation => { pending.add(operation); void operation.finally(() => pending.delete(operation)).catch(() => undefined); return operation; };
  if (!noMedia) f.env.MEDIA.head = function (key, options) {
    conform(() => { assert.equal(this, f.env.MEDIA); assert.equal(options, undefined);
      assert.equal(calls.filter(call => call.kind === 'head').length, 0, 'one exact destination HEAD'); });
    calls.push({ kind: 'head', key }); const stored = object(key);
    return settle(Promise.resolve().then(() => {
      const raw = { ...stored, metadata: { ...stored.metadata }, httpMetadata: { ...stored.httpMetadata } };
      return new DestinationObject(state.headTransform ? state.headTransform(raw) : raw, state);
    }));
  };
  if (!publication && !noMedia) f.env.MEDIA.get = function (key, options) {
    conform(() => { assert.equal(this, f.env.MEDIA); assert.equal(options, undefined);
      assert.equal(calls.filter(call => call.kind === 'get').length, 0, 'one exact current PNG GET'); });
    calls.push({ kind: 'get', key }); const stored = object(key);
    return settle(Promise.resolve().then(() => {
      const captured = { ...stored, metadata: { ...stored.metadata }, httpMetadata: { ...stored.httpMetadata }, bytes: stored.bytes.slice() };
      const raw = state.getTransform ? state.getTransform(captured) : captured; let offset = 0;
      const body = new ReadableStream({ pull(controller) {
        state.streamReads++; if (offset === raw.bytes.length) { state.streamEofs++; controller.close(); return; }
        const chunk = raw.bytes.slice(offset, Math.min(offset + 4096, raw.bytes.length)); offset += chunk.length;
        state.chunks.push(chunk); controller.enqueue(chunk);
      }, cancel() { state.streamCancels++; } }, { highWaterMark: 0 });
      return new DestinationBody({ ...raw, body }, state);
    }));
  };
  function preserved() {
    assert.deepEqual(violations, []); io.assertUntouched();
    assert.deepEqual(storedSnapshot(objects), initialObjects, 'no phase can change copied destination bytes or metadata');
    const after = databaseSnapshot(f); assert.deepEqual(after.schema, initial.schema);
    if (!publication && !appendTypes) {
      assert.deepEqual(after, initial, 'current read or refusal changes no database rows'); assert.equal(changes(f), initialChanges);
    } else if (appendTypes) {
      for (const [table, value] of Object.entries(initial.contents)) {
        if (!appendTables.has(table)) assert.deepEqual(after.contents[table], value, table + ' preserved by local append');
        else if (table !== 'scene_source_generations')
          for (const prior of value) assert.ok(after.contents[table].some(row => JSON.stringify(row) === JSON.stringify(prior)), table + ' original row preserved');
      }
      assert.deepEqual(after.contents.event_write_stage, initial.contents.event_write_stage, 'stage rows retire atomically');
      const beforeIds = new Set(initial.contents.events.map(row => row.event_id));
      const added = after.contents.events.filter(row => !beforeIds.has(row.event_id));
      assert.ok(added.length === 0 || added.length === appendTypes.length, 'one entire native range or no append');
      assert.deepEqual(added.map(row => row.type), added.length ? appendTypes : []);
      assert.ok(added.every(row => row.stream_id === 'creative:' + claimOwner));
      const beforePrivate = new Set(initial.contents.event_private_payloads.map(row => row.private_event_id));
      const privateAdded = after.contents.event_private_payloads.filter(row => !beforePrivate.has(row.private_event_id));
      assert.deepEqual(privateAdded.map(row => row.private_event_id).sort(), added.map(row => row.event_id).sort());
      assert.ok(privateAdded.every(row => row.owner_id === claimOwner && row.redacted_at === null));
      const oldVersions = initial.contents.scene_source_generations;
      const expectedVersions = oldVersions.map(value => Object.assign(Object.create(Object.getPrototypeOf(value)), value)), key = 'creative:' + claimOwner;
      const stream = expectedVersions.find(row => row.scope_kind === 'stream' && row.scope_key === key);
      if (stream) stream.generation += 2 * added.length;
      else if (added.length) {
        const actual = after.contents.scene_source_generations.find(row => row.scope_kind === 'stream' && row.scope_key === key); assert.ok(actual);
        expectedVersions.push(Object.assign(Object.create(Object.getPrototypeOf(actual)), { scope_kind: 'stream', scope_key: key, generation: 2 * added.length }));
      }
      const sortVersions = values => [...values].sort((a, b) => JSON.stringify([a.scope_kind, a.scope_key]).localeCompare(JSON.stringify([b.scope_kind, b.scope_key])));
      assert.deepEqual(sortVersions(after.contents.scene_source_generations), sortVersions(expectedVersions), 'only actual event/private triggers advance the personal stream');
      const writes = statements.filter(statement => statement.inserted);
      assert.ok(writes.length <= appendTypes.length, 'one native append attempt');
      const publications = batches.filter(batch => batch.publication);
      assert.ok(publications.length <= 1, 'one atomic append batch');
      if (!added.length && !writes.length) assert.equal(changes(f), initialChanges, 'reuse/refusal performs no hidden writes');
      else if (!added.length) {
        // SQLite total_changes includes rolled-back stage/trigger attempts.
        // Full native row equality, not that cumulative counter, proves rollback.
        assert.equal(publications.length, 1); assert.equal(publications[0].failed, true);
        assert.deepEqual(after, initial, 'failed native append leaves no partial event, private row, version, or other change');
      }
    } else {
      for (const [table, value] of Object.entries(initial.contents)) {
        if (!claimTables.has(table)) assert.deepEqual(after.contents[table], value, table + ' unchanged by publication');
        else if (!['experience_guest_sessions', attemptTable].includes(table))
          for (const prior of value) assert.ok(after.contents[table].some(row => JSON.stringify(row) === JSON.stringify(prior)), table + ' original row preserved');
      }
      const claims = after.contents.experience_guest_image_result_custodies; assert.ok(claims.length <= 1);
      const sessions = initial.contents.experience_guest_sessions.map(value => Object.assign(Object.create(Object.getPrototypeOf(value)), value));
      if (claims.length) {
        const own = sessions.find(row => row.session_id === claims[0].session_id); assert.ok(own);
        assert.equal(own.revoked_at_ms, null); own.revoked_at_ms = claims[0].created_at_ms;
        assert.equal(claims[0].destination_user_id, claimOwner);
      }
      assert.deepEqual(after.contents.experience_guest_sessions, sessions, 'only exact original guest tombstone changes');
      const prior = initial.contents[attemptTable][0], current = after.contents[attemptTable][0];
      assert.equal(after.contents[attemptTable].length, 1);
      for (const column of copyContract.GUEST_IMAGE_RESULT_COPY_IMMUTABLE_COLUMNS) assert.equal(current[column], prior[column]);
    }
  }
  function close() {
    if (closed) return; closed = true;
    try { assert.equal(pending.size, 0, 'native storage settles before closing phase'); preserved(); }
    finally {
      f.DB.prepare = original.prepare; f.DB.batch = original.batch;
      for (const [method, descriptor] of blocked) { if (descriptor) Object.defineProperty(f.DB, method, descriptor); else delete f.DB[method]; }
      io.close();
    }
  }
  t.after(() => { assert.equal(closed, true, 'all fixture guards close before dependent writer'); assert.deepEqual(violations, []); });
  return { state, calls, statements, batches, close, preserved, count: kind => calls.filter(call => call.kind === kind).length,
    async settle() { await Promise.allSettled([...pending]); } };
}

function ownerRequest(value, { method = 'GET', body, headers = {}, query = '', signal } = {}) {
  return new Request(value.origin + '/api/generated-images/' + encodeURIComponent(value.outputId) + query, {
    method, headers: { origin: value.origin, 'oai-authenticated-user-id': value.ownerId,
      'oai-authenticated-user-email': value.ownerId + '@example.invalid', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }), ...(signal ? { signal } : {}),
  });
}
const commandFor = snapshot => ({ operation: 'adopt-claimed-local-source', claim: snapshot.claim,
  expectedRevision: snapshot.revision, expectedEditEventId: snapshot.editEventId, expectedMediaSha256: snapshot.media.sha256 });
async function freshCurrent(t, value) {
  const guard = phaseGuard(t, value.f, value.objects);
  try {
    const snapshot = await custody.readGuestImageResultCurrentSnapshot(ownerRequest(value), value.f.env, { outputId: value.outputId });
    assert.ok(snapshot); assert.equal(snapshot.status, 'current');
    assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 1);
    assert.ok(guard.statements.length <= 2186); return snapshot;
  } finally { await guard.settle(); guard.close(); }
}
async function adopt(t, value, command = commandFor(value.snapshot), requestOptions = {}, configureGuard) {
  const guard = phaseGuard(t, value.f, value.objects, { appendTypes: ['ReferenceIngested', 'BlockCreated'] });
  try {
    configureGuard?.(guard);
    const response = await custody.adoptGuestImageResultLocalSource(ownerRequest(value, { method: 'POST', body: command, ...requestOptions }), value.f.env, { outputId: value.outputId });
    const body = await response.json(); assert.ok(guard.statements.length <= 2397);
    return { response, body, calls: guard.calls, statements: guard.statements, batches: guard.batches };
  } finally { await guard.settle(); guard.close(); }
}

/** Actual source/Run -> reserve/copy -> atomic claim -> dormant owner POST ->
 * fresh owner current. options.adopt:false returns the genuine pre-adoption
 * current, never a manufactured positive local context. All guards are closed
 * on return; callers may install their own Save/Check guards without leakage. */
export async function claimedLocalAdoptionFixture(t, { adopt: shouldAdopt = true, ...options } = {}) {
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
  const privateEvent = rows(f, 'event_private_payloads').find(value => value.private_event_id === row.claim_event_id); assert.ok(privateEvent);
  const payload = JSON.parse(privateEvent.private_json), planner = lineage.resultCopies.find(value => value.role === 'planner');
  const plannerBody = rows(f, 'private_content').find(value => value.content_id === planner.content_id).content;
  f.controller.abort(); assert.equal(f.request.signal.aborted, true, 'retire original guest/copy Request');
  const value = { f, objects: writer.state.objects, row, lineage, attempt, canonical, payload, plannerBody, claimed,
    origin: new URL(f.request.url).origin, ownerId: claimOwner, outputId: row.output_id, adoption: null, snapshot: null };
  // Reviewed current-fixture preparation: current/adoption actions may neither
  // install schema nor create an epoch. This setup is outside their guards.
  const migration = readFileSync(new URL('../drizzle/0038_scene_source_generations.sql', import.meta.url), 'utf8');
  for (const sql of migration.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) f.sqlite.exec(sql);
  const preparation = guardInventory(f, t, { database: false, snapshotDatabase: false }), beforeEpoch = databaseSnapshot(f);
  try {
    const auth = await principal.readExistingPrincipalRequest(ownerRequest(value), f.env, 'creator', { account: 'principal' });
    assert.equal(Object.hasOwn(auth, 'kind'), false); assert.equal(Boolean(auth.response), false); assert.ok(auth.user);
    assert.equal(principal.requireConsent(auth.user), null); assert.equal(auth.user.userId, claimOwner);
    const authority = intakeAuthority.projectIntakeAuthority(f.env, { user: auth.user, principal: auth.user, impersonation: null },
      { projectId: lineage.copy.manifest.projectId, documentId: lineage.copy.manifest.documentId });
    const version = await sceneVersion.captureSceneSourceVersion(f.env, { streamId: auth.user.streamId }, [authority]);
    assert.equal(version.streamId, 'creative:' + claimOwner); assert.equal(version.epoch, 1);
    const afterEpoch = databaseSnapshot(f); assert.deepEqual(afterEpoch.schema, beforeEpoch.schema);
    for (const [table, data] of Object.entries(beforeEpoch.contents))
      if (table !== 'scene_source_epoch') assert.deepEqual(afterEpoch.contents[table], data, table + ' preserved by explicit epoch preparation');
    assert.equal(afterEpoch.contents.scene_source_epoch.length, 1);
  } finally { preparation.close(); }
  value.snapshot = await freshCurrent(t, value); assertOriginal(value, value.snapshot);
  assert.deepEqual(value.snapshot.sources, []); assert.deepEqual(value.snapshot.sourceIds, []);
  if (shouldAdopt) {
    const result = await adopt(t, value); assert.equal(result.response.status, 200); assert.equal(result.body.status, 'adopted');
    assert.deepEqual(result.calls.map(call => call.kind), ['get', 'head']);
    value.adoption = result.body; value.snapshot = await freshCurrent(t, value);
    assertOriginal(value, value.snapshot); assertAdopted(value);
  }
  return value;
}

function assertOriginal(value, current) {
  assert.equal(current.status, 'current'); assert.equal(current.ownerId, value.ownerId);
  assert.equal(current.projectId, value.f.session.projectId); assert.equal(current.documentId, value.f.session.documentId);
  assert.equal(current.outputId, value.outputId); assert.equal(current.generationId, value.row.generation_id);
  assert.equal(current.sourceEventId, value.row.claim_event_id); assert.equal(current.contentRef, value.payload.output_ref);
  assert.equal(current.rawJson, value.plannerBody); assert.equal(current.contentSha256, hash(value.plannerBody));
  assert.equal(current.revision, 0); assert.equal(current.editEventId, null); assert.deepEqual(current.claim, value.claimed.completedReview);
  const png = knownPngOracle(value.f.mediaOracle.bytes);
  assert.deepEqual(current.media, { url: value.payload.media_url, mediaType: 'image/png', sha256: png.sha256,
    width: png.width, height: png.height, byteLength: png.size });
  assert.equal(Object.hasOwn(current, 'sessionToken'), false); assert.equal(Object.hasOwn(current, 'claimToken'), false);
  assert.ok(Object.isFrozen(current)); assert.ok(Object.isFrozen(current.claim));
}
function assertAdopted(value) {
  const { adoption, snapshot: current } = value;
  assert.equal(current.head, adoption.head); assert.deepEqual(current.sourceIds, [adoption.sourceId]);
  assert.equal(current.sources.length, 1); const source = current.sources[0];
  assert.equal(source.id, adoption.sourceId); assert.equal(source.blockId, adoption.blockId);
  assert.equal(source.mediaUrl, current.media.url); assert.equal(source.contentHash, current.media.sha256);
  assert.equal(source.label, value.payload.title.trim().slice(0, 160).trim() || 'Image');
  assert.equal(Boolean(source.requiresUnlock), false);
  assertActualAdoptionPair(value, adoption);
}
function assertActualAdoptionPair(value, adoption) {
  assert.equal(adoption.sourceId, adoption.blockId + ':image');
  assert.deepEqual(adoption.appended.map(event => event.type), ['ReferenceIngested', 'BlockCreated']);
  const [receipt, block] = adoption.appended;
  assert.equal(receipt.sequence + 1, block.sequence); assert.equal(block.sequence, adoption.head);
  assert.equal(receipt.payload.reference_id, adoption.referenceId); assert.equal(block.payload.block_id, adoption.blockId);
  assert.equal(block.payload.properties.reference_id, adoption.referenceId);
  assert.equal(block.payload.properties.label, value.payload.title.trim().slice(0, 160).trim() || 'Image');
  assert.equal(receipt.payload.source_expires_at, value.payload.content_expires_at);
  assert.equal(block.payload.properties.source_expires_at, value.payload.content_expires_at);
  assert.equal(block.payload.properties.operation_scope, 'local-image-composition');
  assert.equal(block.payload.properties.pixel_reference_mode, 'context_only');
  assert.deepEqual(receipt.payload.claim, value.claimed.completedReview); assert.deepEqual(block.payload.properties.claim, value.claimed.completedReview);
  for (const event of adoption.appended) {
    const stored = rows(value.f, 'events').find(row => row.event_id === event.eventId); assert.ok(stored);
    assert.equal(stored.sequence, event.sequence); assert.equal(stored.stream_id, 'creative:' + value.ownerId);
    const personal = rows(value.f, 'event_private_payloads').find(row => row.private_event_id === event.eventId); assert.ok(personal);
    assert.equal(personal.owner_id, value.ownerId); assert.equal(personal.project_id, value.snapshot.projectId); assert.equal(personal.document_id, value.snapshot.documentId);
    assert.deepEqual(JSON.parse(personal.private_json), event.payload);
  }
  assert.deepEqual(rows(value.f, 'artifact_revisions'), [], 'context adoption is not an image edit');
}

if (directlyInvoked) {
  test('pure pair constructor trims whitespace at the 160-code-unit label boundary', async t => {
    const value = await claimedLocalAdoptionFixture(t, { adopt: false });
    const { rawJson, contentSha256, ...strictMetadata } = value.snapshot;
    assert.equal(rawJson, value.plannerBody);
    assert.equal(contentSha256, hash(rawJson));
    // This pure formatting input represents the body's absence explicitly.
    // It is never a strict edit snapshot or a native custody capability.
    const metadata = { ...strictMetadata, contentSha256: null };
    const plannerCopy = value.lineage.resultCopies.find(copy => copy.role === 'planner'); assert.ok(plannerCopy);
    assert.match(plannerCopy.original_digest, /^sha256:[a-f0-9]{64}$/u);
    const personal = rows(value.f, 'event_private_payloads').find(row => row.private_event_id === value.canonical.event_id); assert.ok(personal);
    const canonical = eventRead.serializeEvent({ ...value.canonical, private_json: personal.private_json });
    const title = 'A'.repeat(159) + ' moretitle';
    assert.equal(title[159], ' '); assert.ok(title.length > 160);
    const before = databaseSnapshot(value.f), beforeObjects = storedSnapshot(value.objects), beforeChanges = changes(value.f);
    const guard = guardInventory(value.f, t);
    try {
      // Formatting only: the deliberately supplied title is not the genuine
      // canonical title. These unused candidate IDs and returned pair are never
      // persisted, adopted, or presented as current custody/authority evidence.
      const input = {
        snapshot: metadata, title, canonical, retainedExpiresAt: value.payload.content_expires_at,
        ids: { referenceId: eventWrite.uuidV7(), blockId: eventWrite.uuidV7(), receiptEventId: eventWrite.uuidV7(),
          blockEventId: eventWrite.uuidV7(), correlationId: eventWrite.uuidV7() },
        occurredAt: new Date().toISOString(),
      };
      const pair = localAdoption.createGuestImageResultLocalAdoptionPair(input);
      assert.ok(pair); const label = pair.block.payload.properties.label;
      assert.equal(label, 'A'.repeat(159)); assert.equal(label, label.trim()); assert.ok(label.length <= 160);
      assert.equal(localAdoption.createGuestImageResultLocalAdoptionPair({ ...input,
        snapshot: { ...metadata, contentSha256: plannerCopy.original_digest.slice(7) } }), null,
      'original metadata refuses the canonical-digest alias in the raw-hash slot');
      assert.deepEqual(databaseSnapshot(value.f), before); assert.equal(changes(value.f), beforeChanges);
      assert.deepEqual(storedSnapshot(value.objects), beforeObjects);
    } finally { guard.close(); }
    assert.equal(value.adoption, null); assert.deepEqual(value.snapshot.sourceIds, []);
  });
  test('genuine original claim adopts one retained local source and fresh current reopens it', async t => {
    const value = await claimedLocalAdoptionFixture(t);
    assertAdopted(value); assert.equal(rows(value.f, 'experience_guest_image_result_custodies').length, 1);
  });
  test('fresh original adoption reuses its actual pair without a second append', async t => {
    const value = await claimedLocalAdoptionFixture(t), before = databaseSnapshot(value.f), count = changes(value.f);
    const result = await adopt(t, value);
    assert.equal(result.response.status, 200); assert.equal(result.body.status, 'reused'); assert.deepEqual(result.body.appended, []);
    assert.deepEqual(result.calls.map(call => call.kind), ['get', 'head']);
    for (const key of ['blockId', 'referenceId', 'sourceId', 'head']) assert.equal(result.body[key], value.adoption[key]);
    assert.deepEqual(databaseSnapshot(value.f), before); assert.equal(changes(value.f), count);
    assert.equal(result.statements.filter(statement => statement.inserted).length, 0);
    const current = await freshCurrent(t, value); assert.deepEqual(current, value.snapshot);
  });
  test('locking the genuinely adopted block reuses its IDs without silently unlocking it', async t => {
    const value = await claimedLocalAdoptionFixture(t), guard = phaseGuard(t, value.f, value.objects, { appendTypes: ['BlockLocked'], noMedia: true });
    try {
      const lock = eventWrite.makeEvent('creative:' + value.ownerId, value.snapshot.head + 1, 'user', 'fixture:explicit-block-lock', eventWrite.uuidV7(), 'BlockLocked', {
        project_id: value.snapshot.projectId, document_id: value.snapshot.documentId, block_id: value.adoption.blockId,
      });
      await eventAppend.appendEvents(value.f.env, [lock], { expectedHead: value.snapshot.head });
    } finally { await guard.settle(); guard.close(); }
    const locked = await freshCurrent(t, value);
    assert.equal(locked.sources.length, 1); assert.equal(locked.sources[0].requiresUnlock, true); assert.deepEqual(locked.sourceIds, []);
    const before = databaseSnapshot(value.f), result = await adopt(t, { ...value, snapshot: locked });
    assert.equal(result.response.status, 200); assert.equal(result.body.status, 'reused'); assert.deepEqual(result.body.appended, []);
    assert.deepEqual(result.calls.map(call => call.kind), ['get', 'head']);
    for (const key of ['blockId', 'referenceId', 'sourceId']) assert.equal(result.body[key], value.adoption[key]);
    assert.equal(result.body.head, locked.head); assert.deepEqual(databaseSnapshot(value.f), before);
    assert.deepEqual(await freshCurrent(t, value), locked);
  });
  test('first local adoption preserves genuine custody when the planner body has been explicitly redacted', async t => {
    const value = await claimedLocalAdoptionFixture(t, { adopt: false });
    const observedCommand = commandFor(value.snapshot), beforeRedaction = databaseSnapshot(value.f);
    // value.snapshot remains the genuine pre-redaction observation. It is used
    // only for the original command and unchanged scope, never as fresh current.
    const plannerId = value.snapshot.contentRef, redactedAt = new Date().toISOString();
    const plannerRows = rows(value.f, 'private_content').filter(row => row.content_id === plannerId && row.owner_id === value.ownerId);
    assert.equal(plannerRows.length, 1); assert.equal(plannerRows[0].content, value.plannerBody); assert.equal(plannerRows[0].redacted_at, null);
    // Named negative fixture state, before arming the adoption guard. The real
    // copy association, digest, expiry, canonical event and claim stay intact;
    // an empty redacted body is not replacement planner content or authority.
    const changed = value.f.sqlite.prepare('UPDATE private_content SET content=?,redacted_at=? WHERE content_id=? AND owner_id=?')
      .run('', redactedAt, plannerId, value.ownerId);
    assert.equal(Number(changed.changes), 1);
    const redacted = databaseSnapshot(value.f); assert.deepEqual(redacted.schema, beforeRedaction.schema);
    for (const [table, prior] of Object.entries(beforeRedaction.contents)) {
      const expected = table === 'private_content' ? prior.map(row => row.content_id === plannerId
        ? Object.assign(Object.create(Object.getPrototypeOf(row)), row, { content: '', redacted_at: redactedAt }) : row) : prior;
      assert.deepEqual(redacted.contents[table], expected, table + ' changed only by the explicit planner redaction');
    }
    const result = await adopt(t, value, observedCommand);
    assert.equal(result.response.status, 200); assert.equal(result.body.status, 'adopted');
    assert.deepEqual(result.calls.map(call => call.kind), ['get', 'head']); assertActualAdoptionPair(value, result.body);
    assert.equal(result.body.head, value.snapshot.head + 2);
    assert.ok(result.statements.every(statement => !/\b(?:FROM|JOIN)\s+private_content\b/iu.test(statement.sql)), 'adoption never reads the unavailable body table');
    assert.deepEqual(rows(value.f, 'private_content'), redacted.contents.private_content, 'adoption cannot restore or replace the redacted planner');
    const guard = phaseGuard(t, value.f, value.objects);
    try {
      const current = await custody.readGuestImageResultCurrentSnapshot(ownerRequest(value), value.f.env, { outputId: value.outputId });
      assert.equal(current, null, 'strict editor current still requires the actual planner body');
      assert.deepEqual(guard.calls, [], 'strict current refuses before PNG I/O');
    } finally { await guard.settle(); guard.close(); }
  });
  for (const [label, change] of [
    ['different full completed claim', command => ({ ...command, claim: { ...command.claim,
      lineageDigest: 'sha256:' + (command.claim.lineageDigest.endsWith('e'.repeat(64)) ? 'd' : 'e').repeat(64) } })],
    ['different well-formed revision and edit ID', command => ({ ...command, expectedRevision: 1, expectedEditEventId: eventWrite.uuidV7() })],
    ['different well-formed media hash', command => ({ ...command,
      expectedMediaSha256: (command.expectedMediaSha256 === 'e'.repeat(64) ? 'd' : 'e').repeat(64) })],
  ]) test('well-formed adoption command refuses changed current facts without appending: ' + label, async t => {
    const value = await claimedLocalAdoptionFixture(t, { adopt: false }), command = change(commandFor(value.snapshot));
    assert.ok(localAdoption.parseGuestImageResultLocalAdoptionCommand(command), 'the negative is a current-fact mismatch, not malformed wire data');
    const before = databaseSnapshot(value.f), count = changes(value.f), result = await adopt(t, value, command);
    assert.equal(result.response.status, 503); assert.deepEqual(result.body, { status: 'refused', code: 'unavailable' });
    assert.deepEqual(result.calls, []); assert.equal(result.statements.filter(statement => statement.inserted).length, 0);
    assert.deepEqual(databaseSnapshot(value.f), before); assert.equal(changes(value.f), count);
    assert.deepEqual(await freshCurrent(t, value), value.snapshot);
  });
  for (const fault of ['second-stage', 'trailing-proof']) test('a real native ' + fault + ' failure rolls back the whole adoption pair', async t => {
    const value = await claimedLocalAdoptionFixture(t, { adopt: false }), before = databaseSnapshot(value.f);
    const result = await adopt(t, value, commandFor(value.snapshot), {}, guard => { guard.state.batchFault = fault; });
    assert.equal(result.response.status, 200); assert.deepEqual(result.body, { status: 'unconfirmed', code: 'unconfirmed' });
    assert.deepEqual(result.calls.map(call => call.kind), ['get', 'head']);
    const attempts = result.batches.filter(batch => batch.publication); assert.equal(attempts.length, 1);
    const batch = attempts[0]; assert.equal(batch.failed, true); assert.equal(batch.completed, false); assert.equal(batch.injectedFault, fault);
    assert.match(batch.error, fault === 'second-stage' ? /constraint/iu : /malformed JSON/iu);
    assert.equal(result.statements.filter(statement => statement.inserted === 'event_write_stage').length, 2);
    assert.equal(result.statements.length, batch.statementEnd, 'uncertain native result does not trigger an autonomous readback or retry');
    assert.deepEqual(databaseSnapshot(value.f), before, 'no event/private pair, staged residue, or version increment survives rollback');
    assert.deepEqual(await freshCurrent(t, value), value.snapshot);
  });
  for (const fault of ['throw-after-commit', 'zero-stage-changes', 'accessor-readback']) test('uncertain adoption ' + fault + ' returns unconfirmed and a fresh command reuses the actual committed pair', async t => {
    const value = await claimedLocalAdoptionFixture(t, { adopt: false }), observedCommand = commandFor(value.snapshot);
    const beforeIds = new Set(rows(value.f, 'events').map(row => row.event_id)); let accessorCalls = 0;
    const first = await adopt(t, value, observedCommand, {}, guard => {
      guard.state.batchTransform = (result, { items, publication }) => {
        if (!publication) return result;
        if (fault === 'throw-after-commit') throw Error('fixture lost settled adoption ACK');
        if (fault === 'zero-stage-changes') return result.map((item, index) => /^\s*INSERT INTO event_write_stage\b/u.test(items[index].sql)
          ? { ...item, meta: { ...item.meta, changes: 0 } } : item);
        const last = { ...result.at(-1) };
        Object.defineProperty(last, 'results', { enumerable: true, get() { accessorCalls++; return []; } });
        return [...result.slice(0, -1), last];
      };
    });
    assert.equal(first.response.status, 200); assert.deepEqual(first.body, { status: 'unconfirmed', code: 'unconfirmed' });
    assert.equal(accessorCalls, 0); assert.deepEqual(first.calls.map(call => call.kind), ['get', 'head']);
    const attempts = first.batches.filter(batch => batch.publication); assert.equal(attempts.length, 1);
    assert.equal(attempts[0].completed, true); assert.equal(attempts[0].failed, false);
    assert.equal(first.statements.length, attempts[0].statementEnd, 'lost or malformed ACK ends this action without an autonomous readback');
    // Discover IDs only from the actual settled native rows. No candidate or
    // fabricated acknowledgment can supply the expected recovery identity.
    const added = rows(value.f, 'events').filter(row => !beforeIds.has(row.event_id)).sort((a, b) => a.sequence - b.sequence);
    assert.deepEqual(added.map(row => row.type), ['ReferenceIngested', 'BlockCreated']);
    const actual = added.map(row => {
      const personal = rows(value.f, 'event_private_payloads').find(secret => secret.private_event_id === row.event_id); assert.ok(personal);
      assert.equal(personal.owner_id, value.ownerId); assert.equal(personal.redacted_at, null);
      return eventRead.serializeEvent({ ...row, private_json: personal.private_json });
    });
    const [receipt, block] = actual, beforeReuse = databaseSnapshot(value.f), count = changes(value.f);
    assert.equal(receipt.sequence, value.snapshot.head + 1); assert.equal(block.sequence, value.snapshot.head + 2);
    assert.equal(block.payload.properties.reference_id, receipt.payload.reference_id);
    assert.deepEqual(receipt.payload.claim, observedCommand.claim); assert.deepEqual(block.payload.properties.claim, observedCommand.claim);
    const retry = await adopt(t, value, observedCommand);
    assert.equal(retry.response.status, 200); assert.equal(retry.body.status, 'reused'); assert.deepEqual(retry.body.appended, []);
    assert.equal(retry.body.blockId, block.payload.block_id); assert.equal(retry.body.referenceId, receipt.payload.reference_id);
    assert.equal(retry.body.sourceId, block.payload.block_id + ':image'); assert.equal(retry.body.head, block.sequence);
    assert.deepEqual(retry.calls.map(call => call.kind), ['get', 'head']);
    assert.equal(retry.statements.filter(statement => statement.inserted).length, 0);
    assert.deepEqual(databaseSnapshot(value.f), beforeReuse); assert.equal(changes(value.f), count);
    const current = await freshCurrent(t, value); assertOriginal(value, current);
    assert.equal(current.head, block.sequence); assert.deepEqual(current.sourceIds, [retry.body.sourceId]);
  });
  for (const [label, change] of [
    ['extra command field', command => ({ ...command, activate: true })],
    ['invalid expected revision', command => ({ ...command, expectedRevision: -1 })],
    ['non-null original edit ID', command => ({ ...command, expectedEditEventId: '01900000-0000-7000-8000-000000000001' })],
    ['malformed media hash', command => ({ ...command, expectedMediaSha256: 'not-a-sha256' })],
    ['incomplete completed claim', command => ({ ...command, claim: { custodyId: command.claim.custodyId } })],
  ]) test('malformed adoption command refuses before custody/media I/O: ' + label, async t => {
    const value = await claimedLocalAdoptionFixture(t, { adopt: false });
    const result = await adopt(t, value, change(commandFor(value.snapshot)));
    assert.equal(result.response.status, 400); assert.deepEqual(result.body, { status: 'refused', code: 'invalid_request' });
    assert.deepEqual(result.calls, []); assert.equal(result.statements.length, 0);
    assert.deepEqual((await freshCurrent(t, value)).sources, []);
  });
}
