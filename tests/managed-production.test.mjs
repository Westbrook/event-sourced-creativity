import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { generationBudgetGate, generationBudgetPreferenceKey } from "../src/model/generation-budget.ts";
import { documentJobCanRecoverProviderRender, documentJobProgress } from "../src/model/document-jobs.ts";
import {
  buildManagedProductionPlan,
  productionClaims,
  productionDefectReduction,
  productionSceneSnapshot,
  productionTeamInstructions,
  productionTeamFor,
  providerFacingProductionContinuity,
  scoreManagedProductionPlan,
  scoreManualVideoBaseline,
} from "../src/model/managed-production.ts";
import { productionSystemFor, productionUnitsForPlan, validateProductionUnits } from "../src/model/production-system.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { generateManagedArtifactDraft, renderManagedStoryboardProduction, renderManagedVideoProduction } from "../worker/managed-production.ts";

const membership = (contextSetId, target, order = 0) => ({ context_set_id: contextSetId, name: target, target, role: "character", application: "isolate", relativity: .94, member_order: order });

function productionFixture(count = 12, climax = Math.ceil(count / 2)) {
  const facts = [
    { block_id: "mara", type: "subject", locked: true, properties: { text: "Mara keeps her crimson coat and silver compass.", combined_context_memberships: [membership("cast-mara", "Mara")] } },
    { block_id: "ivo", type: "subject", locked: true, properties: { text: "Ivo keeps his cobalt coat and brass lantern.", combined_context_memberships: [membership("cast-ivo", "Ivo")] } },
    { block_id: "moonlight", type: "lighting", locked: true, properties: { text: "Preserve cold moonlight against warm practical lanterns." } },
    { block_id: "avoid-crowds", type: "direction", locked: true, intent: "prohibit", effect: "exclude", properties: { text: "Never introduce a crowd or modern vehicle." } },
    ...Array.from({ length: count }, (_, offset) => {
      const sequence = offset + 1;
      const character = sequence % 2 ? "Mara" : "Ivo";
      const target = character === "Mara" ? "cast-mara" : "cast-ivo";
      return {
        block_id: `shot-${sequence}`,
        type: "reference",
        position: String(sequence).padStart(3, "0"),
        properties: {
          label: sequence === climax ? "Climax: the hidden compass reveals the observatory" : `Original beat ${sequence}`,
          text: `${character} performs unique authored action ${sequence}.`,
          storyboard_frame_index: sequence,
          storyboard_title: "The midnight observatory",
          source_artifact_id: "storyboard-midnight",
          storyboard_shot_title: sequence === climax ? "Climax: the hidden compass reveals the observatory" : `Original beat ${sequence}`,
          storyboard_shot_direction: `${character} performs unique authored action ${sequence}.`,
          storyboard_camera_direction: sequence % 2 ? "Slow rightward tracking shot." : "Matched left-facing eyeline.",
          storyboard_frame_prompt: `${character} in moonlit observatory at story beat ${sequence}.`,
          combined_context_memberships: [membership(target, character, sequence)],
        },
      };
    }),
  ];
  return { facts, relationships: [{ relation_id: "cast-opposition", from_block_id: "mara", to_block_id: "ivo", kind: "contrast" }] };
}

const approvedReferences = (sequences) => sequences.map((sequence) => ({
  referenceId: `reference-${sequence}`,
  blockId: `shot-${sequence}`,
  sequence,
  contextGroupIds: [sequence % 2 ? "cast-mara" : "cast-ivo"],
  label: `Approved storyboard image ${sequence}`,
}));

test("registers truthful, reusable specialist teams for every supported output format", () => {
  const expected = {
    video: ["Director", "Script writer", "Cinematographer", "Story boarder"],
    storyboard: ["Director", "Storyboard artist", "Cinematographer", "Continuity supervisor"],
    slides: ["Narrative strategist", "Information designer", "Presentation art director", "Fact and continuity editor"],
    short_story: ["Developmental editor", "Story architect", "Continuity editor", "Prose stylist"],
    scene: ["Showrunner", "Screenwriter", "Dialogue editor", "Script supervisor"],
    image: ["Creative director", "Art director", "Lighting designer", "Brand and continuity steward"],
  };
  for (const [format, labels] of Object.entries(expected)) {
    const team = productionTeamFor(format);
    assert.equal(team.format, format);
    assert.equal(team.version, "1.0.0");
    assert.deepEqual(team.specialists.map((role) => role.label), labels);
  }
});

