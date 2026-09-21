import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { registerOutputSourceImports, outputTestDatabase } from "./output-server-test-helpers.mjs";
import { coldProductionDatabase, outputSchema, outputMigration } from "./output-schema-test-helpers.mjs";
const hooks = registerOutputSourceImports();
const { ensureSchema, makeEvent, appendEvents } = await import("../worker/runtime.ts");
const { handleOutputRequirements, inspectOutputTargetFile, rememberOutputPrivateBody, retainedOutputBodyAssertions, outputActiveSourceDeadlineAssertions, loadOutputCurrentContext, prepareOutputExecutionProof } = await import("../worker/output-requirements-api.ts");
const { parseOutputRequirement } = await import("../src/model/output-requirements.ts");
const { png, presentationEntries, zip, readStoredZip, wav } = await import("./output-asset-fixtures.mjs");
const { ownedSocialVideo } = await import("./output-social-asset-fixtures.mjs");
const { inspectOutputAsset } = await import("../src/model/output-asset-inspection.ts");
const { extractSourceDocument, sourceDocumentEvidence, sourceDocumentEvidenceDigest } = await import("../src/model/source-documents.ts");
const { ownerMediaNamespace } = await import("../src/model/media-ownership.ts");
const { reconcileOutputAssetStorage } = await import("../worker/output-asset-storage-control.ts");
const { outputAssertionStatements } = await import("../worker/output-requirements-ledger.ts");
hooks.deregister();
const originalFetch = globalThis.fetch;
let providerDispatches = 0;
test.before(() => { globalThis.fetch = async () => { providerDispatches++; throw new Error("network_provider_sentinel"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(providerDispatches, 0); });

const base = "/api/output-requirements", doc = "test-document", project = "test-project", owner = "dev-local-creative";
const sourceStatus = (snapshot) => ({ status: snapshot.sourceVerification.status, reasonCodes: snapshot.sourceVerification.reasonCodes });
const unpack = async (response) => {
  assert.equal(response.status, 200, await response.clone().text());
  const files = readStoredZip(new Uint8Array(await response.arrayBuffer()));
  return { files, manifest: JSON.parse(new TextDecoder().decode(files.get("manifest.json"))), csv: new TextDecoder().decode(files.get("manifest.csv")) };
};
async function fixture(options = {}) {
  const state = options.productionMigrations ? coldProductionDatabase() : outputTestDatabase();
  if (options.productionMigrations) state.sqlite.exec(outputMigration);
  else await ensureSchema(state.env);
  const initialOutputSchema = options.productionMigrations ? outputSchema(state.sqlite) : null;
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)").run(owner, "creative@local.forma", "Local creative", now, now, now);
  if (options.productionMigrations) {
    // Exercise the normal HTTP bootstrap before authored events exist. It may
    // install the legacy event-stage trigger, but cannot repair Output schema.
    const first = await handleOutputRequirements(new Request(`http://localhost${base}?documentId=${doc}`), state.env, base, { waitUntil() { throw new Error("unexpected_background_work"); } });
    assert.equal(first.status, 404, await first.clone().text());
    assert.deepEqual(outputSchema(state.sqlite), initialOutputSchema);
  }
  await appendEvents(state.env, [
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "seed", "ProjectCreated", { project_id: project, name: "Private output tests" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "seed", "DocumentCreated", { project_id: project, document_id: doc, title: "Output acceptance tests", handle: "output-tests" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "seed", "BlockCreated", { project_id: project, document_id: doc, block_id: "source", scope: "document", type: "direction", position: "a0", handle: "direction/source", properties: { text: "An authored research source with no invented claims.", authority: "authored", weight: 1 } }),
  ]);
  const execution = { waitUntil(promise) { throw new Error(`unexpected_background_work:${promise}`); } };
  const send = (path = `${base}?documentId=${doc}`, options = {}) => handleOutputRequirements(new Request(`http://localhost${path}`, options), state.env, path.split("?")[0], execution);
  let key = 0;
  async function snapshot() { const response = await send(); assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
  async function command(body, expectedStatus = 200) {
    const current = await snapshot();
    const response = await send(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: doc, clientMutationId: `mutation-${++key}`, expectedRevision: current.revision, ...body }) });
    assert.equal(response.status, expectedStatus, await response.clone().text());
    return response.json();
  }
  async function upload(bytes, name = "owned-image.png", expectedStatus = 200) {
    const current = await snapshot();
    const response = await send(`${base}/assets?documentId=${doc}`, { method: "POST", headers: { "content-type": "image/png", "x-output-filename": encodeURIComponent(name), "x-output-rights-confirmed": "true", "x-output-expected-revision": current.revision, "x-output-client-mutation-id": `upload-${++key}` }, body: bytes });
    assert.equal(response.status, expectedStatus, await response.clone().text());
    return response.json();
  }
  return { ...state, send, snapshot, command, upload, initialOutputSchema };
}

function imageSpec(id = "images-output") {
  const spec = parseOutputRequirement({ id, Type: "Output", Subtype: "Social media image", Content: 'Output images at ratios "1:1", "4:5", and "16:9" optionally.' }).spec;
  for (const variant of spec.deliverables[0].format_variants) variant.quantity = { kind: "exact", unit: "image", value: 1 };
  return spec;
}
async function planFixture(options) {
  const state = await fixture(options), spec = imageSpec();
  await state.command({ action: "save", blockId: spec.id, spec });
  const confirmed = await state.command({ action: "confirm" });
  assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length, 3);
  assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.filter((target) => target.selected).length, 2);
  return { ...state, spec, plan: confirmed.snapshot.confirmedPlan };
}

