import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { issuedFixture, admit, rows, snapshot, changes, nativeEvents, request, payer, origin, redactSource, addLease, insert } from './guest-image-admission-fixture.mjs';
const [{ deriveGuestSponsorDriver }, execution, driver] = await Promise.all([
  import('../../worker/experience-guest-sponsor-contract.ts'),
  import('../../worker/experience-guest-image-execution.ts'),
  import('../../worker/experience-guest-image-driver.ts'),
]);
export const { createGuestImageExecutionAuthority, requireGuestImageExecution } = execution;
export const { runGuestImage, readGuestImageRun } = driver;
const { ownerMediaNamespace } = await import('../../src/model/media-ownership.ts');
// Independent literal oracle for fixed synthetic usage under the retained pricing table.
export const expectedCallPrices = Object.freeze({ 'planning:initial': 1200, 'image:initial': 3000 });
export const plannedDirection = Object.freeze({ title: 'Stone bridge', rationale: 'Preserve the supplied subject',
  scene: 'A blue heron on a stone bridge', palette: ['blue', 'stone'], next_moves: ['Review composition'] });

/** A real, CRC-correct, compressed RGBA PNG. It is locally synthesized test
 * media, never a downloaded or live-provider image. */
export function validPng(width, height) {
  const crc = bytes => { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const body = Buffer.concat([Buffer.from(name), data]), length = Buffer.alloc(4), check = Buffer.alloc(4);
    length.writeUInt32BE(data.length); check.writeUInt32BE(crc(body)); return Buffer.concat([length, body, check]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * (width * 4 + 1) + 1 + x * 4; pixels[i] = 36; pixels[i + 1] = 120; pixels[i + 2] = 80; pixels[i + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

/** Retains the accepted A fixture unchanged. Every positive session, source,
 * approval, native queue, slot and hold is created by its actual native API. */
export async function admittedRunFixture(t, options = {}) {
  const f = await issuedFixture(t, options);
  f.after = callback => t.after(callback);
  f.admitted = (await admit(f)).result;
  f.driver = await deriveGuestSponsorDriver(JSON.parse(rows(f, 'experience_sponsor_driver_intents')[0].command_json));
  f.runInput = { ...f.input, commandKey: f.driver.stageKeys.run, explicitRun: true };
  f.admittedSnapshot = snapshot(f);
  f.initialJob = rows(f, 'document_jobs')[0]; f.initialSlot = rows(f, 'output_operation_slots')[0];
  f.initialToken = rows(f, 'budget_reservations')[0]; f.initialCost = rows(f, 'cost_budget_reservations')[0];
  f.provider = installProviderWire(t, f); f.storage = installMemoryStorage(f);
  assert.deepEqual(rows(f, 'users').map(row => row.user_id), [payer]);
  return f;
}

/** Only the three exact native OpenAI endpoints are served. Unexpected origins,
 * routes, methods, retries, model changes and ambient egress fail immediately. */
export function installProviderWire(t, f) {
  const state = { calls: [], forbidden: [], planner: 0, safety: 0, image: 0, beforeResponse: null, beforeRequest: null,
    plannerFailure: null, imageFailure: null, blocked: false, imageBytes: null };
  const check = action => { try { return action(); } catch (error) { state.forbidden.push(`request-conformance:${error.message}`); throw error; } };
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const href = String(url), routes = { 'https://api.openai.com/v1/responses': 'planner',
      'https://api.openai.com/v1/moderations': 'safety', 'https://api.openai.com/v1/images/generations': 'image' };
    const stage = routes[href];
    if (!stage || state.blocked) { state.forbidden.push(href); throw new Error('unexpected external or replay request'); }
    const body = check(() => { assert.equal(init.method, 'POST');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer no-network-fixture');
      assert.ok(init.signal instanceof AbortSignal, 'native foreground control supplies provider cancellation');
      return JSON.parse(String(init.body)); });
    if (state[stage]++ !== 0) { state.forbidden.push(`duplicate:${stage}`); throw new Error(`no second ${stage} provider dispatch`); }
    const call = { stage, url: href, body, rawBody: String(init.body), headers: new Headers(init.headers), signal: init.signal }; state.calls.push(call);
    await state.beforeRequest?.(call);
    let response;
    if (stage === 'planner') {
      check(() => { assert.equal(body.model, 'gpt-5.6-terra'); assert.ok(JSON.stringify(body).includes(f.subject), 'exact genuine context reaches the real planner wire'); });
      if (state.plannerFailure) throw state.plannerFailure;
      response = Response.json({ id: 'guest-local-planner', model: 'gpt-5.6-terra', output_text: JSON.stringify(plannedDirection),
        usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } }, { headers: { 'x-request-id': 'guest-local-planner-request' } });
    } else if (stage === 'safety') {
      check(() => assert.equal(body.model, 'omni-moderation-latest'));
      response = Response.json({ id: 'guest-local-safety', model: 'omni-moderation-latest', results: [{ flagged: false, categories: {}, category_scores: {} }] });
    } else {
      check(() => { assert.equal(body.model, f.imageModel); assert.equal(body.n, 1); assert.equal(body.size, '1024x1024');
        assert.equal(body.quality, 'high'); assert.equal(body.output_format, 'png'); assert.ok(body.prompt.includes(f.subject)); });
      if (state.imageFailure) throw state.imageFailure;
      state.imageBytes = validPng(1024, 1024);
      response = Response.json({ created: 1786406400, data: [{ b64_json: state.imageBytes.toString('base64') }],
        usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200, input_tokens_details: { text_tokens: 120, image_tokens: 0 } } },
      { headers: { 'x-request-id': 'guest-local-image-request' } });
    }
    await state.beforeResponse?.(call, response); return response;
  });
  t.after(() => { assert.deepEqual(state.forbidden, [], 'no external network or duplicate provider call');
    for (const stage of ['planner', 'safety', 'image']) assert.ok(state[stage] <= 1, `at most one ${stage} wire attempt`); });
  return state;
}

