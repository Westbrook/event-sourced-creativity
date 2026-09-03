import assert from "node:assert/strict";
import test from "node:test";
import { buildExperiencePlan, experienceIds, initialValues, registeredExperience } from "../src/experiences/intake.ts";
import { canonicalJson, digest } from "../src/experiences/compiler.ts";
import { compileExperienceGeneration, experienceGenerationBinding, experienceGenerationBindingMatches } from "../src/experiences/generation.ts";
import { DEFAULT_MODEL3D_SETTINGS, model3dPromptLength, RODIN_PROMPT_MAX_CHARS, validateModel3dRequest } from "../src/model/model3d.ts";
import { selectAudioAdapterContract, STABLE_AUDIO_ADAPTER_CONTRACT } from "../src/model/audio.ts";
import { resolvePresentationCountRequest } from "../src/model/presentation-count-policy.ts";
import { VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";

const owner = "experience-owner", intentId = "8fa4b34e-7542-4ea5-9158-c7150ed24f02";
async function planFor(id = "image", actor = owner, mutate) {
  const release = await registeredExperience(id), values = initialValues(release);
  for (const decision of release.definition.decisions) {
    const interaction = release.interactions[decision.id];
    if (interaction.kind === "source") values[decision.id] = { value: `Authored ${decision.id}`, provenance: "authored" };
    else if (interaction.kind === "relationship") values[decision.id] = { value: Object.fromEntries(interaction.fields.map(field => [field.id, `Authored ${field.label}`])), provenance: "authored" };
    else if (interaction.kind === "order") values[decision.id] = { value: [1, 2, 3].map(index => ({ id: `e${index}`, text: `Evidence ${index}` })), provenance: "authored" };
  }
  const request = { intentId, experienceId: id, releaseHash: release.releaseHash, values };
  mutate?.(request);
  return buildExperiencePlan(actor, request, release);
}
function frozen(value) {
  if (value && typeof value === "object") { assert.equal(Object.isFrozen(value), true); Object.values(value).forEach(frozen); }
}
async function rehash(plan) { const base = { ...plan }; delete base.draftHash; plan.draftHash = await digest(base); return plan; }
const forbidden = new Set(["paidMediaConfirmed", "preflightAcknowledged", "budgetAcknowledged", "budgetWarningSuppressed", "sceneCostConsent", "sceneRequestId", "outputExecution", "providerJobId", "providerRequestId", "reservationId", "costReservationId", "snapshot", "sourceBlockVersions", "sendSoundtrackToVideoProvider", "sendAudioVideoToProvider", "audioProviderModel", "jobId", "grantId", "slotId"]);
function noAuthority(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); noAuthority(child); }
}

for (const id of experienceIds) test(`${id}: pure deterministic contract preserves exact retained identity without admission`, { concurrency: false }, async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("Pure compilation cannot call a provider or API"));
  const plan = await planFor(id), contract = await compileExperienceGeneration(owner, plan);
  assert.deepEqual(await compileExperienceGeneration(owner, JSON.parse(canonicalJson(plan))), contract);
  assert.equal(contract.version, "experience-generation@1");
  assert.equal(contract.qualification, "settings-only");
  assert.equal(contract.ownerId, owner); assert.equal(contract.streamId, `creative:${owner}`);
  for (const key of ["draftId", "draftHash", "documentId", "projectId"]) assert.equal(contract[key], plan[key]);
  assert.equal(contract.releaseHash, plan.release.releaseHash); assert.equal(contract.output, plan.release.output.output);
  assert.equal(contract.kind, id === "image" ? "generate" : "render_document");
  assert.equal(contract.sourceSurface, "experience");
  assert.match(contract.generationIntentId, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
  assert.equal(contract.payload.requestKey, `experience-generation@1:${contract.generationIntentId}`);
  const { contractHash, ...base } = contract; assert.equal(contractHash, await digest(base));
  frozen(contract); noAuthority(contract);
  const binding = experienceGenerationBinding(contract);
  assert.equal(experienceGenerationBindingMatches(owner, contract, binding), true);
  assert.equal(Object.hasOwn(binding, "payload"), false); frozen(binding);
});

