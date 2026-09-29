import assert from 'node:assert/strict';
import {after, beforeEach, test} from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';

const imports = registerOutputSourceImports();
const [contract, {createVideoOutputContract, VIDEO_OUTPUT_POLICY}, {readVideoExecutionOffer, VIDEO_READY_REASON, VIDEO_TRANSFER},
  {VIDEO_ADAPTER_CONTRACT}, {OUTPUT_VIDEO_EXECUTION_POLICY}, {OUTPUT_VIDEO_TRANSPORT, outputVideoMediaPrice},
  {VIDEO_PLANNER_MODEL}, {OPENAI_TEXT_PRICING_VERSION, estimateOpenAITextCallMaximumMicrousd}, {digest}] = await Promise.all([
  import('../worker/experience-sponsor-video-contract.ts'), import('../src/model/output-video-contract.ts'),
  import('../src/model/output-video-offer.ts'), import('../src/model/video-adapter.ts'),
  import('../src/model/output-execution-policy.ts'), import('../worker/output-video-execution.ts'),
  import('../worker/output-video-planner.ts'), import('../worker/openai-text-cost.ts'), import('../src/experiences/compiler.ts'),
]);
after(() => imports.deregister());
beforeEach(t => t.mock.method(globalThis, 'fetch', () => assert.fail('Pure Video contract tests must not use network')));

const hash = c => 'sha256:' + c.repeat(64);
const plannerPrice = input => estimateOpenAITextCallMaximumMicrousd(VIDEO_PLANNER_MODEL, input, 3000);
const price = input => plannerPrice(input) + outputVideoMediaPrice().maximumMicrousd;

function template() {
  return {
    version: 1, family: 'canonical-owned-still-video@1', appId: 'video', recipeVersion: 'video@1', releaseDigest: hash('a'),
    outputKind: 'video', inputMode: 'authorized-document-one-owned-still', outputCount: 1, durationMs: 4000, width: 0, height: 0,
    route: 'document-video-owned-still-four-seconds-manual-v1', maximumCalls: 2, maximumTokens: 152000,
    maximumInputTokens: 61000, maximumOutputTokens: 3000, maximumMicrousd: price(61000),
    plannerModel: VIDEO_PLANNER_MODEL, videoModel: OUTPUT_VIDEO_TRANSPORT.model, contract: structuredClone(VIDEO_OUTPUT_POLICY),
    frameSizes: ['1280x720', '720x1280'], maximumReferenceBytes: VIDEO_ADAPTER_CONTRACT.maxReferenceBytes,
    maximumResultBytes: OUTPUT_VIDEO_TRANSPORT.maximumResultBytes, referenceMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    pricingVersion: OPENAI_TEXT_PRICING_VERSION, videoPricingVersion: outputVideoMediaPrice().pricingVersion,
    adapterVersion: VIDEO_ADAPTER_CONTRACT.adapterVersion, promptAdapterVersion: VIDEO_ADAPTER_CONTRACT.promptAdapterVersion,
    cachePolicy: 'disabled-explicit', reasoningEffort: 'low', executionPolicy: structuredClone(OUTPUT_VIDEO_EXECUTION_POLICY),
    transport: structuredClone(OUTPUT_VIDEO_TRANSPORT),
  };
}

