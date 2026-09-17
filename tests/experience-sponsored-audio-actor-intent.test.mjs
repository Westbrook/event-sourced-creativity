import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, digest } from '../src/experiences/compiler.ts';
import { readSponsoredAudioReview, readSponsoredAudioActorRequest, digestSponsoredAudioReview,
  sponsoredAudioActorIntentMatchesNative, matchSponsoredAudioActorIntent } from '../src/experiences/sponsored-audio-actor-intent.ts';

const sha = digit => `sha256:${digit.repeat(64)}`;
const nativeHash = digit => digit.repeat(64);
async function fixture() {
  const now = Date.now();
  const preview = { version: 'audio-mini-app-cost-v1', requestId: `audio-${nativeHash('a')}`, actorUserId: 'synthetic-actor',
    projectId: 'synthetic-project', documentId: 'synthetic-document', draftId: `experience-draft-${nativeHash('b')}`,
    sourceDigest: nativeHash('c'), requirementsDigest: nativeHash('d'), expiresAt: new Date(now + 180000).toISOString(),
    maximumMicrousd: 1037600, maximumCalls: 3, maximumTokens: 128000, planningModel: 'gpt-5.6-terra', maximumPlanningCalls: 2,
    maximumOutputTokens: 3000, audioModel: 'fal-ai/stable-audio-3/medium/text-to-audio', maximumAudioCalls: 1,
    durationSeconds: 20, requireInstrumental: true, sourceFilesTransferred: 0 };
  const review = { version: 'sponsor-audio-review@1', campaignId: 'synthetic-audio-campaign', approvalReceiptDigest: sha('1'),
    policyDigest: sha('2'), templateDigest: sha('3'), payerUserId: 'synthetic-payer', actorChargeMicrousd: 0,
    termsDigest: nativeHash('e'), preview: structuredClone(preview), expiresAt: new Date(now + 60000).toISOString() };
  // Synthetic supplied consent tests contract behavior, never a human action.
  const request = { draftHash: sha('4'), termsDigest: nativeHash('e'), maximumMicrousd: preview.maximumMicrousd,
    explicitAuthorization: true, audioCostConsent: { ...preview, confirmed: true, providerTransferConfirmed: true },
    sponsorReview: { campaignId: review.campaignId, reviewDigest: await digestSponsoredAudioReview(review) } };
  const native = { draftHash: request.draftHash, termsDigest: request.termsDigest, preview, expiresAt: new Date(now + 120000).toISOString() };
  return { now, review, request, native };
}

test('owned frozen intent preserves actual supplied Audio approval and separate zero actor charge', async () => {
  const { review, request, native } = await fixture();
  const before = canonicalJson({ review, request, native }), result = await matchSponsoredAudioActorIntent(review, request, native);
  assert.ok(result); assert.deepEqual(result.review, review); assert.deepEqual(result.request, request);
  assert.equal(result.reviewDigest, await digest(review)); assert.equal(result.requestDigest, await digest(request));
  assert.equal(result.review.actorChargeMicrousd, 0); assert.equal(result.request.maximumMicrousd, 1037600);
  assert.equal(result.review.preview.maximumMicrousd, result.request.maximumMicrousd);
  assert.equal(result.review.payerUserId, 'synthetic-payer'); assert.equal(result.request.audioCostConsent.actorUserId, 'synthetic-actor');
  assert.equal(Object.hasOwn(result.request, 'payerUserId'), false); assert.equal(Object.hasOwn(result.request, 'explicitRun'), false);
  assert.deepEqual(Object.keys(result).sort(), ['request', 'requestDigest', 'review', 'reviewDigest']);
  assert.notEqual(result.review, review); assert.notEqual(result.request, request); assert.notEqual(result.request.audioCostConsent, request.audioCostConsent);
  for (const value of [result, result.review, result.review.preview, result.request, result.request.audioCostConsent, result.request.sponsorReview]) assert.ok(Object.isFrozen(value));
  assert.equal(canonicalJson({ review, request, native }), before);
});

