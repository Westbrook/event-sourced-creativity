import test from "node:test";
import assert from "node:assert/strict";
import { confirmOutputRequirementInterpretation, copyOutputRequirement, outputRequirementWithWording, parseOutputRequirement, readOutputArtifactFormat, OUTPUT_PLAN_SCOPE_ITEM_MAX_COUNT } from "../src/model/output-requirements.ts";
import { compileOutputPlan, initialOutputTargetState, summarizeOutputPlan } from "../src/model/output-plan.ts";

const options = { document_id: "document", source_revision: "source-1", requirement_revision: "requirements-1" };
const executiveText = "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TickTok style videos outlining the various parts of the document.";
const executive = () => parseOutputRequirement({ id: "executive", Type: "Output", Subtype: "Executive summary", Content: executiveText }).spec;
const rawImages = () => parseOutputRequirement({ id: "images", type: "output", subtype: "Social media image", content: 'Output images at "1:1" carousels, "4:5" feed, "9:16" shorts, "16:9" thumbnails, "1.91:1" link cards.' }).spec;
const rawVideos = () => parseOutputRequirement({ id: "videos", type: "output", subtype: "Social media video", content: 'Output videos at "9:16" TickTok, "16:9" YouTube, "4:5" feeds, "1:1" optionally Facebook.' }).spec;
function images() {
  const spec = parseOutputRequirement({ id: "images", type: "output", subtype: "Social media image", content: 'Output images at "1:1" campaign, "4:5" campaign, "9:16" optionally campaign.' }).spec;
  spec.deliverables[0].coverage = { kind: "topics", topics: ["The approved campaign claim"] };
  for (const row of spec.deliverables[0].format_variants) row.quantity = { kind: "exact", unit: "image", value: 1 };
  return spec;
}
function accepted(target, overrides = {}) {
  return { ...initialOutputTargetState(target, "supported"), execution: "succeeded", checks: "passed", review: "accepted", freshness: "current", availability: "available", export_available: true, result_id: `result:${target.id}`, ...overrides };
}
function resolvedExecutive() {
  const spec = executive(), [deck, episode, series] = spec.deliverables;
  deck.content_quantity = { kind: "exact", unit: "slide", value: 6 };
  episode.content_quantity = { kind: "exact", unit: "second", value: 180 };
  series.content_quantity = { kind: "exact", unit: "second", value: 30 };
  series.series = { state: "resolved", description: "Two agreed topics; other Document topics remain out of scope for this series.", members: ["Findings", "Decision"].map((label, index) => ({ id: `member-${index + 1}`, label, required: true, source_scope: { kind: "blocks", block_ids: [`source-${index + 1}`] }, coverage: { kind: "topics", topics: [label] }, quantity: { kind: "exact", unit: "video", value: 1 }, original_text: `A short video about ${label}`, value_origins: { coverage: { kind: "confirmed", text: label } } })) };
  return spec;
}

test("five image and four video rows preserve eight required base obligations plus one optional", () => {
  const plan = compileOutputPlan([rawImages(), rawVideos()], options), summary = summarizeOutputPlan(plan);
  assert.deepEqual(plan.issues, []);
  assert.equal(summary.required_obligations, 8);
  assert.equal(summary.optional_obligations, 1);
  assert.equal(summary.selected_optional_obligations, 0);
  assert.equal(plan.targets.length, 0, "unknown file counts must not become nine files");
  assert.equal(summary.unresolved_required_groups, 8);
  assert.equal(summary.delivery_ready, false);
});

test("Executive summary retains three groups and unresolved membership after two outputs finish", () => {
  const spec = executive(), [deck, audio] = spec.deliverables;
  const plan = compileOutputPlan([spec], { ...options, count_policies: { [deck.id]: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 }, [audio.id]: { kind: "exact", unit: "second", value: 180 } } });
  assert.equal(plan.targets.length, 2);
  assert.equal(plan.unresolved_groups.length, 1);
  const summary = summarizeOutputPlan(plan, plan.targets.map((target) => accepted(target)));
  assert.equal(summary.required_groups, 3);
  assert.equal(summary.fulfilled_required_groups, 2);
  assert.equal(summary.required_obligations, 3);
  assert.equal(summary.completion, "unresolved");
  assert.equal(summary.delivery_ready, false);
});

