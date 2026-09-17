import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { png, pngChunk, join, utf8 } from "./output-asset-fixtures.mjs";
import { provenancePng, bindings, facts, digest } from "./selected-output-share-png-provenance-fixtures.mjs";
import { prepareSelectedOutputSharePngDerivativeV1 as prepare, copyPreparedSelectedOutputSharePngBytes as copy,
  SELECTED_OUTPUT_SHARE_PNG_DERIVATIVE_VERSION } from "../src/model/selected-output-share-png-derivative.ts";
import { qualifySelectedOutputShareImage, copySelectedOutputShareImageBytes, SELECTED_OUTPUT_SHARE_IMAGE_POLICY } from "../src/model/selected-output-share-image.ts";
import { MAX_OUTPUT_ASSET_BYTES } from "../src/model/output-asset-inspection.ts";

const run = async options => { const fixture = await provenancePng(options); return { fixture, result: await prepare(fixture.bytes, fixture.expected, bindings) }; };
const refused = result => { assert.equal(result.status, "refused"); assert.equal(result.activation, "disabled"); assert.equal(copy(result), null); };
function chunks(bytes) { const result = []; for (let at = 8; at < bytes.length;) { const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(at); result.push({ type: new TextDecoder().decode(bytes.subarray(at + 4, at + 8)), raw: bytes.slice(at, at + length + 12), payload: bytes.slice(at + 8, at + length + 8) }); at += length + 12; } return result; }
function frozen(value) { if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }

