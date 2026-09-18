import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test as nativeTest } from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { claimedLocalAdoptionFixture } from './generated-image-claimed-local-adoption.test.mjs';
import { snapshot, rows, deferred } from './helpers/guest-image-result-media-fixture.mjs';
import { guardInventory } from './helpers/guest-image-result-inventory-fixture.mjs';
import { png } from './output-asset-fixtures.mjs';

// SOURCE-AUTHORED ONLY. Execute only after the genuine upstream copy/claim and
// adoption suppliers are qualified together in this checkout. This imports no
// sibling checkout, extracted source, invented local pair or fake authority.
const [custody, composition, revision, edit, eventWrite, eventAppend, mediaApi, ownership] = await Promise.all([
  import('../worker/experience-guest-image-result-custody.ts'),
  import('../src/model/reference-composition.ts'),
  import('../src/model/generated-image-revision.ts'),
  import('../worker/generated-image-claimed-edit.ts'),
  import('../worker/event-write-primitives.ts'),
  import('../worker/event-append.ts'),
  import('../worker/media-api.ts'),
  import('../src/model/media-ownership.ts'),
]);
const closes = new WeakMap();
const test = (name, run) => nativeTest(name, { concurrency: false, timeout: 30000 }, async t => {
  const owned = []; closes.set(t, owned);
  try { await run(t); } finally { for (const close of owned.reverse()) await close(); }
});
const hash = value => createHash('sha256').update(value).digest('hex');
const finite = async (promise, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('fixture boundary not reached: ' + label)), 5000); })]); }
  finally { clearTimeout(timer); }
};
const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu;
const stage = /^\s*INSERT INTO event_write_stage\s*\(/u;
const metadataKeys = ['ownerId', 'custodyId', 'outputId', 'generationId', 'claimEventId', 'lineageDigest', 'revisionId',
  'editEventId', 'revisionSha256', 'operationSha256', 'sha256', 'mimeType', 'model', 'source'];
const rowKeys = ['revision_id', 'owner_id', 'organization_id', 'project_access_id', 'project_id', 'document_id', 'artifact_id',
  'revision', 'content_json', 'content_sha256', 'created_by_user_id', 'created_at', 'expires_at', 'redacted_at'];
const objectsSnapshot = objects => [...objects].map(([key, value]) => ({ key, ...value,
  bytes: Buffer.from(value.bytes).toString('base64'), metadata: structuredClone(value.metadata) }));
const receiver = new WeakMap();
class EditObject {
  constructor(raw, state) { receiver.set(this, { raw, state }); }
  get key() { return receiver.get(this).raw.key; }
  get version() { return receiver.get(this).raw.version; }
  get size() { return receiver.get(this).raw.size; }
  get etag() { return receiver.get(this).raw.etag; }
  get httpEtag() { return receiver.get(this).raw.httpEtag; }
  get uploaded() { return receiver.get(this).raw.uploaded; }
  get customMetadata() { return receiver.get(this).raw.metadata; }
  get httpMetadata() { return receiver.get(this).raw.httpMetadata; }
  writeHttpMetadata(headers) {
    const value = receiver.get(this); assert.ok(value, 'native metadata receiver');
    value.state.metadataCalls++; headers.set('content-type', value.raw.httpMetadata.contentType);
  }
}
class EditBody extends EditObject { get body() { return receiver.get(this).raw.body; } }

/** Own one fresh action phase. Positive state comes only from actual producer
 * calls; hooks alter observations/ACKs or explicit negative fixture state. */
function writerGuard(t, value, { writes = true, actions = 1, appendTypes = null, putMode = writes && !appendTypes ? 'edit' : 'none' } = {}) {
  const { f, objects } = value, io = guardInventory(f, t, { database: false, snapshotDatabase: false });
  const original = { prepare: f.DB.prepare, batch: f.DB.batch }, handles = new WeakMap(), active = new WeakMap();
  const blocked = new Map(['exec', 'dump'].map(key => [key, Object.getOwnPropertyDescriptor(f.DB, key)]));
  const initial = snapshot(f), originalObjects = objectsSnapshot(objects), violations = [], statements = [], calls = [], batches = [], pending = new Set();
  const state = { beforeBatch: null, batchTransform: null, beforeGet: null, beforeHead: null, getTransform: null, headTransform: null,
    beforePut: null, putResult: undefined, metadataCalls: 0, streamReads: 0, streams: [], putBuffers: [], publicationBatches: 0,
    fixtureMutations: [], failFirstTrailingProof: false, expected: initial, expectedObjects: originalObjects };
  let closed = false;
  const deny = message => { violations.push(message); throw Error('claimed writer fixture blocked ' + message); };
  const conform = fn => { try { return fn(); } catch (error) { violations.push(String(error)); throw error; } };
  const settle = promise => { pending.add(promise); void promise.finally(() => pending.delete(promise)).catch(() => undefined); return promise; };
  function qualify(sql, bindings, method) {
    conform(() => {
      assert.equal(typeof sql, 'string'); assert.ok(Buffer.byteLength(sql) <= 100000); assert.ok(bindings.length <= 100);
      const inserted = /^\s*INSERT INTO ([a-z_]+)\s*\(/u.exec(sql)?.[1];
      if (inserted) {
        assert.equal(writes, true, 'read-only phase cannot mutate'); assert.equal(method, 'batch');
        assert.ok((appendTypes ? ['event_write_stage'] : ['event_write_stage', 'artifact_revisions']).includes(inserted));
        if (appendTypes) assert.ok(appendTypes.includes(bindings[11]), 'only this native ingress phase\'s event types');
        assert.doesNotMatch(sql, /;|--|\/\*/u); assert.equal([...sql.matchAll(new RegExp(mutation.source, 'giu'))].length, 1);
      } else { assert.match(sql, /^\s*(?:SELECT|WITH)\b/iu); assert.doesNotMatch(sql, mutation); }
      statements.push({ sql, bindings: [...bindings], method, inserted }); assert.ok(statements.length <= 4795 * actions);
    });
  }
  function wrap(statement, sql, bindings = []) {
    handles.set(statement, { sql, bindings }); const bind = statement.bind, execute = statement.execute;
    if (typeof execute === 'function') statement.execute = function (...args) {
      if (!active.get(this)) return deny('Statement.execute outside observed call'); return execute.apply(this, args);
    };
    if (typeof statement.raw === 'function') statement.raw = () => deny('Statement.raw');
    statement.bind = function (...args) { return wrap(bind.apply(this, args), sql, args); };
    for (const method of ['first', 'all', 'run']) {
      const perform = statement[method]; if (typeof perform !== 'function') continue;
      statement[method] = function (...args) {
        if (method === 'run') return deny('Statement.run outside batch'); qualify(sql, bindings, method);
        active.set(this, (active.get(this) ?? 0) + 1);
        try { return perform.apply(this, args); } finally { active.set(this, active.get(this) - 1); }
      };
    }
    return statement;
  }
  f.DB.prepare = function (sql) { return wrap(original.prepare.call(this, sql), sql); };
  f.DB.batch = async function (prepared) {
    conform(() => { assert.ok(Array.isArray(prepared)); assert.ok(prepared.length > 0 && prepared.length <= 423); });
    const items = prepared.map(item => { const found = handles.get(item); if (!found) return deny('unknown batch handle');
      qualify(found.sql, found.bindings, 'batch'); return found; });
    const publication = items.some(item => stage.test(item.sql));
    const record = { items, publication, completed: false, failed: false }; batches.push(record);
    if (publication) conform(() => {
      state.publicationBatches++; assert.ok(state.publicationBatches <= actions);
      if (appendTypes) {
        assert.deepEqual(items.filter(item => stage.test(item.sql)).map(item => item.bindings[11]), appendTypes);
        assert.equal(items.filter(item => /^\s*INSERT INTO artifact_revisions\(/u.test(item.sql)).length, 0);
      } else {
        assert.equal(items.filter(item => stage.test(item.sql)).length, 1);
        assert.ok([1, 2].includes(items.filter(item => /^\s*INSERT INTO artifact_revisions\(/u.test(item.sql)).length));
        assert.ok(items[0].sql.startsWith('SELECT CASE WHEN ')); assert.ok(items.at(-1).sql.startsWith('SELECT CASE WHEN '));
      }
    });
    await state.beforeBatch?.({ prepared, items, publication, record });
    let actual = prepared;
    if (publication && state.failFirstTrailingProof) {
      const lastWrite = items.findLastIndex(item => /^\s*INSERT INTO /u.test(item.sql));
      conform(() => { assert.ok(lastWrite > 0 && lastWrite + 1 < items.length); assert.ok(items[lastWrite + 1].sql.startsWith('SELECT CASE WHEN ')); });
      // Explicit negative injection only: replace one existing trailing proof
      // with a real throwing SQLite assertion inside this same native batch.
      // No positive event, row, ACK, capability or storage receipt is seeded.
      actual = [...prepared]; actual[lastWrite + 1] = original.prepare.call(this, "SELECT CASE WHEN 0 THEN 1 ELSE json('fixture_trailing_failure') END AS current");
      record.injectedFault = 'throwing-first-trailing-proof';
    }
    actual.forEach(item => active.set(item, (active.get(item) ?? 0) + 1));
    let result;
    try { result = await original.batch.call(this, actual); record.completed = true; }
    catch (error) { record.failed = true; record.error = String(error); throw error; }
    finally { actual.forEach(item => active.set(item, active.get(item) - 1)); }
    return state.batchTransform ? state.batchTransform(result, { items, publication, record }) : result;
  };
  for (const name of blocked.keys()) Object.defineProperty(f.DB, name, { configurable: true, writable: true, value: () => deny('DB.' + name) });
  function call(kind, key, options) {
    conform(() => {
      assert.equal(options, undefined); assert.ok(objects.has(key), 'only genuinely stored exact media');
      calls.push({ kind, key }); assert.ok(calls.length <= 18 * actions);
    });
    return objects.get(key);
  }
  f.env.MEDIA.get = function (key, options) {
    conform(() => assert.equal(this, f.env.MEDIA)); const stored = call('get', key, options), ordinal = calls.filter(call => call.kind === 'get').length;
    return settle((async () => {
      await state.beforeGet?.({ key, ordinal });
      const observation = { ...stored, bytes: stored.bytes.slice(), metadata: { ...stored.metadata }, httpMetadata: { ...stored.httpMetadata } };
      const raw = state.getTransform ? state.getTransform(observation, { key, ordinal }) : observation;
      const stream = { key, reads: 0, chunks: 0, eof: false, cancelled: false }; state.streams.push(stream);
      conform(() => assert.ok(state.streams.length <= 15 * actions)); let offset = 0;
      const body = new ReadableStream({ pull(controller) {
        stream.reads++; state.streamReads++; conform(() => assert.ok(stream.reads <= 65537));
        if (offset === raw.bytes.length) { stream.eof = true; controller.close(); return; }
        const chunk = raw.bytes.slice(offset, Math.min(offset + 4096, raw.bytes.length)); offset += chunk.length; stream.chunks++; controller.enqueue(chunk);
      }, cancel() { stream.cancelled = true; } }, { highWaterMark: 0 });
      return new EditBody({ ...raw, body }, state);
    })());
  };
  f.env.MEDIA.head = function (key, options) {
    conform(() => assert.equal(this, f.env.MEDIA)); const stored = call('head', key, options), ordinal = calls.filter(call => call.kind === 'head').length;
    return settle((async () => {
      await state.beforeHead?.({ key, ordinal });
      const raw = { ...stored, metadata: { ...stored.metadata }, httpMetadata: { ...stored.httpMetadata } };
      return new EditObject(state.headTransform ? state.headTransform(raw, { key, ordinal }) : raw, state);
    })());
  };
  f.env.MEDIA.put = function (key, buffer, options) {
    conform(() => {
      assert.equal(this, f.env.MEDIA); assert.ok(['edit', 'upload'].includes(putMode)); assert.ok(buffer instanceof ArrayBuffer);
      assert.ok(!objects.has(key)); assert.equal(calls.filter(call => call.kind === 'put').length < actions, true);
      if (putMode === 'upload') {
        assert.deepEqual(Object.keys(options).sort(), ['customMetadata', 'httpMetadata']);
        assert.deepEqual(options.httpMetadata, { contentType: 'image/png' });
        assert.deepEqual(Object.keys(options.customMetadata).sort(), ['mimeType', 'originalName', 'ownerId', 'rights', 'sha256', 'uploadedBy']);
        assert.equal(options.customMetadata.ownerId, value.ownerId); assert.equal(options.customMetadata.uploadedBy, value.ownerId);
        assert.equal(options.customMetadata.originalName, 'claimed-editor-ordinary.png'); assert.equal(options.customMetadata.rights, 'asserted');
        assert.equal(options.customMetadata.mimeType, 'image/png');
        assert.ok(key.startsWith(ownership.ownerMediaNamespace(value.ownerId) + '/'));
        assert.ok(key.endsWith('-claimed-editor-ordinary.png'));
      } else {
      assert.deepEqual(Object.keys(options).sort(), ['customMetadata', 'httpMetadata', 'onlyIf']);
      assert.deepEqual(options.onlyIf, { etagDoesNotMatch: '*' }); assert.deepEqual(options.httpMetadata, { contentType: 'image/png' });
      assert.deepEqual(Object.keys(options.customMetadata).sort(), [...metadataKeys].sort());
      assert.equal(options.customMetadata.ownerId, value.ownerId); assert.equal(options.customMetadata.custodyId, value.row.custody_id);
      assert.equal(options.customMetadata.outputId, value.outputId); assert.equal(options.customMetadata.claimEventId, value.row.claim_event_id);
      assert.equal(options.customMetadata.lineageDigest, value.claimed.completedReview.lineageDigest);
      assert.equal(options.customMetadata.mimeType, 'image/png'); assert.equal(options.customMetadata.model, 'authored-composition');
      assert.equal(options.customMetadata.source, 'generated-image-editor');
      assert.ok(key.endsWith('/revisions/' + options.customMetadata.revisionId + '.png'));
      }
      assert.equal(hash(new Uint8Array(buffer)), options.customMetadata.sha256);
      calls.push({ kind: 'put', key }); assert.ok(calls.length <= 18 * actions);
    });
    state.putBuffers.push(buffer);
    return settle((async () => {
      await state.beforePut?.({ key, buffer, options });
      if (state.putResult !== undefined) return state.putResult;
      const bytes = new Uint8Array(buffer).slice(), digest = hash(bytes), raw = { key, bytes, size: bytes.length,
        version: putMode + '-native-version-' + (options.customMetadata.revisionId ?? hash(key)), etag: digest, httpEtag: '"' + digest + '"',
        uploaded: new Date(), metadata: { ...options.customMetadata }, httpMetadata: { ...options.httpMetadata } };
      objects.set(key, raw); return new EditObject(raw, state);
    })());
  };
  function preserved() {
    assert.deepEqual(violations, []); io.assertUntouched();
    const after = snapshot(f); assert.deepEqual(after.schema, state.expected.schema);
    const mutable = new Set(['events', 'event_private_payloads', ...(!appendTypes ? ['artifact_revisions'] : []), 'scene_source_generations']);
    for (const [table, prior] of Object.entries(state.expected.contents)) {
      if (!mutable.has(table) || !writes) assert.deepEqual(after.contents[table], prior, table + ' unchanged');
      else if (table !== 'scene_source_generations') for (const row of prior)
        assert.ok(after.contents[table].some(value => JSON.stringify(value) === JSON.stringify(row)), table + ' original row preserved');
    }
    for (const row of state.expectedObjects) {
      const actual = objectsSnapshot(objects).find(value => value.key === row.key); assert.deepEqual(actual, row, 'original stored object unchanged');
    }
    if (!writes && putMode !== 'upload') assert.deepEqual(objectsSnapshot(objects), state.expectedObjects);
    if (putMode === 'upload') assert.equal(objects.size, state.expectedObjects.length + calls.filter(call => call.kind === 'put').length);
    if (appendTypes) {
      const oldIds = new Set(state.expected.contents.events.map(row => row.event_id));
      const added = after.contents.events.filter(row => !oldIds.has(row.event_id));
      assert.deepEqual(added.map(row => row.type), appendTypes);
      const oldPrivateIds = new Set(state.expected.contents.event_private_payloads.map(row => row.private_event_id));
      const addedPrivate = after.contents.event_private_payloads.filter(row => !oldPrivateIds.has(row.private_event_id));
      assert.deepEqual(addedPrivate.map(row => row.private_event_id).sort(), added.map(row => row.event_id).sort());
      assert.ok(added.every(row => row.stream_id === 'creative:' + value.ownerId));
      assert.ok(addedPrivate.every(row => row.owner_id === value.ownerId && row.redacted_at === null));
      const priorVersions = state.expected.contents.scene_source_generations, streamKey = 'creative:' + value.ownerId;
      assert.ok(priorVersions.some(row => row.scope_kind === 'stream' && row.scope_key === streamKey));
      assert.deepEqual(after.contents.scene_source_generations, priorVersions.map(row => row.scope_kind === 'stream' && row.scope_key === streamKey
        ? Object.assign(Object.create(Object.getPrototypeOf(row)), row, { generation: row.generation + 2 * appendTypes.length }) : row));
    }
  }
  const close = async () => {
    if (closed) return; closed = true;
    try { assert.equal(pending.size, 0, 'actual native work settled before phase teardown'); preserved(); }
    finally {
      f.DB.prepare = original.prepare; f.DB.batch = original.batch;
      for (const [name, descriptor] of blocked) { if (descriptor) Object.defineProperty(f.DB, name, descriptor); else delete f.DB[name]; }
      io.close();
    }
  };
  closes.get(t).push(close); t.after(() => { assert.equal(closed, true); assert.deepEqual(violations, []); });
  return { state, initial, calls, statements, batches, close, preserved, count: kind => calls.filter(call => call.kind === kind).length,
    settle: () => Promise.allSettled([...pending]),
    fixtureMutation(label, operation) { state.fixtureMutations.push(label); operation(); state.expected = snapshot(f); state.expectedObjects = objectsSnapshot(objects); } };
}

function fresh(t, value, { method = 'GET', operation, body, headers = {}, signal } = {}) {
  const controller = new AbortController(); closes.get(t).push(async () => controller.abort());
  return { controller, request: new Request(value.origin + '/api/generated-images/' + value.outputId
    + (operation ? '?operationSha256=' + operation : ''), { method, headers: { origin: value.origin,
      'oai-authenticated-user-id': value.ownerId, 'oai-authenticated-user-email': value.ownerId + '@example.invalid', ...headers }, body,
      signal: signal ?? controller.signal }) };
}
function editIntent(value, { result = png({ width: 1536, height: 864 }), alter } = {}) {
  const current = value.snapshot; assert.equal(current.status, 'current'); assert.ok(current.sourceIds.length > 0);
  const sourceId = current.sourceIds[0], source = current.sources.find(source => source.id === sourceId); assert.ok(source); assert.notEqual(source.requiresUnlock, true);
  const recipe = composition.addReferenceCompositionLayer(composition.createReferenceComposition('16:9'), source, 'fixture-layer');
  const normalized = composition.normalizeReferenceComposition(recipe); assert.ok(normalized);
  const request = { expectedRevision: current.revision, expectedEditEventId: current.editEventId, expectedContentSha256: current.contentSha256,
    generationId: current.generationId, sourceEventId: current.sourceEventId, contentRef: current.contentRef,
    sourceMediaUrl: current.media.url, sourceMediaSha256: current.media.sha256, sourceId, recipe: normalized,
    resultMediaSha256: hash(result), resultByteLength: result.length, schemaVersion: 2, claim: current.claim };
  alter?.(request); const parsed = revision.parseGuestImageResultEditRequest(request);
  const operationSha256 = parsed ? hash(JSON.stringify({ domain: 'guest-image-result-edit@1', ownerId: current.ownerId,
    projectId: current.projectId, documentId: current.documentId, outputId: current.outputId, request: parsed })) : null;
  return { request, result, operationSha256, form(extra) { const form = new FormData(); form.append('request', JSON.stringify(request));
    form.append('png', new File([result], 'image.png', { type: 'image/png' })); extra?.(form); return form; } };
}
const save = async (t, value, intent, options = {}) => {
  const action = fresh(t, value, { method: 'PATCH', body: intent.form(options.extra), ...options });
  const response = await custody.handleGuestImageResultEdit(action.request, value.f.env, { outputId: value.outputId });
  return { ...action, response, body: await response.json() };
};
const check = async (t, value, operation) => {
  const action = fresh(t, value, { operation });
  const response = await custody.handleGuestImageResultEdit(action.request, value.f.env, { outputId: value.outputId });
  return { ...action, response, body: await response.json() };
};
async function currentValue(t, value) {
  const guard = writerGuard(t, value, { writes: false });
  try {
    const action = fresh(t, value), current = await custody.readGuestImageResultCurrentSnapshot(action.request, value.f.env, { outputId: value.outputId });
    assert.ok(current); assert.equal(current.status, 'current'); assert.deepEqual(current.claim, value.claimed.completedReview);
    assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 1); assert.equal(guard.count('put'), 0);
    assert.ok(guard.statements.length <= 2186); return { ...value, snapshot: current };
  } finally { await guard.settle(); await guard.close(); }
}
async function appendNativeFixtureEvents(t, value, specifications) {
  const streamId = 'creative:' + value.ownerId, old = rows(value.f, 'events');
  const head = Math.max(0, ...old.filter(row => row.stream_id === streamId).map(row => row.sequence));
  const events = specifications.map(([type, payload], index) => eventWrite.makeEvent(streamId, head + index + 1,
    'user', 'fixture:native-reference-ingress', eventWrite.uuidV7(), type,
    { project_id: value.snapshot.projectId, document_id: value.snapshot.documentId, ...payload }));
  assert.equal(new Set(events.map(event => event.eventId)).size, events.length);
  assert.ok(events.every(event => !old.some(row => row.event_id === event.eventId)));
  const guard = writerGuard(t, value, { appendTypes: events.map(event => event.type) });
  try {
    assert.deepEqual(await eventAppend.appendEvents(value.f.env, events, { expectedHead: head }), events);
    assert.equal(guard.calls.length, 0); assert.equal(guard.state.publicationBatches, 1);
    for (const event of events) {
      const stored = rows(value.f, 'events').find(row => row.event_id === event.eventId); assert.ok(stored);
      const privateRow = rows(value.f, 'event_private_payloads').find(row => row.private_event_id === event.eventId); assert.ok(privateRow);
      assert.equal(stored.stream_id, streamId); assert.equal(stored.sequence, event.sequence);
      assert.equal(privateRow.owner_id, value.ownerId); assert.equal(privateRow.project_id, value.snapshot.projectId);
      assert.equal(privateRow.document_id, value.snapshot.documentId); assert.deepEqual(JSON.parse(privateRow.private_json), event.payload);
    }
    return events;
  } finally { await guard.settle(); await guard.close(); }
}
async function adoptCurrentRevision(t, value) {
  const guard = writerGuard(t, value, { appendTypes: ['ReferenceIngested', 'BlockCreated'] });
  let primaryError, result, failed = false;
  try {
    const current = value.snapshot, command = { operation: 'adopt-claimed-local-source', claim: current.claim,
      expectedRevision: current.revision, expectedEditEventId: current.editEventId, expectedMediaSha256: current.media.sha256 };
    const action = fresh(t, value, { method: 'POST', body: JSON.stringify(command), headers: { 'content-type': 'application/json' } });
    const response = await custody.adoptGuestImageResultLocalSource(action.request, value.f.env, { outputId: value.outputId }), body = await response.json();
    const reply = JSON.stringify({ status: body.status, code: body.code });
    assert.equal(response.status, 200, reply); assert.equal(body.status, 'adopted', reply); assert.equal(body.head, current.head + 2);
    assert.deepEqual(body.appended.map(event => event.type), ['ReferenceIngested', 'BlockCreated']);
    assert.equal(body.appended[0].payload.source_revision, current.revision);
    assert.equal(body.appended[0].payload.source_edit_event_id, current.editEventId);
    assert.equal(body.appended[0].payload.media_url, current.media.url); assert.deepEqual(body.appended[0].payload.claim, current.claim);
    assert.deepEqual(guard.calls.map(call => call.kind), ['get', 'head']);
    assert.ok(guard.statements.length <= 2397); assert.ok(guard.batches.every(batch => batch.items.length <= 421));
    result = body;
  } catch (error) { failed = true; primaryError = error; }
  const cleanupErrors = [];
  try { await guard.settle(); } catch (error) { cleanupErrors.push(error); }
  try { await guard.close(); } catch (error) { cleanupErrors.push(error); }
  if (failed && cleanupErrors.length) throw new AggregateError([primaryError, ...cleanupErrors],
    'Current revision adoption and strict cleanup both failed');
  if (failed) throw primaryError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'Current revision adoption strict cleanup failed');
  return result;
}
function assertSaved(value, intent, result, guard) {
  assert.equal(result.response.status, 200); assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.equal(result.body.status, 'saved'); assert.equal(result.body.operationSha256, intent.operationSha256);
  const nextRevision = value.snapshot.revision + 1;
  assert.equal(result.body.stillCurrent, true); assert.equal(result.body.currentRevision, nextRevision);
  const record = result.body.imageRevision; assert.equal(record.schemaVersion, 2); assert.deepEqual(record.claim, value.snapshot.claim);
  assert.equal(record.revision, nextRevision); assert.equal(record.source.revision, value.snapshot.revision);
  assert.equal(record.source.eventId, value.snapshot.editEventId ?? value.row.claim_event_id); assert.equal(record.source.mediaUrl, value.snapshot.media.url);
  assert.equal(record.source.sha256, value.snapshot.media.sha256); assert.equal(record.contentRef, value.snapshot.contentRef);
  assert.equal(record.contentSha256, value.snapshot.contentSha256); assert.equal(record.recipeSha256, hash(JSON.stringify(intent.request.recipe)));
  const revisions = rows(value.f, 'artifact_revisions').filter(row => row.owner_id === value.ownerId && row.artifact_id.startsWith('generated-image/'));
  assert.equal(revisions.length, nextRevision + 1); assert.deepEqual(revisions.map(row => row.revision).sort((a, b) => a - b), Array.from({ length: nextRevision + 1 }, (_, i) => i));
  for (const row of revisions) {
    assert.deepEqual(Object.keys(row).sort(), [...rowKeys].sort()); assert.equal(row.project_id, value.snapshot.projectId);
    assert.equal(row.document_id, value.snapshot.documentId); assert.equal(row.organization_id, null); assert.equal(row.project_access_id, null);
    assert.equal(row.redacted_at, null); assert.equal(row.content_sha256, hash(row.content_json));
    assert.ok(row.expires_at > row.created_at); assert.ok(row.expires_at <= value.lineage.canonical.expiresAt);
  }
  const row = revisions.find(row => row.revision === nextRevision), envelope = JSON.parse(row.content_json);
  assert.deepEqual(envelope.imageRevision, record); assert.deepEqual(envelope.request, intent.request);
  assert.deepEqual(JSON.parse(revisions.find(row => row.revision === 0).content_json).imageRevision, null);
  assert.ok(record.media.url.endsWith(encodeURIComponent('/revisions/' + row.revision_id + '.png')));
  assert.equal(row.created_at, result.body.appended[0].recordedAt); assert.equal(result.body.appended[0].eventId, record.editEventId);
  assert.equal(result.body.head, value.snapshot.head + 1); assert.equal(rows(value.f, 'event_write_stage').length, 0);
  const extras = intent.request.recipe.sources.filter(source => source.id !== intent.request.sourceId).length;
  assert.equal(guard.count('put'), 1); assert.equal(guard.count('get'), 3 + extras); assert.equal(guard.count('head'), 3);
  assert.equal(guard.state.publicationBatches, 1); assert.ok(guard.batches.find(batch => batch.publication).completed);
  assert.deepEqual(new Uint8Array(value.objects.get(decodeURIComponent(record.media.url.slice(11))).bytes), intent.result);
  const previousVersions = guard.initial.contents.scene_source_generations;
  const streamKey = 'creative:' + value.ownerId, previousVersion = previousVersions.find(row => row.scope_kind === 'stream' && row.scope_key === streamKey);
  assert.ok(previousVersion);
  assert.deepEqual(rows(value.f, 'scene_source_generations'), previousVersions.map(row => row === previousVersion
    ? Object.assign(Object.create(Object.getPrototypeOf(row)), row, { generation: row.generation + 2 }) : row));
  guard.preserved(); return row;
}

test('genuine local adoption supports first claimed Save and a separate fresh read-only Check', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value);
  const saved = await save(t, value, intent); assertSaved(value, intent, saved, guard); await guard.settle(); await guard.close();
  const before = snapshot(value.f), reader = writerGuard(t, value, { writes: false });
  const checked = await check(t, value, intent.operationSha256); assert.deepEqual(checked.body, saved.body);
  assert.equal(reader.count('get'), 1); assert.equal(reader.count('head'), 1); assert.equal(reader.count('put'), 0);
  assert.deepEqual(snapshot(value.f), before); reader.preserved();
});

