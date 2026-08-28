import test from "node:test";
import assert from "node:assert/strict";
import {
  copyOutputRequirement, formatOutputAspectRatio, inspectOutputRequirement, isOutputContextType,
  outputCountSatisfies, parseOutputAspectRatio, parseOutputQuantityInput, parseOutputRequirement, isOutputRequirementId,
  partitionOutputContext, validateOutputCountPolicy,
  confirmOutputRequirementInterpretation, outputRequirementInterpretationBasis,
  outputRequirementInterpretationNeedsReview, outputRequirementWithWording,
  deriveOutputRequirementId, isOutputRequirementLabel, outputRequirementEditableDraft,
  OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH, OUTPUT_PLAN_TARGET_LABEL_MAX_LENGTH,
} from "../src/model/output-requirements.ts";

const imageText = 'Output images at aspect ratios "1:1" Instagram and other carousels, "4:5" Meta at large, "9:16" shorts, reels, and TickTok, "16:9" YouTube recommendation thumbnails, "1.91:1" Facebook and X link preview cards';
const videoText = 'Output videos at aspect ratios "9:16" for TickTok, "16:9" for YouTube, "4:5" for Facebook/Instagram feeds, and "1:1" optionally for additional Facebook usage.';
const executiveText = "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TickTok style videos outlining the various parts of the document.";
const parse = (subtype, content, id = "output") => parseOutputRequirement({ id, Type: "Output", Subtype: subtype, Content: content });
const imageSpec = () => parse("Social media image", imageText).spec;
const videoSpec = () => parse("Social media video", videoText).spec;
const executiveSpec = () => parse("Executive summary", executiveText).spec;
const identities = (spec) => [spec.id, ...spec.deliverables.flatMap((entry) => [entry.id, ...(entry.format_variants ?? []).map((row) => row.id), ...(entry.series?.members ?? []).map((row) => row.id)])];

test("Output imports accept case variants without confusing ordinary Format blocks", () => {
  for (const type of ["Output", "OUtput", "OUTPUT", " output "]) {
    assert.equal(isOutputContextType(type), true);
    assert.equal(parseOutputRequirement({ id: "output", tYPe: type, suBType: "Social media image", coNTent: imageText }).recognized, true);
  }
  assert.equal(parseOutputRequirement({ id: "output", type: "format", content: imageText }).spec, null);
  assert.equal(parseOutputRequirement({ id: "output", type: "output", Type: "format", content: imageText }).spec, null);
});

test("the image example retains five required geometries without inventing file or carousel counts", () => {
  const result = parse("Social media image", imageText), entry = result.spec.deliverables[0];
  assert.equal(result.needs_confirmation, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.spec.original_text, imageText);
  assert.equal(entry.media_kind, "image");
  assert.deepEqual(entry.format_variants.map((row) => formatOutputAspectRatio(row.aspect_ratio)), ["1:1", "4:5", "9:16", "16:9", "191:100"]);
  assert.ok(entry.format_variants.every((row) => row.required && row.quantity.kind === "unknown" && row.quantity.unit === "image"));
  assert.equal(entry.quantity.kind, "unknown");
  assert.deepEqual(entry.source_scope, { kind: "document" });
  assert.equal(entry.format_variants[4].value_origins.aspect_ratio.text, "1.91:1");
  assert.equal(entry.coverage.kind, "document_context");
  assert.equal(entry.value_origins.coverage.kind, "interpreted");
  assert.match(entry.value_origins.coverage.text, /does not assert exhaustive/);
});

