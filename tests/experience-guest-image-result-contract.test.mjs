import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const originalFetch = globalThis.fetch; let networkCalls = 0;
globalThis.fetch = () => { networkCalls++; throw Error('pure result contracts forbid network'); };
after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });
const [{ readGuestImageResultManifest, readGuestImageResultContent, readGuestImageResultObject }, { ownerMediaNamespace }] = await Promise.all([
  import('../worker/experience-guest-image-result-contract.ts'), import('../src/model/media-ownership.ts'),
]);
const [format, intake, compiler, { makeEvent }, { authoritativeCreativeContext }] = await Promise.all([
  import('../worker/experience-sponsor-image-format.ts'), import('../src/experiences/intake.ts'), import('../src/experiences/compiler.ts'),
  import('../worker/event-write-primitives.ts'), import('../worker/context-authority.ts'),
]);
const uuid = number => `01995101-0000-7000-8000-${number.toString(16).padStart(12, '0')}`;
const digest = `sha256:${'a'.repeat(64)}`;
// Pure values only: this sample is not an inventory brand, native graph or
// permission. Real native positive inventories live in the separate test file.
function sample() {
  const guestSubject = `guest:${uuid(1)}`, generationId = uuid(7), completionEventId = uuid(8);
  return { version: 1, kind: 'original-image-completed-result', sessionId: 'synthetic-session', guestSubject,
    projectId: 'synthetic-project', documentId: 'synthetic-document', sourceHead: 3, sourceSaveHead: 4, quoteHead: 6, runHead: 9, resultHead: 17,
    expiresAt: '2026-09-17T00:10:00.000Z', draftHash: digest, contentDigest: digest, sourceEventIds: [uuid(2), uuid(3), uuid(4)],
    originalPayerUserId: 'synthetic-payer', generationId, completionEventId, usageEventId: uuid(9), completedAt: '2026-09-17T00:01:00.000Z',
    nativeIdentity: { scopeKey: `personal:${guestSubject}:synthetic-project`, jobId: 'original-job', slotId: 'original-slot', executionGrantId: 'original-execution-grant',
      issuerGrantId: 'original-issuer-grant', consumptionId: 'original-consumption', planRevisionId: 'original-plan', targetId: 'original-target', preflightId: 'original-quote' },
    financialReceipt: { period: '2026-09', tokenReservationId: 'original-token-hold', costReservationId: 'original-cost-hold', usedTokens: 400, usedMicrousd: 4200 },
    privateContents: [{ contentId: 'original-planner-body', kind: 'provider-output', contentDigest: digest, bytes: 200, createdAt: '2026-09-17T00:00:40.000Z', expiresAt: '2026-09-17T01:00:00.000Z' },
      { contentId: 'original-prompt-body', kind: 'prompt', contentDigest: digest, bytes: 400, createdAt: '2026-09-17T00:00:50.000Z', expiresAt: '2026-09-17T01:00:00.000Z' }],
    object: { storageKey: `${ownerMediaNamespace(guestSubject)}/generated/${generationId}.png`, contentSha256: 'b'.repeat(64), mimeType: 'image/png', width: 1024, height: 1024,
      publicationEventId: completionEventId, recordedDescriptorOnly: true }, nativeSnapshotDigest: digest };
}
const frozen = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const item of Object.values(value)) frozen(item); } };
test('completed-result manifest parses detached deeply frozen historical descriptors only', () => {
  const original = sample(), value = readGuestImageResultManifest(original); assert.deepEqual(value, original); assert.notEqual(value, original); frozen(value);
  original.privateContents[0].bytes++; assert.equal(value.privateContents[0].bytes, 200);
  assert.equal(value.object.recordedDescriptorOnly, true); assert.equal(Object.hasOwn(value, 'proof'), false);
});

