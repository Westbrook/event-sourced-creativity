import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
const hooks = registerOutputSourceImports();
const { verifyOutputSourceEvidence } = await import("../worker/output-source-evidence-capacity.ts");
const { extractSourceDocument, sourceDocumentEvidence, sourceDocumentEvidenceDigest } = await import("../src/model/source-documents.ts");
const { ownerMediaNamespace } = await import("../src/model/media-ownership.ts");
hooks.deregister();
const originalFetch = globalThis.fetch;
let networkCalls = 0;
test.before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error("source_capacity_network_disabled"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });

async function fixture() {
  const owner = "source-owner", mimeType = "text/plain", hash = "4".repeat(64);
  const extracted = await extractSourceDocument(new File(["Use only this exact retained quotation."], "brief.txt", { type: mimeType }));
  const evidence = sourceDocumentEvidence(extracted, hash, mimeType), evidenceHash = await sourceDocumentEvidenceDigest(evidence);
  const objects = new Map(), calls = [];
  function block(index = 0) {
    const key = `${ownerMediaNamespace(owner)}/source-${index}.txt`;
    objects.set(key, { customMetadata: { ownerId: owner, sha256: hash, mimeType, sourceEvidenceSha256: evidenceHash }, httpEtag: "fixture" });
    return { type: "reference", properties: { media_url: `/api/media/${encodeURIComponent(key)}`, source_evidence_hash: evidenceHash, source_content_hash: hash, source_mime_type: mimeType, source_kind: extracted.sourceKind, extraction_status: extracted.status, text: extracted.text, source_citations: extracted.segments.map((segment) => ({ anchor: segment.anchor, excerpt: segment.text })), source_segment_count: extracted.segments.length, source_excerpt_truncated: extracted.truncated } };
  }
  const env = { MEDIA: { async head(key) { calls.push(key); return objects.get(key) ?? null; }, async list() { throw new Error("owner_wide_scan_forbidden"); }, async get() { throw new Error("unexpected_source_bytes"); } } };
  return { owner, env, objects, calls, block };
}

test("65 repeated references verify every claim with one exact HEAD", async () => {
  const state = await fixture(), source = state.block();
  const result = await verifyOutputSourceEvidence(state.env, state.owner, Array.from({ length: 65 }, () => structuredClone(source)), { maximumDistinctObjects: 1 });
  assert.equal(result.status, "verified");
  assert.equal(result.referenceCount, 65);
  assert.equal(result.distinctObjectCount, 1);
  assert.equal(result.objectReads, 1);
  assert.equal(state.calls.length, 1);
});

test("an unverified corpus is rejected for capacity before the first HEAD", async () => {
  const state = await fixture(), sources = Array.from({ length: 65 }, (_, index) => state.block(index));
  const result = await verifyOutputSourceEvidence(state.env, state.owner, sources, { maximumDistinctObjects: 4 });
  assert.equal(result.status, "capacity_exceeded");
  assert.equal(result.reasonCode, "context_source_evidence_capacity_exceeded");
  assert.equal(result.referenceCount, 65);
  assert.equal(result.distinctObjectCount, 65);
  assert.equal(state.calls.length, 0);
  assert.equal(sources.length, 65, "capacity does not drop authored source blocks");
});

test("a caller with no proven native headroom permits no extracted source lookups", async () => {
  const state = await fixture();
  assert.equal((await verifyOutputSourceEvidence(state.env, state.owner, [state.block()], { maximumDistinctObjects: 0 })).status, "capacity_exceeded");
  assert.equal((await verifyOutputSourceEvidence(state.env, state.owner, [], { maximumDistinctObjects: 0 })).status, "verified");
  assert.equal(state.calls.length, 0);
});

test("deduplication never accepts a forged later quote, anchor, hash, or owner", async () => {
  for (const field of ["text", "anchor", "hash", "owner"]) {
    const state = await fixture(), original = state.block(), forged = structuredClone(original);
    if (field === "text") forged.properties.text = "A fabricated quote.";
    else if (field === "anchor") forged.properties.source_citations[0].anchor = "Page 999";
    else if (field === "hash") forged.properties.source_content_hash = "5".repeat(64);
    else forged.properties.media_url = `/api/media/${encodeURIComponent(`${ownerMediaNamespace("another-owner")}/source-0.txt`)}`;
    const result = await verifyOutputSourceEvidence(state.env, state.owner, [original, forged], { maximumDistinctObjects: 1 });
    assert.equal(result.status, "unavailable", field);
    assert.ok(state.calls.length <= 1, field);
  }
});

test("separate validation invocations recheck changed source metadata and never use a global cache", async () => {
  const state = await fixture(), block = state.block();
  assert.equal((await verifyOutputSourceEvidence(state.env, state.owner, [block], { maximumDistinctObjects: 1 })).status, "verified");
  const object = [...state.objects.values()][0]; object.customMetadata.sourceEvidenceSha256 = "6".repeat(64);
  assert.equal((await verifyOutputSourceEvidence(state.env, state.owner, [block], { maximumDistinctObjects: 1 })).status, "unavailable");
  assert.equal(state.calls.length, 2);
});

test("distinct source boundaries 0, 1, 2, 4 and 5 are exact under each disclosed route limit", async () => {
  for (const limit of [0, 1, 4]) for (const count of [0, 1, 2, 4, 5]) {
    const state = await fixture(), sources = Array.from({ length: count }, (_, index) => state.block(index));
    const result = await verifyOutputSourceEvidence(state.env, state.owner, sources, { maximumDistinctObjects: limit });
    assert.equal(result.referenceCount, count);
    assert.equal(result.distinctObjectCount, count);
    assert.equal(result.countsComplete, true);
    assert.equal(result.status, count <= limit ? "verified" : "capacity_exceeded", `${count} distinct objects under limit ${limit}`);
    assert.equal(result.objectReads, count <= limit ? count : 0);
  }
});

test("an uncountable foreign or malformed source key is not disclosed as a complete zero-object inventory", async () => {
  const state = await fixture(), bad = state.block(); bad.properties.media_url = "https://unapproved.example.test/source.txt";
  const result = await verifyOutputSourceEvidence(state.env, state.owner, [bad], { maximumDistinctObjects: 4 });
  assert.equal(result.status, "unavailable");
  assert.equal(result.referenceCount, 1);
  assert.equal(result.distinctObjectCount, 0);
  assert.equal(result.countsComplete, false);
  assert.equal(result.objectReads, 0);
});
