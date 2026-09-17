import { inspectOutputAsset, MAX_OUTPUT_ASSET_BYTES } from "./output-asset-inspection.ts";
import { inspectC2paCertificateChain } from "./selected-output-share-c2pa-der.ts";

/** Inspection only. This module cannot qualify/copy/publish a selected image. */
export const PNG_PROVENANCE_REVIEW_PROFILE = "png-c2pa-fal-creation-disclosure-draft-v1" as const;
export const PNG_PROVENANCE_REVIEW_PARSER = "png-c2pa-fal-creation-inspection-v1" as const;
export const PNG_PROVENANCE_REVIEW_LIMITS = Object.freeze({ bytes: MAX_OUTPUT_ASSET_BYTES, chunks: 4096, metadata: 13012, boxes: 64, boxDepth: 8, cborNodes: 1024, cborDepth: 16 });
type Bytes = Uint8Array<ArrayBuffer>;
type Group = "creation" | "generator" | "manifest-id" | "instance-id" | "provider-request-id" | "assertions-and-bindings" | "signing-certificates" | "signature-and-salts" | "format-and-padding";
type Encoding = "integer" | "boolean" | "null" | "text" | "bytes" | "framing" | "zero-padding";
export type PngProvenanceRetainedField = Readonly<{ id: string; encoding: Encoding; offset: number; byteLength: number; encodedSha256: string; ruleId: string; displayEntryId: Group }>;
export type PngProvenanceDisclosureEntry = Readonly<{ id: Group; label: string; exactValue: string; meaning: "defined-field" | "opaque-provider-identifier" | "cryptographic-material"; sourceFieldIds: readonly string[] }>;
export type PngProvenanceReviewCandidate = Readonly<{
  status: "review_candidate"; kind: "png-provenance-review-candidate"; version: 1; profile: typeof PNG_PROVENANCE_REVIEW_PROFILE; activation: "disabled";
  source: Readonly<{ selectionWitnessDigest: string; pngSha256: string; byteLength: number; width: number; height: number;
    caBX: Readonly<{ offset: 33; dataByteLength: 13012; chunkByteLength: 13024; chunkSha256: string }> }>;
  inspection: Readonly<{ parserVersion: typeof PNG_PROVENANCE_REVIEW_PARSER; profileDigest: string; coverageDigest: string; localBindings: "consistent";
    certificateTrust: "not-evaluated"; identifierSemantics: "unestablished"; conformance: "bounded-historical-profile-only" }>;
  disclosure: Readonly<{ copyVersion: "png-provenance-disclosure-v1"; primaryCopy: string; displayEntries: readonly PngProvenanceDisclosureEntry[];
    retainedFields: readonly PngProvenanceRetainedField[]; disclosureDigest: string }>;
  publishingScopeDigest: string;
}>;
export type PngProvenanceReviewRefusal = "invalid_input" | "unsupported_profile" | "invalid_png" | "selection_mismatch" | "inconsistent_bindings";
export type PngProvenanceReviewInspection = PngProvenanceReviewCandidate | Readonly<{ status: "refused"; activation: "disabled"; reason: PngProvenanceReviewRefusal }>;