test("original social image and video instructions deliver eight required files before an explicitly selected ninth", async (t) => {
  const state = await fixture({ productionMigrations: true });
  t.after(() => state.sqlite.close());
  const imageText = 'Output images at aspect ratios "1:1" Instagram and other carousels, "4:5" Meta at large, "9:16" shorts, reels, and TickTok, "16:9" YouTube recommendation thumbnails, "1.91:1" Facebook and X link preview cards';
  const videoText = 'Output videos at aspect ratios "9:16" for TickTok, "16:9" for YouTube, "4:5" for Facebook/Instagram feeds, and "1:1" optionally for additional Facebook usage.';
  const images = parseOutputRequirement({ id: "original-social-images", Type: "Output", Subtype: "Social media image", Content: imageText }).spec;
  const videos = parseOutputRequirement({ id: "original-social-videos", Type: "OUtput", Subtype: "Social media video", Content: videoText }).spec;
  const imageEntry = images.deliverables[0], videoEntry = videos.deliverables[0];
  const ratio = (value) => `${value.aspect_ratio.width}:${value.aspect_ratio.height}`;
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.deepEqual(imageEntry.format_variants.map(ratio), ["1:1", "4:5", "9:16", "16:9", "191:100"]);
  assert.deepEqual(videoEntry.format_variants.map(ratio), ["9:16", "16:9", "4:5", "1:1"]);
  assert.ok(imageEntry.format_variants.every((variant) => variant.required && variant.quantity.kind === "unknown"));
  assert.deepEqual(videoEntry.format_variants.map((variant) => variant.required), [true, true, true, false]);
  assert.ok(videoEntry.format_variants.every((variant) => variant.quantity.kind === "unknown"));
  assert.equal(videoEntry.content_quantity.kind, "unknown", "the prose does not supply a video duration");
  for (const spec of [images, videos]) await state.command({ action: "save", blockId: spec.id, spec });
  const assertOriginalWords = (snapshot) => {
    assert.equal(snapshot.requirements.find((row) => row.spec.id === images.id).spec.original_text, imageText);
    assert.equal(snapshot.requirements.find((row) => row.spec.id === videos.id).spec.original_text, videoText);
  };
  assertOriginalWords(await state.snapshot());
  // These are explicit test-author decisions, not inferred carousel membership
  // or a claim that the original prose supplied file counts or durations.
  for (const entry of [imageEntry, videoEntry]) for (const variant of entry.format_variants) {
    variant.quantity = { kind: "exact", unit: entry.media_kind, value: 1 };
    variant.value_origins.quantity = { kind: "confirmed", text: "Exactly one owned fixture file for this format; no inferred carousel members." };
  }
  videoEntry.content_quantity = { kind: "exact", unit: "second", value: 2 };
  videoEntry.value_origins.content_quantity = { kind: "confirmed", text: "Two seconds per owned fixture video, explicitly agreed for this test." };
  for (const spec of [images, videos]) await state.command({ action: "save", blockId: spec.id, spec });
  const confirmed = await state.command({ action: "confirm" }), plan = confirmed.snapshot.confirmedPlan;
  assertOriginalWords(confirmed.snapshot);
  assert.equal(plan.plan.targets.length, 9); assert.equal(plan.plan.obligations.length, 9);
  assert.ok(plan.plan.targets.every((target) => target.quantity.kind === "exact" && target.quantity.value === 1 && target.blocking_issues.length === 0));
  assert.ok(plan.plan.targets.filter((target) => target.media_kind === "video").every((target) => target.count_policy.kind === "exact" && target.count_policy.unit === "second" && target.count_policy.value === 2));
  const required = plan.plan.targets.filter((target) => target.required), optional = plan.plan.targets.find((target) => !target.required);
  assert.equal(required.filter((target) => target.media_kind === "image").length, 5);
  assert.equal(required.filter((target) => target.media_kind === "video").length, 3);
  assert.equal(optional.media_kind, "video"); assert.equal(ratio(optional), "1:1"); assert.equal(optional.selected, false);
  assert.equal(confirmed.snapshot.summary.required_obligations, 8); assert.equal(confirmed.snapshot.summary.optional_obligations, 1); assert.equal(confirmed.snapshot.summary.selected_optional_obligations, 0);
  const imageDimensions = { "1:1": [20, 20], "4:5": [16, 20], "9:16": [18, 32], "16:9": [32, 18], "191:100": [191, 100] };
  const fixtureFor = (target) => {
    const key = ratio(target), name = `social-${target.media_kind}-${key.replace(":", "x")}.${target.media_kind === "image" ? "png" : "mp4"}`;
    if (target.media_kind === "video") return { target, bytes: ownedSocialVideo(key), name };
    const [width, height] = imageDimensions[key], stride = width * 4 + 1, raw = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([40, 90, 180, 255], y * stride + 1 + x * 4);
    return { target, bytes: png({ width, height, raw }), name };
  };
  const receipts = new Map();
  const adoptAndReview = async (fixture, currentPlan) => {
    const uploaded = await state.upload(fixture.bytes, fixture.name), assetId = uploaded.command.assetId;
    const asset = uploaded.snapshot.assets.find((row) => row.id === assetId), inspected = asset.inspection;
    assert.equal(asset.sha256, digest(fixture.bytes)); assert.equal(inspected.sha256, asset.sha256);
    assert.equal(inspected.status, "inspected"); assert.equal(asset.available, true);
    assert.equal(asset.mimeType, fixture.target.media_kind === "video" ? "video/mp4" : "image/png", "owned bytes override the fixture upload's deliberately generic image/png header");
    assert.equal(inspected.facts.width * fixture.target.aspect_ratio.height, inspected.facts.height * fixture.target.aspect_ratio.width);
    if (fixture.target.media_kind === "video") {
      assert.equal(inspected.facts.durationSeconds, 2); assert.equal(inspected.facts.frameCount, 4); assert.equal(inspected.facts.durationBasis, "mp4-track-timeline");
      assert.ok(inspected.limitationCodes.includes("output_mp4_playback_review_required"));
    }
    const bound = await state.command({ action: "bind", planRevisionId: currentPlan.revisionId, targetId: fixture.target.id, assetId });
    const candidate = bound.snapshot.results.find((row) => row.id === bound.command.resultId);
    assert.equal(candidate.checksStatus, "passed"); assert.equal(candidate.review, "pending"); assert.equal(candidate.reviewAllowed, true);
    assert.notEqual(bound.snapshot.targetStates.find((row) => row.target_id === fixture.target.id).review, "accepted", "inspection and binding never invent approval");
    assert.equal(bound.snapshot.summary.delivery_ready, false);
    // Explicit reviewer input is exercised here. Synthetic color fixtures do
    // not prove decoded playback, narrative value, or an actual human review.
    const reviewed = await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
    const receipt = { ...fixture, assetId, sha256: asset.sha256, acceptanceId: reviewed.command.acceptanceId };
    receipts.set(fixture.target.id, receipt);
    return receipt;
  };
  const download = async (command) => {
    assert.equal(command.partCount, 1);
    const response = await state.send(command.downloadUrl);
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    assert.equal(response.headers.get("x-output-sha256"), digest(bytes));
    assert.equal(response.headers.get("content-type"), "application/zip");
    const packed = await unpack(response);
    assert.equal(response.headers.get("x-output-delivery-completion"), packed.manifest.deliveryStatus);
    assert.equal(packed.manifest.deliveryId, command.manifestId);
    return packed;
  };
  const assertExactFiles = (packed, targetIds) => {
    assert.equal(packed.manifest.files.length, targetIds.length); assert.equal(packed.files.size, targetIds.length + 2);
    assert.deepEqual(new Set(packed.manifest.targets.map((row) => row.targetId)), new Set(targetIds));
    for (const targetId of targetIds) {
      const receipt = receipts.get(targetId), mapping = packed.manifest.targets.find((row) => row.targetId === targetId);
      assert.equal(mapping.fileId, receipt.assetId); assert.equal(mapping.acceptanceId, receipt.acceptanceId);
      const file = packed.manifest.files.find((row) => row.id === mapping.fileId), bytes = packed.files.get(file.path);
      assert.equal(file.sha256, receipt.sha256); assert.equal(digest(bytes), receipt.sha256); assert.deepEqual(bytes, receipt.bytes);
      assert.equal(file.path, `files/${receipt.assetId}.${receipt.target.media_kind === "image" ? "png" : "mp4"}`);
      assert.equal(file.facts.width * receipt.target.aspect_ratio.height, file.facts.height * receipt.target.aspect_ratio.width);
      if (receipt.target.media_kind === "video") { assert.equal(file.facts.durationSeconds, 2); assert.equal(file.facts.frameCount, 4); }
      if (ratio(receipt.target) === "191:100") { assert.equal(file.facts.width, 191); assert.equal(file.facts.height, 100); }
    }
  };
  let partialCommand, partialManifest;
  for (const [index, target] of required.entries()) {
    await adoptAndReview(fixtureFor(target), plan);
    if (index === required.length - 2) {
      const snapshot = await state.snapshot();
      assert.equal(snapshot.summary.required_obligations, 8); assert.equal(snapshot.summary.fulfilled_required_obligations, 7); assert.equal(snapshot.summary.delivery_ready, false);
      await state.command({ action: "export", planRevisionId: plan.revisionId }, 409);
      partialCommand = (await state.command({ action: "export", planRevisionId: plan.revisionId, allowPartial: true })).command;
      const partial = await download(partialCommand); partialManifest = partial.manifest;
      assertExactFiles(partial, required.slice(0, -1).map((row) => row.id));
      assert.equal(partial.manifest.deliveryStatus, "partial"); assert.equal(partial.manifest.summary.owedTargets, 8); assert.equal(partial.manifest.summary.includedOwedTargets, 7);
      assert.equal(partial.manifest.scope.obligations.filter((row) => row.required && row.requirementId === images.id).length, 5);
      assert.equal(partial.manifest.scope.obligations.filter((row) => row.required && row.requirementId === videos.id).length, 3);
      assert.equal(partial.manifest.summary.optionalOffObligations, 1);
      assert.equal(partial.manifest.scope.targets.find((row) => row.id === optional.id).deliveryState, "optional_off");
      assert.equal(partial.manifest.missingWork.length, 1); assert.equal(partial.manifest.missingWork[0].targetId, required.at(-1).id); assert.equal(partial.manifest.missingWork[0].required, true);
      assert.ok(partial.csv.includes("optional_off")); assert.ok(partial.csv.includes(required.at(-1).id));
    }
  }
  const ready = await state.snapshot(); assertOriginalWords(ready);
  assert.equal(ready.summary.completion, "complete"); assert.equal(ready.summary.fulfilled_required_obligations, 8); assert.equal(ready.summary.selected_optional_obligations, 0); assert.equal(ready.summary.delivery_ready, true);
  assert.equal(ready.capabilities.nativeGeneration, false, "owned-file fulfillment is not a native-provider claim");
  const complete = await download((await state.command({ action: "export", planRevisionId: plan.revisionId })).command);
  assertExactFiles(complete, required.map((row) => row.id));
  assert.equal(complete.manifest.deliveryStatus, "complete"); assert.equal(complete.manifest.scopeHistoryComplete, true); assert.equal(complete.manifest.summary.owedTargets, 8);
  assert.equal(complete.manifest.summary.optionalOffObligations, 1); assert.equal(complete.manifest.missingWork.length, 0);
  assert.deepEqual((await download(partialCommand)).manifest, partialManifest, "later approval does not rewrite the previously pinned partial ZIP");

  const selected = await state.command({ action: "confirm", options: { selected_optional_ids: [optional.obligation_id] } }), nextPlan = selected.snapshot.confirmedPlan;
  assert.notEqual(nextPlan.revisionId, plan.revisionId); assertOriginalWords(selected.snapshot);
  assert.equal(nextPlan.plan.targets.length, 9); assert.equal(nextPlan.plan.targets.find((row) => row.id === optional.id).selected, true);
  assert.equal(selected.snapshot.summary.required_obligations, 8); assert.equal(selected.snapshot.summary.selected_optional_obligations, 1);
  assert.equal(selected.snapshot.summary.fulfilled_targets, 0, "a new plan does not silently inherit old approvals");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_plan_fulfillments WHERE plan_revision_id=?").get(nextPlan.revisionId).count, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_target_acceptances").get().count, 8);
  await state.command({ action: "export", planRevisionId: nextPlan.revisionId }, 409);
  for (const target of required) {
    const receipt = receipts.get(target.id);
    assert.equal(nextPlan.targetContractDigests[target.id], plan.targetContractDigests[target.id]);
    const reused = await state.command({ action: "bind", planRevisionId: nextPlan.revisionId, targetId: target.id, acceptanceId: receipt.acceptanceId });
    assert.equal(reused.command.acceptanceId, receipt.acceptanceId);
  }
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_target_acceptances").get().count, 8, "explicit reuse retains the original eight review receipts");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='OutputTargetAccepted'").get().count, 8);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='OutputFulfillmentSelected'").get().count, 8);
  const missingOptional = await state.snapshot();
  assert.equal(missingOptional.summary.fulfilled_required_obligations, 8); assert.equal(missingOptional.summary.fulfilled_selected_optional_obligations, 0); assert.equal(missingOptional.summary.delivery_ready, false);
  await state.command({ action: "export", planRevisionId: nextPlan.revisionId }, 409);
  const selectedPartial = await download((await state.command({ action: "export", planRevisionId: nextPlan.revisionId, allowPartial: true })).command);
  assertExactFiles(selectedPartial, required.map((row) => row.id));
  assert.equal(selectedPartial.manifest.deliveryStatus, "partial"); assert.equal(selectedPartial.manifest.summary.owedTargets, 9); assert.equal(selectedPartial.manifest.summary.includedOwedTargets, 8);
  assert.equal(selectedPartial.manifest.summary.optionalOffObligations, 0); assert.equal(selectedPartial.manifest.missingWork.length, 1);
  assert.equal(selectedPartial.manifest.missingWork[0].targetId, optional.id); assert.equal(selectedPartial.manifest.missingWork[0].required, false); assert.equal(selectedPartial.manifest.missingWork[0].selected, true);
  await adoptAndReview(fixtureFor(nextPlan.plan.targets.find((row) => row.id === optional.id)), nextPlan);
  const final = await state.snapshot(); assertOriginalWords(final);
  assert.equal(final.summary.completion, "complete"); assert.equal(final.summary.fulfilled_targets, 9); assert.equal(final.summary.fulfilled_required_obligations, 8); assert.equal(final.summary.fulfilled_selected_optional_obligations, 1); assert.equal(final.summary.delivery_ready, true);
  const nine = await download((await state.command({ action: "export", planRevisionId: nextPlan.revisionId })).command);
  assertExactFiles(nine, nextPlan.plan.targets.map((row) => row.id));
  assert.equal(nine.manifest.deliveryStatus, "complete"); assert.equal(nine.manifest.summary.owedTargets, 9); assert.equal(nine.manifest.summary.includedOwedTargets, 9); assert.equal(nine.manifest.missingWork.length, 0);
  assert.equal(nine.manifest.summary.requiredObligations, 8); assert.equal(nine.manifest.summary.fulfilledSelectedOptionalObligations, 1); assert.equal(nine.manifest.summary.optionalOffObligations, 0);
  assert.equal(new Set(nine.manifest.files.map((file) => file.sha256)).size, 9); assert.equal(state.media.size, 9);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_target_acceptances").get().count, 9);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='OutputTargetAccepted'").get().count, 9);
  for (const table of ["document_jobs", "output_execution_grants", "output_operation_slots", "output_provider_calls"]) assert.equal(state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  assert.equal(providerDispatches, 0, "the real handler journey makes no provider or network calls");
  assert.deepEqual(outputSchema(state.sqlite), state.initialOutputSchema); assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
});