test("decomposes arbitrarily long authored context into legal, non-repeating anchor-first scenes", () => {
  const snapshot = productionFixture(40, 20);
  const plan = buildManagedProductionPlan("video", snapshot, { references: approvedReferences([1, 20, 40]) });

  assert.equal(plan.scenes.length, 40, "the legacy twelve-item planner cap must not truncate the production");
  assert.deepEqual(plan.narrativeOrder, plan.scenes.map((scene) => scene.id));
  assert.equal(plan.scenes.find((scene) => scene.id === plan.anchorSceneId)?.narrativeOrder, 20);
  assert.equal(plan.executionOrder[0], plan.anchorSceneId);
  assert.notDeepEqual(plan.executionOrder, plan.narrativeOrder);
  assert.ok(plan.scenes.every((scene) => scene.durationSeconds >= 4 && scene.durationSeconds <= 15));
  assert.ok(plan.scenes.every((scene) => scene.referenceIds.length <= VIDEO_ADAPTER_CONTRACT.maxReferenceImages));
  assert.ok(plan.parallelWaves.every((wave) => wave.length <= 3));
  assert.ok(plan.parallelWaves.some((wave) => wave.length > 1));
  assert.equal(plan.providerCapabilities.nativeBoundaryFrames, false);
  assert.equal(plan.providerCapabilities.finalVideoComposition, false);
  assert.equal(plan.providerCapabilities.assembly, "ordered-scene-reel");

  const positions = new Map(plan.executionOrder.map((id, index) => [id, index]));
  for (const scene of plan.scenes) for (const dependency of scene.dependsOn) {
    assert.ok(positions.get(dependency) < positions.get(scene.id), `${scene.id} starts before ${dependency}`);
  }
  const authoredIds = plan.scenes.flatMap((scene) => scene.sourceBlockIds.filter((id) => id.startsWith("shot-")));
  assert.equal(new Set(authoredIds).size, 40);
  assert.equal(authoredIds.length, 40, "narrative beats cannot be duplicated between independent clips");
  assert.equal(plan.estimatedVideoCostMicrousd, plan.totalDurationSeconds * VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd["720p"]);
});