test("a suggested slide count remains separate from the authored range and accepted discretion", () => {
  const spec = executive(), deck = spec.deliverables[0], before = structuredClone(spec);
  const plan = compileOutputPlan([spec], { ...options, suggested_counts: { [deck.id]: 8 }, count_policies: { [deck.id]: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 } } });
  const target = plan.targets.find((entry) => entry.media_kind === "slides");
  assert.deepEqual(target.content_quantity, { kind: "range", unit: "slide", min: 5, max: 15 });
  assert.equal(target.suggested_count, 8);
  assert.deepEqual(target.count_policy, { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 });
  assert.deepEqual(spec, before);
  const withoutPolicy = compileOutputPlan([spec], { ...options, suggested_counts: { [deck.id]: 8 } });
  assert.equal(withoutPolicy.targets[0].count_policy, null);
  assert.ok(withoutPolicy.targets[0].blocking_issues.some((entry) => entry.code === "content_count_policy_unresolved"));
});

test("policy widening is blocked before dispatch and cannot rescue an out-of-range result", () => {
  const spec = executive(), deck = spec.deliverables[0];
  const plan = compileOutputPlan([spec], { ...options, count_policies: { [deck.id]: { kind: "flexible", unit: "slide", min: 1, max: 50 } } });
  assert.ok(plan.targets[0].blocking_issues.some((entry) => entry.code === "count_policy_exceeds_authored_range"));
  assert.equal(summarizeOutputPlan(plan, plan.targets.map((target) => accepted(target))).delivery_ready, false);
});

test("a partial run does not remove required siblings from the assignment denominator", () => {
  const spec = images(), full = compileOutputPlan([spec], options);
  const plan = compileOutputPlan([spec], { ...options, selected_target_ids: [full.targets[0].id] });
  assert.equal(plan.targets.filter((target) => target.selected).length, 1);
  assert.equal(plan.obligations.filter((entry) => entry.required).length, 2);
  const states = plan.targets.map((target, index) => index === 0 ? accepted(target) : initialOutputTargetState(target, "supported"));
  const summary = summarizeOutputPlan(plan, states);
  assert.equal(summary.required_targets, 2);
  assert.equal(summary.fulfilled_required_obligations, 1);
  assert.equal(summary.completion, "partial");
  assert.equal(summary.delivery_ready, false);
  assert.ok(summary.next_actions.some((action) => action.kind === "resolve" && action.target_id === plan.targets[1].id), "partial run selection must not hide the next action for a required sibling");
});

test("optional work is off by default and missing unselected optional results do not block required completion", () => {
  const plan = compileOutputPlan([images()], options);
  assert.equal(plan.targets[2].selected, false);
  const summary = summarizeOutputPlan(plan, plan.targets.filter((entry) => entry.required).map((target) => accepted(target)));
  assert.equal(summary.selected_optional_obligations, 0);
  assert.equal(summary.completion, "complete");
  assert.equal(summary.delivery_ready, true);
  assert.ok(summary.next_actions.some((action) => action.kind === "download"));
});

test("selected optional failures remain part of the selected commitment", () => {
  const spec = images(), optional = spec.deliverables[0].format_variants[2];
  const plan = compileOutputPlan([spec], { ...options, selected_optional_ids: [optional.id] });
  const states = plan.targets.map((target) => target.required ? accepted(target) : { ...initialOutputTargetState(target, "supported"), execution: "failed" });
  const summary = summarizeOutputPlan(plan, states);
  assert.equal(summary.selected_optional_obligations, 1);
  assert.equal(summary.fulfilled_required_obligations, 2);
  assert.equal(summary.fulfilled_selected_optional_obligations, 0);
  assert.equal(summary.delivery_ready, false);
  assert.ok(summary.next_actions.some((action) => action.kind === "recover"));
});

test("deselecting all run targets does not erase optional scope already included in the plan", () => {
  const spec = images(), optional = spec.deliverables[0].format_variants[2];
  const plan = compileOutputPlan([spec], { ...options, selected_optional_ids: [optional.id], selected_target_ids: [] });
  assert.equal(plan.targets.filter((target) => target.selected).length, 0);
  assert.equal(summarizeOutputPlan(plan, plan.targets.map((target) => initialOutputTargetState(target, "supported"))).selected_optional_obligations, 1);
});

