import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';

const sourceHook = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('.') && !context.parentURL?.includes('/node_modules/') && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + '.ts' : specifier, context);
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('AUDIO_V8_TEST_EGRESS_DENIED'); };
after(() => { sourceHook.deregister(); globalThis.fetch = originalFetch; });
const [audioAdapter, { createAudioOutputContract }, { EXPERIENCE_AUDIO_INTENT }, { MAX_AUDIO_UPLOAD_BYTES }] = await Promise.all([
  import('../worker/fal-audio-adapter.ts'),
  import('../src/model/output-audio-contract.ts'),
  import('../src/experiences/contracts.ts'),
  import('../src/model/audio.ts'),
]);
const { generateCreativeAudio, recoverAcceptedAudio } = audioAdapter;

const model = 'fal-ai/stable-audio-3/medium/text-to-audio';
const requestId = 'audio-v8-original-request';
const submitUrl = `https://queue.fal.run/${model}`;
const resultUrl = `https://queue.fal.run/fal-ai/stable-audio-3/requests/${requestId}`;
const statusUrl = `${resultUrl}/status?logs=1`;
const mediaUrl = 'https://v3b.fal.media/files/audio-v8-synthetic.mp3';
const prompt = 'Quiet instrumental piano with a gentle ending.';
const bytes = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);
const costMicrousd = 37_600;
const environment = { FAL_KEY: 'synthetic-test-key-no-provider-access' };
const contract = createAudioOutputContract({
  draftId: 'experience-draft-' + 'd'.repeat(64), draftHash: 'sha256:' + 'a'.repeat(64),
  releaseHash: 'sha256:' + 'b'.repeat(64), requestHash: 'sha256:' + 'c'.repeat(64),
  sourceBindingHash: 'sha256:' + 'e'.repeat(64),
});
assert.ok(contract);

const resultBody = () => ({
  request_id: requestId,
  audio: { url: mediaUrl, content_type: 'audio/mpeg', duration: 20, file_size: bytes.length },
});
const expectedObservation = {
  provider: 'fal', model, providerRequestId: requestId, costMicrousd,
  costBasis: 'published-audio-rate', inputTokens: 0, outputTokens: 0, totalTokens: 0,
};

function recoveryOptions() {
  return {
    providerJobId: requestId, providerModel: model,
    providerStatusUrl: `${resultUrl}/status`, providerResponseUrl: resultUrl, providerCancelUrl: `${resultUrl}/cancel`,
    profile: EXPERIENCE_AUDIO_INTENT,
    retainedReceipt: {
      provider: 'fal', model, submittedPrompt: prompt,
      parameters: { published_cost_microusd: costMicrousd, duration_seconds: 20, goal: 'timed_music', destination: 'standalone' },
      imageReference: null, sourceAudioTreatment: 'none', audioWaveformSubmitted: false,
    },
  };
}

