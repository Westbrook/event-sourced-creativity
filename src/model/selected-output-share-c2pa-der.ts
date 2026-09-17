/** Closed historical certificate grammar for a disabled provenance review.
 * Structural inspection and local signatures establish neither trust nor sharing authority. */
export type C2paCertificateField = Readonly<{
  id: string; offset: number; byteLength: number;
  encoding: "framing" | "integer" | "boolean" | "text" | "bytes";
  encodedSha256: string; ruleId: string;
}>;
export type C2paCertificateReport = Readonly<{
  byteLength: number; sha256: string;
  displayFields: readonly Readonly<{ id: string; label: string; value: string }>[];
  fields: readonly C2paCertificateField[];
}>;
export type C2paCertificateChainInspection = Readonly<{
  kind: "c2pa-certificate-chain-inspection";
  certificateTrust: "not-evaluated";
  localChainSignatures: "consistent";
  leafVerifyKey: CryptoKey;
  certificates: readonly [C2paCertificateReport, C2paCertificateReport];
}>;

// Exact public legal spelling at https://fal.ai/legal/privacy-policy, independently
// compared without normalization. The root suffix is a role, not a trust claim.
const PROVIDER_ORGANIZATION = "fal - Features & Labels Inc.";
const PROVIDER_ROOT_NAME = `${PROVIDER_ORGANIZATION} Root CA`;
const SIG_OID = "2a8648ce3d040302";
const EC_OID = "2a8648ce3d0201";
const P256_OID = "2a8648ce3d030107";
const ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;
// Preserve a leading BOM as content so exact names and ASCII times cannot be
// normalized into an accepted value by TextDecoder's default BOM handling.
const decode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function requireValue(condition: unknown): asserts condition { if (!condition) throw new Error("unsupported_certificate"); }
function hex(bytes: Uint8Array): string { return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join(""); }
async function digest(bytes: Uint8Array<ArrayBuffer>, algorithm = "SHA-256"): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest(algorithm, bytes)));
}
function same(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, i) => value === right[i]); }
function capture(value: unknown): Uint8Array<ArrayBuffer> {
  requireValue(value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Uint8Array.prototype);
  const size = typedLength.call(value) as number;
  bufferLength.call(typedBuffer.call(value));
  requireValue(size >= 480 && size <= 600);
  const bytes = new Uint8Array(size); setBytes.call(bytes, value as Uint8Array); return bytes;
}

