import test from "node:test";
import assert from "node:assert/strict";
import {
  moveOutputDraftRow, outputDraftLines, outputMediaQuantityUnit, outputQuantityToDraft,
  parseOutputDraftInteger, readOutputCountPolicyDraft, readOutputQuantityDraft, outputSaveReplyCanCloseDraft,
  compareOutputInterpretations, outputInterpretationDecisions, retainOutputInterpretationPlanning, outputReinterpretationNeedsConfirmation,
} from "../src/components/output-requirement-editor.ts";
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES } from "../src/components/design-system/locales/output-requirement-messages.ts";
import {
  parseOutputRequirement, outputRequirementWithWording, outputRequirementInterpretationNeedsReview,
  confirmOutputRequirementInterpretation, inspectOutputRequirement,
} from "../src/model/output-requirements.ts";

test("cleared exact counts remain unknown instead of becoming zero or the preceding value", () => {
  const draft = outputQuantityToDraft({ kind: "exact", unit: "image", value: 4 });
  draft.exact = "";
  assert.deepEqual(readOutputQuantityDraft(draft), { quantity: { kind: "unknown", unit: "image" }, issue: null });
  assert.equal(draft.exact, "");
  assert.deepEqual(outputQuantityToDraft(readOutputQuantityDraft(draft).quantity), { kind: "unknown", unit: "image", exact: "", min: "", max: "" });
});

test("an empty range is unresolved but a partially filled range is an editable validation issue", () => {
  const draft = { kind: "range", unit: "slide", min: "", max: "", exact: "" };
  assert.deepEqual(readOutputQuantityDraft(draft), { quantity: { kind: "unknown", unit: "slide" }, issue: null });
  draft.min = "5";
  assert.equal(readOutputQuantityDraft(draft).issue, "rangeIncomplete");
  assert.equal(draft.min, "5");
  assert.equal(draft.max, "");
});

test("fractional seconds remain duration values rather than invalid file counts", () => {
  const draft = outputQuantityToDraft({ kind: "exact", unit: "second", value: 4.5 });
  assert.deepEqual(readOutputQuantityDraft(draft), { quantity: { kind: "exact", unit: "second", value: 4.5 }, issue: null });
  draft.exact = "";
  assert.deepEqual(readOutputQuantityDraft(draft), { quantity: { kind: "unknown", unit: "second" }, issue: null });
});

test("late successful replies cannot close newer local edits", () => {
  assert.equal(outputSaveReplyCanCloseDraft("request-a", "request-a", 4, 4), true);
  assert.equal(outputSaveReplyCanCloseDraft("request-a", "request-a", 5, 4), false);
  assert.equal(outputSaveReplyCanCloseDraft("request-a", "request-b", 4, 4), false);
  assert.equal(outputSaveReplyCanCloseDraft(undefined, undefined, 4, undefined), false);
});

test("invalid numeric strings are preserved and never coerced into valid counts", () => {
  for (const value of ["", " ", "0", "-1", "1.1", "1e2", "Infinity", "NaN", "0x10", "5a", "9007199254740992"]) assert.equal(parseOutputDraftInteger(value), null, value);
  for (const value of ["1", "8", " 15 "]) assert.ok(parseOutputDraftInteger(value) > 0, value);
  const draft = { kind: "exact", unit: "video", exact: "1e2", min: "", max: "" };
  assert.equal(readOutputQuantityDraft(draft).issue, "positiveInteger");
  assert.equal(draft.exact, "1e2");
});

test("authored 5–15 stays a range when a plan aims for 8", () => {
  const authored = { kind: "range", unit: "slide", min: 5, max: 15 };
  const result = readOutputCountPolicyDraft(authored, { kind: "flexible", aim: "8", exact: "" });
  assert.deepEqual(result, { policy: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 }, suggestedCount: 8, issue: null });
  assert.deepEqual(authored, { kind: "range", unit: "slide", min: 5, max: 15 });
});