test("real source handler saves and reloads typed requirements without jobs, provider calls, or confirmed spending", async () => {
  const state = await planFixture();
  const snapshot = await state.snapshot();
  assert.deepEqual(snapshot.requirements[0].spec, state.spec);
  assert.equal(snapshot.summary.required_obligations, 2);
  assert.equal(snapshot.summary.optional_obligations, 1);
  assert.equal(snapshot.summary.selected_optional_obligations, 0);
  assert.equal(snapshot.capabilities.nativeGeneration, false);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_execution_grants").get().count, 0);
  const preflight = await state.command({ action: "preflight", planRevisionId: state.plan.revisionId });
  assert.ok(preflight.command.preflight.targets.every((target) => !target.available));
  assert.equal(preflight.command.preflight.maximumMicrousd, 0);
});

test("two exact inspected owned files, distinct approval, and pinned ZIP complete a two-target assignment without optional work", async () => {
  const state = await planFixture();
  const targets = state.plan.plan.targets.filter((target) => target.required);
  for (const [index, target] of targets.entries()) {
    const uploaded = await state.upload(png({ width: index ? 4 : 2, height: index ? 5 : 2 }), `result-${index}.png`);
    const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
    assert.equal(bound.snapshot.results.find((result) => result.id === bound.command.resultId).checksStatus, "passed");
    assert.notEqual(bound.snapshot.summary.completion, "complete", "binding never invents approval");
    await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
    if (index === 0) {
      await state.command({ action: "export", planRevisionId: state.plan.revisionId }, 409);
      const partial = await state.command({ action: "export", planRevisionId: state.plan.revisionId, allowPartial: true });
      const archive = await state.send(partial.command.downloadUrl);
      assert.equal(archive.status, 200, await archive.clone().text());
      assert.equal(archive.headers.get("x-output-delivery-completion"), "partial");
    }
  }
  const final = await state.snapshot();
  assert.equal(final.summary.completion, "complete");
  assert.equal(final.summary.fulfilled_required_obligations, 2);
  assert.equal(final.summary.selected_optional_obligations, 0);
  const exported = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  const archive = await state.send(exported.command.downloadUrl);
  assert.equal(archive.status, 200, await archive.clone().text());
  assert.equal(archive.headers.get("x-output-delivery-completion"), "complete");
  assert.equal(archive.headers.get("content-type"), "application/zip");
  assert.ok((await archive.arrayBuffer()).byteLength > 200);
  assert.equal(state.media.size, 2);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 0);
});

test("a database created only by production migrations supports actual Output hash custody, approval and ZIP delivery without runtime repair", async () => {
  const state = await planFixture({ productionMigrations: true });
  assert.equal(state.initialOutputSchema.length, 16);
  assert.deepEqual(outputSchema(state.sqlite), state.initialOutputSchema, "schema already existed before the first handler call");
  const required = state.plan.plan.targets.filter((target) => target.required);
  for (const [index, target] of required.entries()) {
    const uploaded = await state.upload(png({ width: index ? 4 : 2, height: index ? 5 : 2 }), `migrated-result-${index}.png`);
    const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
    await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  }
  const prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  const delivery = await unpack(await state.send(prepared.command.downloadUrl));
  assert.equal(delivery.manifest.deliveryStatus, "complete");
  assert.equal(delivery.manifest.files.length, 2);
  for (const table of ["output_asset_storage_writes", "output_assets", "output_results", "output_target_acceptances"]) {
    const hashes = state.sqlite.prepare(`SELECT content_sha256 FROM ${table}`).all();
    assert.equal(hashes.length, 2, table);
    assert.ok(hashes.every((row) => /^[a-f0-9]{64}$/u.test(row.content_sha256)), table);
  }
  assert.deepEqual(outputSchema(state.sqlite), state.initialOutputSchema, "initialization did not add missing fields or duplicate physical indexes");
  assert.deepEqual(state.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
});

test("wrong real geometry is a failed candidate and cannot be accepted, even with human flags", async () => {
  const state = await planFixture();
  const target = state.plan.plan.targets.find((target) => target.aspect_ratio?.width === 4);
  const uploaded = await state.upload(png({ width: 3, height: 2 }));
  const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
  const candidate = bound.snapshot.results.find((result) => result.id === bound.command.resultId);
  assert.equal(candidate.checksStatus, "failed");
  assert.ok(candidate.problems.includes("required_aspect_ratio_mismatch"));
  await state.command({ action: "review", resultId: candidate.id, decision: "approve", reviewedCoverage: true, reviewedRights: true }, 409);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_target_acceptances").get().count, 0);
});

test("stale nested edits preserve the saved spec and lost-response replay keeps the original command", async () => {
  const state = await planFixture();
  const before = await state.snapshot(), changed = structuredClone(state.spec);
  changed.label = "A changed purpose";
  const body = { documentId: doc, action: "save", blockId: changed.id, spec: changed, expectedRevision: before.revision, clientMutationId: "stable-save" };
  const send = (value) => state.send(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  const first = await send(body); assert.equal(first.status, 200, await first.clone().text());
  const replay = await send(body); assert.equal(replay.status, 200, await replay.clone().text()); assert.equal((await replay.json()).replayed, true);
  const stale = await send({ ...body, clientMutationId: "stale-save", spec: state.spec });
  assert.equal(stale.status, 409);
  assert.equal((await state.snapshot()).requirements[0].spec.label, "A changed purpose");
});

test("source edits and byte changes block current acceptance and exported manifests without erasing history", async () => {
  const state = await planFixture();
  const target = state.plan.plan.targets[0], uploaded = await state.upload(png({ width: 2, height: 2 }));
  const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
  await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  const exported = await state.command({ action: "export", planRevisionId: state.plan.revisionId, allowPartial: true });
  const media = [...state.media.values()][0]; media.bytes[media.bytes.length - 1] ^= 1;
  assert.equal((await state.send(exported.command.downloadUrl)).status, 409);
  await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "source-change", "BlockPropertyEdited", { document_id: doc, project_id: project, block_id: "source", property_path: "text", new_value: "Changed factual context." })]);
  const stale = await state.snapshot();
  assert.equal(stale.summary.completion, "unknown");
  assert.ok(stale.targetStates.every((target) => target.freshness === "stale"));
  assert.equal((await state.send(exported.command.downloadUrl)).status, 409);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_target_acceptances").get().count, 1);
});

test("future schemas and unknown series are preserved but nonexecutable; removal is a CAS tombstone", async () => {
  const state = await fixture();
  const future = { schema_version: 20, id: "future", arbitrary_future_contract: { text: "Keep this authored instruction" } };
  await state.command({ action: "save", blockId: "future", spec: future });
  assert.deepEqual((await state.snapshot()).requirements[0].preserved, future);
  await state.command({ action: "confirm" }, 409);
  await state.command({ action: "remove", blockId: "future" });
  assert.equal((await state.snapshot()).requirements.length, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockRemoved'").get().count, 1);
  const executive = parseOutputRequirement({ id: "executive", type: "output", subtype: "Executive summary", content: "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TickTok style videos outlining the various parts of the document." }).spec;
  await state.command({ action: "save", blockId: executive.id, spec: executive });
  const planned = await state.command({ action: "confirm" });
  assert.equal(planned.snapshot.confirmedPlan.plan.groups.length, 3);
  assert.ok(planned.snapshot.summary.unresolved_required_groups > 0);
  assert.notEqual(planned.snapshot.summary.completion, "complete");
});

test("actual nine-slide PPTX satisfies a confirmed flexible 5–15 policy but not exact eight", async () => {
  const inspection = await inspectOutputAsset(zip(presentationEntries({ slides: 9 })), "review.pptx");
  assert.equal(inspection.facts.slideCount, 9);
  const target = { media_kind: "slides", blocking_issues: [], aspect_ratio: null, content_quantity: { kind: "range", unit: "slide", min: 5, max: 15 }, count_policy: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 }, coverage: { kind: "document_outline" }, source_scope: { kind: "document" } };
  assert.equal(inspectOutputTargetFile(target, inspection).status, "passed");
  assert.equal(inspectOutputTargetFile({ ...target, count_policy: { kind: "exact", unit: "slide", value: 8 } }, inspection).status, "failed");
});

test("new membership can reuse the exact unchanged target acceptance without manufacturing another review", async () => {
  const state = await planFixture();
  const target = state.plan.plan.targets[0], upload = await state.upload(png({ width: 2, height: 2 }));
  const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: upload.command.assetId });
  const accepted = await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  const next = await state.command({ action: "confirm", options: { selected_target_ids: [target.id] } });
  const reused = await state.command({ action: "bind", planRevisionId: next.command.planRevisionId, targetId: target.id, acceptanceId: accepted.command.acceptanceId });
  assert.equal(reused.command.acceptanceId, accepted.command.acceptanceId);
  assert.equal(reused.snapshot.summary.fulfilled_required_obligations, 1);
  assert.equal(reused.snapshot.summary.required_obligations, 2, "a partial run selection retains the full owed denominator");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_target_acceptances").get().count, 1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='OutputTargetAccepted'").get().count, 1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='OutputFulfillmentSelected'").get().count, 1);
});

test("missing exact bytes remain historical but cannot appear as fulfilled in a fresh snapshot", async () => {
  const state = await planFixture();
  const target = state.plan.plan.targets[0], uploaded = await state.upload(png({ width: 2, height: 2 }));
  const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
  await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  state.media.clear();
  const snapshot = await state.snapshot();
  assert.equal(snapshot.assets[0].available, false);
  assert.equal(snapshot.summary.fulfilled_targets, 0);
  assert.equal(snapshot.targetStates.find((value) => value.target_id === target.id).availability, "missing");
});

test("a committed upload with lost D1 acknowledgment keeps its exact R2 bytes and replays the original receipt", async () => {
  const state = await planFixture();
  const realBatch = state.env.DB.batch;
  let injected = false;
  state.env.DB.batch = async (statements) => {
    const output = await realBatch(statements);
    if (!injected && statements.some((statement) => statement.sql.includes("INSERT INTO output_assets"))) { injected = true; throw new Error("lost_after_commit"); }
    return output;
  };
  const uploaded = await state.upload(png({ width: 2, height: 2 }));
  assert.equal(injected, true);
  assert.equal(uploaded.replayed, true);
  assert.equal(state.media.size, 1, "canonical committed bytes survive the helper's replay result");
  const asset = uploaded.snapshot.assets.find((value) => value.id === uploaded.command.assetId);
  assert.equal(asset.available, true);
  const downloaded = await state.send(asset.downloadUrl);
  assert.equal(downloaded.status, 200, await downloaded.clone().text());
  assert.equal(downloaded.headers.get("x-output-sha256"), asset.sha256);
});

