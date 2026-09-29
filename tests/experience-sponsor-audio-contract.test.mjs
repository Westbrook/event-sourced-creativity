import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
const imports = registerOutputSourceImports();
after(() => imports.deregister());
const [contract, { digest }, { EXPERIENCE_AUDIO_INTENT }, { AUDIO_OUTPUT_POLICY, createAudioOutputContract },
  { STABLE_AUDIO_ADAPTER_CONTRACT, estimateAudioProviderCostMicrousd }, { OUTPUT_NATIVE_EXECUTION_POLICY },
  { OPENAI_TEXT_PRICING_VERSION, estimateOpenAITextCallMaximumMicrousd }, { audioPreparationConstraints }] = await Promise.all([
  import('../worker/experience-sponsor-audio-contract.ts'), import('../src/experiences/compiler.ts'),
  import('../src/experiences/contracts.ts'), import('../src/model/output-audio-contract.ts'), import('../src/model/audio.ts'),
  import('../src/model/output-execution-policy.ts'), import('../worker/openai-text-cost.ts'), import('../worker/audio-prompt-adapter.ts'),
]);
const audioModel = 'fal-ai/stable-audio-3/medium/text-to-audio';
const plannerCost = input => Math.max(500000, estimateOpenAITextCallMaximumMicrousd('gpt-5.6-terra', input, 3000));
const audioCost = estimateAudioProviderCostMicrousd(STABLE_AUDIO_ADAPTER_CONTRACT, EXPERIENCE_AUDIO_INTENT);
const sha = digit => `sha256:${digit.repeat(64)}`;
const template = () => ({ version: 1, family: 'canonical-instrumental-cue@1', appId: 'audio', recipeVersion: 'audio@1', releaseDigest: sha('a'),
  outputKind: 'audio', inputMode: 'authorized-document-text', outputCount: 1, durationMs: 20000, width: 0, height: 0,
  route: 'document-audio-timed-music-manual-v1', maximumCalls: 3, maximumTokens: 128000, maximumMicrousd: 2 * plannerCost(61000) + audioCost,
  calls: [
    { stage: 'planning:0:initial', provider: 'openai', model: 'gpt-5.6-terra', optional: false, maximumInputTokens: 61000, maximumOutputTokens: 3000, maximumMicrousd: plannerCost(61000) },
    { stage: 'planning:0:repair', provider: 'openai', model: 'gpt-5.6-terra', optional: true, maximumInputTokens: 61000, maximumOutputTokens: 3000, maximumMicrousd: plannerCost(61000) },
    { stage: 'audio:initial', provider: 'fal', model: audioModel, optional: false, maximumMicrousd: audioCost },
  ], audioContract: structuredClone(AUDIO_OUTPUT_POLICY),
  mediaRequest: { duration: 20, output_format: 'mp3', enable_safety_checker: true, negative_prompt: 'singing, vocals, spoken dialogue' },
  sourceFilesTransferred: 0, pricingVersion: OPENAI_TEXT_PRICING_VERSION, adapterVersion: STABLE_AUDIO_ADAPTER_CONTRACT.adapterVersion,
  executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY, transferDescription: contract.SPONSOR_AUDIO_TRANSFER_DESCRIPTION,
});
async function redigest(actual) {
  actual.recipe.routeDigest = await digest(actual.offered);
  actual.recipe.settingsDigest = await digest(actual.offered.settings);
}
// Pure synthetic review material. The separate native evidence test supplies
// actual intake, source, quote and principal proof; this fixture asserts none.
async function fixture({ input = 41000, expiresAt = new Date(Date.now() + 600000).toISOString() } = {}) {
  const cap = template(), original = { requestId: `audio-${'b'.repeat(64)}`, expiresAt, draftId: `experience-draft-${'c'.repeat(64)}`,
    actorUserId: 'synthetic-actor', projectId: 'synthetic-project', documentId: 'synthetic-document', sourceDigest: 'd'.repeat(64), requirementsDigest: 'e'.repeat(64) };
  const maximumMicrousd = 2 * plannerCost(input) + audioCost;
  const preview = { version: 'audio-mini-app-cost-v1', ...original, maximumMicrousd, maximumCalls: 3, maximumTokens: 128000,
    planningModel: 'gpt-5.6-terra', maximumPlanningCalls: 2, maximumOutputTokens: 3000, audioModel, maximumAudioCalls: 1,
    durationSeconds: 20, requireInstrumental: true, sourceFilesTransferred: 0 };
  const outputAudio = createAudioOutputContract({ draftId: original.draftId, draftHash: sha('1'), releaseHash: cap.releaseDigest,
    requestHash: sha('2'), sourceBindingHash: sha('3') });
  assert.ok(outputAudio);
  const settings = { kind: 'render_document', payload: { productionMode: 'manual', artifactKind: 'audio', itemCount: 1,
    audioProfile: EXPERIENCE_AUDIO_INTENT, audioProviderModel: audioModel, audioEstimatedCostMicrousd: audioCost,
    outputTargetInstructions: 'Create one instrumental track from the authored musical direction.', outputAudio },
    calls: ['planning:0:initial', 'planning:0:repair'].map(stage => ({ stage, provider: 'openai', model: 'gpt-5.6-terra',
      maximumInputTokens: input, maximumOutputTokens: 3000, maximumMicrousd: plannerCost(input) })),
    preparationOnly: false, explicitCostAndTransferApprovalRequired: true, executionAvailable: true, costPreview: preview,
    executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY, original,
    constraints: audioPreparationConstraints({ facts: [] }, { profile: EXPERIENCE_AUDIO_INTENT, model: audioModel }),
    duration: { requestedSeconds: 20, measuredSeconds: null } };
  settings.calls.push({ stage: 'audio:initial', provider: 'fal', model: audioModel, maximumMicrousd: audioCost });
  const actual = { recipe: { appId: 'audio', recipeVersion: 'audio@1', releaseDigest: cap.releaseDigest, outputKind: 'audio',
    provider: 'fal', model: audioModel, routeDigest: sha('0'), settingsDigest: sha('0'), outputCount: 1, durationMs: 20000,
    width: 0, height: 0, calls: { parsing: 0, planning: 1, render: 1, repair: 1 }, maximumTokens: 128000, maximumMicrousd },
    offered: { targetId: 'synthetic-audio-target', available: true, reasonCode: 'output_audio_ready_for_separate_approval',
      reason: '1 instrumental track · 20-second target, not measured duration · review cost and transfer before Start',
      transferCode: 'output_transfer_audio_not_yet_authorized', transferDescription: cap.transferDescription, provider: 'fal', model: audioModel,
      route: cap.route, maximumMicrousd, maximumCalls: 3, maximumTokens: 128000, settings },
    consent: { ...preview, confirmed: true, providerTransferConfirmed: true } };
  await redigest(actual);
  return { cap: structuredClone(cap), actual: structuredClone(actual) };
}

