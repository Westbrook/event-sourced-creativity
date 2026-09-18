import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const contract = await import('../worker/experience-guest-image-result-copy-contract.ts');
const { canonicalJson, digest } = await import('../src/experiences/compiler.ts');
const { ownerMediaNamespace, mediaKeyMatchesOwnerNamespace } = await import('../src/model/media-ownership.ts');
const uuid = number => `01995101-0000-7000-8000-${number.toString(16).padStart(12, '0')}`;
const hash = `sha256:${'a'.repeat(64)}`;
const clone = value => structuredClone(value);
const frozen = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const item of Object.values(value)) frozen(item); } };

/** Shared synthetic contract values with genuine recomputed JSON digests. This
 * fixture is no native graph, source/byte witness, PUT receipt or claim. */
export async function guestImageResultCopyContractFixture() {
  const guestSubject = `guest:${uuid(1)}`, generationId = uuid(7), completionEventId = uuid(8);
  const manifest = { version: 1, kind: 'original-image-completed-result', sessionId: 'synthetic-session', guestSubject,
    projectId: 'synthetic-project', documentId: 'synthetic-document', sourceHead: 3, sourceSaveHead: 4, quoteHead: 6, runHead: 9, resultHead: 17,
    expiresAt: '2026-09-18T00:10:00.000Z', draftHash: hash, contentDigest: hash, sourceEventIds: [uuid(2), uuid(3), uuid(4)],
    originalPayerUserId: 'synthetic-payer', generationId, completionEventId, usageEventId: uuid(9), completedAt: '2026-09-18T00:01:00.000Z',
    nativeIdentity: { scopeKey: `personal:${guestSubject}:synthetic-project`, jobId: 'original-job', slotId: 'original-slot', executionGrantId: 'original-execution-grant',
      issuerGrantId: 'original-issuer-grant', consumptionId: 'original-consumption', planRevisionId: 'original-plan', targetId: 'original-target', preflightId: 'original-quote' },
    financialReceipt: { period: '2026-09', tokenReservationId: 'original-token-hold', costReservationId: 'original-cost-hold', usedTokens: 400, usedMicrousd: 4200 },
    privateContents: [{ contentId: 'original-planner-body', kind: 'provider-output', contentDigest: hash, bytes: 200, createdAt: '2026-09-18T00:00:40.000Z', expiresAt: '2026-09-18T01:00:00.000Z' },
      { contentId: 'original-prompt-body', kind: 'prompt', contentDigest: hash, bytes: 400, createdAt: '2026-09-18T00:00:50.000Z', expiresAt: '2026-09-18T01:00:00.000Z' }],
    object: { storageKey: `${ownerMediaNamespace(guestSubject)}/generated/${generationId}.png`, contentSha256: 'b'.repeat(64), mimeType: 'image/png', width: 1024, height: 1024,
      publicationEventId: completionEventId, recordedDescriptorOnly: true }, nativeSnapshotDigest: hash };
  const manifestDigest = await digest(manifest), destinationUserId = 'synthetic:é', requestId = 'request-first';
  const leaseSnapshot = { session_id: manifest.sessionId, lease_id: uuid(40), destination_user_id: destinationUserId, manifest_digest: manifestDigest,
    request_id: requestId, request_ids_json: canonicalJson([requestId]), acquisitions: 1,
    created_at_ms: Date.parse('2026-09-18T00:02:00.000Z'), expires_at_ms: Date.parse('2026-09-18T00:04:00.000Z') };
  const identities = { attemptId: uuid(41), custodyId: uuid(42), destinationUserId, manifestDigest, manifest, writerNonce: uuid(43) };
  const descriptor = { version: 1, kind: 'guest-image-result-copy', ...identities, requestId, leaseSnapshot,
    source: { byteLength: 12345, producerMetadata: { model: 'gpt-image-2', provider: 'openai', adapter: 'openai-image-1', providerRequestId: '' } },
    destinationKey: contract.guestImageResultMediaKey({ destinationUserId, custodyId: identities.custodyId, outputId: contract.guestImageResultOriginalOutputId(generationId) }),
    destinationMetadata: contract.guestImageResultCopyMetadata(identities) };
  const created = leaseSnapshot.created_at_ms + 1000;
  const reserved = { attempt_id: descriptor.attemptId, custody_id: descriptor.custodyId, session_id: manifest.sessionId, destination_user_id: destinationUserId,
    lease_id: leaseSnapshot.lease_id, lease_acquisition: 1, request_id: requestId, manifest_digest: manifestDigest,
    descriptor_json: canonicalJson(descriptor), descriptor_digest: await contract.guestImageResultCopyDescriptorDigest(descriptor),
    lease_snapshot_json: canonicalJson(leaseSnapshot), source_expires_at_ms: Date.parse(manifest.expiresAt), destination_key: descriptor.destinationKey,
    writer_nonce: descriptor.writerNonce, content_sha256: manifest.object.contentSha256, byte_length: descriptor.source.byteLength,
    mime_type: 'image/png', width: 1024, height: 1024, destination_metadata_json: canonicalJson(descriptor.destinationMetadata),
    state: 'reserved', row_version: 0, put_outcome: 'pending', created_at_ms: created, updated_at_ms: created,
    put_started_at_ms: null, put_settled_at_ms: null, verified_at_ms: null, published_at_ms: null, published_claim_digest: null };
  const writing = { ...reserved, state: 'writing', row_version: 1, updated_at_ms: created + 10, put_started_at_ms: created + 10 };
  const unknown = { ...writing, row_version: 2, put_outcome: 'unknown', updated_at_ms: created + 20 };
  const acknowledged = { ...writing, row_version: 2, put_outcome: 'success', updated_at_ms: created + 20, put_settled_at_ms: created + 20 };
  const ready = { ...acknowledged, state: 'ready', row_version: 3, updated_at_ms: created + 30, verified_at_ms: created + 30 };
  const published = { ...ready, state: 'published', row_version: 4, updated_at_ms: created + 40, published_at_ms: created + 40, published_claim_digest: hash };
  const cleanupPending = { ...ready, state: 'cleanup_pending', row_version: 4, updated_at_ms: created + 40 };
  const deleted = { ...cleanupPending, state: 'deleted', row_version: 5, updated_at_ms: created + 50 };
  const nullSettled = { ...writing, row_version: 2, put_outcome: 'conditional-null', updated_at_ms: created + 20, put_settled_at_ms: created + 20 };
  const nullCleaned = { ...nullSettled, state: 'cleanup_pending', row_version: 3, updated_at_ms: created + 30 };
  const nullDeleted = { ...nullCleaned, state: 'deleted', row_version: 4, updated_at_ms: created + 40 };
  const abandoned = { ...reserved, state: 'cleanup_pending', row_version: 1, updated_at_ms: created + 10 };
  const neverWrittenDeleted = { ...abandoned, state: 'deleted', row_version: 2, updated_at_ms: created + 20 };
  return { manifest, descriptor, reserved, writing, unknown, acknowledged, ready, published, cleanupPending, deleted,
    nullSettled, nullCleaned, nullDeleted, abandoned, neverWrittenDeleted };
}