test("all managed production teams prefer edited generated-image palettes over immutable extraction evidence",()=>{
  const snapshot={facts:[{block_id:"edited-image",type:"reference",properties:{label:"Customized image",text:"Preserve my chosen colors",palette:["#112233","#ff6699"],output_palette:["#112233","#ff6699"],colors:["#aaaaaa"]}}]};
  for(const format of ["image","video","storyboard","slides","scene","short_story"]){const plan=buildManagedProductionPlan(format,snapshot);assert.deepEqual(plan.continuityBible.palette,["#112233","#ff6699"],format);assert.match(JSON.stringify(plan),/#112233/);assert.match(JSON.stringify(plan),/#ff6699/);assert.doesNotMatch(JSON.stringify(plan),/#aaaaaa/);}
});

test("structured adopted outputs preserve every ordered edited beat without leaking neighboring artifact items", () => {
  const items = Array.from({ length: 17 }, (_, offset) => ({
    source_artifact_item_id: `item-${offset + 1}`,
    title: `Authored movement ${offset + 1}`,
    body: offset === 16 ? "THE FINAL CAREFULLY EDITED REVELATION" : `Distinct authored movement ${offset + 1}`,
    notes: `Exact camera movement ${offset + 1}`,
    context_group_ids: [offset % 2 ? "cast-ivo" : "cast-mara"],
  }));
  const snapshot = { facts: [{ block_id: "adopted-film", type: "motion", locked: true, properties: { source_artifact_id: "film-original", text: "A whole imported film must never leak into each individual scene.", artifact_structure: { items } } }] };
  const claims = productionClaims(snapshot);
  const plan = buildManagedProductionPlan("video", snapshot);
  assert.equal(claims.length, 17);
  assert.equal(plan.scenes.length, 17);
  assert.match(plan.scenes.at(-1).action, /FINAL CAREFULLY EDITED REVELATION/);
  assert.deepEqual(plan.scenes[0].contextGroupIds, ["cast-mara"]);
  assert.deepEqual(plan.scenes[1].contextGroupIds, ["cast-ivo"]);

  const first = productionSceneSnapshot(snapshot, plan.scenes[0]);
  assert.equal(first.facts[0].properties.artifact_structure.items.length, 1);
  assert.equal(first.facts[0].properties.artifact_structure.items[0].source_artifact_item_id, "item-1");
  assert.doesNotMatch(JSON.stringify(first), /Distinct authored movement 2|FINAL CAREFULLY EDITED REVELATION/);
});

test("materialized adopted storyboard children replace rather than duplicate their structured parent items", () => {
  const snapshot = { facts: [
    { block_id: "storyboard-root", type: "direction", properties: { source_artifact_id: "source-board", artifact_structure: { items: [
      { source_artifact_item_id: "frame-1", title: "First authored shot", body: "Mara crosses the river." },
      { source_artifact_item_id: "frame-2", title: "Second authored shot", body: "Ivo opens the observatory." },
    ] } } },
    { block_id: "materialized-frame", type: "reference", properties: { source_artifact_id: "source-board", source_artifact_item_id: "frame-1", storyboard_frame_index: 1, storyboard_shot_title: "First authored shot", storyboard_shot_direction: "Mara crosses the river.", text: "Mara crosses the river." } },
  ] };
  const claims = productionClaims(snapshot);
  const plan = buildManagedProductionPlan("video", snapshot);
  assert.equal(claims.length, 2);
  assert.equal(plan.scenes.length, 2);
  assert.equal(claims.filter((claim) => claim.artifactItemId === "frame-1").length, 1);
});

test("nested exclusions remain prohibitions and scoped continuity never enters a different target", () => {
  const snapshot = { facts: [
    { block_id: "mara", type: "subject", locked: true, properties: { text: "Mara wears a silver compass.", combined_context_memberships: [membership("cast-mara", "Mara")] } },
    { block_id: "ivo", type: "subject", locked: true, properties: { text: "Ivo carries a cobalt lantern.", combined_context_memberships: [membership("cast-ivo", "Ivo")] } },
    { block_id: "beats", type: "motion", properties: { source_artifact_id: "owned-film", artifact_structure: { items: [
      { source_artifact_item_id: "mara-shot", title: "Mara enters", body: "Mara discovers the compass.", context_group_ids: ["cast-mara"] },
      { source_artifact_item_id: "ivo-shot", title: "Ivo enters", body: "Ivo opens the observatory.", context_group_ids: ["cast-ivo"] },
      { source_artifact_item_id: "forbidden", type: "exclusion", intent: "prohibit", effect: "must_not_include", title: "NEVER_SHOW_FORBIDDEN_LOGO", body: "No forbidden logo may appear.", context_group_ids: ["cast-mara"] },
    ] } } },
    { block_id: "mara-only-ban", type: "exclusion", effect: "must_not_include", properties: { text: "MARA_ONLY_RED_COAT", combined_context_memberships: [membership("cast-mara", "Mara")] } },
  ], standing_constraints: [{ authority: "authored", axis: "style", polarity: "forbid", value: "No modern cars." }] };
  const plan = buildManagedProductionPlan("video", snapshot);
  const mara = plan.scenes.find((scene) => scene.action.includes("Mara discovers"));
  const ivo = plan.scenes.find((scene) => scene.action.includes("Ivo opens"));
  assert.equal(plan.claims.find((claim) => claim.artifactItemId === "forbidden").negative, true);
  assert.ok(!plan.scenes.some((scene) => scene.action.includes("NEVER_SHOW_FORBIDDEN_LOGO")));
  assert.ok(providerFacingProductionContinuity(plan, mara).prohibitions.some((value) => value.includes("MARA_ONLY_RED_COAT")));
  assert.ok(!providerFacingProductionContinuity(plan, ivo).prohibitions.some((value) => value.includes("MARA_ONLY_RED_COAT")));
  const instructions = productionTeamInstructions(plan, [ivo]);
  assert.doesNotMatch(instructions, /MARA_ONLY_RED_COAT|requiredBlockIds|mara-only-ban/);
  assert.match(instructions, /No modern cars/);
});

test("same-index scoped storyboard references never cross character targets", () => {
  const snapshot = productionFixture(2);
  const references = [
    { referenceId: "mara-image", blockId: "unrelated-mara", sequence: 1, contextGroupIds: ["cast-mara"], label: "Mara frame one" },
    { referenceId: "ivo-image", blockId: "unrelated-ivo", sequence: 1, contextGroupIds: ["cast-ivo"], label: "Ivo frame one" },
  ];
  const plan = buildManagedProductionPlan("video", snapshot, { references });
  assert.ok(plan.scenes[0].referenceIds.includes("mara-image"));
  assert.ok(!plan.scenes[0].referenceIds.includes("ivo-image"));
  assert.ok(!plan.scenes[1].referenceIds.includes("mara-image"));
});

test("provider parallelism is finite, bounded, and safe for malformed values", () => {
  const snapshot = productionFixture(8);
  const references = approvedReferences(Array.from({ length: 8 }, (_, index) => index + 1));
  for (const maximumParallelScenes of [Number.NaN, Number.POSITIVE_INFINITY, 99, 2.7, -8, 0]) {
    const plan = buildManagedProductionPlan("video", snapshot, { references, maximumParallelScenes });
    assert.equal(plan.executionOrder.length, 8);
    assert.ok(plan.parallelWaves.every((wave) => wave.length >= 1 && wave.length <= 3));
  }
});

test("all six reusable production contracts expose legal truthful work graphs", () => {
  const snapshot = productionFixture(3);
  for (const format of ["video", "storyboard", "slides", "short_story", "scene", "image"]) {
    const plan = buildManagedProductionPlan(format, snapshot);
    const system = productionSystemFor(format);
    const units = productionUnitsForPlan(plan);
    assert.equal(system.teamId, plan.team.id);
    assert.equal(system.capabilities.nativeBoundaryFrames, false);
    assert.equal(system.capabilities.videoFrameExtraction, false);
    assert.equal(system.capabilities.finalVideoComposition, false);
    assert.doesNotThrow(() => validateProductionUnits(units));
    assert.ok(units.some((unit) => unit.kind === "review"), `${format} needs a visible production quality checkpoint`);
    if (format === "video") {
      assert.equal(system.capabilities.maxUnitDurationSeconds, 15);
      assert.equal(system.capabilities.maxReferencesPerUnit, 9);
      assert.ok(units.some((unit) => unit.kind === "look-development"));
    } else assert.ok(!units.some((unit) => unit.kind === "look-development"));
  }
});

test("keeps locked global continuity while isolating scoped characters and unrelated storyboard beats", () => {
  const snapshot = productionFixture(8, 4);
  const plan = buildManagedProductionPlan("video", snapshot, { references: approvedReferences([4]) });
  const maraScene = plan.scenes.find((scene) => scene.narrativeOrder === 1);
  const ivoScene = plan.scenes.find((scene) => scene.narrativeOrder === 2);
  const mara = productionSceneSnapshot(snapshot, maraScene);
  const ivo = productionSceneSnapshot(snapshot, ivoScene);
  const maraIds = new Set(mara.facts.map((fact) => fact.block_id));
  const ivoIds = new Set(ivo.facts.map((fact) => fact.block_id));

  assert.ok(maraIds.has("mara"));
  assert.ok(!maraIds.has("ivo"));
  assert.ok(maraIds.has("moonlight"));
  assert.ok(maraIds.has("avoid-crowds"));
  assert.ok(maraIds.has("shot-1"));
  assert.ok(!maraIds.has("shot-2"));
  assert.ok(ivoIds.has("ivo"));
  assert.ok(!ivoIds.has("mara"));
  assert.ok(ivoIds.has("shot-2"));
  assert.ok(!ivoIds.has("shot-1"));
  assert.deepEqual(mara.context_groups.map((group) => group.id), ["cast-mara"]);
  assert.deepEqual(ivo.context_groups.map((group) => group.id), ["cast-ivo"]);
});

test("independent approved scene references are parallelized without exceeding provider reference limits", () => {
  const snapshot = productionFixture(9, 5);
  const references = approvedReferences(Array.from({ length: 9 }, (_, index) => index + 1));
  const plan = buildManagedProductionPlan("video", snapshot, { references, maximumParallelScenes: 3 });
  assert.equal(plan.parallelWaves[0].length, 1);
  assert.equal(plan.parallelWaves[0][0], plan.anchorSceneId);
  assert.ok(plan.parallelWaves.slice(1).some((wave) => wave.length === 3));
  assert.ok(plan.scenes.every((scene) => scene.referenceIds.includes(`reference-${scene.narrativeOrder}`)));

  const crowded = buildManagedProductionPlan("video", snapshot, {
    references: [...references, ...Array.from({ length: 25 }, (_, index) => ({ referenceId: `shared-${index}`, blockId: `shared-${index}`, sequence: null, contextGroupIds: [], label: `Shared identity reference ${index}` }))],
  });
  assert.ok(crowded.scenes.every((scene) => scene.referenceIds.length <= 9));
});

test("frozen manual-versus-managed benchmark proves tenfold planning-defect reduction without claiming rendered-media quality", () => {
  const plan = buildManagedProductionPlan("video", productionFixture(40, 20), { references: approvedReferences([1, 20, 40]) });
  const baseline = scoreManualVideoBaseline(plan, 15);
  const managed = scoreManagedProductionPlan(plan);
  const reduction = productionDefectReduction(baseline, managed);

  assert.equal(baseline.basis, "deterministic-plan-contract");
  assert.equal(managed.basis, "deterministic-plan-contract");
  assert.ok(baseline.contextCoverage <= .1);
  assert.equal(managed.contextCoverage, 1);
  assert.equal(managed.requiredClaimCoverage, 1);
  assert.equal(managed.nonDuplication, 1);
  assert.ok(managed.score >= .9);
  assert.ok(reduction >= 10, `expected >=10× planning-defect reduction; received ${reduction.toFixed(2)}×`);
  assert.ok(!("renderedMediaReviewed" in managed));
});

const costBudgets = (usedMicrousd, overrides = {}) => ({
  period: "2026-08",
  currency: "USD",
  user: { usedMicrousd, reservedMicrousd: 0, limitMicrousd: 100_000_000, remainingMicrousd: 100_000_000 - usedMicrousd, ...overrides.user },
  workspace: { usedMicrousd: 0, reservedMicrousd: 0, limitMicrousd: 1_000_000_000, remainingMicrousd: 1_000_000_000, ...overrides.workspace },
});

test("monthly dollar gates use strict 60/80 thresholds, every-generation warnings, and mandatory 95% resurfacing", () => {
  assert.equal(generationBudgetGate(costBudgets(59_900_000)).level, "none");
  assert.equal(generationBudgetGate(costBudgets(60_000_000)).level, "none");
  assert.equal(generationBudgetGate(costBudgets(60_000_001)).level, "notice");
  assert.equal(generationBudgetGate(costBudgets(79_999_999)).level, "notice");
  assert.equal(generationBudgetGate(costBudgets(80_000_000)).level, "notice");
  assert.equal(generationBudgetGate(costBudgets(80_000_001)).level, "every-generation");
  assert.equal(generationBudgetGate(costBudgets(94_900_000), { suppressedUntilCritical: true }).level, "none");
  assert.equal(generationBudgetGate(costBudgets(95_000_000), { suppressedUntilCritical: true }).level, "critical");
  assert.equal(generationBudgetGate(costBudgets(95_000_000), { suppressedUntilCritical: true }).dismissible, false);
  assert.equal(generationBudgetGate(costBudgets(60_100_000), { noticeAcknowledged: true }).requiresAcknowledgement, false);
  assert.equal(generationBudgetGate(costBudgets(80_100_000), { noticeAcknowledged: true }).requiresAcknowledgement, true);
  assert.equal(generationBudgetGate(costBudgets(99_900_000), { projectedMicrousd: 200_000 }).level, "blocked");
  assert.equal(generationBudgetGate(costBudgets(59_900_000), { projectedMicrousd: 200_000 }).level, "notice");

  const constrainedOrg = generationBudgetGate(costBudgets(10_000_000, { workspace: { usedMicrousd: 810_000_000 } }));
  assert.equal(constrainedOrg.scope, "workspace");
  assert.equal(constrainedOrg.level, "every-generation");
  assert.notEqual(generationBudgetPreferenceKey("person-one", "2026-08", "suppressed"), generationBudgetPreferenceKey("person-one", "2026-09", "suppressed"));
  assert.notEqual(generationBudgetPreferenceKey("person-one", "2026-08", "suppressed"), generationBudgetPreferenceKey("person-two", "2026-08", "suppressed"));
  assert.notEqual(generationBudgetPreferenceKey("person-one","2026-08","suppressed","organization-a"),generationBudgetPreferenceKey("person-one","2026-08","suppressed","organization-b"));
  assert.equal(generationBudgetPreferenceKey("person-one","2026-08","suppressed",null),generationBudgetPreferenceKey("person-one","2026-08","suppressed"));
});

test("failed managed scene productions remain visibly recoverable without exposing private provider receipts", () => {
  const failure = { code: "fal_result_response_invalid", category: "network", scope: "provider", action: "retry", message: "A paid scene result could not be downloaded.", retryable: true, retryAfterMs: null, requestId: "fal-paid-scene", httpStatus: 502 };
  const base = { kind: "render_document", status: "failed", members: [], result: { artifactKind: "video", recoverableProductionProviderRequest: true }, errorDetail: failure };
  assert.equal(documentJobCanRecoverProviderRender(base), true);
  assert.equal(documentJobCanRecoverProviderRender({ ...base, result: { artifactKind: "video", productionSceneReceipts: { "scene-2": { sceneId: "scene-2", status: "submitted", providerJobId: "fal-paid-scene" } } } }), true);
  assert.equal(documentJobCanRecoverProviderRender({ ...base, result: { artifactKind: "video" } }), false);
  assert.equal(documentJobCanRecoverProviderRender({ ...base, errorDetail: { ...failure, category: "safety", retryable: false, httpStatus: 422 } }), false);

  const progress = documentJobProgress({ ...base, status: "running", stage: "rendering-scenes", progressMessage: "2 of 5 production scenes are safely stored." });
  assert.equal(progress.label, "Render");
  assert.match(progress.detail, /2 of 5 scenes stored/);
});

test("managed provider planning pages long films without inheriting the legacy twelve-scene schema", async () => {
  const snapshot = { facts: Array.from({ length: 17 }, (_, offset) => ({ block_id: `shot-${offset + 1}`, type: "reference", properties: { text: `Unique action ${offset + 1}`, storyboard_frame_index: offset + 1, source_artifact_id: "ordered-storyboard", storyboard_shot_title: `Shot ${offset + 1}`, storyboard_shot_direction: `Unique action ${offset + 1}` } })) };
  const production = buildManagedProductionPlan("video", snapshot);
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    requests.push(request);
    const providerInput = JSON.parse(request.input);
    const scenes = providerInput.production.assigned_scenes;
    const output = { title: "A complete film", summary: "Every source beat has its own scene.", content_markdown: scenes.map((scene) => scene.action).join("\n"), items: scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: scene.camera_direction, image_prompt: scene.action, context_group_ids: [] })) };
    return Response.json({ id: `response-${requests.length}`, model: "gpt-test", output_text: JSON.stringify(output), usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 } });
  };
  try {
    const planned = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-test" }, "owner", "video", { documentTitle: "Complete film", snapshot, production });
    assert.equal(planned.output.items.length, 17);
    assert.deepEqual(requests.map((request) => JSON.parse(request.input).production.assigned_scenes.length), [8, 8, 1]);
    assert.ok(requests.every((request) => request.instructions.includes("separate 4–15 second provider generation")));
    assert.ok(requests.every((request) => !request.instructions.includes("compressing their beats into the available runtime")));
    assert.equal(planned.usage.totalTokens, 540);
  } finally { globalThis.fetch = originalFetch; }
});

