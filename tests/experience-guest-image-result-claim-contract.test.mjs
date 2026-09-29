import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const { canonicalJson, digest } = await import('../src/experiences/compiler.ts');
const { ownerMediaNamespace } = await import('../src/model/media-ownership.ts');
await import('../worker/experience-guest-source.ts');
const { guestImageStageHistoryIdentity } = await import('../worker/experience-guest-image-stage-custody.ts');
const { guestImageResultCopyMetadata, guestImageResultMediaKey } = await import('../worker/experience-guest-image-result-copy-contract.ts');
const { readGuestImageResultClaimLineage, guestImageResultClaimRows, guestImageResultHistoryIdentity,
  readGuestImageResultClaimEventOrigin, readGuestImageResultCompletedCustodyReview, guestImageResultClaimMediaAssociation } = await import('../worker/experience-guest-image-result-claim-contract.ts');

const uuid = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const hash = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const time = seconds => new Date(Date.UTC(2026, 8, 18) + seconds * 1000).toISOString();
const phase = name => process.stderr.write(`[guest-result-claim-contract] ${JSON.stringify({ phase: name })}\n`);
const files = ['worker/experience-guest-image-result-claim-contract.ts', 'worker/experience-guest-image-result-copy-contract.ts',
  'tests/experience-guest-image-result-claim-contract.test.mjs'];