test('exact Audio template captures one optional repair, native prices and one shared token reservation', async () => {
  const { cap, actual } = await fixture();
  const reviewed = contract.readSponsorAudioCampaignTemplate(cap);
  assert.equal(contract.recipeMatchesSponsorAudioTemplate(reviewed, actual.recipe), true);
  assert.equal(await contract.matchSponsorAudioTemplate(reviewed, actual), true);
  assert.deepEqual(reviewed.calls.map(call => call.optional), [false, true, false]);
  assert.deepEqual(actual.recipe.calls, { parsing: 0, planning: 1, render: 1, repair: 1 });
  assert.equal(reviewed.maximumTokens, 128000);
  assert.equal(reviewed.maximumMicrousd, 2 * plannerCost(61000) + audioCost);
  assert.ok(Object.isFrozen(reviewed.calls[0])); assert.ok(Object.isFrozen(reviewed.mediaRequest));
  cap.calls[0].maximumInputTokens = 1;
  assert.equal(reviewed.calls[0].maximumInputTokens, 61000);
  assert.equal(Object.hasOwn(actual, 'wireDigest'), false);
  assert.deepEqual(actual.offered.settings.duration, { requestedSeconds: 20, measuredSeconds: null });
  for (const input of [25000, 61000]) {
    const boundary = await fixture({ input });
    assert.equal(await contract.matchSponsorAudioTemplate(boundary.cap, boundary.actual), true);
  }
});

