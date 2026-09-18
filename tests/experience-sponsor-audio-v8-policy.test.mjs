import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { registerOutputSourceImports } from './output-server-test-helpers.mjs';
const imports = registerOutputSourceImports(); after(() => imports.deregister());
const [policyApi, { canonicalJson, digest }, { registeredExperience }, { AUDIO_OUTPUT_POLICY },
  { EXPERIENCE_AUDIO_INTENT }, { OUTPUT_NATIVE_EXECUTION_POLICY }, { STABLE_AUDIO_ADAPTER_CONTRACT, estimateAudioProviderCostMicrousd },
  { OPENAI_TEXT_PRICING_VERSION, estimateOpenAITextCallMaximumMicrousd }, { SPONSOR_AUDIO_TRANSFER_DESCRIPTION }] = await Promise.all([
  import('../worker/experience-sponsor-policy.ts'), import('../src/experiences/compiler.ts'), import('../src/experiences/intake.ts'),
  import('../src/model/output-audio-contract.ts'), import('../src/experiences/contracts.ts'), import('../src/model/output-execution-policy.ts'),
  import('../src/model/audio.ts'), import('../worker/openai-text-cost.ts'), import('../worker/experience-sponsor-audio-contract.ts'),
]);
const { readSponsorAudioPolicy, readSponsorPolicy, compileSponsorAudioEnvelope, compileSponsorEnvelope, captureSponsorAudioJson, DEFAULT_SPONSOR_POLICY } = policyApi;
const hash = digit => `sha256:${digit.repeat(64)}`, now = 1000000;
const release = await registeredExperience('audio');
const model = 'fal-ai/stable-audio-3/medium/text-to-audio';
const plannerCost = Math.max(500000, estimateOpenAITextCallMaximumMicrousd('gpt-5.6-terra', 61000, 3000));
const audioCost = estimateAudioProviderCostMicrousd(STABLE_AUDIO_ADAPTER_CONTRACT, EXPERIENCE_AUDIO_INTENT);
const template = { version: 1, family: 'canonical-instrumental-cue@1', appId: 'audio', recipeVersion: `audio@${release.definition.revision}`,
  releaseDigest: release.releaseHash, outputKind: 'audio', inputMode: 'authorized-document-text', outputCount: 1,
  durationMs: 20000, width: 0, height: 0, route: 'document-audio-timed-music-manual-v1', maximumCalls: 3, maximumTokens: 128000,
  maximumMicrousd: 2 * plannerCost + audioCost, calls: [
    { stage: 'planning:0:initial', provider: 'openai', model: 'gpt-5.6-terra', optional: false, maximumInputTokens: 61000, maximumOutputTokens: 3000, maximumMicrousd: plannerCost },
    { stage: 'planning:0:repair', provider: 'openai', model: 'gpt-5.6-terra', optional: true, maximumInputTokens: 61000, maximumOutputTokens: 3000, maximumMicrousd: plannerCost },
    { stage: 'audio:initial', provider: 'fal', model, optional: false, maximumMicrousd: audioCost },
  ], audioContract: AUDIO_OUTPUT_POLICY, mediaRequest: { duration: 20, output_format: 'mp3', enable_safety_checker: true, negative_prompt: 'singing, vocals, spoken dialogue' },
  sourceFilesTransferred: 0, pricingVersion: OPENAI_TEXT_PRICING_VERSION, adapterVersion: STABLE_AUDIO_ADAPTER_CONTRACT.adapterVersion,
  executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY, transferDescription: SPONSOR_AUDIO_TRANSFER_DESCRIPTION };
const allowance = { maximumOperations: 20, maximumTextBytes: 100000, maximumOperationsPerWindow: 10, maximumTextBytesPerWindow: 50000,
  maximumPendingGrants: 2, maximumInflightJobs: 1 };
const policy = { version: 8, family: 'canonical-instrumental-cue@1', mode: 'candidate', campaignId: 'audio-campaign', policyVersion: 'audio-policy@1',
  payerUserId: 'audio-payer', audience: 'canonical-principal', approvalReceiptDigest: hash('1'), startsAtMs: now - 1000, expiresAtMs: now + 100000,
  maximumGrantLifetimeMs: 60000, maximumAdmissions: 10, maximumMicrousd: 10000000, maximumAdmissionsPerActor: 5, windowMs: 60000,
  maximumAdmissionsPerWindow: 10, maximumAdmissionsPerActorWindow: 5, templates: [template],
  resources: { version: 1, startsAtMs: now - 500, expiresAtMs: now + 80000, windowMs: 60000, maximumOperationTextBytes: 10000,
    campaign: allowance, actor: allowance } };
