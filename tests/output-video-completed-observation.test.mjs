import assert from 'node:assert/strict';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const transport = await import('../worker/output-video-execution.ts');
const { createVideoOutputContract } = await import('../src/model/output-video-contract.ts');
const bytes = Uint8Array.from([1, 2, 3, 4]);
const sha = value => crypto.subtle.digest('SHA-256', value).then(value => Buffer.from(value).toString('hex'));
const contract = createVideoOutputContract({
  source: { draftId: 'experience-draft-' + 'a'.repeat(64), draftHash: 'sha256:' + 'b'.repeat(64), releaseHash: 'sha256:' + 'c'.repeat(64), requestHash: 'sha256:' + 'd'.repeat(64), sourceBindingHash: 'sha256:' + 'e'.repeat(64) },
  reference: { version: 1, sourceProjectId: 'original-project', sourceDocumentId: 'original-document', sourceBlockId: 'original-block', referenceId: 'original-reference', sha256: await sha(bytes), permissionAttestation: 'i-own-or-have-permission' },
  frameSize: '1280x720',
});
const env = { FAL_KEY: 'synthetic-no-network', FORMA_VIDEO_PROVIDER: 'fal' };
const base = 'https://queue.fal.run/bytedance/seedance-2.0/requests/original-job';
const mediaUrl = 'https://v3.fal.media/video/original';

function fixture() {
  const events = [], calls = [], submissions = [], envelopes = [], attempts = [];
  const options = {
    outputVideo: contract, seconds: 4, size: '1280x720', resolution: '480p', audioMode: 'silent', generateAudio: false,
    providerModel: transport.OUTPUT_VIDEO_TRANSPORT.model, endUserId: 'original-actor',
    references: [{ bytes: bytes.slice(), mimeType: 'image/png', blockId: 'original-block', referenceId: 'original-reference', label: 'Owned still', mode: 'inspiration', sequence: null, shotDirection: '', cameraDirection: '', framePrompt: '', sourceArtifactId: null, sourceArtifactItemId: null, sourceArtifactKind: null, storyboardTitle: '' }],
    onBeforeSourceTransmission(lease) { lease.assertCurrent(); },
    onBeforeProviderAttempt(attempt, lease) { lease.assertCurrent(); attempts.push(attempt); },
    onBeforeProviderDispatch(id, lease) { lease.assertCurrent(); assert.equal(id, attempts[0].clientRequestId); },
    onPrepared(_value, lease) { lease.assertCurrent(); },
    onReceipt(_value, lease) { lease.assertCurrent(); },
    onOutputVideoEnvelope(value, lease) { lease.assertCurrent(); envelopes.push(value); events.push('envelope:' + value.phase); },
    onProviderSubmission(value, lease) { lease.assertCurrent(); submissions.push(value); events.push('observed:' + value.status); },
  };
  const responses = [
    Response.json({ upload_url: 'https://v3.fal.media/upload/original', file_url: 'https://v3.fal.media/file/original' }),
    new Response(null), Response.json({ request_id: 'original-job' }),
    Response.json({ status: 'COMPLETED', request_id: 'original-job' }),
    Response.json({ request_id: 'original-job', video: { url: mediaUrl, content_type: 'video/mp4', file_size: bytes.length } }),
    new Response(bytes, { headers: { 'content-type': 'video/mp4' } }),
  ];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method }); events.push('fetch:' + url);
    assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
    const response = responses.shift(); assert.ok(response, 'unexpected network call');
    if (typeof response === 'function') return response(init);
    return response;
  };
  return { events, calls, submissions, envelopes, attempts, options, responses, fetch };
}
async function network(fetch, work) {
  const saved = globalThis.fetch; globalThis.fetch = fetch;
  try { return await work(); } finally { globalThis.fetch = saved; }
}

