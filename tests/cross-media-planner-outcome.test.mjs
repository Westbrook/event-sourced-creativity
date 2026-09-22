import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDocumentArtifact } from '../worker/openai-adapter.ts';
import { hasUnsettledProviderSubmission, mergeProviderSubmissions } from '../src/model/provider-submission.ts';
import { plannerEnvelope, stoppedPlannerEnvelopes } from './planner-response-outcome-fixtures.mjs';
const env = { OPENAI_API_KEY: 'unusable-offline-fixture' };
const input = options => ({ documentTitle: 'Synthetic document', snapshot: { facts: [] }, options: { productionMode: 'manual', itemCount: 1, ...options } });
for (const kind of ['short_story', 'scene', 'slides', 'storyboard', 'audio', 'video']) {
  for (const [name, change, problem] of stoppedPlannerEnvelopes) test(`${kind}: ${name} stops before repair/media, with original accounting`, async t => {
    const requests = [], submissions = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      requests.push({url, body: init.body});
      assert.equal(url, 'https://api.openai.com/v1/responses');
      return Response.json(plannerEnvelope(change));
    });
    await assert.rejects(generateDocumentArtifact(env, 'owner', kind, input({ onProviderSubmission: r => submissions.push(r) })), error => {
      assert.equal(error.detail?.outcome?.contentOutcome, problem === 'refused' ? 'refused' : problem === 'incomplete' ? 'invalid' : 'unknown');
      assert.equal(error.detail.pipelineStage, 'planner');
      assert.equal(error.detail.outcome.accountingState, 'usage_recorded');
      return true;
    });
    assert.equal(requests.length, 1, 'no repair or downstream submission');
    assert.equal(submissions.at(-1).status, 'completed');
    assert.equal(submissions.at(-1).totalTokens, 14);
    assert(submissions.at(-1).costMicrousd > 0);
  });
}
test('refusal with missing usage keeps unknown exposure and is not misreported as missing usage', async t => {
  let ledger = {}, count = 0;
  t.mock.method(globalThis, 'fetch', async () => { count++; return Response.json(plannerEnvelope({ ...stoppedPlannerEnvelopes[0][1], usage: undefined })); });
  await assert.rejects(generateDocumentArtifact(env, 'owner', 'video', input({ onProviderSubmission: r => { ledger = mergeProviderSubmissions(ledger, {[r.clientRequestId]: r}); } })), e => e.detail.code === 'provider_planner_refusal');
  assert.equal(count, 1);
  const receipt = Object.values(ledger)[0];
  assert.equal(receipt.costMicrousd, undefined);
  assert.equal(receipt.totalTokens, undefined);
  assert.equal(receipt.accountingState, 'unknown');
  assert.equal(receipt.contentOutcome, 'refused');
  assert(hasUnsettledProviderSubmission({providerSubmissions: ledger}));
});
test('private response storage failure follows durable financial completion', async t => {
  const order = [], calls = [];
  t.mock.method(globalThis, 'fetch', async () => Response.json(plannerEnvelope()));
  await assert.rejects(generateDocumentArtifact(env, 'owner', 'scene', input({
    onProviderSubmission: r => { calls.push(r); order.push(r.status); },
    onProviderResponse: () => { order.push('private-write'); throw Error('synthetic storage failure'); },
  })), /synthetic storage failure/);
  assert.deepEqual(order, ['pending', 'completed', 'private-write']);
  assert.equal(calls.at(-1).totalTokens, 14);
  assert(calls.at(-1).costMicrousd > 0);
  assert.equal(calls.at(-1).contentOutcome, 'unknown', 'retention failure does not invent refusal or artifact acceptance');
});

test('3D remains on its dedicated adapter without a generic planner purchase', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected provider call'));
  await assert.rejects(generateDocumentArtifact(env, 'owner', 'model3d', input({})), /model3d_dedicated_adapter_required/);
});

test('native Audio applies upstream outcomes before its strict usage and artifact checks', async t => {
  const { createAudioOutputContract } = await import('../src/model/output-audio-contract.ts');
  const { EXPERIENCE_AUDIO_INTENT } = await import('../src/experiences/contracts.ts');
  const contract = createAudioOutputContract({draftId:'experience-draft-'+'d'.repeat(64),draftHash:'sha256:'+'a'.repeat(64),releaseHash:'sha256:'+'b'.repeat(64),requestHash:'sha256:'+'c'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)});
  for (const [, change, problem] of stoppedPlannerEnvelopes) {
    let calls = 0; const receipts = [];
    t.mock.method(globalThis, 'fetch', async url => {calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); return Response.json(plannerEnvelope({...change, usage: undefined}));});
    await assert.rejects(generateDocumentArtifact(env, 'owner', 'audio', input({outputAudio:contract,audioProfile:EXPERIENCE_AUDIO_INTENT,
      audioProviderModel:'fal-ai/stable-audio-3/medium/text-to-audio',onBeforeProviderAttempt(){},onBeforeProviderDispatch(){},onProviderSubmission(r){receipts.push(r);},onProviderResponse(){},
    })), e => e.detail?.outcome?.contentOutcome === (problem === 'refused' ? 'refused' : problem === 'incomplete' ? 'invalid' : 'unknown'));
    assert.equal(calls, 1); assert.equal(receipts.at(-1).costMicrousd, undefined); assert.equal(receipts.at(-1).accountingState, 'unknown');
  }
});
