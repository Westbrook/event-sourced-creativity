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

test("each prohibited alternative fails independently while explicitly absent imagery remains allowed", () => {
  const snapshot = { facts: [
    { block_id: "positive", type: "direction", locked: true, properties: { text: "A silver compass under moonlight" } },
    { block_id: "forbidden", type: "exclusion", locked: true, intent: "prohibit", effect: "must_not_include", properties: { text: "Never introduce a crowd, modern vehicle, or luxury hotel" } },
  ] };
  const plan = buildManagedProductionPlan("short_story", snapshot);
  const draft = (detail) => ({ title: "The quiet world", summary: "One authored world.", presentation: null, content_markdown: `A silver compass under moonlight. ${detail}`, items: [{ title: "The shoreline", body: `A silver compass under moonlight. ${detail}`, notes: "", image_prompt: "", context_group_ids: [], slide: null }] });
  for (const detail of ["A crowd gathers by the shore.", "A modern vehicle approaches the path.", "A luxury hotel overlooks the water."]) {
    const evidence = collectProductionEvidence(plan, { draft: draft(detail) });
    assert.equal(evidence.metrics.contextAdherence.status, "failed", detail);
    assert.ok(evidence.hardFailures.some((failure) => failure.startsWith("prohibited-content:")), detail);
  }
  for (const detail of ["The shore remains without any crowd or modern vehicle.", "A modern sculpture stands beside an old vehicle."]) {
    const evidence = collectProductionEvidence(plan, { draft: draft(detail) });
    assert.ok(!evidence.hardFailures.some((failure) => failure.startsWith("prohibited-content:")), detail);
  }
});

test("explicitly conjunctive exclusions require the complete forbidden combination", () => {
  const snapshot = { facts: [{ block_id: "ban", type: "exclusion", intent: "prohibit", effect: "must_not_include", properties: { text: "Never show red and blue together." } }] };
  const plan = buildManagedProductionPlan("short_story", snapshot);
  const draft = (body) => ({ title: "Color study", summary: "One visual decision.", presentation: null, content_markdown: body, items: [{ title: "The study", body, notes: "", image_prompt: "", context_group_ids: [], slide: null }] });
  for (const permitted of ["A solitary red cottage.", "A solitary blue sail."]) {
    const evidence = collectProductionEvidence(plan, { draft: draft(permitted) });
    assert.ok(!evidence.hardFailures.some((failure) => failure.startsWith("prohibited-content:")), permitted);
  }
  const combined = collectProductionEvidence(plan, { draft: draft("A red cottage and blue sail appear together.") });
  assert.ok(combined.hardFailures.some((failure) => failure.startsWith("prohibited-content:")));
});

test("negated coordinated lists remain safe while a following affirmative clause still fails", () => {
  const boundary = "No people, children, faces, animals, real locations, real brands, logos, typography, signs, watermarks, or claims.";
  const plan = buildManagedProductionPlan("short_story", { facts: [{ block_id: "coastal-boundary", type: "exclusion", intent: "prohibit", effect: "must_not_include", properties: { text: boundary } }] });
  const draft = (body) => ({ title: "Creative boundary", summary: "An authored shoreline.", presentation: null, content_markdown: body, items: [{ title: "The coast", body, notes: "", image_prompt: "", context_group_ids: [], slide: null }] });
  assert.ok(!collectProductionEvidence(plan, { draft: draft(boundary) }).hardFailures.some((failure) => failure.startsWith("prohibited-content:")));
  const smaller = buildManagedProductionPlan("short_story", { facts: [{ block_id: "ban", type: "exclusion", intent: "prohibit", effect: "must_not_include", properties: { text: "No crowd or modern vehicle." } }] });
  for (const violation of ["Without a crowd, a modern vehicle approaches the cottage.", "No crowd; a modern vehicle approaches the cottage."]) {
    assert.ok(collectProductionEvidence(smaller, { draft: draft(violation) }).hardFailures.some((failure) => failure.startsWith("prohibited-content:")), violation);
  }
});