test('a real second Save follows fresh revision adoption and reopens the exact retained revision chain', async t => {
  const value = await claimedLocalAdoptionFixture(t), firstIntent = editIntent(value), firstGuard = writerGuard(t, value);
  const first = await save(t, value, firstIntent); const firstRow = assertSaved(value, firstIntent, first, firstGuard);
  await firstGuard.settle(); await firstGuard.close();
  const revisionOne = await currentValue(t, value);
  assert.equal(revisionOne.snapshot.revision, 1); assert.equal(revisionOne.snapshot.editEventId, first.body.imageRevision.editEventId);
  assert.deepEqual(revisionOne.snapshot.media, first.body.imageRevision.media);
  assert.deepEqual(revisionOne.snapshot.sourceIds, [], 'the original pair cannot stand in for a reference to revision one');
  const adopted = await adoptCurrentRevision(t, revisionOne), current = await currentValue(t, value);
  assert.equal(current.snapshot.revision, 1); assert.equal(current.snapshot.head, adopted.head);
  assert.deepEqual(current.snapshot.sourceIds, [adopted.sourceId]); assert.notEqual(adopted.sourceId, value.adoption.sourceId);
  const pixels = new Uint8Array((1536 * 4 + 1) * 864); pixels.set([200, 30, 70, 255], 1);
  const secondIntent = editIntent(current, { result: png({ width: 1536, height: 864, raw: pixels }) });
  assert.notEqual(secondIntent.request.resultMediaSha256, firstIntent.request.resultMediaSha256);
  const secondGuard = writerGuard(t, current), second = await save(t, current, secondIntent);
  const secondRow = assertSaved(current, secondIntent, second, secondGuard);
  assert.equal(secondRow.revision, 2); assert.notEqual(secondRow.revision_id, firstRow.revision_id);
  assert.deepEqual(rows(value.f, 'artifact_revisions').find(row => row.revision_id === firstRow.revision_id), firstRow);
  const envelope = JSON.parse(secondRow.content_json), initial = JSON.parse(firstRow.content_json);
  assert.deepEqual(envelope.origin, initial.origin); assert.deepEqual(envelope.initialMedia, initial.initialMedia);
  assert.equal(second.body.imageRevision.source.eventId, first.body.imageRevision.editEventId);
  assert.equal(second.body.imageRevision.source.mediaUrl, first.body.imageRevision.media.url);
  assert.deepEqual(second.body.imageRevision.claim, first.body.imageRevision.claim);
  assert.equal(secondGuard.batches.find(batch => batch.publication).items.filter(item => item.sql.startsWith('INSERT INTO artifact_revisions(')).length, 1);
  await secondGuard.settle(); await secondGuard.close();
  const reopened = await currentValue(t, value);
  assert.equal(reopened.snapshot.revision, 2); assert.equal(reopened.snapshot.editEventId, second.body.imageRevision.editEventId);
  assert.deepEqual(reopened.snapshot.media, second.body.imageRevision.media); assert.deepEqual(reopened.snapshot.sourceIds, []);
  const currentCheck = writerGuard(t, value, { writes: false }), checked = await check(t, value, secondIntent.operationSha256);
  assert.deepEqual(checked.body, second.body); assert.equal(currentCheck.count('get'), 1); assert.equal(currentCheck.count('head'), 1);
  await currentCheck.settle(); await currentCheck.close();
  const priorCheck = writerGuard(t, value, { writes: false }), previous = await check(t, value, firstIntent.operationSha256);
  assert.equal(previous.body.status, 'saved'); assert.equal(previous.body.stillCurrent, false); assert.equal(previous.body.currentRevision, 2);
  assert.deepEqual(previous.body.imageRevision, first.body.imageRevision); assert.equal(previous.body.operationSha256, firstIntent.operationSha256);
  assert.equal(priorCheck.count('get'), 1); assert.equal(priorCheck.count('head'), 1); assert.equal(priorCheck.count('put'), 0);
});