test("the video example retains three required formats and a distinct optional square", () => {
  const result = parse("Social media video", videoText), entry = result.spec.deliverables[0];
  assert.equal(result.spec.original_text, videoText);
  assert.deepEqual(entry.format_variants.map((row) => [formatOutputAspectRatio(row.aspect_ratio), row.required]), [["9:16", true], ["16:9", true], ["4:5", true], ["1:1", false]]);
  assert.ok(entry.format_variants.every((row) => row.quantity.kind === "unknown" && row.quantity.unit === "video"));
  assert.equal(entry.content_quantity.kind, "unknown");
  assert.equal(entry.content_quantity.unit, "second");
  assert.deepEqual(entry.coverage, { kind: "document_context" });
  assert.doesNotMatch(JSON.stringify(result.spec), /provider|execution_grant|accepted_result/);
});

test("Executive summary is cumulative media groups, not a production chain or three finished files", () => {
  const result = parse("Executive summary", executiveText), [deck, episode, series] = result.spec.deliverables;
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.spec.deliverables.map((entry) => entry.media_kind), ["slides", "audio", "video"]);
  assert.deepEqual(deck.quantity, { kind: "exact", unit: "presentation", value: 1 });
  assert.deepEqual(deck.content_quantity, { kind: "range", unit: "slide", min: 5, max: 15 });
  assert.deepEqual(episode.quantity, { kind: "exact", unit: "episode", value: 1 });
  assert.deepEqual(series.series.members, []);
  assert.equal(series.series.state, "unresolved");
  assert.equal(series.coverage.kind, "unresolved");
  assert.equal(series.quantity.kind, "unknown");
  assert.ok(result.spec.deliverables.every((entry) => entry.required && entry.source_scope.kind === "document"));
  assert.doesNotMatch(deck.original_text, /podcast|series/);
  assert.doesNotMatch(episode.original_text, /slideshow|series/);
  assert.ok(result.spec.deliverables.every((entry) => !("depends_on" in entry)));
});

test("every example round-trips as the same schema and exact original prose", () => {
  for (const spec of [imageSpec(), videoSpec(), executiveSpec()]) {
    const restored = JSON.parse(JSON.stringify(spec));
    const inspected = inspectOutputRequirement(restored);
    assert.equal(inspected.status, "valid");
    assert.deepEqual(inspected.spec, spec);
  }
});

test("unknown future schemas remain preserved and uninterpreted", () => {
  const future = { schema_version: 20, id: "future", future_deliverable_contract: { nested: ["retain me"] } };
  const result = inspectOutputRequirement(future);
  assert.equal(result.status, "unsupported");
  assert.equal(result.spec, null);
  assert.deepEqual(result.preserved, future);
  assert.equal(result.issues[0].code, "unsupported_schema_version");
  assert.equal(inspectOutputRequirement({ ...future, schema_version: "20" }).status, "invalid");
  assert.equal(inspectOutputRequirement({ ...future, schema_version: 0 }).status, "invalid");
});

test("unsupported v1 fields and implicit authority are rejected instead of discarded", () => {
  const spec = imageSpec();
  spec.deliverables[0].provider_approval = true;
  spec.execution_grant = { authorized: true, amount: 100 };
  const result = inspectOutputRequirement(spec);
  assert.equal(result.status, "invalid");
  assert.equal(result.spec, null);
  assert.equal(result.preserved.execution_grant.authorized, true);
  assert.equal(result.issues.filter((entry) => entry.code === "unsupported_field").length, 2);
});

test("strict validation rejects invalid units, ranges, identities, and numeric coercion", () => {
  const mutations = [
    (spec) => { spec.deliverables[0].quantity = { kind: "exact", unit: "presentation", value: "1" }; },
    (spec) => { spec.deliverables[0].quantity = { kind: "exact", unit: "slide", value: 1 }; },
    (spec) => { spec.deliverables[0].content_quantity = { kind: "range", unit: "slide", min: 15, max: 5 }; },
    (spec) => { spec.deliverables[0].content_quantity = { kind: "exact", unit: "slide", value: 1.5 }; },
    (spec) => { spec.deliverables[0].content_quantity = { kind: "exact", unit: "slide", value: 0 }; },
    (spec) => { spec.deliverables[1].id = spec.deliverables[0].id; },
    (spec) => { spec.deliverables[0].required = "true"; },
    (spec) => { spec.deliverables[0].value_origins.quantity.kind = "provider_approved"; },
    (spec) => { spec.deliverables[0].content_quantity = { kind: "unknown", unit: "slide", value: 8 }; },
  ];
  for (const mutate of mutations) { const spec = executiveSpec(); mutate(spec); assert.equal(inspectOutputRequirement(spec).status, "invalid", mutate.toString()); }
});