type Node = {
  tag: number; start: number; content: number; end: number; path: string;
  children: Node[]; prefix: number; checked: boolean; rule: string;
  encoding: C2paCertificateField["encoding"];
};
class Der {
  readonly nodes: Node[] = [];
  readonly bytes: Uint8Array<ArrayBuffer>;
  constructor(bytes: Uint8Array<ArrayBuffer>) { this.bytes = bytes; }
  read(start: number, limit: number, path: string, depth = 0): Node {
    requireValue(depth <= 16 && this.nodes.length < 128 && start + 2 <= limit);
    const tag = this.bytes[start]!;
    requireValue([0x30, 0x31, 0xa0, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x06, 0x0c, 0x17, 0x80].includes(tag));
    let cursor = start + 2, size = this.bytes[start + 1]!;
    if (size & 0x80) {
      const count = size & 0x7f;
      requireValue(count >= 1 && count <= 2 && cursor + count <= limit && this.bytes[cursor] !== 0);
      size = 0; for (let i = 0; i < count; i++) size = size * 256 + this.bytes[cursor++]!;
      requireValue(size >= 128 && (count === 1 || size > 255));
    }
    const end = cursor + size; requireValue(end <= limit);
    const node: Node = { tag, start, content: cursor, end, path, children: [], prefix: 0, checked: false, rule: "", encoding: "bytes" };
    this.nodes.push(node);
    if (tag & 0x20) {
      while (cursor < end) {
        const child = this.read(cursor, end, `${path}/${node.children.length}`, depth + 1);
        node.children.push(child); cursor = child.end;
      }
      requireValue(cursor === end);
    }
    return node;
  }
  check(node: Node, tag: number, count: number | undefined, rule: string): Node {
    requireValue(node.tag === tag && (count === undefined || node.children.length === count));
    node.checked = true; node.rule = rule;
    node.encoding = tag === 2 ? "integer" : tag === 1 ? "boolean" : [0x0c, 0x17].includes(tag) ? "text" : "bytes";
    return node;
  }
  value(node: Node): Uint8Array<ArrayBuffer> { return this.bytes.subarray(node.content, node.end); }
  raw(node: Node): Uint8Array<ArrayBuffer> { return this.bytes.subarray(node.start, node.end); }
  sequence(node: Node, count: number, rule: string): Node[] { return this.check(node, 0x30, count, rule).children; }
  constant(node: Node, tag: number, value: string, rule: string): void {
    this.check(node, tag, 0, rule); requireValue(hex(this.value(node)) === value);
  }
  oid(node: Node, value: string, rule: string): void { this.constant(node, 6, value, rule); }
  nested(node: Node, skip: number): Node {
    requireValue(node.children.length === 0 && skip >= 0 && node.content + skip < node.end);
    const child = this.read(node.content + skip, node.end, `${node.path}/embedded`);
    requireValue(child.end === node.end); node.children = [child]; node.prefix = skip; return child;
  }
  positive(node: Node, max: number, role: string, zero = false): Uint8Array<ArrayBuffer> {
    this.check(node, 2, 0, role); const value = this.value(node);
    requireValue(value.length >= 1 && value.length <= max && !(value[0]! & 0x80));
    requireValue(value.length === 1 || value[0] !== 0 || (value[1]! & 0x80) !== 0);
    requireValue(zero || value.some(v => v !== 0)); return value;
  }
  async fields(root: Node): Promise<readonly C2paCertificateField[]> {
    requireValue(this.nodes.every(node => node.checked));
    const ranges: { node: Node; start: number; end: number; header: boolean }[] = [];
    const visit = (node: Node) => {
      ranges.push({ node, start: node.start, end: node.content, header: true });
      if (node.children.length) {
        if (node.prefix) ranges.push({ node, start: node.content, end: node.content + node.prefix, header: false });
        node.children.forEach(visit);
      } else if (node.end > node.content) ranges.push({ node, start: node.content, end: node.end, header: false });
    };
    visit(root); let cursor = 0;
    for (const range of ranges) { requireValue(range.start === cursor); cursor = range.end; }
    requireValue(cursor === this.bytes.length);
    return Object.freeze(await Promise.all(ranges.map(async range => Object.freeze({
      id: `${range.node.path}/${range.header ? "header" : range.node.prefix ? "prefix" : "value"}`,
      offset: range.start, byteLength: range.end - range.start,
      encoding: range.header ? "framing" as const : range.node.encoding,
      encodedSha256: await digest(this.bytes.subarray(range.start, range.end)),
      ruleId: `c2pa-der-v1/${range.node.rule}/${range.header ? "header" : "content"}`,
    }))));
  }
}

