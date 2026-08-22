import assert from "node:assert/strict";
import test from "node:test";

import { generationBudgetGate, generationBudgetPreferenceKey } from "../src/model/generation-budget.ts";
import { documentJobCanRecoverProviderRender, documentJobProgress } from "../src/model/document-jobs.ts";
import {
  buildManagedProductionPlan,
  productionDefectReduction,
  productionSceneSnapshot,
  productionTeamFor,
  scoreManagedProductionPlan,
  scoreManualVideoBaseline,
} from "../src/model/managed-production.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { generateManagedArtifactDraft, renderManagedVideoProduction } from "../worker/managed-production.ts";

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
    const result = await renderManagedVideoProduction(env, "owner", "film-one", draft, production, { snapshot, references, videoSize: "1280x720", audioMode: "silent" });
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

    const anchor = result.receipts.find((scene) => scene.sceneId === production.anchorSceneId);
    const resumedReceipts = Object.fromEntries(result.receipts.map((scene) => [scene.sceneId, scene.sceneId === anchor.sceneId ? { ...scene, status: "submitted", mediaUrl: undefined, mediaType: undefined } : scene]));
    const resumed = await renderManagedVideoProduction(env, "owner", "film-one", draft, production, {
      snapshot,
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