const pins = async () => Object.fromEntries(await Promise.all(files.map(async path =>
  [path, createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex')])));
const deepFrozen = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(deepFrozen); } };

/** Synthetic inert metadata only. It is not a native Run, inventory, lease,
 * byte witness, stored object, completed claim or permission to read anything. */
export async function resultClaimFixture() {
  const sessionId = uuid(4), guestSubject = `guest:${uuid(5)}`, projectId = uuid(6), documentId = uuid(7);
  const generationId = uuid(8), destinationUserId = 'owner-synthetic', requestId = 'claim-request-1';
  const manifest = {
    version: 1, kind: 'original-image-completed-result', sessionId, guestSubject, projectId, documentId,
    sourceHead: 5, sourceSaveHead: 6, quoteHead: 8, runHead: 11, resultHead: 19, expiresAt: time(3600),
    draftHash: hash('draft'), contentDigest: hash('authored source'), sourceEventIds: [uuid(1), uuid(2), uuid(3), uuid(101), uuid(102)],
    originalPayerUserId: 'payer-synthetic', generationId, completionEventId: uuid(9), usageEventId: uuid(10), completedAt: time(20),
    nativeIdentity: { scopeKey: 'original-scope', jobId: 'original-job', slotId: 'original-slot', executionGrantId: 'original-execution-grant',
      issuerGrantId: 'original-issuer-grant', consumptionId: 'original-consumption', planRevisionId: uuid(14), targetId: 'original-target', preflightId: uuid(15) },
    financialReceipt: { period: '2026-09', tokenReservationId: 'original-token-hold', costReservationId: 'original-cost-hold', usedTokens: 123, usedMicrousd: 456 },
    privateContents: [
      { contentId: 'original-planner', kind: 'provider-output', contentDigest: hash('planner body'), bytes: 12, createdAt: time(10), expiresAt: time(3600) },
      { contentId: 'original-prompt', kind: 'prompt', contentDigest: hash('prompt body'), bytes: 11, createdAt: time(11), expiresAt: time(4200) },
    ],
    object: { storageKey: `${ownerMediaNamespace(guestSubject)}/generated/${generationId}.png`, contentSha256: hash('synthetic PNG descriptor').slice(7),
      mimeType: 'image/png', width: 2, height: 3, publicationEventId: uuid(9), recordedDescriptorOnly: true },
    nativeSnapshotDigest: hash('unaltered original native graph'),
  };
  const manifestDigest = await digest(manifest), custodyId = uuid(18), attemptId = uuid(17), writerNonce = uuid(19);
  const leaseSnapshot = { session_id: sessionId, lease_id: uuid(16), destination_user_id: destinationUserId, manifest_digest: manifestDigest,
    request_id: requestId, request_ids_json: canonicalJson([requestId]), acquisitions: 1, created_at_ms: Date.parse(time(21)), expires_at_ms: Date.parse(time(90)) };
  const copy = { version: 1, kind: 'guest-image-result-copy', attemptId, custodyId, requestId, destinationUserId, manifestDigest,
    manifest, leaseSnapshot, source: { byteLength: 80, producerMetadata: { model: 'gpt-image-2', provider: 'openai', adapter: 'image-adapter-1', providerRequestId: '' } },
    destinationKey: guestImageResultMediaKey({ destinationUserId, custodyId, outputId: `object-${generationId.slice(-8)}` }),
    destinationMetadata: guestImageResultCopyMetadata({ attemptId, custodyId, destinationUserId, manifestDigest, manifest, writerNonce }), writerNonce };
  const prefixTypes = ['ProjectCreated', 'DocumentCreated', 'EmptyCanvasChosen', 'BlockCreated', 'BlockCreated'];
  const contextLineage = { version: 1, sessionId, guestSubject, projectId, documentId, draftHash: manifest.draftHash, manifestDigest,
    sourceEventIds: [...manifest.sourceEventIds], sourceHead: 5, destinationUserId, origin: 'https://forma.example', targetStart: 1, targetHead: 5,
    events: prefixTypes.map((type, index) => ({ id: uuid(120 + index), sequence: index + 1, occurred: time(28), recorded: time(28), type,
      public: canonicalJson({ project_id: projectId, ...(index ? { document_id: documentId } : {}), ...(index >= 3 ? { block_id: uuid(140 + index), type: 'intent' } : {}), _private_ref: uuid(120 + index), client_event_id: `guest-context-adoption:v1:${sessionId}:${index}` }),
      privateDigest: hash(`prefix private ${index}`), project: projectId, document: index ? documentId : null,
      key: `guest-context-adoption:v1:${sessionId}:${index}` })), lease: structuredClone(leaseSnapshot) };
  const contextLineageDigest = await digest(contextLineage), requirementId = uuid(23);
  const savePublic = (eventId, actor) => canonicalJson({ block_id: requirementId, type: 'output', scope: 'document', project_id: projectId,
    document_id: documentId, actor_user_id: actor, _private_ref: eventId });
  const command = (key, action, eventId, seconds, requestDigest) => ({ scope_key: `personal:${guestSubject}:${projectId}`, actor_user_id: guestSubject,
    command_key: key, request_digest: requestDigest, action, event_id: eventId, created_at: time(seconds) });
  const resource = (resourceId, operation, seconds) => ({ resource_id: resourceId, campaign_id: 'campaign-synthetic', policy_digest: hash('original policy'),
    limits_digest: hash('original limits'), actor_user_id: guestSubject, session_digest: hash('original session'), operation, intent_key: 'driver-original',
    payload_digest: hash('original command'), text_bytes: 32, issued_grant_id: null, recorded_at_ms: Date.parse(time(seconds)) });
  const saveCommand = command('save-original', 'save', uuid(11), 4, hash('save request').slice(7));
  const saveLineage = { version: 1, kind: 'first-image-save', sessionId, guestSubject, destinationUserId, projectId, documentId,
    draftId: `experience-draft-${'d'.repeat(64)}`, draftHash: manifest.draftHash, manifestDigest, origin: contextLineage.origin, contextLineageDigest,
    source: { head: 5, eventIds: [...manifest.sourceEventIds], expiresAt: time(7200), sessionPolicyId: uuid(24), sessionTermsDigest: hash('terms'),
      sessionExpiresAtMs: Date.parse(time(7200)), sourcePolicyId: uuid(25), sourcePolicyDigest: hash('source policy'), requestDigest: hash('request'),
      contentDigest: manifest.contentDigest, releaseHash: hash('release'),
      save: { id: uuid(11), sequence: 6, occurred: time(4), recorded: time(4), public: savePublic(uuid(11), guestSubject), privateDigest: hash('saved private') },
      command: saveCommand, resource: { ...resource('save-original:text', 'text-intake', 4), intent_key: 'save-original', payload_digest: `sha256:${saveCommand.request_digest}` } },
    target: { id: uuid(26), sequence: 6, occurred: time(28), recorded: time(28), public: savePublic(uuid(26), destinationUserId),
      privateDigest: hash('canonical SAVE private'), commandKey: 'save-canonical', requestDigest: hash('canonical SAVE request').slice(7), requirementId, contextHead: 5 } };
  const saveLineageDigest = await digest(saveLineage), confirmedDigest = hash('original confirmation'), quotedDigest = hash('original quote');
  const stageLineage = { version: 1, kind: 'original-image-stage-custody', sessionId, guestSubject, destinationUserId, projectId, documentId,
    manifestDigest, nativeSnapshotDigest: hash('quoted stage graph separately retained'), contextLineageDigest, saveLineageDigest,
    source: { head: 5, saveHead: 6, stageHead: 8, state: 'quoted', expiresAt: time(7200), originalPayerUserId: manifest.originalPayerUserId, saveEventId: uuid(11),
      confirmation: { id: uuid(12), sequence: 7, occurred: time(5), recorded: time(5),
        public: canonicalJson({ plan_revision_id: uuid(14), project_id: projectId, document_id: documentId, actor_user_id: guestSubject, _private_ref: uuid(12) }), privateDigest: confirmedDigest },
      confirmationCommand: command('confirm-original', 'confirm', uuid(12), 5, hash('confirm request').slice(7)),
      confirmationResource: resource('driver-original:text', 'text-intake', 5),
      quote: { id: uuid(13), sequence: 8, occurred: time(6), recorded: time(6),
        public: canonicalJson({ preflight_id: uuid(15), plan_revision_id: uuid(14), project_id: projectId, document_id: documentId, actor_user_id: guestSubject, _private_ref: uuid(13) }),
        privateDigest: quotedDigest, preflightId: uuid(15), planRevisionId: uuid(14), expiresAt: time(600), termsDigest: hash('quote terms').slice(7) },
      quoteCommand: command('preflight-original', 'preflight', uuid(13), 6, hash('preflight command').slice(7)),
      construction: { driverId: 'driver-original', commandDigest: hash('preflight command').slice(7), resource: resource('driver-original:preflight', 'preflight', 6) } },
    copies: [] };
  const stageCopies = [];
  for (const [index, role] of ['confirmation', 'quote', 'construction'].entries()) {
    const originalDigest = [confirmedDigest, quotedDigest, hash('original construction')][index];
    const contentId = await guestImageStageHistoryIdentity({ sessionId, destinationUserId, manifestDigest, role, originalDigest });
    stageLineage.copies.push({ role, contentId, digest: originalDigest, bytes: index + 20 });
    stageCopies.push({ session_id: sessionId, role, content_id: contentId, original_digest: originalDigest, byte_length: index + 20,
      created_at: time(29), expires_at: time(2600000 + index) });
  }
  const resultCopies = [];
  for (const [index, role] of ['planner', 'prompt'].entries()) {
    const source = manifest.privateContents[index];
    resultCopies.push({ custody_id: custodyId, role,
      content_id: await guestImageResultHistoryIdentity({ sessionId, destinationUserId, manifestDigest, role, originalDigest: source.contentDigest }),
      original_content_id: source.contentId, original_kind: source.kind, original_digest: source.contentDigest, byte_length: source.bytes,
      created_at: time(29), expires_at: time(2592000 + index) });
  }
  return { version: 1, kind: 'original-image-result-custody', copy, contextLineage, contextLineageDigest, saveLineage, saveLineageDigest,
    stageLineage, stageLineageDigest: await digest(stageLineage), stageCopies, resultCopies,
    originalCompletion: { eventId: manifest.completionEventId, sequence: 18, occurredAt: time(19), recordedAt: time(19), privateDigest: hash('original completion'),
      objectId: `object-${generationId.slice(-8)}`, ...structuredClone(copy.source.producerMetadata) },
    canonical: { eventId: uuid(27), streamId: `creative:${destinationUserId}`, sequence: 7, occurredAt: time(30), recordedAt: time(30),
      privateDigest: hash('claim envelope commits custody, output, generation and source manifest; not its own lineage digest'), expiresAt: time(2592000) } };
}

test('positive: full five-body claim contract preserves native history and canonical receipts', async () => {
  const before = await pins(); phase('positive-start');
  const value = await resultClaimFixture(), retained = structuredClone(value), parsed = await readGuestImageResultClaimLineage(value);
  assert.deepEqual(parsed, retained); deepFrozen(parsed); assert.deepEqual(value, retained);
  const rows = await guestImageResultClaimRows(value);
  assert.equal(rows.copies.length, 2); assert.equal(parsed.stageCopies.length + rows.copies.length, 5);
  assert.equal(rows.custody.output_id, `object-${value.copy.manifest.generationId.slice(-8)}`);
  assert.equal(rows.custody.original_completion_event_id, value.copy.manifest.completionEventId);
  assert.equal(rows.custody.native_snapshot_digest, value.copy.manifest.nativeSnapshotDigest);
  assert.notEqual(parsed.stageLineage.nativeSnapshotDigest, parsed.copy.manifest.nativeSnapshotDigest);
  assert.notEqual(parsed.stageLineage.source.expiresAt, parsed.copy.manifest.expiresAt);
  assert.equal(rows.custody.canonical_expires_at, value.resultCopies[0].expires_at);
  assert.ok(rows.custody.canonical_expires_at > value.copy.manifest.expiresAt);
  assert.equal(parsed.copy.manifest.originalPayerUserId, 'payer-synthetic');
  assert.deepEqual(parsed.copy.manifest.financialReceipt, retained.copy.manifest.financialReceipt);
  assert.equal(rows.custody.lineage_digest, await digest(parsed));
  assert.deepEqual(readGuestImageResultCompletedCustodyReview(rows.completedReview), rows.completedReview);
  assert.equal(Object.hasOwn(parsed.canonical, 'lineageDigest'), false, 'no self-referential private-envelope digest');
  assert.deepEqual(readGuestImageResultClaimEventOrigin(rows.eventOrigin), rows.eventOrigin);
  assert.throws(() => readGuestImageResultClaimEventOrigin({ ...rows.eventOrigin, lineageDigest: rows.custody.lineage_digest }));
  assert.throws(() => readGuestImageResultCompletedCustodyReview(rows.eventOrigin));
  assert.throws(() => readGuestImageResultClaimEventOrigin(rows.completedReview));
  assert.deepEqual(await pins(), before); phase('positive-passed');
});

test('positive: original and revision associations stay in the guarded family', async () => {
  const { copy, originalCompletion } = await resultClaimFixture();
  const input = { destinationUserId: copy.destinationUserId, custodyId: copy.custodyId, outputId: originalCompletion.objectId };
  assert.equal(guestImageResultClaimMediaAssociation(input), copy.destinationKey);
  assert.equal(guestImageResultClaimMediaAssociation({ ...input, revisionId: uuid(99) }),
    `${copy.destinationKey.slice(0, -4)}/revisions/${uuid(99)}.png`);
});

test('positive: event envelope and completed review form an acyclic commitment', async () => {
  const value = await resultClaimFixture(), c = value.copy;
  const selector = readGuestImageResultClaimEventOrigin({ version: 1, kind: 'guest-image-result-event-origin-v1', custodyId: c.custodyId,
    claimEventId: value.canonical.eventId, outputId: value.originalCompletion.objectId, generationId: c.manifest.generationId,
    manifestDigest: c.manifestDigest });
  const envelope = { custody_id: selector.custodyId, object_id: selector.outputId, generation_id: selector.generationId,
    manifest_digest: selector.manifestDigest, event_origin: selector };
  const envelopeBytes = canonicalJson(envelope);
  value.canonical.privateDigest = await digest(envelopeBytes);
  const rows = await guestImageResultClaimRows(value);
  assert.deepEqual(rows.eventOrigin, selector);
  assert.equal(rows.custody.lineage_digest, await digest(value));
  assert.equal(canonicalJson(envelope), envelopeBytes);
  assert.equal(envelopeBytes.includes(rows.completedReview.lineageDigest), false);
  assert.throws(() => readGuestImageResultClaimEventOrigin({ ...selector, lineageDigest: rows.completedReview.lineageDigest }));
});

test('claim contract rejects partial, reordered or contradictory graphs', async t => {
  const mutations = {
    'stage copy before lease': v => { v.stageCopies[0].created_at = time(20); },
    'result copy before lease': v => { v.resultCopies[0].created_at = time(20); },
    'missing planner': v => v.resultCopies.shift(),
    'missing stage construction': v => v.stageCopies.pop(),
    'reordered history': v => v.stageCopies.reverse(),
    'reordered result bodies': v => v.resultCopies.reverse(),
    'different payer': v => { v.stageLineage.source.originalPayerUserId = 'changed-payer'; },
    'different source expiry': v => { v.stageLineage.source.expiresAt = v.copy.manifest.expiresAt; },
    'changed fixed canonical expiry': v => { v.canonical.expiresAt = time(2592100); },
    'expired copy on original claim': v => { v.resultCopies[0].expires_at = time(30); },
    'borrowed result body': v => { v.resultCopies[0].content_id = v.resultCopies[1].content_id; },
    'source body relabeled as copy': v => { v.resultCopies[0].content_id = v.copy.manifest.privateContents[0].contentId; },
    'oversized result body': v => { v.resultCopies[0].byte_length = 65537; },
    'omitted canonical envelope': v => { delete v.canonical.privateDigest; },
    'canonical event reuses original completion': v => { v.canonical.eventId = v.copy.manifest.completionEventId; },
    'canonical stream uses payer': v => { v.canonical.streamId = `creative:${v.copy.manifest.originalPayerUserId}`; },
    'canonical claim after lease expiry': v => { v.canonical.occurredAt = v.canonical.recordedAt = time(90); },
    'changed original model': v => { v.originalCompletion.model = 'registry-current-model'; },
    'generation UUID substituted for output': v => { v.originalCompletion.objectId = v.copy.manifest.generationId; },
    'fake renewed source': v => { v.copy.manifest.expiresAt = time(9999); },
    'extra native grant': v => { v.nativeGrant = {}; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const value = await resultClaimFixture(); mutate(value); await assert.rejects(readGuestImageResultClaimLineage(value));
  });
});

test('claim contract rejects getters, aliases, hidden fields and mutation across hash awaits', async () => {
  let reads = 0;
  const accessor = await resultClaimFixture(); Object.defineProperty(accessor, 'copy', { enumerable: true, get() { reads++; throw Error('getter ran'); } });
  await assert.rejects(readGuestImageResultClaimLineage(accessor)); assert.equal(reads, 0);
  const aliased = await resultClaimFixture(); aliased.contextLineage.lease = aliased.copy.leaseSnapshot;
  await assert.rejects(readGuestImageResultClaimLineage(aliased));
  const hidden = await resultClaimFixture(); Object.defineProperty(hidden, 'hidden', { value: true });
  await assert.rejects(readGuestImageResultClaimLineage(hidden));
  const inherited = await resultClaimFixture(), prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, 'map', { get() { reads++; throw Error('inherited getter ran'); } });
  Object.setPrototypeOf(inherited.copy.manifest.sourceEventIds, prototype);
  await assert.rejects(readGuestImageResultClaimLineage(inherited)); assert.equal(reads, 0);
  const mutable = await resultClaimFixture(), original = structuredClone(mutable);
  const pending = readGuestImageResultClaimLineage(mutable); mutable.canonical.expiresAt = time(9000000); mutable.resultCopies.length = 0;
  assert.deepEqual(await pending, original, 'all input was copied before any await');
});

test('claim contract checks semantic joins even when altered component digests are recomputed', async () => {
  const payer = await resultClaimFixture(); payer.stageLineage.source.originalPayerUserId = 'different-payer'; payer.stageLineageDigest = await digest(payer.stageLineage);
  await assert.rejects(readGuestImageResultClaimLineage(payer));
  const stageExpiry = await resultClaimFixture(); stageExpiry.stageLineage.source.expiresAt = stageExpiry.copy.manifest.expiresAt;
  stageExpiry.stageLineageDigest = await digest(stageExpiry.stageLineage); await assert.rejects(readGuestImageResultClaimLineage(stageExpiry));
  const dropped = await resultClaimFixture(); dropped.contextLineage.events.pop(); dropped.contextLineage.targetHead--;
  dropped.contextLineageDigest = await digest(dropped.contextLineage); await assert.rejects(readGuestImageResultClaimLineage(dropped));
});

test('context prefix rejects impossible order, receipt keys and block collisions after rehashing', async t => {
  const mutations = {
    'impossible ordinal': v => { v.contextLineage.events[0].type = 'BlockCreated'; },
    'wrong public receipt key': v => {
      const event = v.contextLineage.events[3], payload = JSON.parse(event.public); payload.client_event_id = 'different'; event.public = canonicalJson(payload);
    },
    'missing suffix block ID': v => {
      const event = v.contextLineage.events[3], payload = JSON.parse(event.public); delete payload.block_id; event.public = canonicalJson(payload);
    },
    'duplicated context block': v => {
      const event = v.contextLineage.events[4], payload = JSON.parse(event.public);
      payload.block_id = JSON.parse(v.contextLineage.events[3].public).block_id; event.public = canonicalJson(payload);
    },
    'context collides with SAVE requirement': v => {
      const event = v.contextLineage.events[3], payload = JSON.parse(event.public); payload.block_id = v.saveLineage.target.requirementId; event.public = canonicalJson(payload);
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const value = await resultClaimFixture(); mutate(value);
    value.contextLineageDigest = await digest(value.contextLineage);
    value.saveLineage.contextLineageDigest = value.contextLineageDigest;
    value.saveLineageDigest = await digest(value.saveLineage);
    value.stageLineage.contextLineageDigest = value.contextLineageDigest;
    value.stageLineage.saveLineageDigest = value.saveLineageDigest;
    value.stageLineageDigest = await digest(value.stageLineage);
    await assert.rejects(readGuestImageResultClaimLineage(value));
  });
});

test('claimed-origin descriptor is closed inert data and identity hashes bind role and principal', async () => {
  const value = await resultClaimFixture(), rows = await guestImageResultClaimRows(value);
  assert.throws(() => readGuestImageResultCompletedCustodyReview({ ...rows.completedReview, authorized: true }));
  assert.throws(() => readGuestImageResultCompletedCustodyReview({ ...rows.completedReview, lineageDigest: 'not-a-digest' }));
  const input = { sessionId: value.copy.manifest.sessionId, destinationUserId: value.copy.destinationUserId,
    manifestDigest: value.copy.manifestDigest, role: 'planner', originalDigest: value.copy.manifest.privateContents[0].contentDigest };
  const one = await guestImageResultHistoryIdentity(input);
  assert.notEqual(one, await guestImageResultHistoryIdentity({ ...input, role: 'prompt' }));
  assert.notEqual(one, await guestImageResultHistoryIdentity({ ...input, destinationUserId: 'owner-other' }));
  assert.notEqual(one, await guestImageResultHistoryIdentity({ ...input, destinationUserId: 'créateur' }));
  await assert.rejects(guestImageResultHistoryIdentity({ ...input, destinationUserId: value.copy.manifest.guestSubject }));
  await assert.rejects(guestImageResultHistoryIdentity({ ...input, originalDigest: '\ud800' }));
});