type Parsed = {
  parser: Der; root: Node; tbs: Node; spki: Node; subject: Node; issuer: Node;
  signature: Uint8Array<ArrayBuffer>; point: Uint8Array<ArrayBuffer>;
  ski: Uint8Array<ArrayBuffer>; aki: Uint8Array<ArrayBuffer>;
  display: Readonly<{ id: string; label: string; value: string }>[];
};
function parseCertificate(bytes: Uint8Array<ArrayBuffer>, isRoot: boolean): Parsed {
  const parser = new Der(bytes), root = parser.read(0, bytes.length, "certificate"); requireValue(root.end === bytes.length);
  const [tbs, outerAlgorithm, signatureNode] = parser.sequence(root, 3, "certificate");
  const [version, serial, innerAlgorithm, issuer, validity, subject, spki, extensionWrapper] = parser.sequence(tbs!, 8, "tbs");
  const display: Parsed["display"] = [];
  const show = (id: string, label: string, value: string) => display.push(Object.freeze({ id, label, value }));
  parser.check(version!, 0xa0, 1, "version-wrapper"); parser.constant(version!.children[0]!, 2, "02", "version-v3");
  show("version", "Version", "3");
  const serialBytes = parser.positive(serial!, 20, "serial-positive-minimal"); show("serial", "Serial number", hex(serialBytes));
  for (const node of [innerAlgorithm!, outerAlgorithm!]) {
    const [oid] = parser.sequence(node, 1, "ecdsa-sha256-algorithm"); parser.oid(oid!, SIG_OID, "ecdsa-sha256-oid");
  }
  show("signatureAlgorithm", "Certificate signature algorithm", "ECDSA with SHA-256; parameters absent");
  const name = (node: Node, role: string, commonName: string) => {
    const rdns = parser.sequence(node, 2, `${role}-name`);
    for (let i = 0; i < 2; i++) {
      const rdn = parser.check(rdns[i]!, 0x31, 1, `${role}-rdn`);
      const [oid, text] = parser.sequence(rdn.children[0]!, 2, `${role}-attribute`);
      parser.oid(oid!, i === 0 ? "55040a" : "550403", i === 0 ? "organization-oid" : "common-name-oid");
      parser.check(text!, 0x0c, 0, `${role}-${i === 0 ? "organization" : "common-name"}`);
      const value = decode.decode(parser.value(text!)), expected = i === 0 ? PROVIDER_ORGANIZATION : commonName;
      requireValue(expected.length > 0 && value === expected);
      show(`${role}.${i === 0 ? "organization" : "commonName"}`, `${role === "issuer" ? "Issuer" : "Subject"} ${i === 0 ? "organization" : "common name"}`, value);
    }
  };
  name(issuer!, "issuer", PROVIDER_ROOT_NAME); name(subject!, "subject", isRoot ? PROVIDER_ROOT_NAME : "fal.ai");
  const times = parser.sequence(validity!, 2, "validity").map((node, i) => {
    parser.check(node, 0x17, 0, "utc-time"); const value = decode.decode(parser.value(node));
    requireValue(/^[0-9]{12}Z$/u.test(value));
    const parts = [0, 2, 4, 6, 8, 10].map(start => Number(value.slice(start, start + 2)));
    const year = parts[0]! + (parts[0]! >= 50 ? 1900 : 2000);
    const date = new Date(Date.UTC(year, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!, parts[5]!));
    requireValue(date.getUTCFullYear() === year && date.getUTCMonth() + 1 === parts[1] && date.getUTCDate() === parts[2]
      && date.getUTCHours() === parts[3] && date.getUTCMinutes() === parts[4] && date.getUTCSeconds() === parts[5]);
    show(i === 0 ? "notBefore" : "notAfter", i === 0 ? "Not before" : "Not after", `${value} (${date.toISOString()})`);
    return date.getTime();
  }); requireValue(times[0]! < times[1]!);
  const [keyAlgorithm, keyBits] = parser.sequence(spki!, 2, "spki");
  const [keyOid, curveOid] = parser.sequence(keyAlgorithm!, 2, "ec-p256-algorithm");
  parser.oid(keyOid!, EC_OID, "ec-public-key-oid"); parser.oid(curveOid!, P256_OID, "p256-oid");
  parser.check(keyBits!, 3, 0, "p256-point"); const pointBits = parser.value(keyBits!);
  requireValue(pointBits.length === 66 && pointBits[0] === 0 && pointBits[1] === 4);
  const point = pointBits.subarray(1);
  show("publicKeyAlgorithm", "Public key algorithm", "P-256 uncompressed EC point; 65 bytes; no unused bits");
  parser.check(extensionWrapper!, 0xa3, 1, "extensions-wrapper");
  const extensions = parser.sequence(extensionWrapper!.children[0]!, isRoot ? 4 : 5, "extensions");
  const expected = isRoot ? ["551d13", "551d0f", "551d0e", "551d23"] : ["551d13", "551d0f", "551d25", "551d0e", "551d23"];
  let ski: Uint8Array<ArrayBuffer> | undefined, aki: Uint8Array<ArrayBuffer> | undefined;
  extensions.forEach((extension, i) => {
    const critical = i < (isRoot ? 2 : 3), oidHex = expected[i]!;
    const parts = parser.sequence(extension, critical ? 3 : 2, "extension");
    parser.oid(parts[0]!, oidHex, `extension-${oidHex}-oid`);
    if (critical) parser.constant(parts[1]!, 1, "ff", "critical-true");
    const content = parser.check(parts[critical ? 2 : 1]!, 4, 0, `extension-${oidHex}-value`);
    const value = parser.nested(content, 0);
    if (oidHex === "551d13") {
      const children = parser.sequence(value, isRoot ? 2 : 0, "basic-constraints");
      if (isRoot) { parser.constant(children[0]!, 1, "ff", "ca-true"); parser.constant(children[1]!, 2, "00", "path-length-zero"); }
      show("basicConstraints", "Basic constraints (2.5.29.19; critical)", isRoot ? "CA=true; pathLenConstraint=0" : "CA=false; no pathLenConstraint");
    } else if (oidHex === "551d0f") {
      parser.constant(value, 3, isRoot ? "0186" : "06c0", "key-usage");
      show("keyUsage", "Key usage (2.5.29.15; critical)", isRoot ? "digitalSignature, keyCertSign, cRLSign" : "digitalSignature, nonRepudiation");
    } else if (oidHex === "551d25") {
      const [purpose] = parser.sequence(value, 1, "extended-key-usage"); parser.oid(purpose!, "2b06010505070304", "email-protection-oid");
      show("extendedKeyUsage", "Extended key usage (2.5.29.37; critical)", "1.3.6.1.5.5.7.3.4 (emailProtection)");
    } else if (oidHex === "551d0e") {
      parser.check(value, 4, 0, "subject-key-identifier"); ski = parser.value(value); requireValue(ski.length === 20);
      show("subjectKeyIdentifier", "Subject key identifier (2.5.29.14; noncritical)", hex(ski));
    } else {
      const [identifier] = parser.sequence(value, 1, "authority-key-identifier"); parser.check(identifier!, 0x80, 0, "authority-key-identifier-value");
      aki = parser.value(identifier!); requireValue(aki.length === 20);
      show("authorityKeyIdentifier", "Authority key identifier (2.5.29.35; noncritical)", hex(aki));
    }
  }); requireValue(ski && aki);
  parser.check(signatureNode!, 3, 0, "signature-bit-string"); requireValue(parser.value(signatureNode!)[0] === 0);
  const [rNode, sNode] = parser.sequence(parser.nested(signatureNode!, 1), 2, "ecdsa-signature");
  const signature = new Uint8Array(64);
  [rNode!, sNode!].forEach((node, i) => {
    const scalar = parser.positive(node, 33, "ecdsa-scalar"), number = BigInt(`0x${hex(scalar)}`);
    requireValue(number > 0n && number < ORDER);
    const magnitude = scalar[0] === 0 ? scalar.subarray(1) : scalar;
    requireValue(magnitude.length <= 32); signature.set(magnitude, i * 32 + 32 - magnitude.length);
  });
  requireValue(parser.nodes.every(node => node.checked));
  return { parser, root, tbs: tbs!, spki: spki!, subject: subject!, issuer: issuer!, signature, point, ski, aki, display };
}