// Pure review material, independently built with the real native contract and
// offer parser. No fixture database, source-custody claim, media read or grant.
async function actual({frameSize = '1280x720', input = 4096} = {}) {
  const output = createVideoOutputContract({
    source: {draftId: 'experience-draft-' + 'b'.repeat(64), draftHash: hash('c'), releaseHash: hash('a'), requestHash: hash('d'), sourceBindingHash: hash('e')},
    reference: {version: 1, sourceProjectId: 'project-source', sourceDocumentId: 'document-source', sourceBlockId: 'block-source',
      referenceId: 'reference-source', sha256: 'f'.repeat(64), permissionAttestation: 'i-own-or-have-permission'}, frameSize,
  });
  assert.ok(output);
  const offered = {
    targetId: 'output-video-synthetic', available: true, reasonCode: 'output_video_ready', reason: VIDEO_READY_REASON,
    transferCode: 'output_transfer_video_after_authorization', transferDescription: VIDEO_TRANSFER,
    provider: 'fal', model: OUTPUT_VIDEO_TRANSPORT.model, route: 'document-video-owned-still-four-seconds-manual-v1',
    maximumMicrousd: price(input), maximumCalls: 2, maximumTokens: 152000,
    settings: {
      kind: 'render_document', payload: {
        artifactKind: 'video', productionMode: 'manual', itemCount: 1, outputVideo: output,
        outputVideoPlanner: {contract: structuredClone(output), requestDigest: '1'.repeat(64), maximumInputTokens: input},
        videoSeconds: 4, videoSize: frameSize, videoResolution: '480p', videoAudioMode: 'silent',
        outputTargetInstructions: 'One four-second clip from the selected still.', paidMediaConfirmed: true,
        budgetAcknowledged: true, preflightAcknowledged: true,
      },
      calls: [
        {stage: 'planning:0:initial', provider: 'openai', model: VIDEO_PLANNER_MODEL, maximumMicrousd: plannerPrice(input), maximumInputTokens: input, maximumOutputTokens: 3000},
        {stage: 'video:initial', provider: 'fal', model: OUTPUT_VIDEO_TRANSPORT.model, maximumMicrousd: outputVideoMediaPrice().maximumMicrousd, maximumInputTokens: 0, maximumOutputTokens: 0},
      ],
      videoPricingVersion: outputVideoMediaPrice().pricingVersion, executionPolicy: structuredClone(OUTPUT_VIDEO_EXECUTION_POLICY),
      preparationOnly: false, executionAvailable: true, explicitCostAndTransferApprovalRequired: true,
      original: {requestId: 'video-' + '2'.repeat(64), expiresAt: '2099-01-01T00:00:00.000Z', draftId: output.source.draftId,
        actorUserId: 'actor-synthetic', projectId: 'project-synthetic', documentId: 'document-synthetic', sourceDigest: '3'.repeat(64), requirementsDigest: '4'.repeat(64)},
    },
  };
  assert.ok(readVideoExecutionOffer(offered), 'Independent fixture must pass the actual native offer reader');
  const recipe = {appId: 'video', recipeVersion: 'video@1', releaseDigest: hash('a'), outputKind: 'video', provider: 'fal', model: OUTPUT_VIDEO_TRANSPORT.model,
    routeDigest: await digest(offered), settingsDigest: await digest(offered.settings), outputCount: 1, durationMs: 4000, width: 0, height: 0,
    calls: {parsing: 0, planning: 1, render: 1, repair: 0}, maximumTokens: 152000, maximumMicrousd: offered.maximumMicrousd};
  return structuredClone({recipe, offered});
}

async function rebind(value) {
  value.recipe.routeDigest = await digest(value.offered);
  value.recipe.settingsDigest = await digest(value.offered.settings);
  return value;
}

for (const frameSize of ['1280x720', '720x1280']) test(`pure closed contract accepts native ${frameSize} intent without treating it as measured dimensions`, async () => {
  const value = await actual({frameSize});
  assert.equal(contract.recipeMatchesSponsorVideoTemplate(template(), value.recipe), true);
  assert.equal(await contract.matchSponsorVideoTemplate(template(), value), true);
  assert.deepEqual([value.recipe.width, value.recipe.height, value.recipe.durationMs], [0, 0, 4000]);
  assert.equal(value.offered.settings.payload.videoResolution, '480p');
  assert.deepEqual(value.recipe.calls, {parsing: 0, planning: 1, render: 1, repair: 0});
  assert.equal(value.recipe.maximumTokens, 152000);
});