const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, "byteLength")!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const setBytes = Uint8Array.prototype.set;
const groups: readonly Group[] = ["creation", "generator", "manifest-id", "instance-id", "provider-request-id", "assertions-and-bindings", "signing-certificates", "signature-and-salts", "format-and-padding"];
const labels: Readonly<Record<Group, string>> = Object.freeze({ creation: "Recorded creation", generator: "Generator", "manifest-id": "Manifest identifier", "instance-id": "Instance identifier", "provider-request-id": "Opaque provider request identifier", "assertions-and-bindings": "Assertions and byte bindings", "signing-certificates": "Signing certificates", "signature-and-salts": "Signature and salts", "format-and-padding": "Format and padding" });
const primaryCopy = "Original PNG includes generation provenance.\nProvider request identifier: meaning and linkability unverified.\nPublishing includes this identifier and the provenance data listed below.\nAnyone who can access the file can extract them.";
const uuidTail = "00110010800000aa00389b71";
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const manifestPattern = new RegExp(`^urn:c2pa:${uuidPattern}$`, "u"), instancePattern = new RegExp(`^xmp:iid:${uuidPattern}$`, "u");
const assertionLabels = ["c2pa.actions.v2", "ai.fal.info", "c2pa.hash.data"] as const;
const sourceType = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const profileRules = Object.freeze([PNG_PROVENANCE_REVIEW_PROFILE, PNG_PROVENANCE_REVIEW_PARSER,
  "PNG:RGB8/RGBA8;noninterlaced;IHDR,caBX@33:13012,IDAT,IEND;exact-boundary;4096chunks;24MB",
  "JUMBF:one-store,one-manifest,three-assertions,claim-v2,signature;fixed-order;full-coverage;8depth;64boxes",
  "CBOR:observed-definite-minimal-wire-subset;closed-ordered-keys;tags0,18;depth16;nodes1024",
  "IDs:lowercase-UUIDv4-RFC4122;timestamp:UTC-six-fractional-digits;version:decimal-1.2.1-digits",
  "request_id:91ASCII;[a-z][0-9]-[A-Za-z0-9_-]{86}==;opaque-semantics-unestablished",
  "hashes:SHA256;assertion-JUMBF-body;whole-caBX-exclusion;created-hash.data,gathered-actions/info",
  "COSE:Sign1-tag18;ES256-P256;protected[1,33];x5chain[523,536];pad10395zero;payload-null;signature64",
  "JUMBF-UUID-prefixes:63327061,63326d61,63326173,63626f72,6332636c,63326373;tail:00110010800000aa00389b71;flags3/assertions19;c2sh16",
  "CBOR-maps:actions,allActionsIncluded|action,when,softwareAgent,digitalSourceType|name|request_id|exclusions,name,alg,hash,pad|start,length|instanceID,claim_generator_info,signature,created_assertions,gathered_assertions,alg|name,org.contentauth.c2pa_rs|url,hash|1,33|pad",
  "constants:fal.ai;c2pa.created;allActionsIncluded=true;jumbf manifest;sha256;hash32;data-pad8zero",
  sourceType, "refs:self#jumbf=c2pa.assertions/<exact-label>;self#jumbf=/c2pa/<exact-manifest>/c2pa.signature",
  "DER:closed-fal-chain-v1;v3;serial-positive-minimal<=20;minimal-definite-lengths;depth16;nodes128;no-extra-fields",
  "DER-names:O=fal - Features & Labels Inc.;root-CN=fal - Features & Labels Inc. Root CA;leaf-CN=fal.ai;UTF8-exact-no-BOM-normalization",
  "DER:signatureOID1.2.840.10045.4.3.2(no-parameters);publicKeyOID1.2.840.10045.2.1;curveOID1.2.840.10045.3.1.7;uncompressed-point65;SKI=SHA1(point);AKI=issuer-SKI",
  "DER-extensions-ordered:leaf[2.5.29.19critical-empty,2.5.29.15critical-06c0,2.5.29.37critical-emailProtection,2.5.29.14noncritical20,2.5.29.35noncritical-[0]20];root[2.5.29.19critical-CAtrue-pathLen0,2.5.29.15critical-0186,2.5.29.14noncritical20,2.5.29.35noncritical-[0]20]",
  "DER:UTC12digitsZ-calendar-valid-start<end;ECDSA-r/s-positive-minimal-1..32magnitude-in-P256-order;local-leaf-and-root-signatures;all-byte-coverage;no-trust/current-time-claim",
  "No-activation,no-copy-authority,no-privacy-claim,no-full-C2PA-conformance-claim"]);

class Refusal extends Error { readonly reason: PngProvenanceReviewRefusal; constructor(reason: PngProvenanceReviewRefusal) { super(reason); this.reason = reason; } }
function requireValue(condition: unknown, reason: PngProvenanceReviewRefusal = "unsupported_profile"): asserts condition { if (!condition) throw new Refusal(reason); }
function hex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
async function hash(bytes: Bytes): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))); }
function utf8(value: string): Bytes { return encoder.encode(value); }
function concat(...values: readonly Bytes[]): Bytes { const out = new Uint8Array(values.reduce((n, value) => n + value.length, 0)); let at = 0; for (const value of values) { out.set(value, at); at += value.length; } return out; }
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((value, at) => b[at] === value); }
function freeze<T>(value: T): Readonly<T> { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function closedData(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object", "invalid_input");
  const prototype = Object.getPrototypeOf(value); requireValue(prototype === Object.prototype || prototype === null, "invalid_input");
  const own = Reflect.ownKeys(value); requireValue(own.length === keys.length && own.every(key => typeof key === "string" && keys.includes(key)), "invalid_input");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) { const field = Object.getOwnPropertyDescriptor(value, key); requireValue(field && Object.hasOwn(field, "value") && field.enumerable, "invalid_input"); result[key] = field.value; }
  return result;
}
function digestValue(value: unknown): string { requireValue(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), "invalid_input"); return value; }
function capture(value: unknown): Bytes {
  requireValue(value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Uint8Array.prototype, "invalid_input");
  const length = typedLength.call(value) as number; bufferLength.call(typedBuffer.call(value));
  requireValue(length > 0 && length <= PNG_PROVENANCE_REVIEW_LIMITS.bytes, "invalid_input");
  const bytes = new Uint8Array(length); setBytes.call(bytes, value as Uint8Array); return bytes;
}