test("long-form stories and screenplays retain later-page manuscripts and repair repeated openings once", async () => {
  for (const kind of ["short_story", "scene"]) {
    const snapshot = { facts: Array.from({ length: 10 }, (_, offset) => ({ block_id: `beat-${offset + 1}`, type: "reference", properties: { text: `Unique action ${offset + 1}`, storyboard_frame_index: offset + 1, source_artifact_id: "continuous-story", storyboard_shot_title: `Beat ${offset + 1}`, storyboard_shot_direction: `Unique action ${offset + 1}` } })) };
    const production = buildManagedProductionPlan(kind, snapshot);
    const requests = [];
    const attempts = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init = {}) => {
      const request = JSON.parse(String(init.body));
      const provider = JSON.parse(request.input);
      requests.push({ request, provider });
      const page = provider.production.page;
      const repaired = Boolean(page.repair_issues?.length);
      const scenes = provider.production.assigned_scenes;
      const items = scenes.map((scene, index) => ({ title: scene.title, body: page.page_index === 1 && index === 0 && !repaired ? "Unique action 1" : scene.action, notes: "", image_prompt: scene.action, context_group_ids: [] }));
      const markdown = page.page_index === 0 ? `# Complete work\n\n${items.map((item) => item.body).join("\n")}\n\nFIRST_PAGE_END_SENTINEL` : `# Complete work\n\n${items.map((item) => item.body).join("\n")}\n\nFINAL_MANUSCRIPT_ONLY_SENTINEL`;
      return Response.json({ id: `response-${requests.length}`, model: "gpt-test", output_text: JSON.stringify({ title: "Complete work", summary: "A continuous work.", content_markdown: markdown, items }), usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
    };
    try {
      const output = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-test" }, "owner", kind, { documentTitle: "Complete work", snapshot, production, plannerAttempt: (attempt) => attempts.push(attempt) });
      assert.equal(requests.length, 3, kind);
      assert.equal(output.inputReceipt.whole_work_validation.repaired_pages, 1, kind);
      assert.equal(output.output.items.length, 10, kind);
      assert.match(output.output.content_markdown, /FIRST_PAGE_END_SENTINEL/);
      assert.match(output.output.content_markdown, /FINAL_MANUSCRIPT_ONLY_SENTINEL/);
      assert.equal((output.output.content_markdown.match(/# Complete work/g) ?? []).length, 1, kind);
      assert.match(requests[1].provider.production.page.prior_ending, /FIRST_PAGE_END_SENTINEL/);
      assert.ok(requests[2].provider.production.page.repair_issues.length > 0);
      assert.deepEqual(attempts.map((attempt) => attempt.usage.totalTokens), [150, 300, 450]);
      assert.equal(output.usage.totalTokens, 450);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("multi-page decks retain one cover, correct repeated content, and lock the original presentation", async () => {
  const snapshot = { facts: Array.from({ length: 10 }, (_, offset) => ({ block_id: `slide-${offset + 1}`, type: "reference", properties: { text: `Unique action ${offset + 1}`, storyboard_frame_index: offset + 1, source_artifact_id: "ordered-slides", storyboard_shot_title: `Heading ${offset + 1}`, storyboard_shot_direction: `Unique action ${offset + 1}` } })) };
  const production = buildManagedProductionPlan("slides", snapshot);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const provider = JSON.parse(request.input);
    requests.push({ request, provider });
    const page = provider.production.page;
    const repaired = Boolean(page.repair_issues?.length);
    const presentation = { aspect_ratio: "16:9", theme: page.page_index === 1 && !repaired ? "Theme Beta" : "Theme Alpha", footer_label: "Alpha deck", style_preset: "gallery", mode: "light", palette: { background: "#ffffff", foreground: "#111111", accent: "#112233", muted: "#333333", surface: "#eeeeee" } };
    const items = provider.production.assigned_scenes.map((scene, index) => {
      const position = scene.narrative_order;
      return { title: `Heading ${position}`, body: page.page_index === 1 && index === 0 && !repaired ? "Meaning 1" : `Meaning ${position}`, notes: `Speaker ${position}`, image_prompt: `Frame ${position}`, context_group_ids: [], slide: { layout: position === 1 || page.page_index === 1 && index === 0 && !repaired ? "cover" : "split", kicker: `Kicker ${position}`, bullets: [], visual: { kind: "hero-type", label: `Label ${position}`, value: `Emphasis ${position}`, data: [{ label: `Datum ${position}`, value: `Amount ${position}`, weight: .7 }] } } };
    });
    return Response.json({ id: `slides-${requests.length}`, model: "gpt-test", output_text: JSON.stringify({ title: "Alpha deck", summary: "A coherent presentation.", content_markdown: `# Alpha deck\n\n${items.map((item) => item.body).join("\n")}`, presentation, items }), usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
  };
  try {
    const planned = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-test" }, "owner", "slides", { documentTitle: "Alpha deck", snapshot, production });
    assert.equal(requests.length, 3);
    assert.equal(planned.inputReceipt.whole_work_validation.repaired_pages, 1);
    assert.equal(planned.output.items.length, 10);
    assert.equal(planned.output.items.filter((item) => item.slide.layout === "cover").length, 1);
    assert.equal(planned.output.items[8].body, "Meaning 9");
    assert.equal(planned.output.presentation.theme, "Theme Alpha");
    assert.equal(requests[1].provider.production.page.locked_presentation.theme, "Theme Alpha");
    assert.deepEqual(requests[1].request.text.format.schema.properties.presentation.properties.theme.enum, ["Theme Alpha"]);
    assert.equal(planned.usage.totalTokens, 450);
  } finally { globalThis.fetch = originalFetch; }
});

test("completed planning pages report billable usage even when a later provider page fails", async () => {
  const snapshot = { facts: Array.from({ length: 17 }, (_, offset) => ({ block_id: `beat-${offset + 1}`, type: "reference", properties: { text: `Unique action ${offset + 1}`, storyboard_frame_index: offset + 1, source_artifact_id: "long-film", storyboard_shot_title: `Beat ${offset + 1}`, storyboard_shot_direction: `Unique action ${offset + 1}` } })) };
  const production = buildManagedProductionPlan("video", snapshot);
  const completed = [];
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    calls += 1;
    if (calls === 3) return Response.json({ error: { code: "provider_temporarily_unavailable", message: "The third page could not be generated." } }, { status: 500 });
    const provider = JSON.parse(JSON.parse(String(init.body)).input);
    const scenes = provider.production.assigned_scenes;
    return Response.json({ id: `paid-page-${calls}`, model: "gpt-test", output_text: JSON.stringify({ title: "Long film", summary: "A complete treatment.", content_markdown: scenes.map((scene) => scene.action).join("\n"), items: scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: "", image_prompt: scene.action, context_group_ids: [] })) }), usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 } });
  };
  try {
    await assert.rejects(generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-test" }, "owner", "video", { documentTitle: "Long film", snapshot, production, plannerAttempt: (attempt) => completed.push(attempt) }));
    assert.equal(completed.length, 2);
    assert.equal(completed.at(-1).usage.totalTokens, 360);
    assert.deepEqual(completed.at(-1).responseIds, ["paid-page-1", "paid-page-2"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("managed storyboards checkpoint exact completed-frame costs and scoped reference provenance before a later failure", async () => {
  const snapshot = productionFixture(3, 2);
  const approved = approvedReferences([1, 2, 3]);
  const production = buildManagedProductionPlan("storyboard", snapshot, { references: approved });
  const sourceBytes = Uint8Array.from([137, 80, 78, 71]);
  const references = approved.map((reference) => ({ ...reference, bytes: sourceBytes, mimeType: "image/png", mode: "preserve_composition", shotDirection: `Direction ${reference.sequence}`, cameraDirection: "Controlled camera.", framePrompt: `Frame ${reference.sequence}`, sourceArtifactId: "board", sourceArtifactItemId: `frame-${reference.sequence}`, sourceArtifactKind: "storyboard", storyboardTitle: "Midnight", contextGroups: reference.contextGroupIds.map((id) => ({ id, name: id, target: id, role: "character", application: "isolate", relativity: 1 })) }));
  const draft = { title: "Storyboard", summary: "A coherent ordered sequence.", content_markdown: "A storyboard.", presentation: null, items: production.scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: scene.cameraDirection, image_prompt: scene.imagePrompt, context_group_ids: scene.contextGroupIds, slide: null })) };
  const media = new Map();
  const checkpoints = [];
  const requests = [];
  let imageRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/moderations")) return Response.json({ id: "moderation-pass", model: "omni-moderation-latest", results: [{ flagged: false, categories: {}, category_scores: {} }] });
    imageRequests += 1;
    requests.push({ url, body: init.body });
    if (imageRequests === 3) return Response.json({ error: { code: "provider_unavailable", message: "The last frame could not be generated." } }, { status: 500 });
    return Response.json({ data: [{ b64_json: btoa("image-bytes") }], usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  };
  const env = { OPENAI_API_KEY: "test-only", OPENAI_IMAGE_MODEL: "gpt-image-2", MEDIA: {
    put: async (key, value, options) => media.set(key, { bytes: new Uint8Array(value), options }),
    get: async (key) => { const value = media.get(key); return value ? { body: value.bytes, customMetadata: value.options.customMetadata, writeHttpMetadata: (headers) => headers.set("content-type", value.options.httpMetadata.contentType) } : null; },
  } };
  try {
    const providerActorId="paying-collaborator",expectedActor=`forma_${createHash("sha256").update(providerActorId).digest("hex").slice(0,32)}`;
    await assert.rejects(renderManagedStoryboardProduction(env, "owner", "board-one", draft, production, { providerActorId,snapshot, references, checkpoint: (value) => checkpoints.push(structuredClone(value)) }));
    const latest = checkpoints.at(-1);
    const completed = Object.values(latest.productionFrameReceipts);
    assert.equal(completed.length, 2, "each successfully paid frame must survive a later failed frame");
    assert.ok(completed.every((receipt) => receipt.status === "completed" && receipt.costMicrousd > 0 && receipt.usage.totalTokens === 200));
    assert.ok(completed.every((receipt) => receipt.referenceInputs.some((reference) => reference.role === "authored-reference")));
    assert.ok(completed.some((receipt) => receipt.referenceInputs.some((reference) => reference.role === "inherited-production-continuity")));
    assert.equal(latest.renderedItems.length, 2);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(({body})=>body instanceof FormData&&body.get("user")===expectedActor),"managed image providers identify the paying collaborator, not the storage owner");
    assert.ok([...media.values()].every(({options})=>options.customMetadata.ownerId==="owner"),"generated shared media remains owned by the project owner");
  } finally { globalThis.fetch = originalFetch; }
});

test("managed film rendering submits the chosen anchor first and assembles only an honest ordered scene reel", async () => {
  const snapshot = productionFixture(3, 2);
  const authorized = approvedReferences([1, 2, 3]);
  const production = buildManagedProductionPlan("video", snapshot, { references: authorized });
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  const references = authorized.map((reference) => ({
    ...reference,
    bytes,
    mimeType: "image/png",
    mode: "preserve_composition",
    shotDirection: `Unique action ${reference.sequence}`,
    cameraDirection: "Slow controlled tracking.",
    framePrompt: `Reference frame ${reference.sequence}`,
    sourceArtifactId: "storyboard-midnight",
    sourceArtifactItemId: `frame-${reference.sequence}`,
    sourceArtifactKind: "storyboard",
    storyboardTitle: "The midnight observatory",
    provider: "fal",
    providerMediaUrl: `https://v3b.fal.media/files/test/reference-${reference.sequence}.png`,
    contextGroups: reference.contextGroupIds.map((id) => ({ id, name: id, target: id, role: "character", application: "isolate", relativity: .9 })),
  }));
  const draft = { title: "A complete film", summary: "A source-grounded production.", content_markdown: "A complete film.", presentation: null, items: production.scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: scene.cameraDirection, image_prompt: scene.action, context_group_ids: scene.contextGroupIds, slide: null })) };
  const stored = [];
  const requests = [];
  let providerRequest = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/reference-") && url.endsWith(".png")) return new Response(bytes, { headers: { "content-type": "image/png" } });
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      providerRequest += 1;
      return Response.json({ request_id: `fal-${providerRequest}`, status: "IN_QUEUE" });
    }
    const match = /\/requests\/(fal-\d+)/.exec(url);
    if (url.includes("/status")) return Response.json({ request_id: match?.[1], status: "COMPLETED" });
    if (match) return Response.json({ video: { url: `https://v3b.fal.media/files/test/${match[1]}.mp4`, content_type: "video/mp4" } });
    if (url.endsWith(".mp4")) return new Response(Uint8Array.from([0, 1, 2, 3]), { headers: { "content-type": "video/mp4" } });
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const env = { FAL_KEY: "test-only", FORMA_VIDEO_PROVIDER: "fal", MEDIA: { put: async (key, _body, options) => stored.push({ key, options }) } };
    const providerActorId="paying-collaborator",expectedActor=`forma_${createHash("sha256").update(providerActorId).digest("hex").slice(0,32)}`;
    const result = await renderManagedVideoProduction(env, "owner", "film-one", draft, production, { providerActorId,snapshot, references, videoSize: "1280x720", audioMode: "silent" });
    assert.equal(requests.length, 3);
    assert.match(requests[0].prompt, /hidden compass reveals the observatory/i);
    assert.deepEqual(result.receipts.map((scene) => scene.narrativeOrder), [1, 2, 3]);
    assert.deepEqual(result.assembly.narrative_order, production.narrativeOrder);
    assert.deepEqual(result.assembly.generation_order, production.executionOrder);
    assert.equal(result.assembly.composed, false);
    assert.equal(result.assembly.native_boundary_frames, false);
    assert.equal(result.items.length, 3);
    assert.equal(stored.length, 3);
    assert.ok(result.receipts.every((scene) => scene.providerJobId));
    assert.ok(requests.every((request) => request.duration <= 15));
    assert.ok(requests.every((request)=>request.end_user_id===expectedActor),"managed video identifies the paying collaborator at the provider");
    assert.ok(stored.every(({options})=>options.customMetadata.ownerId==="owner"),"collaborator-paid scene media remains owned by the project");

    const anchor = result.receipts.find((scene) => scene.sceneId === production.anchorSceneId);
    const resumedReceipts = Object.fromEntries(result.receipts.map((scene) => [scene.sceneId, scene.sceneId === anchor.sceneId ? { ...scene, status: "submitted", mediaUrl: undefined, mediaType: undefined } : scene]));
    const resumed = await renderManagedVideoProduction(env, "owner", "film-one", draft, production, {
      snapshot,
      providerActorId,
      references,
      videoSize: "1280x720",
      audioMode: "silent",
      existingItems: result.items.filter((item) => item.scene_id !== anchor.sceneId),
      existingSceneReceipts: resumedReceipts,
      prepaidSceneIds: result.receipts.map((scene) => scene.sceneId),
    });
    assert.equal(requests.length, 3, "a previously accepted paid scene cannot be submitted to the provider again");
    assert.equal(resumed.videoCostMicrousd, 0, "scene charges settled by the interrupted attempt cannot be debited twice");
    assert.equal(resumed.items.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});
