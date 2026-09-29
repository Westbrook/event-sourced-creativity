import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

const sourceHook = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('.') && !context.parentURL?.includes('/node_modules/') && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + '.ts' : specifier, context);
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('AUDIO_ENVELOPE_TEST_EGRESS_DENIED'); };
after(() => { sourceHook.deregister(); globalThis.fetch = originalFetch; });
const [{ generateCreativeAudio, recoverAcceptedAudio, readAudioCompletedResultObservation }, { createAudioOutputContract }, { EXPERIENCE_AUDIO_INTENT }] = await Promise.all([
  import('../worker/fal-audio-adapter.ts'),
  import('../src/model/output-audio-contract.ts'),
  import('../src/experiences/contracts.ts'),
]);

const model = 'fal-ai/stable-audio-3/medium/text-to-audio';
const requestId = 'audio-envelope-original-request';
const submitUrl = `https://queue.fal.run/${model}`;
const resultUrl = `https://queue.fal.run/fal-ai/stable-audio-3/requests/${requestId}`;
const statusUrl = `${resultUrl}/status?logs=1`;
const mediaUrl = 'https://v3b.fal.media/files/audio-envelope-original.mp3';
const prompt = 'An instrumental piano phrase that resolves quietly.';
const bytes = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);
const costMicrousd = 37_600;
const contract = createAudioOutputContract({
  draftId: 'experience-draft-' + '1'.repeat(64), draftHash: 'sha256:' + '2'.repeat(64),
  releaseHash: 'sha256:' + '3'.repeat(64), requestHash: 'sha256:' + '4'.repeat(64), sourceBindingHash: 'sha256:' + '5'.repeat(64),
});
assert.ok(contract);
const audioFile = () => ({ url: mediaUrl, content_type: 'audio/mpeg', duration: 20, file_size: bytes.length, file_name: 'original.mp3' });
const nestedResult = (fields = {}) => ({ request_id: requestId, model, data: { audio: audioFile(), ...fields } });

function fixture(t, mode, result) {
  const env = { FAL_KEY: 'synthetic-envelope-test-key', DB: { identity: 'synthetic-database' } };
  const native = mode === 'native', recovery = mode === 'recovery' || mode === 'legacy-recovery';
  const observed = native || mode === 'recovery';
  const calls = [], events = [], observations = [], receipts = [], captured = [], violations = [];
  t.after(() => assert.deepEqual(violations, [], 'Adapter error conversion must not hide fixture/egress failures'));
  t.mock.method(globalThis, 'fetch', async (value, init = {}) => {
    try {
      const url = String(value), method = init.method ?? 'GET';
      calls.push({ url, method }); events.push(url);
      if (recovery) {
        assert.equal(method, 'GET', 'Original recovery cannot submit, upload, or cancel');
        assert.equal(init.body, undefined);
      }
      assert.equal(init.redirect, observed || recovery || url === mediaUrl ? 'manual' : undefined);
      if (url === submitUrl && !recovery && method === 'POST') {
        const body = JSON.parse(init.body);
        assert.equal(body.prompt, prompt); assert.equal(body.duration, 20); assert.equal(body.enable_safety_checker, true);
        if (native) {
          assert.equal(captured.length, 1);
          assert.equal(captured[0].requestBody, init.body);
          assert.equal(captured[0].requestDigest, createHash('sha256').update(init.body).digest('hex'));
        }
        return Response.json({ request_id: requestId });
      }
      assert.equal(method, 'GET'); assert.equal(init.body, undefined);
      if (url === statusUrl) return Response.json({ request_id: requestId, status: 'COMPLETED' });
      if (url === resultUrl) return typeof result === 'string'
        ? new Response(result, { headers: { 'content-type': 'application/json' } })
        : Response.json(result);
      if (url === mediaUrl) {
        assert.equal(new Headers(init.headers).has('authorization'), false);
        return new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } });
      }
      throw Error(`AUDIO_ENVELOPE_TEST_EGRESS_DENIED: ${method} ${url}`);
    } catch (error) {
      violations.push(error.message);
      throw error;
    }
  });
  const observe = observation => { observations.push(observation); events.push('observed'); };
  const common = { profile: EXPERIENCE_AUDIO_INTENT, providerModel: model, estimatedCostMicrousd: costMicrousd };
  const run = () => recovery
    ? recoverAcceptedAudio(env, {
      ...common, providerJobId: requestId, providerStatusUrl: `${resultUrl}/status`, providerResponseUrl: resultUrl, providerCancelUrl: `${resultUrl}/cancel`,
      retainedReceipt: {
        provider: 'fal', model, submittedPrompt: prompt,
        parameters: { published_cost_microusd: costMicrousd, duration_seconds: 20, goal: 'timed_music', destination: 'standalone' },
        imageReference: null, sourceAudioTreatment: 'none', audioWaveformSubmitted: false,
      },
      ...(observed ? { onCompletedResult: observe } : {}),
    })
    : generateCreativeAudio(env, prompt, {
      ...common,
      ...(native ? {
        outputAudio: contract, onBeforeProviderAttempt: async () => {}, onBeforeProviderDispatch: () => {}, onBeforeSourceTransmission: async () => {},
        onOutputAudioRequest: async request => { captured.push(request); },
        onProviderSubmission: async receipt => { receipts.push(receipt); if (receipt.status === 'completed') observe(receipt); },
      } : {}),
    });
  return { env, calls, events, observations, receipts, captured, run, recovery };
}