type Box = { start: number; end: number; type: string; children: Box[]; label?: string; labelStart?: number; labelEnd?: number; uuid?: string; toggles?: number };
type Cbor = { start: number; headEnd: number; end: number; kind: "integer" | "boolean" | "null" | "text" | "bytes" | "array" | "map" | "tag"; value: number | boolean | string | null; children: Cbor[] };
type PendingField = Omit<PngProvenanceRetainedField, "encodedSha256">;
class MetadataReader {
  readonly fields: PendingField[] = [];
  readonly nested = new Map<Cbor, Cbor>();
  readonly derFields = new Map<Cbor, readonly PendingField[]>();
  readonly nodeGroups = new Map<Cbor, Group>();
  private boxes = 0;
  private nodes = 0;
  readonly bytes: Bytes;
  constructor(bytes: Bytes) { this.bytes = bytes; }
  field(id: string, start: number, length: number, encoding: Encoding, group: Group, ruleId = id): void {
    requireValue(Number.isSafeInteger(start) && Number.isSafeInteger(length) && length > 0 && start >= 0 && start + length <= this.bytes.length);
    this.fields.push({ id, offset: start, byteLength: length, encoding, displayEntryId: group, ruleId });
  }
  boxList(start: number, end: number, depth = 0): Box[] {
    requireValue(depth <= PNG_PROVENANCE_REVIEW_LIMITS.boxDepth); const result: Box[] = [];
    for (let at = start; at < end;) {
      requireValue(++this.boxes <= PNG_PROVENANCE_REVIEW_LIMITS.boxes && at + 8 <= end);
      const size = new DataView(this.bytes.buffer, this.bytes.byteOffset).getUint32(at), type = decoder.decode(this.bytes.subarray(at + 4, at + 8));
      requireValue(size >= 8 && at + size <= end && ["jumb", "jumd", "cbor", "c2sh"].includes(type));
      const box: Box = { start: at, end: at + size, type, children: [] };
      if (type === "jumb") box.children = this.boxList(at + 8, box.end, depth + 1);
      if (type === "jumd") {
        requireValue(size >= 26); box.uuid = hex(this.bytes.subarray(at + 8, at + 24)); box.toggles = this.bytes[at + 24];
        const terminator = this.bytes.indexOf(0, at + 25); requireValue(terminator >= at + 25 && terminator < box.end);
        box.labelStart = at + 25; box.labelEnd = terminator; box.label = decoder.decode(this.bytes.subarray(box.labelStart, terminator));
        requireValue(/^[\x21-\x7e]+$/u.test(box.label));
        if (terminator + 1 < box.end) box.children = this.boxList(terminator + 1, box.end, depth + 1);
      }
      result.push(box); at += size;
    }
    return result;
  }
  cbor(start: number, end: number): Cbor {
    let at = start;
    const read = (depth: number): Cbor => {
      requireValue(++this.nodes <= PNG_PROVENANCE_REVIEW_LIMITS.cborNodes && depth <= PNG_PROVENANCE_REVIEW_LIMITS.cborDepth && at < end);
      const begin = at, head = this.bytes[at++]!, major = head >> 5, ai = head & 31;
      let argument = ai;
      if (ai >= 24) {
        requireValue(ai <= 26); const size = 1 << (ai - 24); requireValue(at + size <= end);
        argument = 0; for (let i = 0; i < size; i++) argument = argument * 256 + this.bytes[at++]!;
        requireValue(argument >= (ai === 24 ? 24 : ai === 25 ? 256 : 65536));
      }
      const node: Cbor = { start: begin, headEnd: at, end: at, kind: "null", value: null, children: [] };
      if (major <= 1) { node.kind = "integer"; node.value = major === 0 ? argument : -1 - argument; }
      else if (major === 2 || major === 3) {
        requireValue(at + argument <= end); node.kind = major === 2 ? "bytes" : "text";
        if (major === 3) node.value = decoder.decode(this.bytes.subarray(at, at + argument)); at += argument;
      } else if (major === 4 || major === 5) {
        requireValue(argument <= (major === 4 ? 128 : 64)); node.kind = major === 4 ? "array" : "map";
        for (let i = 0; i < argument * (major === 5 ? 2 : 1); i++) node.children.push(read(depth + 1));
        if (major === 5) { const keys = new Set<string>(); for (let i = 0; i < node.children.length; i += 2) { const key = node.children[i]!; requireValue(key.kind === "text" || key.kind === "integer"); const identity = `${key.kind}:${key.value}`; requireValue(!keys.has(identity)); keys.add(identity); } }
      } else if (major === 6) { requireValue(argument === 0 || argument === 18); node.kind = "tag"; node.value = argument; node.children.push(read(depth + 1)); }
      else { requireValue(major === 7 && ai >= 20 && ai <= 22); node.kind = ai === 22 ? "null" : "boolean"; node.value = ai === 22 ? null : ai === 21; }
      node.end = at; return node;
    };
    const result = read(0); requireValue(at === end); return result;
  }
  recordBox(box: Box, id: string, group: Group): void {
    this.field(`${id}/length`, box.start, 4, "framing", "format-and-padding", "jumbf.length.v1");
    this.field(`${id}/type`, box.start + 4, 4, "framing", "format-and-padding", `jumbf.${box.type}.v1`);
    if (box.type === "jumd") {
      this.field(`${id}/uuid`, box.start + 8, 16, "bytes", "format-and-padding", `jumbf.uuid.${box.uuid}`);
      this.field(`${id}/flags`, box.start + 24, 1, "integer", "format-and-padding", `jumbf.flags.${box.toggles}`);
      this.field(`${id}/label`, box.labelStart!, box.labelEnd! - box.labelStart!, "text", group, `jumbf.label.${group}`);
      this.field(`${id}/terminator`, box.labelEnd!, 1, "zero-padding", "format-and-padding", "jumbf.label.terminator");
    } else if (box.type === "c2sh") this.field(`${id}/salt`, box.start + 8, 16, "bytes", "signature-and-salts", "c2sh.salt16");
  }
  recordCbor(node: Cbor, id: string, group: Group): void {
    group = this.nodeGroups.get(node) ?? group;
    if (["integer", "boolean", "null"].includes(node.kind)) { this.field(id, node.start, node.end - node.start, node.kind as Encoding, group); return; }
    this.field(`${id}/head`, node.start, node.headEnd - node.start, "framing", "format-and-padding", `cbor.${node.kind}.minimal-head`);
    if (node.kind === "text") { if (node.end > node.headEnd) this.field(id, node.headEnd, node.end - node.headEnd, "text", group); }
    else if (node.kind === "bytes") {
      const nested = this.nested.get(node), der = this.derFields.get(node);
      if (nested) this.recordCbor(nested, `${id}/protected`, "signing-certificates");
      else if (der) for (const field of der) this.fields.push(field);
      else if (node.end > node.headEnd) this.field(id, node.headEnd, node.end - node.headEnd, id.endsWith("/pad") ? "zero-padding" : "bytes", group);
    } else if (node.kind === "map") {
      for (let i = 0; i < node.children.length; i += 2) { const key = node.children[i]!, child = node.children[i + 1]!, keyId = String(key.value); this.recordCbor(key, `${id}/key/${keyId}`, "format-and-padding"); this.recordCbor(child, `${id}/${keyId}`, group); }
    } else for (let i = 0; i < node.children.length; i++) this.recordCbor(node.children[i]!, `${id}/${node.kind === "tag" ? "tagged" : i}`, group);
  }
}