test("missing and invalid source scopes never broaden to full Document during validation", () => {
  for (const scope of [undefined, null, { kind: "blocks", block_ids: [] }, { kind: "blocks", block_ids: ["a", "a"] }, { kind: "all_projects" }]) {
    const spec = executiveSpec();
    spec.deliverables[0].source_scope = scope;
    assert.equal(inspectOutputRequirement(spec).status, "invalid");
  }
  const spec = executiveSpec();
  spec.deliverables[0].source_scope = { kind: "unknown", reason: "The previously selected sources are unavailable." };
  assert.equal(inspectOutputRequirement(spec).status, "valid");
});

test("absence, intentional empty variants, and unresolved empty series remain distinct", () => {
  const absent = executiveSpec(), empty = structuredClone(absent);
  empty.deliverables[0].format_variants = [];
  assert.equal(inspectOutputRequirement(absent).status, "valid");
  assert.equal(inspectOutputRequirement(empty).status, "valid");
  assert.equal("format_variants" in inspectOutputRequirement(absent).spec.deliverables[0], false);
  assert.deepEqual(inspectOutputRequirement(empty).spec.deliverables[0].format_variants, []);
  empty.deliverables[2].series.state = "resolved";
  assert.ok(inspectOutputRequirement(empty).issues.some((entry) => entry.code === "empty_resolved_series"));
});

test("required groups cannot become vacuously complete by making every member optional", () => {
  const spec = imageSpec();
  for (const row of spec.deliverables[0].format_variants) row.required = false;
  assert.ok(inspectOutputRequirement(spec).issues.some((entry) => entry.code === "required_group_without_required_member"));
});

test("decimal aspect ratios are exact rationals, not rounded provider dimensions", () => {
  assert.deepEqual(parseOutputAspectRatio("1.91:1"), { width: 191, height: 100 });
  assert.deepEqual(parseOutputAspectRatio("3.82 : 2"), { width: 191, height: 100 });
  assert.deepEqual(parseOutputAspectRatio("16:9"), { width: 16, height: 9 });
  for (const value of ["-1:1", "0:1", "1:0", "16/9", "NaN:1", "1e2:1", "9007199254740992:1"]) assert.equal(parseOutputAspectRatio(value), null, value);
});

test("blank native quantity fields mean unknown rather than null-to-zero coercion", () => {
  for (const value of ["", "   ", null, undefined]) assert.deepEqual(parseOutputQuantityInput(value, "slide"), { kind: "unknown", unit: "slide" });
  for (const value of ["0", "-1", "1.2", "NaN", "Infinity", "1e2", "15-5"]) assert.equal(parseOutputQuantityInput(value, "slide"), null, value);
  assert.deepEqual(parseOutputQuantityInput("5–15", "slide"), { kind: "range", unit: "slide", min: 5, max: 15 });
  assert.deepEqual(parseOutputQuantityInput("1.5", "second"), { kind: "exact", unit: "second", value: 1.5 });
  assert.deepEqual(parseOutputQuantityInput(" 8 ", "slide"), { kind: "exact", unit: "slide", value: 8 });
});

