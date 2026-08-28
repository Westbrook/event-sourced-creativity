import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createOutputDeliveryArchive, outputDeliveryScopeForPlan, planOutputDeliveryParts, MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES, MAX_OUTPUT_DELIVERY_FILES, MAX_OUTPUT_DELIVERY_DEFAULT_PART_FILES } from "../src/model/output-delivery-archive.ts";
import { evaluateOutputDeliveryScope } from "../src/model/output-delivery-manifest.ts";
import { mp4, png, presentationEntries, readStoredZip, wav, zip } from "./output-asset-fixtures.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const asset = (id, bytes, name) => ({ id, bytes, name, expectedSha256: digest(bytes) });
function samplePlan({ unresolvedSeries = true, optional = true, series = true } = {}) {
  const groups = [], obligations = [], targets = [], unresolved_groups = [];
  const add = (id, label, { required = true, selected = true, unresolved = false } = {}) => {
    const obligationId = unresolved ? `${id}:membership` : id, targetId = `${id}:target:1`;
    groups.push({ id, requirement_id: "executive-summary", label, required, obligation_ids: [obligationId] });
    obligations.push({ id: obligationId, requirement_id: "executive-summary", deliverable_id: id, label, required, selected, resolution: unresolved ? "unresolved" : "resolved", target_ids: unresolved ? [] : [targetId], quantity: { kind: unresolved ? "unknown" : "exact", unit: "document", value: 1 }, source_secret: "DO NOT EXPORT SOURCE PROSE" });
    if (unresolved) unresolved_groups.push({ id: `${obligationId}:unresolved`, requirement_id: "executive-summary", deliverable_id: id, obligation_id: obligationId, label, required, selected, issues: [{ code: "series_membership_unresolved", message: "DO NOT EXPORT SOURCE PROSE" }] });
    else targets.push({ id: targetId, requirement_id: "executive-summary", deliverable_id: id, obligation_id: obligationId, label, required, selected, blocking_issues: [], instruction_text: "DO NOT EXPORT SOURCE PROSE", source_scope: { kind: "blocks", block_ids: ["private-block"] }, coverage: { kind: "topics", topics: ["DO NOT EXPORT SOURCE PROSE"] } });
  };
  add("slides", "Executive slideshow"); add("episode", "Podcast episode");
  if (series) add("series", "Video series", { unresolved: unresolvedSeries });
  if (optional) add("optional-square", "Optional square cover", { required: false, selected: false });
  return { groups, obligations, targets, unresolved_groups, issues: [], original_text: "DO NOT EXPORT SOURCE PROSE" };
}
const deck = () => asset("slides-file", zip(presentationEntries({ slides: 5 })), "executive-summary.pptx");
const episode = () => asset("episode-file", wav(), "episode.wav");
const video = () => asset("series-file", mp4(), "series-part-one.mp4");
function request(files, plan, status = "partial", inventoryComplete = true) {
  const targets = files.map(file => ({ targetId: `${file.id.replace(/-file$/u, "")}:target:1`, fileId: file.id, acceptanceId: `acceptance-${file.id}` }));
  return { schemaVersion: 1, scopeHistoryComplete: true, scopeAmendments: [], planId: "plan-1", planRevision: "revision-1", createdAt: "2026-08-27T12:00:00.000Z", targets, scope: outputDeliveryScopeForPlan(plan, { status, inventoryComplete, includedTargetIds: targets.map(target => target.targetId) }) };
}
function unpack(result) {
  const parts = readStoredZip(result.bytes), text = new TextDecoder();
  return { entries: parts, manifest: JSON.parse(text.decode(parts.get("manifest.json"))), csv: text.decode(parts.get("manifest.csv")) };
}
function manyTargets(count) {
  const obligations = Array.from({ length: count }, (_, index) => ({ id: `obligation-${index}`, requirement_id: "many-images", deliverable_id: "images", label: `Image ${index + 1}`, required: true, selected: true, resolution: "resolved", target_ids: [`target-${index}`] }));
  return { groups: [{ id: "images", requirement_id: "many-images", label: "Required images", required: true, obligation_ids: obligations.map(row => row.id) }], obligations, targets: obligations.map((row, index) => ({ id: `target-${index}`, obligation_id: row.id, label: row.label, blocking_issues: [] })), unresolved_groups: [], issues: [] };
}