test("registered output settings use native counts, silent video, and original instrumental Audio", async () => {
  const contracts = Object.fromEntries(await Promise.all(experienceIds.map(async id => [id, await compileExperienceGeneration(owner, await planFor(id))])));
  assert.equal(contracts.image.payload.promptTechnique, "prose");
  assert.equal(contracts["short-story"].payload.itemCount, 1);
  assert.equal(contracts.scene.payload.itemCount, 1); assert.equal(contracts.scene.payload.sceneMedium, "visual");
  const slides = resolvePresentationCountRequest(contracts.slides.payload);
  assert.equal(slides.itemCount, 5); assert.equal(slides.requestedSlideCount, 5);
  assert.deepEqual(slides.slideCountPolicy, { kind: "exact", unit: "slide", value: 5 });
  assert.equal(contracts.storyboard.payload.itemCount, 4);
  assert.equal(contracts.video.payload.videoSeconds, 4);
  assert.equal(VIDEO_ADAPTER_CONTRACT.supportedDurations.includes(contracts.video.payload.videoSeconds), true);
  assert.equal(contracts.video.payload.videoAudioMode, VIDEO_ADAPTER_CONTRACT.defaultAudioMode);
  assert.deepEqual(contracts.audio.payload.audioProfile, { role: "score", goal: "music", destination: "standalone", requireInstrumental: true });
  const audio = selectAudioAdapterContract(contracts.audio.payload.audioProfile);
  assert.equal(audio.contract.model, STABLE_AUDIO_ADAPTER_CONTRACT.model);
  assert.equal(Object.hasOwn(contracts.audio.payload.audioProfile, "durationSeconds"), false, "do not invent a length promised by neither the recipe nor its native request");
});

test("3D uses exact authored text and registered decision/field order with unchanged native defaults", async () => {
  const before = structuredClone(DEFAULT_MODEL3D_SETTINGS);
  const plan = await planFor("model3d", owner, request => {
    request.values.object.value = ' Low-poly object\n2026-09-02 <reference> & "quoted" ';
    request.values.proportions = { value: { depth: 4, height: 3, width: 2 }, provenance: "authored" };
    request.values.surface = { value: "metal", provenance: "authored" };
  });
  const contract = await compileExperienceGeneration(owner, plan), payload = contract.payload;
  assert.equal(payload.model3dPrompt, 'Object:  Low-poly object\n2026-09-02 <reference> & "quoted" \nProportions:\nWidth: 2\nHeight: 3\nDepth: 4\nSurface: Metal');
  assert.deepEqual(payload.model3dSettings, before); assert.deepEqual(DEFAULT_MODEL3D_SETTINGS, before);
  assert.notEqual(payload.model3dSettings, DEFAULT_MODEL3D_SETTINGS);
  assert.deepEqual(payload.model3dReferenceBlockIds, []);
  assert.equal(payload.model3dSettings.geometry_file_format, "glb");
  assert.equal(validateModel3dRequest({ prompt: payload.model3dPrompt, settings: payload.model3dSettings, referenceCount: 0, mode: "text" }).valid, true);
  assert.ok(model3dPromptLength(payload.model3dPrompt) <= RODIN_PROMPT_MAX_CHARS);
  const reordered = await planFor("model3d", owner, request => {
    request.values.object.value = plan.request.values.object.value;
    request.values.proportions = { value: { width: 2, height: 3, depth: 4 }, provenance: "authored" };
    request.values.surface = { value: "metal", provenance: "authored" };
  });
  assert.deepEqual(await compileExperienceGeneration(owner, reordered), contract);
});

test("the maximum registered 3D subject remains untruncated within the native code-point bound", async () => {
  const subject = "界".repeat(600), plan = await planFor("model3d", owner, request => { request.values.object.value = subject; });
  const contract = await compileExperienceGeneration(owner, plan);
  assert.ok(contract.payload.model3dPrompt.includes(subject));
  assert.ok(model3dPromptLength(contract.payload.model3dPrompt) <= RODIN_PROMPT_MAX_CHARS);
});

test("settings intent identity changes with principal, retained intent, and retained content", async () => {
  const original = await compileExperienceGeneration(owner, await planFor());
  const other = await compileExperienceGeneration("other-owner", await planFor("image", "other-owner"));
  const intent = await compileExperienceGeneration(owner, await planFor("image", owner, request => { request.intentId = "42be0e7e-066e-4092-b9e7-fe1421139742"; }));
  const source = await compileExperienceGeneration(owner, await planFor("image", owner, request => { request.values.subject.value = "Another subject"; }));
  assert.equal(new Set([original.generationIntentId, other.generationIntentId, intent.generationIntentId, source.generationIntentId]).size, 4);
  await assert.rejects(compileExperienceGeneration("other-owner", await planFor()), /experience_generation_contract_invalid/u);
});

