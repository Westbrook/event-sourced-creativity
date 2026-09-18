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


// Native first-Save successor. This source is not a passing qualification.
// Reuses sealed reader supplier526d5b42 / current39e48ddb and helper1cdb1f19.
// Host guard, owned runtime, selected closure limits, genuine producer, explicit
// scene setup and read-only facet are preserved. New operation-specific write
// facets are private to this one genuine positive; no generic writer allowance.
// Root owns coherent source review, fixture composition and isolated execution.
{
const [{ readFileSync }, { readFile, realpath }, { createRequire, syncBuiltinESMExports },
  { dirname, extname, relative, resolve, sep }, { fileURLToPath }, { copyWriterFixture }, { exportSynthetic }] = await Promise.all([
  import('node:fs'), import('node:fs/promises'), import('node:module'), import('node:path'), import('node:url'),
  import('./experience-guest-image-result-copy-writer.test.mjs'), import('./helpers/model3d-workerd-snapshot.mjs'),
]);
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const phase = (name, detail = {}) => process.stderr.write(`[guest-result-edit-d1] ${JSON.stringify({
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
function fixtureWorker({ inventory, core, media, custody, principal, intakeAuthority, sceneVersion, sceneEpochActivateSql, sceneMigration, composition, revision, eventWrite, ownership }) {
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
    requireFact(input.mode === 'positive' && input.successorCase === 'adopt-first-save-check', 'fixed native current case');
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
    requireFact(input.mode === 'positive' && input.successorCase === 'adopt-first-save-check', 'fixed native successor case');
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

    // Each successor action gets new original Request, DB handles and R2 facet.
    // No producer capability, scene-activation exception or previous action's
    // native statement survives into a subsequent production entrypoint.
    currentController.abort();
    const actionReceipts = [];
    const stageColumns = eventWrite.EVENT_WRITE_COLUMNS.split(',');
    const revisionColumns = ['revision_id', 'owner_id', 'organization_id', 'project_access_id', 'project_id', 'document_id',
      'artifact_id', 'revision', 'content_json', 'content_sha256', 'created_by_user_id', 'created_at', 'expires_at', 'redacted_at'];
    const stageSql = `INSERT INTO event_write_stage(${stageColumns.join(',')}) VALUES(${stageColumns.map(() => '?').join(',')})`;
    const revisionSql = `INSERT INTO artifact_revisions(${revisionColumns.join(',')}) VALUES(${revisionColumns.map(() => '?').join(',')})`;
    const adoptionPairSql = `SELECT e.*,p.owner_id private_owner,p.project_id private_project,p.document_id private_document,
        p.private_json,p.redacted_at private_redacted,p.created_at private_created_at
        FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id
        WHERE e.event_id IN (?,?) ORDER BY e.sequence`;
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
    const editedBytes = Uint8Array.from(atob(input.edited.base64), value => value.charCodeAt(0));
    requireFact(editedBytes.length > 0 && editedBytes.length <= 20 * 1024 * 1024
      && await hash(editedBytes) === input.edited.sha256 && input.edited.sha256 !== row.content_sha256,
    'bounded distinct synthetic editor PNG');
    function freshAction(method = 'GET', body, extraHeaders = {}, operation) {
      const actionController = new AbortController();
      const actionRequest = new Request(currentOrigin + '/api/generated-images/' + encodeURIComponent(expectedCurrent.outputId)
        + (operation ? '?operationSha256=' + operation : ''), { method, body,
        headers: { origin: currentOrigin, 'oai-authenticated-user-id': expectedCurrent.ownerId,
          'oai-authenticated-user-email': expectedCurrent.ownerId + '@example.invalid', ...extraHeaders }, signal: actionController.signal });
      requireFact(!actionRequest.signal.aborted && !actionRequest.headers.has('authorization') && !actionRequest.headers.has('cookie'),
        'fresh exact personal successor request');
      return { request: actionRequest, controller: actionController };
    }
    function makeWriterDbFacet(kind) {
      requireFact(kind === 'adopt' || kind === 'save', 'fixed writer phase');
      const phaseName = 'native-' + kind, originals = new WeakMap(), pending = new Set();
      const statementLimit = kind === 'adopt' ? 2397 : 4795, batchLimit = kind === 'adopt' ? 421 : 423;
      const observation = { phase: phaseName, statements: 0, wrappers: 0, batches: 0, publicationBatches: 0,
        maxBatch: 0, maxSqlBytes: 0, maxBindings: 0, maxBindingBytes: 0, activationBatches: 0 };
      const publications = [], nativeErrors = []; let active = true;
      const checkActive = () => { if (!active) currentReject(phaseName + ':stale-facet'); };
      const mutationKind = sql => sql === stageSql ? 'event_write_stage' : kind === 'save' && sql === revisionSql ? 'artifact_revisions' : null;
      function validate(sql, values, unbound = false) {
        checkActive();
        if (typeof sql !== 'string' || encoder.encode(sql).length > 100000 || !Array.isArray(values) || values.length > 100
          || values.some(value => value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))
          || encoder.encode(JSON.stringify(values)).length > 1048576 || !(readonlyCurrentSql(sql) || mutationKind(sql)))
          currentReject(phaseName + ':sql-or-bindings');
        if (!unbound && sql === stageSql && (values.length !== 17 || values[1] !== 'creative:' + expectedCurrent.ownerId
          || values[13] !== expectedCurrent.ownerId || values[14] !== expectedCurrent.projectId || values[15] !== expectedCurrent.documentId
          || typeof values[16] !== 'string' || !(kind === 'adopt' ? ['ReferenceIngested', 'BlockCreated'] : ['GeneratedImageEdited']).includes(values[11])))
          currentReject(phaseName + ':event-stage');
        if (!unbound && sql === revisionSql && (values.length !== 14 || values[1] !== expectedCurrent.ownerId || values[2] !== null
          || values[3] !== null || values[4] !== expectedCurrent.projectId || values[5] !== expectedCurrent.documentId
          || values[10] !== expectedCurrent.ownerId || values[13] !== null || ![0, 1].includes(values[7])))
          currentReject(phaseName + ':revision-row');
      }
      function recordWriter(item, method) {
        validate(item.sql, item.bindings);
        if (mutationKind(item.sql) && method !== 'batch') currentReject(phaseName + ':direct-write');
        if (++observation.statements > statementLimit) currentReject(phaseName + ':statement-cap');
        const key = JSON.stringify([item.sql, item.bindings]);
        if (!sqlForms.has(key)) {
          sqlBytes += encoder.encode(key).length;
          if (sqlForms.size >= 4096 || sqlBytes > 32 * 1024 * 1024) currentReject('shared-sql-evidence-cap');
          sqlForms.set(key, { sql: item.sql, bindings: [...item.bindings] });
        }
        const entry = { step: phaseName, method, inserted: mutationKind(item.sql), updated: null,
          form: [...sqlForms.keys()].indexOf(key), parameters: item.bindings.length };
        traceBytes += encoder.encode(JSON.stringify(entry)).length;
        if (trace.length >= 16384 || traceBytes > 2 * 1024 * 1024) currentReject('shared-trace-cap');
        trace.push(entry);
        observation.maxSqlBytes = Math.max(observation.maxSqlBytes, encoder.encode(item.sql).length);
        observation.maxBindings = Math.max(observation.maxBindings, item.bindings.length);
        observation.maxBindingBytes = Math.max(observation.maxBindingBytes, encoder.encode(JSON.stringify(item.bindings)).length);
      }
      function dispatch(work) {
        checkActive(); const dispatchedAtStatement = observation.statements;
        const promise = Promise.resolve(work()); pending.add(promise);
        promise.then(() => pending.delete(promise), error => {
          // Test-only bounded observation of an already rejected native promise.
          // Return that original promise unchanged; no retry or replacement ACK.
          let message; try { message = String(error).slice(0, 256); } catch { message = 'unprintable native database rejection'; }
          if (nativeErrors.length < 4) nativeErrors.push({ dispatchedAtStatement, message });
          pending.delete(promise);
        }); return promise;
      }
      function statement(sql, values = [], unbound = true) {
        validate(sql, values, unbound);
        if (++observation.wrappers > 2 * statementLimit) currentReject(phaseName + ':wrapper-cap');
        const actual = db.prepare(sql), native = values.length ? actual.bind(...values) : actual;
        const item = Object.freeze({ native, sql, bindings: Object.freeze([...values]) });
        const wrapped = Object.freeze({
          bind(...next) { checkActive(); return statement(sql, next, false); },
          first(...args) {
            if (args.length > 1 || args.length && typeof args[0] !== 'string' || !readonlyCurrentSql(sql)) currentReject(phaseName + ':first');
            recordWriter(item, 'first'); return dispatch(() => Reflect.apply(native.first, native, args));
          },
          all(...args) {
            if (args.length || !readonlyCurrentSql(sql)) currentReject(phaseName + ':all');
            recordWriter(item, 'all'); return dispatch(() => Reflect.apply(native.all, native, []));
          },
          run() { return currentReject(phaseName + ':run'); }, raw() { return currentReject(phaseName + ':raw'); },
        }); originals.set(wrapped, item); return wrapped;
      }
      const database = Object.freeze({
        prepare(...args) { if (args.length !== 1) return currentReject(phaseName + ':prepare-arity'); return statement(args[0]); },
        batch(...args) {
          checkActive(); const queries = args[0];
          if (args.length !== 1 || !Array.isArray(queries) || queries.length < 1 || queries.length > batchLimit) currentReject(phaseName + ':batch-shape');
          const selected = [];
          for (let index = 0; index < queries.length; index++) {
            const slot = Object.getOwnPropertyDescriptor(queries, index), item = slot && Object.hasOwn(slot, 'value') ? originals.get(slot.value) : null;
            if (!item) currentReject(phaseName + ':foreign-or-sparse-batch'); validate(item.sql, item.bindings); selected.push(item);
          }
          const writes = selected.filter(item => mutationKind(item.sql));
          if (writes.length) {
            if (++observation.publicationBatches !== 1) currentReject(phaseName + ':second-publication');
            const indices = selected.flatMap((item, index) => mutationKind(item.sql) ? [index] : []);
            const beforeProofs = selected.slice(0, indices[0]);
            const afterProofs = kind === 'adopt' ? selected.slice(indices.at(-1) + 1, -1) : selected.slice(indices.at(-1) + 1);
            const proofLimit = kind === 'adopt' ? 209 : 210;
            if (beforeProofs.length < 1 || beforeProofs.length > proofLimit || afterProofs.length < 1 || afterProofs.length > proofLimit
              || indices.some((index, position) => index !== indices[0] + position)
              || !beforeProofs.every(item => item.sql.startsWith('SELECT CASE WHEN '))
              || !afterProofs.every(item => item.sql.startsWith('SELECT CASE WHEN '))) currentReject(phaseName + ':publication-proofs');
            if (kind === 'adopt') {
              if (writes.length !== 2 || writes.some(item => item.sql !== stageSql)
                || writes[0].bindings[11] !== 'ReferenceIngested' || writes[1].bindings[11] !== 'BlockCreated'
                || selected.at(-1).sql !== adoptionPairSql || selected.at(-1).bindings.length !== 2
                || selected.at(-1).bindings[0] !== writes[0].bindings[0] || selected.at(-1).bindings[1] !== writes[1].bindings[0])
                currentReject(phaseName + ':adoption-batch');
            } else if (writes.length !== 3 || writes[0].sql !== stageSql || writes[0].bindings[11] !== 'GeneratedImageEdited'
              || writes.slice(1).some(item => item.sql !== revisionSql) || writes[1].bindings[7] !== 0 || writes[2].bindings[7] !== 1)
              currentReject(phaseName + ':first-save-batch');
            publications.push(writes.map(item => ({ sql: item.sql, bindings: [...item.bindings] })));
          }
          if (observation.statements + selected.length > statementLimit) currentReject(phaseName + ':batch-statement-cap');
          selected.forEach(item => recordWriter(item, 'batch'));
          observation.batches++; observation.maxBatch = Math.max(observation.maxBatch, selected.length);
          return dispatch(() => Reflect.apply(db.batch, db, [selected.map(item => item.native)]));
        },
        exec() { return currentReject(phaseName + ':exec'); }, dump() { return currentReject(phaseName + ':dump'); },
        withSession() { return currentReject(phaseName + ':withSession'); },
      });
      return { database, observation, publications, nativeErrors, seal() { active = false; },
        async settle() { await Promise.allSettled([...pending]); requireFact(pending.size === 0, phaseName + ':native DB settlement'); } };
    }
    const revisionMetadataKeys = ['ownerId', 'custodyId', 'outputId', 'generationId', 'claimEventId', 'lineageDigest', 'revisionId',
      'editEventId', 'revisionSha256', 'operationSha256', 'sha256', 'mimeType', 'model', 'source'];
    const revisionKeyPrefix = `guest-image-result-media-v1/${ownership.ownerMediaNamespace(expectedCurrent.ownerId)}/${originalClaim.custodyId}/${expectedCurrent.outputId}/revisions/`;
    let revisionKey, revisionPutReceipt, savedMetadata, operationSha256;
    function makeStorageFacet(name, isSave, key) {
      let active = true; const pending = new Set(), calls = [];
      const expected = isSave ? ['get', 'head', 'put', 'get', 'head', 'get', 'head'] : ['get', 'head'];
      function dispatch(kind, args) {
        try {
        if (!active || pending.size || expected[calls.length] !== kind) currentReject(name + ':storage-order');
        const expectedKey = isSave && calls.length >= 3 ? revisionKey : key;
        if (kind !== 'put' && (args.length !== 1 || args[0] !== expectedKey)) currentReject(name + ':storage-key');
        if (kind === 'put') {
          const [target, buffer, options] = args, metadata = options?.customMetadata;
          if (args.length !== 3 || typeof target !== 'string' || target !== revisionKeyPrefix + metadata?.revisionId + '.png'
            || !uuid.test(metadata?.revisionId) || !uuid.test(metadata?.editEventId) || !(buffer instanceof ArrayBuffer)
            || buffer.byteLength !== editedBytes.length || !options || !metadata) currentReject(name + ':put-shape');
          same(Object.keys(options).sort(), ['customMetadata', 'httpMetadata', 'onlyIf'], 'exact native revision PUT options');
          same(options.onlyIf, { etagDoesNotMatch: '*' }, 'native conditional absence PUT');
          same(options.httpMetadata, { contentType: 'image/png' }, 'native edited PNG content type');
          same(Object.keys(metadata).sort(), [...revisionMetadataKeys].sort(), 'all fourteen revision metadata keys');
          same({ ownerId: metadata.ownerId, custodyId: metadata.custodyId, outputId: metadata.outputId, generationId: metadata.generationId,
            claimEventId: metadata.claimEventId, lineageDigest: metadata.lineageDigest, sha256: metadata.sha256, operationSha256: metadata.operationSha256,
            mimeType: metadata.mimeType, model: metadata.model, source: metadata.source },
          { ownerId: expectedCurrent.ownerId, custodyId: originalClaim.custodyId, outputId: expectedCurrent.outputId,
            generationId: expectedCurrent.generationId, claimEventId: expectedCurrent.claimEventId, lineageDigest: originalClaim.lineageDigest,
            sha256: input.edited.sha256, operationSha256, mimeType: 'image/png', model: 'authored-composition', source: 'generated-image-editor' },
          'exact actual claim and intent metadata');
          requireFact(/^[a-f0-9]{64}$/u.test(metadata.revisionSha256), 'revision envelope digest grammar');
          same([...new Uint8Array(buffer)], [...editedBytes], 'actual supplied native PUT PNG bytes');
          revisionKey = target; savedMetadata = { ...metadata };
        }
        } catch (error) { violations.push(name + ':storage-validation:' + String(error)); throw error; }
        calls.push({ kind, key: args[0] });
        const promise = Promise.resolve(Reflect.apply(bucket[kind], bucket, args)); pending.add(promise);
        promise.then(value => {
          if (kind === 'put' && value) revisionPutReceipt = { key: value.key, version: value.version, etag: value.etag,
            size: value.size, customMetadata: value.customMetadata, httpMetadata: value.httpMetadata };
          pending.delete(promise);
        }, () => pending.delete(promise));
        // Return the actual native R2 object/body with original receiver identity.
        return promise;
      }
      const storage = Object.freeze({ get(...args) { return dispatch('get', args); }, head(...args) { return dispatch('head', args); },
        put(...args) { return dispatch('put', args); }, delete() { return currentReject(name + ':storage-delete'); },
        list() { return currentReject(name + ':storage-list'); }, createMultipartUpload() { return currentReject(name + ':storage-multipart'); },
        resumeMultipartUpload() { return currentReject(name + ':storage-resume-multipart'); } });
      return { storage, calls, seal() { active = false; }, async settle() { await Promise.allSettled([...pending]);
        requireFact(pending.size === 0, name + ':native storage settlement'); }, assertComplete() {
        same(calls.map(call => call.kind), expected, name + ':exact native media work');
      } };
    }
    async function runAction(name, action, databaseFacet, storageFacet, work) {
      let value, primaryError, failed = false; const cleanupErrors = [];
      try { value = await work({ ...env, DB: databaseFacet.database, MEDIA: storageFacet.storage }); }
      catch (error) { failed = true; primaryError = error; }
      action.controller.abort(); databaseFacet.seal(); storageFacet.seal();
      try { await databaseFacet.settle(); } catch (error) { cleanupErrors.push(error); }
      try { await storageFacet.settle(); } catch (error) { cleanupErrors.push(error); }
      if (failed || cleanupErrors.length) {
        // Failure-only test receipt, after ordinary teardown. No new native IO,
        // private rows, SQL bindings, request bodies or authority are disclosed.
        const forms = [...sqlForms.values()];
        const sqlTail = trace.filter(item => item.step === databaseFacet.observation.phase).slice(-8).map(item => {
          const sql = forms[item.form]?.sql ?? '';
          return { method: item.method, parameters: item.parameters,
            kind: item.inserted ?? (sql.startsWith('SELECT CASE WHEN ') ? 'proof' : 'read'),
            firstTable: /\b(?:FROM|JOIN)\s+([a-z_][a-z_0-9]*)\b/iu.exec(sql)?.[1]?.slice(0, 64) ?? null };
        });
        let primary; try { primary = failed ? String(primaryError).slice(0, 512) : null; } catch { primary = 'unprintable primary failure'; }
        const diagnostic = { name, primary, database: databaseFacet.observation, sqlTail,
          nativeDatabaseErrors: (databaseFacet.nativeErrors ?? []).slice(0, 4),
          storageCalls: storageFacet.calls.slice(0, 18).map(item => item.kind),
          violations: violations.slice(0, 8).map(value => String(value).slice(0, 256)), violationCount: violations.length,
          cleanupErrorCount: cleanupErrors.length, originalRequestRetired: action.request.signal.aborted };
        const errors = [...(failed ? [primaryError] : []), ...cleanupErrors];
        throw new AggregateError(errors, 'native action failure receipt:' + JSON.stringify(diagnostic));
      }
      storageFacet.assertComplete(); same(violations, [], name + ':no swallowed guard violation');
      actionReceipts.push({ name, database: databaseFacet.observation, storageCalls: storageFacet.calls, originalRequestRetired: action.request.signal.aborted });
      return value;
    }
    async function assertExactNewRows(before, after, table, newCount) {
      requireFact(after.rows[table].length === before.rows[table].length + newCount, table + ':exact new row count');
      same(after.rows[table].slice(0, before.rows[table].length), before.rows[table], table + ':all original rowids/scalars preserved');
    }
    async function assertPublishedDelta(before, after, facet, appended) {
      same(after.schema, before.schema, 'complete main catalog unchanged'); same(after.tempSchema, before.tempSchema, 'complete temp catalog unchanged');
      same(after.tables, before.tables, 'exact application table roster unchanged');
      same(after.protectedPlatformTables, before.protectedPlatformTables, 'native protected table catalogs unchanged');
      const writes = facet.publications[0]; requireFact(facet.publications.length === 1 && writes, 'one actual atomic publication');
      const staged = writes.filter(item => item.sql === stageSql), revisionWrites = writes.filter(item => item.sql === revisionSql);
      same(staged.map(item => item.bindings), appended.map(event => eventWrite.eventWriteBindings(event)), 'real ACK events equal actual native stage bindings');
      requireFact(staged.length === appended.length, 'exact acknowledged staged event count');
      const mutable = new Set(['events', 'event_private_payloads', 'scene_source_generations', ...(revisionWrites.length ? ['artifact_revisions'] : [])]);
      for (const table of before.tables) if (!mutable.has(table)) same(after.rows[table], before.rows[table], 'full immutable table:' + table);
      await assertExactNewRows(before, after, 'events', staged.length);
      await assertExactNewRows(before, after, 'event_private_payloads', staged.length);
      if (revisionWrites.length) await assertExactNewRows(before, after, 'artifact_revisions', revisionWrites.length);
      for (const stagedEvent of staged) {
        const values = stagedEvent.bindings;
        const publicRow = await db.prepare('SELECT * FROM events WHERE event_id=?').bind(values[0]).first();
        same(publicRow, Object.fromEntries(stageColumns.slice(0, 13).map((column, index) => [column, values[index]])), 'native event row exact thirteen cells');
        const privateRow = await db.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').bind(values[0]).first();
        same(privateRow, { private_event_id: values[0], owner_id: values[13], project_id: values[14], document_id: values[15],
          private_json: values[16], created_at: values[4], redacted_at: null }, 'native private envelope exact seven cells');
      }
      for (const write of revisionWrites) {
        const stored = await db.prepare('SELECT * FROM artifact_revisions WHERE revision_id=?').bind(write.bindings[0]).first();
        same(stored, Object.fromEntries(revisionColumns.map((column, index) => [column, write.bindings[index]])), 'native revision row exact fourteen cells');
        requireFact(stored.content_sha256 === await hash(encoder.encode(stored.content_json))
          && stored.created_at < stored.expires_at && stored.expires_at <= retainedLineage.canonical.expiresAt, 'actual revision hash and bounded retention');
      }
      const streamQuoted = "'" + ('creative:' + expectedCurrent.ownerId).replaceAll("'", "''") + "'";
      const prior = before.rows.scene_source_generations.find(value => value.c0 === "'stream'" && value.c1 === streamQuoted);
      const current = after.rows.scene_source_generations.find(value => value.c0 === "'stream'" && value.c1 === streamQuoted);
      requireFact(current && current.c2 === String((prior ? Number(prior.c2) : 0) + 2 * staged.length), 'actual scene generation follows both triggers per event');
      if (prior) same(current, { ...prior, c2: current.c2 }, 'scene stream rowid and other scalar cells preserved');
      else same(Object.keys(current).sort(), ['original_rowid', 'c0', 'c1', 'c2'].sort(), 'exact new stream generation shape');
      same(after.rows.scene_source_generations.filter(value => value !== current), before.rows.scene_source_generations.filter(value => value !== prior),
        'all other scene generation rows unchanged');
      same((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'successor native foreign keys');
    }
    const beforeAdoption = await fullCurrentState();
    const adoptionCommand = { operation: 'adopt-claimed-local-source', claim: originalClaim, expectedRevision: 0,
      expectedEditEventId: null, expectedMediaSha256: row.content_sha256 };
    const adoptAction = freshAction('POST', JSON.stringify(adoptionCommand), { 'content-type': 'application/json' });
    const adoptDb = makeWriterDbFacet('adopt'), adoptStorage = makeStorageFacet('adopt', false, expectedCurrent.key);
    const adoption = await runAction('adopt', adoptAction, adoptDb, adoptStorage, async actionEnv => {
      const response = await custody.adoptGuestImageResultLocalSource(adoptAction.request, actionEnv, { outputId: expectedCurrent.outputId });
      const body = await response.json(); requireFact(response.status === 200 && body.status === 'adopted', 'actual adoption ACK:' + JSON.stringify({ status: body.status, code: body.code })); return body;
    });
    same(adoption.appended.map(event => event.type), ['ReferenceIngested', 'BlockCreated'], 'genuine two-event local adoption');
    same(adoption.appended[0].payload.claim, originalClaim, 'adopted source retains exact completed claim');
    same(adoption.appended[0].payload.media_url, originalClaimPayload.media_url, 'adopted source is actual original PNG');
    same(adoption.referenceId, adoption.appended[0].payload.reference_id, 'adoption ACK matches actual receipt reference');
    same(adoption.referenceId, adoption.appended[1].payload.properties.reference_id, 'adoption ACK matches actual block reference');
    same(adoption.blockId, adoption.appended[1].payload.block_id, 'adoption ACK matches actual created block');
    requireFact(adoption.sourceId === adoption.blockId + ':image' && adoption.appended[0].sequence + 1 === adoption.appended[1].sequence
      && adoption.head === adoption.appended[1].sequence && adoption.appended[0].payload.source_revision === 0
      && adoption.appended[0].payload.source_edit_event_id === null, 'actual original local pair identities and sequence');
    const afterAdoption = await fullCurrentState(); await assertPublishedDelta(beforeAdoption, afterAdoption, adoptDb, adoption.appended);
    const readAction = freshAction(), readDb = makeCurrentDbFacet('native-current-before-save'), readStorage = makeStorageFacet('current-before-save', false, expectedCurrent.key);
    const current = await runAction('current-before-save', readAction, readDb, readStorage,
      actionEnv => custody.readGuestImageResultCurrentSnapshot(readAction.request, actionEnv, { outputId: expectedCurrent.outputId }));
    same(await fullCurrentState(), afterAdoption, 'fresh current before Save is fully read-only');
    requireFact(current && current.status === 'current' && current.revision === 0 && current.editEventId === null
      && Object.isFrozen(current) && Object.isFrozen(current.claim), 'genuine frozen original editor snapshot');
    for (const name of ['ownerId', 'projectId', 'documentId', 'outputId', 'generationId']) same(current[name], expectedCurrent[name], 'current same identity:' + name);
    same(current.claim, originalClaim, 'current genuine claim'); same(current.sourceEventId, expectedCurrent.claimEventId, 'canonical source event');
    same(current.contentRef, originalPlan.content_id, 'current retained planner reference'); same(current.rawJson, originalPlan.content, 'current exact planner bytes');
    same(current.contentSha256, await hash(encoder.encode(originalPlan.content)), 'current genuine raw planner digest');
    same(current.sourceIds, [adoption.sourceId], 'only actual newly adopted eligible source'); same(current.head, adoption.head, 'current actual adoption head');
    const source = current.sources.find(value => value.id === adoption.sourceId); requireFact(source && source.requiresUnlock !== true, 'genuine eligible local source');
    const recipe = composition.normalizeReferenceComposition(composition.addReferenceCompositionLayer(
      composition.createReferenceComposition('16:9'), source, 'native-fixture-layer'));
    requireFact(recipe, 'actual composition normalized');
    const editRequest = { expectedRevision: current.revision, expectedEditEventId: current.editEventId, expectedContentSha256: current.contentSha256,
      generationId: current.generationId, sourceEventId: current.sourceEventId, contentRef: current.contentRef,
      sourceMediaUrl: current.media.url, sourceMediaSha256: current.media.sha256, sourceId: adoption.sourceId, recipe,
      resultMediaSha256: input.edited.sha256, resultByteLength: editedBytes.length, schemaVersion: 2, claim: current.claim };
    const parsedRequest = revision.parseGuestImageResultEditRequest(editRequest); requireFact(parsedRequest, 'real schema2 request parser');
    operationSha256 = await hash(encoder.encode(JSON.stringify({ domain: 'guest-image-result-edit@1', ownerId: current.ownerId,
      projectId: current.projectId, documentId: current.documentId, outputId: current.outputId, request: parsedRequest })));
    same(await revision.guestImageResultEditOperationSha256({ ownerId: current.ownerId, projectId: current.projectId,
      documentId: current.documentId, outputId: current.outputId }, parsedRequest), operationSha256, 'actual operation hash agrees with exact domain bytes');
    const multipart = new FormData(); multipart.append('request', JSON.stringify(editRequest));
    multipart.append('png', new File([editedBytes], 'image.png', { type: 'image/png' }));
    const saveAction = freshAction('PATCH', multipart), saveDb = makeWriterDbFacet('save'), saveStorage = makeStorageFacet('save', true, expectedCurrent.key);
    const saved = await runAction('save', saveAction, saveDb, saveStorage, async actionEnv => {
      const response = await custody.handleGuestImageResultEdit(saveAction.request, actionEnv, { outputId: expectedCurrent.outputId });
      const body = await response.json(); requireFact(response.status === 200 && response.headers.get('cache-control') === 'no-store'
        && body.status === 'saved', 'actual Save ACK:' + JSON.stringify({ status: body.status, code: body.code })); return body;
    });
    requireFact(saved.stillCurrent === true && saved.currentRevision === 1 && saved.head === current.head + 1
      && saved.operationSha256 === operationSha256 && saved.appended.length === 1, 'actual first Save acknowledgment');
    const imageRevision = saved.imageRevision;
    requireFact(imageRevision.schemaVersion === 2 && imageRevision.revision === 1 && imageRevision.source.revision === 0
      && saved.currentEditEventId === imageRevision.editEventId && saved.appended[0].eventId === imageRevision.editEventId,
    'actual schema2 revision and edit event');
    same(imageRevision.claim, originalClaim, 'full exact claim retained'); same(imageRevision.source.eventId, expectedCurrent.claimEventId, 'original source event retained');
    same(imageRevision.source.mediaUrl, current.media.url, 'original source media retained'); same(imageRevision.source.sha256, current.media.sha256, 'original source hash retained');
    same(imageRevision.contentRef, current.contentRef, 'same retained planner'); same(imageRevision.contentSha256, current.contentSha256, 'actual raw planner digest retained');
    same(imageRevision.recipeSha256, await hash(encoder.encode(JSON.stringify(recipe))), 'canonical recipe hash');
    same(imageRevision.media.url, '/api/media/' + encodeURIComponent(revisionKey), 'same actual revision PNG key');
    const afterSave = await fullCurrentState(); await assertPublishedDelta(afterAdoption, afterSave, saveDb, saved.appended);
    const revisionWrites = saveDb.publications[0].filter(item => item.sql === revisionSql);
    const originalEnvelope = JSON.parse(revisionWrites[0].bindings[8]), editedEnvelope = JSON.parse(revisionWrites[1].bindings[8]);
    same(originalEnvelope.imageRevision, null, 'actual revision-zero retention row');
    same(editedEnvelope.imageRevision, imageRevision, 'actual row contains acknowledged full revision');
    same(editedEnvelope.request, parsedRequest, 'actual row contains complete canonical request');
    requireFact(savedMetadata.revisionId === revisionWrites[1].bindings[0] && savedMetadata.editEventId === imageRevision.editEventId
      && savedMetadata.revisionSha256 === revisionWrites[1].bindings[9] && revisionWrites[1].bindings[11] === saved.appended[0].recordedAt,
    'actual event, private row and PNG metadata bind same revision');
    requireFact(revisionPutReceipt && revisionPutReceipt.key === revisionKey && revisionPutReceipt.size === editedBytes.length, 'native conditional PUT acknowledged actual revision');
    same(revisionPutReceipt.customMetadata, savedMetadata, 'native PUT returns exact actual fourteen metadata');
    const checkAction = freshAction('GET', undefined, {}, operationSha256), checkDb = makeCurrentDbFacet('native-fresh-check'), checkStorage = makeStorageFacet('fresh-check', false, revisionKey);
    const checked = await runAction('fresh-check', checkAction, checkDb, checkStorage, async actionEnv => {
      const response = await custody.handleGuestImageResultEdit(checkAction.request, actionEnv, { outputId: expectedCurrent.outputId });
      requireFact(response.status === 200 && response.headers.get('cache-control') === 'no-store', 'fresh Check response'); return response.json();
    });
    same(checked, saved, 'fresh independent Check returns actual saved IDs and exact full acknowledgment');
    same(await fullCurrentState(), afterSave, 'fresh Check preserves every rowid/scalar and catalog');
    const finalAction = freshAction(), finalDb = makeCurrentDbFacet('native-current-after-save'), finalStorage = makeStorageFacet('current-after-save', false, revisionKey);
    const reopened = await runAction('current-after-save', finalAction, finalDb, finalStorage,
      actionEnv => custody.readGuestImageResultCurrentSnapshot(finalAction.request, actionEnv, { outputId: expectedCurrent.outputId }));
    requireFact(reopened && reopened.status === 'current' && reopened.revision === 1 && reopened.editEventId === imageRevision.editEventId
      && reopened.head === saved.head && Object.isFrozen(reopened), 'fresh genuine revision-one current');
    same(reopened.media, imageRevision.media, 'fresh current returns same saved PNG'); same(reopened.claim, originalClaim, 'fresh current retains exact claim');
    same(reopened.sourceIds, [], 'old original local pair cannot stand in for edited PNG');
    for (const name of ['ownerId', 'projectId', 'documentId', 'outputId', 'generationId']) same(reopened[name], expectedCurrent[name], 'reopened same identity:' + name);
    same(await fullCurrentState(), afterSave, 'fresh current preserves every rowid/scalar and catalog');
    // Raw fixture verification is separate from application phase IO. Original
    // source and claimed objects must retain their actual native versions/bytes.
    const fixtureVerification = [];
    for (const [key, expectedHash, version] of [[input.source.key, input.source.sha256, sourceVersion],
      [expectedCurrent.key, row.content_sha256, receipt.destination.version], [revisionKey, input.edited.sha256, revisionPutReceipt.version]]) {
      const object = await Reflect.apply(bucket.get, bucket, [key]); fixtureVerification.push({ kind: 'get', key });
      requireFact(object && object.version === version, 'native stored version preserved:' + key);
      requireFact(await hash(await Reflect.apply(object.arrayBuffer, object, [])) === expectedHash, 'native stored actual bytes:' + key);
      if (key === revisionKey) same(object.customMetadata, savedMetadata, 'persisted native revision metadata exact');
    }
    same((await db.prepare('PRAGMA foreign_key_check').all()).results, [], 'final native successor foreign keys');
    same(violations, [], 'final native successor denial ledger empty');
    receipt.sqlForms = [...sqlForms.values()]; receipt.nativeBudgetObservation.scope = 'producer-before-successor-fixture-setup';
    receipt.aggregateNativeBudgetObservation = { statements: trace.length,
      maxSqlUtf8Bytes: Math.max(...receipt.sqlForms.map(form => encoder.encode(form.sql).length)),
      maxBindingArrayJsonBytes: Math.max(...receipt.sqlForms.map(form => encoder.encode(JSON.stringify(form.bindings)).length)) };
    receipt.successor = { case: input.successorCase, setup: setupFacet.observation, sourceVersion: sceneVersionReceipt,
      actions: actionReceipts, adoption, saved, checked, reopened, revisionPutReceipt, fixtureVerification,
      beforeSha256: await hash(encoder.encode(stable(beforeAdoption))), afterAdoptionSha256: await hash(encoder.encode(stable(afterAdoption))),
      afterSaveSha256: await hash(encoder.encode(stable(afterSave))), originalProducerRequestAborted: request.signal.aborted,
      protectedPlatformTables: beforeAdoption.protectedPlatformTables,
      protectedPlatformData: 'unavailable through native D1; complete catalog compared, every application and scene rowid/scalar inspected',
      attribution: 'one dormant direct native claim/adoption/first Save/fresh Check/current chain; actual local D1 and native R2; genuine production graph; synthetic provider source; no route, UI, live provider, invoice or native segmentation acceptance' };
    const response = JSON.stringify(receipt); requireFact(encoder.encode(response).length <= 36 * 1024 * 1024, 'fixture response bound');
    return new Response(response, { headers: { 'content-type': 'application/json' } });

  } };
}

const fixturePaths = [
  'tests/generated-image-claimed-edit.test.mjs', 'tests/generated-image-claimed-local-adoption.test.mjs',
  'tests/generated-image-claimed-current.test.mjs', 'tests/output-asset-fixtures.mjs', 'drizzle/0038_scene_source_generations.sql',
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
    + `import * as composition from './src/model/reference-composition.ts';\n`
    + `import * as revision from './src/model/generated-image-revision.ts';\n`
    + `import * as eventWrite from './worker/event-write-primitives.ts';\n`
    + `import * as ownership from './src/model/media-ownership.ts';\n`
    + `export default (${nativeCurrentFixtureWorker.toString()})({inventory,core,media,custody,principal,intakeAuthority,sceneVersion,sceneEpochActivateSql,composition,revision,eventWrite,ownership,sceneMigration:${JSON.stringify(sceneMigrationText)}});\n`;
  const dependencyRoot = await realpath(resolve(root, 'node_modules'));
  const inputs = new Map(); let totalBytes = 0;
  // Bounds admit one finite selected source closure; they are fixture tooling
  // bounds, not an application claim/source/accounting allowance. No package is
  // installed, stubbed, rewritten or imported by Node here. Only node:crypto
  // remains external, supplied natively by workerd's nodejs_compat flag.
  let result;
  try { result = await finite(esbuild.build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root,
    sourcefile: 'guest-image-edit-native-fixture-entry.mjs', loader: 'js' }, bundle: true, write: false,
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

async function qualifyNativeEdit(t) {
  const successorCase = 'adopt-first-save-check';
  // Root must first compose and approve the exact frozen supplier, model,
  // custody and writer pins; these bookends do not turn a moving checkout into
  // an accepted source baseline. No sibling module or capability is imported.
  const before = await nativeCurrentPinFiles(nativeCurrentFixturePaths);
  nativeCurrentPhase('source-bookend-before', { successorCase, sourcePins: before });
  t.after(async () => {
    const after = await nativeCurrentPinFiles(nativeCurrentFixturePaths);
    nativeCurrentPhase('source-bookend-after', { successorCase, sourcePins: after });
    assert.deepEqual(after, before, 'native edit fixture/compiler dependencies remain fixed');
  });
  const bundle = await nativeCurrentBundle(); t.after(() => bundle.assertUnchanged());
  const f = await copyWriterFixture(t, { inventory: false });
  const exported = exportSynthetic(f.sqlite), edited = png({ width: 1536, height: 864 });
  const payload = { mode: 'positive', successorCase, snapshot: exported, proof: f.proof,
    request: { url: f.request.url, headers: [...f.request.headers] },
    source: { key: f.mediaOracle.key, sha256: f.mediaOracle.sha256, base64: Buffer.from(f.mediaOracle.bytes).toString('base64'),
      metadata: f.mediaOracle.metadata, httpMetadata: f.mediaOracle.httpMetadata },
    edited: { base64: Buffer.from(edited).toString('base64'), sha256: sha(edited) } };
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) <= 16 * 1024 * 1024);
  // Synthetic database rows, proofs and PNG bytes only. The actual Worker
  // reconstructs native source production, claim, adoption and editor actions.
  t.mock.reset();
  const egress = [], runtime = await nativeCurrentOwnedRuntime(t, successorCase, bundle.script, egress);
  let result, primaryError, failed = false, cleanupError, cleanupFailed = false;
  try {
    const response = await nativeCurrentFinite(runtime.mf.dispatchFetch('http://fixture.invalid/qualify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }), 45000, successorCase + ':dispatch');
    const body = await nativeCurrentFinite(response.text(), 5000, successorCase + ':response');
    assert.equal(response.status, 200, body.slice(0, 2048)); assert.ok(Buffer.byteLength(body) <= 36 * 1024 * 1024);
    result = JSON.parse(body);
  } catch (error) { failed = true; primaryError = error; }
  try { await runtime.cleanup(); } catch (error) { cleanupFailed = true; cleanupError = error; }
  if (failed && cleanupFailed) throw new AggregateError([primaryError, cleanupError], 'native edit action and owned runtime cleanup failed');
  if (failed) throw primaryError;
  if (cleanupFailed) throw cleanupError;
  // Actual observed SQL is qualified only after native runtime disposal. The
  // exact scene schema participates in the same strict native SQL qualifier.
  const schema = exported.schema.filter(row => row.sql).sort((left, right) => {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    return rank[left.type] - rank[right.type] || left.name.localeCompare(right.name);
  }).map(row => row.sql);
  const sceneSql = bundle.sceneMigrationText.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean);
  const { createMediaSqlQualifier } = await import('./helpers/guest-image-result-media-fixture.mjs');
  const qualifier = await createMediaSqlQualifier([...schema, ...sceneSql]);
  for (const form of result.sqlForms) qualifier.qualify(form.sql, form.bindings);
  qualifier.assertVerified(); const sqlMetrics = qualifier.metrics();
  assert.ok(sqlMetrics.uniqueSql > 0 && sqlMetrics.maxBindings <= 100 && sqlMetrics.maxSqlBytes <= 100000);
  assert.equal(result.status, 'claimed'); assert.equal(result.row.state, 'published');
  assert.equal(result.sourceSha256, f.mediaOracle.sha256);
  assert.ok(result.unchangedTables.includes('output_native_storage_writes') && result.unchangedTables.includes('output_provider_calls'));
  const successor = result.successor;
  assert.equal(successor.case, successorCase); assert.equal(successor.originalProducerRequestAborted, true);
  assert.equal(successor.setup.activationBatches, 1);
  assert.deepEqual(successor.actions.map(value => value.name), ['adopt', 'current-before-save', 'save', 'fresh-check', 'current-after-save']);
  for (const action of successor.actions) {
    assert.equal(action.originalRequestRetired, true); assert.equal(action.database.activationBatches, 0);
    const limit = action.name === 'adopt' ? 2397 : action.name === 'save' ? 4795 : 2186;
    const batchLimit = action.name === 'adopt' ? 421 : action.name === 'save' ? 423 : 210;
    assert.ok(action.database.statements > 0 && action.database.statements <= limit); assert.ok(action.database.maxBatch <= batchLimit);
    const expectedKinds = action.name === 'save' ? ['get', 'head', 'put', 'get', 'head', 'get', 'head'] : ['get', 'head'];
    assert.deepEqual(action.storageCalls.map(value => value.kind), expectedKinds);
    if (['adopt', 'save'].includes(action.name)) assert.equal(action.database.publicationBatches, 1);
  }
  assert.equal(successor.adoption.status, 'adopted'); assert.equal(successor.adoption.appended.length, 2);
  assert.equal(successor.saved.status, 'saved'); assert.equal(successor.saved.currentRevision, 1); assert.equal(successor.saved.stillCurrent, true);
  assert.equal(successor.saved.imageRevision.media.sha256, sha(edited));
  assert.equal(successor.saved.imageRevision.media.byteLength, edited.length);
  assert.deepEqual(successor.checked, successor.saved);
  assert.equal(successor.reopened.revision, 1); assert.equal(successor.reopened.editEventId, successor.saved.imageRevision.editEventId);
  assert.deepEqual(successor.reopened.media, successor.saved.imageRevision.media);
  for (const name of ['beforeSha256', 'afterAdoptionSha256', 'afterSaveSha256']) assert.match(successor[name], /^[a-f0-9]{64}$/u);
  assert.notEqual(successor.beforeSha256, successor.afterAdoptionSha256); assert.notEqual(successor.afterAdoptionSha256, successor.afterSaveSha256);
  assert.equal(successor.fixtureVerification.length, 3);
  nativeCurrentPhase('native-edit-qualification-receipt', { successorCase, successor, sqlMetrics,
    bundleSha256: bundle.receipt.outputSha256, sourcePins: before, sourceVersion: result.sourceVersion,
    attribution: 'one genuine native direct claim/adoption/first Save/fresh Check/current chain; synthetic source/Run producer, local D1 and R2; no route, provider call, invoice, browser journey or native segmentation acceptance' });
  return result;
}

// Independently selectable: preserves the existing twenty-one synthetic cases
// and does not replay native reader cases or the upstream claim/provider roster.
nativeTest('native claimed image edit: genuine adoption first Save and fresh Check', { timeout: 180000, concurrency: false }, async t => {
  await qualifyNativeEdit(t);
});

}