test('an actual uploaded ordinary reference joins claimed composition and bounds retained edit expiry', async t => {
  const value = await claimedLocalAdoptionFixture(t), sourceBytes = png({ width: 24, height: 24 });
  const upload = writerGuard(t, value, { writes: false, putMode: 'upload' }); let sourceMedia;
  try {
    const form = new FormData(); form.append('file', new File([sourceBytes], 'claimed-editor-ordinary.png', { type: 'image/png' }));
    form.append('rightsConfirmed', 'true'); form.append('nonSensitiveConfirmed', 'true');
    const response = await mediaApi.uploadMedia(new Request(value.origin + '/api/media', { method: 'POST',
      headers: { origin: value.origin, 'oai-authenticated-user-id': value.ownerId, 'oai-authenticated-user-email': value.ownerId + '@example.invalid' }, body: form }), value.f.env);
    sourceMedia = await response.json(); assert.equal(response.status, 200); assert.equal(sourceMedia.kind, 'image');
    assert.equal(sourceMedia.contentHash, hash(sourceBytes)); assert.equal(sourceMedia.rights, 'asserted');
    assert.deepEqual(upload.calls.map(call => call.kind), ['put']); assert.equal(upload.calls[0].key, sourceMedia.key);
    assert.deepEqual(value.objects.get(sourceMedia.key).bytes, sourceBytes);
  } finally { await upload.settle(); await upload.close(); }
  const blockId = eventWrite.uuidV7(), referenceId = 'ordinary-reference-' + eventWrite.uuidV7();
  const expiresAt = new Date(Math.min(Date.parse(value.lineage.canonical.expiresAt) - 1000, Date.now() + 60_000)).toISOString();
  assert.ok(Date.parse(expiresAt) > Date.now() + 5000); assert.ok(expiresAt < value.lineage.canonical.expiresAt);
  // Native ordinary reference ingress, matching the existing reference
  // persistence fixture: real upload, ReferenceIngested, RightsAsserted and
  // BlockCreated. This is not a manually constructed claimed local pair.
  const ingress = await appendNativeFixtureEvents(t, value, [
    ['ReferenceIngested', { reference_id: referenceId, source_type: 'upload', source_ref: sourceMedia.url,
      content_hash: sourceMedia.contentHash, source_mime_type: 'image/png', rights_class: 'asserted' }],
    ['RightsAsserted', { reference_id: referenceId, rights_class: 'owned_or_licensed', assertion_method: 'declared-test-fixture' }],
    ['BlockCreated', { block_id: blockId, type: 'reference', scope: 'document', handle: 'reference/ordinary-fixture', position: 'zz-ordinary',
      properties: { label: 'Ordinary retained source', subtype: 'Image', reference_id: referenceId, media_url: sourceMedia.url,
        media_type: 'image/png', source_mime_type: 'image/png', source_content_hash: sourceMedia.contentHash,
        source_expires_at: expiresAt, pixel_reference_mode: 'context_only', extraction_status: 'unavailable' } }],
  ]);
  const current = await currentValue(t, value), ordinary = current.snapshot.sources.find(source => source.blockId === blockId);
  assert.ok(ordinary); assert.equal(ordinary.mediaUrl, sourceMedia.url); assert.equal(ordinary.contentHash, sourceMedia.contentHash);
  assert.equal(ordinary.kind, 'image'); assert.notEqual(ordinary.requiresUnlock, true);
  assert.deepEqual(current.snapshot.sourceIds, [value.adoption.sourceId], 'the ordinary source does not replace the required current claimed source');
  const intent = editIntent(current, { alter(request) {
    request.recipe = composition.normalizeReferenceComposition(composition.addReferenceCompositionLayer(request.recipe, ordinary, 'ordinary-layer'));
  } });
  assert.ok(intent.request.recipe); assert.equal(intent.request.recipe.sources.length, 2);
  const guard = writerGuard(t, current), saved = await save(t, current, intent), row = assertSaved(current, intent, saved, guard);
  assert.equal(row.expires_at, expiresAt); assert.ok(rows(value.f, 'artifact_revisions').every(row => row.expires_at === expiresAt));
  assert.equal(guard.calls.filter(call => call.kind === 'get' && call.key === sourceMedia.key).length, 1);
  assert.equal(guard.calls.filter(call => call.kind === 'head' && call.key === sourceMedia.key).length, 0);
  assert.deepEqual(value.objects.get(sourceMedia.key).bytes, sourceBytes);
  for (const event of ingress) assert.ok(rows(value.f, 'events').some(row => row.event_id === event.eventId));
  const retained = JSON.parse(row.content_json); assert.deepEqual(retained.request.recipe.sources, intent.request.recipe.sources);
  await guard.settle(); await guard.close();
  const reader = writerGuard(t, value, { writes: false }), checked = await check(t, value, intent.operationSha256);
  assert.deepEqual(checked.body, saved.body); assert.equal(reader.count('get'), 1); assert.equal(reader.count('head'), 1);
  assert.equal(reader.calls.some(call => call.key === sourceMedia.key), false, 'Check proves the stored intent without rereading an ordinary source');
});

