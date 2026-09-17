import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { inspectC2paCertificateChain } from '../src/model/selected-output-share-c2pa-der.ts';
import {
  createC2paCertificateFixture, derBitString, derExtension, derIntegerBytes,
  derName, derOctetString, derOid, derPositiveInteger, derSequence,
  derSet, derTlv, derUtf8, derUtcTime, joinDer,
} from './selected-output-share-c2pa-certificate-fixtures.mjs';

const ORG = 'fal - Features & Labels Inc.';
const fixture = await createC2paCertificateFixture();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('synthetic historical chain yields frozen complete disclosure and verify-only nonextractable leaf key', async () => {
  const result = await inspectC2paCertificateChain(fixture.certificates);
  assert.ok(result); assert.equal(result.kind, 'c2pa-certificate-chain-inspection');
  assert.equal(result.certificateTrust, 'not-evaluated'); assert.equal(result.localChainSignatures, 'consistent');
  assert.equal(result.leafVerifyKey.type, 'public'); assert.equal(result.leafVerifyKey.extractable, false);
  assert.deepEqual(result.leafVerifyKey.usages, ['verify']);
  assert.equal(result.leafVerifyKey.algorithm.name, 'ECDSA'); assert.equal(result.leafVerifyKey.algorithm.namedCurve, 'P-256');
  await assert.rejects(crypto.subtle.exportKey('spki', result.leafVerifyKey));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.certificates));
  assert.deepEqual(result.certificates.map(c => c.byteLength), [523, 536]);
  for (let i = 0; i < 2; i++) {
    const cert = result.certificates[i], bytes = fixture.certificates[i];
    assert.equal(cert.sha256, hash(bytes)); assert.ok(Object.isFrozen(cert));
    assert.ok(Object.isFrozen(cert.displayFields) && Object.isFrozen(cert.fields));
    assert.equal(new Set(cert.displayFields.map(f => f.id)).size, cert.displayFields.length);
    assert.equal(new Set(cert.fields.map(f => f.id)).size, cert.fields.length);
    let next = 0;
    for (const field of cert.fields) {
      assert.ok(Object.isFrozen(field)); assert.equal(field.offset, next); assert.ok(field.byteLength > 0);
      assert.equal(field.encodedSha256, hash(bytes.subarray(field.offset, field.offset + field.byteLength)));
      assert.match(field.ruleId, /^c2pa-der-v1\//); next += field.byteLength;
    }
    assert.equal(next, bytes.length);
    assert.ok(cert.displayFields.every(Object.isFrozen));
    assert.equal(cert.displayFields.find(f => f.id === 'subject.organization').value, ORG);
    assert.ok(cert.displayFields.some(f => f.id === 'serial'));
    assert.ok(cert.displayFields.some(f => f.id === 'notBefore'));
    assert.ok(cert.displayFields.some(f => f.id === 'notAfter'));
    assert.ok(cert.displayFields.some(f => f.id === 'subjectKeyIdentifier'));
    assert.ok(cert.displayFields.some(f => f.id === 'authorityKeyIdentifier'));
  }
  const message = new TextEncoder().encode('synthetic local signature test');
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, fixture.leafPrivateKey, message);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, result.leafVerifyKey, signature, message), true);
});

test('fresh keys and serials are checked structurally without certificate fingerprint allowlisting', async () => {
  const other = await createC2paCertificateFixture({ leaf: { serial: Uint8Array.from({ length: 20 }, () => 0x33) } });
  const result = await inspectC2paCertificateChain(other.certificates);
  assert.ok(result); assert.notEqual(result.certificates[0].sha256, hash(fixture.certificates[0]));
});

test('helper accepts bounded canonical ECDSA sign padding variations independently of parent fixed-size profile', async () => {
  const other = await createC2paCertificateFixture({ leaf: { signatureDerLength: 72 }, issuer: { signatureDerLength: 70 } });
  assert.deepEqual(other.certificates.map(c => c.length), [525, 535]);
  assert.ok(await inspectC2paCertificateChain(other.certificates));
});