test('template refuses widened media, call, transfer and pricing terms', () => {
  const mutations = [x => x.version = 8, x => x.family = 'generic-audio@1', x => x.appId = 'video', x => x.recipeVersion = 'audio@0',
    x => x.releaseDigest = 'a'.repeat(64), x => x.outputKind = 'video', x => x.inputMode = 'reference', x => x.outputCount = 2,
    x => x.durationMs = 30000, x => x.width = 1, x => x.height = 1, x => x.route = 'generic-media',
    x => x.maximumCalls = 2, x => x.maximumTokens = 384000, x => x.maximumMicrousd++, x => x.calls[0].optional = true,
    x => x.calls[1].optional = false, x => x.calls[2].optional = true, x => x.calls.reverse(), x => x.calls.push(x.calls[2]),
    x => x.calls[0].maximumInputTokens++, x => x.calls[1].maximumOutputTokens++, x => x.calls[2].maximumTokens = 0,
    x => x.calls[0].maximumMicrousd++, x => x.calls[2].model = 'unpriced/model', x => x.audioContract.durationSeconds = 30,
    x => x.audioContract.requireInstrumental = false, x => x.mediaRequest.output_format = 'wav', x => x.mediaRequest.enable_safety_checker = false,
    x => x.mediaRequest.negative_prompt = '', x => x.mediaRequest.prompt = 'Fake future wire', x => x.sourceFilesTransferred = 1,
    x => x.pricingVersion = 'unknown', x => x.adapterVersion = 'next', x => x.executionPolicy = {}, x => x.transferDescription += ' Reference allowed.', x => x.extra = true];
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(template()); mutate(changed);
    assert.throws(() => contract.readSponsorAudioCampaignTemplate(changed), /sponsor_audio_contract_invalid/u, `mutation ${index}`);
  }
});

test('pure recipe match refuses alternate routes, missing digests and unbounded claims', async () => {
  const { cap, actual } = await fixture();
  for (const [index, mutate] of [x => x.appId = 'video', x => x.recipeVersion = 'audio@2', x => x.releaseDigest = sha('f'),
    x => x.provider = 'openai', x => x.model = 'unpriced', x => x.routeDigest = 'x', x => x.settingsDigest = 'x',
    x => x.outputCount = 2, x => x.durationMs = 0, x => x.width = 1, x => x.calls.render = 2,
    x => x.calls.repair = 0, x => x.calls.parsing = 1, x => x.maximumTokens = 256000, x => x.maximumMicrousd--,
    x => x.maximumMicrousd++, x => x.extra = 'unrecognized'].entries()) {
    const changed = structuredClone(actual.recipe); mutate(changed);
    assert.equal(contract.recipeMatchesSponsorAudioTemplate(cap, changed), false, `mutation ${index}`);
  }
});

