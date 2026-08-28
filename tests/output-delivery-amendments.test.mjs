import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createOutputDeliveryArchive, outputDeliveryScopeForPlan, planOutputDeliveryParts } from "../src/model/output-delivery-archive.ts";
import { OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH, OUTPUT_PLAN_TARGET_LABEL_MAX_LENGTH, isOutputRequirementLabel } from "../src/model/output-requirements.ts";
import { png, presentationEntries, readStoredZip, zip } from "./output-asset-fixtures.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const asset = (id, bytes, name) => ({ id, bytes, name, expectedSha256: digest(bytes) });
const deck = () => asset("slides-file", zip(presentationEntries({ slides: 5 })), "executive-summary.pptx");
const image = () => asset("cover-file", png(), "cover.png");
function request(files) {
  const targets = files.map(file => ({ targetId: `${file.id}:target:1`, fileId: file.id, acceptanceId: `accepted-${file.id}` }));
  const plan = {
    groups: files.map(file => ({ id: `${file.id}:group`, requirement_id: "executive-summary", label: file.name, required: true, obligation_ids: [`${file.id}:obligation`] })),
    obligations: files.map(file => ({ id: `${file.id}:obligation`, requirement_id: "executive-summary", deliverable_id: `${file.id}:group`, label: file.name, required: true, selected: true, resolution: "resolved", target_ids: [`${file.id}:target:1`] })),
    targets: files.map(file => ({ id: `${file.id}:target:1`, obligation_id: `${file.id}:obligation`, label: file.name, blocking_issues: [] })),
    unresolved_groups: [], issues: [],
  };
  return {
    schemaVersion: 1, deliveryId: "delivery-23", planId: "executive-plan", planRevision: "revision-3", createdAt: "2026-08-27T12:00:00.000Z", targets,
    scope: outputDeliveryScopeForPlan(plan, { status: "complete", inventoryComplete: true, includedTargetIds: targets.map(target => target.targetId) }),
    scopeHistoryComplete: true,
    scopeAmendments: [{
      id: "confirmation-2", previousPlanRevisionId: "revision-1", planRevisionId: "revision-2", occurredAt: "2026-08-27T11:00:00.000Z",
      reason: "Publish the slideshow first; the podcast and video series have been withdrawn from this assignment.", actorRole: "authorized_author",
      withdrawnObligations: [{ id: "podcast:obligation", label: "Podcast episode" }, { id: "series:membership", label: "Video series awaiting membership" }],
      withdrawnTargets: [{ id: "podcast:target:1", label: "Podcast episode 1" }],
    }],
  };
}
function parseCsv(text) {
  const rows = [], cells = []; let value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') { if (quoted && text[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; }
    else if (char === "," && !quoted) { cells.push(value); value = ""; }
    else if (char === "\r" && text[index + 1] === "\n" && !quoted) { cells.push(value); rows.push([...cells]); cells.length = 0; value = ""; index += 1; }
    else value += char;
  }
  assert.equal(quoted, false); assert.equal(value, "");
  const headers = rows.shift(); return rows.map(row => Object.fromEntries(headers.map((name, index) => [name, row[index]])));
}
function unpack(result) {
  const entries = readStoredZip(result.bytes), decoder = new TextDecoder();
  const json = decoder.decode(entries.get("manifest.json")), csv = decoder.decode(entries.get("manifest.csv"));
  return { entries, json, csv, manifest: JSON.parse(json), rows: parseCsv(csv) };
}

