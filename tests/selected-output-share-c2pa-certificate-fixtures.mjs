// Synthetic, untrusted certificate fixtures only. No production certificate or
// asset bytes, implementation imports, network, filesystem reads, or saved keys.
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const utf8 = new TextEncoder();
export const joinDer = (...parts) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) { result.set(part, at); at += part.byteLength; }
  return result;
};

export function derTlv(tag, content = new Uint8Array()) {
  if (!Number.isInteger(tag) || tag < 0 || tag > 255) throw new Error('Fixture tag');
  let length = content.byteLength;
  const encoded = [];
  do { encoded.unshift(length & 255); length = Math.floor(length / 256); } while (length);
  const header = content.byteLength < 128
    ? Uint8Array.of(tag, content.byteLength)
    : Uint8Array.of(tag, 128 | encoded.length, ...encoded);
  return joinDer(header, content);
}
export const derSequence = (...parts) => derTlv(0x30, joinDer(...parts));
export const derSet = (...parts) => derTlv(0x31, joinDer(...parts));
export const derIntegerBytes = (content) => derTlv(0x02, content);
export function derPositiveInteger(value) {
  let n = BigInt(value);
  if (n < 0n) throw new Error('Fixture positive integer');
  const bytes = [];
  do { bytes.unshift(Number(n & 255n)); n >>= 8n; } while (n);
  if (bytes[0] & 128) bytes.unshift(0);
  return derIntegerBytes(Uint8Array.from(bytes));
}
export const derUtf8 = (value) => derTlv(0x0c, utf8.encode(value));
export const derUtcTime = (value) => derTlv(0x17, utf8.encode(value));
export const derOctetString = (value) => derTlv(0x04, value);
export const derBitString = (value, unusedBits = 0) => derTlv(0x03, joinDer(Uint8Array.of(unusedBits), value));
export function derOid(value) {
  const arcs = value.split('.').map(BigInt);
  if (arcs.length < 2 || arcs[0] < 0n || arcs[0] > 2n || arcs[1] < 0n || (arcs[0] < 2n && arcs[1] > 39n)) throw new Error('Fixture OID');
  const encoded = [];
  for (let n of [arcs[0] * 40n + arcs[1], ...arcs.slice(2)]) {
    if (n < 0n) throw new Error('Fixture OID arc');
    const bytes = [Number(n & 127n)];
    while ((n >>= 7n)) bytes.unshift(Number(n & 127n) | 128);
    encoded.push(...bytes);
  }
  return derTlv(0x06, Uint8Array.from(encoded));
}

export function derExtension(oid, value, critical = false) {
  // Passing null encodes explicit default FALSE for negative fixtures.
  return derSequence(derOid(oid), ...(critical === false ? [] : [derTlv(0x01, Uint8Array.of(critical === null ? 0 : 255))]), derOctetString(value));
}

export function derName(organization, commonName) {
  return derSequence(
    derSet(derSequence(derOid('2.5.4.10'), derUtf8(organization))),
    derSet(derSequence(derOid('2.5.4.3'), derUtf8(commonName))),
  );
}

const signatureAlgorithm = (oid = '1.2.840.10045.4.3.2', parameters) => derSequence(derOid(oid), ...(parameters ? [parameters] : []));
const publicKeyInfo = (point) => derSequence(
  derSequence(derOid('1.2.840.10045.2.1'), derOid('1.2.840.10045.3.1.7')),
  derBitString(point),
);

function scalarDer(scalar) {
  let at = 0;
  while (at < scalar.length - 1 && scalar[at] === 0) at++;
  const content = scalar.slice(at);
  return derIntegerBytes(content[0] & 128 ? joinDer(Uint8Array.of(0), content) : content);
}

export function rawEcdsaToDer(raw) {
  if (raw.byteLength !== 64) throw new Error('Fixture P-256 signature length');
  return derSequence(scalarDer(raw.subarray(0, 32)), scalarDer(raw.subarray(32)));
}

async function signatureDer(tbs, privateKey, desiredLength) {
  if (desiredLength !== null && ![70, 71, 72].includes(desiredLength)) throw new Error('Fixture DER signature length target');
  for (let attempt = 0; attempt < 2048; attempt++) {
    const raw = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, tbs));
    const encoded = rawEcdsaToDer(raw);
    if (desiredLength === null || encoded.byteLength === desiredLength) return encoded;
  }
  throw new Error('Fixture DER signature length sampling exhausted');
}

function defaultSerial(seed) {
  return Uint8Array.from({ length: 20 }, (_, i) => i ? (seed + i) & 255 : seed);
}