test('a fresh PATCH retransmission proves the committed intent before current-source eligibility and never rewrites', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), first = writerGuard(t, value);
  const saved = await save(t, value, intent); assertSaved(value, intent, saved, first); await first.settle(); await first.close();
  const before = snapshot(value.f), retry = writerGuard(t, value, { writes: false });
  const repeated = await save(t, value, intent); assert.deepEqual(repeated.body, saved.body);
  assert.equal(retry.count('get'), 2); assert.equal(retry.count('head'), 2); assert.equal(retry.count('put'), 0);
  assert.deepEqual(snapshot(value.f), before); assert.equal(retry.state.publicationBatches, 0);
});

test('unknown exact operation Check is read-only and does not read any PNG', async t => {
  const value = await claimedLocalAdoptionFixture(t), guard = writerGuard(t, value, { writes: false });
  const result = await check(t, value, 'e'.repeat(64)); assert.deepEqual(result.body, { status: 'unconfirmed', code: 'unconfirmed' });
  assert.equal(guard.calls.length, 0); assert.deepEqual(snapshot(value.f), guard.initial);
});

test('event-cell capacity arithmetic matches actual local SQLite escaping of genuine source and adoption history', async t => {
  const value = await claimedLocalAdoptionFixture(t), text = 'A "café"\n雪 heron by a bridge';
  // Qualification07 failed in the frozen provider harness before custody:
  // JSON.stringify(body).includes(rawSubject) cannot match quote/newline wire
  // escapes. Preserve its evidence; add this text through the real event stage
  // after the accepted default generation, without altering any provider gate.
  const [authored] = await appendNativeFixtureEvents(t, value, [['BlockCreated', {
    block_id: eventWrite.uuidV7(), type: 'text', scope: 'document', handle: 'text/escaping-fixture', position: 'zz-escaping',
    properties: { text, intent: 'include', authority: 'authored' },
  }]]);
  const fields = ['event_id', 'stream_id', 'sequence', 'occurred_at', 'recorded_at', 'actor', 'client_id', 'correlation_id',
    'causation_id', 'compensates_event_id', 'schema_version', 'type', 'payload', 'private_owner', 'private_project',
    'private_document', 'private_json', 'private_redacted'];
  const relation = `SELECT e.*,p.owner_id private_owner,p.project_id private_project,p.document_id private_document,
    p.private_json,p.redacted_at private_redacted FROM events e LEFT JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.stream_id=?`;
  const cell = `json_object(${fields.map(key => `'${key}',${key}`).join(',')})`;
  const cells = value.f.sqlite.prepare(`WITH source AS (${relation}) SELECT ${cell} AS witness FROM source ORDER BY sequence`).all('creative:' + value.ownerId);
  const textCell = cells.map(cell => JSON.parse(cell.witness)).find(cell => cell.event_id === authored.eventId); assert.ok(textCell);
  assert.equal(JSON.parse(textCell.private_json).properties.text, text);
  assert.ok(cells.length > 2); let nativeBytes = 2, countedBytes = 2;
  for (const cell of cells) { const size = Buffer.byteLength(cell.witness), counted = edit.claimedImageEditEventCellBytes(JSON.parse(cell.witness));
    assert.equal(counted, size); nativeBytes += size + 1; countedBytes += counted + 1; }
  assert.equal(countedBytes, nativeBytes); assert.ok(nativeBytes < 24000000);
  // This is scalar/native JSON parity on genuine small history. It does not
  // claim a maximum-sized custody fixture or whole-worker heap fit.
});