test('redigested native-looking quotes cannot widen exact Audio semantics', async () => {
  const { cap, actual } = await fixture();
  const mutations = [x => x.offered.available = false, x => x.offered.targetId = '/', x => x.offered.reasonCode = 'output_ready',
    x => x.offered.reason += ' Measured.', x => x.offered.reasonValues = {}, x => x.offered.transferCode = 'already_authorized',
    x => x.offered.transferDescription = 'Send all sources.', x => x.offered.provider = 'openai', x => x.offered.model = 'unpriced',
    x => x.offered.route = 'generic-audio', x => x.offered.maximumCalls = 4, x => x.offered.maximumTokens = 384000,
    x => x.offered.settings.kind = 'audio', x => x.offered.settings.preparationOnly = true,
    x => x.offered.settings.explicitCostAndTransferApprovalRequired = false, x => x.offered.settings.executionAvailable = false,
    x => x.offered.settings.payload.audioProfile.durationSeconds = 30, x => x.offered.settings.payload.audioProfile.requireInstrumental = false,
    x => x.offered.settings.payload.audioProfile.transcript = 'spoken script', x => x.offered.settings.payload.audioProviderModel = 'unpriced',
    x => x.offered.settings.payload.audioEstimatedCostMicrousd++, x => x.offered.settings.payload.outputTargetInstructions = '',
    x => x.offered.settings.payload.references = [], x => x.offered.settings.payload.itemCount = 2,
    x => x.offered.settings.payload.outputAudio.trackCount = 2, x => x.offered.settings.payload.outputAudio.source.releaseHash = sha('f'),
    x => x.offered.settings.calls[0].maximumInputTokens = 61004, x => x.offered.settings.calls[0].maximumInputTokens = 24996,
    x => x.offered.settings.calls[0].maximumInputTokens++, x => x.offered.settings.calls[1].maximumInputTokens += 4,
    x => { x.offered.settings.calls[0].maximumInputTokens++; x.offered.settings.calls[1].maximumInputTokens++; },
    x => x.offered.settings.calls[1].maximumOutputTokens++, x => x.offered.settings.calls[1].maximumMicrousd++,
    x => x.offered.settings.calls.reverse(), x => x.offered.settings.calls[1].stage = 'planning:0:initial',
    x => x.offered.settings.calls[2].maximumInputTokens = 0, x => x.offered.settings.calls[2].maximumMicrousd++,
    x => x.offered.settings.calls.push(structuredClone(x.offered.settings.calls[2])), x => x.offered.settings.executionPolicy = {},
    x => x.offered.settings.constraints.parameter_limits.enable_safety_checker.values = [false],
    x => x.offered.settings.constraints.supported_parameters.push('reference_audio'), x => x.offered.settings.constraints.maximum_content_characters++,
    x => x.offered.settings.duration.measuredSeconds = 20, x => x.offered.settings.duration.requestedSeconds = 30,
    x => x.offered.settings.providerRequestDigest = sha('f')];
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(actual); mutate(changed); await redigest(changed);
    assert.equal(await contract.matchSponsorAudioTemplate(cap, changed), false, `mutation ${index}`);
  }
});

test('consent and original tuples cannot be cross-swapped, even after quote redigest', async () => {
  const { cap, actual } = await fixture();
  for (const field of ['requestId', 'expiresAt', 'draftId', 'actorUserId', 'projectId', 'documentId', 'sourceDigest', 'requirementsDigest']) {
    const changed = structuredClone(actual); changed.offered.settings.original[field] += 'x'; await redigest(changed);
    assert.equal(await contract.matchSponsorAudioTemplate(cap, changed), false, field);
  }
  for (const field of Object.keys(actual.consent)) {
    const changed = structuredClone(actual), prior = changed.consent[field];
    changed.consent[field] = typeof prior === 'string' ? `${prior}x` : typeof prior === 'boolean' ? !prior : prior + 1;
    assert.equal(await contract.matchSponsorAudioTemplate(cap, changed), false, field);
  }
  for (const mutate of [x => x.offered.settings.costPreview.sourceDigest = sha('d'),
    x => x.offered.settings.costPreview.requirementsDigest = sha('e'), x => x.offered.settings.costPreview.sourceFilesTransferred = 1,
    x => x.offered.settings.costPreview.durationSeconds = 30, x => x.offered.settings.costPreview.maximumMicrousd++,
    x => x.offered.settings.payload.outputAudio.source.draftId = `experience-draft-${'f'.repeat(64)}`,
    x => x.offered.settings.payload.outputAudio.source.requestHash = '2'.repeat(64), x => x.consent.extra = true]) {
    const changed = structuredClone(actual); mutate(changed); await redigest(changed);
    assert.equal(await contract.matchSponsorAudioTemplate(cap, changed), false);
  }
  const missing = structuredClone(actual); delete missing.consent;
  assert.equal(await contract.matchSponsorAudioTemplate(cap, missing), false);
});