test('review parser closes sponsor metadata and preserves native digest conventions', async () => {
  const { review } = await fixture();
  const mutations = [x => x.version = 8, x => x.campaignId = '', x => x.campaignId = 'a'.repeat(201),
    x => x.approvalReceiptDigest = nativeHash('1'), x => x.policyDigest = sha('A'), x => x.templateDigest = 'unknown',
    x => x.payerUserId = 'https://select-payer', x => x.payerUserId = x.preview.actorUserId, x => x.actorChargeMicrousd = 1,
    x => x.actorChargeMicrousd = '0', x => x.termsDigest = sha('e'), x => x.preview.sourceDigest = sha('c'),
    x => x.preview.maximumCalls = 1, x => x.preview.maximumTokens = 384000, x => x.preview.sourceFilesTransferred = 1,
    x => x.preview.requireInstrumental = false, x => x.preview.durationSeconds = 30, x => x.preview.audioModel = 'other',
    x => x.preview.extra = true, x => x.expiresAt = 'tomorrow', x => x.expiresAt = x.expiresAt.replace('.000Z', 'Z'),
    x => x.expiresAt = new Date(Date.parse(x.preview.expiresAt) + 1).toISOString(), x => x.draftHash = sha('4'),
    x => x.permission = 'transfer-anything'];
  // Use a known millisecond timestamp so the noncanonical-ISO mutation changes.
  review.expiresAt = new Date(Math.floor(Date.parse(review.expiresAt) / 1000) * 1000).toISOString();
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(review); mutate(changed);
    assert.throws(() => readSponsoredAudioReview(changed), /sponsored_audio_actor_intent_invalid/u, `mutation ${index}`);
  }
  assert.equal(readSponsoredAudioReview(review).termsDigest, nativeHash('e'));
});

test('request parser never supplies missing approval and refuses payer, route or transfer additions', async () => {
  const { request } = await fixture();
  const mutations = [x => delete x.explicitAuthorization, x => x.explicitAuthorization = false, x => x.explicitAuthorization = 'true',
    x => delete x.audioCostConsent.confirmed, x => x.audioCostConsent.confirmed = false, x => x.audioCostConsent.confirmed = 'true',
    x => delete x.audioCostConsent.providerTransferConfirmed, x => x.audioCostConsent.providerTransferConfirmed = false,
    x => x.audioCostConsent.providerTransferConfirmed = 1, x => x.maximumMicrousd = 0, x => x.maximumMicrousd++,
    x => x.audioCostConsent.maximumMicrousd++, x => x.draftHash = nativeHash('4'), x => x.termsDigest = sha('e'),
    x => x.sponsorReview.reviewDigest = nativeHash('1'), x => x.sponsorReview.campaignId = '', x => x.sponsorReview.extra = 'permission',
    x => x.payerUserId = 'selected-payer', x => x.billingOwnerId = 'selected-payer', x => x.model = 'different',
    x => x.url = 'https://destination.invalid', x => x.explicitRun = true, x => x.audioCostConsent.referenceFiles = true,
    x => x.audioCostConsent.payerUserId = 'selected-payer', x => x.audioCostConsent.durationSeconds = 40,
    x => x.audioCostConsent.maximumMicrousd = 2000001];
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(request); mutate(changed);
    assert.throws(() => readSponsoredAudioActorRequest(changed), /sponsored_audio_actor_intent_invalid/u, `mutation ${index}`);
  }
  for (const key of Object.keys(request)) {
    const changed = structuredClone(request); delete changed[key];
    assert.throws(() => readSponsoredAudioActorRequest(changed), /sponsored_audio_actor_intent_invalid/u, key);
  }
});

test('changed displayed sponsor terms invalidate the existing review reference', async () => {
  const { review, request, native } = await fixture();
  for (const mutate of [x => x.campaignId += '-other', x => x.approvalReceiptDigest = sha('5'), x => x.policyDigest = sha('6'),
    x => x.templateDigest = sha('7'), x => x.payerUserId = 'another-payer', x => x.expiresAt = new Date(Date.parse(x.expiresAt) - 1).toISOString()]) {
    const changed = structuredClone(review); mutate(changed);
    assert.ok(readSponsoredAudioReview(changed));
    assert.equal(await matchSponsoredAudioActorIntent(changed, request, native), null);
  }
  const wrongDigest = structuredClone(request); wrongDigest.sponsorReview.reviewDigest = sha('f');
  assert.equal(await matchSponsoredAudioActorIntent(review, wrongDigest, native), null);
  const wrongCampaign = structuredClone(request); wrongCampaign.sponsorReview.campaignId += '-other';
  assert.equal(await matchSponsoredAudioActorIntent(review, wrongCampaign, native), null);
});