test("suggested eight and accepted flexibility do not narrow the authored 5–15 range", () => {
  const authored = { kind: "range", unit: "slide", min: 5, max: 15 };
  const flexible = { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 };
  const exact = { kind: "exact", unit: "slide", value: 8 };
  assert.deepEqual(validateOutputCountPolicy(authored, flexible), []);
  assert.equal(outputCountSatisfies(9, authored, flexible), true);
  assert.equal(outputCountSatisfies(9, authored, exact), false);
  assert.equal(outputCountSatisfies(8, authored, exact), true);
  for (const actual of [4, 16, 8.5, Number.NaN]) assert.equal(outputCountSatisfies(actual, authored, flexible), false);
  assert.deepEqual(authored, { kind: "range", unit: "slide", min: 5, max: 15 });
});

test("count policy cannot widen an exact commitment, exceed a range, or change units", () => {
  assert.ok(validateOutputCountPolicy({ kind: "exact", unit: "slide", value: 8 }, { kind: "flexible", unit: "slide", min: 5, max: 15 }).length);
  const authored = { kind: "range", unit: "slide", min: 5, max: 15 };
  for (const policy of [{ kind: "flexible", unit: "slide", min: 1, max: 99 }, { kind: "exact", unit: "episode", value: 8 }, { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 18 }, { kind: "exact", unit: "slide", value: 8, authority: "approved" }]) assert.equal(outputCountSatisfies(8, authored, policy), false);
});

test("safe semantic reordering preserves variant identities and no approval is transferred", () => {
  const previous = imageSpec();
  previous.label = "A renamed image assignment";
  previous.deliverables[0].label = "A renamed image group";
  previous.deliverables[0].format_variants[0].label = "Square carousel";
  const result = parseOutputRequirement({ id: previous.id, type: "output", subtype: "Social media image", content: 'Output images at "4:5" feeds, "1.91:1" link cards, "1:1" carousels, "16:9" thumbnails, "9:16" short form.' }, previous);
  assert.equal(result.spec.deliverables[0].id, previous.deliverables[0].id);
  const before = Object.fromEntries(previous.deliverables[0].format_variants.map((row) => [formatOutputAspectRatio(row.aspect_ratio), row.id]));
  for (const row of result.spec.deliverables[0].format_variants) assert.equal(row.id, before[formatOutputAspectRatio(row.aspect_ratio)]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.needs_confirmation, true);
});

test("ambiguous rematches create draft identities rather than borrowing an old child's fulfillment", () => {
  const previous = imageSpec();
  const other = structuredClone(previous.deliverables[0]);
  other.id = "other-image-group";
  other.format_variants = other.format_variants.map((row, index) => ({ ...row, id: `other-format-${index}` }));
  previous.deliverables.push(other);
  const result = parseOutputRequirement({ id: previous.id, type: "output", subtype: "Social media image", content: imageText }, previous);
  assert.ok(result.issues.some((entry) => entry.code === "ambiguous_identity"));
  assert.ok(!identities(previous).includes(result.spec.deliverables[0].id));
  assert.equal(result.needs_confirmation, true);
});

test("copying remaps every child identity and never mutates or shares the source aggregate", () => {
  const original = imageSpec(), frozen = structuredClone(original), result = copyOutputRequirement(original, "copy");
  assert.deepEqual(original, frozen);
  const oldIds = identities(original), newIds = identities(result.spec);
  assert.equal(new Set(newIds).size, newIds.length);
  assert.ok(newIds.every((id) => !oldIds.includes(id)));
  for (const id of oldIds) assert.ok(newIds.includes(result.idMap[id]));
  assert.equal(result.spec.original_text, original.original_text);
  result.spec.deliverables[0].format_variants[0].label = "Edited copy";
  assert.notEqual(result.spec.deliverables[0].format_variants[0].label, original.deliverables[0].format_variants[0].label);
  assert.throws(() => copyOutputRequirement(original, original.id), /distinct/);
});