/** Synthetic responses only. An unlisted URL or method never reaches real fetch. */
function providerFixture(t, mode, scenario = {}) {
  const calls = [], events = [], observations = [], receipts = [], capturedRequests = [], fixtureViolations = [];
  const env = scenario.environment ?? environment;
  t.after(() => assert.deepEqual(fixtureViolations, [], 'Provider error handling must not conceal fixture/egress assertion failures'));
  t.mock.method(globalThis, 'fetch', async (value, init = {}) => {
    try {
      const url = String(value), method = init.method ?? 'GET';
      calls.push({ url, method });
      events.push(`fetch:${url}`);
      assert.equal(init.redirect, 'manual');
      if (mode === 'recovery') {
        assert.equal(method, 'GET', 'Recovery must never submit, upload, or cancel');
        assert.equal(init.body, undefined, 'Recovery must not upload source bytes');
      }
      if (url === submitUrl && mode === 'native' && method === 'POST') {
        assert.equal(capturedRequests.length, 1);
        assert.equal(capturedRequests[0].requestBody, init.body);
        assert.equal(capturedRequests[0].requestDigest, createHash('sha256').update(init.body).digest('hex'));
        const body = JSON.parse(init.body);
        assert.equal(body.duration, 20);
        assert.equal(body.prompt, prompt);
        assert.equal(body.enable_safety_checker, true);
        return Response.json(scenario.submission ?? { request_id: requestId });
      }
      assert.equal(method, 'GET', 'Only the native original queue submission may use POST');
      assert.equal(init.body, undefined);
      if (url === statusUrl) return Response.json(scenario.status ?? { status: 'COMPLETED', request_id: requestId });
      if (url === resultUrl) {
        await scenario.beforeResult?.();
        return Response.json(scenario.result ?? resultBody(), { status: scenario.resultStatus ?? 200 });
      }
      if (url === mediaUrl) {
        assert.equal(new Headers(init.headers).has('authorization'), false);
        return scenario.download ? scenario.download() : new Response(bytes, { headers: { 'content-type': 'audio/mpeg' } });
      }
      throw Error(`AUDIO_V8_TEST_EGRESS_DENIED: ${method} ${url}`);
    } catch (error) {
      fixtureViolations.push(error.message);
      throw error;
    }
  });
  const observe = async observation => {
    observations.push(observation);
    events.push('completed-observation');
    await scenario.onObservation?.(observation);
  };
  const beforeSourceTransmission = async () => { await scenario.beforeSourceTransmission?.({ calls, observations }); };
  const run = () => mode === 'native'
    ? generateCreativeAudio(env, prompt, {
      outputAudio: contract, profile: EXPERIENCE_AUDIO_INTENT, providerModel: model, estimatedCostMicrousd: costMicrousd,
      onBeforeProviderAttempt: async () => {}, onBeforeProviderDispatch: () => {},
      onBeforeSourceTransmission: beforeSourceTransmission, onOutputAudioRequest: async request => { capturedRequests.push(request); },
      onProviderSubmission: async receipt => {
        receipts.push(receipt);
        if (receipt.status === 'completed') await observe(receipt);
      },
    })
    : recoverAcceptedAudio(env, { ...recoveryOptions(), ...scenario.recoveryOptions, onBeforeSourceTransmission: beforeSourceTransmission, onCompletedResult: observe });
  return { calls, events, observations, receipts, capturedRequests, run };
}

test('original completed result observation cannot be fabricated, copied, rebound, or mutated', async t => {
  const env = { ...environment, DB: { identity: 'synthetic-original-db' } };
  const fixture = providerFixture(t, 'recovery', { environment: env });
  await fixture.run();
  assertOriginalObservation(fixture, 'recovery');
  const observation = fixture.observations[0];
  const identity = { model, providerRequestId: requestId };
  const read = audioAdapter.readAudioCompletedResultObservation;
  assert.equal(typeof read, 'function');
  assert.doesNotThrow(() => read(observation, env, identity));
  assert.equal(Object.isFrozen(observation), true);
  assert.throws(() => { observation.costMicrousd = 0; }, TypeError);
  const invalid = error => error.message === 'output_audio_result_observation_invalid';
  for (const fabricated of [undefined, null, {}, expectedObservation, { ...observation }, structuredClone(observation)]) {
    assert.throws(() => read(fabricated, env, identity), invalid);
  }
  assert.throws(() => read(observation, { ...env }, identity), invalid);
  assert.throws(() => read(observation, env, { ...identity, model: 'fal-ai/lyria3' }), invalid);
  assert.throws(() => read(observation, env, { ...identity, providerRequestId: 'foreign-original-request' }), invalid);
  const originalDb = env.DB;
  env.DB = { identity: 'synthetic-replacement-db' };
  assert.throws(() => read(observation, env, identity), invalid);
  env.DB = originalDb;
  assert.doesNotThrow(() => read(observation, env, identity));
});

function assertOriginalObservation(fixture, mode) {
  assert.equal(fixture.observations.length, 1, 'Known original completed result must be observed exactly once');
  const observation = fixture.observations[0];
  for (const [key, value] of Object.entries(expectedObservation)) {
    if (mode === 'native' && key === 'costBasis') continue;
    assert.equal(observation[key], value, `Original completed result ${key}`);
  }
  if (mode === 'native') {
    assert.deepEqual(fixture.receipts.map(receipt => receipt.status), ['pending', 'accepted', 'completed']);
    const accepted = fixture.receipts[1];
    assert.equal(fixture.capturedRequests.length, 1);
    const captured = fixture.capturedRequests[0];
    assert.match(captured.clientRequestId, /^forma-audio-[a-z0-9-]+$/u);
    assert.match(captured.requestDigest, /^[a-f0-9]{64}$/u);
    for (const receipt of [accepted, observation]) {
      assert.equal(receipt.clientRequestId, captured.clientRequestId);
      assert.equal(receipt.requestDigest, captured.requestDigest);
      assert.equal(receipt.operation, 'audio');
    }
    assert.equal(observation.unitId, 'audio:initial');
  }
  assert.equal(fixture.calls.filter(call => call.method === 'POST').length, mode === 'native' ? 1 : 0);
  const observedAt = fixture.events.indexOf('completed-observation');
  const resultAt = fixture.events.indexOf(`fetch:${resultUrl}`);
  const mediaAt = fixture.events.indexOf(`fetch:${mediaUrl}`);
  assert.ok(observedAt > resultAt, 'Only the fetched original result can establish completed cost');
  assert.ok(mediaAt < 0 || observedAt < mediaAt, 'Completed cost must be observed before any media download');
}