test('positive: valid closed descriptor, exact row and successful lifecycle remain detached inert values', async () => {
  const fixture = await guestImageResultCopyContractFixture(), { descriptor } = fixture;
  const parsed = await contract.validateGuestImageResultCopyDescriptor(descriptor);
  assert.deepEqual(parsed, descriptor); assert.notEqual(parsed, descriptor); frozen(parsed);
  assert.equal(parsed.destinationMetadata.generationId, parsed.manifest.generationId);
  assert.equal(parsed.destinationMetadata.outputId, `object-${parsed.manifest.generationId.slice(-8)}`);
  assert.notEqual(parsed.destinationMetadata.generationId, parsed.destinationMetadata.outputId);
  for (const name of ['reserved', 'writing', 'acknowledged', 'ready', 'published']) {
    const row = await contract.readGuestImageResultCopyAttemptRow(fixture[name]); assert.deepEqual(row, fixture[name]); frozen(row);
    assert.equal(Object.hasOwn(row, 'authority'), false); assert.equal(Object.getOwnPropertySymbols(row).length, 0);
  }
  for (const [before, after] of [['reserved', 'writing'], ['writing', 'acknowledged'], ['acknowledged', 'ready'], ['ready', 'published']])
    await contract.assertGuestImageResultCopyTransition(fixture[before], fixture[after]);
  descriptor.source.byteLength++; assert.equal(parsed.source.byteLength, 12345);
});