const defects = {
  'unknown manifest version': m => { m.version = 2; },
  'earlier stage kind': m => { m.kind = 'original-image-stage-history'; },
  'extra authority field': m => { m.custodyTransferred = true; },
  'missing original payer': m => { delete m.originalPayerUserId; },
  'guest pretending to be payer': m => { m.originalPayerUserId = m.guestSubject; },
  'session secret in identifier': m => { m.sessionId = 'forma-guest-session-v1.secret'; },
  'incorrect source-to-result sequence': m => { m.resultHead--; },
  'incorrect quote sequence': m => { m.quoteHead++; },
  'duplicate source event': m => { m.sourceEventIds[1] = m.sourceEventIds[0]; },
  'completion reusing a source event': m => { m.completionEventId = m.sourceEventIds[0]; m.object.publicationEventId = m.completionEventId; },
  'usage reusing completion': m => { m.usageEventId = m.completionEventId; },
  'completion at retention expiry': m => { m.completedAt = m.expiresAt; },
  'noncanonical timestamp': m => { m.completedAt = '2026-09-17T00:01:00Z'; },
  'bare compiler digest': m => { m.nativeSnapshotDigest = 'a'.repeat(64); },
  'extra native identity': m => { m.nativeIdentity.claimantUserId = 'claimant'; },
  'same token and cost hold': m => { m.financialReceipt.costReservationId = m.financialReceipt.tokenReservationId; },
  'unsafe financial amount': m => { m.financialReceipt.usedMicrousd = Number.MAX_SAFE_INTEGER + 1; },
  'negative known usage': m => { m.financialReceipt.usedTokens = -1; },
  'invalid billing period': m => { m.financialReceipt.period = '2026-13'; },
  'duplicate private body': m => { m.privateContents[1].contentId = m.privateContents[0].contentId; },
  'reversed private-body kinds': m => { m.privateContents.reverse(); },
  'extra private body': m => { m.privateContents.push(structuredClone(m.privateContents[0])); },
  'private body beyond bounded bytes': m => { m.privateContents[0].bytes = 65537; },
  'private body retained shorter than manifest': m => { m.privateContents[0].expiresAt = '2026-09-17T00:02:00.000Z'; },
  'private body created after completion': m => { m.privateContents[0].createdAt = '2026-09-17T00:02:00.000Z'; },
  'foreign object owner': m => { m.object.storageKey = `${ownerMediaNamespace('foreign')}/generated/${m.generationId}.png`; },
  'different generation object': m => { m.object.storageKey = `${ownerMediaNamespace(m.guestSubject)}/generated/${uuid(99)}.png`; },
  'unrelated publication event': m => { m.object.publicationEventId = uuid(99); },
  'prefixed object hash': m => { m.object.contentSha256 = digest; },
  'claim of freshly verified bytes': m => { m.object.recordedDescriptorOnly = false; },
  'non-PNG descriptor': m => { m.object.mimeType = 'image/jpeg'; },
  'nonfinite width': m => { m.object.width = Infinity; },
};
for (const [name, mutate] of Object.entries(defects)) test(`completed-result contract rejects ${name}`, () => {
  const value = sample(); mutate(value); assert.throws(() => readGuestImageResultManifest(value));
});

test('manifest accessors, inherited fields, symbols and cycles cannot run user code or become descriptors', () => {
  let accesses = 0;
  const root = sample(); Object.defineProperty(root, 'version', { enumerable: true, get() { accesses++; return 1; } });
  const nested = sample(); Object.defineProperty(nested.object, 'width', { enumerable: true, get() { accesses++; return 1024; } });
  const inherited = Object.assign(Object.create({ extra: true }), sample()), symbol = sample(), cyclic = sample();
  symbol[Symbol('authority')] = true; cyclic.nativeIdentity.self = cyclic;
  for (const value of [root, nested, inherited, symbol, cyclic]) assert.throws(() => readGuestImageResultManifest(value));
  assert.equal(accesses, 0);
});