test("partial ZIP retains missing required targets, unresolved series and optional-off inventory", async () => {
  const files = [deck()], input = request(files, samplePlan()), result = await createOutputDeliveryArchive(files, input), { manifest, csv, entries } = unpack(result);
  assert.equal(manifest.deliveryStatus, "partial"); assert.equal(manifest.scope.inventoryComplete, true); assert.equal(manifest.scope.obligations.length, 4);
  const missing = manifest.missingWork.find(work => work.targetId === "episode:target:1"); assert.equal(missing.kind, "missing_target"); assert.equal(missing.label, "Podcast episode"); assert.ok(missing.reasons.some(reason => /No accepted file/.test(reason)));
  const series = manifest.missingWork.find(work => work.id === "series:membership:unresolved"); assert.equal(series.kind, "unresolved_group"); assert.ok(series.reasonCodes.includes("series_membership_unresolved"));
  assert.equal(manifest.scope.obligations.find(row => row.id === "optional-square").deliveryState, "optional_off"); assert.ok(!manifest.missingWork.some(work => work.id?.includes("optional-square")));
  assert.equal(manifest.summary.requiredObligations, 3); assert.equal(manifest.summary.includedOwedTargets, 1); assert.equal(manifest.summary.missingOwedTargets, 1); assert.equal(manifest.summary.unresolvedRequiredGroups, 1); assert.equal(manifest.summary.optionalOffObligations, 1);
  assert.match(csv, /"delivery","partial","true"/); assert.ok(csv.includes('"missing_work"')); assert.ok(csv.includes("episode:target:1")); assert.ok(csv.includes("series_membership_unresolved")); assert.ok(csv.includes("optional_off"));
  assert.deepEqual(entries.get("files/slides-file.pptx"), files[0].bytes); assert.equal(manifest.files[0].sha256, digest(files[0].bytes));
  assert.ok(!JSON.stringify(manifest).includes("DO NOT EXPORT SOURCE PROSE")); assert.ok(!csv.includes("DO NOT EXPORT SOURCE PROSE")); assert.ok(!JSON.stringify(manifest).includes("private-block"));
});
test("full ZIP declares complete only with all owed finite work and no unresolved required scope", async () => {
  const plan = samplePlan({ unresolvedSeries: false }), files = [deck(), episode(), video()];
  const { manifest, csv } = unpack(await createOutputDeliveryArchive(files, request(files, plan, "complete")));
  assert.equal(manifest.deliveryStatus, "complete"); assert.equal(manifest.scope.status, "complete"); assert.equal(manifest.summary.fulfilledRequiredObligations, 3); assert.equal(manifest.summary.missingOwedTargets, 0); assert.deepEqual(manifest.missingWork, []);
  assert.equal(manifest.summary.optionalOffObligations, 1); assert.equal(manifest.packagePart.containsCompletePackage, true); assert.match(csv, /"delivery","complete","true"/);
});
test("old file-only callers and explicit unverified scope stay unknown, never zero-of-zero complete", async () => {
  const files = [deck()], input = request(files, samplePlan()); delete input.scope;
  const { manifest, csv } = unpack(await createOutputDeliveryArchive(files, input)); assert.equal(manifest.deliveryStatus, "unknown"); assert.equal(manifest.scope.inventoryComplete, false); assert.equal(manifest.missingWork[0].kind, "scope_unknown"); assert.match(csv, /Completion is unknown/);
  const all = [deck(), episode()], full = request(all, samplePlan({ series: false, optional: false }), "unknown");
  const unknown = unpack(await createOutputDeliveryArchive(all, full)).manifest; assert.equal(unknown.deliveryStatus, "unknown"); assert.ok(unknown.missingWork.some(work => work.kind === "scope_unknown"));
});
test("contradictory completion claims and omitted referenced work cannot become portable success", async () => {
  const files = [deck()], base = request(files, samplePlan());
  const complete = structuredClone(base); complete.scope.status = "complete"; await assert.rejects(createOutputDeliveryArchive(files, complete), /scope_status_mismatch/);
  const incomplete = structuredClone(base); incomplete.scope.status = "complete"; incomplete.scope.inventoryComplete = false; await assert.rejects(createOutputDeliveryArchive(files, incomplete), /incomplete_scope_claim/);
  const missingRow = structuredClone(base); missingRow.scope.targets = missingRow.scope.targets.filter(row => row.id !== "episode:target:1"); await assert.rejects(createOutputDeliveryArchive(files, missingRow), /scope_membership_mismatch/);
  const missingGroup = structuredClone(base); missingGroup.scope.groups = missingGroup.scope.groups.filter(row => row.id !== "episode"); await assert.rejects(createOutputDeliveryArchive(files, missingGroup), /scope_membership_mismatch/);
  const falsePartialFiles = [deck(), episode()], falsePartial = request(falsePartialFiles, samplePlan({ series: false, optional: false }), "partial"); await assert.rejects(createOutputDeliveryArchive(falsePartialFiles, falsePartial), /scope_status_mismatch/);
});
test("selected optional work is owed; optional-off work is not silently packaged", async () => {
  const plan = samplePlan({ series: false }), optional = plan.obligations.find(row => row.id === "optional-square"); optional.selected = true;
  const files = [deck(), episode()], partial = unpack(await createOutputDeliveryArchive(files, request(files, plan))).manifest;
  assert.equal(partial.summary.selectedOptionalObligations, 1); assert.equal(partial.summary.optionalOffObligations, 0); assert.ok(partial.missingWork.some(work => work.targetId === "optional-square:target:1" && !work.required && work.selected));
  const unselected = samplePlan({ series: false }), extra = asset("optional-square-file", png(), "cover.png"), allFiles = [...files, extra];
  await assert.rejects(createOutputDeliveryArchive(allFiles, request(allFiles, unselected, "complete")), /target_not_owed/);
});
test("required groups with no owed members and unresolved whole requirements remain visible", () => {
  const plan = samplePlan({ series: false, optional: false }); plan.groups.push({ id: "empty", requirement_id: "executive-summary", label: "Required empty series", required: true, obligation_ids: [] });
  plan.unresolved_groups.push({ id: "unknown-requirement:unresolved", requirement_id: "unknown-requirement", deliverable_id: null, obligation_id: null, label: "Requirement needs clarification", required: true, selected: true, issues: [{ code: "deliverables_unresolved", message: "secret" }] });
  const scope = outputDeliveryScopeForPlan(plan, { status: "partial", inventoryComplete: true, includedTargetIds: ["slides:target:1", "episode:target:1"] });
  const result = evaluateOutputDeliveryScope(scope, ["slides:target:1", "episode:target:1"]);
  assert.ok(result.missingWork.some(work => work.kind === "empty_required_group" && work.id === "empty")); assert.ok(result.missingWork.some(work => work.id === "unknown-requirement:unresolved"));
});
test("scope is snapshotted before hashing and CSV labels cannot execute formulas", async () => {
  const files = [deck()], input = request(files, samplePlan()); input.scope.obligations.find(row => row.id === "episode").label = "=SUM(1+1)";
  const pending = createOutputDeliveryArchive(files, input); input.scope.obligations.length = 0; input.scope.status = "complete";
  const { manifest, csv } = unpack(await pending); assert.equal(manifest.deliveryStatus, "partial"); assert.equal(manifest.scope.obligations.length, 4); assert.ok(csv.includes('"\'=SUM(1+1)"'));
});
test("reason-code contract excludes arbitrary source prose and unsafe labels", async () => {
  const files = [deck()], input = request(files, samplePlan()); input.scope.unresolvedGroups[0].reasonCodes = ["DO NOT EXPORT SOURCE PROSE"];
  await assert.rejects(createOutputDeliveryArchive(files, input), /invalid_output_delivery_reason_code/);
  const badLabel = request(files, samplePlan()); badLabel.scope.groups[0].label = "hidden\u202e"; await assert.rejects(createOutputDeliveryArchive(files, badLabel), /invalid_output_delivery_scope_label/);
});

