import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryRecord, createMemoryScopeGraph, forgetMemory, memoryDigest, memoryExpiry, memoryKey,
  memoryLocality, memoryRecordEligible, memoryScopePath, memorySourceEligible,
} from "../src/model/scoped-memory.ts";
import { hashMemoryText, memoryFixture, sourceMap } from "./helpers/scoped-memory.mjs";

test("scope identity is custodian-namespaced and containment is bounded and acyclic", () => {
  const { scopes, graph } = memoryFixture();
  assert.equal(graph.size, 14);
  assert.notEqual(graph.get(memoryKey("org:alpha", "document")), graph.get(memoryKey("org:beta", "document")));
  assert.deepEqual(memoryScopePath(graph, "org:alpha", "block").map((scope) => scope.id), ["block", "document", "nested-project", "project", "organization"]);
  assert.throws(() => createMemoryScopeGraph([...scopes, scopes[0]]), /Duplicate/);
  assert.throws(() => createMemoryScopeGraph(scopes.map((scope) => scope.id === "project" ? { ...scope, parentId: "nested-project" } : scope)), /Cyclic/);
  assert.throws(() => createMemoryScopeGraph(scopes.map((scope) => scope.id === "block" ? { ...scope, parentId: "missing" } : scope)), /Missing/);
  assert.throws(() => createMemoryScopeGraph([{ ...scopes[0], kind: "project" }]), /root/);
  const deep = [scopes[0], ...Array.from({ length: 33 }, (_, index) => ({ id: `p-${index}`, kind: "project", parentId: index ? `p-${index - 1}` : "organization", custodianId: "org:alpha", version: 1 }))];
  assert.throws(() => createMemoryScopeGraph(deep), /excessive/);
});

test("ancestor membership never substitutes for source and target grants or learning consent", () => {
  const { source, access, graph } = memoryFixture();
  const row = source();
  assert.equal(memorySourceEligible(row, access, graph, "learn"), true);
  for (const scopeId of ["block", "document"]) {
    const next = { ...access, targetScopeId: "document", grants: access.grants.filter((grant) => grant.scopeId !== scopeId) };
    assert.equal(memorySourceEligible(row, next, graph, "learn"), false, scopeId);
  }
  const recallOnly = { ...access, grants: access.grants.map((grant) => ({ ...grant, purposes: ["recall"] })) };
  assert.equal(memorySourceEligible(row, recallOnly, graph, "recall"), true);
  assert.equal(memorySourceEligible(row, recallOnly, graph, "learn"), false);
  assert.equal(memorySourceEligible(row, { ...access, grants: [...access.grants, access.grants.at(-1)] }, graph, "learn"), true, "unrelated ambiguous grant is not used");
  assert.equal(memorySourceEligible(row, { ...access, grants: [...access.grants, access.grants.find((grant) => grant.scopeId === "block")] }, graph, "learn"), false);
});

test("cross-custodian recall fails closed even for the same user and matching resource IDs", () => {
  const { source, access, graph, record } = memoryFixture();
  const other = source({ custodianId: "org:beta", scopeId: "document" });
  assert.equal(memorySourceEligible(other, access, graph, "learn"), false);
  assert.equal(record({ sources: [other] }), null);
});

test("shared source plus private chat remains an actor-private derivative", () => {
  const { source, access, graph, record } = memoryFixture();
  const privateSource = source();
  const shared = source({ id: "shared", sequence: 2, actorUserId: "bob", visibility: "shared" });
  const result = record({ sources: [privateSource, shared] });
  assert.ok(result);
  const current = sourceMap(privateSource, shared);
  assert.equal(memoryRecordEligible(result, current, access, graph), true);
  assert.equal(memoryRecordEligible(result, current, { ...access, actorUserId: "bob" }, graph), false);
  assert.equal(memorySourceEligible({ ...shared, visibility: "actor" }, access, graph, "learn"), false);
});

test("disabled, incomplete and malformed policy inputs fail closed", () => {
  const { source, access, graph } = memoryFixture();
  for (const patch of [{ enabled: false }, { actorUserId: "" }, { now: "invalid" }, { enrollmentExpiresAt: "invalid" },
    { retentionDays: NaN }, { retentionDays: 0 }, { environment: "unknown" }, { fence: {} },
    { fence: { ...access.fence, permission: NaN } }, { targetScopeId: "missing" }]) {
    assert.equal(memorySourceEligible(source(), { ...access, ...patch }, graph, "learn"), false, JSON.stringify(patch));
  }
});

test("erased, revoked, held, redacted, malformed and expired sources cannot be learned or recalled", () => {
  const { source, access, graph } = memoryFixture();
  for (const patch of ["erased", "revoked", "redacted", "held-only"].map((state) => ({ state })).concat([
    { expiresAt: access.now }, { expiresAt: "invalid" }, { happenedAt: "invalid" }, { happenedAt: "2027-01-01" },
    { contentHash: "bad" }, { sequence: NaN }, { sequence: 0 }, { scopeVersion: 2 }, { independentEvidence: undefined },
  ])) assert.equal(memorySourceEligible(source(patch), access, graph, "learn"), false, JSON.stringify(patch));
});

test("synthetic evidence cannot enter production memory", () => {
  const { source, access, graph, record } = memoryFixture();
  const production = { ...access, environment: "production" };
  assert.equal(memorySourceEligible(source(), production, graph, "learn"), false);
  assert.equal(memorySourceEligible(source({ synthetic: false }), production, graph, "learn"), true);
  assert.equal(memoryRecordEligible(record(), sourceMap(source()), production, graph), false);
});