test("globally occupied and removed block identities cannot be recreated through Output save", async () => {
  const state = await fixture();
  await appendEvents(state.env, [
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "foreign", "ProjectCreated", { project_id: "foreign-project", name: "Other project" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "foreign", "DocumentCreated", { project_id: "foreign-project", document_id: "foreign-document", title: "Other Document" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "foreign", "BlockCreated", { project_id: "foreign-project", document_id: "foreign-document", block_id: "occupied", scope: "document", type: "direction", position: "a0", handle: "direction/other", properties: { text: "Keep the other project's source intact" } }),
  ]);
  await state.command({ action: "save", blockId: "occupied", spec: imageSpec("occupied") }, 409);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')='occupied'").get().count, 1);
  const spec = imageSpec();
  await state.command({ action: "save", blockId: spec.id, spec });
  await state.command({ action: "remove", blockId: spec.id });
  await state.command({ action: "save", blockId: spec.id, spec }, 409);
  await state.command({ action: "save", blockId: "source", spec: imageSpec("source") }, 403);
});

test("private source erasure between read and confirm aborts instead of resurrecting authored prose", async () => {
  const state = await planFixture(), before = await state.snapshot();
  const realBatch = state.env.DB.batch;
  let injected = false;
  state.env.DB.batch = async (statements) => {
    if (!injected && statements.some((statement) => statement.sql.includes("INSERT INTO output_commands") && statement.bindings.includes("confirm"))) {
      injected = true;
      state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE owner_id=?").run(new Date().toISOString(), owner);
    }
    return realBatch(statements);
  };
  const response = await state.send(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: doc, action: "confirm", expectedRevision: before.revision, clientMutationId: "erase-race" }) });
  assert.equal(injected, true);
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM event_private_payloads WHERE redacted_at IS NULL").get().count, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands WHERE command_key='erase-race'").get().count, 0);
});

test("source bindings include Document titles and pinned exact output identity", async () => {
  const state = await planFixture();
  const initial = await state.snapshot();
  await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "rename", "DocumentRenamed", { project_id: project, document_id: doc, title: "Changed generation title", new_title: "Changed generation title" })]);
  const renamed = await state.snapshot();
  assert.notEqual(renamed.sourceRevision, initial.sourceRevision);
  await appendEvents(state.env, [
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "pin-generation", "GenerationCompleted", { project_id: project, document_id: doc, generation_id: "pin-generation", outputs: [{ object_id: "pinned-image", media_url: "/api/media/owner/pinned.png", media_type: "image/png", width: 2, height: 2 }], object_ids: ["pinned-image"], model_id: "test-model" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "pin", "ObjectPinned", { project_id: project, document_id: doc, object_id: "pinned-image" }),
  ]);
  const pinned = await state.snapshot();
  assert.notEqual(pinned.sourceRevision, renamed.sourceRevision);
});

test("read-only Document reopen preserves accepted bindings while title and pin edits remain substantive", async () => {
  const state = await planFixture(), target = state.plan.plan.targets[0];
  const upload = await state.upload(png({ width: 2, height: 2 }));
  const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: upload.command.assetId });
  await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  const before = await state.snapshot();
  for (let index = 0; index < 3; index++) await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", `reopen-${index}`, "DocumentOpened", { document_id: doc, project_id: project })]);
  const after = await state.snapshot();
  assert.notEqual(after.revision, before.revision, "CAS cursor still captures concurrent stream history");
  assert.equal(after.sourceRevision, before.sourceRevision, "view bookkeeping is not creative source content");
  assert.equal(after.confirmedPlan.sourceDigest, after.sourceRevision);
  assert.equal(after.targetStates.find((row) => row.target_id === target.id).freshness, "current");
  assert.equal(after.summary.fulfilled_required_obligations, 1);
  const delivery = await state.command({ action: "export", planRevisionId: state.plan.revisionId, allowPartial: true });
  assert.equal((await state.send(delivery.command.downloadUrl)).status, 200);
  await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "renamed-after-open", "DocumentRenamed", { document_id: doc, project_id: project, new_title: "A genuinely changed document title" })]);
  assert.notEqual((await state.snapshot()).sourceRevision, after.sourceRevision);
  assert.equal((await state.send(delivery.command.downloadUrl)).status, 409);
});

test("saved planning proposals survive reload and sibling edits without becoming authority", async () => {
  const state = await fixture();
  const executive = parseOutputRequirement({ id: "executive", type: "output", subtype: "Executive summary", content: "1 slideshow with 5-15 slides and one podcast episode outlining the document." }).spec;
  const deck = executive.deliverables.find((item) => item.media_kind === "slides");
  const planSuggestions = { count_policies: { [`${deck.id}:slide`]: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 9 } }, suggested_counts: { [deck.id]: 9 } };
  await state.command({ action: "save", blockId: executive.id, spec: executive, planSuggestions });
  await state.command({ action: "save", blockId: "sibling", spec: imageSpec("sibling") });
  let snapshot = await state.snapshot();
  assert.deepEqual(snapshot.requirements.find((row) => row.blockId === executive.id).planSuggestions, planSuggestions);
  assert.equal(snapshot.confirmedPlan, null);
  assert.equal(snapshot.grants.length, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 0);
  await state.command({ action: "save", blockId: executive.id, spec: executive, planSuggestions: { count_policies: { "sibling:slide": { kind: "exact", unit: "slide", value: 8 } } } }, 400);
  await state.command({ action: "save", blockId: executive.id, spec: executive, planSuggestions: { count_policies: { [`${deck.id}:slide`]: { kind: "exact", unit: "slide", value: 16 } } } }, 400);
  const confirmed = await state.command({ action: "confirm" });
  assert.deepEqual(confirmed.snapshot.confirmedPlan.confirmationOptions.count_policies, planSuggestions.count_policies);
  assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.find((target) => target.deliverable_id === deck.id).suggested_count, 9);
  executive.deliverables = executive.deliverables.filter((entry) => entry.id !== deck.id);
  await state.command({ action: "save", blockId: executive.id, spec: executive });
  snapshot = await state.snapshot();
  assert.deepEqual(snapshot.requirements.find((row) => row.blockId === executive.id).planSuggestions, { count_policies: {}, suggested_counts: {} });
  assert.equal(snapshot.requirements.find((row) => row.blockId === "sibling").spec.id, "sibling");
});

test("partial ZIP carries the entire missing-work account and remains pinned after more approval", async () => {
  const state = await planFixture(), targets = state.plan.plan.targets.filter((target) => target.required);
  const uploaded = await state.upload(png({ width: 2, height: 2 }));
  const first = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: targets[0].id, assetId: uploaded.command.assetId });
  await state.command({ action: "review", resultId: first.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  const delivery = await state.command({ action: "export", planRevisionId: state.plan.revisionId, allowPartial: true });
  const before = await unpack(await state.send(delivery.command.downloadUrl));
  assert.equal(before.manifest.deliveryStatus, "partial");
  assert.equal(before.manifest.scope.obligations.length, 3);
  assert.equal(before.manifest.scope.targets.length, 3);
  assert.ok(before.manifest.missingWork.some((row) => row.targetId === targets[1].id));
  assert.ok(before.manifest.scope.obligations.some((row) => row.deliveryState === "optional_off"));
  assert.ok(before.csv.includes(targets[1].id));
  assert.equal(before.manifest.targets.length, 1);
  const secondUpload = await state.upload(png({ width: 4, height: 5 }));
  const second = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: targets[1].id, assetId: secondUpload.command.assetId });
  await state.command({ action: "review", resultId: second.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  assert.equal((await state.snapshot()).summary.delivery_ready, true);
  const after = await unpack(await state.send(delivery.command.downloadUrl));
  assert.deepEqual(after.manifest, before.manifest, "new approval cannot silently replace a previously pinned partial package");
});

test("an unresolved series and missing podcast stay visible in the portable executive delivery", async () => {
  const state = await fixture();
  const spec = parseOutputRequirement({ id: "executive", type: "output", subtype: "Executive summary", content: "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TickTok style videos outlining the various parts of the document." }).spec;
  const deck = spec.deliverables.find((entry) => entry.media_kind === "slides");
  await state.command({ action: "save", blockId: spec.id, spec, planSuggestions: { count_policies: { [`${deck.id}:slide`]: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 9 } } } });
  const plan = (await state.command({ action: "confirm" })).snapshot.confirmedPlan;
  const uploaded = await state.upload(zip(presentationEntries({ slides: 9 })), "audience.pptx");
  const result = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: plan.plan.targets.find((target) => target.media_kind === "slides").id, assetId: uploaded.command.assetId });
  await state.command({ action: "review", resultId: result.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  const delivery = await state.command({ action: "export", planRevisionId: plan.revisionId, allowPartial: true });
  const packed = await unpack(await state.send(delivery.command.downloadUrl));
  assert.equal(packed.manifest.deliveryStatus, "partial");
  assert.equal(packed.manifest.scope.groups.length, 3);
  assert.ok(packed.manifest.scope.unresolvedGroups.some((row) => row.reasonCodes.includes("series_membership_unresolved")));
  assert.ok(packed.manifest.missingWork.some((row) => String(row.label).toLowerCase().includes("podcast")));
  assert.ok(packed.csv.includes("series_membership_unresolved"));
  assert.ok(!JSON.stringify(packed.manifest).includes("An authored research source"));
});

