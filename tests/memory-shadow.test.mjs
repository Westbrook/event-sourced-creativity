import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assembleMemoryShadow, MEMORY_SHADOW_CONTEXT_MAX_BYTES, planMemoryReview, publishMemoryReview } from "../worker/memory-shadow.ts";
import { ASSISTANT_CONTEXT_LIMITS } from "../src/model/conversation-context.ts";
import { normalizeMemoryObservation } from "../src/model/memory-observations.ts";
import { memoryKey, memorySourceRef } from "../src/model/scoped-memory.ts";
import { memoryFixture, sourceMap } from "./helpers/scoped-memory.mjs";

const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function shadowFixture(count = 2) {
  const f = memoryFixture();
  const observations = Array.from({ length: count }, (_, index) => normalizeMemoryObservation(f.receipt({ sequence: index + 1 }), f.access, f.graph));
  const sources = sourceMap(observations.map((observation) => observation.evidenceSource));
  const records = observations.map((observation, index) => f.record({ id: `memory-${index}`, body: "Chart labels stayed concise.", sources: [observation.evidenceSource] }));
  const context = { decisionAtoms: [{ id: "required", text: "Revenue  growth\nKeep this exact.", protected: true }], recentTurns: [], capabilities: ["read"] };
  const assembly = (overrides = {}) => assembleMemoryShadow({ mode: "shadow", context, query: "chart labels", records, sources, access: f.access, graph: f.graph, ...overrides });
  const reviewInput = (processed = {}, overrides = {}) => {
    const through = new Map(Object.entries(processed));
    for (const observation of observations) through.set(observation.streamId, Math.max(through.get(observation.streamId) ?? 0, observation.sequence));
    return { mode: "shadow", observations, sources, access: f.access, graph: f.graph, processed, recipeVersion: "shadow-v1", timeZone: "America/New_York",
      inventory: { complete: true, from: processed, through: Object.fromEntries(through), observationSources: observations.filter((observation) => observation.sequence > (processed[observation.streamId] ?? 0)).map((observation) => observation.source) }, ...overrides };
  };
  const publish = (plan, overrides = {}) => publishMemoryReview({ plan, processed: {}, successful: true, records, sources, access: f.access, graph: f.graph, ...overrides });
  return { ...f, observations, sources, records, context, assembly, reviewInput, publish };
}

test("disabled mode returns the exact current context without inspecting sources, grants or candidates", async () => {
  const context = { existing: "unchanged" };
  const input = { context, get records() { throw new Error("Must not read candidates"); }, get access() { throw new Error("Must not read access"); } };
  assert.deepEqual(assembleMemoryShadow(input), { context, status: "disabled" });
  assert.equal(assembleMemoryShadow(input).context, context);
  assert.deepEqual(await planMemoryReview({ get observations() { throw new Error("No work"); } }), { status: "disabled" });
});

test("shadow activation is synthetic-only and never replaces the live context", () => {
  const f = shadowFixture();
  const before = structuredClone(f.context);
  const result = f.assembly();
  assert.equal(result.status, "shadow");
  assert.equal(result.context, f.context);
  assert.deepEqual(result.context, before);
  assert.equal(result.preview.current, f.context);
  assert.equal(result.preview.memory.treatment, "untrusted-historical-evidence");
  assert.equal(result.retrieval, "lexical-baseline");
  assert.equal(f.assembly({ access: { ...f.access, environment: "production" } }).status, "blocked");
  assert.equal(MEMORY_SHADOW_CONTEXT_MAX_BYTES, ASSISTANT_CONTEXT_LIMITS.maxBytes);
});

test("UTF-8 and JSON escaping count toward the complete envelope, without evicting protected context", () => {
  const f = shadowFixture(1);
  const record = f.record({ body: 'chart 語🌿 "quoted"\n'.repeat(260), sources: [f.observations[0].evidenceSource] });
  assert.ok(record);
  const context = { ...f.context, extraRequiredText: "必".repeat(3_000) };
  const before = structuredClone(context);
  const result = f.assembly({ context, records: [record] });
  assert.equal(result.status, "shadow");
  assert.ok(jsonBytes(result.preview) <= 16_384);
  assert.equal(result.bytes, jsonBytes(result.preview));
  assert.deepEqual(context, before);
  assert.deepEqual(result.preview.current.decisionAtoms, before.decisionAtoms);
  const impossible = f.assembly({ context: { required: "語".repeat(6_000) } });
  assert.equal(impossible.reason, "current-context-over-budget");
  assert.equal(impossible.preview, undefined);
});

test("authorization runs before any stale private body is inspected or ranked", () => {
  const f = shadowFixture(1);
  const record = { ...f.records[0] };
  Object.defineProperty(record, "body", { get() { throw new Error("Ineligible body was read"); } });
  const source = f.observations[0].evidenceSource;
  const result = f.assembly({ records: [record], sources: sourceMap({ ...source, state: "erased" }) });
  assert.equal(result.status, "shadow");
  assert.deepEqual(result.preview.memory.items, []);
  assert.deepEqual(result.references, []);
});