test('known settled, conditional-null and never-dispatched cleanup paths are distinct valid descriptions', async () => {
  const fixture = await guestImageResultCopyContractFixture();
  for (const [before, after] of [['ready', 'cleanupPending'], ['cleanupPending', 'deleted'], ['writing', 'nullSettled'], ['nullSettled', 'nullCleaned'],
    ['nullCleaned', 'nullDeleted'], ['reserved', 'abandoned'], ['abandoned', 'neverWrittenDeleted'], ['writing', 'unknown']])
    await contract.assertGuestImageResultCopyTransition(fixture[before], fixture[after]);
  assert.equal(fixture.nullDeleted.put_outcome, 'conditional-null');
  assert.equal(fixture.neverWrittenDeleted.put_started_at_ms, null);
});

test('late settlement records knowledge after expiry without reviving cleanup or publication', async () => {
  const { unknown, descriptor } = await guestImageResultCopyContractFixture();
  const late = descriptor.leaseSnapshot.expires_at_ms + 1;
  const pending = { ...unknown, state: 'cleanup_pending', row_version: 3, updated_at_ms: late };
  const settled = { ...pending, row_version: 4, put_outcome: 'success', updated_at_ms: late + 1, put_settled_at_ms: late + 1 };
  const deleted = { ...settled, state: 'deleted', row_version: 5, updated_at_ms: late + 2 };
  await contract.assertGuestImageResultCopyTransition(unknown, pending);
  await contract.assertGuestImageResultCopyTransition(pending, settled);
  await contract.assertGuestImageResultCopyTransition(settled, deleted);
  await assert.rejects(contract.assertGuestImageResultCopyTransition(settled, { ...settled, state: 'ready', row_version: 5, verified_at_ms: late + 2, updated_at_ms: late + 2 }));
});