const mutations = [
  ["owner stream", value => { value.streamId = "creative:another-owner"; }],
  ["Document identity", value => { value.documentId = "different-document"; }],
  ["project identity", value => { value.projectId = "different-project"; }],
  ["draft identity", value => { value.draftId = "experience-draft-" + "0".repeat(64); }],
  ["release hash", value => { value.release.releaseHash = "sha256:" + "0".repeat(64); }],
  ["registered release content", value => { value.release.copy["image.subject"] = "Different label"; }],
  ["native event content", value => { value.events[3].payload.properties.text = "Injected source"; }],
  ["extra native event", value => { value.events.push(structuredClone(value.events[3])); }],
  ["missing native event", value => { value.events.pop(); }],
  ["incomplete required source", value => { value.request.values.subject.value = ""; }],
  ["false default provenance", value => { value.request.values.subject.provenance = "default"; }],
  ["unregistered choice", value => { value.request.values.lighting.value = "unsupported"; }],
  ["caller approval", value => { value.paidMediaConfirmed = true; }],
  ["caller payload", value => { value.payload = { artifactKind: "video", budgetAcknowledged: true }; }],
];
for (const [label, mutate] of mutations) test(`self-consistent caller hashing cannot authorize ${label}`, async () => {
  const plan = structuredClone(await planFor()); mutate(plan); await rehash(plan);
  await assert.rejects(compileExperienceGeneration(owner, plan), /experience_generation_contract_invalid/u);
});

test("malformed JSON and invalid owner inputs fail before accessors or asynchronous use", async () => {
  let accessed = false;
  const getter = { get request() { accessed = true; return {}; } };
  await assert.rejects(compileExperienceGeneration(owner, getter), /experience_generation_contract_invalid/u);
  assert.equal(accessed, false);
  const cyclic = {}; cyclic.request = cyclic;
  for (const value of [null, [], "plan", cyclic]) await assert.rejects(compileExperienceGeneration(owner, value), /experience_generation_contract_invalid/u);
  const plan = await planFor();
  for (const actor of ["", " ", " owner", "owner\n", "own\u0000er", "own\u007fer", "x".repeat(241)]) await assert.rejects(compileExperienceGeneration(actor, plan), /experience_generation_contract_invalid/u);
});

test("compile snapshots input before its first asynchronous boundary", async () => {
  const original = await planFor(), incoming = structuredClone(original);
  const pending = compileExperienceGeneration(owner, incoming);
  incoming.request.values.subject.value = "Changed after dispatch";
  incoming.release.output.output = "video"; incoming.events.length = 0;
  assert.deepEqual(await pending, await compileExperienceGeneration(owner, original));
});

test("exact binding rejects every substituted identity, unknown fields, and a foreign principal", async () => {
  const contract = await compileExperienceGeneration(owner, await planFor()), binding = experienceGenerationBinding(contract);
  for (const key of Object.keys(binding)) {
    assert.equal(experienceGenerationBindingMatches(owner, contract, { ...binding, [key]: `${binding[key]}-changed` }), false, key);
    const missing = { ...binding }; delete missing[key]; assert.equal(experienceGenerationBindingMatches(owner, contract, missing), false, key);
  }
  assert.equal(experienceGenerationBindingMatches("other-owner", contract, binding), false);
  assert.equal(experienceGenerationBindingMatches(owner, contract, { ...binding, approved: true }), false);
  assert.equal(experienceGenerationBindingMatches(owner, contract, { ...binding, ownerId: "other-owner", streamId: "creative:other-owner" }), false);
  let accessed = false;
  const accessor = { ...binding }; Object.defineProperty(accessor, "generationIntentId", { enumerable: true, get() { accessed = true; return contract.generationIntentId; } });
  assert.equal(experienceGenerationBindingMatches(owner, contract, accessor), false); assert.equal(accessed, false);
  const foreign = await compileExperienceGeneration("other-owner", await planFor("image", "other-owner"));
  assert.equal(experienceGenerationBindingMatches(owner, contract, experienceGenerationBinding(foreign)), false);
});
