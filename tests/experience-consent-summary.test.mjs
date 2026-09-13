import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { outputTerms, outputTermsNotice } from "../src/experiences/output-terms.ts";
import { createOutputFalImageContract } from "../src/model/output-fal-image-contract.ts";
import { SHORT_STORY_NARRATIVE_CONTRACT } from "../src/model/output-narrative-contract.ts";
import { scenePreflightFixture } from "./helpers/scene-output-fixture.mjs";
import { outputScenePreflightConfiguration } from "../worker/output-scene-preflight-contract.ts";
// Reused bounded synthetic constructors; new summary/state controls only.
// No provider, browser, quote acquisition, native execution or old suite replay.
const now = Date.parse("2026-09-12T12:00:00.000Z");
function fixture(output = "image") {
  const format = { schema_version: 1, aspect_ratio: { width: 1, height: 1 }, dimensions: { width: 1024, height: 1024, unit: "px" } };
  const common = { productionMode: "manual", budgetAcknowledged: true, preflightAcknowledged: true, outputTargetInstructions: "Synthetic instructions" };
  const calls = output === "image"
    ? [{ stage: "planning:initial", provider: "openai", model: "synthetic-planner", maximumMicrousd: 100001 },
      { stage: "image:initial", provider: "openai", model: "gpt-image-2", maximumMicrousd: 900000 }]
    : ["planning:0:initial", "planning:0:repair"].map((stage, index) => ({ stage, provider: "openai", model: `synthetic-slides-${index}`,
      presentationRoute: { model: `synthetic-slides-${index}`, api: "responses" }, maximumInputTokens: 20000,
      maximumOutputTokens: 8000, maximumMicrousd: 500000 + index }));
  const settings = output === "image"
    ? { kind: "generate", payload: { ...common, outputImageFormat: format }, imageRender: { format, size: "1024x1024" },
      imageBudget: { version: "gpt-image-2-doc-calculator-2026-08-27", quality: "high", maximumPromptBytes: 32000,
        maximumReferenceImages: 0, estimatedOutputTokens: 7024, maximumOutputTokens: 14048, maximumInputTokens: 36096,
        maximumMicrousd: 500000, allowanceCode: "output_native_image_allowance_verified", allowanceDescription: "Synthetic allowance" }, calls }
    : { kind: "render_document", payload: { ...common, artifactKind: "slides", itemCount: 5, requestedSlideCount: 5,
      slideCountPolicy: { kind: "exact", unit: "slide", value: 5 } }, calls };
  settings.executionPolicy = { maximumMilliseconds: 240000, heartbeatMilliseconds: 60000, maximumRenewals: 3 };
  return { id: "preflight-original", planRevisionId: "plan-original", termsDigest: "terms-original", sourceDigest: "source-original",
    requirementsDigest: "requirements-original", targets: [{ targetId: "target-original", available: true,
      reason: "Synthetic known-code disclosure", reasonCode: `output_native_${output}_ready`, reasonValues: { maximumExecutionSeconds: 240 },
      transferCode: "output_transfer_document_after_authorization", provider: "openai", model: output === "image" ? "gpt-image-2" : "synthetic-slides-0",
      route: `document-${output}-manual-v1`, maximumMicrousd: 1000001, maximumCalls: 2, maximumTokens: 128000,
      settings, transferDescription: "Synthetic transfer disclosure" }], maximumMicrousd: 1000001, maximumCalls: 2,
    createdAt: "2026-09-12T11:59:00.000Z", expiresAt: "2026-09-12T12:05:00.000Z",
    operationAttempts: { "target-original": { ordinal: 1, previousSlotId: null } } };
}
function grant(offer) {
  return { id: "grant-original", planRevisionId: offer.planRevisionId, actorUserId: "actor-original", payerUserId: "payer-distinct",
    status: "authorized", maximumMicrousd: offer.maximumMicrousd, maximumCalls: offer.maximumCalls,
    usedMicrousd: 123, exposedMicrousd: 456, usedCalls: 0, pendingCalls: 0, expiresAt: "2026-09-12T12:10:00.000Z",
    disclosure: structuredClone(offer), operations: [{ id: "slot-original", targetId: "target-original", targetLabel: "Synthetic target",
      jobId: "job-original", status: "reserved", maximumMicrousd: offer.maximumMicrousd, maximumCalls: offer.maximumCalls,
      usedMicrousd: 123, exposedMicrousd: 456, usedCalls: 0, pendingCalls: 0 }] };
}