test("a complete Executive summary adopts, checks, reviews, and exports one nine-slide deck, one episode, and two finite videos", async () => {
  const state = await fixture();
  const spec = parseOutputRequirement({ id: "executive", type: "output", subtype: "Executive summary", content: "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TickTok style videos outlining the various parts of the document." }).spec;
  const deck = spec.deliverables.find((entry) => entry.media_kind === "slides"), episode = spec.deliverables.find((entry) => entry.media_kind === "audio"), videos = spec.deliverables.find((entry) => entry.media_kind === "video");
  videos.series = { state: "resolved", description: "Two explicitly agreed topics; no claim to exhaustive coverage.", members: ["Known context", "Practical implications"].map((label, index) => ({ id: `${videos.id}:member-${index + 1}`, label, required: true, source_scope: { kind: "document" }, coverage: { kind: "topics", topics: [label] }, quantity: { kind: "exact", unit: "video", value: 1 }, original_text: `Outline ${label.toLowerCase()} from the Document.`, value_origins: { membership: { kind: "confirmed" } } })) };
  const planSuggestions = { count_policies: { [`${deck.id}:slide`]: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 9 }, [`${episode.id}:second`]: { kind: "exact", unit: "second", value: 30 }, [`${videos.id}:second`]: { kind: "exact", unit: "second", value: 2 } }, suggested_counts: { [deck.id]: 9 } };
  await state.command({ action: "save", blockId: spec.id, spec, planSuggestions });
  const plan = (await state.command({ action: "confirm" })).snapshot.confirmedPlan;
  assert.equal(plan.plan.groups.length, 3);
  assert.equal(plan.plan.targets.length, 4);
  assert.ok(plan.plan.targets.every((target) => target.blocking_issues.length === 0));
  const fixtures = [
    { target: plan.plan.targets.find((target) => target.media_kind === "slides"), bytes: zip(presentationEntries({ slides: 9 })), name: "executive-deck.pptx" },
    { target: plan.plan.targets.find((target) => target.media_kind === "audio"), bytes: wav({ samples: 30 * 8000 }), name: "executive-episode.wav" },
    ...await Promise.all(plan.plan.targets.filter((target) => target.media_kind === "video").map(async (target, index) => ({ target, bytes: new Uint8Array(await readFile(new URL(`./fixtures/executive-topic-${index ? "two" : "one"}.mp4`, import.meta.url))), name: `executive-topic-${index + 1}.mp4` }))),
  ];
  for (const fixture of fixtures) {
    const uploaded = await state.upload(fixture.bytes, fixture.name);
    const result = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: fixture.target.id, assetId: uploaded.command.assetId });
    const candidate = result.snapshot.results.find((row) => row.id === result.command.resultId);
    assert.equal(candidate.checksStatus, "passed");
    assert.equal(candidate.reviewAllowed, true);
    // This exercises explicit reviewer input; synthetic media fixtures are not
    // evidence of narrative quality or an actual user's content approval.
    await state.command({ action: "review", resultId: result.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  }
  const ready = await state.snapshot();
  assert.equal(ready.summary.fulfilled_required_groups, 3);
  assert.equal(ready.summary.fulfilled_required_obligations, 4);
  assert.equal(ready.summary.fulfilled_targets, 4);
  assert.equal(ready.summary.delivery_ready, true);
  const delivered = await state.command({ action: "export", planRevisionId: plan.revisionId });
  assert.equal(delivered.command.partCount, 1);
  const packed = await unpack(await state.send(delivered.command.downloadUrl));
  assert.equal(packed.manifest.deliveryStatus, "complete");
  assert.equal(packed.manifest.scopeHistoryComplete, true);
  assert.equal(packed.manifest.deliveryId, delivered.command.manifestId);
  assert.equal(packed.manifest.files.length, 4);
  assert.equal(packed.manifest.scope.groups.length, 3);
  assert.equal(packed.manifest.missingWork.length, 0);
  assert.equal(packed.manifest.files.find((file) => file.kind === "presentation").facts.slideCount, 9);
  assert.equal(packed.manifest.files.find((file) => file.kind === "audio").facts.durationSeconds, 30);
  const videoFiles = packed.manifest.files.filter((file) => file.kind === "video");
  assert.equal(videoFiles.length, 2);
  assert.ok(videoFiles.every((file) => file.facts.durationSeconds === 2 && file.facts.width === 18 && file.facts.height === 32));
  assert.notEqual(videoFiles[0].sha256, videoFiles[1].sha256);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs").get().count, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_execution_grants").get().count, 0);
});

