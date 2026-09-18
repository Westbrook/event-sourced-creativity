import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { foldEvents } from "../src/model/events.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { creativeActionSourceRevision, creativeNextTargetAvailable } from "../src/model/workspace-intelligence.ts";
import { OUTCOME_RECIPES, OUTCOME_RECIPE_EXECUTORS, outcomeRecipe } from "../src/model/outcome-recipes.ts";
import { SLIDE_STYLE_PRESET_IDS } from "../src/model/document-artifacts.ts";
import { FORMA_CAPABILITIES } from "../src/platform/capabilities.ts";
import {
  projectOutcomeDesk, reorderOutcomeDeskRows, outcomeDeskActions, followOutcomeDeskAction,
  outcomeDeskRouteState, withOutcomeDeskPosture, withOutcomeDeskSelection, withOutcomeRecipe,
} from "../src/model/outcome-desk.ts";
import {
  outcomeArrangementSelectionIds, outcomeArrangementManifests, outcomeArrangementRevisions,
  previewOutcomeArrangement, acceptOutcomeArrangementPreview, prepareOutcomeArrangement,
} from "../src/canvas/outcome-arrangements.ts";
import { OUTCOME_RECIPE_MESSAGES } from "../src/components/design-system/locales/outcome-recipe-messages.ts";