/** Returns only an authenticated-context disclosure ingredient. Its key verifies
 * local consistency; this helper confers no certificate trust or share authority. */
export async function inspectC2paCertificateChain(certs: readonly Uint8Array<ArrayBuffer>[]): Promise<C2paCertificateChainInspection | null> {
  try {
    requireValue(Array.isArray(certs) && Object.getPrototypeOf(certs) === Array.prototype);
    const descriptors = Object.getOwnPropertyDescriptors(certs as object);
    requireValue(Reflect.ownKeys(descriptors).length === 3 && descriptors.length?.value === 2
      && Object.hasOwn(descriptors["0"] ?? {}, "value") && Object.hasOwn(descriptors["1"] ?? {}, "value"));
    // Capture both inputs before any await; never use caller iterators or getters.
    const owned = [capture(descriptors["0"]!.value), capture(descriptors["1"]!.value)] as const;
    const parsed = [parseCertificate(owned[0], false), parseCertificate(owned[1], true)] as const;
    requireValue(same(parsed[0].parser.raw(parsed[0].issuer), parsed[1].parser.raw(parsed[1].subject))
      && same(parsed[1].parser.raw(parsed[1].issuer), parsed[1].parser.raw(parsed[1].subject))
      && same(parsed[0].aki, parsed[1].ski) && same(parsed[1].aki, parsed[1].ski));
    const keyIdentifiers = await Promise.all(parsed.map(cert => digest(cert.point, "SHA-1")));
    requireValue(parsed.every((cert, i) => hex(cert.ski) === keyIdentifiers[i]));
    const keys = await Promise.all(parsed.map(cert => crypto.subtle.importKey("spki", cert.parser.raw(cert.spki), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])));
    const verified = await Promise.all(parsed.map(cert => crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys[1]!, cert.signature, cert.parser.raw(cert.tbs))));
    requireValue(verified.every(Boolean));
    const reports = await Promise.all(parsed.map(async cert => {
      const display = [...cert.display,
        Object.freeze({ id: "publicKeyDigest", label: "Public key SHA-256", value: await digest(cert.point) }),
        Object.freeze({ id: "signatureDigest", label: "Signature SHA-256 (64-byte P1363)", value: await digest(cert.signature) }),
      ];
      return Object.freeze({ byteLength: cert.parser.bytes.length, sha256: await digest(cert.parser.bytes), displayFields: Object.freeze(display), fields: await cert.parser.fields(cert.root) });
    }));
    return Object.freeze({ kind: "c2pa-certificate-chain-inspection", certificateTrust: "not-evaluated", localChainSignatures: "consistent",
      leafVerifyKey: keys[0]!, certificates: Object.freeze([reports[0]!, reports[1]!]) as readonly [C2paCertificateReport, C2paCertificateReport] });
  } catch { return null; }
}