test("a reduced assignment exports its previous commitment and cannot claim original-scope completion", async () => {
  const state = await planFixture(), changed = structuredClone(state.spec);
  const withdrawn = state.plan.plan.targets[1];
  changed.deliverables[0].format_variants.splice(1, 1);
  await state.command({ action: "save", blockId: changed.id, spec: changed });
  const confirmed = await state.command({ action: "confirm", amendmentReason: "The feed placement was withdrawn after the audience plan changed." });
  const plan = confirmed.snapshot.confirmedPlan, target = plan.plan.targets.find((row) => row.required);
  const uploaded = await state.upload(png({ width: 2, height: 2 }));
  const result = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
  await state.command({ action: "review", resultId: result.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  const delivered = await state.command({ action: "export", planRevisionId: plan.revisionId });
  const response = await state.send(delivered.command.downloadUrl);
  assert.equal(response.headers.get("x-output-delivery-completion"), "complete_for_amended_scope");
  const packed = await unpack(response);
  assert.equal(packed.manifest.deliveryStatus, "complete_for_amended_scope");
  assert.equal(packed.manifest.currentScopeStatus, "complete");
  assert.equal(packed.manifest.scopeAmendments.length, 1);
  assert.equal(packed.manifest.scopeAmendments[0].previousPlanRevisionId, state.plan.revisionId);
  assert.ok(packed.manifest.scopeAmendments[0].withdrawnTargets.some((row) => row.id === withdrawn.id && row.label === withdrawn.label));
  assert.equal(packed.manifest.scopeAmendments[0].actorRole, "authorized_author");
  assert.ok(!JSON.stringify(packed.manifest.scopeAmendments).includes(owner));
  assert.ok(packed.csv.includes("withdrawn_from_previous_scope"));
  assert.ok(packed.csv.includes("The feed placement was withdrawn"));
});

test("private-body proof chunks retain all Unicode evidence and roll back on a changed late chunk", async () => {
  const state = await fixture(), scope = { kind: "personal", key: `personal:${owner}:${project}`, ownerUserId: owner, actorUserId: owner, projectId: project, documentId: doc, organizationId: null, projectAccessId: null, contextId: null };
  await state.snapshot();
  const events = [0, 1].map((index) => makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "large-retained-proof", "OutputPlanConfirmed", { document_id: doc, project_id: project, text: `${"🧪".repeat(290_000)}-${index}` }));
  await appendEvents(state.env, events);
  for (const event of events) { const raw = state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(event.eventId).private_json; rememberOutputPrivateBody(scope, event.eventId, raw); }
  const proof = retainedOutputBodyAssertions(scope);
  assert.ok(proof.length > 1);
  assert.ok(proof.every((assertion) => new TextEncoder().encode(assertion.bindings[0]).byteLength <= 128 * 1024));
  await state.env.DB.batch(proof.flatMap((assertion) => outputAssertionStatements(state.env, assertion)));
  state.sqlite.exec("CREATE TABLE proof_sidecar(id TEXT PRIMARY KEY)");
  const last = state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(events[1].eventId).private_json;
  state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(last.replace(/-1/u, "-2"), events[1].eventId);
  await assert.rejects(state.env.DB.batch([state.env.DB.prepare("INSERT INTO proof_sidecar VALUES('must-rollback')"), ...proof.flatMap((assertion) => outputAssertionStatements(state.env, assertion))]), /CHECK constraint failed/u);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM proof_sidecar").get().count, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

test("65 accepted files leave in bounded exact packages without claiming any one contains the whole delivery", async () => {
  const state = await fixture(), spec = imageSpec();
  spec.deliverables[0].format_variants = [spec.deliverables[0].format_variants[0]];
  spec.deliverables[0].format_variants[0].quantity = { kind: "exact", unit: "image", value: 65 };
  await state.command({ action: "save", blockId: spec.id, spec });
  const plan = (await state.command({ action: "confirm" })).snapshot.confirmedPlan;
  for (const [index, target] of plan.plan.targets.entries()) {
    const uploaded = await state.upload(png({ width: index + 1, height: index + 1 }), `result-${index}.png`);
    const result = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
    await state.command({ action: "review", resultId: result.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  }
  const exported = await state.command({ action: "export", planRevisionId: plan.revisionId });
  assert.equal(exported.command.partCount, 5);
  assert.equal(exported.command.downloadUrls.length, 5);
  const union = new Set(), catalogs = [];
  const get = state.env.MEDIA.get.bind(state.env.MEDIA);
  let blobReads = 0;
  state.env.MEDIA.get = async (key) => { blobReads++; return get(key); };
  // HEAD is metadata in R2, so it must not count as loading file bytes in this fixture.
  state.env.MEDIA.head = get;
  for (const [index, url] of exported.command.downloadUrls.entries()) {
    blobReads = 0;
    const response = await state.send(url);
    assert.equal(response.headers.get("x-output-contains-complete-package"), "false");
    assert.equal(response.headers.get("x-output-package-part"), String(index + 1));
    const packed = await unpack(response);
    assert.equal(packed.manifest.deliveryStatus, "complete");
    assert.equal(packed.manifest.deliveryStatusScope, "entire_delivery_package");
    assert.equal(packed.manifest.packagePart.count, 5);
    assert.equal(packed.manifest.packagePart.containsCompletePackage, false);
    assert.equal(packed.manifest.scope.targets.length, 65);
    assert.equal(packed.manifest.targets.length, 65);
    assert.equal(blobReads, packed.manifest.packagePart.fileIds.length);
    assert.ok(blobReads <= 16);
    assert.equal(packed.manifest.missingWork.length, 0);
    assert.match(packed.csv, /all parts/i);
    catalogs.push(packed.manifest.packagePart.parts);
    for (const file of packed.manifest.files) { assert.ok(!union.has(file.id)); union.add(file.id); assert.equal(file.sha256.length, 64); }
  }
  assert.deepEqual(catalogs[0], catalogs[1]);
  assert.equal(union.size, 65);
});

async function seedRetainedCommitment(state, target, status = "authorized") {
  const scope = `personal:${owner}:${project}`, now = new Date().toISOString(), expiry = new Date(Date.now() + 600_000).toISOString();
  const preflight = { id: "retained-preflight", planRevisionId: state.plan.revisionId, termsDigest: "frozen-terms", sourceDigest: state.plan.sourceDigest, requirementsDigest: state.plan.requirementsDigest, targets: [{ targetId: target.id, available: true, reason: "Fixture only", provider: "fixture", model: "never-called", route: "fixture", maximumMicrousd: 100, maximumCalls: 3, maximumTokens: 100, settings: {}, transferDescription: "No provider in this source-only test" }], maximumMicrousd: 100, maximumCalls: 3, expiresAt: expiry, createdAt: now, operationAttempts: { [target.id]: { ordinal: 0, previousSlotId: null } } };
  const preflightEvent = makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "seed", "OutputPreflightPrepared", { project_id: project, document_id: doc, preflight });
  const grantEvent = makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "seed", "OutputExecutionAuthorized", { project_id: project, document_id: doc, grant_id: "retained-grant", plan_revision_id: state.plan.revisionId });
  await appendEvents(state.env, [preflightEvent, grantEvent]);
  state.sqlite.prepare("INSERT INTO output_preflights(scope_key,preflight_id,plan_revision_id,actor_user_id,terms_digest,event_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)").run(scope, preflight.id, state.plan.revisionId, owner, preflight.termsDigest, preflightEvent.eventId, expiry, now);
  state.sqlite.prepare("INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,context_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,?,?,?,?,NULL,?,?,100,3,'active',?,?)").run(scope, "retained-grant", state.plan.revisionId, owner, owner, preflight.id, grantEvent.eventId, expiry, now);
  state.sqlite.prepare("INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,attempt_ordinal,previous_slot_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'fixture','never-called','fixture-route','retained-job','retained-cost','retained-tokens',100,3,100,0,NULL,?,?,?)").run(scope, "retained-slot", "retained-grant", state.plan.revisionId, target.id, state.plan.targetContractDigests[target.id], state.plan.sourceDigest, status, now, now);
  state.sqlite.prepare("INSERT INTO output_operation_routes(scope_key,slot_id,stage_key,provider,model,maximum_calls) VALUES(?,'retained-slot','initial','fixture','never-called',1)").run(scope);
  return { scope, now };
}

test("draft edits retain active commitments; uncertain costs block withdrawal until reconciled and an amendment is attributed", async () => {
  const state = await planFixture(), target = state.plan.plan.targets[0];
  const { scope, now } = await seedRetainedCommitment(state, target);
  const changed = structuredClone(state.spec);
  changed.deliverables[0].format_variants = changed.deliverables[0].format_variants.slice(1);
  await state.command({ action: "save", blockId: changed.id, spec: changed, amendmentReason: "Scope proposal saved without authorizing work." });
  assert.equal((await state.snapshot()).confirmedPlan.revisionId, state.plan.revisionId);
  const blocked = await state.command({ action: "confirm", amendmentReason: "Drop the square image." }, 409);
  assert.equal(blocked.error, "output_active_commitment_requires_cancellation");
  assert.equal(blocked.commitments[0].jobId, "retained-job");
  await state.command({ action: "remove", blockId: changed.id }, 409);
  state.sqlite.prepare("UPDATE output_operation_slots SET status='cancelled'").run();
  state.sqlite.prepare("INSERT INTO output_provider_calls(scope_key,slot_id,call_key,client_request_id,request_digest,stage_key,provider,model,reserved_microusd,used_microusd,status,created_at) VALUES(?,'retained-slot','initial','retained-client','request','initial','fixture','never-called',30,NULL,'uncertain',?)").run(scope, now);
  assert.equal((await state.command({ action: "confirm", amendmentReason: "Cancel request does not settle charge." }, 409)).error, "output_active_commitment_requires_cancellation");
  let snapshot = await state.snapshot();
  assert.equal(snapshot.grants[0].pendingCalls, 1);
  assert.equal(snapshot.grants[0].exposedMicrousd, 30);
  assert.equal(snapshot.grants[0].operations[0].targetLabel, target.label);
  assert.equal(snapshot.grants[0].disclosure.id, "retained-preflight");
  state.sqlite.prepare("UPDATE output_provider_calls SET used_microusd=30,status='settled',settled_at=?").run(new Date().toISOString());
  assert.equal((await state.command({ action: "confirm" }, 409)).error, "output_scope_amendment_reason_required");
  const amended = await state.command({ action: "confirm", amendmentReason: "Audience no longer needs the square placement; the settled charge remains recorded." });
  snapshot = amended.snapshot;
  assert.equal(snapshot.scopeAmendments.length, 1);
  assert.ok(snapshot.scopeAmendments[0].withdrawnTargetIds.includes(target.id));
  assert.equal(snapshot.scopeAmendments[0].actorUserId, owner);
  assert.equal(snapshot.scopeAmendments[0].previousPlanRevisionId, state.plan.revisionId);
  assert.equal(snapshot.grants.length, 1);
  assert.equal(snapshot.grants[0].usedMicrousd, 30);
  assert.equal(snapshot.grants[0].pendingCalls, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_plan_revisions").get().count, 2);
});

test("provider uncertainty appearing at amendment commit rolls back the entire new confirmation", async () => {
  const state = await planFixture(), target = state.plan.plan.targets[0];
  const { scope, now } = await seedRetainedCommitment(state, target, "cancelled");
  state.sqlite.prepare("INSERT INTO output_provider_calls(scope_key,slot_id,call_key,client_request_id,request_digest,stage_key,provider,model,reserved_microusd,used_microusd,status,created_at) VALUES(?,'retained-slot','initial','retained-client','request','initial','fixture','never-called',30,0,'rejected',?)").run(scope, now);
  const changed = structuredClone(state.spec); changed.deliverables[0].format_variants.shift();
  await state.command({ action: "save", blockId: changed.id, spec: changed });
  const eventsBefore = state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const commandsBefore = state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands").get().count;
  const batch = state.env.DB.batch.bind(state.env.DB);
  state.env.DB.batch = async (statements) => {
    if (statements.some((statement) => /INSERT INTO output_plan_revisions/u.test(statement.sql))) state.sqlite.prepare("UPDATE output_provider_calls SET used_microusd=NULL,status='uncertain'").run();
    return batch(statements);
  };
  await state.command({ action: "confirm", amendmentReason: "This transaction must not withdraw an uncertain operation." }, 409);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_plan_revisions").get().count, 1);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count, eventsBefore);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_commands").get().count, commandsBefore);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

test("source erasure during exact-file release prevents bytes from leaving", async () => {
  const state = await planFixture(), uploaded = await state.upload(png({ width: 2, height: 2 }));
  const get = state.env.MEDIA.get.bind(state.env.MEDIA);
  state.env.MEDIA.head = get;
  state.env.MEDIA.get = async (key) => {
    const object = await get(key);
    state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')='source')").run(new Date().toISOString());
    return object;
  };
  const response = await state.send(uploaded.snapshot.assets[0].downloadUrl);
  assert.equal(response.status, 410);
  const body = await response.json();
  assert.equal(body.error, "output_private_evidence_unavailable");
  assert.equal(body.errorCode, "output_private_evidence_unavailable");
  assert.equal(state.media.size, 1, "retention history is independent from current release eligibility");
});

test("upload custody exists before PUT; lost PUT acknowledgement retains an unresolved cleanup obligation", async () => {
  const state = await planFixture(), put = state.env.MEDIA.put.bind(state.env.MEDIA);
  let putCalls = 0;
  state.env.MEDIA.put = async (key, value, options) => {
    putCalls++;
    const receipt = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes WHERE storage_key=?").get(key);
    assert.ok(receipt, "a crash in PUT cannot leave untracked private bytes");
    assert.equal(receipt.status, "writing");
    assert.equal(receipt.write_acknowledged, 0);
    assert.equal(receipt.publication_event_id, null);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_assets").get().count, 0);
    await put(key, value, options);
    throw new Error("simulated lost PUT acknowledgement");
  };
  await state.upload(png({ width: 2, height: 2 }), "private.png", 500);
  const receipt = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes").get();
  assert.equal(receipt.status, "cleanup_pending");
  assert.equal(receipt.write_acknowledged, 0);
  assert.equal(receipt.publication_event_id, null);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_assets").get().count, 0);
  assert.equal(state.media.size, 0, "best-effort deletion does not prove that an unknown PUT cannot arrive later");
  const progress = await reconcileOutputAssetStorage(state.env, { ownerUserId: owner, personalOnly: true });
  assert.equal(progress.pending, 1);
  assert.equal(progress.deleted, 0);
  assert.equal(state.sqlite.prepare("SELECT status FROM output_asset_storage_writes").get().status, "cleanup_pending");
  assert.equal(putCalls, 1);
});

test("an acknowledged late upload after erasure cannot publish and is deleted from its durable receipt", async () => {
  const state = await planFixture(), put = state.env.MEDIA.put.bind(state.env.MEDIA);
  let finish, entered;
  const waiting = new Promise((resolve) => { entered = resolve; }), gate = new Promise((resolve) => { finish = resolve; });
  state.env.MEDIA.put = async (key, value, options) => {
    const result = await put(key, value, options);
    assert.equal(state.sqlite.prepare("SELECT status FROM output_asset_storage_writes WHERE storage_key=?").get(key).status, "writing");
    entered();
    await gate;
    return result;
  };
  const upload = state.upload(png({ width: 2, height: 2 }), "arriving-after-erasure.png", 409);
  await waiting;
  state.sqlite.prepare("UPDATE output_asset_storage_writes SET status='cleanup_pending' WHERE publication_event_id IS NULL").run();
  state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')='source')").run(new Date().toISOString());
  finish();
  await upload;
  const receipt = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes").get();
  assert.equal(receipt.write_acknowledged, 1);
  assert.equal(receipt.status, "deleted");
  assert.equal(receipt.publication_event_id, null);
  assert.equal(state.media.size, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_assets").get().count, 0);
});

test("a failed compensating delete stays pending until reconciled, while published uploads survive maintenance", async () => {
  const state = await planFixture(), put = state.env.MEDIA.put.bind(state.env.MEDIA), remove = state.env.MEDIA.delete.bind(state.env.MEDIA);
  const retained = await state.upload(png({ width: 2, height: 2 }), "finished.png");
  const retainedRow = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes").get();
  assert.ok(retainedRow.publication_event_id);
  state.env.MEDIA.put = async (key, value, options) => {
    const ack = await put(key, value, options);
    state.sqlite.prepare("UPDATE output_asset_storage_writes SET status='cleanup_pending' WHERE storage_key=?").run(key);
    return ack;
  };
  state.env.MEDIA.delete = async () => { throw new Error("delete temporarily unavailable"); };
  await state.upload(png({ width: 4, height: 5 }), "interrupted.png", 409);
  const pending = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes WHERE publication_event_id IS NULL").get();
  assert.equal(pending.status, "cleanup_pending");
  assert.equal(pending.write_acknowledged, 1);
  assert.equal(state.media.size, 2);
  assert.equal((await reconcileOutputAssetStorage(state.env, { ownerUserId: owner, personalOnly: true })).pending, 1);
  state.env.MEDIA.delete = remove;
  const recovered = await reconcileOutputAssetStorage(state.env, { ownerUserId: owner, personalOnly: true });
  assert.equal(recovered.deleted, 1);
  assert.equal(recovered.pending, 0);
  assert.equal(state.media.size, 1);
  assert.ok(state.media.has(retainedRow.storage_key));
  assert.equal((await state.send(retained.snapshot.assets[0].downloadUrl)).status, 200);
  assert.equal(state.sqlite.prepare("SELECT status FROM output_asset_storage_writes WHERE asset_id=?").get(pending.asset_id).status, "deleted");
});

test("bounded cleanup rotates unknown receipts and personal erasure cannot sweep shared custody", async () => {
  const state = await planFixture(), put = state.env.MEDIA.put.bind(state.env.MEDIA);
  state.env.MEDIA.put = async (key, value, options) => { await put(key, value, options); throw new Error("unknown write acknowledgement"); };
  await state.upload(png({ width: 2, height: 2 }), "first-unknown.png", 500);
  await state.upload(png({ width: 4, height: 5 }), "second-unknown.png", 500);
  const rows = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes ORDER BY asset_id").all();
  rows.forEach((row, index) => state.sqlite.prepare("UPDATE output_asset_storage_writes SET updated_at=? WHERE asset_id=?").run(`200${index}-01-01T00:00:00.000Z`, row.asset_id));
  const first = await reconcileOutputAssetStorage(state.env, { ownerUserId: owner, personalOnly: true, limit: 1 });
  assert.equal(first.pending, 1);
  assert.equal(state.sqlite.prepare("SELECT updated_at FROM output_asset_storage_writes WHERE asset_id=?").get(rows[1].asset_id).updated_at, "2001-01-01T00:00:00.000Z");
  const second = await reconcileOutputAssetStorage(state.env, { ownerUserId: owner, personalOnly: true, limit: 1 });
  assert.equal(second.pending, 1);
  assert.notEqual(state.sqlite.prepare("SELECT updated_at FROM output_asset_storage_writes WHERE asset_id=?").get(rows[1].asset_id).updated_at, "2001-01-01T00:00:00.000Z");
  const shared = { ...rows[0], scope_key: "project:shared-org:shared-project", asset_id: "shared-pending-asset", organization_id: "shared-org", project_access_id: "shared-project", context_id: "shared-context", command_key: "shared-upload", status: "written", write_acknowledged: 1, updated_at: "2000-01-01T00:00:00.000Z" };
  shared.storage_key = `output-requirements/${owner}/${project}/${doc}/${shared.asset_id}/${shared.content_sha256}.png`;
  const fields = Object.keys(shared);
  state.sqlite.prepare(`INSERT INTO output_asset_storage_writes(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")})`).run(...fields.map((field) => shared[field]));
  state.media.set(shared.storage_key, { bytes: png({ width: 2, height: 2 }), metadata: { ownerId: owner, projectId: project, documentId: doc, scopeKey: shared.scope_key, assetId: shared.asset_id, sha256: shared.content_sha256, outputRequirementAsset: "1" }, contentType: "image/png" });
  await reconcileOutputAssetStorage(state.env, { ownerUserId: owner, personalOnly: true, limit: 100 });
  assert.ok(state.media.has(shared.storage_key));
  assert.equal(state.sqlite.prepare("SELECT status,updated_at FROM output_asset_storage_writes WHERE asset_id=?").get(shared.asset_id).status, "written");
  assert.equal(state.sqlite.prepare("SELECT updated_at FROM output_asset_storage_writes WHERE asset_id=?").get(shared.asset_id).updated_at, "2000-01-01T00:00:00.000Z");
});


test("source verification capacity preserves the full assignment and blocks native preflight before any source lookup", async () => {
  const state = await fixture(), mimeType = "text/plain", bytes = new TextEncoder().encode("Use only this retained source statement.");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const extracted = await extractSourceDocument(new File([bytes], "source.txt", { type: mimeType }));
  const sourceEvidence = sourceDocumentEvidence(extracted, hash, mimeType), evidenceHash = await sourceDocumentEvidenceDigest(sourceEvidence);
  async function addReference(index) {
    const key = `${ownerMediaNamespace(owner)}/reference-${index}.txt`;
    state.media.set(key, { bytes, contentType: mimeType, metadata: { ownerId: owner, sha256: hash, mimeType, sourceEvidenceSha256: evidenceHash } });
    await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", `ref-${index}`, "BlockCreated", { project_id: project, document_id: doc, block_id: `reference-${index}`, scope: "document", type: "reference", position: `r${index}`, properties: {
      reference_id: `owned-reference-${index}`, media_url: `/api/media/${encodeURIComponent(key)}`, source_evidence_hash: evidenceHash, source_content_hash: hash, source_mime_type: mimeType, source_kind: extracted.sourceKind, extraction_status: extracted.status,
      text: extracted.text, source_citations: extracted.segments.map((segment) => ({ anchor: segment.anchor, excerpt: segment.text })), source_segment_count: extracted.segments.length, source_excerpt_truncated: extracted.truncated,
    } }), makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", `ref-rights-${index}`, "RightsAsserted", { project_id: project, document_id: doc, reference_id: `owned-reference-${index}`, rights_class: "owned" })]);
  }
  await addReference(0);
  await addReference(1);
  const spec = imageSpec();
  await state.command({ action: "save", blockId: spec.id, spec });
  const confirmed = await state.command({ action: "confirm" });
  const current = await state.snapshot();
  let lookups = 0; const head = state.env.MEDIA.head.bind(state.env.MEDIA);
  state.env.MEDIA.head = async (key) => { lookups++; return head(key); };
  const denied = await state.send(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preflight", documentId: doc, planRevisionId: confirmed.command.planRevisionId, clientMutationId: "native-reference-capacity", expectedRevision: current.revision }) });
  assert.equal(denied.status, 409, await denied.clone().text());
  assert.equal((await denied.json()).errorCode, "context_source_evidence_capacity_exceeded");
  assert.equal(lookups, 0, "native capacity fails before its first source HEAD");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_preflights").get().count, 0);
  const readable = await state.snapshot();
  assert.equal(lookups, 2, "owned-file/read verification can still check these exact sources");
  assert.equal(readable.summary.required_obligations, 2);
  assert.deepEqual(sourceStatus(readable), { status: "verified", reasonCodes: [] });
  for (let index = 2; index < 5; index++) await addReference(index);
  lookups = 0;
  const overCapacity = await state.snapshot();
  assert.equal(lookups, 0, "an oversized source corpus is not partially verified");
  assert.equal(overCapacity.summary.required_obligations, 2);
  assert.equal(overCapacity.confirmedPlan.plan.targets.length, 3);
  assert.equal(overCapacity.summary.delivery_ready, false);
  assert.ok(overCapacity.capabilities.limitationCodes.includes("context_source_evidence_capacity_exceeded"));
  assert.deepEqual(sourceStatus(overCapacity), { status: "unavailable", reasonCodes: ["context_source_evidence_capacity_exceeded"] });
  assert.deepEqual(overCapacity.requirements[0].spec, spec);
});


test("a 256-target preflight checks attempt history in one bounded read without shrinking the saved plan", async (t) => {
  const state = await fixture(), spec = imageSpec();
  spec.deliverables[0].format_variants = [spec.deliverables[0].format_variants[0]];
  spec.deliverables[0].format_variants[0].quantity = { kind: "exact", unit: "image", value: 256 };
  await state.command({ action: "save", blockId: spec.id, spec });
  const confirmed = await state.command({ action: "confirm" }), current = await state.snapshot();
  let bindings = 0, attemptReads = 0;
  const prepare = state.env.DB.prepare.bind(state.env.DB), batch = state.env.DB.batch.bind(state.env.DB);
  const wrap = (statement) => new Proxy(statement, { get(target, key) {
    if (key === "bind") return (...values) => wrap(target.bind(...values));
    if (["first", "all", "run"].includes(String(key))) return (...values) => { bindings++; if (target.sql.includes("AS unresolved_cost")) attemptReads++; return target[key](...values); };
    const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
  } });
  state.env.DB.prepare = (sql) => wrap(prepare(sql));
  state.env.DB.batch = (statements) => { bindings++; return batch(statements); };
  const response = await state.send(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preflight", documentId: doc, planRevisionId: confirmed.command.planRevisionId, clientMutationId: "all-target-preflight", expectedRevision: current.revision }) });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.command.preflight.targets.length, 256);
  assert.equal(result.snapshot.confirmedPlan.plan.targets.length, 256);
  assert.ok(result.command.preflight.targets.every((target) => target.available === false && target.reasonCode === "output_native_execution_unavailable"));
  assert.equal(attemptReads, 1);
  assert.ok(bindings <= 40, `whole preflight request used ${bindings} bindings`);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_execution_grants").get().count, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_operation_slots").get().count, 0);
  t.diagnostic(`256-target preflight including full response snapshot used ${bindings} D1 binding calls`);
});


test("result review eligibility becomes false for unavailable source or incomplete inventory without mislabeling independence", async () => {
  const state = await planFixture(), target = state.plan.plan.targets.find((item) => item.required);
  const asset = await state.upload(png({ width: 2, height: 2 }), "reviewable.png");
  const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: asset.command.assetId });
  const result = bound.snapshot.results.find((item) => item.id === bound.command.resultId);
  assert.equal(result.reviewAllowed, true);
  assert.deepEqual(sourceStatus(bound.snapshot), { status: "verified", reasonCodes: [] });
  const list = state.env.MEDIA.list.bind(state.env.MEDIA);
  state.env.MEDIA.list = async () => { throw new Error("catalog temporarily unavailable"); };
  const incomplete = await state.snapshot();
  assert.deepEqual(sourceStatus(incomplete), { status: "verified", reasonCodes: [] }, "source evidence is independent of output-file catalog availability");
  assert.equal(incomplete.results.find((item) => item.id === result.id).reviewAllowed, false);
  assert.equal(incomplete.results.find((item) => item.id === result.id).independentReviewBlocked, false);
  state.env.MEDIA.list = list;
  await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "revoked-source", "BlockPropertyEdited", { project_id: project, document_id: doc, block_id: "source", property_path: "rights_revoked", new_value: true })]);
  const unavailable = await state.snapshot();
  assert.equal(unavailable.sourceVerification.status, "unavailable");
  assert.ok(unavailable.sourceVerification.reasonCodes.includes("context_source_rights_expired"));
  assert.equal(unavailable.results.find((item) => item.id === result.id).reviewAllowed, false);
  assert.equal(unavailable.results.find((item) => item.id === result.id).independentReviewBlocked, false);
});