const now = Date.parse("2026-08-27T10:00:00.000Z");
const originalFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls += 1; throw new Error("No external request is allowed in this suite"); };
test.after(() => { globalThis.fetch = originalFetch; assert.equal(externalCalls, 0); });
const event = (id, type, payload, sequence) => ({
  eventId: id, streamId: "stream", sequence, occurredAt: "2026-08-27T09:00:00.000Z",
  recordedAt: "2026-08-27T09:00:00.000Z", actor: "user", clientId: "fixture", correlationId: "fixture",
  causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload,
});
const artifact = (id, kind = "slides", documentId = "doc-b") => ({
  id, kind, documentId, title: id, summary: "Authored saved result", sequence: 12, sourceEventId: id + "-created",
  provider: "mock", contentRef: "/private/" + id, inputRef: "PRIVATE-RECEIPT",
  itemCount: 1, mediaUrl: null, mediaType: null, presentation: null, settings: {},
  items: [{ id: id + "-item", title: "Existing part", body: "Existing text", notes: "", imagePrompt: "PRIVATE-IMAGE-PROMPT", mediaUrl: null, mediaType: null, width: null, height: null, slide: null }],
});
const output = (id = "image", documentId = "doc-b", canvasId = "board-b") => ({
  id, documentId, canvasId, title: id, sequence: 11, generationId: "generation-" + id, sourceEventId: id + "-created",
  provider: "mock", mediaUrl: "/api/media/" + id, mediaType: "image/png", width: 1024, height: 1024,
  quality: "high", purpose: "final", discarded: false, promptRef: "PRIVATE-PROMPT", contextSetId: null,
});
const job = (jobId = "zero-clips", extra = {}) => ({
  jobId, documentId: "doc-b", canvasId: "board-b", sourceSurface: "canvas",
  kind: "render_document", status: "failed", result: { artifactKind: "video", completedCount: 0 },
  requestedAt: "2026-08-27T09:00:00.000Z", dismissedAt: null, ...extra,
});
function fixture() {
  const descriptions = [
    ["p", "ProjectCreated", { project_id: "p", name: "Synthetic project" }],
    ["a", "DocumentCreated", { project_id: "p", document_id: "doc-a", title: "Other document", handle: "other" }],
    ["b", "DocumentCreated", { project_id: "p", document_id: "doc-b", title: "Selected document", handle: "selected" }],
    ["direction-created", "BlockCreated", { project_id: "p", document_id: "doc-b", block_id: "direction", type: "direction", handle: "direction", position: "a", properties: { text: "Human source", authority: "authored", weight: 1 } }],
    ["exclusion-created", "BlockCreated", { project_id: "p", document_id: "doc-b", block_id: "exclusion", type: "exclusion", handle: "exclusion", position: "b", properties: { text: "No music or voices", authority: "authored", rights: "licensed", weight: 1 } }],
    ["relation-created", "BlockRelationAdded", { project_id: "p", document_id: "doc-b", relation_id: "typed-relation", from_block_id: "direction", to_block_id: "exclusion", kind: "constrains", properties: { humanConfirmed: true } }],
    ["board", "CanvasCreated", { project_id: "p", canvas_id: "board-b", name: "Existing board", slug: "existing" }],
    ["card-doc-created", "CanvasItemPlaced", { canvas_id: "board-b", item_id: "card-doc", source_kind: "document", source_id: "doc-b", frame: { x: 80, y: 90, w: 280, h: 200 } }],
    ["card-deck-created", "CanvasItemPlaced", { canvas_id: "board-b", item_id: "card-deck", source_kind: "artifact", source_id: "deck", frame: { x: 480, y: 120, w: 380, h: 280 } }],
    ["card-image-created", "CanvasItemPlaced", { canvas_id: "board-b", item_id: "card-image", source_kind: "output", source_id: "image", frame: { x: 200, y: 480, w: 300, h: 180 } }],
  ];
  const events = descriptions.map(([id, type, payload], index) => event(id, type, payload, index + 1));
  const outputs = [output()], artifacts = [artifact("deck")];
  const projection = { ...foldEvents(events, Infinity, "doc-b", "p"), outputs, libraryOutputs: outputs, artifacts, libraryArtifacts: artifacts };
  const canvas = foldCanvasEvents(events, "p", "board-b", now);
  const facts = { projectId: "p", documentId: "doc-b", canvasId: "board-b", authorityKey: "actor:permission-1",
    canRead: true, canAuthor: true, canConfigure: true, blocks: projection.blocks, outputs, artifacts, jobs: [job()], events };
  return { events, projection, canvas, input: { facts, document: projection.documents.find((item) => item.id === "doc-b") } };
}
async function contextFor(value, extra = {}) {
  const selectedItemIds = extra.selectedItemIds ?? ["card-doc", "card-deck"];
  const result = await outcomeArrangementRevisions(value.projection, value.canvas, selectedItemIds);
  assert.equal(result.ok, true);
  return { canvas: value.canvas, authorityKey: value.input.facts.authorityKey, actorId: "user-1", siteId: "site-1",
    canRead: true, canArrange: true, atomicTransportAvailable: true, ...result.value, selectedItemIds, ...extra };
}
const choice = (recipeId = "executive-deck") => ({ recipeId, name: "My named layout", operationId: "human-request-1" });
function serverPreview(draft, extra = {}) {
  return { ...draft.request, previewId: "preview-1", approvalHash: "server-approval-hash", arrangementId: "server-arrangement-1",
    expiresAt: "2026-08-27T10:10:00.000Z", before: draft.before, after: draft.after,
    maximumEvents: 201, providerCalls: 0, maximumMicrousd: 0, changesSemantics: false, ...extra };
}
const confirmation = (preview) => ({ operationId: preview.operationId, previewId: preview.previewId, approvalHash: preview.approvalHash, confirmed: true });
function actionFor(input, key = "inspect", extra = {}) {
  return { key, subject: { kind: "artifact", id: "deck", documentId: "doc-b" },
    scope: { projectId: "p", documentId: "doc-b", canvasId: "board-b", authorityKey: input.facts.authorityKey },
    sourceRevision: creativeActionSourceRevision(input.facts), label: "Inspect exact revision", detail: "Existing result",
    target: { kind: "artifact", projectId: "p", documentId: "doc-b", canvasId: "board-b", authorityKey: input.facts.authorityKey, artifactId: "deck", sequence: 12, revision: 0 },
    effect: "open-existing-executor", ...extra };
}
const currentActionAllowed = (action, current) => creativeNextTargetAvailable(action.target, current.facts);