test('exact native quote and every original identity field remain bound after sponsor review', async () => {
  const { review, request, native } = await fixture();
  for (const mutate of [x => x.draftHash = sha('f'), x => x.termsDigest = nativeHash('f'), x => x.preview.actorUserId += '-other',
    x => x.preview.projectId += '-other', x => x.preview.documentId += '-other', x => x.preview.draftId = `experience-draft-${nativeHash('f')}`,
    x => x.preview.requestId = `audio-${nativeHash('f')}`, x => x.preview.sourceDigest = nativeHash('f'), x => x.preview.requirementsDigest = nativeHash('f'),
    x => x.preview.expiresAt = new Date(Date.parse(x.preview.expiresAt) + 1).toISOString(), x => x.preview.maximumMicrousd++,
    x => x.preview.planningModel = 'other', x => x.preview.maximumPlanningCalls = 3, x => x.preview.maximumOutputTokens = 6000,
    x => x.preview.maximumAudioCalls = 2, x => x.preview.maximumCalls = 4, x => x.preview.maximumTokens = 256000,
    x => x.preview.durationSeconds = 21, x => x.preview.sourceFilesTransferred = 1, x => x.extra = true]) {
    const changed = structuredClone(native); mutate(changed);
    assert.equal(sponsoredAudioActorIntentMatchesNative(review, request, changed), false);
    assert.equal(await matchSponsoredAudioActorIntent(review, request, changed), null);
  }
  for (const key of ['requestId', 'actorUserId', 'projectId', 'documentId', 'draftId', 'sourceDigest', 'requirementsDigest', 'expiresAt']) {
    const changed = structuredClone(request);
    changed.audioCostConsent[key] = key.endsWith('Digest') ? nativeHash('f')
      : key === 'requestId' ? `audio-${nativeHash('f')}` : key === 'draftId' ? `experience-draft-${nativeHash('f')}`
        : key === 'expiresAt' ? new Date(Date.parse(changed.audioCostConsent.expiresAt) - 1).toISOString() : `${changed.audioCostConsent[key]}-other`;
    assert.ok(readSponsoredAudioActorRequest(changed));
    assert.equal(await matchSponsoredAudioActorIntent(review, changed, native), null, key);
  }
});

test('closed parsers and matcher reject unsafe JSON without invoking accessors', async () => {
  const { review, request, native } = await fixture(); let getters = 0;
  const shapes = [value => Object.create(value), value => { Object.defineProperty(value, 'hidden', { value: 'extra' }); return value; },
    value => { value[Symbol('extra')] = true; return value; }, value => { value.extra = undefined; return value; },
    value => { value.extra = value; return value; }, value => { value.extra = Array(2); return value; },
    value => { Object.defineProperty(value, Object.keys(value)[0], { enumerable: true, get() { getters++; throw Error('getter'); } }); return value; }];
  for (const shape of shapes) {
    const badReview = shape(structuredClone(review)), badRequest = shape(structuredClone(request)), badNative = shape(structuredClone(native));
    assert.throws(() => readSponsoredAudioReview(badReview), /sponsored_audio_actor_intent_invalid/u);
    assert.throws(() => readSponsoredAudioActorRequest(badRequest), /sponsored_audio_actor_intent_invalid/u);
    assert.equal(await matchSponsoredAudioActorIntent(badReview, request, native), null);
    assert.equal(await matchSponsoredAudioActorIntent(review, badRequest, native), null);
    assert.equal(await matchSponsoredAudioActorIntent(review, request, badNative), null);
  }
  const nested = structuredClone(request); Object.defineProperty(nested.audioCostConsent, 'confirmed', { enumerable: true, get() { getters++; return true; } });
  assert.throws(() => readSponsoredAudioActorRequest(nested), /sponsored_audio_actor_intent_invalid/u);
  assert.equal(getters, 0);
});

