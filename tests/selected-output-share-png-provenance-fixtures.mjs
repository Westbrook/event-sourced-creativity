import { createHash } from "node:crypto";
import { png, pngChunk, join, utf8 } from "./output-asset-fixtures.mjs";
import { createC2paCertificateFixture } from "./selected-output-share-c2pa-certificate-fixtures.mjs";

export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const digestBytes = bytes => new Uint8Array(createHash("sha256").update(bytes).digest());
const uint32 = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value); return bytes; };
const argument = (major, size) => size < 24 ? Uint8Array.of(major * 32 + size) : size < 256 ? Uint8Array.of(major * 32 + 24, size)
  : size < 65536 ? Uint8Array.of(major * 32 + 25, size >> 8, size & 255) : join(Uint8Array.of(major * 32 + 26), uint32(size));
export const tagged = (tag, value) => ({ cborTag: tag, value });
export function cbor(value) {
  if (value === null) return Uint8Array.of(0xf6);
  if (typeof value === "boolean") return Uint8Array.of(value ? 0xf5 : 0xf4);
  if (typeof value === "number") return argument(value < 0 ? 1 : 0, value < 0 ? -value - 1 : value);
  if (typeof value === "string") { const bytes = utf8(value); return join(argument(3, bytes.length), bytes); }
  if (value instanceof Uint8Array) return join(argument(2, value.length), value);
  if (Array.isArray(value)) return join(argument(4, value.length), ...value.map(cbor));
  if (Object.hasOwn(value, "cborTag")) return join(argument(6, value.cborTag), cbor(value.value));
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  return join(argument(5, entries.length), ...entries.flatMap(([key, field]) => [cbor(key), cbor(field)]));
}
export const box = (type, ...parts) => { const content = join(...parts); return join(uint32(content.length + 8), utf8(type), content); };
export function superbox(label, uuid, content, salt) {
  const description = box("jumd", new Uint8Array(Buffer.from(uuid + "00110010800000aa00389b71", "hex")), Uint8Array.of(salt ? 19 : 3), utf8(label), Uint8Array.of(0), ...(salt ? [box("c2sh", salt)] : []));
  return box("jumb", description, ...content);
}
let fixturePromise;
const fixture = () => fixturePromise ??= createC2paCertificateFixture();
export const bindings = Object.freeze({ selectionWitnessDigest: "1".repeat(64), publishingScopeDigest: "2".repeat(64) });
export const facts = bytes => ({ sha256: digest(bytes), width: 3, height: 2, byteLength: bytes.length });

/** Synthetic, locally signed profile only. No real certificate key or asset. */
export async function provenancePng(options = {}) {
  const keys = await fixture(), original = options.original ?? png();
  const model = {
    manifestId: "urn:c2pa:11111111-1111-4111-8111-111111111111", instanceId: "xmp:iid:22222222-2222-4222-8222-222222222222",
    actions: { actions: [{ action: "c2pa.created", when: tagged(0, "2026-09-17T12:34:56.123456+00:00"), softwareAgent: { name: "fal.ai" }, digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" }], allActionsIncluded: true },
    info: { request_id: "a1-" + "A".repeat(86) + "==" },
    hashData: { exclusions: [{ start: 33, length: 13024 }], name: "jumbf manifest", alg: "sha256", hash: digestBytes(original), pad: new Uint8Array(8) },
    generator: { name: "fal.ai", "org.contentauth.c2pa_rs": "0.46.0" },
    salts: [new Uint8Array(16).fill(1), new Uint8Array(16).fill(2), new Uint8Array(16).fill(3)],
    certificates: keys.certificates, signaturePad: new Uint8Array(10395),
  };
  options.edit?.(model);
  const labels = ["c2pa.actions.v2", "ai.fal.info", "c2pa.hash.data"];
  const values = [model.actions, model.info, model.hashData];
  const assertionBoxes = values.map((value, index) => superbox(labels[index], "63626f72", [box("cbor", cbor(value))], model.salts[index]));
  const reference = index => ({ url: `self#jumbf=c2pa.assertions/${labels[index]}`, hash: digestBytes(assertionBoxes[index].subarray(8)) });
  const claim = { instanceID: model.instanceId, claim_generator_info: model.generator, signature: `self#jumbf=/c2pa/${model.manifestId}/c2pa.signature`, created_assertions: [reference(2)], gathered_assertions: [reference(0), reference(1)], alg: "sha256" };
  options.editClaim?.(claim);
  const claimBytes = options.claimBytes?.(cbor(claim)) ?? cbor(claim);
  const protectedHeader = new Map([[1, -7], [33, model.certificates]]); options.editProtected?.(protectedHeader);
  const protectedBytes = options.protectedBytes?.(cbor(protectedHeader)) ?? cbor(protectedHeader);
  const signed = cbor(["Signature1", protectedBytes, new Uint8Array(), claimBytes]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.leafPrivateKey, signed));
  const cose = tagged(18, [protectedBytes, { pad: model.signaturePad }, null, signature]); options.editCose?.(cose);
  const store = superbox("c2pa", "63327061", [superbox(model.manifestId, "63326d61", [
    superbox("c2pa.assertions", "63326173", assertionBoxes),
    superbox("c2pa.claim.v2", "6332636c", [box("cbor", claimBytes)]),
    superbox("c2pa.signature", "63326373", [box("cbor", cbor(cose))]),
  ])]);
  const metadata = options.metadata?.(store) ?? store;
  const bytes = join(original.subarray(0, 33), pngChunk("caBX", metadata), original.subarray(33));
  return { bytes, expected: facts(bytes), model, metadata, claimBytes, protectedBytes };
}