const options = (output = "image", extra = {}) => ({ now, output, targetId: "target-original", ...extra });
function falFixture() {
  const offer = fixture(), target = offer.targets[0], previous = target.settings;
  const contract = createOutputFalImageContract("ideogram/v4", "1024x1024");
  target.reasonCode = "output_native_fal_image_ready";
  target.transferCode = "output_transfer_fal_image_after_authorization";
  target.provider = "fal"; target.model = contract.model; target.route = "document-image-fal-manual-v1";
  target.settings = { kind: "generate", payload: { ...previous.payload, outputFalImage: contract },
    imageRender: previous.imageRender, calls: [
      { stage: "planning:initial", provider: "openai", model: contract.plannerModel, maximumMicrousd: 100001 },
      { stage: "image:initial", provider: "fal", model: contract.model, maximumMicrousd: contract.maximumMicrousd }
    ], executionPolicy: previous.executionPolicy };
  offer.operationAttempts["target-original"].ordinal = 0;
  return offer;
}
const phase = (status, extra = {}) => ({ status, originalRunRecorded: false, authorize: status === "review", run: status === "authorized", resumeRun: false, ...extra });

test("validated Fal summary keeps exact ceiling, source recipients, separate safety, scope and invoice caveats", () => {
  const offer = falFixture();
  offer.targets[0].reason = "UNTRUSTED REASON"; offer.targets[0].transferDescription = "UNTRUSTED TRANSFER";
  const terms = outputTerms(offer, options()), summary = terms.summary;
  assert.equal(terms.available, true); assert.equal(summary.maximumSpend, "USD 1.000001");
  assert.equal(summary.maximumGenerationCalls, 2); assert.equal(summary.requests, "1 direction; 1 image");
  assert.equal(summary.source, "Authorized Document context; selected target instructions");
  assert.equal(summary.transfer, "Transfer starts after authorization and Create. Check cost sends no source content.");
  assert.deepEqual(summary.recipients, [{ provider: "OpenAI", model: "gpt-5.6-terra" }, { provider: "fal.ai", model: "ideogram/v4" }]);
  assert.deepEqual(summary.safety, { maximumChecks: 1, provider: "OpenAI", model: "omni-moderation-latest", input: "Exact adapted image prompt; text" });
  assert.equal(summary.output, "1 image");
  for (const value of ["1024x1024", "1:1", "Unavailable", "PNG", "QUALITY"]) assert.ok(summary.constraints.some(row => row.value === value));
  for (const pattern of [/Charges may remain/, /cancellation/, /admission cap/, /invoice precision/, /original request only/]) assert.ok(summary.caveats.some(value => pattern.test(value)));
  assert.ok(!JSON.stringify(summary).includes("UNTRUSTED")); assert.equal(summary.usage, null);
  // Full technical evidence is retained, not rebuilt from the compact display.
  assert.deepEqual(JSON.parse(terms.targets[0].settings), offer.targets[0].settings);
  assert.equal(terms.targets[0].calls.length, 2);
});

test("summary preserves OpenAI-image and Slides semantics without inventing safety or retry limits", () => {
  const image = outputTerms(fixture(), options()).summary;
  assert.equal(image.safety.maximumChecks, 1);
  assert.ok(image.caveats.includes("The separate safety check is free in the retained native disclosure."));
  const slides = outputTerms(fixture("slides"), options("slides")).summary;
  assert.equal(slides.output, "5 slides"); assert.equal(slides.requests, "1 initial; at most 1 repair");
  assert.equal(slides.safety, null); assert.equal(slides.recipients.length, 2);
  assert.deepEqual(slides.recipients.map(row => row.model), ["synthetic-slides-0", "synthetic-slides-1"]);
});