async function addCapacitySources(state, count, { sharedObject = false, label = (index) => `Owned research source ${index + 1}` } = {}) {
  const mimeType = "text/plain", bytes = new TextEncoder().encode("Use this exact owned source statement.");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const extracted = await extractSourceDocument(new File([bytes], "source.txt", { type: mimeType }));
  const evidenceHash = await sourceDocumentEvidenceDigest(sourceDocumentEvidence(extracted, hash, mimeType));
  const events = [];
  for (let index = 0; index < count; index++) {
    const key = `${ownerMediaNamespace(owner)}/capacity-${sharedObject ? 0 : index}.txt`;
    state.media.set(key, { bytes, contentType: mimeType, metadata: { ownerId: owner, sha256: hash, mimeType, sourceEvidenceSha256: evidenceHash } });
    events.push(makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", `capacity-${index}`, "BlockCreated", { project_id: project, document_id: doc, block_id: `capacity-source-${index}`, scope: "document", type: "reference", position: `r${index}`, properties: {
      label: label(index), reference_id: `capacity-owned-${index}`, media_url: `/api/media/${encodeURIComponent(key)}`, source_evidence_hash: evidenceHash, source_content_hash: hash, source_mime_type: mimeType,
      source_kind: extracted.sourceKind, extraction_status: extracted.status, text: extracted.text, source_citations: extracted.segments.map((segment) => ({ anchor: segment.anchor, excerpt: segment.text })), source_segment_count: extracted.segments.length, source_excerpt_truncated: extracted.truncated,
    } }), makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", `capacity-rights-${index}`, "RightsAsserted", { project_id: project, document_id: doc, reference_id: `capacity-owned-${index}`, rights_class: "owned" }));
  }
  if (events.length) await appendEvents(state.env, events);
}