for (const fault of ['throw-after-commit', 'zero-revision-changes']) test('one genuine atomic append recovers from ' + fault + ' through one authoritative readback', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value);
  guard.state.batchTransform = (result, { items, publication }) => {
    if (!publication) return result;
    if (fault === 'throw-after-commit') throw Error('fixture lost settled ACK');
    return result.map((item, index) => /^\s*INSERT INTO artifact_revisions\(/u.test(items[index].sql) ? { ...item, meta: { ...item.meta, changes: 0 } } : item);
  };
  const result = await save(t, value, intent); assertSaved(value, intent, result, guard);
  assert.equal(guard.state.publicationBatches, 1);
});

test('an accessor-bearing settled ACK stays unconfirmed without invoking it and a fresh Check proves the real commit', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value); let accessorCalls = 0;
  guard.state.batchTransform = (result, { publication }) => {
    if (!publication) return result;
    const malformed = { ...result[0] };
    Object.defineProperty(malformed, 'results', { enumerable: true, get() { accessorCalls++; return []; } });
    return [malformed, ...result.slice(1)];
  };
  const result = await save(t, value, intent); assert.deepEqual(result.body, { status: 'unconfirmed', code: 'unconfirmed' });
  assert.equal(accessorCalls, 0); assert.equal(guard.count('put'), 1); assert.equal(guard.count('get'), 2); assert.equal(guard.count('head'), 2);
  assert.equal(guard.state.publicationBatches, 1); assert.ok(guard.batches.find(batch => batch.publication).completed);
  await guard.settle(); await guard.close();
  const reader = writerGuard(t, value, { writes: false }), checked = await check(t, value, intent.operationSha256);
  assert.equal(checked.body.status, 'saved'); assert.equal(checked.body.operationSha256, intent.operationSha256);
  const actual = rows(value.f, 'events').filter(row => row.type === 'GeneratedImageEdited'); assert.equal(actual.length, 1);
  assert.equal(checked.body.imageRevision.editEventId, actual[0].event_id); assert.equal(reader.count('put'), 0);
  assert.equal(reader.count('get'), 1); assert.equal(reader.count('head'), 1);
});