test("a successful job is not fulfillment without independent checks and acceptance", () => {
  const plan = compileOutputPlan([images()], options);
  for (const overrides of [{ checks: "failed" }, { review: "pending" }, { review: "rejected" }, { result_id: undefined }, { export_available: false }, { availability: "missing" }, { availability: "inaccessible" }, { freshness: "unknown" }, { freshness: "stale" }]) {
    const states = plan.targets.map((target) => accepted(target, overrides));
    assert.equal(summarizeOutputPlan(plan, states).delivery_ready, false, JSON.stringify(overrides));
  }
});

test("an accepted stored result can remain fulfilled even if a later attempt failed", () => {
  const plan = compileOutputPlan([images()], options);
  const summary = summarizeOutputPlan(plan, plan.targets.map((target) => accepted(target, { execution: "failed", capability: "unsupported" })));
  assert.equal(summary.delivery_ready, true, "generation capability and latest attempt state are not acceptance of an existing asset");
});

test("stale source or requirement bindings block reuse without authorizing regeneration", () => {
  const plan = compileOutputPlan([images()], options);
  for (const overrides of [{ source_revision: "source-old" }, { requirement_revision: "requirements-old" }]) {
    const summary = summarizeOutputPlan(plan, plan.targets.map((target) => accepted(target, overrides)));
    assert.equal(summary.delivery_ready, false);
    assert.ok(summary.next_actions.every((action) => action.kind !== "create" && action.kind !== "download"));
    assert.ok(summary.next_actions.some((action) => action.kind === "check"));
  }
});

test("loading, filtered, unavailable, stale, or mismatched scope never presents a false complete assignment", () => {
  const plan = compileOutputPlan([images()], options), states = plan.targets.map((target) => accepted(target));
  for (const availability of [{ state: "loading" }, { state: "partial" }, { state: "unavailable" }, { state: "stale" }, { state: "ready", requirement_revision: "old" }]) {
    const summary = summarizeOutputPlan(plan, states, availability);
    assert.equal(summary.required_obligations, 2);
    assert.equal(summary.scope_known, false);
    assert.equal(summary.completion, "unknown");
    assert.equal(summary.delivery_ready, false);
    assert.deepEqual(summary.next_actions.map((action) => action.kind), ["refresh"]);
  }
});

test("missing and duplicate result states are unknown rather than evidence of no prior operation", () => {
  const plan = compileOutputPlan([images()], options);
  const missing = summarizeOutputPlan(plan);
  assert.equal(missing.completion, "unknown");
  assert.equal(missing.next_actions[0].kind, "refresh");
  const states = plan.targets.map((target) => accepted(target));
  const duplicate = summarizeOutputPlan(plan, [...states, { ...states[0], checks: "failed" }]);
  assert.equal(duplicate.scope_known, false);
  assert.equal(duplicate.delivery_ready, false);
});

test("unknown series membership cannot be resolved by a count policy or an empty list", () => {
  const spec = executive(), series = spec.deliverables[2];
  const plan = compileOutputPlan([spec], { ...options, count_policies: { [series.id]: { kind: "exact", unit: "video", value: 3 } } });
  assert.equal(plan.targets.filter((target) => target.media_kind === "video").length, 0);
  assert.ok(plan.unresolved_groups.some((group) => group.issues.some((entry) => entry.code === "series_membership_unresolved")));
  series.series.state = "resolved";
  assert.ok(compileOutputPlan([spec], options).issues.some((entry) => entry.code === "empty_resolved_series"));
});

test("explicit series members retain their source coverage, order, and identities", () => {
  const spec = resolvedExecutive(), plan = compileOutputPlan([spec], options);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.groups.length, 3);
  assert.equal(plan.targets.length, 4);
  assert.equal(plan.unresolved_groups.length, 0);
  const videos = plan.targets.filter((target) => target.media_kind === "video");
  assert.deepEqual(videos.map((target) => target.member_id), ["member-1", "member-2"]);
  assert.deepEqual(videos.map((target) => target.source_scope.block_ids), [["source-1"], ["source-2"]]);
  assert.ok(videos.every((target) => target.coverage.kind === "topics" && !("depends_on" in target)));
  spec.deliverables[2].series.members.reverse();
  const reordered = compileOutputPlan([spec], options).targets.filter((target) => target.media_kind === "video");
  assert.deepEqual(reordered.map((target) => target.id), videos.map((target) => target.id).reverse());
});