test('valid leap date is accepted as historical recorded validity, without current-time trust', async () => {
  const other = await createC2paCertificateFixture({ leaf: { notBefore: '240229000000Z', notAfter: '250301000000Z' } });
  assert.ok(await inspectC2paCertificateChain(other.certificates));
});

const signedRefusals = [
  ['unknown organization', { leaf: { subjectOrg: 'fal - private organization!!' } }],
  ['organization casing differs', { leaf: { subjectOrg: ORG.toUpperCase() } }],
  ['organization hidden suffix', { leaf: { subjectOrg: ORG + '\0' } }],
  ['organization leading BOM', { leaf: { subjectOrg: '\ufeff' + ORG } }],
  ['common-name leading BOM', { leaf: { subjectCn: '\ufefffal.ai' } }],
  ['issuer organization leading BOM', { leaf: { issuerOrg: '\ufeff' + ORG } }],
  ['issuer common-name leading BOM', { leaf: { issuerCn: '\ufeff' + ORG + ' Root CA' } }],
  ['root organization leading BOM', { issuer: { subjectOrg: '\ufeff' + ORG } }],
  ['root common-name leading BOM', { issuer: { subjectCn: '\ufeff' + ORG + ' Root CA' } }],
  ['unknown common name', { leaf: { subjectCn: 'other!' } }],
  ['unknown issuer name', { leaf: { issuerCn: ORG + ' OtherCA' } }],
  ['unknown root name', { issuer: { subjectCn: ORG + ' OtherCA' } }],
  ['extra name attribute', { leaf: { subjectName: derSequence(derSet(derSequence(derOid('2.5.4.10'), derUtf8(ORG))), derSet(derSequence(derOid('2.5.4.3'), derUtf8('fal.ai'))), derSet(derSequence(derOid('2.5.4.7'), derUtf8('Private')))) } }],
  ['name attributes reversed', { leaf: { subjectName: derSequence(derSet(derSequence(derOid('2.5.4.3'), derUtf8('fal.ai'))), derSet(derSequence(derOid('2.5.4.10'), derUtf8(ORG)))) } }],
  ['multi-value RDN', { leaf: { subjectName: derSequence(derSet(derSequence(derOid('2.5.4.10'), derUtf8(ORG)), derSequence(derOid('2.5.4.3'), derUtf8('fal.ai')))) } }],
  ['name PrintableString wire form', { leaf: { subjectName: derSequence(derSet(derSequence(derOid('2.5.4.10'), derTlv(0x13, new TextEncoder().encode(ORG)))), derSet(derSequence(derOid('2.5.4.3'), derUtf8('fal.ai')))) } }],
  ['v1 certificate', { leaf: { version: derTlv(0xa0, derPositiveInteger(0)) } }],
  ['zero serial', { leaf: { serial: Uint8Array.of(0) } }],
  ['negative serial', { leaf: { serial: Uint8Array.of(0x80) } }],
  ['nonminimal serial', { leaf: { serial: Uint8Array.of(0, 1) } }],
  ['serial over 20 bytes', { leaf: { serial: Uint8Array.from({ length: 21 }, () => 1) } }],
  ['wrong signature algorithm', { leaf: { signatureAlgorithmOid: '1.2.840.10045.4.3.3' } }],
  ['algorithm NULL parameter', { leaf: { signatureAlgorithmParameters: derTlv(5) } }],
  ['outer algorithm disagreement', { leaf: { outerSignatureAlgorithm: derSequence(derOid('1.2.840.10045.4.3.3')) } }],
  ['invalid calendar date', { leaf: { notBefore: '260230000000Z' } }],
  ['notBefore leading BOM', { leaf: { notBefore: '\ufeff260101000000Z' } }],
  ['notAfter leading BOM', { leaf: { notAfter: '\ufeff350101000000Z' } }],
  ['root notBefore leading BOM', { issuer: { notBefore: '\ufeff260101000000Z' } }],
  ['root notAfter leading BOM', { issuer: { notAfter: '\ufeff350101000000Z' } }],
  ['invalid clock second', { leaf: { notBefore: '260101000060Z' } }],
  ['missing UTC seconds', { leaf: { notBefore: '2601010000Z' } }],
  ['wrong time tag', { leaf: { validity: derSequence(derTlv(0x18, new TextEncoder().encode('20260101000000Z')), derUtcTime('350101000000Z')) } }],
  ['reversed validity', { leaf: { notBefore: '350101000000Z', notAfter: '260101000000Z' } }],
  ['leaf CA true', { leaf: { basicConstraints: derSequence(derTlv(1, Uint8Array.of(255))) } }],
  ['explicit default leaf CA false', { leaf: { basicConstraints: derSequence(derTlv(1, Uint8Array.of(0))) } }],
  ['root pathLen one', { issuer: { basicConstraints: derSequence(derTlv(1, Uint8Array.of(255)), derPositiveInteger(1)) } }],
  ['basic constraints not critical', { leaf: { basicConstraintsCritical: false } }],
  ['wrong leaf key usage', { leaf: { keyUsage: derBitString(Uint8Array.of(0x80), 7) } }],
  ['wrong root key usage', { issuer: { keyUsage: derBitString(Uint8Array.of(0x06), 1) } }],
  ['key usage padding nonzero', { leaf: { keyUsage: derBitString(Uint8Array.of(0xc1), 6) } }],
  ['key usage nonminimal tail', { leaf: { keyUsage: derBitString(Uint8Array.of(0xc0, 0), 0) } }],
  ['key usage not critical', { leaf: { keyUsageCritical: false } }],
  ['unknown EKU', { leaf: { extendedKeyUsage: derSequence(derOid('1.3.6.1.5.5.7.3.3')) } }],
  ['additional EKU', { leaf: { extendedKeyUsage: derSequence(derOid('1.3.6.1.5.5.7.3.4'), derOid('1.3.6.1.5.5.7.3.3')) } }],
  ['EKU not critical', { leaf: { ekuCritical: false } }],
  ['root unexpected EKU', { issuer: { includeEku: true } }],
  ['SKI critical', { leaf: { skiCritical: true } }],
  ['explicit default SKI critical false', { leaf: { skiCritical: null } }],
  ['SKI too short', { leaf: { ski: new Uint8Array(19) } }],
  ['SKI does not derive from public point', { leaf: { ski: new Uint8Array(20) } }],
  ['AKI mismatch', { leaf: { aki: new Uint8Array(20) } }],
  ['root AKI mismatch', { issuer: { aki: new Uint8Array(20) } }],
  ['AKI extra issuer field', { leaf: { authorityKeyIdentifier: derSequence(derTlv(0x80, new Uint8Array(20)), derTlv(0x82, Uint8Array.of(1))) } }],
  ['extra extension', { leaf: { extraExtensions: [derExtension('2.5.29.17', derSequence())] } }],
  ['duplicate extension', { leaf: { extraExtensions: [derExtension('2.5.29.19', derSequence(), true)] } }],
  ['extra unique-ID TBS field', { leaf: { extraTbsFields: [derTlv(0x81, Uint8Array.of(0, 1))] } }],
  ['extension nested trailing bytes', { leaf: { basicConstraints: joinDer(derSequence(), Uint8Array.of(0)) } }],
  ['compressed public point', { leaf: { point: joinDer(Uint8Array.of(2), new Uint8Array(32)) } }],
  ['off-curve public point', { leaf: { point: joinDer(Uint8Array.of(4), new Uint8Array(64)) } }],
  ['leaf signature incorrect', { leaf: { corruptSignature: true } }],
  ['root signature incorrect', { issuer: { corruptSignature: true } }],
  ['signature zero scalar', { leaf: { signatureDer: derSequence(derPositiveInteger(0), derPositiveInteger(1)) } }],
  ['signature scalar order overflow', { leaf: { signatureDer: derSequence(derPositiveInteger(0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n), derPositiveInteger(1)) } }],
  ['signature negative scalar', { leaf: { signatureDer: derSequence(derIntegerBytes(Uint8Array.of(0x80)), derPositiveInteger(1)) } }],
  ['signature nonminimal scalar', { leaf: { signatureDer: derSequence(derIntegerBytes(Uint8Array.of(0, 1)), derPositiveInteger(1)) } }],
  ['signature nested trailing bytes', { leaf: { signatureDer: joinDer(derSequence(derPositiveInteger(1), derPositiveInteger(1)), Uint8Array.of(0)) } }],
  ['signature nonzero unused bits', { leaf: { signatureValue: derBitString(derSequence(derPositiveInteger(1), derPositiveInteger(1)), 1) } }],
  ['certificate trailing bytes', { leaf: { tail: Uint8Array.of(0) } }],
];
for (const [name, options] of signedRefusals) test(`refuses freshly signed ${name}`, async () => {
  const candidate = await createC2paCertificateFixture(options);
  assert.equal(await inspectC2paCertificateChain(candidate.certificates), null);
});