test("source-bound deadlines do not renew on reads, rephrasing or a 90-day policy", () => {
  const { source, access, graph, record } = memoryFixture();
  const first = record();
  const future = { ...access, now: "2026-09-10T12:00:00.000Z", retentionDays: 90 };
  const revised = createMemoryRecord({ ...first, sources: [source()], body: "A rephrased summary", version: 2 }, future, graph);
  assert.equal(first.expiresAt, "2026-10-01T00:00:00.000Z");
  assert.equal(revised.expiresAt, first.expiresAt);
  assert.equal(revised.lastIndependentEvidenceAt, first.lastIndependentEvidenceAt);
  assert.equal(memoryRecordEligible(first, sourceMap(source()), { ...future, now: first.expiresAt }, graph), false);
  assert.equal(memoryRecordEligible(first, sourceMap(source()), { ...future, retentionDays: 1 }, graph), false);
  assert.equal(memoryExpiry([source({ expiresAt: "2026-09-03T00:00:00Z" })], access, graph, "block"), "2026-09-03T00:00:00.000Z");
  assert.equal(memoryExpiry([source()], { ...access, enrollmentExpiresAt: "2026-09-03T01:00:00Z" }, graph, "block"), "2026-09-03T01:00:00.000Z");
});

test("live source hashes, versions, access and every fence are rechecked", () => {
  const { source, access, graph, record } = memoryFixture();
  const item = record();
  for (const patch of [{ revision: "r2" }, { contentHash: hashMemoryText("Changed under the same content reference") },
    { scopeId: "sibling-block" }, { lineageId: "changed" }, { sequence: 2 }, { origin: "assistant" }, { independentEvidence: false }]) {
    assert.equal(memoryRecordEligible(item, sourceMap(source(patch)), access, graph), false, JSON.stringify(patch));
  }
  for (const field of ["permission", "erasure", "policy", "ancestry"]) {
    assert.equal(memoryRecordEligible(item, sourceMap(source()), { ...access, fence: { ...access.fence, [field]: 2 } }, graph), false, field);
  }
  assert.equal(memoryRecordEligible(item, sourceMap(), access, graph), false);
});

test("forgetting blocks paraphrase, parent promotion, copied lineage and reindex resurrection", () => {
  const { source, access, graph, record } = memoryFixture();
  const original = record(), { record: tombstone, suppression } = forgetMemory(original);
  assert.equal(tombstone.body, "");
  assert.equal(memoryRecordEligible(tombstone, sourceMap(source()), access, graph), false);
  for (const scopeId of ["block", "document", "project"]) {
    const rebuilt = record({ id: "new-memory", claimKey: "rephrased-claim", scopeId });
    assert.equal(memoryRecordEligible(rebuilt, sourceMap(source()), { ...access, targetScopeId: "other-document" }, graph, [suppression]), false, scopeId);
  }
  const copied = source({ id: "copy", sequence: 2, scopeId: "other-block", origin: "copy", lineageId: source().lineageId });
  const copyRecord = record({ id: "copy-memory", sources: [copied], scopeId: "other-block" });
  assert.equal(memoryRecordEligible(copyRecord, sourceMap(copied), access, graph, [suppression]), false);
  assert.equal(memoryRecordEligible(copyRecord, sourceMap(copied), { ...access, targetScopeId: "other-block" }, graph, [suppression]), false);
  assert.equal(memoryRecordEligible(original, sourceMap(source()), access, graph, [{ ...suppression, state: "revoked" }]), true);
  const unrelated = source({ id: "unrelated", sequence: 3, scopeId: "other-block" });
  assert.equal(memoryRecordEligible(record({ sources: [unrelated], scopeId: "other-block", claimKey: "another-claim" }), sourceMap(unrelated), { ...access, targetScopeId: "other-block" }, graph, [suppression]), true);
});

test("high inferred confidence neither changes authority nor supplies a missing grant", () => {
  const { source, access, graph, record } = memoryFixture();
  const item = record({ kind: "workflow-pattern", confidence: 1 });
  assert.equal(item.authority, "inferred");
  assert.equal(memoryRecordEligible(item, sourceMap(source()), { ...access, grants: [] }, graph), false);
  const assisted = record({ sources: [source({ origin: "assistant", independentEvidence: false })] });
  assert.equal(assisted.lastIndependentEvidenceAt, null);
});

test("large source sets are rejected before expansion; identical source IDs are not multiplied", () => {
  const { source, access, graph, record } = memoryFixture();
  const sources = Array(100_000).fill(source());
  assert.equal(memoryExpiry(sources, access, graph, "block"), null);
  assert.equal(record({ sources }), null);
  assert.equal(record({ sources: [source(), source()] }), null);
});

test("document siblings are local, nested-project descendants are project context, org memory is broad", () => {
  const { graph } = memoryFixture();
  for (const [current, candidate, expected] of [
    ["block", "block", "local"], ["block", "sibling-block", "local"], ["block", "document", "local"],
    ["block", "artifact", "local"], ["block", "other-document", "project"], ["block", "project", "project"],
    ["project", "document", "project"], ["block", "organization", "broad"],
  ]) assert.equal(memoryLocality(graph, "org:alpha", current, candidate), expected, `${current} → ${candidate}`);
});

test("memory content fingerprints are stable UTF-8 SHA-256 receipts", async () => {
  assert.equal(await memoryDigest("Forma 語 🌿"), hashMemoryText("Forma 語 🌿"));
});