test('structural capture stays historical while match requires the earliest live deadline', async () => {
  const { now, review, request, native } = await fixture();
  assert.ok(Date.parse(review.expiresAt) < Date.parse(native.expiresAt)); assert.ok(Date.parse(native.expiresAt) < Date.parse(native.preview.expiresAt));
  assert.equal(sponsoredAudioActorIntentMatchesNative(review, request, native, now), true);
  assert.equal(sponsoredAudioActorIntentMatchesNative(review, request, native, Date.parse(review.expiresAt) - 1), true);
  assert.equal(sponsoredAudioActorIntentMatchesNative(review, request, native, Date.parse(review.expiresAt)), false);
  for (const invalidClock of [NaN, Infinity, -Infinity]) assert.equal(sponsoredAudioActorIntentMatchesNative(review, request, native, invalidClock), false);
  const earlierNative = structuredClone(native); earlierNative.expiresAt = new Date(Date.parse(review.expiresAt) - 1).toISOString();
  assert.equal(await matchSponsoredAudioActorIntent(review, request, earlierNative), null);
  const expiredReview = structuredClone(review), expiredRequest = structuredClone(request);
  expiredReview.expiresAt = new Date(now - 1).toISOString();
  assert.ok(readSponsoredAudioReview(expiredReview)); expiredRequest.sponsorReview.reviewDigest = await digestSponsoredAudioReview(expiredReview);
  assert.equal(await matchSponsoredAudioActorIntent(expiredReview, expiredRequest, native), null);
  const expiredNative = structuredClone(native); expiredNative.preview.expiresAt = new Date(now - 1).toISOString();
  const historicalRequest = structuredClone(request); historicalRequest.audioCostConsent.expiresAt = expiredNative.preview.expiresAt;
  assert.ok(readSponsoredAudioActorRequest(historicalRequest));
  assert.equal(await matchSponsoredAudioActorIntent(review, historicalRequest, expiredNative), null);
});

test('review digest and actor matcher capture all caller objects before their first await', async () => {
  const { review, request, native } = await fixture();
  const expected = await matchSponsoredAudioActorIntent(review, request, native); assert.ok(expected);
  const capturedReview = structuredClone(review), reviewHash = digestSponsoredAudioReview(capturedReview);
  capturedReview.payerUserId = 'late-payer'; capturedReview.preview.documentId = 'late-document';
  assert.equal(await reviewHash, expected.reviewDigest);
  const pending = matchSponsoredAudioActorIntent(review, request, native);
  review.policyDigest = sha('f'); review.preview.sourceDigest = nativeHash('f'); request.explicitAuthorization = false;
  request.audioCostConsent.confirmed = false; request.sponsorReview.reviewDigest = sha('f');
  native.draftHash = sha('f'); native.preview.maximumMicrousd++; native.expiresAt = new Date(0).toISOString();
  assert.deepEqual(await pending, expected);
  assert.equal(await matchSponsoredAudioActorIntent(review, request, native), null);
});

test('expiry after either owned digest refuses return and the synchronous helper never hashes', async () => {
  for (const expireAfter of [1, 2]) {
    const { now, review, request, native } = await fixture();
    const clock = Date.now, subtle = crypto.subtle, originalDigest = subtle.digest; let hashes = 0;
    Date.now = () => now;
    subtle.digest = async function(...args) { const result = await originalDigest.apply(this, args); hashes++; if (hashes === expireAfter) Date.now = () => Date.parse(review.expiresAt); return result; };
    try { assert.equal(await matchSponsoredAudioActorIntent(review, request, native), null); }
    finally { Date.now = clock; subtle.digest = originalDigest; }
    assert.equal(hashes, expireAfter);
  }
  const { now, review, request, native } = await fixture(), subtle = crypto.subtle, originalDigest = subtle.digest;
  subtle.digest = () => { throw Error('Final synchronous native check must not hash'); };
  try { assert.equal(sponsoredAudioActorIntentMatchesNative(review, request, native, now), true); }
  finally { subtle.digest = originalDigest; }
});