test('two original owners with the same intent may PUT once each but commit one actual successor', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value, { actions: 2 });
  const arrived = deferred(); let count = 0;
  guard.state.beforeBatch = async ({ publication }) => { if (!publication) return; if (++count === 2) arrived.resolve(); await finite(arrived.promise, 'both atomic candidates'); };
  const results = await Promise.all([save(t, value, intent), save(t, value, intent)]);
  assert.equal(count, 2); assert.equal(guard.count('put'), 2); assert.equal(guard.state.publicationBatches, 2);
  const edits = rows(value.f, 'events').filter(row => row.type === 'GeneratedImageEdited'); assert.equal(edits.length, 1);
  assert.equal(rows(value.f, 'artifact_revisions').filter(row => row.owner_id === value.ownerId).length, 2);
  for (const result of results) { assert.equal(result.body.status, 'saved'); assert.equal(result.body.imageRevision.editEventId, edits[0].event_id);
    assert.equal(result.body.operationSha256, intent.operationSha256); }
  assert.equal(guard.batches.filter(batch => batch.publication && batch.completed).length, 1);
  assert.equal(guard.batches.filter(batch => batch.publication && batch.failed).length, 1); guard.preserved();
});

test('a real trailing assertion failure rolls back event, private envelope and both revision rows atomically', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value);
  guard.state.failFirstTrailingProof = true;
  const result = await save(t, value, intent); assert.deepEqual(result.body, { status: 'unconfirmed', code: 'unconfirmed' });
  const publication = guard.batches.find(batch => batch.publication); assert.ok(publication.failed);
  assert.equal(publication.injectedFault, 'throwing-first-trailing-proof'); assert.match(publication.error, /malformed JSON/iu);
  assert.equal(guard.state.publicationBatches, 1); assert.equal(guard.count('put'), 1); assert.deepEqual(snapshot(value.f), guard.initial);
});