test("compilation separates each target instruction from sibling deliverables", () => {
  const plan = compileOutputPlan([resolvedExecutive()], options);
  assert.doesNotMatch(plan.targets.find((target) => target.media_kind === "slides").instruction_text, /podcast|video|series/);
  assert.doesNotMatch(plan.targets.find((target) => target.media_kind === "audio").instruction_text, /slideshow|series/);
  assert.equal(plan.targets.find((target) => target.member_id === "member-1").instruction_text, "A short video about Findings");
});

test("finite limits leave unresolved obligations rather than silently dropping excess work", () => {
  const spec = images();
  spec.deliverables[0].format_variants[0].quantity.value = 3;
  const plan = compileOutputPlan([spec], { ...options, max_targets: 2 });
  assert.equal(plan.obligations.filter((entry) => entry.required).length, 2);
  assert.ok(plan.unresolved_groups.some((group) => group.issues.some((entry) => entry.code === "target_limit_exceeded")));
  assert.equal(summarizeOutputPlan(plan, plan.targets.map((target) => accepted(target))).delivery_ready, false);
});

test("unsupported schema, duplicate identity, or invalid source cannot create executable work", () => {
  const future = { schema_version: 2, id: "future", opaque: { retain: true } };
  const unsupported = compileOutputPlan([future], options);
  assert.equal(unsupported.targets.length, 0);
  assert.equal(summarizeOutputPlan(unsupported).completion, "unknown");
  const spec = images(), duplicate = compileOutputPlan([spec, structuredClone(spec)], options);
  assert.equal(duplicate.targets.length, 0);
  assert.ok(duplicate.issues.some((entry) => entry.code === "duplicate_scope_identity"));
  spec.deliverables[0].source_scope = { kind: "blocks", block_ids: [] };
  assert.equal(compileOutputPlan([spec], options).targets.length, 0);
});

test("copied requirements produce new target identities without inherited fulfillment", () => {
  const spec = images(), plan = compileOutputPlan([spec], options), copied = copyOutputRequirement(spec, "new-copy");
  const next = compileOutputPlan([copied.spec], { ...options, requirement_revision: "requirements-2" });
  assert.ok(next.targets.every((target) => !plan.targets.some((original) => original.id === target.id)));
  assert.equal(summarizeOutputPlan(next, plan.targets.map((target) => accepted(target))).delivery_ready, false);
});

test("unknown target selections and wrong-unit policies are errors, not silent interpretation changes", () => {
  const spec = images();
  assert.ok(compileOutputPlan([spec], { ...options, selected_target_ids: ["not-in-this-plan"] }).issues.some((entry) => entry.code === "unknown_target_selection"));
  assert.ok(compileOutputPlan([spec], { ...options, count_policies: { [spec.deliverables[0].id]: { kind: "exact", unit: "episode", value: 1 } } }).issues.some((entry) => entry.code === "count_policy_unit_mismatch"));
});

test("a duration policy can be preserved while video file counts remain unresolved", () => {
  const spec = rawVideos();
  const plan = compileOutputPlan([spec], { ...options, count_policies: { [spec.deliverables[0].id]: { kind: "exact", unit: "second", value: 30 } } });
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.targets.length, 0);
  assert.ok(plan.unresolved_groups.length > 0);
});

test("stored file checking and uncertain-attempt recovery precede any suggestion to create", () => {
  const plan = compileOutputPlan([images()], options);
  const stored = plan.targets.map((target) => ({ ...initialOutputTargetState(target, "supported"), availability: "available", execution: "succeeded", result_id: "stored" }));
  assert.ok(summarizeOutputPlan(plan, stored).next_actions.every((action) => action.kind === "check"));
  const uncertain = plan.targets.map((target) => ({ ...initialOutputTargetState(target, "supported"), execution: "uncertain" }));
  assert.ok(summarizeOutputPlan(plan, uncertain).next_actions.every((action) => action.kind === "recover"));
});

test("compilation snapshots are detached from later author edits", () => {
  const spec = images(), before = structuredClone(spec), plan = compileOutputPlan([spec], options);
  assert.deepEqual(spec, before);
  spec.deliverables[0].coverage.topics[0] = "A different claim";
  spec.deliverables[0].format_variants[0].aspect_ratio.width = 19;
  assert.equal(plan.targets[0].coverage.topics[0], "The approved campaign claim");
  assert.deepEqual(plan.targets[0].aspect_ratio, { width: 1, height: 1 });
});