test('known original completed cost is observed before a failed media download', async () => {
  const f = fixture(); f.responses[5] = () => { throw Error('synthetic_media_failure'); };
  await network(f.fetch, () => assert.rejects(transport.generateOutputVideo(env, 'A slow pan.', f.options), /synthetic_media_failure/));
  const completed = f.submissions.filter(value => value.status === 'completed');
  assert.equal(completed.length, 1, 'a matching completed original response must retain its adopted cost before media retrieval');
  assert.equal(completed[0].providerRequestId, 'original-job');
  assert.equal(completed[0].clientRequestId, f.attempts[0].clientRequestId);
  assert.equal(completed[0].costMicrousd, f.attempts[0].video.mediaMaximumMicrousd);
  assert.ok(f.events.indexOf('envelope:result') < f.events.indexOf('observed:completed'));
  assert.ok(f.events.indexOf('observed:completed') < f.events.indexOf('fetch:' + mediaUrl));
  assert.equal(f.calls.filter(value => value.method === 'POST' && value.url.startsWith('https://queue.fal.run')).length, 1);
  assert.equal(f.calls.length, 6);
});

test('valid root and nested results observe exact original adopted cost before media retrieval', async () => {
  for (const nested of [false, true]) {
    const f = fixture();
    const result = { request_id: 'original-job', model: transport.OUTPUT_VIDEO_TRANSPORT.model, status: 'COMPLETED', error: null,
      video: { url: mediaUrl, content_type: 'video/mp4', file_size: 4, provider: 'fal', model_id: transport.OUTPUT_VIDEO_TRANSPORT.model, errors: null, detail: null } };
    f.responses[4] = Response.json(nested ? { data: result } : result);
    const output = await network(f.fetch, () => transport.generateOutputVideo(env, 'A slow pan.', f.options));
    assert.deepEqual(output.bytes, bytes);
    const completed = f.submissions.filter(value => value.status === 'completed'); assert.equal(completed.length, 1);
    assert.deepEqual(completed[0], { ...f.submissions.find(value => value.status === 'accepted'), status: 'completed',
      costMicrousd: f.attempts[0].video.mediaMaximumMicrousd, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    assert.ok(f.events.indexOf('envelope:result') < f.events.indexOf('observed:completed'));
    assert.ok(f.events.indexOf('observed:completed') < f.events.indexOf('fetch:' + mediaUrl));
    assert.equal(f.calls[3].url, base + '/status'); assert.equal(f.calls[4].url, base);
  }
});

test('invalid or aborted downloaded bytes cannot erase completed accounting or return an output', async () => {
  for (const mode of ['mime', 'length', 'empty', 'abort']) {
    const f = fixture(), control = new AbortController(); f.options.signal = control.signal;
    f.responses[5] = mode === 'mime' ? new Response(bytes, { headers: { 'content-type': 'text/html' } })
      : mode === 'length' ? new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': '999' } })
        : mode === 'empty' ? new Response(new Uint8Array(), { headers: { 'content-type': 'video/mp4' } })
          : () => { control.abort(Error('synthetic_abort')); return new Response(bytes); };
    await network(f.fetch, () => assert.rejects(transport.generateOutputVideo(env, 'A slow pan.', f.options)));
    assert.deepEqual(f.submissions.map(value => value.status), ['pending', 'accepted', 'completed'], mode);
    assert.equal(f.calls.length, 6); assert.equal(f.calls.filter(value => value.method === 'POST').length, 2);
  }
});

const descriptor = () => ({ url: mediaUrl, content_type: 'video/mp4', file_size: 4 });
const invalidResults = [
  ...['root', 'data', 'video'].flatMap(where => [
    ['request_id', 'foreign'], ['model', 'foreign'], ['model_id', 'foreign'], ['provider', 'other'],
    ['status', 'FAILED'], ['status', null], ['error', 'failed'], ['errors', []], ['detail', {}],
  ].map(([key, value]) => {
    const result = where === 'data' ? { data: { video: descriptor() } } : { video: descriptor() };
    (where === 'data' ? result.data : where === 'video' ? result.video : result)[key] = value;
    return [where + ':' + key, result];
  })),
  ['ambiguous', { video: descriptor(), data: { video: descriptor() } }],
  ['no-video', { request_id: 'original-job', status: 'COMPLETED' }],
  ['array-video', { video: [] }], ['invalid-data', { data: null }],
  ['off-origin', { video: { ...descriptor(), url: 'https://untrusted.invalid/original.mp4' } }],
  ['descriptor-mime', { video: { ...descriptor(), content_type: 'text/html' } }],
  ...[0, -1, 1.5, '4', transport.OUTPUT_VIDEO_TRANSPORT.maximumResultBytes + 1].map(file_size => ['descriptor-length:' + file_size, { video: { ...descriptor(), file_size } }]),
];

test('contradictory identity/model/errors and ambiguous result metadata remain retained but cannot produce a financial observation', async () => {
  for (const [label, result] of invalidResults) {
    const f = fixture(); f.responses[4] = Response.json(result);
    await network(f.fetch, () => assert.rejects(transport.generateOutputVideo(env, 'A slow pan.', f.options), undefined, label));
    assert.deepEqual(f.submissions.map(value => value.status), ['pending', 'accepted'], label);
    assert.equal(f.envelopes.at(-1).phase, 'result', label); assert.equal(f.calls.length, 5, label);
  }
  const f = fixture(); f.responses[4] = Response.json({ video: descriptor() }, { headers: { 'x-fal-request-id': 'foreign' } });
  await network(f.fetch, () => assert.rejects(transport.generateOutputVideo(env, 'A slow pan.', f.options), /receipt_mismatch/));
  assert.equal(f.calls.length, 5); assert.ok(!f.submissions.some(value => value.status === 'completed'));
  assert.ok(f.envelopes.at(-1).headers.some(([key, value]) => key === 'x-fal-request-id' && value === 'foreign'));
});

test('failed normal financial observation stops media transfer without rejection or repeat purchase', async () => {
  const f = fixture(); f.options.onProviderSubmission = (value, lease) => {
    lease.assertCurrent(); f.submissions.push(value);
    if (value.status === 'completed') throw Error('financial_commit_unavailable');
  };
  await network(f.fetch, () => assert.rejects(transport.generateOutputVideo(env, 'A slow pan.', f.options), /financial_commit_unavailable/));
  assert.equal(f.calls.length, 5); assert.deepEqual(f.submissions.map(value => value.status), ['pending', 'accepted', 'completed']);
});

async function originalFixture() {
  const attempt = await transport.captureOutputVideoAttempt(contract, JSON.stringify({ prompt: 'A slow pan.', aspect_ratio: '16:9', duration: 4,
    resolution: '480p', generate_audio: false, end_user_id: 'f'.repeat(64), image_urls: ['https://v3.fal.media/file/original'] }), 'forma-video-original');
  const f = fixture(); f.responses.splice(0, 3);
  const original = { contract, requestBody: attempt.video.requestBody, clientRequestId: attempt.clientRequestId,
    requestDigest: attempt.requestDigest, providerRequestId: 'original-job' };
  const options = { onBeforeRead: async lease => { lease.assertCurrent(); },
    onEnvelope: async (value, lease) => { lease.assertCurrent(); f.envelopes.push(value); f.events.push('envelope:' + value.phase); } };
  return { ...f, original, readOptions: options, attempt };
}

test('optional original reader observes an opaque exact receipt before failed media GET and keeps that evidence distinct from payer authority', async () => {
  const f = await originalFixture(); let token, receipt;
  f.responses[2] = () => { throw Error('original_media_failure'); };
  f.readOptions.onCompleted = (value, lease) => {
    lease.assertCurrent(); token = value; receipt = transport.readOutputVideoCompletedObservation(value); f.events.push('completed');
    assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(receipt));
    assert.throws(() => { receipt.providerRequestId = 'foreign'; }, TypeError);
  };
  await network(f.fetch, () => assert.rejects(transport.readOriginalOutputVideo(env, f.original, f.readOptions), /original_media_failure/));
  assert.deepEqual(receipt, { provider: 'fal', operation: 'video', status: 'completed', model: f.attempt.model,
    clientRequestId: f.attempt.clientRequestId, providerRequestId: 'original-job', requestDigest: f.attempt.requestDigest,
    costMicrousd: f.attempt.video.mediaMaximumMicrousd, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  for (const forged of [{}, { ...token }, structuredClone(token), JSON.parse(JSON.stringify(token)), Object.create(token)]) {
    assert.throws(() => transport.readOutputVideoCompletedObservation(forged), /completed_observation_invalid/);
  }
  assert.ok(f.events.indexOf('envelope:result') < f.events.indexOf('completed'));
  assert.ok(f.events.indexOf('completed') < f.events.indexOf('fetch:' + mediaUrl));
  assert.deepEqual(f.calls.map(value => value.method), ['GET', 'GET', 'GET']);
});

test('original reader shares the completion classifier and never invokes optional observation for contradictory results or pending work', async () => {
  for (const [label, result] of invalidResults) {
    const f = await originalFixture(); f.responses[1] = Response.json(result); let observations = 0;
    f.readOptions.onCompleted = (_value, lease) => { observations++; lease.assertCurrent(); };
    await network(f.fetch, () => assert.rejects(transport.readOriginalOutputVideo(env, f.original, f.readOptions)));
    assert.equal(observations, 0, label);
    assert.equal(f.calls.length, 2, label); assert.equal(f.envelopes.at(-1).phase, 'result');
  }
  const f = await originalFixture(); f.responses[0] = Response.json({ request_id: 'original-job', status: 'IN_PROGRESS' });
  f.readOptions.onCompleted = () => assert.fail('pending is not a completed observation');
  assert.equal((await network(f.fetch, () => transport.readOriginalOutputVideo(env, f.original, f.readOptions))).status, 'pending');
  assert.equal(f.calls.length, 1);
});

test('original observer is captured once; malformed hooks fail before reads and rejected or unobserved hooks prevent media GET', async () => {
  for (const callback of [null, {}, 'completed']) {
    const f = await originalFixture(); f.readOptions.onCompleted = callback;
    await network(() => assert.fail('network'), () => assert.rejects(transport.readOriginalOutputVideo(env, f.original, f.readOptions), /hooks_required/));
  }
  for (const callback of [() => { throw Error('observer_refused'); }, () => {}]) {
    const f = await originalFixture(); f.readOptions.onCompleted = callback;
    await network(f.fetch, () => assert.rejects(transport.readOriginalOutputVideo(env, f.original, f.readOptions), /observer_refused|lease_unobserved/));
    assert.equal(f.calls.length, 2);
  }
  const f = await originalFixture(); let observations = 0;
  f.readOptions.onCompleted = (_value, lease) => { lease.assertCurrent(); observations++; };
  f.readOptions.onBeforeRead = async lease => { lease.assertCurrent(); f.readOptions.onCompleted = () => assert.fail('replacement callback'); };
  assert.equal((await network(f.fetch, () => transport.readOriginalOutputVideo(env, f.original, f.readOptions))).status, 'completed');
  assert.equal(observations, 1); assert.equal(f.calls.length, 3);
});

test('original observation hook deadline retires late work and cannot continue to media retrieval', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = await originalFixture(); let release, observedLease, writes = 0;
  f.readOptions.onCompleted = async (_value, lease) => {
    observedLease = lease; lease.assertCurrent(); await new Promise(resolve => { release = resolve; }); lease.assertCurrent(); writes++;
  };
  const work = network(f.fetch, () => transport.readOriginalOutputVideo(env, f.original, f.readOptions));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(30000); await assert.rejects(work, /hook_timeout/);
  assert.ok(observedLease.signal.aborted); assert.equal(f.calls.length, 2);
  release(); await new Promise(resolve => setImmediate(resolve)); assert.equal(writes, 0); assert.equal(f.calls.length, 2);
});