test("recipes reference supported capabilities, formats, templates and existing executor boundaries only", () => {
  const formats = new Set(["image", "short_story", "scene", "slides", "storyboard", "video", "audio"]);
  assert.equal(OUTCOME_RECIPES.length, 3);
  for (const recipe of OUTCOME_RECIPES) {
    assert.ok(recipe.formats.every((format) => formats.has(format)));
    assert.ok(recipe.slidePresets.every((preset) => SLIDE_STYLE_PRESET_IDS.includes(preset)));
    assert.deepEqual(recipe.steps, ["inspect", "author", "prepare", "review", "deliver"]);
    assert.ok(!("blocks" in recipe) && !("dependsOn" in recipe) && !("events" in recipe));
  }
  for (const executor of Object.values(OUTCOME_RECIPE_EXECUTORS)) {
    assert.equal(executor.opensOnly, true);
    assert.ok(FORMA_CAPABILITIES.includes(executor.capability));
  }
  assert.equal(outcomeRecipe("unknown"), null);
});

test("desk retains the original canonical objects for all seven forms, without default selection", () => {
  const value = fixture(), before = JSON.stringify(value);
  value.input.facts.artifacts = ["short_story", "scene", "slides", "storyboard", "video", "audio"].map((kind) => artifact(kind, kind));
  const desk = projectOutcomeDesk(value.input);
  assert.equal(desk.selected, null);
  assert.equal(desk.rows.length, 9);
  for (const saved of value.input.facts.artifacts) assert.equal(projectOutcomeDesk(value.input, "artifact:" + saved.id).selected.object.value, saved);
  assert.equal(projectOutcomeDesk(value.input, "output:image").selected.object.value, value.input.facts.outputs[0]);
  assert.equal(value.projection.documents[1].id, JSON.parse(before).projection.documents[1].id);
});

test("a rejected video with zero clips remains a job, never a fabricated film result", () => {
  const value = fixture(), desk = projectOutcomeDesk(value.input, "job:zero-clips");
  assert.equal(desk.selected.object.kind, "job");
  assert.equal(desk.selected.object.value.result.completedCount, 0);
  assert.ok(!desk.rows.some((item) => item.object.kind === "artifact" && item.object.value.kind === "video"));
  assert.deepEqual(Object.keys(desk).sort(), ["rows", "selected", "unavailableSelection"]);
});

test("desk denies stale identity and missing objects instead of substituting the first document", () => {
  const { input } = fixture();
  for (const changed of [{ canRead: false }, { authorityKey: "" }, { projectId: "other" }, { documentId: "doc-a" }]) {
    assert.deepEqual(projectOutcomeDesk({ ...input, facts: { ...input.facts, ...changed } }, "artifact:deck").rows, []);
  }
  const stale = projectOutcomeDesk(input, "artifact:removed");
  assert.equal(stale.selected, null); assert.equal(stale.unavailableSelection, true);
  assert.equal(projectOutcomeDesk({ ...input, document: { ...input.document, removed: true } }).rows.length, 0);
});

test("desk excludes other documents, other board jobs, simulation results and duplicate IDs", () => {
  const { input } = fixture();
  input.facts.outputs.push(output("other-board", "doc-b", "board-a"), output("foreign", "doc-a"), { ...output("simulation"), provider: "simulation" });
  input.facts.artifacts.push(artifact("foreign", "slides", "doc-a"));
  input.facts.jobs.push(job("wrong-board", { canvasId: "board-a" }), job("wrong-doc", { documentId: "doc-a" }));
  assert.deepEqual(projectOutcomeDesk(input).rows.map((item) => item.key), ["document:doc-b", "output:image", "artifact:deck", "job:zero-clips"]);
  input.facts.artifacts.push(artifact("deck"));
  assert.equal(projectOutcomeDesk(input, "artifact:deck").selected, null);
});

test("one primary and at most two alternatives retain expert access after dismissal", () => {
  const { input } = fixture(), selected = projectOutcomeDesk(input, "artifact:deck").selected;
  const candidates = ["review", "inspect", "source", "history", "export"].map((key) => actionFor(input, key));
  const initial = outcomeDeskActions(selected, candidates, input, currentActionAllowed);
  assert.equal(initial.primary, candidates[0]); assert.equal(initial.alternatives.length, 2); assert.equal(initial.otherWays.length, 2);
  const dismissed = outcomeDeskActions(selected, candidates, input, currentActionAllowed, ["review"]);
  assert.equal(dismissed.primary, candidates[1]); assert.ok(dismissed.otherWays.includes(candidates[0]));
  assert.equal(outcomeDeskActions(selected, candidates, input, currentActionAllowed).primary, candidates[0]);
  assert.equal(outcomeDeskActions(null, candidates, input, currentActionAllowed).primary, null);
});