test("no Output request is distinct from an empty or unrecognized request", () => {
  assert.equal(summarizeOutputPlan(compileOutputPlan([], options)).completion, "not_requested");
  const empty = parseOutputRequirement({ id: "blank", type: "output", content: "" }).spec;
  const summary = summarizeOutputPlan(compileOutputPlan([empty], options));
  assert.equal(summary.completion, "unresolved");
  assert.equal(summary.delivery_ready, false);
});

test("accepted physical file-count policy is retained beside its authored unknown quantity", () => {
  const spec = rawImages(), row = spec.deliverables[0].format_variants[0];
  const policy = { kind: "exact", unit: "image", value: 3 };
  const plan = compileOutputPlan([spec], { ...options, count_policies: { [row.id]: policy } });
  const obligation = plan.obligations.find((entry) => entry.id === row.id);
  assert.equal(obligation.quantity.kind, "unknown");
  assert.deepEqual(obligation.quantity_policy, policy);
  assert.equal(obligation.target_ids.length, 3);
  assert.equal(plan.targets[0].count_policy, null, "physical file count is distinct from internal content length");
  assert.deepEqual(plan.targets[0].coverage, { kind: "document_context" });
  policy.value = 9;
  assert.equal(obligation.quantity_policy.value, 3);
});

test("long safe requirement identities produce manifest-safe finite target identities", () => {
  const spec = copyOutputRequirement(images(), "a".repeat(148)).spec;
  const plan = compileOutputPlan([spec], options);
  assert.ok(plan.targets.every((target) => target.id.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(target.id)));
});

test("changed wording keeps finite members and policies but blocks every affected target until explicit review", () => {
  const spec = resolvedExecutive();
  spec.deliverables[0].content_quantity = { kind: "range", unit: "slide", min: 5, max: 15 };
  const confirmedOptions = { ...options, count_policies: { [spec.deliverables[0].id]: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 } }, suggested_counts: { [spec.deliverables[0].id]: 8 } };
  const original = compileOutputPlan([spec], confirmedOptions);
  const changed = outputRequirementWithWording(spec, executiveText.replace("TickTok", "TikTok"));
  const draft = compileOutputPlan([changed], confirmedOptions);
  assert.deepEqual(draft.issues, [], "wording mismatch is a valid retained draft, not discarded schema data");
  assert.equal(draft.groups.length, 3);
  assert.equal(draft.obligations.length, 4);
  assert.deepEqual(draft.targets.map((target) => target.id), original.targets.map((target) => target.id));
  assert.deepEqual(draft.targets.map((target) => target.count_policy), original.targets.map((target) => target.count_policy));
  assert.ok(draft.targets.every((target) => target.blocking_issues.some((entry) => entry.code === "interpretation_review_required")));
  assert.equal(summarizeOutputPlan(draft, draft.targets.map((target) => accepted(target))).delivery_ready, false);
  const explicit = confirmOutputRequirementInterpretation(changed);
  const next = compileOutputPlan([explicit], { ...confirmedOptions, requirement_revision: "requirements-2" });
  assert.equal(next.unresolved_groups.length, 0);
  assert.equal(next.targets.length, 4);
  assert.equal(summarizeOutputPlan(next, original.targets.map((target) => accepted(target))).delivery_ready, false, "acknowledging structure does not approve prior results for a new revision");
});

test("legacy basis absence blocks generation planning without deleting requested work", () => {
  const legacy = images();
  delete legacy.value_origins.interpretation_basis;
  const plan = compileOutputPlan([legacy], options);
  assert.equal(plan.obligations.length, 3);
  assert.equal(plan.targets.length, 3);
  assert.ok(plan.unresolved_groups.every((group) => group.issues.some((entry) => entry.code === "interpretation_review_required")));
  assert.ok(plan.targets.every((target) => target.blocking_issues.some((entry) => entry.code === "interpretation_review_required")));
  assert.equal(summarizeOutputPlan(plan, plan.targets.map((target) => accepted(target))).delivery_ready, false);
});