test("a deck-only amended delivery retains prior work without claiming its completion", async () => {
  const files = [deck()], input = request(files);
  input.scopeAmendments[0].actorUserId = "private-person-identifier";
  input.scopeAmendments[0].actorEmail = "private-person@example.invalid";
  input.scopeAmendments[0].withdrawnTargets[0].source_prose = "DO NOT EXPORT PRIVATE SOURCE";
  const { entries, manifest, json, csv, rows } = unpack(await createOutputDeliveryArchive(files, input));
  assert.equal(manifest.deliveryStatus, "complete_for_amended_scope"); assert.equal(manifest.currentScopeStatus, "complete"); assert.equal(manifest.scope.status, "complete");
  assert.equal(manifest.completionQualification, "complete_for_amended_scope"); assert.match(manifest.completionExplanation, /amended scope only/); assert.match(manifest.completionExplanation, /Withdrawal is not evidence of completion/);
  assert.equal(manifest.summary.owedTargets, 1); assert.equal(manifest.summary.fulfilledRequiredObligations, 1); assert.deepEqual(manifest.missingWork, []);
  assert.equal(manifest.scopeHistoryComplete, true); assert.equal(manifest.deliveryId, "delivery-23");
  const amendment = manifest.scopeAmendments[0];
  assert.equal(amendment.previousPlanRevisionId, "revision-1"); assert.equal(amendment.planRevisionId, "revision-2"); assert.equal(manifest.planRevision, "revision-3");
  assert.equal(amendment.actorRole, "authorized_author"); assert.equal(amendment.reason, input.scopeAmendments[0].reason);
  assert.deepEqual(amendment.withdrawnTargets, [{ id: "podcast:target:1", label: "Podcast episode 1", disposition: "withdrawn_from_previous_scope" }]);
  assert.ok(amendment.withdrawnObligations.some(row => row.id === "series:membership" && row.label === "Video series awaiting membership"));
  for (const secret of ["private-person", "actorUserId", "actorEmail", "DO NOT EXPORT PRIVATE SOURCE"]) { assert.ok(!json.includes(secret)); assert.ok(!csv.includes(secret)); }
  assert.equal(rows[0].delivery_status, "complete_for_amended_scope"); assert.equal(rows[0].current_scope_status, "complete"); assert.equal(rows[0].delivery_id, "delivery-23");
  assert.equal(rows.find(row => row.record_type === "scope_amendment").amendment_reason, amendment.reason);
  assert.equal(rows.filter(row => row.record_type === "withdrawn_obligation").length, 2);
  assert.equal(rows.find(row => row.record_type === "withdrawn_target").delivery_state, "withdrawn_from_previous_scope");
  assert.deepEqual(entries.get("files/slides-file.pptx"), files[0].bytes); assert.equal(manifest.files[0].sha256, digest(files[0].bytes));
  assert.deepEqual(manifest.files[0].limitationCodes, ["output_inspection_not_acceptance", "output_pptx_content_review_required"]);
});
test("complete current scope requires verified ancestry for an unqualified completion claim", async () => {
  const files = [deck()];
  for (const history of [{}, { scopeHistoryComplete: false, scopeAmendments: request(files).scopeAmendments }, { scopeAmendments: request(files).scopeAmendments }]) {
    const input = request(files); delete input.scopeHistoryComplete; delete input.scopeAmendments; Object.assign(input, history);
    const { manifest, rows } = unpack(await createOutputDeliveryArchive(files, input));
    assert.equal(manifest.deliveryStatus, "unknown"); assert.equal(manifest.currentScopeStatus, "complete"); assert.equal(manifest.scope.status, "complete"); assert.equal(manifest.summary.includedOwedTargets, 1);
    assert.equal(manifest.scopeHistoryComplete, false); assert.equal(manifest.completionQualification, "current_scope_complete_history_unknown"); assert.match(rows[0].label, /history is unverified/);
  }
  const verified = request(files); verified.scopeAmendments = [];
  const { manifest } = unpack(await createOutputDeliveryArchive(files, verified)); assert.equal(manifest.deliveryStatus, "complete"); assert.equal(manifest.completionQualification, "complete_for_current_scope");
});
test("withdrawals do not erase known missing current work or alter its summary counts", async () => {
  const files = [deck(), image()], input = request(files); input.targets.pop(); input.scope.status = "partial"; input.scope.targets[1].reasonCodes = ["not_included_in_delivery"];
  const { manifest, rows } = unpack(await createOutputDeliveryArchive([files[0]], input));
  assert.equal(manifest.deliveryStatus, "partial"); assert.equal(manifest.currentScopeStatus, "partial"); assert.equal(manifest.completionQualification, "partial_for_amended_scope");
  assert.equal(manifest.summary.owedTargets, 2); assert.equal(manifest.summary.missingOwedTargets, 1); assert.equal(manifest.missingWork[0].targetId, "cover-file:target:1");
  assert.equal(rows.find(row => row.record_type === "withdrawn_target").delivery_state, "withdrawn_from_previous_scope");
  input.scopeHistoryComplete = false;
  const unknownHistory = unpack(await createOutputDeliveryArchive([files[0]], input)).manifest;
  assert.equal(unknownHistory.deliveryStatus, "partial"); assert.equal(unknownHistory.completionQualification, "partial_scope_history_unknown"); assert.equal(unknownHistory.summary.missingOwedTargets, 1);
});
test("each real ZIP part pins the same delivery and amendment history", async () => {
  const files = [deck(), image()], input = request(files), parts = planOutputDeliveryParts(files.map(file => ({ id: file.id, byteLength: file.bytes.length })), input, { maxFilesPerPart: 1 });
  let history;
  for (const part of parts) {
    const file = files.find(file => part.fileIds.includes(file.id));
    const { manifest, entries, rows } = unpack(await createOutputDeliveryArchive([file], { ...input, packagePart: { index: part.index, parts } }));
    assert.equal(manifest.deliveryId, input.deliveryId); assert.equal(manifest.planRevision, input.planRevision); assert.equal(manifest.createdAt, input.createdAt);
    assert.equal(manifest.deliveryStatus, "complete_for_amended_scope"); assert.equal(manifest.summary.includedOwedTargets, 2); assert.equal(manifest.packagePart.containsCompletePackage, false);
    if (history) assert.deepEqual(manifest.scopeAmendments, history); else history = manifest.scopeAmendments;
    assert.equal(rows[0].delivery_id, input.deliveryId); assert.match(rows[0].label, /all parts are needed/); assert.equal(rows.filter(row => row.record_type === "scope_amendment").length, 1);
    assert.deepEqual(entries.get(manifest.files[0].path), file.bytes); assert.equal(manifest.files[0].sha256, digest(file.bytes));
  }
});
test("amendments snapshot authored reasons and neutralize formulas only in CSV cells", async () => {
  const files = [deck()], input = request(files), reason = '=HYPERLINK("https://example.invalid")\nAuthored second line';
  input.scopeAmendments[0].reason = reason; input.scopeAmendments[0].withdrawnTargets[0].label = "＠SUM(1+1)";
  const pending = createOutputDeliveryArchive(files, input);
  input.deliveryId = "mutated"; input.scopeHistoryComplete = false; input.scopeAmendments[0].reason = "mutated"; input.scopeAmendments.length = 0;
  const { manifest, rows } = unpack(await pending);
  assert.equal(manifest.deliveryId, "delivery-23"); assert.equal(manifest.deliveryStatus, "complete_for_amended_scope"); assert.equal(manifest.scopeAmendments[0].reason, reason);
  assert.equal(rows.find(row => row.record_type === "scope_amendment").amendment_reason, `'${reason}`);
  assert.equal(rows.find(row => row.record_type === "withdrawn_target").label, "'＠SUM(1+1)");
});
test("invalid, contradictory, oversized and future amendment records are rejected", async () => {
  const files = [deck()];
  const cases = [
    [input => { input.scopeHistoryComplete = "true"; }, /scope_history_flag/],
    [input => { input.scopeAmendments = null; }, /scope_amendments/],
    [input => { input.scopeAmendments[0] = null; }, /scope_amendment/],
    [input => { input.scopeAmendments[0].id = "e".repeat(161); }, /scope_id/],
    [input => { input.scopeAmendments[0].planRevisionId = "revision-1"; }, /history_conflict/],
    [input => { input.scopeAmendments[0].previousPlanRevisionId = input.planRevision; }, /history_conflict/],
    [input => { input.scopeAmendments[0].occurredAt = "2026-08-27T13:00:00.000Z"; }, /amendment_date/],
    [input => { input.scopeAmendments[0].occurredAt = "2026-02-30T11:00:00.000Z"; }, /amendment_date/],
    ...[" ", "x".repeat(2001), "bad\u0000reason", "bad\u202ereason"].map(reason => [input => { input.scopeAmendments[0].reason = reason; }, /amendment_reason/]),
    [input => { input.scopeAmendments[0].actorRole = "person@example.invalid"; }, /amendment_actor_role/],
    [input => { input.scopeAmendments[0].withdrawnObligations = []; input.scopeAmendments[0].withdrawnTargets = []; }, /empty_scope_amendment/],
    [input => { input.scopeAmendments.push(structuredClone(input.scopeAmendments[0])); }, /history_conflict/],
    [input => { input.scopeAmendments.push({ ...structuredClone(input.scopeAmendments[0]), id: "confirmation-3", previousPlanRevisionId: "revision-2", planRevisionId: "revision-1" }); }, /history_conflict/],
    [input => { input.scopeAmendments = Array(65).fill(input.scopeAmendments[0]); }, /scope_amendments/],
    [input => { input.deliveryId = "d".repeat(161); }, /invalid_output_delivery_id/],
  ];
  for (const [mutate, pattern] of cases) { const input = request(files); mutate(input); await assert.rejects(createOutputDeliveryArchive(files, input), pattern); }
});
test("history rows have a cumulative bound and reject overflow without dropping prior decisions", () => {
  const file = deck(), input = request([file]); input.planRevision = "final-revision";
  input.scopeAmendments = Array.from({ length: 64 }, (_, index) => ({
    id: `event-${index}`, previousPlanRevisionId: `revision-${index}`, planRevisionId: `revision-${index + 1}`, occurredAt: "2026-08-27T11:00:00.000Z", actorRole: "authorized_author", reason: "Remove the identified work from this assignment.",
    withdrawnObligations: [], withdrawnTargets: Array.from({ length: 65 }, (_, target) => ({ id: `old-${index}-${target}`, label: `Withdrawn target ${target}` })),
  }));
  const before = JSON.stringify(input);
  assert.throws(() => planOutputDeliveryParts([{ id: file.id, byteLength: file.bytes.length }], input), /scope_history_too_large/);
  assert.equal(JSON.stringify(input), before); assert.equal(input.scopeAmendments.flatMap(row => row.withdrawnTargets).length, 4160);
});
test("maximum authored and derived target labels survive actual JSON and CSV without truncation", async () => {
  assert.equal(OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH, 240); assert.equal(OUTPUT_PLAN_TARGET_LABEL_MAX_LENGTH, 245);
  const file = image(), input = request([file]), authored = "L".repeat(240), derived = `${authored} 1000`;
  assert.equal(isOutputRequirementLabel(authored), true); assert.equal(isOutputRequirementLabel(`${authored}L`), false);
  input.scope.groups[0].label = authored; input.scope.obligations[0].label = authored; input.scope.targets[0].label = derived;
  input.scopeAmendments[0].withdrawnObligations[0].label = authored; input.scopeAmendments[0].withdrawnTargets[0].label = derived; input.deliveryId = "d".repeat(160);
  const { manifest, rows } = unpack(await createOutputDeliveryArchive([file], input));
  assert.equal(manifest.deliveryId.length, 160); assert.equal(manifest.scope.targets[0].label, derived); assert.equal(manifest.scope.groups[0].label, authored);
  assert.equal(rows.find(row => row.record_type === "target").label, derived); assert.equal(rows.find(row => row.record_type === "withdrawn_target").label, derived);
  const tooLong = structuredClone(input); tooLong.scope.targets[0].label += "L"; await assert.rejects(createOutputDeliveryArchive([file], tooLong), /scope_label/);
  const authoredTooLong = structuredClone(input); authoredTooLong.scope.groups[0].label += "L"; await assert.rejects(createOutputDeliveryArchive([file], authoredTooLong), /scope_label/);
});
test("the full 1000-target maximum-label inventory fails metadata capacity explicitly and remains intact", () => {
  const count = 1000, authored = "L".repeat(240), requirementId = "r".repeat(148), files = [], targets = [], plan = { groups: [], obligations: [], targets: [], unresolved_groups: [], issues: [] };
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(4, "0"), groupId = "g".repeat(144) + suffix, obligationId = "o".repeat(144) + suffix, targetId = `${obligationId}:target:1000`, fileId = `asset-${suffix}`;
    files.push({ id: fileId, byteLength: 100 }); targets.push({ targetId, fileId, acceptanceId: "a".repeat(156) + suffix });
    plan.groups.push({ id: groupId, requirement_id: requirementId, label: authored, required: true, obligation_ids: [obligationId] });
    plan.obligations.push({ id: obligationId, requirement_id: requirementId, deliverable_id: groupId, label: authored, required: true, selected: true, resolution: "resolved", target_ids: [targetId] });
    plan.targets.push({ id: targetId, obligation_id: obligationId, label: `${authored} 1000`, blocking_issues: [] });
  }
  const input = { schemaVersion: 1, deliveryId: "large-delivery", planId: "large-plan", planRevision: "revision-1", createdAt: "2026-08-27T12:00:00.000Z", scopeHistoryComplete: true, scopeAmendments: [], targets, scope: outputDeliveryScopeForPlan(plan, { status: "complete", inventoryComplete: true, includedTargetIds: targets.map(row => row.targetId) }) };
  const before = JSON.stringify(input);
  assert.throws(() => planOutputDeliveryParts(files, input), /output_delivery_manifest_too_large/);
  assert.equal(JSON.stringify(input), before); assert.equal(input.targets.length, count); assert.equal(input.scope.obligations.length, count); assert.equal(input.scope.targets.length, count);
});