test("dispatch rechecks exact source, scope, target and current review guard without another action", async () => {
  const { input } = fixture(), action = actionFor(input), calls = [];
  const ports = { available: currentActionAllowed, open: (selected) => calls.push(selected) };
  assert.equal(await followOutcomeDeskAction(action, () => input, ports), true);
  assert.equal(calls[0], action);
  for (const changed of [{ canRead: false }, { authorityKey: "revoked" }, { projectId: "other" }, { canvasId: "board-a" },
    { artifacts: [] }, { blocks: input.facts.blocks.map((block) => ({ ...block, properties: { ...block.properties, text: "Newer source" } })) }]) {
    assert.equal(await followOutcomeDeskAction(action, () => ({ ...input, facts: { ...input.facts, ...changed } }), ports), false);
  }
  assert.equal(await followOutcomeDeskAction(action, () => input, { ...ports, available: () => false }), false);
  assert.equal(await followOutcomeDeskAction(action, () => input, { ...ports, available: () => { throw new Error("review revoked"); } }), false);
  assert.equal(calls.length, 1);
});

test("display reorder, dismissal and posture switches preserve drafts, IDs, typed relationships and provenance", () => {
  const value = fixture(), drafts = { source: "Unsaved human draft", review: "Unsent review notes" };
  const before = JSON.stringify({ value, drafts }), rows = projectOutcomeDesk(value.input).rows;
  const reordered = reorderOutcomeDeskRows(rows, rows.map((item) => item.key).reverse());
  assert.equal(reordered[0], rows.at(-1));
  assert.equal(reorderOutcomeDeskRows(rows, [rows[0].key, rows[0].key]), rows);
  for (const recipe of OUTCOME_RECIPES) withOutcomeRecipe("/canvas/board-b/existing", recipe.id);
  withOutcomeDeskPosture("/canvas/board-b/existing?posture=outcomes", "canvas");
  outcomeDeskActions(rows.find((item) => item.key === "artifact:deck"), [actionFor(value.input)], value.input, currentActionAllowed, ["inspect"]);
  assert.equal(JSON.stringify({ value, drafts }), before);
});

test("deep links retain the board, view, focus, unrelated query and hash; invalid routes do not navigate", () => {
  const original = "/canvas/board-b/existing/view/list/focus?sort=title&seed=kept#context=direction";
  const withRecipe = withOutcomeRecipe(original, "film-continuity"), selected = withOutcomeDeskSelection(withRecipe, "artifact:deck");
  const state = outcomeDeskRouteState(selected);
  assert.deepEqual(state, { posture: "outcomes", recipeId: "film-continuity", selectedKey: "artifact:deck" });
  const back = new URL(withOutcomeDeskPosture(selected, "canvas"), "https://canvas.local");
  assert.equal(back.pathname, "/canvas/board-b/existing/view/list/focus");
  assert.equal(back.hash, "#context=direction"); assert.equal(back.searchParams.get("seed"), "kept");
  assert.equal(back.searchParams.get("outcome"), "artifact:deck");
  for (const route of ["https://other.example/canvas/board-b", "//other.example/canvas/board-b", "/canvas/library", "/projects", "/\\evil.example/canvas/board-b"]) {
    assert.equal(withOutcomeDeskPosture(route, "outcomes"), route);
  }
});

test("revisions ignore top-level view sequences and projection array order", async () => {
  const value = fixture(), ids = ["card-doc", "card-deck"], before = await outcomeArrangementRevisions(value.projection, value.canvas, ids);
  const reordered = structuredClone(value);
  reordered.projection.documents.reverse().forEach((item) => { item.createdSequence += 100; });
  reordered.projection.libraryArtifacts.forEach((item) => { item.sequence += 100; });
  reordered.projection.libraryOutputs.forEach((item) => { item.sequence += 100; });
  reordered.projection.libraryBlocks.reverse(); reordered.projection.libraryBlockRelations.reverse();
  reordered.canvas.items.reverse(); reordered.canvas.canvases.forEach((item) => { item.createdSequence += 100; });
  const after = await outcomeArrangementRevisions(reordered.projection, reordered.canvas, [...ids].reverse());
  assert.deepEqual(after, before);
  assert.match(before.value.layoutRevision, /^sha256:[0-9a-f]{64}$/);
});