const recipe = { appId: 'audio', recipeVersion: template.recipeVersion, releaseDigest: release.releaseHash, outputKind: 'audio', provider: 'fal', model,
  routeDigest: hash('2'), settingsDigest: hash('3'), outputCount: 1, durationMs: 20000, width: 0, height: 0,
  calls: { parsing: 0, planning: 1, render: 1, repair: 1 }, maximumTokens: 128000, maximumMicrousd: template.maximumMicrousd };
// Review metadata is synthetic; neither these hashes nor compilation grants authority.
const envelope = { version: 8, family: 'canonical-instrumental-cue@1', campaignId: policy.campaignId, policyVersion: policy.policyVersion,
  consumptionId: 'audio-consumption', intentKey: 'audio-intent', actorKind: 'canonical-principal', actorUserId: 'audio-actor', sessionDigest: hash('4'),
  payerUserId: policy.payerUserId, ownerUserId: 'audio-actor', projectId: 'audio-project', documentId: 'audio-document', sourceRevision: 7,
  sourceDigest: hash('5'), orderedAssetDigests: [], rightsDigest: hash('6'), compiledInputDigest: hash('7'), transferEnvelopeDigest: hash('8'),
  recipe, issuedAtMs: now, expiresAtMs: now + 30000, templateDigest: await digest(template), audioActorRequestDigest: hash('9'),
  audioSponsorReviewDigest: hash('a'), originalRequestId: `audio-${'b'.repeat(64)}`, originalExpiresAtMs: now + 45000 };

test('V8 compiles exact native Audio terms and retains four original actor/request identity fields', async () => {
  assert.strictEqual(readSponsorPolicy(), DEFAULT_SPONSOR_POLICY);
  assert.equal(readSponsorPolicy(policy).version, 8);
  const compiled = await compileSponsorAudioEnvelope(policy, envelope);
  assert.deepEqual(await compileSponsorEnvelope(policy, envelope), compiled);
  assert.equal(compiled.policyJson, canonicalJson(policy)); assert.equal(compiled.envelopeJson, canonicalJson(envelope));
  assert.equal(compiled.policyDigest, await digest(policy)); assert.equal(compiled.envelopeDigest, await digest(envelope));
  assert.deepEqual(compiled.envelope.recipe.calls, { parsing: 0, planning: 1, render: 1, repair: 1 });
  assert.equal(compiled.envelope.recipe.maximumTokens, 128000);
  assert.equal(compiled.envelope.recipe.maximumMicrousd, 2 * plannerCost + audioCost);
  for (const key of ['audioActorRequestDigest', 'audioSponsorReviewDigest', 'originalRequestId', 'originalExpiresAtMs']) assert.equal(compiled.envelope[key], envelope[key]);
  for (const value of [compiled, compiled.policy, compiled.policy.templates[0], compiled.policy.templates[0].calls, compiled.envelope, compiled.envelope.recipe.calls]) assert.ok(Object.isFrozen(value));
});

test('V8 policy closes family, template, resource, cap and lifetime expansion', () => {
  const mutations = [x => x.version = 6, x => x.version = 9, x => x.family = 'canonical-scene-screenplay@1', x => x.audience = 'guest',
    x => x.mode = 'enabled', x => x.extra = true, x => x.approvalReceiptDigest = '1'.repeat(64), x => x.templates = [],
    x => x.templates.push(structuredClone(template)), x => x.templates[0].maximumCalls = 4, x => x.templates[0].maximumTokens = 384000,
    x => x.templates[0].calls[1].optional = false, x => x.templates[0].calls[2].maximumMicrousd++,
    x => x.templates[0].mediaRequest.output_format = 'wav', x => x.templates[0].mediaRequest.enable_safety_checker = false,
    x => x.templates[0].sourceFilesTransferred = 1, x => x.templates[0].audioContract.requireInstrumental = false,
    x => x.templates[0].durationMs = 30000, x => x.maximumMicrousd = template.maximumMicrousd - 1,
    x => x.maximumAdmissions = 0, x => x.maximumAdmissionsPerActor = 11, x => x.maximumAdmissionsPerWindow = 11,
    x => x.maximumAdmissionsPerActorWindow = 6, x => x.maximumGrantLifetimeMs = 900001, x => x.expiresAtMs = x.startsAtMs,
    x => x.startsAtMs = -1, x => x.windowMs = 0, x => x.resources.startsAtMs = x.startsAtMs - 1,
    x => x.resources.expiresAtMs = x.expiresAtMs + 1, x => x.resources.version = 2, x => x.resources.passiveReads = true,
    x => x.resources.allowedOperations = ['audio-media'], x => x.resources.actor.maximumInflightJobs = 2];
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(policy); mutate(changed);
    assert.throws(() => readSponsorAudioPolicy(changed), undefined, `mutation ${index}`);
  }
  for (const key of Object.keys(policy)) { const changed = structuredClone(policy); delete changed[key]; assert.throws(() => readSponsorAudioPolicy(changed), undefined, key); }
});