test("unrecognized wording stays an unresolved proposal without guessing a document route", () => {
  const content = "Prepare a hologram. This prose is not a spending grant.";
  const result = parse("Boardroom hologram", content);
  assert.equal(result.recognized, false);
  assert.equal(result.spec.deliverables[0].media_kind, "unknown");
  assert.equal(result.spec.original_text, content);
  assert.equal(inspectOutputRequirement(result.spec).status, "valid");
  assert.equal(result.needs_confirmation, true);
});

test("context partition separates Output instructions from facts and excludes removed blocks", () => {
  const blocks = [{ id: "fact", type: "message" }, { id: "out", type: "OUtput" }, { id: "legacy", type: "format" }, { id: "gone", type: "output", removed: true }];
  const result = partitionOutputContext(blocks);
  assert.deepEqual(result.facts.map((block) => block.id), ["fact", "legacy"]);
  assert.deepEqual(result.instructions.map((block) => block.id), ["out"]);
  assert.equal(blocks.length, 4);
});

test("identities are opaque, bounded, and safe for target and asset manifests", () => {
  for (const value of ["a/b", "hello world", "../private", "éclair", "x".repeat(149), "_leading"]) {
    assert.equal(isOutputRequirementId(value), false, value);
    const spec = imageSpec(); spec.deliverables[0].id = value;
    assert.equal(inspectOutputRequirement(spec).status, "invalid");
  }
  const id = "a".repeat(148);
  const result = parse("Social media image", imageText, id);
  assert.deepEqual(result.issues, []);
  assert.ok(identities(result.spec).every(isOutputRequirementId));
  assert.equal(new Set(identities(result.spec)).size, identities(result.spec).length);
  const copied = copyOutputRequirement(result.spec, "b".repeat(148)).spec;
  assert.ok(identities(copied).every(isOutputRequirementId));
});

test("new interpretations retain their exact prose basis without claiming author or result approval", () => {
  const spec = executiveSpec();
  assert.equal(outputRequirementInterpretationBasis(spec), executiveText);
  assert.equal(outputRequirementInterpretationNeedsReview(spec), false);
  assert.deepEqual(spec.value_origins.interpretation_basis, { kind: "interpreted", text: executiveText });
  assert.equal(parse("Executive summary", executiveText).needs_confirmation, true);
});

test("wording-only edits retain manual members, quantities, geometry, IDs, and value origins", () => {
  const spec = executiveSpec();
  spec.deliverables[0].content_quantity = { kind: "range", unit: "slide", min: 5, max: 15 };
  const series = spec.deliverables[2];
  series.series = { state: "resolved", description: "Keep these two agreed topics.", members: ["Finding", "Decision"].map((label, index) => ({ id: `topic-${index}`, label, required: true, quantity: { kind: "exact", unit: "video", value: 1 }, source_scope: { kind: "blocks", block_ids: [`evidence-${index}`] }, coverage: { kind: "topics", topics: [label] }, original_text: label, value_origins: { coverage: { kind: "confirmed", text: label } } })) };
  series.content_quantity = { kind: "range", unit: "second", min: 25, max: 35 };
  const before = structuredClone(spec), wording = executiveText.replace("TickTok", "TikTok");
  const changed = outputRequirementWithWording(spec, wording);
  assert.equal(changed.original_text, wording);
  assert.deepEqual({ ...changed, original_text: before.original_text }, before);
  assert.deepEqual(spec, before);
  assert.equal(outputRequirementInterpretationBasis(changed), before.original_text);
  assert.equal(outputRequirementInterpretationNeedsReview(changed), true);
  assert.equal(inspectOutputRequirement(changed).status, "valid", "a mismatched interpretation remains a saveable draft");
  assert.equal(outputRequirementInterpretationNeedsReview(JSON.parse(JSON.stringify(changed))), true, "the warning survives reload");
});