test('standalone private-content and object validators stay closed without manifest authority', () => {
  const value = sample(); assert.deepEqual(readGuestImageResultContent(value.privateContents[0]), value.privateContents[0]);
  assert.deepEqual(readGuestImageResultObject(value.object), value.object);
  for (const body of [{ ...value.privateContents[0], content: 'private text' }, { ...value.privateContents[0], bytes: 0 }]) assert.throws(() => readGuestImageResultContent(body));
  for (const object of [{ ...value.object, body: 'bytes' }, { ...value.object, url: 'https://foreign.invalid/image.png' }]) assert.throws(() => readGuestImageResultObject(object));
});

async function alternateRelease(original) {
  const definition = structuredClone(original.definition), output = structuredClone(original.output); definition.revision++; output.result = '1 retained historical image';
  const catalog = { version: 'forma-experience-context@2', qualification: 'context-authoring',
    interactions: Object.fromEntries(Object.values(original.interactions).map(value => [value.id, structuredClone(value)])), outputs: { [output.id]: output }, copy: structuredClone(original.copy) };
  const compiled = await compiler.compileExperience(definition, catalog); assert.equal(compiled.ok, true); return compiled.release;
}
async function releaseFacts(release) {
  const owner = `guest:${uuid(1)}`, values = intake.initialValues(release); values.subject = { value: 'A retained orchard', provenance: 'authored' };
  values.ratio = { value: { width: 1, height: 1 }, provenance: 'authored' };
  const plan = await intake.buildExperiencePlan(owner, { intentId: '11111111-1111-4111-a111-111111111111', experienceId: 'image', releaseHash: release.releaseHash, values }, release);
  const events = plan.events.map((event, index) => makeEvent(plan.streamId, index + 1, owner, 'server:guest-source', plan.draftId, event.type, event.payload));
  return authoritativeCreativeContext(events, { projectId: plan.projectId, documentId: plan.documentId }).snapshot.facts;
}
test('retained format validates an independently compiled alternate release while the unchanged current predicate rejects it', async () => {
  const current = await intake.registeredExperience('image'), historical = await alternateRelease(current);
  assert.notEqual(historical.releaseHash, current.releaseHash); assert.notEqual(historical.output.result, current.output.result);
  const currentFacts = await releaseFacts(current), historicalFacts = await releaseFacts(historical);
  const currentToken = await format.createRetainedSponsorImageFormat(current, current.releaseHash), historicalToken = await format.createRetainedSponsorImageFormat(historical, historical.releaseHash);
  assert.equal(await format.sponsorImageTextSource(currentFacts), true);
  assert.equal(await format.sponsorImageTextSourceForRetainedFormat(currentFacts, currentToken), true);
  assert.equal(await format.sponsorImageTextSource(historicalFacts), false);
  assert.equal(await format.sponsorImageTextSourceForRetainedFormat(historicalFacts, historicalToken), true);
  assert.equal(await format.sponsorImageTextSourceForRetainedFormat(historicalFacts, currentToken), false);
});

test('retained format token captures original release bytes before asynchronous digest work', async () => {
  const original = await intake.registeredExperience('image'), raw = structuredClone(original), facts = await releaseFacts(original);
  const pending = format.createRetainedSponsorImageFormat(raw, original.releaseHash);
  raw.definition.revision++; raw.output.result = 'Mutated after constructor call';
  const token = await pending; assert.ok(Object.isFrozen(token));
  assert.equal(await format.sponsorImageTextSourceForRetainedFormat(facts, token), true);
  const subjectOnly = facts.filter(fact => fact.type === 'subject'); assert.ok(subjectOnly.length > 0);
  for (const forged of [{}, structuredClone(token), Object.create(token)]) for (const input of [facts, [], subjectOnly])
    await assert.rejects(Promise.resolve().then(() => format.sponsorImageTextSourceForRetainedFormat(input, forged)));
});