function assertObservedOriginal(f, mode) {
  assert.equal(f.observations.length, 1);
  const observation = f.observations[0];
  for (const [key, value] of Object.entries({ provider: 'fal', model, providerRequestId: requestId, costMicrousd, inputTokens: 0, outputTokens: 0, totalTokens: 0 })) assert.equal(observation[key], value);
  assert.ok(f.events.indexOf('observed') > f.events.indexOf(resultUrl));
  assert.ok(f.events.indexOf('observed') < f.events.indexOf(mediaUrl), 'Observe the verified completed envelope before downloading');
  if (mode === 'native') {
    assert.deepEqual(f.receipts.map(receipt => receipt.status), ['pending', 'accepted', 'completed']);
    assert.equal(observation.clientRequestId, f.captured[0].clientRequestId);
    assert.equal(observation.requestDigest, f.captured[0].requestDigest);
    assert.equal(observation.operation, 'audio');
    assert.equal(observation.unitId, 'audio:initial');
  } else {
    assert.equal(observation.costBasis, 'published-audio-rate');
    assert.equal(readAudioCompletedResultObservation(observation, f.env, { model, providerRequestId: requestId }), observation);
  }
}

const contradictions = [
  ['nested request identity differs', () => nestedResult({ request_id: 'foreign-request' }), 'fal_audio_receipt_mismatch'],
  ['nested model differs', () => nestedResult({ model: 'fal-ai/lyria3/pro' }), 'fal_audio_receipt_mismatch'],
  ['nested provider error', () => nestedResult({ error: 'synthetic-provider-error' }), 'fal_audio_result_rejected'],
  ...[
    ['URL', { url: 'https://v3b.fal.media/files/foreign-recording.mp3' }],
    ['content type', { content_type: 'audio/wav' }],
    ['duration', { duration: 21 }],
    ['size', { file_size: bytes.length + 1 }],
    ['file name', { file_name: 'foreign.mp3' }],
  ].map(([label, patch]) => [`two audio branches disagree on ${label}`, () => ({ request_id: requestId, model, audio: audioFile(), data: { request_id: requestId, model, audio: { ...audioFile(), ...patch } } }), 'fal_audio_result_ambiguous']),
];