test("whole-board geometry changes layout revision only; authored source and typed relation changes affect source", async () => {
  const value = fixture(), ids = ["card-doc", "card-deck"], baseline = (await outcomeArrangementRevisions(value.projection, value.canvas, ids)).value;
  const moved = structuredClone(value); moved.canvas.items.find((item) => item.id === "card-image").x += 40;
  const layout = (await outcomeArrangementRevisions(moved.projection, moved.canvas, ids)).value;
  assert.notEqual(layout.layoutRevision, baseline.layoutRevision); assert.equal(layout.sourceRevision, baseline.sourceRevision);
  for (const change of [
    (copy) => { copy.projection.libraryBlocks[0].properties.text = "Changed authored fact"; },
    (copy) => { copy.projection.libraryBlockRelations[0].kind = "supports"; },
    (copy) => { copy.projection.libraryArtifacts[0].items[0].body = "New artifact revision"; },
    (copy) => { copy.projection.libraryBlocks[1].properties.rights = "revoked"; },
    (copy) => { copy.canvas.items.find((item) => item.id === "card-doc").body = "New Canvas text"; },
    (copy) => { copy.canvas.items.find((item) => item.id === "card-doc").strokes.push({ id: "stroke", points: [0, 0, 1, 1], pressure: [], color: "#171717", width: 3, bbox: { x: 0, y: 0, w: 1, h: 1 }, sourceEventId: "stroke-added" }); },
  ]) {
    const copy = structuredClone(value); change(copy);
    const changed = await outcomeArrangementRevisions(copy.projection, copy.canvas, ids);
    assert.equal(changed.ok, true); assert.notEqual(changed.value.sourceRevision, baseline.sourceRevision);
  }
});

test("manifests exclude private prompt/receipt fields and reject missing or duplicate sources", () => {
  const value = fixture(), ids = ["card-doc", "card-deck", "card-image"];
  const manifests = outcomeArrangementManifests(value.projection, value.canvas, ids);
  assert.equal(manifests.ok, true);
  assert.doesNotMatch(JSON.stringify(manifests.value), /PRIVATE-(PROMPT|RECEIPT|IMAGE-PROMPT)/);
  assert.equal(outcomeArrangementManifests(value.projection, value.canvas, ["card-doc", "missing"]).ok, false);
  assert.equal(outcomeArrangementSelectionIds(["card-doc", "card-doc"]), null);
  assert.equal(outcomeArrangementSelectionIds(Array.from({ length: 101 }, (_, index) => "card-" + index)), null);
  value.projection.libraryArtifacts = [];
  assert.equal(outcomeArrangementManifests(value.projection, value.canvas, ["card-doc", "card-deck"]).ok, false);
});

test("three local arrangement previews are free, deterministic and preserve existing identities and all source state", async () => {
  const value = fixture(), current = await contextFor(value), before = JSON.stringify(value);
  for (const recipe of OUTCOME_RECIPES) {
    const draft = previewOutcomeArrangement(current, choice(recipe.id));
    assert.equal(draft.ok, true); assert.deepEqual(draft, previewOutcomeArrangement(current, choice(recipe.id)));
    assert.deepEqual(draft.value.before.map((item) => item.itemId), draft.value.after.map((item) => item.itemId));
    assert.ok(!("events" in draft.value) && !("arrangementId" in draft.value));
    for (let index = 0; index < draft.value.before.length; index += 1) {
      assert.equal(draft.value.before[index].w, draft.value.after[index].w);
      assert.equal(draft.value.before[index].h, draft.value.after[index].h);
    }
  }
  assert.equal(JSON.stringify(value), before); assert.equal(externalCalls, 0);
});