test('retained format rejects malformed release JSON, mismatched hashes and inconsistent compiler dependencies', async () => {
  const original = await intake.registeredExperience('image'); let accesses = 0;
  const mutations = [value => { value.extra = true; }, value => { value.definition.revision++; }, value => { value.output.result += ' changed'; },
    value => { value.interactions.subject.maxLength--; }, value => { value.copy['image.subject'] += ' changed'; },
    value => { value.dependencies[Object.keys(value.dependencies)[0]] = digest; }, value => { value.definitionHash = digest; }, value => { value.releaseHash = digest; },
    value => { value.definition.id = 'video'; }, value => { value.output.output = 'video'; }, value => { value.schemaVersion = 2; },
    value => { value.qualification = 'provider-authorization'; }, value => { value.interactions.ratio.ratios = []; },
    value => { value.copy[Symbol('hidden')] = 'hidden'; }, value => { value.output.self = value; },
    value => { Object.defineProperty(value, 'definition', { enumerable: true, get() { accesses++; return original.definition; } }); }];
  for (const mutate of mutations) { const raw = structuredClone(original); mutate(raw); await assert.rejects(format.createRetainedSponsorImageFormat(raw, original.releaseHash)); }
  await assert.rejects(format.createRetainedSponsorImageFormat(original, digest)); assert.equal(accesses, 0);
});

test('retained release enforces scalar and ratio semantics even with genuine recomputed compiler hashes', async () => {
  const original = await intake.registeredExperience('image');
  for (const field of ['interaction kind', 'non-ratio role', 'ratio role']) {
    const output = structuredClone(original.output), interactions = Object.fromEntries(Object.values(original.interactions).map(value => [value.id, structuredClone(value)]));
    if (field === 'interaction kind') { const interaction = Object.values(interactions).find(value => value.options); assert.ok(interaction); interaction.kind = [interaction.kind]; }
    else if (field === 'non-ratio role') { const binding = output.bindings.find(value => value.decisionId !== 'ratio'); assert.ok(binding); binding.role = [binding.role]; }
    else { const binding = output.bindings.find(value => value.decisionId === 'ratio'); assert.ok(binding); binding.role = 'direction'; }
    const compiled = await compiler.compileExperience(original.definition, { version: 'forma-experience-context@2', qualification: 'context-authoring', interactions,
      outputs: { [output.id]: output }, copy: original.copy });
    assert.equal(compiled.ok, true, 'actual context compiler admits this dependency shape');
    await assert.rejects(format.createRetainedSponsorImageFormat(compiled.release, compiled.release.releaseHash));
  }
});

test('retained release retains every exact native format fact boundary', async () => {
  const release = await intake.registeredExperience('image'), token = await format.createRetainedSponsorImageFormat(release, release.releaseHash), facts = await releaseFacts(release);
  const ratioIndex = facts.findIndex(fact => fact.handle === 'format/experience-ratio'), outputIndex = facts.findIndex(fact => fact.handle === 'format/experience-deliverable');
  assert.ok(ratioIndex >= 0 && outputIndex >= 0);
  const changes = [fact => { fact.properties.experience_release = digest; }, fact => { fact.properties.experience_binding = 'foreign-binding'; },
    fact => { fact.handle = 'format/foreign'; }, fact => { fact.role = 'subject'; }, fact => { fact.active = false; },
    fact => { fact.intent = 'exclude'; }, fact => { fact.effect = 'ignore'; }, fact => { fact.authority = 'inferred'; },
    fact => { fact.properties.authority = 'inferred'; }, fact => { fact.properties.experience_origin = 'default'; },
    fact => { fact.properties.spatial_scope.coordinate_space = 'pixels'; }, fact => { fact.properties.provider = 'foreign-provider'; },
    fact => { fact.properties.image_format.dimensions.width++; }, fact => { fact.properties.text = 'Ratio: 4:3'; }];
  for (const change of changes) { const altered = structuredClone(facts); change(altered[ratioIndex]); assert.equal(await format.sponsorImageTextSourceForRetainedFormat(altered, token), false); }
  const altered = structuredClone(facts); altered[outputIndex].properties.text += ' changed'; assert.equal(await format.sponsorImageTextSourceForRetainedFormat(altered, token), false);
});