for (const mode of ['native', 'recovery']) {
  for (const field of ['duration', 'file_size']) {
    test(`${mode}: raw JSON overflow in nested ${field} cannot equal absent outer metadata or establish completed cost`, async t => {
      const outer = audioFile();
      if (field === 'duration') delete outer.duration;
      else outer.file_size = null;
      const raw = JSON.stringify({ request_id: requestId, model, audio: outer, data: { request_id: requestId, model, audio: { ...outer, [field]: 'raw-json-number-overflow' } } })
        .replace('"raw-json-number-overflow"', '1e400');
      assert.equal(JSON.parse(raw).data.audio[field], Infinity, 'Exercise actual JSON numeric overflow before any reserialization');
      const f = fixture(t, mode, raw);
      let failure;
      try { await f.run(); } catch (error) { failure = error; }
      assert.equal(f.observations.length, 0, 'Numeric overflow must not collapse to absent metadata and authorize completed cost');
      assert.equal(failure?.detail?.code, 'fal_audio_result_ambiguous');
      assert.equal(failure.detail.requestId, requestId);
      assert.deepEqual(f.calls, [...(mode === 'native' ? [{ url: submitUrl, method: 'POST' }] : []), { url: statusUrl, method: 'GET' }, { url: resultUrl, method: 'GET' }]);
      if (mode === 'native') assert.deepEqual(f.receipts.map(receipt => receipt.status), ['pending', 'accepted']);
    });
  }

  for (const [name, body, code] of contradictions) {
    test(`${mode}: ${name} refuses before completed cost or media GET`, async t => {
      const f = fixture(t, mode, body());
      let failure;
      try { await f.run(); } catch (error) { failure = error; }
      assert.equal(f.observations.length, 0, 'An explicitly contradictory original result cannot establish paid completion');
      assert.equal(failure?.detail?.code, code);
      assert.equal(failure.detail.requestId, requestId);
      assert.deepEqual(f.calls, [...(mode === 'native' ? [{ url: submitUrl, method: 'POST' }] : []), { url: statusUrl, method: 'GET' }, { url: resultUrl, method: 'GET' }]);
      if (mode === 'native') assert.deepEqual(f.receipts.map(receipt => receipt.status), ['pending', 'accepted']);
    });
  }

  for (const [name, body] of [
    ['absent optional nested identity echoes', () => nestedResult()],
    ['matching nested identity echoes', () => nestedResult({ request_id: requestId, model })],
    ['matching top and nested audio despite object key order', () => ({ request_id: requestId, model, audio: audioFile(), data: { request_id: requestId, model, audio: Object.fromEntries(Object.entries(audioFile()).reverse()) } })],
    ['equivalent string and object audio branches', () => ({ request_id: requestId, model, audio: mediaUrl, data: { audio: { content_type: 'audio/mpeg', url: mediaUrl } } })],
  ]) {
    test(`${mode}: ${name} preserves original completion`, async t => {
      const f = fixture(t, mode, body());
      const audio = await f.run();
      assertObservedOriginal(f, mode);
      assert.equal(audio.providerJobId, requestId); assert.equal(audio.costMicrousd, costMicrousd); assert.deepEqual(audio.bytes, bytes);
      assert.deepEqual(f.calls, [...(mode === 'native' ? [{ url: submitUrl, method: 'POST' }] : []), { url: statusUrl, method: 'GET' }, { url: resultUrl, method: 'GET' }, { url: mediaUrl, method: 'GET' }]);
    });
  }
}

for (const mode of ['legacy-generation', 'legacy-recovery']) {
  for (const [name, body] of contradictions) {
    test(`${mode}: existing acquisition without a cost observer retains ${name} compatibility`, async t => {
      const f = fixture(t, mode, body());
      const audio = await f.run();
      assert.deepEqual(f.observations, []); assert.deepEqual(f.receipts, []);
      assert.equal(audio.providerJobId, requestId); assert.equal(audio.costMicrousd, costMicrousd); assert.deepEqual(audio.bytes, bytes);
      assert.deepEqual(f.calls, [...(!f.recovery ? [{ url: submitUrl, method: 'POST' }] : []), { url: statusUrl, method: 'GET' }, { url: resultUrl, method: 'GET' }, { url: mediaUrl, method: 'GET' }]);
    });
  }
}