test("an interpretation acknowledgement never creates measured, checked, reviewed, or fulfilled output", () => {
  const spec = confirmOutputRequirementInterpretation(outputRequirementWithWording(images(), "A corrected image assignment."));
  const plan = compileOutputPlan([spec], options);
  assert.equal(plan.unresolved_groups.length, 0);
  const states = plan.targets.map((target) => initialOutputTargetState(target, "supported"));
  const summary = summarizeOutputPlan(plan, states);
  assert.equal(summary.fulfilled_targets, 0);
  assert.equal(summary.delivery_ready, false);
  assert.ok(states.every((state) => state.execution === "not_started" && state.checks === "not_checked" && state.review === "not_reviewed"));
});

test("the full authored label survives finite ordinal suffixes at the manifest boundary", () => {
  const spec = images();
  const row = spec.deliverables[0].format_variants[0]; row.label = "L".repeat(240); row.quantity.value = 1000;
  spec.deliverables[0].format_variants = [row];
  const plan = compileOutputPlan([spec], options);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.obligations[0].label, row.label);
  assert.equal(plan.targets.length, 1000);
  assert.equal(plan.targets.at(-1).label, `${row.label} 1000`);
  assert.equal(plan.targets.at(-1).label.length, 245);
  assert.equal(spec.deliverables[0].format_variants[0].label.length, 240);
});

test("an oversized requirement label fails before confirmation, while its original draft is untouched", () => {
  const spec = images(); spec.deliverables[0].label = "L".repeat(241);
  const before = structuredClone(spec), plan = compileOutputPlan([spec], options);
  assert.ok(plan.issues.some((entry) => entry.code === "label_too_long"));
  assert.equal(plan.targets.length, 0);
  assert.equal(summarizeOutputPlan(plan).scope_known, false);
  assert.equal(summarizeOutputPlan(plan).delivery_ready, false);
  assert.deepEqual(spec, before);
});

test("long unresolved series identities also fit the portable scope boundary", () => {
  const spec = executive(); spec.deliverables[2].id = "s".repeat(148);
  const plan = compileOutputPlan([spec], options);
  assert.deepEqual(plan.issues, []);
  assert.ok([...plan.groups, ...plan.obligations, ...plan.targets, ...plan.unresolved_groups].every((entry) => entry.id.length <= 160));
  assert.equal(plan.groups[2].id, spec.deliverables[2].id, "persisted identity must not be rewritten");
  assert.equal(plan.obligations.length, 3);
  assert.equal(plan.targets.length, 2);
});

test("a deliberately colliding derived membership ID is rejected before export", () => {
  const spec = executive(); spec.deliverables[0].id = `${spec.deliverables[2].id}:membership`;
  const plan = compileOutputPlan([spec], options);
  assert.ok(plan.issues.some((entry) => entry.code === "duplicate_plan_identity"));
  assert.equal(summarizeOutputPlan(plan).scope_known, false);
});

test("portable inventory capacity blocks confirmation without truncating any declared group or obligation", () => {
  assert.equal(OUTPUT_PLAN_SCOPE_ITEM_MAX_COUNT, 1024);
  const spec = rawImages(), seed = structuredClone(spec.deliverables[0]);
  delete seed.format_variants;
  spec.deliverables = Array.from({ length: OUTPUT_PLAN_SCOPE_ITEM_MAX_COUNT + 1 }, (_, index) => ({ ...structuredClone(seed), id: `image-group-${index}`, label: `Image group ${index + 1}` }));
  const before = structuredClone(spec), plan = compileOutputPlan([spec], options);
  assert.ok(plan.issues.some((entry) => entry.code === "plan_inventory_limit_exceeded"));
  assert.equal(plan.groups.length, 1025);
  assert.equal(plan.obligations.length, 1025);
  assert.equal(plan.unresolved_groups.length, 1025);
  assert.equal(plan.targets.length, 0);
  assert.equal(summarizeOutputPlan(plan).required_obligations, 1025);
  assert.equal(summarizeOutputPlan(plan).scope_known, false);
  assert.equal(summarizeOutputPlan(plan).delivery_ready, false);
  assert.deepEqual(spec, before);
  const boundary = structuredClone(spec); boundary.deliverables.pop();
  const boundaryPlan = compileOutputPlan([boundary], options);
  assert.deepEqual(boundaryPlan.issues, []);
  assert.equal(boundaryPlan.obligations.length, 1024);
  assert.equal(boundaryPlan.unresolved_groups.length, 1024);
});