test("an exact planned count is deliberate and bounded by the authored range", () => {
  const authored = { kind: "range", unit: "slide", min: 5, max: 15 };
  assert.deepEqual(readOutputCountPolicyDraft(authored, { kind: "exact", aim: "8", exact: "8" }), { policy: { kind: "exact", unit: "slide", value: 8 }, suggestedCount: 8, issue: null });
  assert.equal(readOutputCountPolicyDraft(authored, { kind: "exact", aim: "8", exact: "" }).issue, "positiveInteger");
  assert.equal(readOutputCountPolicyDraft(authored, { kind: "exact", aim: "8", exact: "16" }).issue, "outsideRange");
  assert.equal(readOutputCountPolicyDraft(authored, { kind: "flexible", aim: "4", exact: "" }).issue, "outsideRange");
});

test("an omitted aim preserves flexible acceptance without inventing an exact count", () => {
  assert.deepEqual(readOutputCountPolicyDraft({ kind: "range", unit: "slide", min: 5, max: 15 }, { kind: "flexible", aim: "", exact: "" }), {
    policy: { kind: "flexible", unit: "slide", min: 5, max: 15 }, suggestedCount: null, issue: null,
  });
});

test("reversed ranges fail without rewriting either bound", () => {
  const draft = { kind: "range", unit: "slide", min: "15", max: "5", exact: "" };
  assert.equal(readOutputQuantityDraft(draft).issue, "rangeOrder");
  assert.equal(draft.min, "15");
  assert.equal(draft.max, "5");
});

test("series reordering preserves stable identities and original objects", () => {
  const rows = [{ id: "first", label: "Audience" }, { id: "second", label: "Evidence" }, { id: "third", label: "Decision" }];
  const moved = moveOutputDraftRow(rows, "second", -1);
  assert.deepEqual(moved.map((row) => row.id), ["second", "first", "third"]);
  assert.equal(moved[0], rows[1]);
  assert.deepEqual(rows.map((row) => row.id), ["first", "second", "third"]);
  assert.deepEqual(moveOutputDraftRow(rows, "first", -1), rows);
  assert.deepEqual(moveOutputDraftRow(rows, "missing", 1), rows);
});

test("topic and placement interpretation does not invent one member per block", () => {
  assert.deepEqual(outputDraftLines("Audience\n\nEvidence\r\nDecision  "), ["Audience", "Evidence", "Decision"]);
  assert.deepEqual(outputDraftLines("\n  \n"), []);
  assert.equal(outputMediaQuantityUnit("slides"), "presentation");
  assert.equal(outputMediaQuantityUnit("audio"), "episode");
  assert.equal(outputMediaQuantityUnit("unknown"), "member");
});

test("all four output catalogs contain complete copy with identical interpolation slots", () => {
  const english = FORMA_OUTPUT_REQUIREMENT_MESSAGES.en;
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]).sort();
  assert.ok(Object.keys(english).length > 100);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_REQUIREMENT_MESSAGES)) {
    assert.deepEqual(Object.keys(messages), Object.keys(english), locale);
    for (const [key, source] of Object.entries(english)) {
      assert.ok(messages[key]?.trim(), `${locale}/${key}`);
      assert.deepEqual(placeholders(messages[key]), placeholders(source), `${locale}/${key}`);
    }
  }
  for (const locale of ["fr", "ar", "ja"]) {
    for (const key of ["heading", "noGeneration", "conflict", "unsupported", "fixtureNotice"]) {
      assert.notEqual(FORMA_OUTPUT_REQUIREMENT_MESSAGES[locale][`output.requirement.${key}`], english[`output.requirement.${key}`], `${locale}/${key}`);
    }
  }
});

const executiveText = "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TickTok style videos outlining the various parts of the document.";
function structuredExecutive() {
  const spec = parseOutputRequirement({ id: "review-requirement", Type: "Output", Subtype: "Executive summary", Content: executiveText }).spec;
  const deck = spec.deliverables.find((group) => group.media_kind === "slides");
  const audio = spec.deliverables.find((group) => group.media_kind === "audio");
  const videos = spec.deliverables.find((group) => group.series);
  deck.label = "Board evidence";
  audio.content_quantity = { kind: "exact", unit: "second", value: 120 };
  videos.quantity = { kind: "exact", unit: "video", value: 3 };
  videos.coverage = { kind: "topics", topics: ["Audience", "Evidence", "Decision"] };
  videos.series = { state: "resolved", description: "Three approved topics", members: ["Audience", "Evidence", "Decision"].map((label, index) => ({
    id: `authored-member-${index + 1}`, label, required: true, source_scope: { kind: "blocks", block_ids: [`source-${index + 1}`] },
    coverage: { kind: "topics", topics: [label] }, quantity: { kind: "exact", unit: "video", value: 1 }, original_text: `Explain ${label}.`, value_origins: { coverage: { kind: "authored" } },
  })) };
  const planning = { countPolicies: { [deck.id]: { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 }, [`${audio.id}:second`]: { kind: "exact", unit: "second", value: 120 } }, suggestedCounts: { [deck.id]: 8, [`${audio.id}:second`]: 120 } };
  assert.equal(inspectOutputRequirement(spec).status, "valid");
  return { spec, planning, deckId: deck.id, audioId: audio.id, videoId: videos.id };
}