test('wrong name with correctly signed certificates remains refused', async () => {
  const alternate = await createC2paCertificateFixture({ organization: 'another publicly named entity' });
  assert.equal(await inspectC2paCertificateChain(alternate.certificates), null);
});

test('refuses swapped or unrelated signed chains', async () => {
  assert.equal(await inspectC2paCertificateChain([...fixture.certificates].reverse()), null);
  const other = await createC2paCertificateFixture();
  assert.equal(await inspectC2paCertificateChain([fixture.certificates[0], other.certificates[1]]), null);
});

test('refuses malformed outer DER headers and every truncated original', async () => {
  for (const kind of ['indefinite', 'high-tag', 'overlong', 'boundary']) {
    const bytes = fixture.certificates[0].slice();
    if (kind === 'indefinite') bytes[1] = 0x80;
    if (kind === 'high-tag') bytes[0] = 0x3f;
    if (kind === 'overlong') bytes[2] = 0;
    if (kind === 'boundary') bytes[3] ^= 1;
    assert.equal(await inspectC2paCertificateChain([bytes, fixture.certificates[1]]), null, kind);
  }
  for (let size = 0; size < fixture.certificates[0].length; size++) {
    assert.equal(await inspectC2paCertificateChain([fixture.certificates[0].slice(0, size), fixture.certificates[1]]), null, `size=${size}`);
  }
});