test("document-local evidence outranks broad matches, broad bytes are capped, and source lineage is deduplicated", () => {
  const f = shadowFixture(1);
  const broadSource = f.source({ id: "org-event", scopeId: "organization", sequence: 3 });
  const siblingSource = f.source({ id: "sibling-event", scopeId: "sibling-block", sequence: 4 });
  const records = [f.record({ id: "broad", scopeId: "organization", body: "Chart labels chart labels.", sources: [broadSource] }),
    f.record({ id: "sibling", scopeId: "sibling-block", body: "Chart labels.", sources: [siblingSource] }), f.records[0], { ...f.records[0], id: "same-lineage" }];
  const result = f.assembly({ records, sources: sourceMap([...f.sources.values()], broadSource, siblingSource) });
  assert.equal(result.preview.memory.items[0].locality, "local");
  assert.ok(result.preview.memory.items.filter((item) => item.locality === "broad").reduce((sum, item) => sum + jsonBytes(item), 0) <= 409);
  assert.equal(result.references.filter((item) => item.sourceIds.includes(f.observations[0].eventId)).length, 1);
  const providerView = JSON.stringify(result.preview.memory);
  assert.equal(providerView.includes("org:alpha"), false);
  assert.equal(providerView.includes("org-event"), false);
});

test("nonmatching records are not misreported as lexical recall; rewriting does not refresh old evidence", () => {
  const f = shadowFixture(1);
  assert.deepEqual(f.assembly({ query: "quarterly revenue" }).preview.memory.items, []);
  const older = f.source({ id: "older", happenedAt: "2026-08-25T00:00:00.000Z", sequence: 3 });
  const records = [f.record({ id: "old-rewrite", body: "Chart labels.", sources: [older] }), f.records[0]];
  assert.equal(f.assembly({ records, sources: sourceMap([...f.sources.values()], older) }).references[0].recordId, f.records[0].id);
});

test("nightly admission requires new human work, enrollment and a complete source interval", async () => {
  const f = shadowFixture();
  assert.equal((await planMemoryReview(f.reviewInput())).status, "planned");
  assert.equal((await planMemoryReview(f.reviewInput({}, { inventory: undefined }))).reason, "incomplete-source-interval");
  assert.equal((await planMemoryReview(f.reviewInput({}, { observations: [f.observations[1]] }))).reason, "incomplete-source-interval");
  assert.equal((await planMemoryReview(f.reviewInput({}, { access: { ...f.access, enabled: false } }))).status, "blocked");
  assert.equal((await planMemoryReview(f.reviewInput({}, { access: { ...f.access, environment: "production" } }))).status, "blocked");
  assert.equal((await planMemoryReview(f.reviewInput({ "creative:alice": 2 }))).status, "no-activity");
  assert.equal((await planMemoryReview(f.reviewInput({}, { observations: f.observations.map((row) => ({ ...row, humanActivity: false })) }))).status, "no-activity");
});

test("night windows handle DST, invalid-zone fallback and daytime exclusion", async () => {
  const f = shadowFixture(1);
  assert.equal((await planMemoryReview(f.reviewInput({}, { access: { ...f.access, now: "2026-09-02T16:00:00.000Z" } }))).status, "outside-window");
  const invalid = await planMemoryReview(f.reviewInput({}, { timeZone: "not/a-zone", access: { ...f.access, now: "2026-09-02T02:00:00.000Z" } }));
  assert.equal(invalid.status, "planned");
  assert.equal(invalid.timeZone, "UTC");
  assert.equal(invalid.usedTimeZoneFallback, true);
  // Both occurrences of a repeated local hour produce the same admission identity.
  const source = f.observations[0].evidenceSource;
  const laterSource = { ...source, happenedAt: "2026-10-31T12:00:00.000Z", expiresAt: "2026-11-20T00:00:00.000Z" };
  f.observations[0] = { ...f.observations[0], source: memorySourceRef(laterSource), evidenceSource: laterSource, happenedAt: laterSource.happenedAt, expiresAt: laterSource.expiresAt };
  const access = { ...f.access, now: "2026-11-01T05:30:00.000Z", enrollmentExpiresAt: "2026-12-01T00:00:00.000Z",
    grants: f.access.grants.map((grant) => ({ ...grant, expiresAt: "2026-12-01T00:00:00.000Z" })) };
  const first = await planMemoryReview(f.reviewInput({}, { access, sources: sourceMap(laterSource) }));
  const second = await planMemoryReview(f.reviewInput({}, { access: { ...access, now: "2026-11-01T06:30:00.000Z" }, sources: sourceMap(laterSource) }));
  assert.equal(first.status, "planned");
  assert.equal(second.plan.id, first.plan.id);
});