test("persisted decisions always require replacement review even in a clean edit session", () => {
  const { spec } = structuredExecutive();
  assert.equal(outputReinterpretationNeedsConfirmation(spec, false), true);
  assert.equal(outputReinterpretationNeedsConfirmation({ ...spec, deliverables: [] }, false), false);
  assert.equal(outputReinterpretationNeedsConfirmation({ ...spec, deliverables: [] }, true), true);
});

test("wording-only updates preserve authored series, quantities, coverage, identities, and planning choices", () => {
  const { spec, planning } = structuredExecutive();
  const before = structuredClone(spec);
  const wording = executiveText.replace("TickTok", "TikTok");
  const updated = outputRequirementWithWording(spec, wording);
  assert.equal(updated.original_text, wording);
  assert.deepEqual(updated.deliverables, before.deliverables);
  assert.deepEqual(updated.value_origins, before.value_origins);
  assert.deepEqual(spec, before);
  assert.deepEqual(retainOutputInterpretationPlanning(spec, updated, planning), planning);
  assert.equal(outputRequirementInterpretationNeedsReview(updated), true);
  const confirmed = confirmOutputRequirementInterpretation(updated);
  assert.equal(outputRequirementInterpretationNeedsReview(confirmed), false);
  assert.deepEqual(confirmed.deliverables, before.deliverables);
  assert.deepEqual(retainOutputInterpretationPlanning(spec, confirmed, planning), planning);
});

test("semantic wording changes remain visibly reviewable until explicit retained-contract acceptance", () => {
  const { spec, planning } = structuredExecutive();
  const updated = outputRequirementWithWording(spec, executiveText.replace("one podcast episode", "two podcast episodes"));
  assert.equal(updated.deliverables.find((group) => group.media_kind === "audio").quantity.value, 1);
  assert.equal(outputRequirementInterpretationNeedsReview(updated), true);
  const decisions = outputInterpretationDecisions(updated, planning);
  assert.ok(decisions.some((row) => row.field === "quantity" && row.value.kind === "exact" && row.value.unit === "episode" && row.value.value === 1));
  assert.ok(decisions.some((row) => row.field === "instructions" && String(row.value).includes("two podcast episodes")));
  assert.equal(outputRequirementInterpretationNeedsReview(confirmOutputRequirementInterpretation(updated)), false);
});

test("a typo-only reparse exposes the manual decisions it would discard without mutating them", () => {
  const { spec, planning, audioId, deckId } = structuredExecutive();
  const untouched = structuredClone(spec);
  const proposed = parseOutputRequirement({ id: spec.id, Type: "Output", Subtype: spec.label, Content: executiveText.replace("TickTok", "TikTok") }, spec).spec;
  const retainedPlanning = retainOutputInterpretationPlanning(spec, proposed, planning);
  const changes = compareOutputInterpretations(spec, proposed, planning, retainedPlanning);
  for (const id of ["authored-member-1", "authored-member-2", "authored-member-3"]) {
    assert.ok(changes.some((row) => row.ownerId === id && row.field === "identity" && row.kind === "removed"), id);
    assert.ok(changes.some((row) => row.ownerId === id && row.field === "coverage" && row.kind === "removed"), id);
    assert.ok(changes.some((row) => row.ownerId === id && row.field === "source" && row.kind === "removed"), id);
  }
  assert.ok(changes.some((row) => row.field === "series" && row.before.state === "resolved" && row.after.state === "unresolved"));
  assert.ok(changes.some((row) => row.ownerId === audioId && row.field === "contentQuantity" && row.before.value === 120 && row.after.kind === "unknown"));
  assert.ok(changes.some((row) => row.ownerId === audioId && row.field === "countPolicy" && row.kind === "removed"));
  assert.equal(retainedPlanning.suggestedCounts[deckId], 8);
  assert.equal(retainedPlanning.countPolicies[`${audioId}:second`], undefined);
  assert.deepEqual(spec, untouched);
});

