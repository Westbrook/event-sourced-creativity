import assert from "node:assert/strict";
import test from "node:test";
import { EXPERIENCE_AUDIO_INTENT } from "../src/experiences/contracts.ts";
import { outputTerms, outputTermsMoney } from "../src/experiences/output-terms.ts";
import { createAudioOutputContract } from "../src/model/output-audio-contract.ts";
import { parseAudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { createStoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import { createOutputFalImageContract } from "../src/model/output-fal-image-contract.ts";
import { documentRenderTokenReservation } from "../src/model/generation-budget.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { readStoryboardExecutionOffer, STORYBOARD_READY_REASON, STORYBOARD_TRANSFER } from "../src/model/output-storyboard-offer.ts";

// Unadmitted, fixed-clock display fixtures using existing pure contracts.
// No old test module, Worker handler, DB, media, provider or credential is used.
// Synthetic planning/audio allowances are not live quotes or billing evidence.
const now = Date.parse("2026-09-13T12:00:00.000Z");
const expiresAt = new Date(now + 60_000).toISOString();
const targetId = "summary-target";
const source = () => ({
  draftId: "experience-draft-" + "a".repeat(64),
  draftHash: "sha256:" + "b".repeat(64),
  releaseHash: "sha256:" + "c".repeat(64),
  requestHash: "sha256:" + "d".repeat(64),
  sourceBindingHash: "sha256:" + "e".repeat(64),
});
const owner = { actorUserId: "summary-owner", projectId: "summary-project", documentId: "summary-document" };
const sourceDigest = "f".repeat(64), requirementsDigest = "1".repeat(64);
const rows = value => Object.fromEntries(value.map(({ label, value }) => [label, value]));

function preflight(target) {
  return {
    id: "summary-preflight", planRevisionId: "summary-plan", termsDigest: "summary-terms",
    sourceDigest, requirementsDigest, targets: [target], maximumMicrousd: target.maximumMicrousd,
    maximumCalls: target.maximumCalls, createdAt: new Date(now - 1000).toISOString(), expiresAt,
    operationAttempts: { [targetId]: { ordinal: 0, previousSlotId: null } },
  };
}

function audioFixture() {
  const contract = createAudioOutputContract(source());
  assert.ok(contract);
  const planningMaximum = 500_000, audioMaximum = 100_000;
  const maximumMicrousd = 2 * planningMaximum + audioMaximum;
  const preview = parseAudioMiniAppCostPreview({
    version: "audio-mini-app-cost-v1", requestId: "audio-" + "2".repeat(64), ...owner,
    draftId: contract.source.draftId, sourceDigest, requirementsDigest, expiresAt,
    maximumMicrousd, maximumCalls: 3, maximumTokens: 128000,
    planningModel: "gpt-5.6-terra", maximumPlanningCalls: 2, maximumOutputTokens: 3000,
    audioModel: "fal-ai/stable-audio-3/medium/text-to-audio", maximumAudioCalls: 1,
    durationSeconds: 20, requireInstrumental: true, sourceFilesTransferred: 0,
  });
  assert.ok(preview);
  const calls = ["planning:0:initial", "planning:0:repair"].map(stage => ({
    stage, provider: "openai", model: preview.planningModel, maximumMicrousd: planningMaximum,
    maximumInputTokens: 25000, maximumOutputTokens: preview.maximumOutputTokens,
  }));
  calls.push({ stage: "audio:initial", provider: "fal", model: preview.audioModel, maximumMicrousd: audioMaximum });
  const target = {
    targetId, available: true, reasonCode: "output_audio_ready_for_separate_approval",
    reason: "Synthetic instrumental request; separately review transfer and cost.",
    transferCode: "output_transfer_audio_not_yet_authorized",
    transferDescription: "This check sends nothing. Document text is planned by OpenAI; musical direction goes to fal.ai without source files.",
    provider: "fal", model: preview.audioModel, route: "document-audio-timed-music-manual-v1",
    maximumMicrousd, maximumCalls: 3, maximumTokens: preview.maximumTokens,
    settings: {
      kind: "render_document",
      payload: {
        productionMode: "manual", artifactKind: "audio", itemCount: 1,
        audioProfile: structuredClone(EXPERIENCE_AUDIO_INTENT), audioProviderModel: preview.audioModel,
        audioEstimatedCostMicrousd: audioMaximum, outputTargetInstructions: "An instrumental rise and quiet finish.",
        outputAudio: contract,
      },
      calls, preparationOnly: false, explicitCostAndTransferApprovalRequired: true, executionAvailable: true,
      costPreview: preview, executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY,
      original: {
        requestId: preview.requestId, expiresAt, draftId: contract.source.draftId, ...owner,
        sourceDigest, requirementsDigest,
      },
      constraints: {}, duration: { requestedSeconds: 20, measuredSeconds: null },
    },
  };
  return { offer: preflight(target), options: { now, output: "audio", targetId, expectedAudioContract: contract, audioCostPreview: preview } };
}

function storyboardFixture() {
  const contract = createStoryboardOutputContract(source());
  const fal = createOutputFalImageContract("ideogram/v4", "1536x1024");
  assert.ok(contract); assert.ok(fal);
  const planningMaximum = 500_000, maximumMicrousd = planningMaximum + 4 * fal.maximumMicrousd;
  const target = {
    targetId, available: true, reasonCode: "output_storyboard_ready", reason: STORYBOARD_READY_REASON,
    transferCode: "output_transfer_storyboard_after_authorization", transferDescription: STORYBOARD_TRANSFER,
    provider: "fal", model: fal.model, route: "document-storyboard-four-frames-manual-v1",
    maximumMicrousd, maximumCalls: 5, maximumTokens: documentRenderTokenReservation("storyboard", 4, 1),
    settings: {
      kind: "render_document",
      payload: {
        artifactKind: "storyboard", productionMode: "manual", itemCount: 4, outputStoryboard: contract,
        outputStoryboardPlanner: { contract, requestDigest: "3".repeat(64), maximumInputTokens: 5000 },
        outputFalImage: fal, outputTargetInstructions: "Four ordered lantern frames.",
        paidMediaConfirmed: true, budgetAcknowledged: true, preflightAcknowledged: true,
      },
      calls: Array.from({ length: 5 }, (_, index) => ({
        stage: index ? `image:frame:${index}` : "planning:0:initial", provider: index ? "fal" : "openai",
        model: index ? fal.model : fal.plannerModel, maximumMicrousd: index ? fal.maximumMicrousd : planningMaximum,
        maximumInputTokens: index ? 0 : 5000, maximumOutputTokens: index ? 0 : 4000,
      })),
      executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY, preparationOnly: false, executionAvailable: true,
      explicitCostAndTransferApprovalRequired: true,
      original: {
        requestId: "storyboard-" + "4".repeat(64), expiresAt, draftId: contract.source.draftId,
        ...owner, sourceDigest, requirementsDigest,
      },
    },
  };
  assert.ok(readStoryboardExecutionOffer(target), "Use the closed existing offer parser before projecting a summary");
  return { offer: preflight(target), options: { now, output: "storyboard", targetId, expectedStoryboard: { source: contract.source, ...owner } } };
}

test("Audio summary keeps three generation stages, nominal duration and file-free transfer without invented safety", () => {
  const fixture = audioFixture(), before = structuredClone(fixture);
  const shown = outputTerms(fixture.offer, fixture.options), summary = shown.summary;
  assert.equal(shown.available, true); assert.equal(shown.grantAvailable, false); assert.ok(summary);
  assert.equal(summary.output, "1 instrumental track · about 20 seconds");
  assert.equal(summary.maximumGenerationCalls, 3);
  assert.equal(summary.requests, "1 planning call; at most 1 repair; 1 audio request");
  assert.equal(rows(summary.constraints).Duration, "20-second request; measured duration only after media inspection");
  assert.equal(rows(summary.constraints)["Source files"], "None");
  assert.equal(summary.safety, null);
  assert.deepEqual(summary.recipients, [
    { provider: "OpenAI", model: fixture.options.audioCostPreview.planningModel },
    { provider: "fal.ai", model: fixture.options.audioCostPreview.audioModel },
  ]);
  assert.equal(summary.source, "Document context goes to OpenAI for planning; musical direction goes to fal.ai, with no lyrics, spoken script or source files");
  assert.equal(summary.maximumSpend, outputTermsMoney(fixture.offer.maximumMicrousd));
  assert.equal(summary.expiresAt, expiresAt); assert.equal(summary.usage, null);
  assert.equal(fixture.offer.targets[0].settings.duration.measuredSeconds, null);
  assert.deepEqual(fixture, before, "Display projection cannot mutate the source contract into measured media");
});

test("Storyboard summary separates five paid stages from four additional safety checks and retains exact recipients", () => {
  const fixture = storyboardFixture(), before = structuredClone(fixture);
  const shown = outputTerms(fixture.offer, fixture.options), summary = shown.summary;
  assert.equal(shown.available, true); assert.equal(shown.grantAvailable, false); assert.ok(summary);
  assert.equal(summary.output, "Exactly 4 storyboard frames");
  assert.equal(rows(summary.constraints)["Image size"], "1536 × 1024 · PNG");
  assert.equal(rows(summary.constraints)["Reference pixels"], "None");
  assert.equal(summary.maximumGenerationCalls, 5);
  assert.equal(summary.requests, "1 planner; 4 images · 5 paid stages");
  assert.deepEqual(summary.safety, {
    maximumChecks: 4, provider: "OpenAI", model: "omni-moderation-latest", input: "Exact final text prompt before each image",
  });
  const calls = fixture.offer.targets[0].settings.calls;
  assert.deepEqual(summary.recipients, [
    { provider: "OpenAI", model: calls[0].model }, { provider: "fal.ai", model: calls[1].model },
  ]);
  assert.equal(summary.source, "Current Document context goes to OpenAI for planning; each planned frame direction goes to fal.ai / Ideogram 4");
  assert.equal(summary.transfer, "Transfer starts after authorization and Create. Check cost sends no source content.");
  assert.ok(summary.caveats.includes("No repair request or automatic retry. Review all four resulting images."));
  assert.ok(summary.caveats.includes("After an uncertain response, no additional paid request; recover the original request only."));
  assert.equal(summary.maximumSpend, outputTermsMoney(fixture.offer.maximumMicrousd));
  assert.equal(summary.expiresAt, expiresAt); assert.equal(summary.usage, null);
  assert.deepEqual(fixture, before, "Summary presentation preserves the captured original offer");
});

test("Audio and Storyboard summaries cannot bypass the existing exact original-source comparison", () => {
  for (const make of [audioFixture, storyboardFixture]) {
    const fixture = make();
    assert.equal(outputTerms(fixture.offer, fixture.options).available, true, "Positive fixture must first be accepted");
    const changed = structuredClone(fixture);
    // Clone the expected side independently: cloning the whole fixture retains aliases.
    changed.options = structuredClone(fixture.options);
    const expected = changed.options.output === "audio" ? changed.options.expectedAudioContract.source : changed.options.expectedStoryboard.source;
    expected.requestHash = "sha256:" + "9".repeat(64);
    const refused = outputTerms(changed.offer, changed.options);
    assert.equal(refused.available, false); assert.equal(refused.grantAvailable, false);
    assert.equal(refused.summary, undefined, "A plausible summary never replaces source-bound terms validation");
  }
});
