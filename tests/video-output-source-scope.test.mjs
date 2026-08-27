import assert from "node:assert/strict";
import test from "node:test";

import { buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { generateManagedArtifactDraft } from "../worker/managed-production.ts";
import { adaptVideoPrompt, unsupportedAudioIntent } from "../worker/video-prompt-adapter.ts";
import { projectVideoSourceCopy, videoOutputScopedContext } from "../worker/video-source-scope.ts";

const catalog = "Produce seven coordinated, clearly distinct outcomes from this one source: (1) 16:9 polished image, ‘Preview’; (2) editorial narrative, ‘Decision’; (3) playable dialogue scene, ‘Review’; (4) 10-slide executive presentation, ‘Evidence’; (5) 8-frame storyboard, ‘Outcome’; (6) approximately 80-second, eight-scene, 16:9 720p role-guided cinematic scene reel, ‘Film’; (7) original full-length instrumental audio, ‘Companion.’";
const proposed = "The proposed shared-source package includes a polished 16:9 image, editorial narrative, screenplay scene, this executive presentation, an 8-frame storyboard, an approximately 80-second eight-scene 720p film reel, and original instrumental audio.";
const simpleCatalog = "Produce three outputs: (1) an image ‘Preview’; (2) a video ‘Film’; (3) an audio recording ‘Companion’.";
const fact = (id, type, text, properties = {}) => ({ block_id: id, type, properties: { text, ...properties } });
const ambientOptions = (snapshot = {}) => ({ snapshot, references: [], seconds: 15, size: "1280x720", model: VIDEO_ADAPTER_CONTRACT.model, promptProfile: "positive-only", audioMode: "original_ambient" });
const fixture = () => ({ facts: [
  fact("direction", "direction", "Present a fictional creative lead progressing from scattered work toward a clear next decision. Establish the studio, reveal the evidence, arrange the shared work, and finish with an intentional handoff."),
  fact("audience", "audience", "Product leaders and creative collaborators evaluating their next move."),
  fact("message", "message", "One meaningful next action. Preserve the distinction between a proposed feature and delivered capability. Show evidence, human review, and source continuity."),
  fact("catalog", "format", catalog),
  { ...fact("exclusion", "exclusion", "Do not portray an average score as sufficient to override release-blocking consent failures. No identifiable faces or readable personal data."), intent: "avoid" },
  fact("subject", "subject", "A fictional adult creative lead arranges plain paper cards."),
  fact("environment", "environment", "Quiet daylight studio with a broad table and one open window."),
  fact("emotion", "emotion", "Calm attention grows into confidence through visible progress."),
  fact("style", "style", "Restrained editorial design, warm stone surfaces, measured camera movement. No recognizable melody or artist imitation."),
  fact("composition", "composition", "Landscape framing follows a single clear visual decision at a time."),
  fact("accessibility", "accessibility", "Preserve exact score numbers. Provide captions or transcripts for spoken media. Keep labels readable and meaning independent of color."),
  fact("film", "direction", "Use a slow lateral drift to reveal a coherent workspace. Original environmental ambience and physical scene sounds only. No music, melody, voices, or dialogue."),
  fact("package", "direction", `Slide 10 — Adopt through verified outcomes\n${proposed} Do not promise an automatically mixed soundtrack.`),
  fact("inactive-score", "audio", "Separate companion score: felt piano, soft cello, and an original instrumental melody.", { subtype: "Score", inform_generation: false, include_in_output: false, allow_provider_audio_transfer: false }),
] });

test("closed multi-output catalogs retain titles, surrounding constraints, private source lineage, and immutable source", () => {
  const snapshot = fixture(), before = structuredClone(snapshot);
  snapshot.facts[3].properties.text += " No readable personal information.";
  const canonical = structuredClone(snapshot);
  const scoped = videoOutputScopedContext(snapshot);
  assert.equal(scoped.interpretations.length, 2);
  assert.deepEqual(scoped.interpretations.map((item) => item.sourceBlockId), ["catalog", "package"]);
  assert.ok(scoped.interpretations.every((item) => item.disposition === "separate-output-catalog" && item.destination === "visual-catalog"));
  assert.ok(scoped.interpretations[0].originalText.includes("original full-length instrumental audio"));
  assert.match(scoped.snapshot.facts[3].properties.text, /Visible card: Video — “Film”/u);
  assert.match(scoped.snapshot.facts[3].properties.text, /No readable personal information\./u);
  assert.match(scoped.snapshot.facts[12].properties.text, /Do not promise an automatically mixed soundtrack\./u);
  assert.deepEqual(snapshot, canonical);
  assert.deepEqual(snapshot.facts[13], before.facts[13]);
  const originalPlan = { scenes: [{ action: catalog }], claims: [{ text: proposed }], title: "Distinct film" };
  const projected = projectVideoSourceCopy(originalPlan, scoped.interpretations);
  assert.match(projected.scenes[0].action, /^Visual catalog/u);
  assert.match(projected.claims[0].text, /^Visual catalog/u);
  assert.equal(originalPlan.scenes[0].action, catalog);
  assert.equal(originalPlan.claims[0].text, proposed);
});

test("unconsumed catalog qualifiers and negative or embedded headers fail closed without deleting authored meaning", () => {
  const cases = [
    simpleCatalog.replace("a video ‘Film’", "a video ‘Film’ with a soundtrack of a copyrighted song"),
    simpleCatalog.replace("a video ‘Film’", "a video ‘Film’ that must exclude weapons and identifiable people"),
    simpleCatalog.replace("three outputs:", "three outputs with a recognizable orchestral theme playing during the video:"),
    simpleCatalog.replace("three outputs:", "three outputs with no weapons or personal data:"),
    simpleCatalog.replace("three outputs:", "three outputs 禁止出现人脸:"),
    simpleCatalog.replace("a video ‘Film’", "a video 禁止出现人脸 ‘Film’"),
    `Do not ${simpleCatalog}`,
    `Never ${simpleCatalog}`,
    `The quoted instruction is ${simpleCatalog}`,
    "The proposed package includes a video featuring a copyrighted song, a storyboard, and an audio soundtrack.",
    "The proposed package includes an image, a video, and audio; do not include weapons or personal data.",
    "Do not claim that the proposed package includes an image, a video, and original instrumental audio.",
  ];
  for (const text of cases) {
    const snapshot = { facts: [fact("source", "direction", text)] };
    const scoped = videoOutputScopedContext(snapshot);
    assert.equal(scoped.interpretations.length, 0, text);
    assert.deepEqual(scoped.snapshot, snapshot, text);
  }
});

test("locked, required, inactive, negative, or unidentified facts cannot authorize catalog interpretation", () => {
  const variants = [
    { locked: true }, { properties: { authority: "locked" } }, { active: false }, { removed: true },
    { properties: { locked: true } }, { properties: { required: true } },
    { properties: { active: false } }, { properties: { weight: 0 } },
    { intent: "avoid" }, { effect: "prohibit" }, { properties: { intent: "must_not_include" } },
    { block_id: "" },
  ];
  for (const variant of variants) {
    const source = fact("source", "direction", simpleCatalog);
    const snapshot = { facts: [{ ...source, ...variant, properties: { ...source.properties, ...variant.properties } }] };
    const scoped = videoOutputScopedContext(snapshot);
    assert.equal(scoped.interpretations.length, 0, JSON.stringify(variant));
    assert.deepEqual(scoped.snapshot, snapshot);
  }
});

test("ambient mode distinguishes numeric/accessibility constraints from actual spoken or musical playback", () => {
  for (const text of [
    "Preserve exact score numbers, values, and ratings.",
    "Provide captions or transcripts for spoken media.",
    "No recognizable melody or artist imitation.",
    "Do not read captions aloud.",
    "Never read transcripts for spoken media aloud.",
    "Wind whistles through the rigging and the engine hums.",
  ]) {
    assert.equal(unsupportedAudioIntent(text), false, text);
    assert.doesNotThrow(() => adaptVideoPrompt(`A quiet studio in daylight. ${text}`, ambientOptions()), text);
  }
  for (const text of [
    "No logos while a choir sings a recognizable song.",
    "Without red lights, the actor imitates Morgan Freeman’s voice.",
    "No music and a narrator speaks the opening words.",
    "No dialogue, accompanied by Taylor Swift’s Love Story.",
    "Do not include music while the actor imitates Morgan Freeman’s voice.",
    "Music must not play while a narrator speaks the opening words.",
    "Do not include music and the narrator reads captions aloud.",
    "Read captions or transcripts for spoken media aloud throughout this video.",
    "Read the transcripts for spoken media aloud.",
    "Original orchestral scoring accompanies the film.",
  ]) {
    assert.equal(unsupportedAudioIntent(text), true, text);
    assert.throws(() => adaptVideoPrompt(`A quiet studio in daylight. ${text}`, ambientOptions()), (error) => error.detail?.code === "video_audio_profile_unsupported", text);
  }
});

test("ambient policy checks complete source channels before bounded provider compilation", () => {
  const direction = `${"A card rests on a studio table. ".repeat(100)}A narrator speaks the opening words.`;
  for (const properties of [{ text: direction }, { text: "A quiet studio.", storyboard_frame_prompt: direction }]) {
    const snapshot = { facts: [{ block_id: "long-source", type: "direction", properties }] };
    assert.throws(() => adaptVideoPrompt("A quiet studio in daylight.", ambientOptions(snapshot)), (error) => error.detail?.code === "video_audio_profile_unsupported");
  }
  assert.throws(() => adaptVideoPrompt("A quiet studio.", ambientOptions({ facts: [fact("silence", "direction", "No generated audio.")] })), (error) => error.detail?.code === "video_audio_forbidden");
});

test("verified mixed prohibitions remain atomic in both global and target-scoped ambient boundaries", () => {
  const boundary = "Do not portray fictional approvals, recognizable copyrighted music, treating seven context groups as a flaw, an average score as sufficient to override release-blocking consent failures, or an extra app.";
  for (const scoped of [false, true]) {
    const properties = scoped ? { combined_context_memberships: [{ context_set_id: "reviewer", name: "Reviewer", role: "character", target: "Reviewer", application: "isolate", member_order: 0 }] } : {};
    const snapshot = { facts: [{ ...fact("mixed-prohibition", "exclusion", boundary, properties), intent: "avoid" }] };
    const adapted = adaptVideoPrompt("An adult reviewer arranges plain cards beside a window.", ambientOptions(snapshot));
    assert.ok(adapted.prompt.includes(boundary), scoped ? "target boundary" : "global boundary");
    assert.ok(adapted.compilation.includedSectionIds.includes(scoped ? "target-scoped-authored-boundaries" : "authored-boundaries"));
    assert.deepEqual(adapted.audioExclusionInterpretations, []);
    assert.equal(adapted.audio.generateAudio, true);
  }
});

test("standalone prohibited recordings retain an auditable stronger absence instead of priming their named melody", () => {
  const originalText = "The Imperial March by John Williams plays.";
  const snapshot = { facts: [{ ...fact("no-recording", "exclusion", originalText), intent: "avoid" }] };
  const adapted = adaptVideoPrompt("An adult reviewer arranges plain cards beside a window.", ambientOptions(snapshot));
  assert.doesNotMatch(adapted.prompt, /Imperial March|John Williams/u);
  assert.match(adapted.prompt, /prohibited elements[^\n]+musical playback/u);
  assert.deepEqual(adapted.audioExclusionInterpretations, [{ originalText, providerText: "musical playback, recognizable songs, lyrics, speech, and vocal performances", scope: "global" }]);
  assert.equal(snapshot.facts[0].properties.text, originalText);
});

test("managed four-scene planner projects all duplicated source copy and retains private per-page interpretation evidence", async () => {
  const snapshot = fixture(), canonical = structuredClone(snapshot);
  const production = buildManagedProductionPlan("video", snapshot, { requestedItemCount: 4, preferredSceneSeconds: 15 });
  const originalPlan = structuredClone(production), requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses", "every network call is locally mocked");
    const request = JSON.parse(String(init.body));
    requests.push(request);
    const input = JSON.parse(request.input), scenes = input.production.assigned_scenes;
    const items = scenes.map((scene) => ({ title: scene.title, body: scene.action, notes: scene.camera_direction, image_prompt: scene.action, context_group_ids: [] }));
    return Response.json({ id: "mock-ambient-planner", model: "gpt-test", output_text: JSON.stringify({ title: "Meaningful next action", summary: "Four distinct visual movements connect one shared workspace.", content_markdown: items.map((item) => item.body).join("\n\n"), items }), usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 } });
  };
  try {
    const generated = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-test" }, "owner", "video", { documentTitle: "Meaningful next action", snapshot, production, videoAudioMode: "original_ambient", videoSize: "1280x720" });
    assert.equal(requests.length, 1);
    const input = JSON.parse(requests[0].input), sent = JSON.stringify(requests[0]);
    assert.equal(input.video.generate_audio, true);
    assert.equal(input.video.audio_mode, "original_ambient");
    assert.equal(input.production.assigned_scenes.length, 4);
    assert.ok(input.production.assigned_scenes.every((scene) => scene.duration_seconds === 15));
    assert.ok(!sent.includes(catalog));
    assert.ok(!sent.includes(proposed));
    assert.doesNotMatch(sent, /felt piano|soft cello|inactive-score|original full-length instrumental audio/u);
    assert.match(sent, /Visual catalog/u);
    assert.match(sent, /average score as sufficient to override release-blocking consent failures/u);
    assert.match(sent, /No recognizable melody or artist imitation/u);
    assert.equal(generated.inputReceipt.pages[0].video_source_interpretations.length, 2);
    assert.deepEqual(generated.inputReceipt.pages[0].video_source_interpretations.map((item) => item.sourceBlockId), ["catalog", "package"]);
    assert.deepEqual(snapshot, canonical);
    assert.deepEqual(production, originalPlan);
    assert.equal(generated.output.items.length, 4);
    assert.equal(generated.usage.totalTokens, 180);
  } finally { globalThis.fetch = originalFetch; }
});