test("whole-spec conflict comparison exposes concurrent quantities, membership order, coverage, sources, and planning losses", () => {
  const { spec: draft, planning: draftPlanning, audioId, videoId, deckId } = structuredExecutive();
  const latest = structuredClone(draft), latestPlanning = structuredClone(draftPlanning);
  latest.deliverables.find((group) => group.id === audioId).quantity.value = 2;
  const series = latest.deliverables.find((group) => group.id === videoId).series;
  series.members.reverse();
  series.members[0].required = false;
  series.members[0].coverage = { kind: "topics", topics: ["Risks"] };
  series.members[0].source_scope = { kind: "document" };
  latestPlanning.countPolicies[deckId].aim = 9;
  latestPlanning.suggestedCounts[deckId] = 9;
  const changes = compareOutputInterpretations(latest, draft, latestPlanning, draftPlanning);
  assert.ok(changes.some((row) => row.ownerId === audioId && row.field === "quantity" && row.before.value === 2 && row.after.value === 1));
  assert.ok(changes.some((row) => row.ownerId === videoId && row.field === "members"));
  for (const field of ["required", "coverage", "source"]) assert.ok(changes.some((row) => row.ownerId === "authored-member-3" && row.field === field), field);
  assert.ok(changes.some((row) => row.ownerId === deckId && row.field === "suggestedCount" && row.before === 9 && row.after === 8));
  assert.ok(changes.some((row) => row.ownerId === deckId && row.field === "countPolicy"));
});

test("comparison includes format identity, exact ratio, optionality, quantity, and order", () => {
  const before = parseOutputRequirement({ id: "image-review", Type: "Output", Subtype: "Social media image", Content: 'Output images at aspect ratios "1:1" Instagram, "1.91:1" link cards' }).spec;
  before.deliverables[0].format_variants[1].quantity = { kind: "exact", unit: "image", value: 2 };
  const after = structuredClone(before);
  after.deliverables[0].format_variants.reverse();
  after.deliverables[0].format_variants[0].aspect_ratio = { width: 16, height: 9 };
  after.deliverables[0].format_variants[0].required = false;
  after.deliverables[0].format_variants[0].quantity = { kind: "unknown", unit: "image" };
  const changes = compareOutputInterpretations(before, after, { countPolicies: {}, suggestedCounts: {} }, { countPolicies: {}, suggestedCounts: {} });
  for (const field of ["formats", "ratio", "required", "quantity"]) assert.ok(changes.some((row) => row.field === field), field);
  assert.deepEqual(changes.find((row) => row.field === "ratio").before, { width: 191, height: 100 });
});

test("a missing legacy interpretation basis stays missing through wording-only saves", () => {
  const { spec } = structuredExecutive();
  delete spec.value_origins.interpretation_basis;
  const updated = outputRequirementWithWording(spec, `${spec.original_text}\n`);
  assert.equal(updated.value_origins.interpretation_basis, undefined);
  assert.equal(outputRequirementInterpretationNeedsReview(updated), true);
  assert.equal(outputRequirementInterpretationNeedsReview(confirmOutputRequirementInterpretation(updated)), false);
});

test("comparison ignores object key order but preserves ordered series decisions", () => {
  const { spec, planning } = structuredExecutive();
  const same = structuredClone(spec);
  same.deliverables[0].quantity = { value: 1, unit: "presentation", kind: "exact" };
  assert.deepEqual(compareOutputInterpretations(spec, same, planning, planning), []);
  const reversed = structuredClone(spec);
  reversed.deliverables.find((value) => value.series).series.members.reverse();
  assert.ok(compareOutputInterpretations(spec, reversed, planning, planning).some((row) => row.field === "members"));
});