function map(node: Cbor, keys: readonly (string | number)[]): Map<string | number, Cbor> {
  requireValue(node.kind === "map" && node.children.length === keys.length * 2); const result = new Map<string | number, Cbor>();
  for (let i = 0; i < keys.length; i++) { const key = node.children[i * 2]!; requireValue(key.value === keys[i] && key.kind === (typeof keys[i] === "number" ? "integer" : "text")); result.set(keys[i]!, node.children[i * 2 + 1]!); }
  return result;
}
function text(node: Cbor): string { requireValue(node.kind === "text" && typeof node.value === "string"); return node.value; }
function exact(node: Cbor, kind: Cbor["kind"], value: Cbor["value"]): void { requireValue(node.kind === kind && node.value === value); }
function array(node: Cbor, length: number): Cbor[] { requireValue(node.kind === "array" && node.children.length === length); return node.children; }
function raw(reader: MetadataReader, node: Cbor, length?: number): Bytes { requireValue(node.kind === "bytes" && (length === undefined || node.end - node.headEnd === length)); return reader.bytes.subarray(node.headEnd, node.end); }
function date(value: string): void {
  requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/u.test(value));
  const milliseconds = `${value.slice(0, 23)}Z`, parsed = new Date(milliseconds); requireValue(Number.isFinite(parsed.valueOf()) && parsed.toISOString() === milliseconds);
}
function bytesHeader(length: number): Bytes { requireValue(length <= 65535); return length < 24 ? Uint8Array.of(0x40 + length) : length < 256 ? Uint8Array.of(0x58, length) : Uint8Array.of(0x59, length >> 8, length & 255); }
function signStructure(protectedBytes: Bytes, claimBytes: Bytes): Bytes { return concat(Uint8Array.of(0x84, 0x6a), utf8("Signature1"), bytesHeader(protectedBytes.length), protectedBytes, Uint8Array.of(0x40), bytesHeader(claimBytes.length), claimBytes); }

