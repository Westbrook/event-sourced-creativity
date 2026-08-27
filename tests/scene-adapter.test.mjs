import assert from "node:assert/strict";
import test from "node:test";

import { buildManagedProductionPlan, productionTeamFor } from "../src/model/managed-production.ts";
import { createSceneConfiguration } from "../src/model/scene-configuration.ts";
import { generateManagedArtifactDraft } from "../worker/managed-production.ts";
import { generateDocumentArtifact } from "../worker/openai-adapter.ts";

const sceneSnapshot = {
  facts: [{
    block_id: "PRIVATE_SCENE_BLOCK_8731",
    type: "direction",
    properties: { text: "Mara listens for the harbor bell as the lighthouse keeper approaches." },
  }],
  relationships: [],
};

const sceneOutput = (medium) => ({
  title: "The harbor bell",
  summary: "Mara and the lighthouse keeper share one authored dramatic moment.",
  content_markdown: medium === "audio"
    ? "SFX: The harbor bell rings through the fog.\nMARA: Someone is coming."
    : "EXT. HARBOR - NIGHT\nMara turns toward the lighthouse keeper.",
  presentation: null,
  items: [{
    title: "The bell rings",
    body: "Mara listens for the harbor bell as the lighthouse keeper approaches.",
    notes: medium === "audio" ? "A distant bell gives way to purposeful silence." : "Track toward the lighthouse keeper.",
    image_prompt: medium === "audio" ? "" : "Mara beneath the harbor light.",
    context_group_ids: [],
    slide: null,
  }],
});

test("audio scene plans select an audible production team while legacy visual scenes keep their screenplay team", () => {
  const visual = buildManagedProductionPlan("scene", sceneSnapshot);
  const audio = buildManagedProductionPlan("scene", sceneSnapshot, { sceneMedium: "audio" });

  assert.equal(visual.team, productionTeamFor("scene"));
  assert.equal(visual.team.id, "screenwriting-room");
  assert.equal(audio.team, productionTeamFor("scene", "audio"));
  assert.equal(audio.team.id, "audio-scene-writing-room");
  assert.equal(audio.team.label, "Writers’ room");
  assert.deepEqual(audio.team.specialists.map((specialist) => specialist.label), [
    "Showrunner", "Story architect", "Dialogue editor", "Continuity editor",
  ]);
  assert.doesNotMatch(JSON.stringify(audio.team), /screenwriting|screenwriter|screenplay|screen continuity/i);
});

