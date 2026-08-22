import assert from "node:assert/strict";
import test from "node:test";

import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { collectProductionEvidence, scoreProductionEvidence } from "../src/model/production-evidence.ts";

function fixture(kind, texts = ["Mara crosses the river", "Ivo opens the observatory"]) {
  const snapshot = { facts: texts.map((text, index) => ({
    block_id: `beat-${index + 1}`,
    type: "reference",
    locked: true,
    properties: {
      text,
      storyboard_frame_index: index + 1,
      storyboard_shot_title: `Beat ${index + 1}`,
      storyboard_shot_direction: text,
      source_artifact_id: "authored-board",
    },
  })) };
  const plan = buildManagedProductionPlan(kind, snapshot);
  const draft = {
    title: "A complete authored work",
    summary: "Every authored movement remains distinct.",
    presentation: null,
    content_markdown: texts.join("\n\n"),
    items: texts.map((text, index) => ({ title: `Beat ${index + 1}`, body: text, notes: "", image_prompt: text, context_group_ids: [], slide: null })),
  };
  return { plan, draft };
}

test("an absent rendered artifact never produces a perfect rendered-text quality score", () => {
  for (const format of ["short_story", "scene", "slides", "video", "storyboard", "image"]) {
    const { plan } = fixture(format);
    const evidence = collectProductionEvidence(plan);
    const score = scoreProductionEvidence(evidence);
    assert.equal(evidence.basis, "plan-proxy", format);
    assert.equal(score.score, null, format);
    assert.equal(score.measuredWeight, 0, format);
    assert.equal(score.claimableRenderedImprovement, false, format);
  }
});

test("video completion receipts do not claim inspected visual continuity, authored imagery, or smooth cuts", () => {
  const { plan, draft } = fixture("video");
  const receipts = plan.scenes.map((scene) => ({
    sceneId: scene.id,
    status: "completed",
    durationSeconds: scene.durationSeconds,
    providerJobId: `fal-${scene.id}`,
    mediaUrl: `/api/media/owner%2F${scene.id}.mp4`,
    mediaType: "video/mp4",
  }));
  const evidence = collectProductionEvidence(plan, { draft, sceneReceipts: receipts, assemblyComposed: false });
  assert.equal(evidence.basis, "provider-video-receipt");
  assert.equal(evidence.mediaInspected, false);
  assert.equal(evidence.frameDecoded, false);
  assert.equal(evidence.assemblyComposed, false);
  assert.equal(evidence.metrics.contextAdherence.status, "not_evaluated");
  assert.equal(evidence.metrics.continuity.status, "not_evaluated");
  assert.equal(evidence.metrics.nonDuplication.status, "not_evaluated");
  assert.equal(evidence.metrics.transitionQuality.status, "not_evaluated");
  assert.equal(evidence.metrics.contextCoverage.score, 1);
  assert.equal(evidence.metrics.formatCraft.score, 1);
  assert.equal(scoreProductionEvidence(evidence).claimableRenderedImprovement, false);
});

test("duplicate or fabricated provider receipts cannot masquerade as a complete managed film", () => {
  const { plan, draft } = fixture("video");
  const duplicate = { sceneId: plan.scenes[0].id, status: "completed", durationSeconds: 5 };
  const evidence = collectProductionEvidence(plan, { draft, sceneReceipts: [duplicate, duplicate] });
  assert.equal(evidence.metrics.contextCoverage.score, .5);
  assert.equal(evidence.metrics.formatCraft.status, "failed");
  assert.ok(evidence.hardFailures.includes("formatCraft"));
});

test("storyboard scripts without rendered frames cannot claim image-provider completion or evaluated cuts", () => {
  const { plan, draft } = fixture("storyboard");
  const evidence = collectProductionEvidence(plan, { draft });
  assert.equal(evidence.basis, "plan-proxy");
  assert.equal(evidence.metrics.contextCoverage.status, "not_evaluated");
  assert.equal(evidence.metrics.formatCraft.status, "not_evaluated");
  assert.equal(evidence.metrics.transitionQuality.status, "not_evaluated");
});