test("Short Story summary preserves its exact prose scope and single request without safety or repair", () => {
  const offer = fixture("slides"), target = offer.targets[0], model = "gpt-5.6-terra";
  offer.maximumCalls = target.maximumCalls = 1; offer.operationAttempts["target-original"].ordinal = 0;
  target.reasonCode = "output_narrative_ready"; target.transferCode = "output_transfer_narrative_after_authorization";
  target.route = "document-short-story-manual-v1"; target.model = model;
  target.settings.calls = [{ stage: "planning:0:initial", provider: "openai", model, maximumMicrousd: target.maximumMicrousd, maximumInputTokens: 8192, maximumOutputTokens: 6000 }];
  target.settings.payload = { productionMode: "manual", budgetAcknowledged: true, preflightAcknowledged: true, outputTargetInstructions: "Synthetic story",
    artifactKind: "short_story", itemCount: 3, outputNarrative: { schemaVersion: 1, contract: SHORT_STORY_NARRATIVE_CONTRACT,
      contractDigest: "a".repeat(64), model, maximumCalls: 1, maximumInputTokens: 8192, maximumOutputTokens: 6000,
      stage: "planning:0:initial", reasoningEffort: "low", cachePolicy: "disabled-explicit", pricingVersion: "synthetic" } };
  const result = outputTerms(offer, options("short_story")); assert.equal(result.available, true);
  assert.equal(result.summary.output, "1 story · 600–800 words"); assert.equal(result.summary.maximumGenerationCalls, 1);
  assert.equal(result.summary.requests, "1 initial · No automatic repair"); assert.equal(result.summary.safety, null);
  assert.deepEqual(result.summary.constraints, [{ label: "Language", value: "English" }, { label: "Format", value: "Fiction · Plain prose" }]);
});

test("Scene summary uses the exact separately validated cost preview and retains written scope", async () => {
  // Existing pure fixture/formatter reused for this new summary assertion only.
  const sceneNow = Date.parse("2026-09-13T04:00:00.000Z"), payload = await scenePreflightFixture();
  const target = await outputScenePreflightConfiguration("target-1", payload, sceneNow);
  const offer = { id: "offer-1", planRevisionId: "plan-1", termsDigest: "terms-1", sourceDigest: "source-1", requirementsDigest: "requirements-1",
    maximumMicrousd: target.maximumMicrousd, maximumCalls: target.maximumCalls, createdAt: new Date(sceneNow - 1000).toISOString(),
    expiresAt: payload.outputScene.costPreview.expiresAt, targets: [target], operationAttempts: { "target-1": { ordinal: 0, previousSlotId: null } } };
  const scoped = { now: sceneNow, output: "scene", targetId: "target-1", expectedSceneContract: payload.outputScene.sceneContract,
    expectedSceneContractDigest: payload.outputScene.costPreview.sceneContractDigest, sceneCostPreview: payload.outputScene.costPreview };
  const shown = outputTerms(offer, scoped); assert.equal(shown.available, true);
  assert.equal(shown.summary.output, "1 written scene · 2 characters · 1 location · 1–2 pages");
  assert.equal(shown.summary.maximumSpend, "USD 1.00"); assert.equal(shown.summary.maximumGenerationCalls, 1);
  assert.equal(shown.summary.safety, null); assert.equal(shown.summary.requests, "1 initial · No automatic repair");
  assert.equal(shown.summary.expiresAt, scoped.sceneCostPreview.expiresAt);
  assert.equal(outputTerms(offer, { ...scoped, expectedSceneContractDigest: "sha256:" + "f".repeat(64) }).summary, undefined);
});

test("unknown or malformed terms never expose a zero-cost or ready summary; accepted summaries are immutable", () => {
  const bad = falFixture(); bad.targets[0].settings.calls[1].maximumMicrousd--;
  const denied = outputTerms(bad, options());
  assert.equal(denied.available, false); assert.equal(denied.summary, undefined);
  assert.equal(outputTermsNotice(denied, phase("review")), "terms_unavailable");
  assert.equal(outputTermsNotice(null, phase("review")), "terms_unavailable");
  const source = falFixture(), result = outputTerms(source, options()), captured = JSON.stringify(result.summary);
  source.targets[0].settings.calls[0].model = "changed";
  assert.equal(JSON.stringify(result.summary), captured);
  for (const value of [result.summary, result.summary.constraints, ...result.summary.constraints, result.summary.recipients, ...result.summary.recipients, result.summary.safety, result.summary.caveats]) assert.ok(Object.isFrozen(value));
  const unsupported = outputTerms(fixture(), { ...options(), output: "storyboard" });
  assert.equal(unsupported.summary, undefined); assert.equal(unsupported.available, false);
});