test('review template is deeply frozen, detached and contains no actor, payer, source or dispatch capability', () => {
  const raw = template(), parsed = contract.readSponsorVideoCampaignTemplate(raw);
  assert.deepEqual(parsed, raw); assert.notEqual(parsed, raw);
  for (const item of [parsed, parsed.contract, parsed.frameSizes, parsed.referenceMimeTypes, parsed.executionPolicy, parsed.transport]) assert.ok(Object.isFrozen(item));
  raw.contract.seconds = 15; raw.frameSizes.reverse(); raw.executionPolicy.maximumMilliseconds++;
  assert.equal(parsed.contract.seconds, 4); assert.equal(parsed.frameSizes[0], '1280x720');
  assert.equal(parsed.executionPolicy.maximumMilliseconds, OUTPUT_VIDEO_EXECUTION_POLICY.maximumMilliseconds);
  for (const key of ['actorUserId', 'payerUserId', 'sourceDigest', 'grant', 'approved', 'dispatch', 'maximumReads']) assert.equal(Object.hasOwn(parsed, key), false);
});

test('source-dependent planner token prices include exact lower and upper bounds, with fixed media cost', async () => {
  const prices = [];
  for (const input of [4096, 12000, 61000]) {
    const value = await actual({input});
    assert.equal(await contract.matchSponsorVideoTemplate(template(), value), true);
    assert.equal(value.recipe.maximumMicrousd, price(input));
    assert.equal(value.offered.settings.calls[1].maximumMicrousd, 4 * VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd['480p']);
    prices.push(value.recipe.maximumMicrousd);
  }
  assert.ok(prices[0] < prices[1] && prices[1] < prices[2]);
  assert.equal(prices[2], template().maximumMicrousd);
});

test('closed template refuses model, adapter, pricing, bound, cache and execution-policy drift', () => {
  const mutations = [
    ['version', x => x.version = 7], ['family', x => x.family = 'canonical-video@2'], ['app', x => x.appId = 'image'],
    ['recipe', x => x.recipeVersion = 'video@0'], ['release', x => x.releaseDigest = 'unbound'], ['mode', x => x.inputMode = 'guest-upload'],
    ['kind', x => x.outputKind = 'audio'], ['count', x => x.outputCount = 2], ['duration', x => x.durationMs = 8000],
    ['width', x => x.width = 1280], ['height', x => x.height = 720], ['route', x => x.route += '-retry'],
    ['calls', x => x.maximumCalls++], ['tokens', x => x.maximumTokens--], ['input cap', x => x.maximumInputTokens++],
    ['output cap', x => x.maximumOutputTokens++], ['price cap', x => x.maximumMicrousd++], ['planner model', x => x.plannerModel = 'gpt-5.6-sol'],
    ['video model', x => x.videoModel = 'future-model'], ['policy', x => x.contract.resolution = '720p'], ['frames', x => x.frameSizes.reverse()],
    ['reference bytes', x => x.maximumReferenceBytes++], ['result bytes', x => x.maximumResultBytes++], ['reference MIME', x => x.referenceMimeTypes.push('image/gif')],
    ['text pricing', x => x.pricingVersion += '-new'], ['media pricing', x => x.videoPricingVersion += '-new'],
    ['adapter', x => x.adapterVersion = '2.0.1'], ['prompt adapter', x => x.promptAdapterVersion = '1.1.1'],
    ['cache', x => x.cachePolicy = 'automatic'], ['reasoning', x => x.reasoningEffort = 'high'],
    ['execution', x => x.executionPolicy.maximumRenewals++], ['transport status cap', x => x.transport.maximumStatusReads++],
    ['transport bytes', x => x.transport.maximumEnvelopeBytes++], ['transport deadline', x => x.transport.requestTimeoutMs++],
    ['transport lifetime', x => x.transport.executionTimeoutMs++], ['authority field', x => x.payerUserId = 'claimed'],
  ];
  for (const [name, mutate] of mutations) {
    const changed = template(); mutate(changed);
    assert.throws(() => contract.readSponsorVideoCampaignTemplate(changed), error => error instanceof contract.SponsorVideoContractError && error.code === 'sponsor_video_contract_invalid', name);
  }
});