test("short authored requirements remain measurable and omitted or forbidden requirements hard-fail", () => {
  const { plan, draft } = fixture("short_story", ["Red", "Ivo opens the observatory"]);
  const exact = collectProductionEvidence(plan, { draft });
  assert.equal(exact.metrics.contextAdherence.score, 1);
  assert.equal(exact.metrics.contextCoverage.score, 1);
  assert.deepEqual(exact.hardFailures, []);

  const omitted = { ...draft, content_markdown: "Ivo opens the observatory.", items: draft.items.map((item) => ({ ...item, body: "Ivo opens the observatory", title: "An unrelated movement" })) };
  const missing = collectProductionEvidence(plan, { draft: omitted });
  assert.equal(missing.metrics.contextAdherence.status, "failed");
  assert.ok(missing.hardFailures.some((failure) => failure.startsWith("missing-required-claim:")));

  const guardedSnapshot = { facts: [
    { block_id: "positive", type: "direction", locked: true, properties: { text: "A silver compass under moonlight" } },
    { block_id: "forbidden", type: "exclusion", locked: true, intent: "prohibit", effect: "must_not_include", properties: { text: "Never introduce a crowd or modern vehicle" } },
  ] };
  const guardedPlan = buildManagedProductionPlan("short_story", guardedSnapshot);
  const violated = collectProductionEvidence(guardedPlan, { draft: { ...draft, content_markdown: "A silver compass under moonlight. Introduce a crowd and modern vehicle.", items: [{ ...draft.items[0], body: "A silver compass under moonlight. Introduce a crowd and modern vehicle." }] } });
  assert.equal(violated.metrics.contextAdherence.status, "failed");
  assert.ok(violated.hardFailures.some((failure) => failure.startsWith("prohibited-content:")));
});

test("near-duplicate narrative movements cannot receive perfect continuity and nonduplication scores", () => {
  const texts = [
    "Mara enters the moonlit observatory carrying a silver compass",
    "Mara enters the moonlit observatory carrying a silver compass beneath the stars",
  ];
  const { plan, draft } = fixture("short_story", texts);
  const evidence = collectProductionEvidence(plan, { draft });
  assert.equal(evidence.metrics.nonDuplication.status, "failed");
  assert.equal(evidence.metrics.continuity.status, "failed");
  assert.equal(evidence.metrics.transitionQuality.status, "failed");
});

test("swapped character-scoped claims and reversed narrative order fail actual artifact evidence", () => {
  const membership = (id, target) => ({ context_set_id: id, name: target, target, role: "character", application: "isolate", relativity: 1, member_order: 0 });
  const snapshot = { facts: [
    { block_id: "mara", type: "reference", locked: true, properties: { text: "MARA_ONLY_CRIMSON_COMPASS", storyboard_frame_index: 1, storyboard_shot_direction: "MARA_ONLY_CRIMSON_COMPASS", combined_context_memberships: [membership("cast-mara", "Mara")] } },
    { block_id: "ivo", type: "reference", locked: true, properties: { text: "IVO_ONLY_COBALT_LANTERN", storyboard_frame_index: 2, storyboard_shot_direction: "IVO_ONLY_COBALT_LANTERN", combined_context_memberships: [membership("cast-ivo", "Ivo")] } },
  ] };
  const plan = buildManagedProductionPlan("short_story", snapshot);
  const draft = { title: "Wrong character", summary: "An invalid exchange.", presentation: null, content_markdown: "MARA_ONLY_CRIMSON_COMPASS\n\nIVO_ONLY_COBALT_LANTERN", items: [
    { title: "Mara", body: "IVO_ONLY_COBALT_LANTERN", notes: "", image_prompt: "", context_group_ids: ["cast-mara"], slide: null },
    { title: "Ivo", body: "MARA_ONLY_CRIMSON_COMPASS", notes: "", image_prompt: "", context_group_ids: ["cast-ivo"], slide: null },
  ] };
  const evidence = collectProductionEvidence(plan, { draft });
  assert.equal(evidence.metrics.contextCoverage.score, 0);
  assert.equal(evidence.metrics.contextAdherence.status, "failed");
  assert.equal(evidence.metrics.continuity.status, "failed");
  assert.equal(evidence.metrics.transitionQuality.status, "failed");
  assert.ok(evidence.hardFailures.some((failure) => failure.startsWith("missing-required-claim:")));
});