function metadataChunk(bytes: Bytes): Bytes {
  requireValue(bytes.length >= 57 && equal(bytes.subarray(0, 8), Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)));
  const view = new DataView(bytes.buffer); let at = 8, count = 0, hasMetadata = false, data = false, ended = false;
  while (at + 12 <= bytes.length) {
    requireValue(++count <= PNG_PROVENANCE_REVIEW_LIMITS.chunks);
    const length = view.getUint32(at), end = at + length + 12; requireValue(end <= bytes.length);
    const type = decoder.decode(bytes.subarray(at + 4, at + 8));
    if (count === 1) { requireValue(type === "IHDR" && length === 13 && bytes[at + 16] === 8 && [2, 6].includes(bytes[at + 17]!) && bytes[at + 20] === 0); }
    else if (type === "caBX") { requireValue(count === 2 && at === 33 && !hasMetadata && !data && length === PNG_PROVENANCE_REVIEW_LIMITS.metadata); hasMetadata = true; }
    else if (type === "IDAT") { requireValue(hasMetadata); data = true; }
    else if (type === "IEND") { requireValue(data && length === 0 && end === bytes.length); ended = true; break; }
    else requireValue(false);
    at = end;
  }
  requireValue(ended && hasMetadata); return bytes.subarray(41, 13053);
}

function superbox(reader: MetadataReader, box: Box, label: string | RegExp, uuidPrefix: string, count: number, id: string, group: Group, salt = false): Box[] {
  requireValue(box.type === "jumb" && box.children.length === count + 1); const descriptor = box.children[0]!;
  requireValue(descriptor.type === "jumd" && descriptor.uuid === uuidPrefix + uuidTail && descriptor.toggles === (salt ? 19 : 3)
    && (typeof label === "string" ? descriptor.label === label : label.test(descriptor.label!)) && descriptor.children.length === (salt ? 1 : 0));
  reader.recordBox(box, id, group); reader.recordBox(descriptor, `${id}/description`, group);
  if (salt) { const child = descriptor.children[0]!; requireValue(child.type === "c2sh" && child.end - child.start === 24); reader.recordBox(child, `${id}/description/salt-box`, "signature-and-salts"); }
  return box.children.slice(1);
}
function cborBox(reader: MetadataReader, box: Box, id: string): Cbor { requireValue(box.type === "cbor" && box.children.length === 0); reader.recordBox(box, id, "format-and-padding"); return reader.cbor(box.start + 8, box.end); }
function integer(node: Cbor, value: number): void { exact(node, "integer", value); }
function zero(reader: MetadataReader, node: Cbor, length: number): void { requireValue(raw(reader, node, length).every(value => value === 0)); reader.nodeGroups.set(node, "format-and-padding"); }
function fieldTuple(field: PngProvenanceRetainedField): readonly (string | number)[] { return [field.id, field.encoding, field.offset, field.byteLength, field.encodedSha256, field.ruleId, field.displayEntryId]; }