test('conditional-null PUT stays unconfirmed without destination read, append, retry or deletion', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value);
  guard.state.putResult = null; const result = await save(t, value, intent);
  assert.deepEqual(result.body, { status: 'unconfirmed', code: 'unconfirmed' }); assert.equal(guard.count('put'), 1);
  assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 1); assert.equal(guard.state.publicationBatches, 0);
  assert.deepEqual(snapshot(value.f), guard.initial);
  await guard.settle(); await guard.close();
  const reader = writerGuard(t, value, { writes: false }), checked = await check(t, value, intent.operationSha256);
  assert.deepEqual(checked.body, { status: 'unconfirmed', code: 'unconfirmed' }); assert.equal(reader.calls.length, 0);
});

test('aborting pending PUT preserves its borrowed bytes until actual settlement and never appends', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value), entered = deferred(), release = deferred();
  const action = fresh(t, value, { method: 'PATCH', body: intent.form() }); let buffer;
  guard.state.beforePut = async entry => { buffer = entry.buffer; entered.resolve(); await release.promise; };
  const pending = custody.handleGuestImageResultEdit(action.request, value.f.env, { outputId: value.outputId });
  try {
    await finite(Promise.race([entered.promise, pending.then(() => { throw Error('writer returned before native PUT boundary'); })]), 'pending native PUT');
    assert.deepEqual(new Uint8Array(buffer), intent.result); action.controller.abort();
    const response = await pending; assert.deepEqual(await response.json(), { status: 'unconfirmed', code: 'unconfirmed' });
    assert.deepEqual(new Uint8Array(buffer), intent.result, 'pending native consumer retains immutable bytes');
    assert.equal(guard.state.publicationBatches, 0); assert.equal(guard.count('get'), 1);
  } finally { release.resolve(); await guard.settle(); await turn(); }
  assert.ok(new Uint8Array(buffer).every(value => value === 0), 'settled retired buffer is zeroed');
  assert.equal(guard.count('put'), 1); assert.deepEqual(snapshot(value.f), guard.initial);
});

