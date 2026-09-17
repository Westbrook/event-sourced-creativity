import assert from "node:assert/strict";
import test from "node:test";
import { png, pngChunk, join, utf8 } from "./output-asset-fixtures.mjs";
import { inspectSelectedOutputSharePngProvenance as inspect, PNG_PROVENANCE_REVIEW_LIMITS } from "../src/model/selected-output-share-png-provenance-review.ts";
import { qualifySelectedOutputShareImage, qualifyResolutionSelectedOutputShareImage, copySelectedOutputShareImageBytes } from "../src/model/selected-output-share-image.ts";
import { provenancePng, bindings, facts, digest, cbor } from "./selected-output-share-png-provenance-fixtures.mjs";

const run = async options => { const fixture = await provenancePng(options); return inspect(fixture.bytes, fixture.expected, bindings); };
const refused = result => { assert.equal(result.status, "refused"); assert.equal(result.activation, "disabled"); assert.equal(copySelectedOutputShareImageBytes(result), null); };
const deeplyFrozen = value => { if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) deeplyFrozen(child); } };

test("closed synthetic profile produces only immutable disabled disclosure data", async () => {
  const fixture = await provenancePng(), result = await inspect(fixture.bytes, fixture.expected, bindings);
  assert.equal(result.status, "review_candidate"); assert.equal(result.activation, "disabled"); assert.equal(result.kind, "png-provenance-review-candidate");
  assert.equal(result.inspection.identifierSemantics, "unestablished"); assert.equal(result.inspection.certificateTrust, "not-evaluated");
  assert.equal(result.inspection.conformance, "bounded-historical-profile-only"); assert.equal(result.inspection.localBindings, "consistent");
  assert.equal(result.disclosure.displayEntries.find(entry => entry.id === "provider-request-id").exactValue, fixture.model.info.request_id);
  assert.match(result.disclosure.primaryCopy, /meaning and linkability unverified/u); assert.match(result.disclosure.primaryCopy, /Anyone who can access the file can extract/u);
  assert.equal(copySelectedOutputShareImageBytes(result), null); assert.equal(copySelectedOutputShareImageBytes(JSON.parse(JSON.stringify(result))), null);
  assert.equal(Object.hasOwn(result, "bytes"), false); deeplyFrozen(result);
});
test("every metadata byte has exactly one field rule and source digest", async () => {
  const fixture = await provenancePng(), result = await inspect(fixture.bytes, fixture.expected, bindings); assert.equal(result.status, "review_candidate");
  const ids = new Set(); let at = 0;
  for (const field of result.disclosure.retainedFields) {
    assert.equal(field.offset, at); assert.ok(field.byteLength > 0); assert.ok(!ids.has(field.id)); ids.add(field.id);
    assert.equal(field.encodedSha256, digest(fixture.metadata.subarray(field.offset, field.offset + field.byteLength)));
    assert.ok(result.disclosure.displayEntries.find(entry => entry.id === field.displayEntryId).sourceFieldIds.includes(field.id)); at += field.byteLength;
  }
  assert.equal(at, 13012); assert.equal(result.source.caBX.chunkSha256, digest(fixture.bytes.subarray(33, 13057)));
  assert.equal(result.source.pngSha256, digest(fixture.bytes));
});
test("disclosure identity is deterministic and includes exact selection and destination", async () => {
  const fixture = await provenancePng(), first = await inspect(fixture.bytes, fixture.expected, bindings), again = await inspect(fixture.bytes, fixture.expected, bindings);
  assert.deepEqual(first, again); assert.equal(first.status, "review_candidate");
  for (const changed of [{ ...bindings, selectionWitnessDigest: "3".repeat(64) }, { ...bindings, publishingScopeDigest: "4".repeat(64) }]) {
    const result = await inspect(fixture.bytes, fixture.expected, changed); assert.equal(result.status, "review_candidate");
    assert.notEqual(result.disclosure.disclosureDigest, first.disclosure.disclosureDigest); assert.equal(result.source.pngSha256, first.source.pngSha256);
  }
});
test("different disclosed identifier keeps uncertainty and changes complete-byte/disclosure identity", async () => {
  const first = await run(), changed = await run({ edit: model => { model.info.request_id = "b2-" + "B".repeat(86) + "=="; } });
  assert.equal(first.status, "review_candidate"); assert.equal(changed.status, "review_candidate");
  assert.notEqual(first.source.pngSha256, changed.source.pngSha256); assert.notEqual(first.disclosure.disclosureDigest, changed.disclosure.disclosureDigest);
  assert.equal(changed.inspection.identifierSemantics, "unestablished");
});
test("both existing PNG gates still refuse caBX and cannot copy this candidate", async () => {
  const fixture = await provenancePng();
  for (const qualify of [qualifySelectedOutputShareImage, qualifyResolutionSelectedOutputShareImage]) {
    const result = await qualify(fixture.bytes, fixture.expected); assert.equal(result.status, "unqualified"); assert.equal(result.reason, "unqualified_metadata");
  }
});
test("capture precedes await and later original, expected and context changes cannot substitute data", async () => {
  const fixture = await provenancePng(), original = fixture.bytes.slice(), context = { ...bindings }, expected = { ...fixture.expected };
  const pending = inspect(fixture.bytes, expected, context); fixture.bytes.fill(0); expected.sha256 = "0".repeat(64); context.selectionWitnessDigest = "9".repeat(64);
  const result = await pending; assert.equal(result.status, "review_candidate"); assert.equal(result.source.pngSha256, digest(original)); assert.equal(result.source.selectionWitnessDigest, bindings.selectionWitnessDigest);
});
test("subarray capture ignores shadowed byte accessors and cannot disclose adjacent bytes", async () => {
  const fixture = await provenancePng(), source = join(utf8("SYNTHETIC_PREFIX"), fixture.bytes, utf8("SYNTHETIC_SUFFIX"));
  const selected = source.subarray(16, 16 + fixture.bytes.length); let calls = 0;
  for (const key of ["buffer", "byteLength", Symbol.iterator]) Object.defineProperty(selected, key, { get() { calls++; throw Error("must not run"); } });
  const result = await inspect(selected, fixture.expected, bindings); assert.equal(result.status, "review_candidate"); assert.equal(calls, 0);
  assert.equal(JSON.stringify(result).includes("SYNTHETIC_SUFFIX"), false);
});
test("closed fact and context objects reject getters, unknown fields and malformed digests", async () => {
  const fixture = await provenancePng(); let calls = 0;
  const accessor = { ...bindings }; Object.defineProperty(accessor, "selectionWitnessDigest", { get() { calls++; return bindings.selectionWitnessDigest; } });
  for (const context of [accessor, { ...bindings, approved: true }, { ...bindings, publishingScopeDigest: "invalid" }, null, Object.create(bindings)]) refused(await inspect(fixture.bytes, fixture.expected, context));
  for (const expected of [{ ...fixture.expected, approved: true }, { ...fixture.expected, width: 0 }, { ...fixture.expected, width: 1.5 }, { ...fixture.expected, height: 16385 }, { ...fixture.expected, byteLength: 0 }, { ...fixture.expected, sha256: "invalid" }]) refused(await inspect(fixture.bytes, expected, bindings));
  assert.equal(calls, 0);
});
test("shared, detached, proxy, subclass and oversized inputs refuse", async () => {
  const fixture = await provenancePng(), detached = fixture.bytes.slice(); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const shared = new Uint8Array(new SharedArrayBuffer(fixture.bytes.length)); shared.set(fixture.bytes); class Bytes extends Uint8Array {}
  for (const input of [shared, detached, new Proxy(fixture.bytes, {}), new Bytes(fixture.bytes), fixture.bytes.buffer, [], null, new Uint8Array(), new Uint8Array(PNG_PROVENANCE_REVIEW_LIMITS.bytes + 1)]) refused(await inspect(input, fixture.expected, bindings));
});
test("expected full hash, dimensions and length bind every candidate", async () => {
  const fixture = await provenancePng();
  for (const patch of [{ sha256: "0".repeat(64) }, { width: 4 }, { height: 3 }, { byteLength: fixture.bytes.length + 1 }]) {
    const result = await inspect(fixture.bytes, { ...fixture.expected, ...patch }, bindings); refused(result); assert.equal(result.reason, "selection_mismatch");
  }
});