test('V8 envelope rejects foreign custody, missing actual intent hashes and fabricated original identities', async () => {
  const mutations = [x => x.version = 6, x => x.family = 'canonical-scene-screenplay@1', x => x.actorKind = 'guest',
    x => x.ownerUserId = 'another-owner', x => { x.actorUserId = policy.payerUserId; x.ownerUserId = policy.payerUserId; },
    x => x.payerUserId = 'different-payer', x => x.campaignId = 'different-campaign', x => x.policyVersion = 'different-policy',
    x => x.orderedAssetDigests = [hash('c')], x => x.recipe.provider = 'openai', x => x.recipe.model = 'unpriced',
    x => x.recipe.outputKind = 'video', x => x.recipe.calls.planning = 2, x => x.recipe.calls.render = 2,
    x => x.recipe.calls.repair = 0, x => x.recipe.calls.repair = 2, x => x.recipe.calls.parsing = 1,
    x => x.recipe.durationMs = 0, x => x.recipe.outputCount = 2, x => x.recipe.maximumTokens = 128001,
    x => x.recipe.maximumMicrousd++, x => x.recipe.maximumMicrousd--, x => x.recipe.releaseDigest = hash('f'),
    x => x.recipe.routeDigest = 'not-a-digest', x => x.templateDigest = hash('f'), x => x.sourceRevision = -1,
    x => x.audioActorRequestDigest = '9'.repeat(64), x => x.audioSponsorReviewDigest = 'a'.repeat(64),
    x => x.originalRequestId = `scene-${'b'.repeat(64)}`, x => x.originalRequestId = `audio-${'B'.repeat(64)}`,
    x => x.originalExpiresAtMs = x.issuedAtMs, x => x.originalExpiresAtMs = x.expiresAtMs - 1,
    x => x.originalExpiresAtMs = Infinity, x => x.originalExpiresAtMs += 0.5, x => x.allowReplacement = true];
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(envelope); mutate(changed);
    await assert.rejects(compileSponsorAudioEnvelope(policy, changed), undefined, `mutation ${index}`);
  }
  for (const key of Object.keys(envelope)) {
    const changed = structuredClone(envelope); delete changed[key];
    await assert.rejects(compileSponsorAudioEnvelope(policy, changed), undefined, key);
  }
});

test('grant expiry cannot outlive any approved bound; original expiry remains identity after the clock passes', async () => {
  for (const mutate of [x => x.issuedAtMs = policy.resources.startsAtMs - 1, x => x.expiresAtMs = x.issuedAtMs,
    x => x.expiresAtMs = x.originalExpiresAtMs + 1,
    x => { x.originalExpiresAtMs = now + 100000; x.expiresAtMs = now + 60001; },
    x => { x.issuedAtMs = now + 40000; x.originalExpiresAtMs = now + 100000; x.expiresAtMs = policy.resources.expiresAtMs + 1; },
    x => { x.issuedAtMs = now + 50000; x.originalExpiresAtMs = now + 110000; x.expiresAtMs = policy.expiresAtMs + 1; }]) {
    const changed = structuredClone(envelope); mutate(changed); await assert.rejects(compileSponsorAudioEnvelope(policy, changed));
  }
  const boundary = { ...structuredClone(envelope), expiresAtMs: envelope.originalExpiresAtMs };
  assert.equal((await compileSponsorAudioEnvelope(policy, boundary)).envelope.expiresAtMs, boundary.originalExpiresAtMs);
  // A pure compiler retains the exact historical identity. Runtime preparation
  // checks current permission separately; this cannot renew a purchase or hold.
  const clock = Date.now; Date.now = () => envelope.originalExpiresAtMs + 100000;
  try { assert.equal((await compileSponsorAudioEnvelope(policy, envelope)).envelopeJson, canonicalJson(envelope)); }
  finally { Date.now = clock; }
});

