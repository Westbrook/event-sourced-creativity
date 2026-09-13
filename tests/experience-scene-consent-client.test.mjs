import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeExperienceBinding, ExperienceOutputBindingClient } from '../src/experiences/output-binding-client.ts';
import { scenePreflightFixture } from './helpers/scene-output-fixture.mjs';
import { outputScenePreflightConfiguration } from '../worker/output-scene-preflight-contract.ts';

function fixture() {
  const identity = {draftId: 'experience-draft-' + 'a'.repeat(64), draftHash: 'sha256:' + 'b'.repeat(64),
    releaseHash: 'sha256:' + 'c'.repeat(64), documentId: 'document-1', projectId: 'project-1', output: 'scene', actorUserId: 'actor-1'};
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const preview = {version: 'scene-mini-app-cost-v1', requestId: 'original-request', actorUserId: identity.actorUserId,
    projectId: identity.projectId, documentId: identity.documentId, contextSessionId: null, permissionEpoch: 'epoch-1', period: '2026-09',
    requestHash: 'd'.repeat(64), sourceHash: 'e'.repeat(64), provider: 'openai', model: 'gpt-5.6-terra',
    sceneMedium: 'visual', productionMode: 'manual', itemCount: 1, reusedSourceCount: 0, providerCallCount: 1,
    maximumProviderCallCount: 1, maximumMicrousd: 1000000, maximumInputTokens: 30000, maximumOutputTokens: 3000,
    maximumTokens: 128000, sceneContractDigest: 'sha256:' + 'f'.repeat(64), executionContractDigest: 'sha256:' + 'a'.repeat(64),
    expiresAt, bindingHash: 'b'.repeat(64)};
  const plan = {revisionId: 'plan-1', targetId: 'target-1', targetContractDigest: 'target-sha', sourceDigest: 'source-sha', requirementsDigest: 'requirements-sha'};
  const state = {version: 1, ...identity, sourceSurface: 'outputs', status: 'review', disposition: 'prepared',
    current: {custody: 'verified', source: 'verified', sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest},
    stage: 'preflight', plan, preflight: {id: 'preflight-1', planRevisionId: plan.revisionId, termsDigest: 'terms-1',
      sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest, createdAt: new Date().toISOString(), expiresAt,
      maximumMicrousd: 1000000, maximumCalls: 1, targets: [{targetId: plan.targetId}], operationAttempts: {}},
    grant: null, original: null, sceneCostPreview: preview, permitted: {prepare: false, authorize: true, run: false, resumeRun: false}};
  return {identity, state, preview};
}
function clientFixture(f) {
  const calls = [], origin = 'https://forma.invalid';
  const client = new ExperienceOutputBindingClient(f.identity, {origin, current: () => true,
    request: async (path, init) => {
      calls.push({path, method: init.method, body: init.body === undefined ? null : JSON.parse(init.body)});
      const response = new Response(JSON.stringify(f.state), {headers: {'content-type': 'application/json'}});
      Object.defineProperty(response, 'url', {value: origin + path}); return response;
    }});
  return {client, calls};
}
test('actual closed Scene preflight schema fits bounded client decoding without widening other output depths', async () => {
  const f = fixture(), payload = await scenePreflightFixture();
  const ready = await outputScenePreflightConfiguration('target-1', payload, Date.parse('2026-09-13T04:00:00Z'));
  f.state.preflight.targets = [ready]; f.state.sceneCostPreview = payload.outputScene.costPreview;
  assert.ok(decodeExperienceBinding(f.state, f.identity));
  const deep = structuredClone(f.state); let pointer = deep;
  for (let index = 0; index < 26; index++) {pointer.extra = {}; pointer = pointer.extra;}
  assert.equal(decodeExperienceBinding(deep, f.identity), null);
  const other = {...f.state, output: 'short_story'}; delete other.sceneCostPreview;
  assert.equal(decodeExperienceBinding(other, {...f.identity, output: 'short_story'}), null);
});
// Synthetic transport only, not retained server consent or native admission.
test('Scene binding requires its separate actor/Document-bound preview and refuses legacy or mixed-output metadata', () => {
  const f = fixture(); assert.ok(decodeExperienceBinding(f.state, f.identity));
  for (const patch of [{sceneCostPreview: undefined}, {sceneCostPreview: null},
    {sceneCostPreview: {...f.preview, actorUserId: 'another'}}, {sceneCostPreview: {...f.preview, documentId: 'another'}},
    {sceneCostPreview: {...f.preview, projectId: 'another'}}, {sceneCostPreview: {...f.preview, version: 'scene-cost-v1'}},
    {preflight: {...f.state.preflight, maximumMicrousd: 2000000}}]) {
    assert.equal(decodeExperienceBinding({...f.state, ...patch}, f.identity), null);
  }
  assert.equal(decodeExperienceBinding({...f.state, output: 'image'}, {...f.identity, output: 'image'}), null);
  const absent = {...f.state, status: 'absent', disposition: 'never_admitted', stage: null, plan: null, preflight: null,
    sceneCostPreview: null, permitted: {prepare: true, authorize: false, run: false, resumeRun: false}};
  assert.ok(decodeExperienceBinding(absent, f.identity));
});
test('Scene transport never synthesizes consent and sends it only on deliberate exact Authorize', async () => {
  const f = fixture(), {client, calls} = clientFixture(f);
  try {
    const shown = await client.read(); assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET'); assert.equal(calls[0].body, null);
    assert.equal(await client.command('authorize', shown), shown); assert.equal(calls.length, 1);
    assert.equal(await client.command('authorize', shown, {...f.preview, confirmed: true, requestId: 'different'}), shown);
    assert.equal(calls.length, 1);
    const approval = {...f.preview, confirmed: true};
    await client.command('authorize', shown, approval); assert.equal(calls.length, 2);
    assert.match(calls[1].path, /\/output\/authorize$/);
    assert.deepEqual(calls[1].body, {draftHash: f.identity.draftHash, termsDigest: f.state.preflight.termsDigest,
      maximumMicrousd: 1000000, explicitAuthorization: true, sceneCostConsent: approval});
    await client.command('authorize', shown, approval); assert.equal(calls.length, 2, 'old displayed state cannot authorize again');
  } finally {client.dispose();}
});
test('expired Scene disclosure remains readable but cannot be approved; prepare cannot transport consent', async () => {
  const f = fixture(); f.preview.expiresAt = new Date(Date.now() - 1).toISOString();
  const {client, calls} = clientFixture(f);
  try {
    const shown = await client.read(); assert.equal(shown.status, 'review');
    await client.command('authorize', shown, {...f.preview, confirmed: true}); assert.equal(calls.length, 1);
  } finally {client.dispose();}
  const next = fixture();
  next.state = {...next.state, status: 'absent', disposition: 'never_admitted', stage: null, plan: null, preflight: null,
    sceneCostPreview: null, permitted: {prepare: true, authorize: false, run: false, resumeRun: false}};
  const transport = clientFixture(next);
  try {
    const shown = await transport.client.read();
    await transport.client.command('prepare', shown, {...next.preview, confirmed: true}); assert.equal(transport.calls.length, 1);
    await transport.client.command('prepare', shown); assert.equal(transport.calls.length, 2);
    assert.deepEqual(transport.calls[1].body, {draftHash: next.identity.draftHash, explicitRequirementsConfirmation: true});
  } finally {transport.client.dispose();}
});