test("explicitly keeping displayed decisions updates only their interpretation basis", () => {
  const changed = outputRequirementWithWording(executiveSpec(), executiveText.replace("TickTok", "TikTok"));
  const before = structuredClone(changed), confirmed = confirmOutputRequirementInterpretation(changed);
  assert.equal(outputRequirementInterpretationNeedsReview(confirmed), false);
  assert.deepEqual(confirmed.value_origins.interpretation_basis, { kind: "confirmed", text: confirmed.original_text });
  assert.deepEqual(confirmed.deliverables, before.deliverables);
  const restored = structuredClone(confirmed);
  restored.value_origins.interpretation_basis = before.value_origins.interpretation_basis;
  assert.deepEqual(restored, before);
  assert.deepEqual(changed, before, "acknowledgement must not mutate the saved source object");
  assert.doesNotMatch(JSON.stringify(confirmed.value_origins.interpretation_basis), /permission|grant|artifact|paid|verified/);
});

test("legacy requirements without a basis remain unknown until explicit retained-decision review", () => {
  const legacy = executiveSpec();
  delete legacy.value_origins.interpretation_basis;
  assert.equal(inspectOutputRequirement(legacy).status, "valid");
  assert.equal(outputRequirementInterpretationBasis(legacy), null);
  assert.equal(outputRequirementInterpretationNeedsReview(legacy), true);
  assert.equal(legacy.value_origins.deliverables.text, legacy.original_text, "another origin must not be silently promoted to a reviewed basis");
  const changed = outputRequirementWithWording(legacy, `${legacy.original_text} `);
  assert.equal(outputRequirementInterpretationBasis(changed), null);
  const confirmed = confirmOutputRequirementInterpretation(changed);
  assert.equal(outputRequirementInterpretationNeedsReview(confirmed), false);
  assert.deepEqual(confirmed.deliverables, legacy.deliverables);
});

test("reserved interpretation metadata rejects suggested or malformed semantic acknowledgement", () => {
  for (const basis of [{ kind: "authored", text: executiveText }, { kind: "suggested", text: executiveText }, { kind: "interpreted" }, { kind: "confirmed", text: null }]) {
    const spec = executiveSpec(); spec.value_origins.interpretation_basis = basis;
    assert.equal(inspectOutputRequirement(spec).status, "invalid");
    assert.equal(outputRequirementInterpretationNeedsReview(spec), true);
  }
  const spec = executiveSpec();
  spec.original_text = `${spec.original_text} `;
  assert.equal(outputRequirementInterpretationNeedsReview(spec), true, "no semantic normalization may silently acknowledge an edit");
});

test("copy and wording edits do not repair a mismatch or rewrite an unsupported future schema", () => {
  const changed = outputRequirementWithWording(imageSpec(), `${imageText} A revised note.`);
  const copied = copyOutputRequirement(changed, "another-output").spec;
  assert.equal(outputRequirementInterpretationNeedsReview(copied), true);
  assert.equal(outputRequirementInterpretationBasis(copied), imageText);
  const future = { ...executiveSpec(), schema_version: 2 };
  assert.equal(outputRequirementInterpretationNeedsReview(future), true);
  assert.throws(() => outputRequirementWithWording(future, "new"), /supported/);
  assert.throws(() => confirmOutputRequirementInterpretation(future), /supported/);
});

test("authored label bounds are shared and exact without truncating the 240-character boundary", () => {
  assert.equal(OUTPUT_REQUIREMENT_LABEL_MAX_LENGTH, 240);
  assert.equal(OUTPUT_PLAN_TARGET_LABEL_MAX_LENGTH, 245);
  for (const value of ["L".repeat(240), "漢".repeat(240), 'A quoted "group", with punctuation']) assert.equal(isOutputRequirementLabel(value), true);
  for (const value of ["L".repeat(241), "", " ", "Two\nlines", "A\u202Elabel", "A\u200Dlabel"]) assert.equal(isOutputRequirementLabel(value), false);
  const spec = imageSpec(); spec.label = "R".repeat(240); spec.deliverables[0].label = "D".repeat(240);
  spec.deliverables[0].format_variants[0].label = "F".repeat(240);
  const inspected = inspectOutputRequirement(spec);
  assert.equal(inspected.status, "valid");
  assert.equal(inspected.spec.deliverables[0].label, "D".repeat(240));
  assert.equal(inspected.spec.original_text, imageText);
});