test('original and revision keys use injective UTF-8 ownership and reserve malformed family paths', async () => {
  const { descriptor } = await guestImageResultCopyContractFixture();
  const input = { destinationUserId: descriptor.destinationUserId, custodyId: descriptor.custodyId, outputId: descriptor.destinationMetadata.outputId };
  for (const revisionId of [undefined, uuid(80)]) {
    const key = contract.guestImageResultMediaKey({ ...input, ...(revisionId ? { revisionId } : {}) });
    assert.deepEqual(contract.readGuestImageResultMediaKey(key), { ...input, revisionId: revisionId ?? null });
    assert.equal(contract.isGuestImageResultMediaFamily(key), true);
  }
  const left = contract.guestImageResultMediaKey({ ...input, destinationUserId: 'team:a' });
  const right = contract.guestImageResultMediaKey({ ...input, destinationUserId: 'team/a' });
  assert.notEqual(left, right);
  // Existing legacy matching is a concrete collision: every future ordinary
  // reader must refuse this reserved family before considering that fallback.
  assert.equal(mediaKeyMatchesOwnerNamespace(descriptor.destinationKey, contract.GUEST_IMAGE_RESULT_MEDIA_FAMILY), true);
  for (const key of [contract.GUEST_IMAGE_RESULT_MEDIA_FAMILY, `${contract.GUEST_IMAGE_RESULT_MEDIA_FAMILY}/bad`, `${descriptor.destinationKey}/../foreign`]) {
    assert.equal(contract.isGuestImageResultMediaFamily(key), true); assert.throws(() => contract.readGuestImageResultMediaKey(key));
  }
  for (const key of [descriptor.destinationKey.replace('/u-', '/U-'), descriptor.destinationKey.replace(/u-[a-f0-9]+\//u, 'u-ff/'),
    descriptor.destinationKey.replace('.png', '.jpeg'), descriptor.destinationKey.replace('object-', 'generation-'), `${descriptor.destinationKey}?copy=1`])
    assert.throws(() => contract.readGuestImageResultMediaKey(key));
});

test('media-key UTF-8 roundtrip preserves ordinary owners', () => {
  for (const destinationUserId of ['ordinary-owner', 'synthetic:\u00e9']) {
    for (const revisionId of [undefined, uuid(80)]) {
      const input = { destinationUserId, custodyId: uuid(42), outputId: 'object-00000007', ...(revisionId ? { revisionId } : {}) };
      assert.deepEqual(contract.readGuestImageResultMediaKey(contract.guestImageResultMediaKey(input)), { ...input, revisionId: revisionId ?? null });
    }
  }
});

test('media-key UTF-8 roundtrip preserves leading BOM as owner data', () => {
  for (const destinationUserId of ['\ufeffordinary-owner', '\ufeff', '\ufeff\ufeffordinary-owner']) {
    for (const revisionId of [undefined, uuid(80)]) {
      const input = { destinationUserId, custodyId: uuid(42), outputId: 'object-00000007', ...(revisionId ? { revisionId } : {}) };
      const key = contract.guestImageResultMediaKey(input);
      assert.match(key, /\/u-efbbbf/u);
      assert.deepEqual(contract.readGuestImageResultMediaKey(key), { ...input, revisionId: revisionId ?? null });
    }
  }
});

test('media-key UTF-8 roundtrip rejects invalid owner byte sequences', () => {
  const key = contract.guestImageResultMediaKey({ destinationUserId: 'ordinary-owner', custodyId: uuid(42), outputId: 'object-00000007' });
  for (const encoded of ['ff', 'c0af', 'eda080', 'f4908080', 'efbbbf80']) {
    const malformed = key.replace(/\/u-[a-f0-9]+\//u, `/u-${encoded}/`);
    assert.throws(() => contract.readGuestImageResultMediaKey(malformed), /guest_image_result_copy_contract_invalid/u, encoded);
  }
});

test('native lease IDs and canonical history retain their exact accepted grammar and bounds', async () => {
  const { descriptor } = await guestImageResultCopyContractFixture(), lease = descriptor.leaseSnapshot;
  const history = Array.from({ length: 100 }, (_, index) => `request-${String(index).padStart(3, '0')}-`.padEnd(160, 'a'));
  const full = { ...lease, request_id: history.at(-1), request_ids_json: canonicalJson(history), acquisitions: 100 };
  assert.equal(full.request_ids_json.length, 16301);
  assert.deepEqual(contract.readGuestImageResultCopyLeaseSnapshot(full), full);
  for (const bad of ['request/foreign', 'request@foreign', 'r'.repeat(161), 'forma-guest-session-v1.secret']) {
    assert.throws(() => contract.readGuestImageResultCopyLeaseSnapshot({ ...lease, request_id: bad, request_ids_json: canonicalJson([bad]) }));
    assert.throws(() => contract.readGuestImageResultCopyLeaseSnapshot({ ...lease, session_id: bad }));
  }
  assert.throws(() => contract.readGuestImageResultCopyLeaseSnapshot({ ...full, acquisitions: 101, request_ids_json: canonicalJson([...history, 'new-request']), request_id: 'new-request' }));
});

test('maximum PNG byte and dimension descriptors stay within the accepted static envelope', async () => {
  const { descriptor } = await guestImageResultCopyContractFixture();
  descriptor.source.byteLength = 24_000_000; descriptor.manifest.object.width = 8192; descriptor.manifest.object.height = 8192;
  descriptor.manifestDigest = await digest(descriptor.manifest); descriptor.leaseSnapshot.manifest_digest = descriptor.manifestDigest;
  descriptor.destinationMetadata = contract.guestImageResultCopyMetadata(Object.fromEntries(['attemptId', 'custodyId', 'destinationUserId', 'manifestDigest', 'manifest', 'writerNonce'].map(key => [key, descriptor[key]])));
  assert.deepEqual(await contract.validateGuestImageResultCopyDescriptor(descriptor), descriptor);
});

const descriptorDefects = {
  'extra authority field': value => { value.canPut = true; },
  'missing source bytes': value => { delete value.source.byteLength; },
  'zero bytes': value => { value.source.byteLength = 0; },
  'over 24M bytes': value => { value.source.byteLength = 24_000_001; },
  'fractional bytes': value => { value.source.byteLength = 1.5; },
  'oversize PNG dimensions': value => { value.manifest.object.width = 8193; },
  'wrong MIME': value => { value.manifest.object.mimeType = 'image/jpeg'; },
  'wrong native storage identity': value => { value.manifest.object.storageKey = value.destinationKey; },
  'reused writer nonce': value => { value.writerNonce = value.attemptId; },
  'guest destination': value => { value.destinationUserId = value.manifest.guestSubject; },
  'foreign lease request': value => { value.leaseSnapshot.request_id = 'other-request'; },
  'foreign lease destination': value => { value.leaseSnapshot.destination_user_id = 'other-owner'; },
  'wrong lease acquisition': value => { value.leaseSnapshot.acquisitions = 2; },
  'repeated lease request': value => { value.leaseSnapshot.request_ids_json = canonicalJson([value.requestId, value.requestId]); value.leaseSnapshot.acquisitions = 2; },
  'unknown producer key': value => { value.source.producerMetadata.ownerId = value.manifest.guestSubject; },
  'nonrecorded producer request null': value => { value.source.producerMetadata.providerRequestId = null; },
  'unsupported producer cohort': value => { value.source.producerMetadata.provider = 'foreign'; },
  'ill-formed UTF-16': value => { value.destinationUserId = '\ud800'; },
  'generation UUID substituted for object ID': value => { value.destinationMetadata = { ...value.destinationMetadata, outputId: value.manifest.generationId }; },
  'object ID substituted for generation UUID': value => { value.destinationMetadata = { ...value.destinationMetadata, generationId: value.destinationMetadata.outputId }; },
  'metadata foreign owner': value => { value.destinationMetadata = { ...value.destinationMetadata, ownerId: 'foreign' }; },
  'metadata foreign hash': value => { value.destinationMetadata = { ...value.destinationMetadata, sha256: 'c'.repeat(64) }; },
  'metadata extra field': value => { value.destinationMetadata = { ...value.destinationMetadata, authority: 'claimed' }; },
  'caller-chosen key': value => { value.destinationKey += '.png'; },
};
for (const [name, mutate] of Object.entries(descriptorDefects)) test(`copy descriptor rejects ${name}`, async () => {
  const { descriptor } = await guestImageResultCopyContractFixture(); mutate(descriptor);
  assert.throws(() => contract.readGuestImageResultCopyDescriptor(descriptor));
});

test('manifest hash verification captures values and rejects syntactically valid tampering', async () => {
  const { descriptor } = await guestImageResultCopyContractFixture();
  const pending = contract.validateGuestImageResultCopyDescriptor(descriptor); descriptor.manifest.financialReceipt.usedMicrousd++;
  assert.equal((await pending).manifest.financialReceipt.usedMicrousd, 4200);
  await assert.rejects(contract.validateGuestImageResultCopyDescriptor(descriptor));
});

test('accessors, hidden keys, aliases, inherited data, cycles and sparse arrays are refused without getter execution', async () => {
  const { descriptor } = await guestImageResultCopyContractFixture(); let reads = 0;
  const accessor = clone(descriptor); Object.defineProperty(accessor.source, 'byteLength', { enumerable: true, get() { reads++; return 1; } });
  const hidden = clone(descriptor); Object.defineProperty(hidden, 'authority', { value: true });
  const symbol = clone(descriptor); symbol[Symbol('authority')] = true;
  const alias = clone(descriptor); alias.manifest.privateContents[1] = alias.manifest.privateContents[0];
  const cycle = clone(descriptor); cycle.source.producerMetadata.self = cycle;
  const inherited = Object.assign(Object.create({ authority: true }), clone(descriptor));
  const sparse = clone(descriptor); delete sparse.manifest.sourceEventIds[1];
  for (const value of [accessor, hidden, symbol, alias, cycle, inherited, sparse]) assert.throws(() => contract.readGuestImageResultCopyDescriptor(value));
  assert.equal(reads, 0);
});

test('inherited array methods and null-prototype arrays cannot reach native manifest serialization', async () => {
  const { descriptor } = await guestImageResultCopyContractFixture(); let reads = 0;
  const custom = clone(descriptor), inherited = Object.create(Array.prototype);
  Object.defineProperty(inherited, 'map', { get() { reads++; return Array.prototype.map; } });
  Object.setPrototypeOf(custom.manifest.sourceEventIds, inherited);
  const nullPrototype = clone(descriptor); Object.setPrototypeOf(nullPrototype.manifest.sourceEventIds, null);
  for (const value of [custom, nullPrototype]) assert.throws(() => contract.readGuestImageResultCopyDescriptor(value));
  assert.equal(reads, 0);
});

test('journal row rejects every inconsistent duplicate, digest and JSON spelling', async () => {
  const { reserved } = await guestImageResultCopyContractFixture();
  const changes = { attempt_id: uuid(90), custody_id: uuid(90), session_id: 'foreign', destination_user_id: 'foreign', lease_id: uuid(90),
    lease_acquisition: 2, request_id: 'foreign', manifest_digest: hash, descriptor_digest: hash, source_expires_at_ms: reserved.source_expires_at_ms + 1,
    destination_key: reserved.destination_key + '.png', writer_nonce: uuid(90), content_sha256: 'c'.repeat(64), byte_length: reserved.byte_length + 1,
    mime_type: 'image/jpeg', width: 4096, height: 4096, lease_snapshot_json: reserved.lease_snapshot_json + ' ',
    destination_metadata_json: reserved.destination_metadata_json + ' ', descriptor_json: reserved.descriptor_json + ' ' };
  for (const [column, changed] of Object.entries(changes)) await assert.rejects(contract.readGuestImageResultCopyAttemptRow({ ...reserved, [column]: changed }), column);
  const duplicate = reserved.descriptor_json.replace('{', '{"version":1,');
  await assert.rejects(contract.readGuestImageResultCopyAttemptRow({ ...reserved, descriptor_json: duplicate }));
  await assert.rejects(contract.readGuestImageResultCopyAttemptRow({ ...reserved, selectedByteProof: true }));
});

test('fencing rejects unknown-to-ready, terminal revival, repeated dispatch and stale or modified full tuples', async () => {
  const f = await guestImageResultCopyContractFixture();
  const pairs = [
    [f.reserved, { ...f.writing, row_version: 0 }],
    [f.reserved, { ...f.writing, row_version: 2 }],
    [f.writing, { ...f.writing, row_version: 2, updated_at_ms: f.writing.updated_at_ms + 1 }],
    [f.unknown, { ...f.ready, row_version: 3 }],
    [f.unknown, { ...f.unknown, state: 'deleted', row_version: 3 }],
    [f.nullSettled, { ...f.ready, row_version: 3 }],
    [f.ready, { ...f.writing, row_version: 4, updated_at_ms: f.ready.updated_at_ms }],
    [f.cleanupPending, { ...f.published, row_version: 5 }],
    [f.deleted, { ...f.deleted, row_version: 6 }],
    [f.published, { ...f.published, row_version: 5 }],
    [f.writing, { ...f.acknowledged, put_started_at_ms: f.writing.put_started_at_ms + 1 }],
    [f.acknowledged, { ...f.ready, put_settled_at_ms: f.acknowledged.put_settled_at_ms + 1 }],
    [f.ready, { ...f.published, verified_at_ms: f.ready.verified_at_ms + 1 }],
    [f.reserved, { ...f.writing, created_at_ms: f.reserved.created_at_ms + 1 }],
  ];
  for (const [before, after] of pairs) await assert.rejects(contract.assertGuestImageResultCopyTransition(before, after));
});

test('fresh-read and publication timestamps cannot reach or renew either original expiry', async () => {
  const f = await guestImageResultCopyContractFixture(), expires = f.descriptor.leaseSnapshot.expires_at_ms;
  await assert.rejects(contract.readGuestImageResultCopyAttemptRow({ ...f.ready, verified_at_ms: expires, updated_at_ms: expires }));
  await assert.rejects(contract.readGuestImageResultCopyAttemptRow({ ...f.published, published_at_ms: expires, updated_at_ms: expires }));
  const expiredSource = clone(f.descriptor); expiredSource.manifest.expiresAt = new Date(expires - 100).toISOString();
  expiredSource.manifestDigest = await digest(expiredSource.manifest); expiredSource.leaseSnapshot.manifest_digest = expiredSource.manifestDigest;
  expiredSource.destinationMetadata = contract.guestImageResultCopyMetadata(Object.fromEntries(['attemptId', 'custodyId', 'destinationUserId', 'manifestDigest', 'manifest', 'writerNonce'].map(key => [key, expiredSource[key]])));
  const row = { ...f.published, manifest_digest: expiredSource.manifestDigest, descriptor_json: canonicalJson(expiredSource),
    descriptor_digest: await contract.guestImageResultCopyDescriptorDigest(expiredSource), lease_snapshot_json: canonicalJson(expiredSource.leaseSnapshot),
    destination_metadata_json: canonicalJson(expiredSource.destinationMetadata), source_expires_at_ms: expires - 100, published_at_ms: expires - 100, updated_at_ms: expires - 100 };
  await assert.rejects(contract.readGuestImageResultCopyAttemptRow(row));
});

test('both transition tuples are captured before asynchronous digest work', async () => {
  const { reserved, writing } = await guestImageResultCopyContractFixture();
  const pending = contract.assertGuestImageResultCopyTransition(reserved, writing);
  reserved.request_id = 'mutated'; writing.put_started_at_ms++; await pending;
});