test("French, Arabic, and Japanese authored prohibitions retain alternatives, absence, and contrasting clauses", () => {
  const fixtures = [
    { locale: "fr", claim: "Ne jamais montrer de foule, de véhicule moderne ou d’hôtel de luxe.", violations: ["Une foule apparaît sur la côte.", "Un véhicule moderne approche du rivage.", "L’hôtel de luxe domine la côte."], safe: "Le rivage reste sans foule, sans véhicule moderne et sans hôtel de luxe.", contrast: "Le rivage reste sans foule, mais un hôtel de luxe domine la côte." },
    { locale: "ar", claim: "لا تظهر الحشود أو المركبات الحديثة أو الفنادق الفاخرة.", violations: ["تظهر الحشود على الساحل.", "تصل المركبات الحديثة إلى الساحل.", "تطل فنادق فاخرة على الساحل."], safe: "يبقى الساحل بلا حشود، وبدون مركبات حديثة، ومن دون فنادق فاخرة.", contrast: "يبقى الساحل بلا حشود، لكن فنادق فاخرة تطل على الماء." },
    { locale: "ja", claim: "群衆や現代的な車両、豪華なホテルは禁止。", violations: ["群衆が海岸に集まる。", "現代的な車両が海岸に現れる。", "豪華なホテルが海岸を見下ろす。"], safe: "群衆はいない。現代的な車両もなく、豪華なホテルもない。", contrast: "群衆はいない。しかし豪華なホテルが建っている。" },
  ];
  const draft = (body) => ({ title: "Context", summary: "Authored direction.", presentation: null, content_markdown: body, items: [{ title: "Output", body, notes: "", image_prompt: "", context_group_ids: [], slide: null }] });
  for (const { locale, claim, violations, safe, contrast } of fixtures) {
    const plan = buildManagedProductionPlan("short_story", { facts: [{ block_id: `${locale}-boundary`, type: "exclusion", intent: "prohibit", effect: "must_not_include", properties: { text: claim } }] });
    for (const violation of [...violations, contrast]) {
      const evidence = collectProductionEvidence(plan, { draft: draft(violation) });
      assert.ok(evidence.hardFailures.some((failure) => failure.startsWith("prohibited-content:")), `${locale}: ${violation}`);
    }
    const permitted = collectProductionEvidence(plan, { draft: draft(safe) });
    assert.ok(!permitted.hardFailures.some((failure) => failure.startsWith("prohibited-content:")), `${locale}: ${safe}`);
  }
});

test("every localized marketing creative boundary is actually enforceable by production evidence", async () => {
  const fixtures = [
    { locale: "en", violations: ["Crowds gather along the shoreline.", "People appear beside the cottage.", "Luxury clichés define the campaign."] },
    { locale: "fr", violations: ["Une foule apparaît sur la côte.", "Des personnes apparaissent sur la côte.", "Les clichés du luxe dominent la campagne."] },
    { locale: "ar", violations: ["تظهر حشود على الساحل.", "يظهر أشخاص على الساحل.", "تظهر صور نمطية للرفاهية على الساحل."] },
    { locale: "ja", violations: ["人混みが海岸に現れる。", "人影が海岸に現れる。", "ありきたりな高級感が海岸に現れる。"] },
  ];
  const draft = (body) => ({ title: "Context", summary: "Authored direction.", presentation: null, content_markdown: body, items: [{ title: "Output", body, notes: "", image_prompt: "", context_group_ids: [], slide: null }] });
  for (const { locale, violations } of fixtures) {
    const catalog = (await import(`../src/marketing/locales/${locale}.ts`)).default;
    const plan = buildManagedProductionPlan("short_story", { facts: [{ block_id: `${locale}-actual-boundary`, type: "exclusion", intent: "prohibit", effect: "must_not_include", properties: { text: catalog.proofBoundaryValue } }] });
    for (const violation of violations) {
      const evidence = collectProductionEvidence(plan, { draft: draft(violation) });
      assert.ok(evidence.hardFailures.some((failure) => failure.startsWith("prohibited-content:")), `${locale}: ${violation}`);
    }
    const denied = collectProductionEvidence(plan, { draft: draft(catalog.proofBoundaryValue) });
    assert.ok(!denied.hardFailures.some((failure) => failure.startsWith("prohibited-content:")), `${locale} authored prohibition must not violate itself`);
  }
});