for (const mode of ['native', 'recovery']) {
  test(`${mode}: original completed result cost is observed before media and never observed twice`, async t => {
    const fixture = providerFixture(t, mode);
    const audio = await fixture.run();
    assertOriginalObservation(fixture, mode);
    assert.equal(audio.costMicrousd, costMicrousd);
    assert.equal(audio.providerJobId, requestId);
    assert.deepEqual(audio.bytes, bytes);
    assert.deepEqual(fixture.calls.map(call => call.url), [...(mode === 'native' ? [submitUrl] : []), statusUrl, resultUrl, mediaUrl]);
  });

  for (const [name, scenario] of [
    ['completed status', { status: { status: 'COMPLETED' } }],
    ['result', { result: { audio: resultBody().audio } }],
  ]) {
    test(`${mode}: canonical original queue remains bound without optional ${name} ID echo`, async t => {
      const fixture = providerFixture(t, mode, scenario);
      const audio = await fixture.run();
      assertOriginalObservation(fixture, mode);
      assert.equal(audio.providerJobId, requestId);
      assert.deepEqual(fixture.calls.map(call => call.url), [...(mode === 'native' ? [submitUrl] : []), statusUrl, resultUrl, mediaUrl]);
    });
  }

  for (const [name, scenario, code] of [
    ['failed media download', { download: () => new Response(null, { status: 503 }) }, 'fal_audio_download_failed'],
    ['oversized advertised media', { download: () => new Response(bytes, { headers: { 'content-type': 'audio/mpeg', 'content-length': String(MAX_AUDIO_UPLOAD_BYTES + 1) } }), result: { ...resultBody(), audio: { ...resultBody().audio, file_size: MAX_AUDIO_UPLOAD_BYTES + 1 } } }, 'fal_audio_too_large'],
    ['invalid downloaded type', { download: () => new Response(bytes, { headers: { 'content-type': 'text/html' } }) }, 'fal_audio_type_invalid'],
    ['empty media', { download: () => new Response(new Uint8Array(), { headers: { 'content-type': 'audio/mpeg' } }) }, 'fal_audio_empty'],
    ['invalid media URL', { result: { ...resultBody(), audio: { ...resultBody().audio, url: 'not-a-url' } } }, 'fal_audio_url_invalid'],
    ['untrusted media URL', { result: { ...resultBody(), audio: { ...resultBody().audio, url: 'https://untrusted.invalid/original.mp3' } } }, 'fal_audio_url_untrusted'],
  ]) {
    test(`${mode}: ${name} cannot erase known original completed result cost`, async t => {
      const fixture = providerFixture(t, mode, scenario);
      await assert.rejects(fixture.run(), error => error.detail?.code === code && error.detail?.requestId === requestId);
      assertOriginalObservation(fixture, mode);
      if (name.endsWith('media URL')) assert.deepEqual(fixture.calls.map(call => call.url), [...(mode === 'native' ? [submitUrl] : []), statusUrl, resultUrl]);
    });
  }

  test(`${mode}: failed cost-observation persistence stops before media GET`, async t => {
    const stopped = Error('synthetic-observation-persistence-failed');
    const fixture = providerFixture(t, mode, { onObservation: async () => { throw stopped; } });
    await assert.rejects(fixture.run(), error => error === stopped);
    assertOriginalObservation(fixture, mode);
    assert.equal(fixture.calls.some(call => call.url === mediaUrl), false);
  });

  test(`${mode}: source authority withdrawn after completion preserves observed cost and prevents media GET`, async t => {
    const stopped = Error('synthetic-current-source-authority-withdrawn');
    const fixture = providerFixture(t, mode, { beforeSourceTransmission: async ({ observations }) => { if (observations.length) throw stopped; } });
    await assert.rejects(fixture.run(), error => error === stopped);
    assertOriginalObservation(fixture, mode);
    assert.deepEqual(fixture.calls.map(call => call.url), [...(mode === 'native' ? [submitUrl] : []), statusUrl, resultUrl]);
  });

  test(`${mode}: database replacement during result fetch cannot mint a completed result observation`, async t => {
    const env = { ...environment, DB: { identity: 'synthetic-original-db' } };
    const fixture = providerFixture(t, mode, { environment: env, beforeResult: () => { env.DB = { identity: 'synthetic-replacement-db' }; } });
    await assert.rejects(fixture.run(), error => error.detail?.code === 'fal_audio_receipt_mismatch' && error.detail?.requestId === requestId);
    assert.equal(fixture.observations.length, 0);
    assert.deepEqual(fixture.calls.map(call => call.url), [...(mode === 'native' ? [submitUrl] : []), statusUrl, resultUrl]);
  });

  for (const [name, scenario, code, terminalUrl] of [
    ['contradictory completed status identity', { status: { status: 'COMPLETED', request_id: 'foreign-request' } }, 'fal_audio_receipt_mismatch', statusUrl],
    ['contradictory result identity', { result: { ...resultBody(), request_id: 'foreign-request' } }, 'fal_audio_receipt_mismatch', resultUrl],
    ['contradictory completed status model', { status: { status: 'COMPLETED', request_id: requestId, model: 'fal-ai/lyria3/pro' } }, 'fal_audio_receipt_mismatch', resultUrl],
    ['contradictory result model', { result: { ...resultBody(), model: 'fal-ai/lyria3/pro' } }, 'fal_audio_receipt_mismatch', resultUrl],
    ['provider status error', { status: { status: 'COMPLETED', request_id: requestId, error: 'synthetic-provider-error' } }, 'fal_audio_result_rejected', statusUrl],
    ['provider result error', { result: { ...resultBody(), error: 'synthetic-provider-error' } }, 'fal_audio_result_rejected', resultUrl],
    ['missing audio result evidence', { result: { request_id: requestId } }, 'fal_audio_result_missing', resultUrl],
    ['provider HTTP error', { result: { request_id: requestId, error: { code: 'fal_audio_synthetic_failure', message: 'synthetic-provider-error' } }, resultStatus: 502 }, 'fal_audio_synthetic_failure', resultUrl],
  ]) {
    test(`${mode}: ${name} cannot establish a completed cost observation`, async t => {
      const fixture = providerFixture(t, mode, scenario);
      await assert.rejects(fixture.run(), error => error.detail?.code === code && error.detail?.requestId === requestId);
      assert.equal(fixture.observations.length, 0);
      assert.equal(fixture.calls.filter(call => call.method === 'POST').length, mode === 'native' ? 1 : 0);
      assert.equal(fixture.calls.some(call => call.url === mediaUrl), false);
      assert.deepEqual(fixture.calls.map(call => call.url), [...(mode === 'native' ? [submitUrl] : []), statusUrl, ...(terminalUrl === resultUrl ? [resultUrl] : [])]);
    });
  }
}

test('native: missing original accepted request identity never observes completed cost or reads result', async t => {
  const fixture = providerFixture(t, 'native', { submission: {} });
  await assert.rejects(fixture.run(), error => error.detail?.code === 'fal_audio_submission_receipt_missing');
  assert.equal(fixture.observations.length, 0);
  assert.deepEqual(fixture.calls, [{ url: submitUrl, method: 'POST' }]);
});

for (const [name, options] of [
  ['missing original request identity', { providerJobId: '' }],
  ['noncanonical original status location', { providerStatusUrl: `${resultUrl}/foreign-status` }],
  ['noncanonical original result location', { providerResponseUrl: `${resultUrl}/foreign-result` }],
]) {
  test(`recovery: ${name} refuses before any GET or observation`, async t => {
    const fixture = providerFixture(t, 'recovery', { recoveryOptions: options });
    await assert.rejects(fixture.run(), error => error.detail?.code === 'audio_recovery_receipt_invalid');
    assert.equal(fixture.observations.length, 0);
    assert.deepEqual(fixture.calls, []);
  });
}