test("oversized saved labels remain complete editable drafts but never valid execution requirements", () => {
  const spec = imageSpec(), original = spec.original_text;
  spec.label = "R".repeat(241); spec.deliverables[0].label = "D".repeat(241);
  spec.deliverables[0].format_variants[0].label = "F".repeat(241);
  const inspected = inspectOutputRequirement(spec);
  assert.equal(inspected.status, "invalid");
  assert.equal(inspected.spec, null);
  assert.equal(inspected.issues.filter((entry) => entry.code === "label_too_long").length, 3);
  assert.deepEqual(inspected.preserved, spec);
  const editable = outputRequirementEditableDraft(spec);
  assert.deepEqual(editable, spec);
  assert.equal(editable.original_text, original);
  assert.deepEqual(identities(editable), identities(spec));
  editable.deliverables[0].label = "Corrected group";
  assert.equal(spec.deliverables[0].label.length, 241, "editing must not mutate the saved original");
});

test("editable draft recovery is restricted to label errors, not unsupported structure or invalid IDs", () => {
  const spec = imageSpec(); spec.deliverables[0].label = "L".repeat(241);
  assert.ok(outputRequirementEditableDraft(spec));
  const wrongId = structuredClone(spec); wrongId.deliverables[0].id = "bad/id";
  assert.equal(outputRequirementEditableDraft(wrongId), null);
  const wrongType = structuredClone(spec); wrongType.deliverables[0].label = 241;
  assert.equal(outputRequirementEditableDraft(wrongType), null);
  const future = { ...spec, schema_version: 2 };
  assert.equal(outputRequirementEditableDraft(future), null);
  const unsupported = structuredClone(spec); unsupported.deliverables[0].future_constraint = "retained";
  assert.equal(outputRequirementEditableDraft(unsupported), null);
});

test("member names obey the same bound while detailed topics and original prose are preserved", () => {
  const spec = executiveSpec(), series = spec.deliverables[2], details = "Detailed authorized context. ".repeat(1000);
  series.series = { state: "resolved", description: details, members: [{ id: "long-topic", label: "T".repeat(241), required: true, source_scope: { kind: "document" }, coverage: { kind: "topics", topics: [details] }, quantity: { kind: "exact", unit: "video", value: 1 }, original_text: details, value_origins: {} }] };
  assert.equal(inspectOutputRequirement(spec).status, "invalid");
  const draft = outputRequirementEditableDraft(spec);
  assert.equal(draft.deliverables[2].series.members[0].coverage.topics[0], details);
  draft.deliverables[2].series.members[0].label = "T".repeat(240);
  assert.equal(inspectOutputRequirement(draft).status, "valid");
  assert.equal(draft.deliverables[2].series.members[0].original_text, details);
  assert.equal(draft.original_text, executiveText);
});

test("derived planning identifiers stay bounded without altering persisted parent identities", () => {
  const parent = "a".repeat(148);
  const membership = deriveOutputRequirementId(parent, "membership"), unresolved = deriveOutputRequirementId(membership, "unresolved");
  assert.ok(isOutputRequirementId(membership)); assert.ok(isOutputRequirementId(unresolved));
  assert.equal(deriveOutputRequirementId(parent, "membership"), membership);
  assert.notEqual(deriveOutputRequirementId(parent, "unresolved"), membership);
  assert.equal(deriveOutputRequirementId("short", "membership"), "short:membership");
  assert.equal(parent.length, 148);
  assert.throws(() => deriveOutputRequirementId("invalid/id", "membership"), /opaque/);
});