test("recognized source produces only a disabled versioned derivative with separate identities", async () => {
  const { fixture, result } = await run(); assert.equal(result.status, "prepared_derivative"); assert.equal(result.activation, "disabled");
  assert.equal(result.version, SELECTED_OUTPUT_SHARE_PNG_DERIVATIVE_VERSION); assert.equal(result.public.policy, SELECTED_OUTPUT_SHARE_IMAGE_POLICY);
  assert.equal(result.source.sha256, digest(fixture.bytes)); assert.equal(result.public.sha256, digest(copy(result))); assert.notEqual(result.source.sha256, result.public.sha256);
  assert.equal(result.source.byteLength - result.public.byteLength, 13024); assert.equal(result.source.selectionWitnessDigest, bindings.selectionWitnessDigest);
  assert.equal(result.transform.publishingScopeDigest, bindings.publishingScopeDigest); assert.equal(result.transform.provenance, "embedded-C2PA-manifest-removed");
  frozen(result); assert.equal(copySelectedOutputShareImageBytes(result), null);
});
test("exact prefix and suffix survive; removed bytes have their own private witness", async () => {
  const { fixture, result } = await run(), output = copy(result); assert.equal(result.status, "prepared_derivative");
  assert.deepEqual(output, join(fixture.bytes.subarray(0, 33), fixture.bytes.subarray(13057)));
  assert.deepEqual(result.transform.removedChunk, { type: "caBX", offset: 33, dataByteLength: 13012, byteLength: 13024, sha256: digest(fixture.bytes.subarray(33, 13057)) });
  assert.deepEqual(result.transform.retainedRanges, [{ sourceOffset: 0, byteLength: 33 }, { sourceOffset: 13057, byteLength: fixture.bytes.length - 13057 }]);
  assert.equal(result.public.sha256, Buffer.from(fixture.model.hashData.hash).toString("hex"));
  assert.equal(chunks(output).some(chunk => chunk.type === "caBX"), false);
});
test("ordered split IDAT stream, critical chunks and decoded pixel samples remain identical", async () => {
  const base = png(), [header, image, end] = chunks(base), at = Math.floor(image.payload.length / 2);
  const original = join(base.subarray(0, 8), header.raw, pngChunk("IDAT", image.payload.subarray(0, at)), pngChunk("IDAT", image.payload.subarray(at)), end.raw);
  const { fixture, result } = await run({ original }); assert.equal(result.status, "prepared_derivative"); const output = copy(result);
  const retainedSource = chunks(fixture.bytes).filter(chunk => chunk.type !== "caBX"), publicChunks = chunks(output);
  assert.deepEqual(publicChunks.map(chunk => chunk.type), ["IHDR", "IDAT", "IDAT", "IEND"]);
  assert.deepEqual(publicChunks.map(chunk => chunk.raw), retainedSource.map(chunk => chunk.raw)); assert.deepEqual(output, original);
  const inflate = list => inflateSync(join(...list.filter(chunk => chunk.type === "IDAT").map(chunk => chunk.payload)));
  assert.deepEqual(inflate(publicChunks), inflate(retainedSource));
});
test("actual returned public copy independently qualifies under unchanged strict PNG v1", async () => {
  const { fixture, result } = await run(), output = copy(result); assert.equal(result.status, "prepared_derivative");
  const qualified = await qualifySelectedOutputShareImage(output, { sha256: result.public.sha256, byteLength: result.public.byteLength, width: result.public.width, height: result.public.height });
  assert.equal(qualified.status, "qualified"); assert.equal(qualified.policy, SELECTED_OUTPUT_SHARE_IMAGE_POLICY); assert.deepEqual(copySelectedOutputShareImageBytes(qualified), output);
  const original = await qualifySelectedOutputShareImage(fixture.bytes, fixture.expected); assert.equal(original.status, "unqualified"); assert.equal(original.reason, "unqualified_metadata");
});
test("source array remains unchanged on success and refusal", async () => {
  for (const options of [undefined, { edit: model => { model.info = { rights_url: model.info.request_id }; } }]) {
    const fixture = await provenancePng(options), before = fixture.bytes.slice(); await prepare(fixture.bytes, fixture.expected, bindings); assert.deepEqual(fixture.bytes, before);
  }
});
test("async input, fact and binding mutation cannot substitute the source or scope", async () => {
  const fixture = await provenancePng(), original = fixture.bytes.slice(), expected = { ...fixture.expected }, context = { ...bindings };
  const pending = prepare(fixture.bytes, expected, context); fixture.bytes.fill(0); expected.sha256 = "0".repeat(64); context.publishingScopeDigest = "9".repeat(64);
  const result = await pending; assert.equal(result.status, "prepared_derivative"); assert.equal(result.source.sha256, digest(original));
  assert.equal(result.transform.publishingScopeDigest, bindings.publishingScopeDigest); assert.deepEqual(copy(result), join(original.subarray(0, 33), original.subarray(13057)));
});
test("returned arrays are independent; source/strict qualification capability is not exposed", async () => {
  const { result } = await run(), first = copy(result), expected = first.slice(); first.fill(0); assert.deepEqual(copy(result), expected); assert.notEqual(copy(result), copy(result));
  for (const value of [{ ...result }, JSON.parse(JSON.stringify(result)), new Proxy(result, {}), {}, null, 0, "prepared_derivative"]) assert.equal(copy(value), null);
  assert.equal(copySelectedOutputShareImageBytes(result), null); assert.equal(Object.hasOwn(result, "bytes"), false); assert.equal(Object.hasOwn(result, "qualification"), false);
});
test("subarray capture ignores hostile byte getters and excludes neighboring data", async () => {
  const fixture = await provenancePng(), wrapped = join(utf8("prefix"), fixture.bytes, utf8("SYNTHETIC_PRIVATE_SUFFIX")), selected = wrapped.subarray(6, 6 + fixture.bytes.length); let calls = 0;
  for (const key of ["byteLength", "buffer", Symbol.iterator]) Object.defineProperty(selected, key, { get() { calls++; throw Error("must not run"); } });
  const result = await prepare(selected, fixture.expected, bindings); assert.equal(result.status, "prepared_derivative"); assert.equal(calls, 0); assert.equal(result.source.sha256, fixture.expected.sha256);
  assert.deepEqual(copy(result), png());
});
test("shared, detached, proxy, subclass, oversized and nonbyte sources refuse", async () => {
  const fixture = await provenancePng(), shared = new Uint8Array(new SharedArrayBuffer(fixture.bytes.length)); shared.set(fixture.bytes);
  const detached = fixture.bytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] }); class Bytes extends Uint8Array {}
  for (const input of [shared, detached, new Proxy(fixture.bytes, {}), new Bytes(fixture.bytes), fixture.bytes.buffer, [], null, new Uint8Array(MAX_OUTPUT_ASSET_BYTES + 1)]) refused(await prepare(input, fixture.expected, bindings));
});
test("closed facts, binding descriptors and source mismatches remain enforced", async () => {
  const fixture = await provenancePng(); let calls = 0;
  const context = { ...bindings }; Object.defineProperty(context, "publishingScopeDigest", { get() { calls++; return bindings.publishingScopeDigest; } });
  for (const value of [context, { ...bindings, approved: true }, { ...bindings, publishingScopeDigest: "invalid" }]) refused(await prepare(fixture.bytes, fixture.expected, value));
  for (const patch of [{ sha256: "0".repeat(64) }, { width: 4 }, { height: 3 }, { byteLength: fixture.bytes.length + 1 }, { publicPolicy: "allow-all" }]) refused(await prepare(fixture.bytes, { ...fixture.expected, ...patch }, bindings));
  assert.equal(calls, 0);
});
test("changed current-selection and publishing-scope bindings remain separate private roles", async () => {
  const fixture = await provenancePng();
  const first = await prepare(fixture.bytes, fixture.expected, bindings), changed = await prepare(fixture.bytes, fixture.expected, { selectionWitnessDigest: "3".repeat(64), publishingScopeDigest: "4".repeat(64) });
  assert.equal(changed.status, "prepared_derivative"); assert.deepEqual(changed.public, first.public);
  assert.notEqual(changed.source.selectionWitnessDigest, first.source.selectionWitnessDigest); assert.notEqual(changed.transform.publishingScopeDigest, first.transform.publishingScopeDigest);
});
test("same-size unknown rights/vendor fields refuse despite valid signatures and otherwise usable public pixels", async () => {
  for (const replacement of ["rights_url", "private_id"]) {
    const fixture = await provenancePng({ edit: model => { model.info = { [replacement]: model.info.request_id }; } }); assert.equal(fixture.metadata.length, 13012);
    const wouldBePixels = join(fixture.bytes.subarray(0, 33), fixture.bytes.subarray(13057)); assert.equal((await qualifySelectedOutputShareImage(wouldBePixels, facts(wouldBePixels))).status, "qualified");
    const result = await prepare(fixture.bytes, fixture.expected, bindings); refused(result); assert.equal(result.reason, "source_refused");
  }
});
test("bad local assertion or signature binding cannot be stripped away", async () => {
  for (const options of [{ editClaim: claim => { claim.gathered_assertions[1].hash[0] ^= 1; } }, { editCose: value => { value.value[3][0] ^= 1; } }]) {
    const fixture = await provenancePng(options); assert.equal(fixture.metadata.length, 13012); refused(await prepare(fixture.bytes, fixture.expected, bindings));
  }
});
test("additional metadata, duplicate/misplaced caBX and arbitrary clean PNG inputs are not normalized", async () => {
  const fixture = await provenancePng(), core = png(), cabx = pngChunk("caBX", fixture.metadata);
  const sources = [core, join(core.subarray(0, 33), cabx, cabx, core.subarray(33)), join(core.subarray(0, -12), cabx, core.subarray(-12)),
    join(fixture.bytes.subarray(0, 13057), pngChunk("tEXt", utf8("Copyright\0SYNTHETIC_RIGHTS")), fixture.bytes.subarray(13057))];
  for (const bytes of sources) refused(await prepare(bytes, facts(bytes), bindings));
});
test("native corrupt PNG or trailing bytes cannot become an accepted derivative", async () => {
  const fixture = await provenancePng(), corrupt = fixture.bytes.slice(); corrupt[13056] ^= 1;
  for (const bytes of [corrupt, fixture.bytes.subarray(0, -1), join(fixture.bytes, Uint8Array.of(0))]) refused(await prepare(bytes, facts(bytes), bindings));
});
test("private receipt excludes raw provenance; public facts use an exact independent allowlist", async () => {
  const { fixture, result } = await run(); assert.equal(result.status, "prepared_derivative"); const receipt = JSON.stringify(result);
  for (const raw of [fixture.model.info.request_id, fixture.model.manifestId, fixture.model.instanceId, "fal.ai", "Features", "recordedAt", "request_id", "certificate", "displayEntries"]) assert.equal(receipt.includes(raw), false, raw);
  assert.deepEqual(Object.keys(result.public).sort(), ["byteLength", "height", "mimeType", "policy", "sha256", "width"]);
  assert.equal(Object.hasOwn(result.public, "source"), false); assert.equal(JSON.stringify(result.public).includes(result.source.sha256), false);
});
test("pure preparation performs no network, provider or filesystem action", async () => {
  const fixture = await provenancePng(), originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw Error("network forbidden"); };
  try { assert.equal((await prepare(fixture.bytes, fixture.expected, bindings)).status, "prepared_derivative"); assert.equal(calls, 0); }
  finally { globalThis.fetch = originalFetch; }
});