async function inspectMetadata(bytes: Bytes, expected: { sha256: string; byteLength: number; width: number; height: number }, selectionWitnessDigest: string, publishingScopeDigest: string): Promise<PngProvenanceReviewCandidate> {
  const metadata = metadataChunk(bytes), reader = new MetadataReader(metadata), root = reader.boxList(0, metadata.length);
  requireValue(root.length === 1);
  const [manifestBox] = superbox(reader, root[0]!, "c2pa", "63327061", 1, "store", "format-and-padding");
  const [assertionsBox, claimBox, signatureBox] = superbox(reader, manifestBox!, manifestPattern, "63326d61", 3, "manifest", "manifest-id");
  const manifestId = manifestBox!.children[0]!.label!;
  const assertions = superbox(reader, assertionsBox!, "c2pa.assertions", "63326173", 3, "assertions", "assertions-and-bindings");
  const assertionNodes = assertions.map((box, index) => {
    const label = assertionLabels[index]!, [content] = superbox(reader, box, label, "63626f72", 1, `assertions/${label}`, "assertions-and-bindings", true);
    return cborBox(reader, content!, `assertions/${label}/cbor`);
  });
  const actions = map(assertionNodes[0]!, ["actions", "allActionsIncluded"]); exact(actions.get("allActionsIncluded")!, "boolean", true);
  const action = map(array(actions.get("actions")!, 1)[0]!, ["action", "when", "softwareAgent", "digitalSourceType"]);
  exact(action.get("action")!, "text", "c2pa.created"); exact(action.get("digitalSourceType")!, "text", sourceType);
  exact(map(action.get("softwareAgent")!, ["name"]).get("name")!, "text", "fal.ai");
  const when = action.get("when")!; requireValue(when.kind === "tag" && when.value === 0 && when.children.length === 1);
  const recordedAt = text(when.children[0]!); date(recordedAt);
  const info = map(assertionNodes[1]!, ["request_id"]), requestNode = info.get("request_id")!, requestId = text(requestNode);
  requireValue(/^[a-z][0-9]-[A-Za-z0-9_-]{86}==$/u.test(requestId)); reader.nodeGroups.set(requestNode, "provider-request-id");
  const binding = map(assertionNodes[2]!, ["exclusions", "name", "alg", "hash", "pad"]);
  const exclusion = map(array(binding.get("exclusions")!, 1)[0]!, ["start", "length"]);
  integer(exclusion.get("start")!, 33); integer(exclusion.get("length")!, 13024);
  exact(binding.get("name")!, "text", "jumbf manifest"); exact(binding.get("alg")!, "text", "sha256"); zero(reader, binding.get("pad")!, 8);
  const originalHash = raw(reader, binding.get("hash")!, 32);
  requireValue(await hash(concat(bytes.subarray(0, 33), bytes.subarray(13057))) === hex(originalHash), "inconsistent_bindings");

  const [claimContent] = superbox(reader, claimBox!, "c2pa.claim.v2", "6332636c", 1, "claim", "assertions-and-bindings");
  const claimNode = cborBox(reader, claimContent!, "claim/cbor"), claim = map(claimNode, ["instanceID", "claim_generator_info", "signature", "created_assertions", "gathered_assertions", "alg"]);
  const instanceNode = claim.get("instanceID")!, instanceId = text(instanceNode); requireValue(instancePattern.test(instanceId)); reader.nodeGroups.set(instanceNode, "instance-id");
  const generatorNode = claim.get("claim_generator_info")!, generator = map(generatorNode, ["name", "org.contentauth.c2pa_rs"]);
  exact(generator.get("name")!, "text", "fal.ai"); const generatorVersion = text(generator.get("org.contentauth.c2pa_rs")!);
  requireValue(/^[0-9]\.[0-9]{2}\.[0-9]$/u.test(generatorVersion)); reader.nodeGroups.set(generatorNode, "generator");
  const signatureReference = `self#jumbf=/c2pa/${manifestId}/c2pa.signature`; exact(claim.get("signature")!, "text", signatureReference); exact(claim.get("alg")!, "text", "sha256");
  const references = [...array(claim.get("created_assertions")!, 1), ...array(claim.get("gathered_assertions")!, 2)];
  const boundLabels = ["c2pa.hash.data", "c2pa.actions.v2", "ai.fal.info"];
  const assertionDigests: { label: string; reference: string; sha256: string }[] = [];
  for (let index = 0; index < references.length; index++) {
    const ref = map(references[index]!, ["url", "hash"]), label = boundLabels[index]!, reference = `self#jumbf=c2pa.assertions/${label}`;
    exact(ref.get("url")!, "text", reference);
    const assertion = assertions[assertionLabels.indexOf(label as typeof assertionLabels[number])]!, digest = await hash(metadata.subarray(assertion.start + 8, assertion.end));
    requireValue(digest === hex(raw(reader, ref.get("hash")!, 32)), "inconsistent_bindings"); assertionDigests.push({ label, reference, sha256: digest });
  }

  const [signatureContent] = superbox(reader, signatureBox!, "c2pa.signature", "63326373", 1, "signature", "signature-and-salts");
  const signatureNode = cborBox(reader, signatureContent!, "signature/cbor"); requireValue(signatureNode.kind === "tag" && signatureNode.value === 18);
  const [protectedNode, unprotectedNode, payloadNode, signatureValue] = array(signatureNode.children[0]!, 4);
  const protectedBytes = raw(reader, protectedNode!, 1071), protectedMapNode = reader.cbor(protectedNode!.headEnd, protectedNode!.end), protectedMap = map(protectedMapNode, [1, 33]);
  reader.nested.set(protectedNode!, protectedMapNode); integer(protectedMap.get(1)!, -7); reader.nodeGroups.set(protectedMap.get(1)!, "signature-and-salts");
  const certificateNodes = array(protectedMap.get(33)!, 2), certificates = certificateNodes.map((node, index) => raw(reader, node, [523, 536][index]));
  const chain = await inspectC2paCertificateChain(certificates); requireValue(chain !== null);
  certificateNodes.forEach((node, index) => reader.derFields.set(node, chain.certificates[index]!.fields.map(field => ({ id: `certificates/${index}/${field.id}`, offset: node.headEnd + field.offset,
    byteLength: field.byteLength, encoding: field.encoding, ruleId: field.ruleId, displayEntryId: "signing-certificates" }))));
  zero(reader, map(unprotectedNode!, ["pad"]).get("pad")!, 10395); exact(payloadNode!, "null", null);
  const signature = raw(reader, signatureValue!, 64), claimBytes = metadata.subarray(claimContent!.start + 8, claimContent!.end);
  requireValue(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, chain.leafVerifyKey, signature, signStructure(protectedBytes, claimBytes)), "inconsistent_bindings");

  const inspection = await inspectOutputAsset(bytes, "image.png", { snapshot: false });
  requireValue(inspection.status === "inspected" && inspection.kind === "image" && inspection.mimeType === "image/png" && inspection.extension === "png", "invalid_png");
  requireValue(inspection.sha256 === expected.sha256 && inspection.byteLength === expected.byteLength && inspection.facts.width === expected.width && inspection.facts.height === expected.height, "selection_mismatch");
  assertionNodes.forEach((node, index) => reader.recordCbor(node, `assertions/${assertionLabels[index]}/value`, index === 0 ? "creation" : "assertions-and-bindings"));
  reader.recordCbor(claimNode, "claim/value", "assertions-and-bindings"); reader.recordCbor(signatureNode, "signature/value", "signature-and-salts");
  const fields = reader.fields.sort((a, b) => a.offset - b.offset || a.byteLength - b.byteLength || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set<string>(); let covered = 0;
  for (const field of fields) { requireValue(field.offset === covered && !ids.has(field.id)); covered += field.byteLength; ids.add(field.id); }
  requireValue(covered === metadata.length);
  const retainedFields: PngProvenanceRetainedField[] = await Promise.all(fields.map(async field => ({ ...field, encodedSha256: await hash(metadata.subarray(field.offset, field.offset + field.byteLength)) })));
  const tuples = retainedFields.map(fieldTuple), coverageDigest = await hash(utf8(JSON.stringify(["png-provenance-coverage-v1", tuples])));
  const values: Record<Group, string> = {
    creation: JSON.stringify({ recordedAt, action: "c2pa.created", softwareAgent: "fal.ai", digitalSourceType: sourceType, allActionsIncluded: true }),
    generator: JSON.stringify({ name: "fal.ai", c2paRsVersion: generatorVersion }), "manifest-id": manifestId, "instance-id": instanceId, "provider-request-id": requestId,
    "assertions-and-bindings": JSON.stringify({ assertions: assertionDigests, signatureReference, algorithm: "sha256", excludedRange: { start: 33, length: 13024 }, originalImageDigest: hex(originalHash) }),
    "signing-certificates": JSON.stringify(chain.certificates.map(certificate => ({ byteLength: certificate.byteLength, sha256: certificate.sha256, fields: certificate.displayFields }))),
    "signature-and-salts": JSON.stringify({ algorithm: "ES256/P-256", signatureBytes: 64, signatureSha256: await hash(signature), salts: retainedFields.filter(field => field.id.endsWith("/salt")).map(field => ({ id: field.id, byteLength: field.byteLength, sha256: field.encodedSha256 })), localConsistency: "consistent", certificateTrust: "not-evaluated" }),
    "format-and-padding": JSON.stringify({ metadataBytes: 13012, completeCoverage: true, signatureZeroPadding: 10395, bindingZeroPadding: 8, format: "bounded historical profile; full C2PA conformance not claimed" }),
  };
  const displayEntries: PngProvenanceDisclosureEntry[] = groups.map(id => ({ id, label: labels[id], exactValue: values[id], meaning: id === "provider-request-id" ? "opaque-provider-identifier" : id === "signature-and-salts" ? "cryptographic-material" : "defined-field", sourceFieldIds: retainedFields.filter(field => field.displayEntryId === id).map(field => field.id).sort() }));
  requireValue(displayEntries.every(entry => entry.sourceFieldIds.length > 0));
  const profileDigest = await hash(utf8(JSON.stringify(profileRules))), chunkSha256 = await hash(bytes.subarray(33, 13057));
  const disclosureDigest = await hash(utf8(JSON.stringify(["png-provenance-disclosure-v1", PNG_PROVENANCE_REVIEW_PROFILE, PNG_PROVENANCE_REVIEW_PARSER, profileDigest,
    [selectionWitnessDigest, expected.sha256, expected.byteLength, expected.width, expected.height, [33, 13012, 13024, chunkSha256]],
    [coverageDigest, "consistent", "not-evaluated", "unestablished"], publishingScopeDigest, primaryCopy,
    displayEntries.map(entry => [entry.id, entry.label, entry.exactValue, entry.meaning, entry.sourceFieldIds]), tuples])));
  return freeze({ status: "review_candidate", kind: "png-provenance-review-candidate", version: 1, profile: PNG_PROVENANCE_REVIEW_PROFILE, activation: "disabled",
    source: { selectionWitnessDigest, pngSha256: expected.sha256, byteLength: expected.byteLength, width: expected.width, height: expected.height, caBX: { offset: 33, dataByteLength: 13012, chunkByteLength: 13024, chunkSha256 } },
    inspection: { parserVersion: PNG_PROVENANCE_REVIEW_PARSER, profileDigest, coverageDigest, localBindings: "consistent", certificateTrust: "not-evaluated", identifierSemantics: "unestablished", conformance: "bounded-historical-profile-only" },
    disclosure: { copyVersion: "png-provenance-disclosure-v1", primaryCopy, displayEntries, retainedFields, disclosureDigest }, publishingScopeDigest });
}