/** Replacement object keeps the unchanged A helper's original media tripwire
 * intact. This store accepts only native guarded owned generated PNG writes. */
export function installMemoryStorage(f) {
  const state = { objects: new Map(), calls: [], attemptedKeys: new Set(), forbidden: [], beforePut: null, afterPut: null };
  const check = action => { try { return action(); } catch (error) { state.forbidden.push(`storage-conformance:${error.message}`); throw error; } };
  const ownedKey = key => { assert.equal(typeof key, 'string');
    assert.ok(key.startsWith(`${ownerMediaNamespace(f.session.guestSubject)}/generated/`));
    assert.match(key.slice(key.lastIndexOf('/') + 1), /^[a-f0-9-]{36}\.png$/u); };
  const existingKey = key => check(() => { ownedKey(key); assert.ok(state.attemptedKeys.has(key), 'only this original native put key may be read or cleaned'); });
  f.after(() => assert.deepEqual(state.forbidden, [], 'no unapproved media operation'));
  const read = key => { const item = state.objects.get(key); return item ? { key, body: new Blob([item.bytes]).stream(), size: item.bytes.length,
    customMetadata: structuredClone(item.metadata), httpEtag: 'guest-local-etag', writeHttpMetadata(headers) { headers.set('content-type', item.contentType); } } : null; };
  f.env.MEDIA = {
    async put(key, value, options = {}) {
      state.calls.push({ method: 'put', key });
      const metadata = options.customMetadata ?? {}, bytes = check(() => Buffer.from(value));
      check(() => { ownedKey(key);
      assert.equal(metadata.ownerId, f.session.guestSubject); assert.equal(metadata.outputNativeStorage, '1');
      assert.equal(metadata.outputSlotId, f.admitted.slotId); assert.equal(metadata.outputScopeKey, f.initialSlot.scope_key);
      assert.equal(metadata.outputDocumentId, f.session.documentId); assert.equal(options.httpMetadata?.contentType, 'image/png');
      assert.equal(metadata.sha256, createHash('sha256').update(bytes).digest('hex')); assert.equal(metadata.outputSha256, metadata.sha256);
      assert.deepEqual(bytes, f.provider.imageBytes); }); state.attemptedKeys.add(key);
      await state.beforePut?.({ key, bytes, metadata });
      state.objects.set(key, { bytes: bytes.slice(), metadata: structuredClone(metadata), contentType: 'image/png' });
      await state.afterPut?.({ key, bytes, metadata }); return { key, httpEtag: 'guest-local-etag' };
    },
    async get(key) { state.calls.push({ method: 'get', key }); existingKey(key); return read(key); },
    async head(key) { state.calls.push({ method: 'head', key }); existingKey(key); return read(key); },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) { state.calls.push({ method: 'delete', key }); existingKey(key); state.objects.delete(key); } },
    async list() { state.forbidden.push('list'); throw new Error('native guest run cannot enumerate media'); },
  };
  return state;
}