test('unsafe JSON shapes are rejected without invoking accessors', async () => {
  const { cap, actual } = await fixture(); let accessed = 0;
  const getter = structuredClone(cap); Object.defineProperty(getter, 'family', { enumerable: true, get() { accessed++; return cap.family; } });
  assert.throws(() => contract.readSponsorAudioCampaignTemplate(getter), /sponsor_audio_contract_invalid/u);
  const hidden = structuredClone(cap); Object.defineProperty(hidden, 'hidden', { value: 'unknown' });
  assert.throws(() => contract.readSponsorAudioCampaignTemplate(hidden), /sponsor_audio_contract_invalid/u);
  const symbolic = structuredClone(cap); symbolic[Symbol('extra')] = true;
  assert.throws(() => contract.readSponsorAudioCampaignTemplate(symbolic), /sponsor_audio_contract_invalid/u);
  const malformed = structuredClone(actual); Object.defineProperty(malformed.offered.settings.payload.outputAudio, 'source', { enumerable: true, get() { accessed++; throw Error('should not run'); } });
  assert.equal(await contract.matchSponsorAudioTemplate(cap, malformed), false);
  assert.equal(await contract.matchSponsorAudioTemplate(Object.create(cap), actual), false);
  const sparse = structuredClone(cap); delete sparse.calls[1];
  assert.throws(() => contract.readSponsorAudioCampaignTemplate(sparse), /sponsor_audio_contract_invalid/u);
  const cyclic = structuredClone(actual); cyclic.consent.extra = cyclic;
  assert.equal(await contract.matchSponsorAudioTemplate(cap, cyclic), false);
  assert.equal(accessed, 0);
});

test('instruction bounds remain compatible with the actual native Audio execution parser', async () => {
  const { cap, actual } = await fixture();
  actual.offered.settings.payload.outputTargetInstructions = 'A'.repeat(4000); await redigest(actual);
  assert.equal(await contract.matchSponsorAudioTemplate(cap, actual), true);
  actual.offered.settings.payload.outputTargetInstructions += 'A'; await redigest(actual);
  assert.equal(await contract.matchSponsorAudioTemplate(cap, actual), false);
});

test('matcher captures review inputs before hashing and rechecks expiry after hashing', async () => {
  const { cap, actual } = await fixture();
  const pending = contract.matchSponsorAudioTemplate(cap, actual);
  cap.calls[1].optional = false; actual.consent.confirmed = false; actual.offered.settings.payload.itemCount = 2;
  assert.equal(await pending, true);
  assert.equal(await contract.matchSponsorAudioTemplate(cap, actual), false);
  const now = Date.now(), expiry = now + 60000, expiring = await fixture({ expiresAt: new Date(expiry).toISOString() });
  const clock = Date.now, subtle = crypto.subtle, originalDigest = subtle.digest; let hashed = 0;
  Date.now = () => now;
  subtle.digest = async function(...args) { hashed++; const result = await originalDigest.apply(this, args); Date.now = () => expiry; return result; };
  try { assert.equal(await contract.matchSponsorAudioTemplate(expiring.cap, expiring.actual), false); }
  finally { Date.now = clock; subtle.digest = originalDigest; }
  assert.equal(hashed, 2);
  const expired = await fixture({ expiresAt: new Date(Date.now() - 1).toISOString() });
  assert.equal(await contract.matchSponsorAudioTemplate(expired.cap, expired.actual), false);
});