test('owns subarray snapshots before await and ignores typed-array accessors', async () => {
  let reads = 0;
  const bytes = fixture.certificates.map(cert => {
    const padded = new Uint8Array(cert.length + 8); padded.set(cert, 4); return padded.subarray(4, 4 + cert.length);
  });
  Object.defineProperty(bytes[0], 'byteLength', { get() { reads++; throw new Error('caller getter'); } });
  Object.defineProperty(bytes[0], Symbol.iterator, { get() { reads++; throw new Error('caller iterator'); } });
  const pending = inspectC2paCertificateChain(bytes); bytes.forEach(b => b.fill(0));
  assert.ok(await pending); assert.equal(reads, 0);
});

test('refuses hostile array shapes without invoking entry getters', async () => {
  let reads = 0;
  const getter = [null, fixture.certificates[1]];
  Object.defineProperty(getter, '0', { get() { reads++; return fixture.certificates[0]; } });
  const extra = [...fixture.certificates]; extra.extra = true;
  for (const bad of [null, {}, [], [fixture.certificates[0]], [...fixture.certificates, fixture.certificates[0]], getter, extra]) {
    assert.equal(await inspectC2paCertificateChain(bad), null);
  }
  assert.equal(reads, 0);
});

test('refuses shared memory, subclasses, impostors, proxy views and oversized buffers', async () => {
  class Sub extends Uint8Array {}
  const shared = new Uint8Array(new SharedArrayBuffer(523)); shared.set(fixture.certificates[0]);
  const detached = fixture.certificates[0].slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  for (const bad of [shared, new Sub(fixture.certificates[0]), Buffer.from(fixture.certificates[0]), {}, new Proxy(fixture.certificates[0], {}), new Uint8Array(601), detached]) {
    assert.equal(await inspectC2paCertificateChain([bad, fixture.certificates[1]]), null);
  }
});

test('fixture independent DER helpers can build alternate names but helper rejects them', async () => {
  const bad = await createC2paCertificateFixture({ leaf: { subjectName: derName(ORG, 'other!'), extensionsField: derTlv(0xa3, derSequence(derOctetString(new Uint8Array()))) } });
  assert.equal(await inspectC2paCertificateChain(bad.certificates), null);
});