test("plan identity is independent of input order and retries, but bound to recipe and epochs", async () => {
  const f = shadowFixture();
  const first = await planMemoryReview(f.reviewInput());
  const reordered = await planMemoryReview(f.reviewInput({}, { observations: [...f.observations].reverse(), sources: new Map([...f.sources].reverse()) }));
  assert.equal(first.plan.id, reordered.plan.id);
  const nextNight = await planMemoryReview(f.reviewInput({}, { access: { ...f.access, now: "2026-09-03T06:00:00.000Z" } }));
  assert.equal(nextNight.plan.id, first.plan.id);
  assert.notEqual((await planMemoryReview(f.reviewInput({}, { recipeVersion: "shadow-v2" }))).plan.id, first.plan.id);
});

test("publication advances only its captured per-stream cutoff; retries and failures do not advance", async () => {
  const f = shadowFixture(1);
  const { plan } = await planMemoryReview(f.reviewInput());
  const future = f.source({ id: "future", sequence: 2 });
  f.sources.set(memoryKey(future.custodianId, future.id), future);
  const success = await f.publish(plan);
  assert.equal(success.published, true);
  assert.deepEqual(success.processed, { "creative:alice": 1 });
  assert.equal((await f.publish(plan, { processed: success.processed })).published, false);
  const failed = await f.publish(plan, { successful: false });
  assert.deepEqual(failed.processed, {});
  assert.equal((await f.publish(plan, { records: [f.record({ sources: [future] })] })).published, false, "future dependencies were not captured");
});

test("cross-stream sequence numbers never share one global watermark", async () => {
  const f = shadowFixture(1);
  const receipt = f.receipt({ sequence: 100, source: { id: "other-stream-event", streamId: "project-ledger:1" } });
  const observation = normalizeMemoryObservation(receipt, f.access, f.graph);
  f.observations.push(observation); f.sources.set(memoryKey(observation.custodianId, observation.eventId), observation.evidenceSource);
  const { plan } = await planMemoryReview(f.reviewInput());
  assert.deepEqual(plan.through, { "creative:alice": 1, "project-ledger:1": 100 });
  assert.equal((await f.publish(plan)).published, true);
});

test("revocation, source correction, forget fences and async-hash races block publication", async () => {
  for (const change of ["revoke", "hash", "fence", "during-hash"]) {
    const f = shadowFixture(1), { plan } = await planMemoryReview(f.reviewInput());
    const source = f.observations[0].evidenceSource;
    const revoke = () => f.sources.set(memoryKey(source.custodianId, source.id), { ...source, state: "revoked" });
    if (change === "revoke") revoke();
    if (change === "hash") f.sources.set(memoryKey(source.custodianId, source.id), { ...source, contentHash: "f".repeat(64) });
    if (change === "fence") f.access.fence.erasure += 1;
    const pending = f.publish(plan, { records: [] });
    if (change === "during-hash") revoke();
    assert.equal((await pending).published, false, change);
  }
});

test("an admitted retry can resume outside the night window without new human work", async () => {
  const f = shadowFixture(1), { plan } = await planMemoryReview(f.reviewInput());
  const resumed = await planMemoryReview(f.reviewInput({}, { pending: plan, observations: [], access: { ...f.access, now: "2026-09-02T16:00:00.000Z" } }));
  assert.equal(resumed.status, "resume");
  assert.equal(resumed.plan.id, plan.id);
  assert.equal((await planMemoryReview(f.reviewInput({}, { pending: plan, recipeVersion: "changed" }))).status, "blocked");
});

test("a frozen source receipt cannot be swapped after a plan is admitted", async () => {
  const f = shadowFixture(1), { plan } = await planMemoryReview(f.reviewInput());
  const source = f.observations[0].evidenceSource;
  const altered = { ...source, revision: "r2" };
  plan.sources = [memorySourceRef(altered)];
  f.sources.set(memoryKey(altered.custodianId, altered.id), altered);
  assert.equal((await f.publish(plan, { records: [] })).published, false);
});

test("offline end-to-end evaluator runs without inherited credentials and matches its checked report", () => {
  const script = fileURLToPath(new URL("../scripts/evaluate-memory-shadow.mjs", import.meta.url));
  const report = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", script], { encoding: "utf8", env: {}, timeout: 10_000 }));
  const checked = JSON.parse(readFileSync(new URL("../docs/forma-memory-shadow-evaluation-2026-09-02.json", import.meta.url), "utf8"));
  assert.deepEqual(report, checked);
  assert.ok(report.normalizedInteractions.nonChat > report.normalizedInteractions.privateChat);
  assert.equal(report.conversation.continuous, true);
  assert.equal(report.review.replayAdmission, "no-activity");
  assert.equal(report.recall.forgottenLineagesExcluded, true);
  assert.equal(report.currentContextUnchanged, true);
});