function explicitDocumentPlanRequirement() {
  return { schema_version: 1, id: "document-output", label: "Document", original_text: "One document.",
    deliverables: [{ id: "document-deliverable", label: "Document", media_kind: "document", required: true,
      quantity: { kind: "exact", unit: "document", value: 1 }, source_scope: { kind: "document" },
      coverage: { kind: "document_context" }, original_text: "One document.", value_origins: {} }],
    value_origins: { interpretation_basis: { kind: "confirmed", text: "One document." } } };
}

test("explicit artifact format is independently retained on groups, obligations, and every finite target", () => {
  const spec = explicitDocumentPlanRequirement();
  spec.deliverables[0].artifact_format = { kind: "short_story", version: 1 };
  spec.deliverables[0].quantity.value = 2;
  const before = structuredClone(spec), plan = compileOutputPlan([spec], options);
  assert.deepEqual(plan.issues, []); assert.equal(plan.targets.length, 2);
  const records = [...plan.groups, ...plan.obligations, ...plan.targets];
  for (const record of records) {
    assert.deepEqual(record.artifact_format, { kind: "short_story", version: 1 });
    assert.deepEqual(readOutputArtifactFormat(record.artifact_format, record.media_kind), record.artifact_format);
    assert.notEqual(record.artifact_format, spec.deliverables[0].artifact_format);
  }
  assert.equal(new Set(records.map(record => record.artifact_format)).size, records.length);
  plan.targets[0].artifact_format.kind = "changed";
  for (const record of records.filter(record => record !== plan.targets[0])) assert.equal(record.artifact_format.kind, "short_story");
  assert.deepEqual(spec, before);
  const states = plan.targets.map(target => initialOutputTargetState(target));
  assert.ok(states.every(state => state.capability === "unknown" && state.execution === "not_started"));
  assert.equal(summarizeOutputPlan(plan, states).delivery_ready, false);
});

test("unqualified legacy document records retain exact serialization without artifact format defaults", () => {
  const plan = compileOutputPlan([explicitDocumentPlanRequirement()], options);
  assert.equal(JSON.stringify(plan.groups[0]), JSON.stringify({ id: "document-deliverable", requirement_id: "document-output", label: "Document", media_kind: "document", required: true, obligation_ids: ["document-deliverable"] }));
  assert.equal(JSON.stringify(plan.obligations[0]), JSON.stringify({ id: "document-deliverable", requirement_id: "document-output", deliverable_id: "document-deliverable", variant_id: null, member_id: null, label: "Document", media_kind: "document", required: true, selected: true, quantity: { kind: "exact", unit: "document", value: 1 }, quantity_policy: { kind: "exact", unit: "document", value: 1 }, target_ids: ["document-deliverable:target:1"], resolution: "resolved" }));
  assert.equal(JSON.stringify(plan.targets[0]), JSON.stringify({ id: "document-deliverable:target:1", requirement_id: "document-output", deliverable_id: "document-deliverable", obligation_id: "document-deliverable", variant_id: null, member_id: null, label: "Document", media_kind: "document", required: true, selected: true, ordinal: 1, quantity: { kind: "exact", unit: "document", value: 1 }, aspect_ratio: null, source_scope: { kind: "document" }, coverage: { kind: "document_context" }, content_quantity: null, count_policy: null, suggested_count: null, instruction_text: "One document.", source_revision: "source-1", requirement_revision: "requirements-1", blocking_issues: [] }));
  assert.ok([...plan.groups, ...plan.obligations, ...plan.targets].every(record => !Object.hasOwn(record, "artifact_format")));
});

test("present-invalid or incompatible artifact formats never compile as an unqualified target", () => {
  for (const format of [undefined, null, {}, { kind: "short_story", version: 0 }, { kind: "short_story", version: 2 }, { kind: "scene", version: 1 }, { kind: "short_story", version: 1, route: "caller" }]) {
    const spec = explicitDocumentPlanRequirement(); spec.deliverables[0].artifact_format = format;
    const plan = compileOutputPlan([spec], options);
    assert.ok(plan.issues.some(issue => issue.code === "invalid_artifact_format"));
    assert.equal(plan.targets.length, 0); assert.equal(summarizeOutputPlan(plan).scope_known, false);
  }
  const incompatible = images(); incompatible.deliverables[0].artifact_format = { kind: "short_story", version: 1 };
  const plan = compileOutputPlan([incompatible], options);
  assert.ok(plan.issues.some(issue => issue.code === "invalid_artifact_format")); assert.equal(plan.targets.length, 0);
});