test("local previews reject foreign boards, locks, invalid geometry, names and request identities", async () => {
  const value = fixture(), current = await contextFor(value);
  assert.equal(previewOutcomeArrangement({ ...current, canRead: false }, choice()).ok, false);
  for (const changed of [{ canvasId: "board-a" }, { lockedBy: "other-site" }, { x: NaN }, { w: 0 }, { x: 1_000_001 }, { w: 8193 }, { rot: 360_001 }, { z: "z".repeat(129) }]) {
    const canvas = structuredClone(current.canvas); Object.assign(canvas.items.find((item) => item.id === "card-doc"), changed);
    const result = previewOutcomeArrangement({ ...current, canvas }, choice());
    assert.equal(result.ok, false);
  }
  assert.equal(previewOutcomeArrangement(current, { ...choice(), name: "" }).ok, false);
  assert.equal(previewOutcomeArrangement(current, { ...choice(), operationId: "" }).ok, false);
});

test("free server preview must match every scope, frame and zero-cost/nonsemantic field", async () => {
  const value = fixture(), current = await contextFor(value), draft = previewOutcomeArrangement(current, choice()).value;
  const receipt = serverPreview(draft);
  assert.equal(acceptOutcomeArrangementPreview(draft, current, receipt, now).ok, true);
  for (const changed of [{ projectId: "other" }, { canvasId: "board-a" }, { operationId: "other" },
    { name: "Different name" }, { selectedItemIds: ["card-doc", "card-image"] }, { before: [] }, { after: [] },
    { providerCalls: 1 }, { maximumMicrousd: 1 }, { changesSemantics: true }, { approvalHash: "" }]) {
    assert.equal(acceptOutcomeArrangementPreview(draft, current, { ...receipt, ...changed }, now).ok, false);
  }
  assert.equal(acceptOutcomeArrangementPreview(draft, current, { ...receipt, after: undefined }, now).ok, false);
  assert.equal(acceptOutcomeArrangementPreview(draft, current, receipt, now + 600_000).issue, "expired");
});

test("apply needs this human confirmation, current source/layout/authority and atomic transport", async () => {
  const value = fixture(), current = await contextFor(value), draft = previewOutcomeArrangement(current, choice()).value;
  const preview = serverPreview(draft), review = acceptOutcomeArrangementPreview(draft, current, preview, now).value;
  assert.equal(prepareOutcomeArrangement(review, current, null, now).issue, "confirmation");
  assert.equal(prepareOutcomeArrangement(review, current, { ...confirmation(preview), approvalHash: "other" }, now).ok, false);
  for (const changed of [{ canArrange: false }, { atomicTransportAvailable: false }, { authorityKey: "revoked" }, { actorId: "other" },
    { layoutRevision: "sha256:" + "0".repeat(64) }, { sourceRevision: "sha256:" + "0".repeat(64) }, { selectedItemIds: ["card-doc", "card-image"] }]) {
    assert.equal(prepareOutcomeArrangement(review, { ...current, ...changed }, confirmation(preview), now).ok, false);
  }
  const first = prepareOutcomeArrangement(review, current, confirmation(preview), now);
  assert.equal(first.ok, true); assert.equal(first.value.confirmed, true);
  assert.deepEqual(first, prepareOutcomeArrangement(review, current, confirmation(preview), now));
  assert.ok(!("events" in first.value) && !("clock" in first.value) && !("authorityKey" in first.value));
  assert.equal(first.value.operationId, choice().operationId);
});

test("mock geometry apply and inverse preserve canonical source, typed relationships and provenance", async () => {
  const value = fixture(), current = await contextFor(value), draft = previewOutcomeArrangement(current, choice("film-continuity")).value;
  const canonical = JSON.stringify(value.projection);
  const move = (items, frames) => items.map((item) => {
    const next = frames.find((candidate) => candidate.itemId === item.id);
    return next ? { ...item, x: next.x, y: next.y } : item;
  });
  const moved = move(value.canvas.items, draft.after), restored = move(moved, draft.before);
  assert.deepEqual(restored, value.canvas.items);
  assert.equal(JSON.stringify(value.projection), canonical);
});