/** Authenticated callers may inspect their already owned bytes for a future
 * disclosure. The returned candidate is disabled data, never publishing or
 * copy authority. No URLs, provider calls, trust lookups, metadata mutation or
 * raw-identifier logging. Expected facts/bindings are captured before awaits. */
export async function inspectSelectedOutputSharePngProvenance(input: unknown, expectedFacts: unknown, bindings: unknown): Promise<PngProvenanceReviewInspection> {
  let bytes: Bytes | null = null;
  try {
    const facts = closedData(expectedFacts, ["sha256", "width", "height", "byteLength"]), context = closedData(bindings, ["selectionWitnessDigest", "publishingScopeDigest"]);
    const sha256 = digestValue(facts.sha256), selectionWitnessDigest = digestValue(context.selectionWitnessDigest), publishingScopeDigest = digestValue(context.publishingScopeDigest);
    requireValue([facts.width, facts.height].every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 16384)
      && typeof facts.byteLength === "number" && Number.isSafeInteger(facts.byteLength) && facts.byteLength > 0 && facts.byteLength <= PNG_PROVENANCE_REVIEW_LIMITS.bytes, "invalid_input");
    const expected = { sha256, width: facts.width as number, height: facts.height as number, byteLength: facts.byteLength as number };
    bytes = capture(input); requireValue(bytes.length === expected.byteLength, "selection_mismatch");
    return await inspectMetadata(bytes, expected, selectionWitnessDigest, publishingScopeDigest);
  } catch (error) { return Object.freeze({ status: "refused", activation: "disabled", reason: error instanceof Refusal ? error.reason : "invalid_input" }); }
  finally { bytes?.fill(0); }
}