test("scene adaptation defaults to visual and renders audio against the same authored narrative context", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const providerInput = JSON.parse(request.input);
    requests.push({ request, providerInput });
    return Response.json({
      id: `scene-response-${requests.length}`,
      model: "gpt-scene-test",
      output_text: JSON.stringify(sceneOutput(providerInput.scene_configuration.medium)),
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
  };

  try {
    const environment = { OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-scene-test" };
    const visual = await generateDocumentArtifact(environment, "authorized-actor", "scene", {
      documentTitle: "The harbor bell",
      snapshot: sceneSnapshot,
      options: { itemCount: 1 },
    });
    const configuration = createSceneConfiguration("audio", {
      source: "production-path",
      targetFormat: "audio",
      downstreamFormats: ["audio"],
    });
    const audio = await generateDocumentArtifact(environment, "authorized-actor", "scene", {
      documentTitle: "The harbor bell",
      snapshot: sceneSnapshot,
      options: { itemCount: 1, sceneMedium: "audio", sceneConfiguration: configuration },
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].providerInput.scene_configuration.medium, "visual");
    assert.equal(requests[0].providerInput.scene_configuration.source, "manual");
    assert.equal(requests[0].providerInput.scene_configuration.alternate_medium, "audio");
    assert.match(requests[0].request.instructions, /production-readable scene for film or television/i);
    assert.match(requests[0].request.instructions, /visible action, composition, visual staging/i);
    assert.match(requests[0].request.instructions, /camera continuity/i);

    assert.deepEqual(requests[1].providerInput.scene_configuration, {
      medium: "audio",
      source: "production-path",
      target_format: "audio",
      downstream_formats: ["audio"],
      alternate_medium: "visual",
      context_continuity: "same-authored-narrative-context",
      alternate_rendering: { medium: "visual", preserve_authored_context: true },
    });
    assert.match(requests[1].request.instructions, /production-readable audio scene/i);
    assert.match(requests[1].request.instructions, /environmental ambience, distinctive sound cues/i);
    assert.match(requests[1].request.instructions, /character voice and dialogue, meaningful silence/i);
    assert.match(requests[1].request.instructions, /never require a camera angle, shot list, image description/i);
    assert.doesNotMatch(requests[1].request.instructions, /screenplay conventions|strongest frame|notes preserve staging and camera continuity/i);
    assert.deepEqual(requests[0].providerInput.creative_context, requests[1].providerInput.creative_context);
    assert.match(JSON.stringify(requests[1].providerInput.creative_context), /Mara listens for the harbor bell/);
    assert.doesNotMatch(JSON.stringify(requests), /PRIVATE_SCENE_BLOCK_8731/);

    assert.equal(visual.inputReceipt.scene_configuration.medium, "visual");
    assert.equal(audio.inputReceipt.scene_configuration.medium, "audio");
    assert.equal(audio.inputReceipt.providerInput.scene_configuration.alternate_medium, "visual");
    assert.equal(audio.output.items[0].image_prompt, "");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("managed audio scenes retain configuration and audible continuity across pages and bounded repairs", async () => {
  const snapshot = {
    facts: Array.from({ length: 10 }, (_, offset) => ({
      block_id: `PRIVATE_AUDIO_BEAT_${offset + 1}`,
      type: "reference",
      properties: {
        text: `Unique action ${offset + 1}`,
        storyboard_frame_index: offset + 1,
        source_artifact_id: "PRIVATE_CONTINUOUS_AUDIO_SOURCE",
        storyboard_shot_title: `Beat ${offset + 1}`,
        storyboard_shot_direction: `Unique action ${offset + 1}`,
        storyboard_camera_direction: `PRIVATE_CAMERA_DIRECTION_${offset + 1}`,
      },
    })),
  };
  const production = buildManagedProductionPlan("scene", snapshot);
  const configuration = createSceneConfiguration("audio", {
    source: "production-path",
    targetFormat: "audio",
    downstreamFormats: ["audio"],
  });
  const requests = [];
  const progress = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const request = JSON.parse(String(init.body));
    const providerInput = JSON.parse(request.input);
    requests.push({ request, providerInput });
    const page = providerInput.production.page;
    const repaired = Boolean(page.repair_issues?.length);
    const items = providerInput.production.assigned_scenes.map((scene, index) => ({
      title: scene.title,
      body: page.page_index === 1 && index === 0 && !repaired ? "Unique action 1" : scene.action,
      notes: "Preserve the ordered audio cue and intentional silence.",
      image_prompt: "",
      context_group_ids: [],
      slide: null,
    }));
    const markdown = page.page_index === 0
      ? `# Complete audio scene\n\n${items.map((item) => item.body).join("\n")}\n\nFIRST_AUDIO_PAGE_END_SENTINEL`
      : `# Complete audio scene\n\n${items.map((item) => item.body).join("\n")}\n\nFINAL_AUDIO_PAGE_END_SENTINEL`;
    return Response.json({
      id: `audio-scene-response-${requests.length}`,
      model: "gpt-scene-test",
      output_text: JSON.stringify({ title: "Complete audio scene", summary: "A continuous authored audio drama.", content_markdown: markdown, presentation: null, items }),
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
  };

  try {
    const result = await generateManagedArtifactDraft(
      { OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-scene-test" },
      "authorized-actor",
      "scene",
      { documentTitle: "Complete audio scene", snapshot, production, sceneMedium: "audio", sceneConfiguration: configuration, progress: (_stage, message) => progress.push(message) },
    );

    assert.equal(production.team.id, "audio-scene-writing-room", "legacy production plans are normalized for final persisted evidence");
    assert.equal(result.inputReceipt.team.id, "audio-scene-writing-room");
    assert.deepEqual(result.inputReceipt.team, production.team);
    assert.ok(progress.every((message) => !/screenwriting|screenwriter|screenplay|screen continuity/i.test(message)));
    assert.equal(requests.length, 3, "both original pages and their bounded repair retain the audio scene profile");
    assert.ok(requests.every(({ providerInput }) => providerInput.scene_configuration.medium === "audio"));
    assert.ok(requests.every(({ providerInput }) => providerInput.scene_configuration.alternate_medium === "visual"));
    assert.ok(requests.every(({ providerInput }) => providerInput.production.team.every((specialist) =>
      !/screenwriting|screenwriter|screenplay|screen continuity/i.test(`${specialist.role} ${specialist.deliverable}`))));
    assert.ok(requests.every(({ providerInput }) => providerInput.production.team.some((specialist) => specialist.role === "Dialogue editor")));
    assert.ok(requests.every(({ providerInput }) => providerInput.production.assigned_scenes.every((scene) => !("camera_direction" in scene))));
    assert.ok(requests.every(({ providerInput }) => !("camera" in providerInput.production.continuity_bible)));
    assert.ok(requests.every(({ providerInput }) => providerInput.production.assigned_scenes.every((scene) =>
      !("camera" in scene.continuity_bible)
      && !/camera axis|screen direction|held closing image|eyeline/i.test(`${scene.transition_in} ${scene.transition_out}`))));
    assert.ok(requests.every(({ request }) => /audio-scene writing, dialogue, sound-design, and continuity team/i.test(request.instructions)));
    assert.ok(requests.every(({ request }) => !/Continue the same screenplay scene|Camera:|PRIVATE_CAMERA_DIRECTION_/i.test(request.instructions)));
    assert.ok(requests.every(({ request }) => !/camera axis|screen direction|held closing image|eyeline/i.test(request.instructions)));
    assert.match(requests[1].request.instructions, /Continue the same audio scene while preserving its ordered sound cues/i);
    assert.match(requests[2].request.instructions, /Continue the same audio scene while preserving its ordered sound cues/i);
    assert.ok(requests[2].providerInput.production.page.repair_issues.length > 0);
    assert.equal(result.inputReceipt.scene_configuration.medium, "audio");
    assert.ok(result.inputReceipt.pages.every((page) => page.scene_configuration.medium === "audio"));
    assert.ok(result.inputReceipt.pages.every((page) => page.providerInput.scene_configuration.context_continuity === "same-authored-narrative-context"));
    assert.equal(result.inputReceipt.whole_work_validation.repaired_pages, 1);
    assert.match(result.output.content_markdown, /FIRST_AUDIO_PAGE_END_SENTINEL/);
    assert.match(result.output.content_markdown, /FINAL_AUDIO_PAGE_END_SENTINEL/);
    assert.equal(result.usage.totalTokens, 450);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("manual Scene validation performs only one bounded repair and keeps all paid usage distinct from acceptance", async () => {
  const previousFetch = globalThis.fetch;
  try {
    for (const acceptsRepair of [true, false]) {
      const requests = [];
      globalThis.fetch = async (url, init = {}) => {
        assert.equal(String(url), "https://api.openai.com/v1/responses");
        requests.push(JSON.parse(String(init.body)));
        assert.ok(requests.length <= 2, "a manual Scene cannot make an undisclosed third request");
        return Response.json({
          id: `bounded-scene-${requests.length}`, model: "gpt-scene-test",
          output_text: JSON.stringify(acceptsRepair && requests.length === 2 ? sceneOutput("visual") : {}),
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        });
      };
      const run = generateDocumentArtifact(
        { OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-scene-test" }, "authorized-test-actor", "scene",
        { documentTitle: "Bounded Scene fixture", snapshot: sceneSnapshot, options: { itemCount: 1 } },
      );
      if (acceptsRepair) {
        const result = await run;
        assert.equal(result.inputReceipt.validation.maximum_provider_calls, 2);
        assert.equal(result.inputReceipt.validation.provider_call_count, 2);
        assert.equal(result.inputReceipt.validation.repair_attempted, true);
        assert.deepEqual(result.inputReceipt.validation.repair_issues, []);
        assert.equal(result.usage.totalTokens, 300);
      } else {
        await assert.rejects(run, (error) => {
          assert.equal(error.detail.code, "provider_returned_incomplete_document_artifact");
          assert.equal(error.providerCallCount, 2);
          assert.equal(error.providerUsage.totalTokens, 300);
          assert.deepEqual(error.providerResponseIds, ["bounded-scene-1", "bounded-scene-2"]);
          return true;
        });
      }
      assert.equal(requests.length, 2);
      assert.match(requests[1].instructions, /Do not submit or request a separate image, video, or audio render/);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});