test("metadata-only partitioning is deterministic and preserves all 1000 planned file identities", () => {
  const files = Array.from({ length: 1000 }, (_, index) => ({ id: `asset-${String(index).padStart(4, "0")}`, byteLength: 9000 }));
  const input = { schemaVersion: 1, scopeHistoryComplete: true, scopeAmendments: [], planId: "large-plan", planRevision: "revision-1", createdAt: "2026-08-27T12:00:00.000Z", targets: files.map((file, index) => ({ targetId: `target-${index}`, fileId: file.id, acceptanceId: `acceptance-${index}` })) };
  input.scope = outputDeliveryScopeForPlan(manyTargets(1000), { status: "complete", inventoryComplete: true, includedTargetIds: input.targets.map(row => row.targetId) });
  const parts = planOutputDeliveryParts(files, input); assert.equal(parts.length, 63); assert.equal(parts.flatMap(part => part.fileIds).length, 1000); assert.equal(new Set(parts.flatMap(part => part.fileIds)).size, 1000);
  assert.ok(parts.every(part => part.fileIds.length <= MAX_OUTPUT_DELIVERY_DEFAULT_PART_FILES && part.payloadByteLength < MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES)); assert.deepEqual(planOutputDeliveryParts([...files].reverse(), input), parts);
});
test("65 actual accepted image files are delivered across five bounded ZIPs without erasing any obligation", async () => {
  const files = Array.from({ length: 65 }, (_, index) => asset(`image-${String(index).padStart(3, "0")}`, png({ width: 1, height: 1, raw: Uint8Array.from([0, index, 0, 0, 255]) }), `image-${index}.png`));
  const targets = files.map((file, index) => ({ targetId: `target-${index}`, fileId: file.id, acceptanceId: `acceptance-${index}` }));
  const input = { schemaVersion: 1, scopeHistoryComplete: true, scopeAmendments: [], planId: "images-plan", planRevision: "revision-1", createdAt: "2026-08-27T12:00:00.000Z", targets, scope: outputDeliveryScopeForPlan(manyTargets(65), { status: "complete", inventoryComplete: true, includedTargetIds: targets.map(row => row.targetId) }) };
  const parts = planOutputDeliveryParts(files.map(file => ({ id: file.id, byteLength: file.bytes.length })), input); assert.equal(parts.length, 5);
  const inventoried = new Set();
  for (const part of parts) {
    const selected = files.filter(file => part.fileIds.includes(file.id));
    const result = await createOutputDeliveryArchive(selected, { ...input, packagePart: { index: part.index, parts } }), { manifest, entries } = unpack(result);
    assert.equal(manifest.deliveryStatus, "complete"); assert.equal(manifest.scope.obligations.length, 65); assert.equal(manifest.summary.includedOwedTargets, 65); assert.equal(manifest.packagePart.containsCompletePackage, false); assert.deepEqual(manifest.missingWork, []);
    for (const delivered of manifest.files) { inventoried.add(delivered.id); const original = files.find(file => file.id === delivered.id); assert.deepEqual(entries.get(delivered.path), original.bytes); assert.equal(delivered.sha256, digest(original.bytes)); }
    assert.ok(result.bytes.length <= MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES);
  }
  assert.equal(inventoried.size, 65);
});
test("partitioning accounts for byte limits and manifest reserve, not just file count", () => {
  const files = [{ id: "large-a", byteLength: 17 * 1024 * 1024 }, { id: "large-b", byteLength: 17 * 1024 * 1024 }];
  const input = { schemaVersion: 1, scopeHistoryComplete: true, scopeAmendments: [], planId: "plan-1", planRevision: "revision-1", createdAt: "2026-08-27T12:00:00.000Z", targets: files.map((file, index) => ({ targetId: `target-${index}`, fileId: file.id, acceptanceId: `acceptance-${index}` })) };
  assert.equal(planOutputDeliveryParts(files, input).length, 2);
  const maximum = [{ id: "large-a", byteLength: 24_000_000 }], one = { ...input, targets: [input.targets[0]] }; assert.equal(planOutputDeliveryParts(maximum, one).length, 1);
  assert.throws(() => planOutputDeliveryParts([{ ...maximum[0], byteLength: 24_000_001 }], one), /invalid_output_delivery_package_file/);
});
test("each multipart ZIP retains whole-package scope without claiming this part contains all files", async () => {
  const files = [deck(), episode()], input = request(files, samplePlan({ series: false, optional: false }), "complete");
  const parts = files.map((file, index) => ({ index: index + 1, fileIds: [file.id], payloadByteLength: file.bytes.length }));
  for (const [index, file] of files.entries()) {
    const result = await createOutputDeliveryArchive([file], { ...input, packagePart: { index: index + 1, parts } }), { manifest, csv, entries } = unpack(result);
    assert.equal(manifest.deliveryStatus, "complete"); assert.equal(manifest.deliveryStatusScope, "entire_delivery_package"); assert.equal(manifest.packagePart.containsCompletePackage, false); assert.equal(manifest.packagePart.index, index + 1); assert.equal(manifest.packagePart.count, 2);
    assert.equal(manifest.targets.length, 2); assert.equal(manifest.scope.obligations.length, 2); assert.equal(manifest.files.length, 1); assert.equal(manifest.summary.includedOwedTargets, 2); assert.deepEqual(manifest.missingWork, []);
    assert.ok(csv.includes("all parts are needed")); assert.ok(csv.includes("included_in_other_part")); assert.ok(csv.includes('"file_in_other_part"')); assert.deepEqual(entries.get(manifest.files[0].path), file.bytes); assert.ok(result.bytes.length <= MAX_OUTPUT_DELIVERY_PAYLOAD_BYTES);
  }
});
test("part metadata cannot omit, duplicate, reassign or lie about the current file payload", async () => {
  const files = [deck(), episode()], input = request(files, samplePlan({ series: false, optional: false }), "complete"), parts = files.map((file, index) => ({ index: index + 1, fileIds: [file.id], payloadByteLength: file.bytes.length }));
  await assert.rejects(createOutputDeliveryArchive([files[0]], { ...input, packagePart: { index: 2, parts } }), /part_file_mismatch/);
  const wrongSize = structuredClone(parts); wrongSize[0].payloadByteLength += 1; await assert.rejects(createOutputDeliveryArchive([files[0]], { ...input, packagePart: { index: 1, parts: wrongSize } }), /part_file_mismatch/);
  const duplicate = structuredClone(parts); duplicate[1].fileIds = [files[0].id]; await assert.rejects(createOutputDeliveryArchive([files[0]], { ...input, packagePart: { index: 1, parts: duplicate } }), /duplicate_output_delivery_part_file/);
  const caseAlias = structuredClone(parts); caseAlias[1].fileIds = [files[1].id.toUpperCase()]; await assert.rejects(createOutputDeliveryArchive([files[0]], { ...input, packagePart: { index: 1, parts: caseAlias } }), /package_mapping_mismatch/);
  await assert.rejects(createOutputDeliveryArchive([files[0]], { ...input, packagePart: { index: 1, parts: [parts[0]] } }), /package_mapping_mismatch/);
});
test("160-character domain references survive real archives while file IDs stay bounded at 64", async () => {
  const requirementId = "r".repeat(148), groupId = "g".repeat(148), obligationId = "o".repeat(148), targetId = `${obligationId}:target:1000`;
  assert.equal(targetId.length, 160);
  const model = {
    groups: [{ id: groupId, requirement_id: requirementId, label: "Long identity image group", required: true, obligation_ids: [obligationId] }],
    obligations: [{ id: obligationId, requirement_id: requirementId, deliverable_id: groupId, label: "Long identity image", required: true, selected: true, resolution: "resolved", target_ids: [targetId] }],
    targets: [{ id: targetId, obligation_id: obligationId, label: "Last permitted finite target", blocking_issues: [] }], unresolved_groups: [], issues: [],
  };
  const file = asset("f".repeat(64), png(), "cover.png");
  const input = { schemaVersion: 1, scopeHistoryComplete: true, scopeAmendments: [], planId: "plan-1", planRevision: "revision-1", createdAt: "2026-08-27T12:00:00.000Z", targets: [{ targetId, fileId: file.id, acceptanceId: "acceptance-1" }], scope: outputDeliveryScopeForPlan(model, { status: "complete", inventoryComplete: true, includedTargetIds: [targetId] }) };
  const parts = planOutputDeliveryParts([{ id: file.id, byteLength: file.bytes.length }], input);
  const { manifest, csv, entries } = unpack(await createOutputDeliveryArchive([file], { ...input, packagePart: { index: 1, parts } }));
  assert.equal(manifest.deliveryStatus, "complete"); assert.equal(manifest.targets[0].targetId, targetId); assert.equal(manifest.scope.targets[0].id, targetId);
  assert.equal(manifest.scope.obligations[0].id, obligationId); assert.ok(csv.includes(targetId)); assert.deepEqual(entries.get(`files/${file.id}.png`), file.bytes);
  const maximumReferences = { ...input, planId: "p".repeat(160), planRevision: "v".repeat(160), targets: [{ ...input.targets[0], acceptanceId: "a".repeat(160) }] };
  const fullLength = unpack(await createOutputDeliveryArchive([file], maximumReferences)).manifest;
  assert.equal(fullLength.planId.length, 160); assert.equal(fullLength.planRevision.length, 160); assert.equal(fullLength.targets[0].acceptanceId.length, 160);
  await assert.rejects(createOutputDeliveryArchive([file], { ...input, planId: "p".repeat(161) }), /invalid_output_delivery_plan/);
  await assert.rejects(createOutputDeliveryArchive([file], { ...input, targets: [{ ...input.targets[0], targetId: "t".repeat(161) }] }), /invalid_output_delivery_target/);
  const oversizedScope = structuredClone(input); oversizedScope.scope.targets[0].id = "t".repeat(161);
  await assert.rejects(createOutputDeliveryArchive([file], oversizedScope), /invalid_output_delivery_scope_id/);
  const oversizedFile = { ...file, id: "f".repeat(65) };
  await assert.rejects(createOutputDeliveryArchive([oversizedFile], { ...input, targets: [{ ...input.targets[0], fileId: oversizedFile.id }] }), /invalid_output_delivery_target/);
});