function extensionList(isLeaf, ski, aki, options) {
  const critical = (key, fallback) => Object.hasOwn(options, key) ? options[key] : fallback;
  const basicConstraints = options.basicConstraints ?? (isLeaf ? derSequence() : derSequence(derTlv(0x01, Uint8Array.of(255)), derPositiveInteger(0)));
  const keyUsage = options.keyUsage ?? derBitString(Uint8Array.of(isLeaf ? 0xc0 : 0x86), isLeaf ? 6 : 1);
  const result = [
    derExtension('2.5.29.19', basicConstraints, critical('basicConstraintsCritical', true)),
    derExtension('2.5.29.15', keyUsage, critical('keyUsageCritical', true)),
  ];
  if (isLeaf || options.includeEku) {
    result.push(derExtension('2.5.29.37', options.extendedKeyUsage ?? derSequence(derOid('1.3.6.1.5.5.7.3.4')), critical('ekuCritical', true)));
  }
  result.push(
    derExtension('2.5.29.14', derOctetString(options.ski ?? ski), critical('skiCritical', false)),
    derExtension('2.5.29.35', options.authorityKeyIdentifier ?? derSequence(derTlv(0x80, options.aki ?? aki)), critical('akiCritical', false)),
  );
  return [...result, ...(options.extraExtensions ?? [])];
}

async function certificate(isLeaf, key, issuerPrivateKey, issuerSki, names, options) {
  const point = new Uint8Array(await subtle.exportKey('raw', key.publicKey));
  const ski = new Uint8Array(await subtle.digest('SHA-1', point));
  const algorithm = options.signatureAlgorithm ?? signatureAlgorithm(options.signatureAlgorithmOid, options.signatureAlgorithmParameters);
  const extensions = options.extensions ?? extensionList(isLeaf, ski, issuerSki, options);
  const tbs = derSequence(
    options.version ?? derTlv(0xa0, derPositiveInteger(2)),
    options.serialDer ?? derIntegerBytes(options.serial ?? defaultSerial(isLeaf ? 0x10 : 0x20)),
    algorithm,
    options.issuerName ?? derName(options.issuerOrg ?? names.organization, options.issuerCn ?? names.rootCommonName),
    options.validity ?? derSequence(derUtcTime(options.notBefore ?? '260101000000Z'), derUtcTime(options.notAfter ?? '350101000000Z')),
    options.subjectName ?? derName(options.subjectOrg ?? names.organization, options.subjectCn ?? (isLeaf ? 'fal.ai' : names.rootCommonName)),
    options.spki ?? publicKeyInfo(options.point ?? point),
    ...(options.extraTbsFields ?? []),
    options.extensionsField ?? derTlv(0xa3, derSequence(...extensions)),
  );
  const desired = Object.hasOwn(options, 'signatureDerLength') ? options.signatureDerLength : (isLeaf ? 70 : 71);
  let signature = options.signatureDer ?? await signatureDer(tbs, issuerPrivateKey, desired);
  if (options.corruptSignature) { signature = signature.slice(); signature[signature.length - 1] ^= 1; }
  const result = derSequence(tbs, options.outerSignatureAlgorithm ?? algorithm, options.signatureValue ?? derBitString(signature));
  return options.tail ? joinDer(result, options.tail) : result;
}

/**
 * Creates an entirely synthetic, untrusted two-certificate chain.
 *
 * The organization default is the exact public ASCII name established from
 * https://fal.ai/legal/privacy-policy. Synthetic keys do not authenticate it.
 * `rootCommonName` defaults to organization plus the generic role suffix.
 * `leaf` and `issuer` support semantic overrides
 * before signing; raw DER overrides support malformed or alternate structures.
 * No options or outputs grant certificate trust or sharing permission.
 *
 * The private key remains solely in this test process so callers can create
 * synthetic COSE signatures. It is never a production secret.
 */
export async function createC2paCertificateFixture(options = {}) {
  const organization = options.organization ?? 'fal - Features & Labels Inc.';
  if (typeof organization !== 'string' || !organization) throw new Error('Fixture organization constant');
  const names = { organization, rootCommonName: options.rootCommonName ?? `${organization} Root CA` };
  const [leafKey, issuerKey] = await Promise.all([
    subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']),
    subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']),
  ]);
  const issuerPoint = new Uint8Array(await subtle.exportKey('raw', issuerKey.publicKey));
  const issuerSki = new Uint8Array(await subtle.digest('SHA-1', issuerPoint));
  const [leaf, issuer] = await Promise.all([
    certificate(true, leafKey, issuerKey.privateKey, issuerSki, names, options.leaf ?? {}),
    certificate(false, issuerKey, issuerKey.privateKey, issuerSki, names, options.issuer ?? {}),
  ]);
  return { certificates: [leaf, issuer], leafPrivateKey: leafKey.privateKey };
}