test("all four locales contain every recipe, guidance step and safe arrangement boundary", () => {
  const flatten = (value, prefix = "") => Object.entries(value).flatMap(([key, entry]) =>
    typeof entry === "object" ? flatten(entry, prefix + key + ".") : [[prefix + key, entry]]);
  const englishKeys = flatten(OUTCOME_RECIPE_MESSAGES.en).map(([key]) => key).sort();
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const entries = flatten(OUTCOME_RECIPE_MESSAGES[locale]);
    assert.deepEqual(entries.map(([key]) => key).sort(), englishKeys);
    assert.ok(entries.every(([, value]) => typeof value === "string" && value.trim()));
    if (locale !== "en") assert.notEqual(OUTCOME_RECIPE_MESSAGES[locale].apply, OUTCOME_RECIPE_MESSAGES.en.apply);
  }
  assert.match(OUTCOME_RECIPE_MESSAGES.en.recipesById["film-continuity"].steps.deliver, /ordered scene reel, not an assembled final film/);
});

test("renderer uses existing controls, logical layout, visible focus, reduced motion and no direct mutation", () => {
  const source = readFileSync(new URL("../src/components/outcome-desk.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/components/outcome-desk.css", import.meta.url), "utf8");
  assert.match(source, /forma-ui-choice-card/); assert.match(source, /forma-ui-disclosure/);
  assert.match(source, /aria-current/); assert.match(source, /<bdi>/);
  assert.match(source, /canvasReturnFocusId/); assert.match(source, /restoreOutcomeDeskFocus/);
  assert.match(source, /event\.metaKey/); assert.match(source, /options\.submitted/); assert.match(source, /options\.retrieve\(preview\.operationId\)/);
  assert.match(css, /min-block-size: 44px/); assert.match(css, /min-inline-size: 44px/);
  assert.match(css, /focus-visible/); assert.match(css, /prefers-reduced-motion/); assert.match(css, /forced-colors/);
  assert.doesNotMatch(source, /\bfetch\s*\(|\.appendBatch\s*\(|\.renderDocumentArtifact\s*\(|localStorage\.(?:setItem|removeItem)/);
  assert.doesNotMatch(css, /border-(?:left|right|inline-start|inline-end)\s*:|box-shadow\s*:|transform\s*:/);
});


const arrangementNameBoundaries = [
  ["ASCII", "a".repeat(80)],
  ["astral characters", "\u{1f680}".repeat(80)],
  ["NFC accents", "\u00e9".repeat(80)],
  ["decomposed combining marks", "e\u0301".repeat(40)],
  ["astral ZWJ sequences", "\u{1f469}\u200d\u{1f4bb}".repeat(26) + "ab"],
];
for (const [label, name] of arrangementNameBoundaries) test("arrangement name counts 80 Unicode code points, not 81: " + label, async () => {
  const value = fixture(), current = await contextFor(value), source = JSON.stringify(value);
  assert.equal(Array.from(name).length, 80);
  const accepted = previewOutcomeArrangement(current, { ...choice(), name });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.request.name, name, "retain the exact authored form; do not normalize NFC");
  assert.equal(previewOutcomeArrangement(current, { ...choice(), name: name + "x" }).issue, "name");
  if (label === "astral characters") assert.equal(name.length, 160, "UTF-16 units are not the limit");
  if (label === "decomposed combining marks") {
    assert.equal(Array.from(name.normalize("NFC")).length, 40);
    assert.equal(Array.from((name + "x").normalize("NFC")).length, 41);
    assert.notEqual(accepted.value.request.name, name.normalize("NFC"), "visually combined marks still count separately");
  }
  assert.equal(JSON.stringify(value), source, "name review cannot change canonical work or frames");
});

test("arrangement names retain the existing trim and Unicode control-character contract", async () => {
  const value = fixture(), current = await contextFor(value), name = "\u{1f680}".repeat(80);
  const trimmed = previewOutcomeArrangement(current, { ...choice(), name: " \t" + name + "\n " });
  assert.equal(trimmed.ok, true); assert.equal(trimmed.value.request.name, name);
  for (const blank of ["", " \t\n ", "\u2003"]) assert.equal(previewOutcomeArrangement(current, { ...choice(), name: blank }).issue, "name");
  for (const control of ["\u0000", "\t", "\n", "\u001f", "\u007f", "\u0085", "\u009f"]) {
    assert.equal(previewOutcomeArrangement(current, { ...choice(), name: "Before" + control + "After" }).issue, "name");
  }
});