test("runtime partition defaults leave request budget while explicit format limits stay bounded", () => {
  const files = Array.from({ length: 65 }, (_, index) => ({ id: `asset-${index}`, byteLength: 100 }));
  const input = { schemaVersion: 1, planId: "bounded-plan", planRevision: "revision-1", createdAt: "2026-08-27T12:00:00.000Z", targets: files.map((file, index) => ({ targetId: `target-${index}`, fileId: file.id, acceptanceId: `accepted-${index}` })) };
  assert.equal(MAX_OUTPUT_DELIVERY_DEFAULT_PART_FILES, 16); assert.equal(MAX_OUTPUT_DELIVERY_FILES, 64);
  assert.deepEqual(planOutputDeliveryParts(files, input).map(part => part.fileIds.length), [16, 16, 16, 16, 1]);
  assert.deepEqual(planOutputDeliveryParts(files, input, { maxFilesPerPart: 64 }).map(part => part.fileIds.length), [64, 1]);
  assert.equal(planOutputDeliveryParts(files, input, { maxFilesPerPart: 1 }).length, 65);
  for (const maxFilesPerPart of [0, -1, 65, 1.5, NaN, Infinity, null, "16"]) assert.throws(() => planOutputDeliveryParts(files, input, { maxFilesPerPart }), /invalid_output_delivery_part_file_limit/);
  assert.throws(() => planOutputDeliveryParts(files, input, null), /invalid_output_delivery_part_file_limit/);
});