export function exactOriginalIdentities(f) {
  for (const [table, key, value] of [['document_jobs', 'job_id', f.admitted.jobId], ['output_operation_slots', 'slot_id', f.admitted.slotId],
    ['output_execution_grants', 'grant_id', f.admitted.grantId], ['budget_reservations', 'reservation_id', f.initialToken.reservation_id],
    ['cost_budget_reservations', 'reservation_id', f.initialCost.reservation_id], ['experience_sponsor_consumptions', 'consumption_id', f.admitted.consumptionId]]) {
    assert.equal(rows(f, table).length, 1, `${table} has no second purchase`); assert.equal(rows(f, table)[0][key], value);
  }
  assert.deepEqual(rows(f, 'users').map(row => row.user_id), [payer]);
  for (const table of ['events', 'event_private_payloads', 'output_commands']) {
    const original = f.admittedSnapshot.contents[table];
    assert.deepEqual(rows(f, table).slice(0, original.length), original, `original ${table} remains byte-identical`);
  }
  for (const table of ['experience_sponsor_grants', 'experience_sponsor_issuances', 'experience_sponsor_resource_receipts',
    'experience_sponsor_driver_intents', 'experience_sponsor_driver_stages', 'experience_sponsor_consumptions', 'output_plan_revisions', 'output_plan_targets', 'output_preflights', 'output_operation_routes'])
    assert.deepEqual(rows(f, table), f.admittedSnapshot.contents[table], `original ${table} stays byte-identical`);
  for (const table of Object.keys(f.admittedSnapshot.contents).filter(name => name.startsWith('experience_guest_')))
    assert.deepEqual(rows(f, table), f.admittedSnapshot.contents[table], `original guest custody/source ${table}`);
  assert.equal(rows(f, 'output_results').length, 0, 'Image uses its native GenerationCompleted graph');
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
}

export function assertKnownCall(f, call) {
  const planning = call.stage_key === 'planning:initial', wire = f.provider.calls.find(row => row.stage === (planning ? 'planner' : 'image'));
  assert.ok(wire); assert.ok(Object.hasOwn(expectedCallPrices, call.stage_key));
  assert.equal(call.status, 'settled'); assert.equal(call.used_microusd, expectedCallPrices[call.stage_key]);
  assert.equal(call.provider, 'openai'); assert.equal(call.model, planning ? 'gpt-5.6-terra' : f.imageModel);
  assert.equal(call.slot_id, f.admitted.slotId); assert.equal(call.scope_key, f.initialSlot.scope_key);
  assert.equal(call.provider_response_id, planning ? 'guest-local-planner' : 'guest-local-image-request');
  assert.equal(call.client_request_id, wire.headers.get('x-client-request-id'));
  const requestBytes = planning ? wire.rawBody : JSON.stringify({ model: wire.body.model, prompt: wire.body.prompt,
    size: wire.body.size, quality: wire.body.quality, outputFormat: wire.body.output_format, references: [] });
  assert.equal(call.request_digest, createHash('sha256').update(requestBytes).digest('hex'));
  const receipt = JSON.parse(rows(f, 'document_jobs')[0].result_json).providerSubmissions[call.client_request_id];
  assert.equal(receipt.status, 'completed'); assert.equal(receipt.providerRequestId, call.provider_response_id);
  assert.equal(receipt.inputTokens, 120); assert.equal(receipt.outputTokens, 80); assert.equal(receipt.totalTokens, 200);
  assert.equal(receipt.costMicrousd, expectedCallPrices[call.stage_key]);
}