test("natural Japanese negative creative directions retain the actual forbidden subject", () => {
  const endings = ["描かない", "描写しない", "登場させない", "表示しない", "映さない", "写さない", "見せない", "使わない", "入れない"];
  const draft = (body) => ({ title: "出力", summary: "方向性", presentation: null, content_markdown: body, items: [{ title: "結果", body, notes: "", image_prompt: "", context_group_ids: [], slide: null }] });
  for (const ending of endings) {
    const claim = `群衆や高級ホテルを${ending}`;
    const plan = buildManagedProductionPlan("short_story", { facts: [{ block_id: "japanese-natural-boundary", type: "exclusion", intent: "prohibit", effect: "must_not_include", properties: { text: claim } }] });
    const violation = collectProductionEvidence(plan, { draft: draft("高級ホテルが海岸に現れる。") });
    assert.ok(violation.hardFailures.some((failure) => failure.startsWith("prohibited-content:")), ending);
    const denied = collectProductionEvidence(plan, { draft: draft(`高級ホテルを${ending}。`) });
    assert.ok(!denied.hardFailures.some((failure) => failure.startsWith("prohibited-content:")), `${ending} negation`);
  }
  const lexical = buildManagedProductionPlan("short_story", { facts: [{ block_id: "japanese-lexical", type: "exclusion", intent: "prohibit", effect: "must_not_include", properties: { text: "子どもや高級ホテルを描かない" } }] });
  assert.ok(collectProductionEvidence(lexical, { draft: draft("子どもが海岸に現れる。") }).hardFailures.some((failure) => failure.startsWith("prohibited-content:")));
});

test("target-scoped prohibitions apply only to their own creative context", () => {
  const membership = (id, target) => ({ context_set_id: id, name: target, target, role: "character", application: "isolate", relativity: 1, member_order: 0 });
  const snapshot = { facts: [
    { block_id: "mara", type: "reference", locked: true, properties: { text: "MARA_SILVER_LANTERN", storyboard_frame_index: 1, storyboard_shot_direction: "MARA_SILVER_LANTERN", combined_context_memberships: [membership("cast-mara", "Mara")] } },
    { block_id: "ivo", type: "reference", locked: true, properties: { text: "IVO_BRASS_LANTERN", storyboard_frame_index: 2, storyboard_shot_direction: "IVO_BRASS_LANTERN", combined_context_memberships: [membership("cast-ivo", "Ivo")] } },
    { block_id: "mara-ban", type: "exclusion", intent: "prohibit", effect: "must_not_include", properties: { text: "No crimson compass", combined_context_memberships: [membership("cast-mara", "Mara")] } },
  ] };
  const plan = buildManagedProductionPlan("short_story", snapshot);
  const draft = (mara, ivo) => ({ title: "Isolated context", summary: "Two distinct characters.", presentation: null, content_markdown: `${mara}\n\n${ivo}`, items: [
    { title: "Mara", body: mara, notes: "", image_prompt: "", context_group_ids: ["cast-mara"], slide: null },
    { title: "Ivo", body: ivo, notes: "", image_prompt: "", context_group_ids: ["cast-ivo"], slide: null },
  ] });
  const allowed = collectProductionEvidence(plan, { draft: draft("MARA_SILVER_LANTERN", "IVO_BRASS_LANTERN and a crimson compass.") });
  assert.ok(!allowed.hardFailures.some((failure) => failure.startsWith("prohibited-content:")));
  const prohibited = collectProductionEvidence(plan, { draft: draft("MARA_SILVER_LANTERN and a crimson compass.", "IVO_BRASS_LANTERN") });
  assert.ok(prohibited.hardFailures.some((failure) => failure.startsWith("prohibited-content:")));
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