test("source capacity metadata exposes precise route counts and authorized names, including bounded name lists", async () => {
  for (const count of [0, 1, 2, 4, 5]) {
    const state = await fixture(); await addCapacitySources(state, count);
    const snapshot = await state.snapshot(), capacity = snapshot.sourceVerification.capacity;
    assert.equal(capacity.referenceCount, count);
    assert.equal(capacity.distinctObjectCount, count);
    assert.equal(capacity.countsComplete, true);
    assert.equal(capacity.ownedReadLimit, 4);
    assert.ok([0, 1].includes(capacity.nativeLimit), "native capacity is published by the server, never inferred from target count");
    assert.equal(capacity.sources.length, count);
    assert.equal(capacity.sourcesComplete, true);
    assert.deepEqual(capacity.sources.map((source) => source.label), Array.from({ length: count }, (_, index) => `Owned research source ${index + 1}`));
    assert.doesNotMatch(JSON.stringify(capacity), /\/api\/media|output-requirements\/|dev-local-creative/);
    assert.equal(snapshot.sourceVerification.status, count <= capacity.ownedReadLimit ? "verified" : "unavailable");
  }
  const repeated = await fixture(); await addCapacitySources(repeated, 37, { sharedObject: true, label: (index) => index === 0 ? "🌳".repeat(130) : `Repeated source ${index + 1}` });
  const capacity = (await repeated.snapshot()).sourceVerification.capacity;
  assert.equal(capacity.referenceCount, 37);
  assert.equal(capacity.distinctObjectCount, 1);
  assert.equal(capacity.countsComplete, true);
  assert.equal(capacity.sources.length, 32);
  assert.equal(capacity.sourcesComplete, false);
  assert.equal([...capacity.sources[0].label].length, 120);
});

test("increasing source capacity after approval blocks bind, review, export and both byte routes while preserving the accepted assignment", async () => {
  const state = await planFixture(), targets = state.plan.plan.targets.filter((target) => target.required);
  let approved;
  for (const [index, target] of targets.entries()) {
    const asset = await state.upload(png({ width: index ? 4 : 2, height: index ? 5 : 2 }), `accepted-${index}.png`);
    const bound = await state.command({ action: "bind", planRevisionId: state.plan.revisionId, targetId: target.id, assetId: asset.command.assetId });
    await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
    approved = { assetId: asset.command.assetId, resultId: bound.command.resultId, targetId: target.id, downloadUrl: asset.snapshot.assets.find((row) => row.id === asset.command.assetId).downloadUrl };
  }
  const delivery = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  assert.equal(delivery.snapshot.summary.delivery_ready, true);
  await addCapacitySources(state, 5);
  const blocked = await state.snapshot();
  assert.equal(blocked.sourceVerification.capacity.distinctObjectCount, 5);
  assert.equal(blocked.sourceVerification.status, "unavailable");
  assert.equal(blocked.summary.required_obligations, 2);
  assert.equal(blocked.results.filter((row) => row.review === "approved").length, 2);
  assert.ok(blocked.results.every((row) => row.reviewAllowed === false));
  for (const body of [
    { action: "bind", planRevisionId: state.plan.revisionId, targetId: approved.targetId, assetId: approved.assetId },
    { action: "review", resultId: approved.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true },
    { action: "export", planRevisionId: state.plan.revisionId },
  ]) assert.equal((await state.command(body, 409)).errorCode, "context_source_evidence_capacity_exceeded", body.action);
  for (const url of [approved.downloadUrl, delivery.command.downloadUrl]) {
    const response = await state.send(url); assert.equal(response.status, 409);
    assert.equal((await response.json()).errorCode, "context_source_evidence_capacity_exceeded");
  }
  const agreed = await state.command({ action: "confirm" });
  assert.equal(agreed.snapshot.sourceVerification.status, "unavailable", "free structural agreement never asserts source readiness");
  assert.equal(agreed.snapshot.summary.required_obligations, 2);
  assert.equal(agreed.snapshot.summary.delivery_ready, false);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_target_acceptances").get().count, 2);
});

test("an active source license expiring while the review transaction waits cannot create approval", async () => {
  const state = await fixture(), expires = Date.now() + 3_000;
  await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "source-deadline", "BlockPropertyEdited", { project_id: project, document_id: doc, block_id: "source", property_path: "license_expires_at", new_value: new Date(expires).toISOString() })]);
  const spec = imageSpec(); await state.command({ action: "save", blockId: spec.id, spec });
  const plan = (await state.command({ action: "confirm" })).snapshot.confirmedPlan, target = plan.plan.targets.find((item) => item.required);
  const asset = await state.upload(png({ width: 2, height: 2 }), "licensed-context.png");
  const bound = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId: asset.command.assetId });
  const eventCount = state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count;
  const batch = state.env.DB.batch.bind(state.env.DB); let delayed = false;
  state.env.DB.batch = async (statements) => {
    if (!delayed && statements.some((statement) => statement.sql.startsWith("INSERT INTO output_commands") && statement.bindings.includes("review"))) {
      delayed = true; await new Promise((resolve) => setTimeout(resolve, Math.max(0, expires - Date.now() + 30)));
    }
    return batch(statements);
  };
  await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true }, 409);
  assert.equal(delayed, true, "the source was valid when reviewed, then expired before the actual SQL transaction");
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_target_acceptances").get().count, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count, eventCount);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
  const unavailable = await state.snapshot(); assert.equal(unavailable.sourceVerification.status, "unavailable");
  assert.ok(unavailable.sourceVerification.reasonCodes.includes("context_source_rights_expired"));
  const draft = structuredClone(spec); draft.label = "A preserved draft after the license expired";
  assert.equal((await state.command({ action: "save", blockId: spec.id, spec: draft })).ok, true, "expiry does not discard free authored planning changes");
});


test("source deadline proof selects the earliest active authorized fact and ignores inactive expired facts", async () => {
  const state = await fixture(), scope = { kind: "personal", key: `personal:${owner}:${project}`, ownerUserId: owner, actorUserId: owner, projectId: project, documentId: doc, organizationId: null, projectAccessId: null, contextId: null };
  await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "inactive-license", "BlockCreated", { project_id: project, document_id: doc, block_id: "inactive-source", scope: "document", type: "direction", position: "y", properties: { text: "This inactive fact is excluded from active source authority.", weight: 0, license_expires_at: "2020-01-01T00:00:00.000Z" } })]);
  assert.deepEqual(outputActiveSourceDeadlineAssertions((await loadOutputCurrentContext(state.env, scope)).context), []);
  const earlier = Date.now() + 60_000, later = earlier + 120_000;
  await appendEvents(state.env, [
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "active-license", "BlockPropertyEdited", { project_id: project, document_id: doc, block_id: "source", property_path: "source_expires_at", new_value: new Date(later).toISOString() }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "active-license", "BlockPropertyEdited", { project_id: project, document_id: doc, block_id: "source", property_path: "rights_expires_at", new_value: new Date(earlier).toISOString() }),
  ]);
  const current = await loadOutputCurrentContext(state.env, scope), [deadline] = outputActiveSourceDeadlineAssertions(current.context);
  assert.deepEqual(deadline.bindings, [earlier]);
  assert.equal((await state.env.DB.prepare(`SELECT (${deadline.sql}) AS current`).bind(...deadline.bindings).first()).current, 1);
  assert.ok(current.assertions.some((assertion) => assertion.sql === deadline.sql && assertion.bindings[0] === earlier), "the worker execution proof retains the same database-clock bound");
});

test("a retained execution epoch replaces every identical current-owner head but never an external or conflicting capture", async () => {
  const state = await planFixture();
  const scope = { kind: "personal", key: `personal:${owner}:${project}`, actorUserId: owner, ownerUserId: owner, projectId: project, documentId: doc, organizationId: null, projectAccessId: null, contextId: null };
  const current = await loadOutputCurrentContext(state.env, scope);
  const sameOwner = { sql: "(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?", bindings: [`creative:${owner}`, current.head] };
  const external = { sql: sameOwner.sql, bindings: ["creative:external-origin", 0] };
  const authority = { ...current, confirmedPlan: state.plan, assertions: [...current.assertions, sameOwner, external] };
  const retained = prepareOutputExecutionProof(scope, authority);
  assert.equal(retained.assertions.filter((assertion) => assertion.sql.startsWith("NOT EXISTS(SELECT 1 FROM events later")).length, 2);
  assert.ok(retained.assertions.includes(external), "another owner's exact captured head is unchanged");
  assert.throws(() => prepareOutputExecutionProof(scope, { ...authority, assertions: [...authority.assertions, { ...sameOwner, bindings: [`creative:${owner}`, current.head + 1] }] }), /output_source_epoch_required/u);
  assert.throws(() => prepareOutputExecutionProof(scope, { ...authority, assertions: [external] }), /output_source_epoch_required/u);
  await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "fixture", "safe-open", "DocumentOpened", { project_id: project, document_id: doc })]);
  await state.env.DB.batch(retained.assertions.flatMap((assertion) => outputAssertionStatements(state.env, assertion)));
  await appendEvents(state.env, [makeEvent("creative:external-origin", 0, "user:external-origin", "fixture", "external-change", "DocumentRenamed", { project_id: "external-project", document_id: "external-document", title: "Changed source" })]);
  await assert.rejects(state.env.DB.batch(retained.assertions.flatMap((assertion) => outputAssertionStatements(state.env, assertion))), /CHECK constraint failed/u);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_atomic_assertions").get().count, 0);
});

test('native Output current-context proof retains authored Memory attribution after feature shutdown',async()=>{
 const state=await fixture(),scope={kind:'personal',key:`personal:${owner}:${project}`,ownerUserId:owner,actorUserId:owner,projectId:project,documentId:doc,organizationId:null,projectAccessId:null,contextId:null};
 await appendEvents(state.env,[makeEvent(`creative:${owner}`,0,`user:${owner}`,'fixture','assisted-authorship','BlockPropertyEdited',{
  project_id:project,document_id:doc,block_id:'source',property_path:'text',old_value:'An authored research source with no invented claims.',new_value:'Deliberately retained authored wording.',memory_authored_version:1})]);
 state.env.FORMA_MEMORY_ENABLED='false';
 const current=await loadOutputCurrentContext(state.env,scope),fact=current.context.snapshot.facts.find(row=>row.block_id==='source');
 assert.equal(fact.properties.text,'Deliberately retained authored wording.');assert.equal(fact.authorship,'accepted-memory-assisted');assert.equal(fact.independent_evidence,false);
 const checked=await state.env.DB.batch(current.assertions.map(assertion=>state.env.DB.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS verified`).bind(...(assertion.bindings??[]))));
 assert.ok(checked.every(row=>row.results[0].verified===1));
});