const assertionCases = [
  ["unknown action", model => { model.actions.actions[0].action = "c2pa.deleted"; }],
  ["unknown software agent", model => { model.actions.actions[0].softwareAgent.name = "fal.xx"; }],
  ["creation claim completeness false", model => { model.actions.allActionsIncluded = false; }],
  ["impossible date", model => { model.actions.actions[0].when.value = "2026-02-30T12:34:56.123456+00:00"; }],
  ["non-UTC timestamp", model => { model.actions.actions[0].when.value = "2026-09-17T12:34:56.123456+01:00"; }],
  ["unsupported timestamp tag", model => { model.actions.actions[0].when.cborTag = 1; }],
  ["non-ASCII opaque identifier", model => { model.info.request_id = "a1-" + "A".repeat(85) + "é=="; }],
  ["wrong identifier grammar", model => { model.info.request_id = "A1-" + "A".repeat(86) + "=="; }],
  ["identifier hidden space", model => { model.info.request_id = "a1-" + "A".repeat(85) + " =="; }],
  ["unknown vendor key", model => { model.info = { request_xx: model.info.request_id }; }],
  ["unsupported generator version", model => { model.generator["org.contentauth.c2pa_rs"] = "0.4a.0"; }],
  ["different generator name", model => { model.generator.name = "fal.xx"; }],
  ["wrong manifest UUID version", model => { model.manifestId = model.manifestId.replace("-4111-", "-5111-"); }],
  ["wrong instance UUID variant", model => { model.instanceId = model.instanceId.replace("-8222-", "-7222-"); }],
  ["different asset hash algorithm", model => { model.hashData.alg = "sha512"; }],
  ["nonzero data-hash padding", model => { model.hashData.pad[0] = 1; }],
  ["nonzero signature padding", model => { model.signaturePad[0] = 1; }],
  ["unknown data-hash name", model => { model.hashData.name = "jumbf privatex"; }],
];
for (const [name, edit] of assertionCases) test(`${name} refuses even with freshly signed local claim`, async () => refused(await run({ edit })));
test("each exact URI field refuses external-reference substitution", async () => {
  for (const options of [
    { edit: model => { model.actions.actions[0].digitalSourceType = "https://private.invalid/"; } },
    { editClaim: claim => { claim.signature = "https://private.invalid/c2pa.signature"; } },
    { editClaim: claim => { claim.gathered_assertions[1].url = "https://private.invalid/ai.fal.info"; } },
  ]) refused(await run(options));
});
test("creation, gathered and signature references are exact closed graph edges", async () => {
  for (const editClaim of [
    claim => { claim.created_assertions[0].url = "self#jumbf=c2pa.assertions/c2pa.actions.v2"; },
    claim => { claim.gathered_assertions.reverse(); },
    claim => { claim.gathered_assertions[1] = { ...claim.gathered_assertions[0] }; },
    claim => { claim.signature = claim.signature.replace("11111111", "33333333"); },
    claim => { claim.signature = claim.signature.replace("c2pa.signature", "c2pa.thumbnaiL"); },
  ]) refused(await run({ editClaim }));
});
test("all assertion hashes and whole-PNG exclusion hash are recomputed", async () => {
  for (const editClaim of [claim => { claim.created_assertions[0].hash[0] ^= 1; }, claim => { claim.gathered_assertions[0].hash[0] ^= 1; }, claim => { claim.gathered_assertions[1].hash[0] ^= 1; }]) {
    const result = await run({ editClaim }); refused(result); assert.equal(result.reason, "inconsistent_bindings");
  }
  const result = await run({ edit: model => { model.hashData.hash[0] ^= 1; } }); refused(result); assert.equal(result.reason, "inconsistent_bindings");
});
test("exclusion cannot hide different PNG bytes or admit additional ranges", async () => {
  for (const edit of [model => { model.hashData.exclusions[0].start = 34; }, model => { model.hashData.exclusions[0].length = 13023; }, model => { model.hashData.exclusions.push({ start: 0, length: 8 }); }]) refused(await run({ edit }));
});
test("COSE algorithm, payload, tag, chain order and signature bytes remain closed", async () => {
  for (const options of [
    { editProtected: header => header.set(1, -8) },
    { edit: model => { model.certificates = [...model.certificates].reverse(); } },
    { editCose: value => { value.cborTag = 17; } },
    { editCose: value => { value.value[2] = new Uint8Array(); } },
    { editCose: value => { value.value[3][0] ^= 1; } },
    { editCose: value => { value.value[1] = { url: value.value[1].pad }; } },
  ]) refused(await run(options));
});
test("CBOR duplicate keys, indefinite values and nonminimal lengths cannot be normalized", async () => {
  const edits = [
    bytes => join(Uint8Array.of(0xbf), bytes.subarray(1), Uint8Array.of(0xff)),
    bytes => join(Uint8Array.of(0xb8, 6), bytes.subarray(1)),
    bytes => join(Uint8Array.of(0xa7), bytes.subarray(1), cbor("alg"), cbor("sha256")),
    bytes => join(bytes, Uint8Array.of(0)),
  ];
  for (const claimBytes of edits) refused(await run({ claimBytes }));
});
test("UTF-8 BOMs in metadata text and keys are not stripped into supported values", async () => {
  for (const edit of [
    model => { model.manifestId = "\ufeff" + model.manifestId; },
    model => { model.instanceId = "\ufeff" + model.instanceId; },
    model => { model.info.request_id = "\ufeff" + model.info.request_id; },
    model => { model.info = { ["\ufeffrequest_id"]: model.info.request_id }; },
    model => { model.generator.name = "\ufefffal.ai"; },
    model => { model.actions.actions[0].when.value = "\ufeff" + model.actions.actions[0].when.value; },
  ]) refused(await run({ edit }));
});
test("unknown JUMBF boxes, flags, UUIDs, lengths and hidden metadata tails refuse", async () => {
  for (const metadata of [
    bytes => { const changed = bytes.slice(); changed[12] = 0x58; return changed; },
    bytes => { const changed = bytes.slice(); changed[32] = 19; return changed; },
    bytes => { const changed = bytes.slice(); changed[16] ^= 1; return changed; },
    bytes => { const changed = bytes.slice(); new DataView(changed.buffer).setUint32(0, 0); return changed; },
    bytes => { const changed = bytes.slice(); new DataView(changed.buffer).setUint32(0, 1); return changed; },
    bytes => { const changed = bytes.slice(); new DataView(changed.buffer).setUint32(0, 0xffffffff); return changed; },
    bytes => join(bytes, Uint8Array.of(0)),
    bytes => bytes.subarray(0, bytes.length - 1),
  ]) refused(await run({ metadata }));
});
test("native CRC, inflate/filter and exact PNG boundary checks still run", async () => {
  const fixture = await provenancePng(), invalidCrc = fixture.bytes.slice(); invalidCrc[13056] ^= 1;
  let result = await inspect(invalidCrc, facts(invalidCrc), bindings); refused(result); assert.equal(result.reason, "invalid_png");
  const badFilter = new Uint8Array(26); badFilter[0] = 5;
  for (const original of [png({ raw: badFilter }), png({ raw: new Uint8Array(1) })]) { result = await run({ original }); refused(result); assert.equal(result.reason, "invalid_png"); }
  for (const bytes of [join(fixture.bytes, Uint8Array.of(0)), fixture.bytes.subarray(0, fixture.bytes.length - 1), png()]) refused(await inspect(bytes, facts(bytes), bindings));
});
test("extra, misplaced or duplicate PNG metadata remains unsupported", async () => {
  const fixture = await provenancePng(), metadata = pngChunk("caBX", fixture.metadata), core = png();
  for (const bytes of [join(core.subarray(0, 33), metadata, metadata, core.subarray(33)),
    join(core.subarray(0, -12), metadata, core.subarray(-12)),
    join(fixture.bytes.subarray(0, 13057), pngChunk("tEXt", utf8("Comment\0SYNTHETIC_PRIVATE")), fixture.bytes.subarray(13057))]) refused(await inspect(bytes, facts(bytes), bindings));
});
test("inspection performs no fetch or external verification", async () => {
  const fixture = await provenancePng(), originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw Error("network forbidden"); };
  try { assert.equal((await inspect(fixture.bytes, fixture.expected, bindings)).status, "review_candidate"); assert.equal(calls, 0); }
  finally { globalThis.fetch = originalFetch; }
});
