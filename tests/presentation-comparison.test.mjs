import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { digest, loadFixtureCases, representativeEditorCase, prepareStage, verifyManifest, bindNativeCase, runApprovedStage, fileStageAdmitter, CAPS } from "../scripts/presentation-comparison.mjs";
import { preparePresentationComparisonRequest, assessStoredPresentationCandidate } from "../worker/openai-adapter.ts";
import { slideCopyIssues } from "../src/model/document-artifacts.ts";

// Every response/authority/receipt below is test-authored. No provider, native artifact, or live authorization is represented.
const revision = "7eb914d".padEnd(40, "0");
const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = () => { throw new Error("network_forbidden_in_comparison_tests"); }; });
test.after(() => { globalThis.fetch = originalFetch; });
const cases = await loadFixtureCases();
cases.E = representativeEditorCase(cases.E); cases.M = representativeEditorCase(cases.M);
const composition = await prepareStage({ stage: "C", cases, actorId: "synthetic-test-actor", commonEffort: "medium", selectionReceiptRef: "test-only-common-effort-not-a-paid-result", codeRevision: revision });
const rehash = manifest => { const { digest: ignored, ...body } = manifest; return { ...body, digest: digest(body) }; };
async function environment(context, manifest = composition) {
  const home = await mkdtemp(join(tmpdir(), "forma-comparison-offline-test-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const now = Date.now();
  const approval = { manifestDigest: manifest.digest, stage: manifest.stage, maximumMicrousd: manifest.ceilingMicrousd, approvalRef: "test-only-approval", deadlineAt: now + 60_000, applicationReservationMicrousd: manifest.totalMaximumMicrousd, ledger: { receiptRef: "test-only-original-budget", asOf: now, budgetMicrousd: 30_000_000, entries: [{ receiptRef: "test-charge", kind: "charged", microusd: 9_405_443 }, { receiptRef: "test-unresolved-original-holds", kind: "unresolved", microusd: 2_000_000 }] } };
  const directory = join(home, "run");
  return { home, directory, manifest, approval, authorityStillCurrent: async () => true, admitStage: fileStageAdmitter(join(home, "canonical-account-ledger")) };
}
function responseFor(request, bodyPatch = {}) {
  const wire = JSON.parse(request.requestBody), input = JSON.parse(wire.input), id = input.production.page.global_start_index === 0 ? "E" : "M";
  return { status: 200, httpRequestId: `req_mock_${request.clientRequestId}`, bodyText: JSON.stringify({ id: `resp_mock_${request.clientRequestId}`, model: wire.model, status: "completed", service_tier: "default", output_text: cases[id].baselineCandidateRaw, usage: { input_tokens: 1000, output_tokens: 1000, total_tokens: 2000 }, ...bodyPatch }) };
}

test("offline composition freezes real page/source builders, exact matrices, caps and shared input digests", async () => {
  const a = await prepareStage({ stage: "A", cases, actorId: "synthetic-test-actor", codeRevision: revision });
  assert.equal(a.cases.N.companionOnly, true); assert.equal(a.totalMaximumMicrousd, 1_376_000); assert.equal(a.ceilingMicrousd, 1_500_000);
  assert.deepEqual(a.arms.map(arm => [arm.model, arm.effort]), [["gpt-5.6-terra", "medium"], ["gpt-5.6-terra", "high"], ["gpt-5.6-sol", "medium"], ["gpt-5.6-sol", "high"]]);
  for (const manifest of [a, composition]) { verifyManifest(manifest); assert.equal(manifest.paidOperations, 0); for (const arm of manifest.arms) assert.ok(arm.completeWireInputBound <= 64_000); }
  assert.equal(composition.totalMaximumMicrousd, 1_536_000);
  for (const [id, start, count] of [["E", 0, 8], ["M", 16, 7]]) {
    const arm = composition.arms.find(value => value.caseId === id), request = JSON.parse(arm.requestBody), input = JSON.parse(request.input);
    assert.equal(arm.maximumOutputTokens, CAPS[id]); assert.equal(input.production.page.global_start_index, start); assert.equal(input.production.assigned_scenes.length, count);
    assert.ok(composition.cases[id].pageAnchorMap.length); assert.equal(new Set(composition.arms.filter(value => value.caseId === id).map(value => value.comparisonDigest)).size, 1);
  }
  assert.equal(composition.cases.M.priorContextProvenance, "synthetic-source-derived-not-paid");
});

test("editor-only preparation sends one complete fixed candidate through actual validation-repair, never a paid prerequisite", async () => {
  for (const id of ["E", "M"]) {
    const entry = cases[id], baseline = JSON.parse(entry.baselineCandidateRaw), candidate = JSON.parse(entry.candidateRaw);
    assert.deepEqual(assessStoredPresentationCandidate(entry.baselineCandidateRaw, entry.snapshot, entry.options).issues, []);
    assert.equal(candidate.items.flatMap(slideCopyIssues).length, 1);
    baseline.items[3].slide.visual.value = baseline.items[3].body; assert.deepEqual(candidate, baseline);
    assert.equal(entry.controlledDefect.globalSlide, id === "E" ? 4 : 20);
  }
  for (const effort of ["medium", "high"]) {
    const manifest = await prepareStage({ stage: "D", cases, actorId: "synthetic-test-actor", commonEffort: effort, selectionReceiptRef: "test-only-editor-selection", codeRevision: revision });
    verifyManifest(manifest);
    for (const arm of manifest.arms) {
      assert.equal(arm.phase, "validation-repair"); assert.equal(arm.candidateIssues.length, 1); assert.equal(arm.candidateIssues[0].code, "duplicate_slide_copy");
      assert.equal(JSON.parse(JSON.parse(arm.requestBody).input).original_artifact, cases[arm.caseId].candidateRaw);
      assert.ok(arm.completeWireInputBound <= 64_000);
    }
  }
});

test("preparation refuses incomplete, wrong-source, no-defect and callback-bearing editor candidates", async () => {
  const entry = cases.E, input = { documentTitle: entry.documentTitle, snapshot: entry.snapshot, options: entry.options };
  for (const raw of ["", "{", JSON.stringify({ title: "incomplete", items: [] }), entry.baselineCandidateRaw]) await assert.rejects(preparePresentationComparisonRequest({}, "synthetic-test-actor", input, raw));
  const wrong = JSON.parse(entry.candidateRaw); wrong.items[0].slide.source_ids = ["unknown-source"]; wrong.items[0].slide.citations[0].source_id = "unknown-source";
  await assert.rejects(preparePresentationComparisonRequest({}, "synthetic-test-actor", input, JSON.stringify(wrong)), /candidate_source_invalid/);
  await assert.rejects(preparePresentationComparisonRequest({}, "synthetic-test-actor", { ...input, options: { ...input.options, onProviderSubmission() { throw new Error("must never run"); } } }), /cloned/);
  await assert.rejects(prepareStage({ stage: "B", cases, actorId: "synthetic-test-actor", codeRevision: revision }), /candidate_unbound/);
});

test("native identity requires byte-derived snapshot digest and a fixed manual six-slide request", async () => {
  const source = cases.N, binding = { provenance: "authorized-private-native-source", actorId: "synthetic@example.invalid", actorBindingKind: "authenticated-email", documentId: "test-only-not-native", sourceRevision: "test-revision", sourceHash: digest(source.snapshot), snapshotDigest: digest(source.snapshot), authorityReceiptRef: "test-only-not-authorization", documentTitle: source.documentTitle, snapshot: source.snapshot, options: { ...source.options, itemCount: 6, requestedSlideCount: 6 } };
  const entry = bindNativeCase(binding, digest(binding)); assert.equal(entry.actorBindingKind, "authenticated-email");
  for (const changed of [{ ...binding, snapshotDigest: "wrong" }, { ...binding, sourceHash: "0".repeat(64) }, { ...binding, sourceHash: "not-a-hash" }, { ...binding, options: { ...binding.options, requestedSlideCount: 7 } }, { ...binding, options: { ...binding.options, productionMode: "managed" } }, { ...binding, options: { ...binding.options, productionMode: "unrecognized-mode" } }]) assert.throws(() => bindNativeCase(changed, digest(changed)));
  const manifest = await prepareStage({ stage: "A", cases: { N: entry }, actorId: binding.actorId, codeRevision: revision }); verifyManifest(manifest);
  const mutated = structuredClone(manifest); mutated.cases.N.snapshot.facts.pop(); assert.throws(() => verifyManifest(rehash(mutated)), /binding_mismatch/);
});

test("rehashing cannot weaken stage matrix, phase, caps, fixed candidate or pricing allowlist", async () => {
  const editor = await prepareStage({ stage: "D", cases, actorId: "synthetic-test-actor", commonEffort: "medium", selectionReceiptRef: "test-only-selection", codeRevision: revision });
  const mutations = [m => { m.arms[0].id = "different"; }, m => { m.arms[0].phase = "editorial-rewrite"; }, m => { m.arms[0].maximumMicrousd = 0; }, m => { m.arms[0].maximumInputTokens = 1; }, m => { m.pricingVersion = "unknown"; }, m => { m.arms[0].model = "gpt-unknown"; }];
  for (const mutate of mutations) { const m = structuredClone(composition); mutate(m); assert.throws(() => verifyManifest(rehash(m))); }
  const m = structuredClone(editor); m.cases.E.candidateRaw = "{}"; assert.throws(() => verifyManifest(rehash(m)), /candidate_changed/);
});

test("each serial call has durable pending and its own raw/financial terminal before the next arm", async context => {
  const env = await environment(context); let calls = 0;
  const result = await runApprovedStage({ ...env, transport: async request => {
    const files = await readdir(env.directory);
    assert.equal(files.filter(name => name.endsWith(".pending.json")).length, calls + 1);
    assert.equal(files.filter(name => name.endsWith(".financial.json")).length, calls);
    assert.equal(files.filter(name => name.endsWith(".terminal.json")).length, calls);
    calls++; return responseFor(request);
  } });
  assert.equal(calls, 4); assert.equal(result.state, "completed"); assert.equal(result.costMicrousd, 76_000);
  assert.deepEqual(result.receipts.map(receipt => receipt.costMicrousd), [14_000, 24_000, 14_000, 24_000]);
  for (const receipt of result.receipts) { assert.equal(receipt.pricingReceipt.model, receipt.model); assert.equal(receipt.nativeViewerInspected, false); assert.equal(receipt.effectiveEffort, undefined); }
});

test("an ambiguous dispatch keeps its claim and pending hold and cannot replay in another directory", async context => {
  const env = await environment(context); let calls = 0;
  await assert.rejects(runApprovedStage({ ...env, transport: async () => { calls++; throw new Error("mock lost response"); } }), /submission_unknown/);
  const pending = (await readdir(env.directory)).find(name => name.endsWith(".pending.json")); assert.ok(pending);
  assert.ok(JSON.parse(await readFile(join(env.directory, pending), "utf8")).reservedMicrousd > 0);
  await assert.rejects(runApprovedStage({ ...env, directory: join(env.home, "different-run"), transport: async request => { calls++; return responseFor(request); } }), /approval_already_consumed/);
  assert.equal(calls, 1);
});

test("unknown models, malformed usage and incomplete response stop after one call without inventing zero cost", async context => {
  for (const patch of [{ model: "unknown" }, { usage: { input_tokens: 1 } }, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }]) {
    const env = await environment(context); let calls = 0;
    const result = await runApprovedStage({ ...env, transport: async request => { calls++; return responseFor(request, patch); } });
    assert.equal(calls, 1); assert.equal(result.state, "stopped");
    const receipt = result.receipts[0];
    if (patch.status) { assert.equal(receipt.state, "priced"); assert.equal(receipt.costMicrousd, 14_000); assert.match(receipt.stopReason, /incomplete/); }
    else { assert.equal(receipt.state, "operator_required"); assert.equal(receipt.costMicrousd, undefined); assert.equal(receipt.holdRetainedMicrousd, 275_200); }
    assert.ok((await readdir(env.directory)).some(name => name.endsWith(".response-meta.json")));
  }
});

test("known overrun usage is priced and persisted in full before stopping, never clipped to allowance", async context => {
  const env = await environment(context); let calls = 0;
  const result = await runApprovedStage({ ...env, transport: async request => { calls++; return responseFor(request, { usage: { input_tokens: 64_001, output_tokens: 12_000, total_tokens: 76_001 } }); } });
  assert.equal(calls, 1); const receipt = result.receipts[0]; assert.equal(receipt.state, "priced"); assert.match(receipt.stopReason, /exceeds_admission/);
  assert.equal(receipt.pricingReceipt.usage.inputTokens, 64_001); assert.equal(receipt.pricingReceipt.usage.outputTokens, 12_000);
  const financialFile = (await readdir(env.directory)).find(name => name.endsWith(".financial.json"));
  assert.equal(JSON.parse(await readFile(join(env.directory, financialFile), "utf8")).costMicrousd, receipt.costMicrousd);
});

test("original $30 exposure, application floors, explicit contingency and immutable input guard paid admission", async context => {
  for (const mutate of [a => { a.ledger.entries[0].microusd = null; }, a => { a.ledger.entries[0].microusd = 25_000_000; }, a => { a.applicationReservationMicrousd = 4_000_000; }, a => { a.contingencyMicrousd = 0; }]) {
    const env = await environment(context); mutate(env.approval); let calls = 0;
    await assert.rejects(runApprovedStage({ ...env, transport: async () => { calls++; } })); assert.equal(calls, 0);
  }
  const env = await environment(context); const mutable = structuredClone(composition), expectedBody = mutable.arms[0].requestBody;
  let calls = 0;
  const result = await runApprovedStage({ ...env, manifest: mutable, authorityStillCurrent: async manifest => { assert.ok(Object.isFrozen(manifest.arms[0])); mutable.arms[0].requestBody = "tampered"; return true; }, transport: async request => { if (calls++ === 0) assert.equal(request.requestBody, expectedBody); return responseFor(request); } });
  assert.equal(result.state, "completed");
  const a = await prepareStage({ stage: "A", cases, actorId: "synthetic-test-actor", codeRevision: revision }), other = await environment(context, a);
  await assert.rejects(runApprovedStage({ ...other, transport: async () => { throw new Error("forbidden"); } }), /native_source_required/);
});

test("deadline or authority change after pending retains canonical claim without HTTP or retry", async context => {
  const env = await environment(context); let checks = 0, calls = 0;
  await assert.rejects(runApprovedStage({ ...env, authorityStillCurrent: async () => ++checks < 3, transport: async () => { calls++; } }), /pending_dispatch_guard/);
  assert.equal(calls, 0); assert.equal((await readdir(env.directory)).filter(name => name.endsWith(".pending.json")).length, 1);
  await assert.rejects(runApprovedStage({ ...env, directory: join(env.home, "retry"), transport: async () => { calls++; } }), /approval_already_consumed/);
  assert.equal(calls, 0);
});


test("an awaited true authority barrier cannot dispatch after the approved deadline", async context => {
  const env = await environment(context); let clock = Date.now(), calls = 0;
  await assert.rejects(runApprovedStage({ ...env, now: () => clock, authorityStillCurrent: async (_manifest, approval, gate) => {
    if (gate.phase === "before-dispatch") { await Promise.resolve(); clock = approval.deadlineAt + 1; }
    return true;
  }, transport: async () => { calls++; } }), /pending_dispatch_guard/);
  assert.equal(calls, 0);
  assert.equal((await readdir(env.directory)).filter(name => name.endsWith(".pending.json")).length, 1);
  assert.equal((await readdir(join(env.home, "canonical-account-ledger"))).filter(name => name.endsWith(".claim.json")).length, 1);
});

test("retained response bytes and priced evidence cannot diverge through mutable transport data", async context => {
  const env = await environment(context); const result = await runApprovedStage({ ...env, transport: async request => {
    const response = responseFor(request);
    setImmediate(() => { response.bodyText = JSON.stringify({ model: "mutated-after-return" }); response.status = 500; response.httpRequestId = "changed"; });
    return response;
  } });
  assert.equal(result.state, "completed");
  for (const receipt of result.receipts) {
    const retained = await readFile(join(env.directory, receipt.rawResponseRef), "utf8");
    assert.equal(digest(retained), receipt.rawResponseDigest); assert.equal(JSON.parse(retained).model, receipt.effectiveModel);
    assert.notEqual(receipt.httpRequestId, "changed");
  }
});

test("local quality decoder failure preserves the already durable own financial receipt", async context => {
  const env = await environment(context); let calls = 0;
  const result = await runApprovedStage({ ...env, transport: async request => { calls++; return responseFor(request, { output_text: { malformed: true } }); } });
  assert.equal(calls, 1); assert.equal(result.receipts[0].state, "priced"); assert.equal(result.receipts[0].costMicrousd, 14_000);
  assert.match(result.receipts[0].stopReason, /local_validation_failed/);
  assert.equal((await readdir(env.directory)).filter(name => name.endsWith(".financial.json")).length, 1);
});