test("ready, expired and authorized notices follow their exact quote or grant without changing admission", () => {
  const offer = falFixture(), ready = outputTerms(offer, options()), original = grant(offer);
  assert.equal(outputTermsNotice(ready, phase("review")), "review");
  const expired = outputTerms(offer, options("image", { now: now + 6 * 60 * 1000 }));
  assert.equal(outputTermsNotice(expired, phase("review")), "terms_expired"); assert.ok(expired.summary);
  const afterQuote = outputTerms(offer, options("image", { now: now + 6 * 60 * 1000, grant: original }));
  assert.equal(afterQuote.available, false); assert.equal(afterQuote.grantAvailable, true);
  assert.equal(outputTermsNotice(afterQuote, phase("authorized")), "authorized");
  assert.equal(outputTermsNotice(afterQuote, phase("authorized", { run: false })), "grant_unavailable");
  const afterGrant = outputTerms(offer, options("image", { now: now + 11 * 60 * 1000, grant: original }));
  assert.equal(outputTermsNotice(afterGrant, phase("authorized")), "grant_expired");
  assert.equal(afterGrant.grantAvailable, false);
});

test("queued, uncertain and completed originals stay recorded work; visible usage retains exact exposure and different payer", () => {
  const offer = falFixture(), original = grant(offer); original.status = "active"; original.pendingCalls = 1; original.operations[0].pendingCalls = 1;
  const terms = outputTerms(offer, options("image", { grant: original }));
  assert.equal(terms.grantAvailable, false);
  for (const status of ["queued", "running"]) assert.equal(outputTermsNotice(terms, phase(status, { originalRunRecorded: true })), "pending");
  assert.equal(outputTermsNotice(terms, phase("uncertain", { originalRunRecorded: true })), "uncertain");
  for (const status of ["succeeded", "failed", "cancelled", "partial"]) assert.equal(outputTermsNotice(terms, phase(status, { originalRunRecorded: true })), "finished");
  assert.deepEqual(terms.summary.usage, { expiresAt: original.expiresAt, usedSpend: "USD 0.000123", unresolvedExposure: "USD 0.000456", pendingCalls: 1, payer: "payer-distinct", differentPayer: true });
  assert.ok(Object.isFrozen(terms.summary.usage));
  const changed = structuredClone(original); changed.disclosure.termsDigest = "changed";
  const unqualified = outputTerms(offer, options("image", { grant: changed }));
  assert.equal(unqualified.summary.usage, null); assert.equal(unqualified.grantAvailable, false);
});

const host = readFileSync(new URL("../src/components/forma-experience-host.ts", import.meta.url), "utf8");
test("host keeps compact essentials before consent and full in-flow technical disclosure after actions", () => {
  const render = host.slice(host.indexOf("  override render()"));
  assert.ok(render.indexOf("this.#termsSummary(terms, state, binding)") < render.indexOf('data-experience-action="authorize"'));
  assert.ok(render.indexOf('data-experience-control="edit"') < render.indexOf('class="experience-terms experience-technical-terms"'));
  assert.match(render, /!terms\.summary && !result/); // Unprojected future route never silently loses full terms.
  assert.ok(!render.includes("showPopover")); assert.ok(!render.includes("popovertarget"));
  assert.match(host, /data-experience-terms-notice=\$\{notice\} role="status" aria-live="polite"/);
  const summary = host.slice(host.indexOf("  #termsSummary("), host.indexOf("  override render()"));
  assert.ok(!summary.includes("<details"));
  for (const field of ["summary.maximumSpend", "summary.maximumGenerationCalls", "summary.recipients", "summary.safety", "summary.caveats", "summary.usage.unresolvedExposure", "summary.usage.payer", "binding.plan.title"]) assert.ok(summary.includes(field));
  assert.ok(summary.includes('dir="auto"')); assert.ok(!summary.includes("unsafeHTML"));
});

test("a future unsupported format cannot fall through to a Slides summary", () => {
  const source = readFileSync(new URL("../src/experiences/output-terms.ts", import.meta.url), "utf8");
  const begin = source.indexOf("function summaryProjection("), end = source.indexOf("export type OutputTermsNotice", begin);
  const projection = new Function(stripTypeScriptTypes(source.slice(begin, end)) + "; return summaryProjection;")();
  for (const output of ["video", "model3d", "unknown", undefined]) assert.equal(projection({}, {}, { output }, null), undefined);
});