for (const field of ['lineageDigest', 'ownerId']) test('current native metadata rejects wrong ' + field + ' before PUT', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value);
  guard.state.getTransform = raw => ({ ...raw, metadata: { ...raw.metadata, [field]: 'wrong-fixture-value' } });
  const result = await save(t, value, intent); assert.equal(result.body.status, 'refused'); assert.equal(guard.count('put'), 0);
  assert.equal(guard.state.publicationBatches, 0); assert.deepEqual(snapshot(value.f), guard.initial);
});

test('destination byte mismatch after settled PUT stays unconfirmed and preserves original history', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value);
  guard.state.getTransform = (raw, { ordinal }) => { if (ordinal === 2) raw.bytes[raw.bytes.length - 1] ^= 1; return raw; };
  const result = await save(t, value, intent); assert.deepEqual(result.body, { status: 'unconfirmed', code: 'unconfirmed' });
  assert.equal(guard.count('put'), 1); assert.equal(guard.count('get'), 2); assert.equal(guard.state.publicationBatches, 0);
  assert.deepEqual(snapshot(value.f), guard.initial);
});

test('retention revoked after current collection is reproved before any edit consequence', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value);
  guard.state.beforeHead = ({ ordinal }) => { if (ordinal !== 1) return;
    assert.ok(rows(value.f, 'private_content').some(row => row.content_id === value.snapshot.contentRef));
    guard.fixtureMutation('retained planner redacted after current PNG', () => value.f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?')
      .run(new Date().toISOString(), value.snapshot.contentRef)); };
  const result = await save(t, value, intent); assert.equal(result.body.status, 'refused'); assert.equal(guard.count('put'), 0);
  assert.equal(guard.state.publicationBatches, 0); assert.deepEqual(snapshot(value.f), guard.state.expected);
});

for (const fault of ['wrong-lineage', 'native-schema', 'stale-content', 'duplicate-field']) test('genuine current custody refuses ' + fault + ' edit without a write', async t => {
  const value = await claimedLocalAdoptionFixture(t), intent = editIntent(value), guard = writerGuard(t, value);
  if (fault === 'wrong-lineage') intent.request.claim = { ...intent.request.claim, lineageDigest: 'sha256:' + 'e'.repeat(64) };
  if (fault === 'native-schema') { delete intent.request.claim; delete intent.request.schemaVersion; }
  if (fault === 'stale-content') intent.request.expectedContentSha256 = 'e'.repeat(64);
  const result = await save(t, value, intent, { extra: fault === 'duplicate-field' ? form => form.append('request', '{}') : undefined });
  assert.equal(result.body.status, 'refused'); assert.equal(guard.count('put'), 0); assert.equal(guard.state.publicationBatches, 0);
  assert.deepEqual(snapshot(value.f), guard.initial);
});