export function assertNativeCompletion(f) {
  exactOriginalIdentities(f);
  const job = rows(f, 'document_jobs')[0], slot = rows(f, 'output_operation_slots')[0], events = nativeEvents(f);
  assert.equal(job.status, 'completed'); assert.equal(job.attempt_count, 1); assert.equal(slot.status, 'succeeded');
  const completed = events.filter(event => event.type === 'GenerationCompleted'); assert.equal(completed.length, 1);
  const event = completed[0], body = event.payload;
  assert.equal(event.eventId, slot.outcome_event_id); assert.equal(event.correlationId, job.correlation_id);
  assert.equal(body.document_id, f.session.documentId); assert.equal(body.model_id, f.imageModel); assert.equal(body.planner_model_id, 'gpt-5.6-terra');
  assert.equal(body.simulation, false); assert.equal(body.media_type, 'image/png'); assert.equal(body.image_width, 1024); assert.equal(body.image_height, 1024);
  assert.equal(body.source_surface, 'outputs'); assert.deepEqual(body.object_ids, [body.object_id]);
  const content = id => { const row = rows(f, 'private_content').find(row => row.content_id === id); assert.ok(row); assert.equal(row.owner_id, f.session.guestSubject); assert.equal(row.redacted_at, null); return row.content; };
  assert.deepEqual(JSON.parse(content(body.output_ref)), plannedDirection);
  assert.equal(content(body.prompt_ref), f.provider.calls.find(call => call.stage === 'image').body.prompt);
  const key = decodeURIComponent(body.media_url.slice('/api/media/'.length)), image = f.storage.objects.get(key); assert.ok(image);
  assert.deepEqual(image.bytes, f.provider.imageBytes); assert.equal(body.source_content_hash, createHash('sha256').update(image.bytes).digest('hex'));
  const writes = rows(f, 'output_native_storage_writes'); assert.equal(writes.length, 1); assert.equal(writes[0].write_acknowledged, 1);
  assert.equal(writes[0].storage_key, key); assert.equal(writes[0].publication_event_id, event.eventId); assert.equal(writes[0].status, 'written');
  assert.deepEqual(f.provider.calls.map(call => call.stage), ['planner', 'safety', 'image']);
  const calls = rows(f, 'output_provider_calls'); assert.equal(calls.length, 2);
  for (const call of calls) assertKnownCall(f, call);
  const token = rows(f, 'budget_reservations')[0], cost = rows(f, 'cost_budget_reservations')[0];
  assert.equal(token.status, 'settled'); assert.equal(token.used_tokens, 400); assert.equal(cost.status, 'settled');
  assert.equal(cost.used_microusd, 4200); assert.equal(cost.used_microusd, calls.reduce((sum, call) => sum + call.used_microusd, 0));
  for (const [table, unit, used] of [['budget_counters', 'tokens', 400], ['cost_budget_counters', 'microusd', 4200]]) {
    const counters = rows(f, table); assert.equal(counters.length, 2);
    assert.deepEqual(new Set(counters.map(row => `${row.scope}:${row.scope_id}`)), new Set([`user:${payer}`, 'workspace:forma']));
    assert.ok(counters.every(counter => counter[`reserved_${unit}`] === 0 && counter[`used_${unit}`] === used));
  }
  assert.equal(rows(f, 'experience_sponsor_active_jobs').length, 0);
  return { event, body, job, slot, token, cost, calls };
}

/** Captures actual SQL without spending the original capability lifetime on
 * offline compiles. Captured exact shapes are compiled separately before D1. */
export function observeRunSql(f) {
  const prepare = f.DB.prepare, batch = f.DB.batch, state = { statements: [], batches: [], violations: [], readOnly: false };
  f.after(() => assert.deepEqual(state.violations, [], 'native catches cannot hide SQL qualification or read-only violations'));
  const note = (sql, bindings, method) => {
    try {
    assert.ok(Buffer.byteLength(sql) <= 100000, 'actual SQL bytes fit D1'); assert.ok(bindings.length <= 100, 'actual bindings fit D1');
    assert.doesNotMatch(sql, /^\s*(?:CREATE|ALTER|DROP|PRAGMA)\b/iu, 'no runtime schema installation');
    if (state.readOnly) assert.doesNotMatch(sql, /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM)\b/iu);
    state.statements.push({ sql, bindings: bindings.length, sqlBytes: Buffer.byteLength(sql), method });
    } catch (error) { state.violations.push({ sqlSha256: createHash('sha256').update(sql).digest('hex'), error: String(error) }); throw error; }
  };
  const wrap = (statement, sql, bindings = []) => { const bind = statement.bind;
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql, values); };
    for (const method of ['first', 'all', 'run']) { const original = statement[method]; statement[method] = function (...args) { note(sql, bindings, method); return original.apply(this, args); }; }
    return statement;
  };
  f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
  f.DB.batch = function (statements) { state.batches.push(statements.map(row => row.sql)); for (const row of statements) note(row.sql, row.bindings ?? [], 'batch'); return batch.call(this, statements); };
  return { ...state, get readOnly() { return state.readOnly; }, set readOnly(value) { state.readOnly = value; }, restore() { f.DB.prepare = prepare; f.DB.batch = batch; } };
}
export function interceptRunBatch(f, predicate, action, { before = false, once = true } = {}) {
  const batch = f.DB.batch; let count = 0;
  f.DB.batch = async statements => { if (!predicate(statements) || once && count) return batch.call(f.DB, statements); count++;
    if (before) statements = await action(statements) ?? statements;
    const result = await batch.call(f.DB, statements); return before ? result : action(result, statements); };
  return { get calls() { return count; }, restore() { f.DB.batch = batch; } };
}
export const claimsJob = statements => statements.some(row => /UPDATE\s+document_jobs\s+SET\s+status='running'/iu.test(row.sql));
export const publishesCompletion = statements => statements.some(row => /INSERT\s+INTO\s+event_write_stage\b/iu.test(row.sql) && row.bindings.includes('GenerationCompleted'));
export const financialSnapshot = f => Object.fromEntries(['budget_reservations', 'cost_budget_reservations', 'budget_counters', 'cost_budget_counters'].map(table => [table, rows(f, table)]));
export { rows, snapshot, changes, nativeEvents, request, payer, origin, redactSource, addLease, insert };