test('each original Audio identity field participates in the immutable envelope digest', async () => {
  const original = await compileSponsorAudioEnvelope(policy, envelope);
  for (const [key, value] of [['audioActorRequestDigest', hash('c')], ['audioSponsorReviewDigest', hash('d')],
    ['originalRequestId', `audio-${'e'.repeat(64)}`], ['originalExpiresAtMs', envelope.originalExpiresAtMs + 1]]) {
    const changed = await compileSponsorAudioEnvelope(policy, { ...structuredClone(envelope), [key]: value });
    assert.notEqual(changed.envelopeDigest, original.envelopeDigest, key);
    assert.equal(changed.policyDigest, original.policyDigest, key);
    assert.equal(changed.envelope[key], value, key);
  }
});

test('V8 captures own-data policy and envelope before asynchronous template or envelope hashing', async () => {
  const p = structuredClone(policy), e = structuredClone(envelope), pending = compileSponsorAudioEnvelope(p, e);
  p.payerUserId = 'later-payer'; p.templates[0].calls[2].model = 'later-model'; e.audioActorRequestDigest = hash('f');
  e.originalRequestId = `audio-${'f'.repeat(64)}`; e.originalExpiresAtMs++; e.recipe.maximumMicrousd++;
  const captured = await pending;
  assert.equal(captured.policyJson, canonicalJson(policy)); assert.equal(captured.envelopeJson, canonicalJson(envelope));
  let reads = 0;
  const changing = value => new Proxy(structuredClone(value), { get(target, key, receiver) { reads++; if (key === 'version') return 1; return Reflect.get(target, key, receiver); } });
  assert.equal(readSponsorAudioPolicy(changing(policy)).version, 8);
  assert.equal(readSponsorPolicy(changing(policy)).version, 8);
  assert.equal((await compileSponsorAudioEnvelope(changing(policy), changing(envelope))).envelope.originalRequestId, envelope.originalRequestId);
  assert.equal(reads, 0);
});

test('V8 bounded capture refuses getters, symbols, hidden values, sparse arrays and cycles', async () => {
  let reads = 0;
  const shapes = [value => Object.create(value), value => { value[Symbol('extra')] = true; return value; },
    value => { Object.defineProperty(value, 'hidden', { value: true }); return value; }, value => { value.extra = undefined; return value; },
    value => { value.extra = value; return value; }, value => { value.extra = Array(2); return value; },
    value => { Object.defineProperty(value, 'family', { enumerable: true, get() { reads++; return policy.family; } }); return value; }];
  for (const shape of shapes) {
    const badPolicy = shape(structuredClone(policy)), badEnvelope = shape(structuredClone(envelope));
    assert.throws(() => readSponsorAudioPolicy(badPolicy)); await assert.rejects(compileSponsorAudioEnvelope(policy, badEnvelope));
  }
  const sparse = structuredClone(policy); delete sparse.templates[0]; assert.throws(() => readSponsorAudioPolicy(sparse));
  assert.throws(() => captureSponsorAudioJson('a'.repeat(8193)));
  assert.throws(() => captureSponsorAudioJson(Array(65).fill(0)));
  let deep = 1; for (let index = 0; index < 13; index++) deep = { nested: deep };
  assert.throws(() => captureSponsorAudioJson(deep));
  assert.equal(reads, 0);
});

test('V1 V2 V4 V5 retain independently frozen policy and envelope goldens', async () => {
  const golden = JSON.parse(readFileSync(new URL('./fixtures/scene-v6-prior-sponsor-canonical-goldens.json', import.meta.url), 'utf8'));
  assert.equal(golden.sourceCommit, 'c4c6a8937eace8e442bb317dd5ce2ac4a5abfff7');
  assert.deepEqual(DEFAULT_SPONSOR_POLICY, golden.defaultPolicy);
  for (const version of golden.versions) {
    const compiled = await compileSponsorEnvelope(JSON.parse(version.compiled.policyJson), JSON.parse(version.compiled.envelopeJson));
    for (const key of ['policyJson', 'policyDigest', 'envelopeJson', 'envelopeDigest']) assert.equal(compiled[key], version.compiled[key], `V${version.version} ${key}`);
  }
});