test('recipe rejects extra fields, changed identities, wrong call reservations and prices outside exact campaign range', async () => {
  const value = await actual();
  const mutations = [
    x => x.appId = 'scene', x => x.recipeVersion = 'video@2', x => x.releaseDigest = hash('0'), x => x.provider = 'openai', x => x.model = 'other',
    x => x.outputKind = 'image', x => x.routeDigest = 'not-a-hash', x => x.settingsDigest = 'not-a-hash', x => x.outputCount = 2,
    x => x.durationMs = 5000, x => x.width = 1280, x => x.height = 720, x => x.maximumTokens++, x => x.calls.planning = 2,
    x => x.calls.render = 2, x => x.calls.repair = 1, x => x.calls.parsing = 1, x => x.calls.status = 1,
    x => x.maximumMicrousd = price(4096) - 1, x => x.maximumMicrousd = price(61000) + 1, x => x.maximumMicrousd += 0.5,
    x => x.maximumMicrousd = NaN, x => x.approved = true, x => { delete x.durationMs; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(value); mutate(changed.recipe);
    assert.equal(contract.recipeMatchesSponsorVideoTemplate(template(), changed.recipe), false);
    assert.equal(await contract.matchSponsorVideoTemplate(template(), changed), false);
  }
});

test('re-digested offers reject upgrades to 720p, audio, multiple references, retry and new authority fields', async () => {
  const value = await actual();
  const mutations = [
    x => { x.settings.payload.videoResolution = '720p'; x.settings.payload.outputVideo.resolution = '720p'; },
    x => { x.settings.payload.videoAudioMode = 'original_ambient'; x.settings.payload.outputVideo.audioMode = 'original_ambient'; },
    x => x.settings.payload.outputVideo.referenceCount = 2,
    x => x.settings.payload.outputVideo.references = [x.settings.payload.outputVideo.reference],
    x => { x.settings.payload.videoSeconds = 5; x.settings.payload.outputVideo.seconds = 5; },
    x => x.settings.payload.itemCount = 2, x => x.settings.calls.push({...x.settings.calls[0], stage: 'planning:0:repair'}),
    x => x.settings.calls[1].stage = 'video:retry', x => x.settings.automaticRetry = true,
    x => x.settings.payload.payerUserId = 'claimed', x => x.settings.original.grant = 'claimed',
    x => x.settings.executionPolicy.maximumMilliseconds++, x => x.settings.videoPricingVersion += '-new',
    x => x.model = 'future-model', x => x.settings.calls[0].model = 'gpt-5.6-sol',
    x => x.settings.payload.outputVideo.reference.url = 'https://example.invalid/unreviewed',
    x => x.settings.payload.outputVideoPlanner.requestDigest = 'not-a-hash',
    x => x.settings.original.draftId = 'experience-draft-' + '0'.repeat(64),
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(value); mutate(changed.offered);
    changed.offered.settings.payload.outputVideoPlanner.contract = structuredClone(changed.offered.settings.payload.outputVideo);
    await rebind(changed);
    assert.equal(await contract.matchSponsorVideoTemplate(template(), changed), false);
  }
});

test('re-digested offers reject token bounds and any price redistribution even when total remains internally consistent', async () => {
  const value = await actual({input: 12000});
  for (const input of [4095, 61001, 12000.5]) {
    const changed = structuredClone(value);
    changed.offered.settings.payload.outputVideoPlanner.maximumInputTokens = input;
    changed.offered.settings.calls[0].maximumInputTokens = input;
    await rebind(changed);
    assert.equal(await contract.matchSponsorVideoTemplate(template(), changed), false);
  }
  for (const mutate of [x => x.settings.calls[0].maximumOutputTokens++, x => x.settings.calls[1].maximumInputTokens = 1,
    x => x.settings.calls[1].maximumOutputTokens = 1, x => x.maximumCalls++, x => x.maximumTokens--,
    x => x.settings.calls.reverse()]) {
    const changed = structuredClone(value); mutate(changed.offered); await rebind(changed);
    assert.equal(await contract.matchSponsorVideoTemplate(template(), changed), false);
  }
  for (const delta of [-1, 1]) {
    const changed = structuredClone(value);
    changed.offered.settings.calls[0].maximumMicrousd += delta;
    changed.offered.maximumMicrousd += delta; changed.recipe.maximumMicrousd += delta; await rebind(changed);
    assert.ok(readVideoExecutionOffer(changed.offered), 'Native shape alone permits the changed planner price');
    assert.equal(await contract.matchSponsorVideoTemplate(template(), changed), false, 'Sponsor contract must rederive the exact planner price');
  }
  const redistributed = structuredClone(value);
  redistributed.offered.settings.calls[0].maximumMicrousd++; redistributed.offered.settings.calls[1].maximumMicrousd--;
  await rebind(redistributed);
  assert.equal(await contract.matchSponsorVideoTemplate(template(), redistributed), false);
});

test('both source offer and settings digests must match; well-shaped digest DTOs confer no native authority', async () => {
  const value = await actual();
  for (const field of ['routeDigest', 'settingsDigest']) {
    const changed = structuredClone(value); changed.recipe[field] = hash('0');
    assert.equal(contract.recipeMatchesSponsorVideoTemplate(template(), changed.recipe), true);
    assert.equal(await contract.matchSponsorVideoTemplate(template(), changed), false);
  }
  const changedSource = structuredClone(value);
  changedSource.offered.settings.original.sourceDigest = '0'.repeat(64);
  assert.equal(await contract.matchSponsorVideoTemplate(template(), changedSource), false);
  const extra = {...value, payerUserId: 'claimed'};
  assert.equal(await contract.matchSponsorVideoTemplate(template(), extra), false);
});

test('unsafe JSON and accessors are rejected without executing getters or toJSON at every input boundary', async () => {
  const value = await actual(); let calls = 0;
  for (const target of ['template', 'recipe', 'offer', 'nested']) {
    const raw = template(), changed = structuredClone(value);
    const object = target === 'template' ? raw : target === 'recipe' ? changed.recipe : target === 'offer' ? changed.offered : changed.offered.settings.payload.outputVideo.reference;
    Object.defineProperty(object, target === 'template' ? 'family' : target === 'recipe' ? 'provider' : target === 'offer' ? 'model' : 'sha256',
      {enumerable: true, get() { calls++; throw Error('Unsafe getter executed'); }});
    if (target === 'template') assert.throws(() => contract.readSponsorVideoCampaignTemplate(raw), /sponsor_video_contract_invalid/);
    assert.equal(await contract.matchSponsorVideoTemplate(raw, changed), false);
  }
  for (const mutate of [x => x[Symbol('hidden')] = true, x => x.toJSON = () => { calls++; return {}; },
    x => Object.defineProperty(x, 'hidden', {value: true}), x => x.self = x, x => Object.setPrototypeOf(x, {claimed: true}),
    x => x.frameSizes = new Array(2), x => x.maximumMicrousd = Infinity, x => x.releaseDigest = 'a'.repeat(8193)]) {
    const raw = template(); mutate(raw);
    assert.throws(() => contract.readSponsorVideoCampaignTemplate(raw), /sponsor_video_contract_invalid/);
    assert.equal(await contract.matchSponsorVideoTemplate(raw, value), false);
  }
  assert.equal(calls, 0);
});

test('template and actual bytes are captured before the first asynchronous digest can observe caller mutation', async t => {
  const raw = template(), value = await actual();
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  let release, enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let digests = 0;
  t.mock.method(crypto.subtle, 'digest', async (...args) => {
    if (++digests === 1) { enteredResolve(); await gate; }
    return originalDigest(...args);
  });
  const pending = contract.matchSponsorVideoTemplate(raw, value);
  await entered;
  raw.maximumCalls = 20; raw.maximumMicrousd = 1;
  value.recipe.maximumMicrousd = 1; value.recipe.settingsDigest = hash('0');
  value.offered.settings.payload.videoSeconds = 15;
  value.offered.settings.payload.outputVideo.reference.sha256 = '0'.repeat(64);
  release();
  assert.equal(await pending, true, 'Only the valid captured review material should be hashed');
  assert.equal(digests, 2);
  assert.equal(await contract.matchSponsorVideoTemplate(raw, value), false, 'A subsequent call must see and refuse changed material');
});
