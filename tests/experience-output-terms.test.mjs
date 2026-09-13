import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { outputTerms, outputTermsMoney } from "../src/experiences/output-terms.ts";
import { preflightOutputImageSlidesTarget } from "../worker/output-image-slides-preflight.ts";
import { readOutputFalImageContract } from "../src/model/output-fal-image-contract.ts";

// Synthetic contract fixtures only. No canonical runtime, provider quote or paid acceptance.
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
const values = rows => Object.fromEntries(rows.map(entry => [entry.label, entry.value]));

async function falOffer() {
  const target = await preflightOutputImageSlidesTarget({
    env: { OPENAI_API_KEY: "inert-not-a-credential", FAL_KEY: "inert-not-a-credential", FORMA_IMAGE_PROVIDER: "fal-ideogram", FAL_IMAGE_MODEL: "ideogram/v4" },
    target: { id: "target-original", label: "Image", selected: true, blocking_issues: [], source_scope: { kind: "document" }, media_kind: "image",
      aspect_ratio: { width: 1, height: 1 }, coverage: { kind: "document_context" }, instruction_text: "1 image" },
    context: { snapshot: { facts: [{ block_id: "subject", type: "subject", active: true, properties: { text: "A lamp", weight: 1 } }] } },
  });
  assert.equal(target.available, true);
  const offer = fixture(); offer.targets = [target]; offer.maximumMicrousd = target.maximumMicrousd;
  offer.operationAttempts["target-original"].ordinal = 0;
  return offer;
}

test("Fal actual pure preflight projects exact functional terms without backend prose", async () => {
  const offer = await falOffer(); offer.targets[0].reason = "UNTRUSTED BACKEND PROSE"; offer.targets[0].transferDescription = "UNTRUSTED TRANSFER PROSE";
  const result = outputTerms(offer, options("image", { expectedImageSize: "1024x1024" }));
  assert.equal(result.available, true); assert.equal(result.grantAvailable, false);
  const detail = values(result.targets[0].rows);
  assert.equal(detail["Image format"], "PNG"); assert.equal(detail["Image provider"], "fal.ai / Ideogram V4");
  assert.equal(detail["Planning provider"], "OpenAI"); assert.equal(detail["Planning model"], "gpt-5.6-terra");
  assert.equal(detail["Safety provider"], "OpenAI"); assert.equal(detail["Prompt expansion"], "Large");
  assert.equal(detail["Estimated image cost"], "USD 0.134858"); assert.equal(detail["Image allowance"], "USD 0.90");
  assert.equal(detail["Result recovery"], "Original request only"); assert.ok(!JSON.stringify(result).includes("UNTRUSTED"));
  assert.equal(values(result.targets[0].calls[0].rows).Provider, "openai"); assert.equal(values(result.targets[0].calls[1].rows).Provider, "fal");
  assert.ok(readOutputFalImageContract(offer.targets[0].settings.payload.outputFalImage));
});

test("Fal terms reject unquoted model, provider, size, format, pricing, payload and replacement attempts", async () => {
  const baseline = await falOffer();
  for (const mutate of [o => { o.targets[0].settings.calls[0].model = "unknown"; }, o => { o.targets[0].settings.calls[1].provider = "openai"; },
    o => { o.targets[0].model = "ideogram/v4/fast"; }, o => { o.targets[0].route = "document-image-manual-v1"; },
    o => { o.targets[0].settings.payload.outputFalImage.outputFormat = "jpeg"; }, o => { o.targets[0].settings.payload.outputFalImage.pricingVersion = "old"; },
    o => { o.targets[0].settings.payload.outputFalImage.expansionModel = "None"; }, o => { o.targets[0].settings.payload.outputFalImage.maximumMicrousd = 1; },
    o => { o.targets[0].settings.payload.extra = "hidden"; }, o => { o.targets[0].settings.imageBudget = {}; },
    o => { o.targets[0].settings.imageRender.format.dimensions.width = 2048; }, o => { o.targets[0].settings.calls[1].maximumMicrousd--; },
    o => { o.maximumMicrousd++; }, o => { o.operationAttempts["target-original"].ordinal = 1; }]) {
    const offer = structuredClone(baseline); mutate(offer); assert.equal(outputTerms(offer, options()).available, false);
  }
  assert.equal(outputTerms(baseline, options("image", { expectedImageSize: "1536x1024" })).available, false);
});

test("Fal shared client contract imports no Worker execution or provider graph", () => {
  const model = readFileSync(new URL("../src/model/output-fal-image-contract.ts", import.meta.url), "utf8");
  assert.deepEqual(model.match(/from "[^"]+"/gu), ['from "./fal-image-identity.ts"']);
  assert.equal(/\bfetch\s*\(|\brequire\s*\(|\bimport\s*\(/u.test(model), false);
  assert.equal(model.includes("submitOutputFalImageRequest"), false);
});

test("helper imports only canonical types and closed pure output contracts", () => {
  const source = readFileSync(new URL("../src/experiences/output-terms.ts", import.meta.url), "utf8");
  assert.deepEqual(source.match(/^import[^\n]+/gm), [
    'import { readVideoExecutionOffer } from "../model/output-video-offer.ts";',
    'import type { VideoOutputContract } from "../model/output-video-contract.ts";',
    'import { readModel3dExecutionOffer } from "../model/output-model3d-offer.ts";',
    'import type { Model3dOutputContract } from "../model/output-model3d-contract.ts";',
    'import type { Model3dMiniAppCostPreview } from "../model/model3d-mini-app-consent.ts";',
    'import { EXPERIENCE_AUDIO_INTENT } from "./contracts.ts";',
    'import { parseAudioOutputContract, type AudioOutputContract } from "../model/output-audio-contract.ts";',
    'import { parseAudioMiniAppCostPreview, type AudioMiniAppCostPreview } from "../model/audio-mini-app-consent.ts";',
    'import { parseShortStoryNarrativeContract } from "../model/output-narrative-contract.ts";',
    'import { parseSceneOutputContract, type SceneOutputContract } from "../model/output-scene-contract.ts";',
    'import { parseSceneMiniAppCostPreview, type SceneMiniAppCostPreview } from "../model/scene-mini-app-consent.ts";',
    'import { readOutputFalImageContract } from "../model/output-fal-image-contract.ts";',
    'import { readStoryboardExecutionOffer } from "../model/output-storyboard-offer.ts";',
    'import type { StoryboardOutputSource } from "../model/output-storyboard-contract.ts";',
    'import { canonicalJson } from "./compiler.ts";',
    'import type { OutputGrantRow, OutputPreflight } from "../model/output-delivery-contract.ts";',
  ]);
  assert.equal(/\bimport\s*\(|\brequire\s*\(|\bfetch\s*\(/u.test(source), false);
});
test("Image terms preserve exact money, native providers, limits, policy, settings and safety disclosure", () => {
  const offer = fixture(), result = outputTerms(offer, options());
  assert.equal(result.available, true);
  assert.equal(result.grantAvailable, false);
  assert.equal(values(result.rows)["Maximum spend"], "USD 1.000001");
  assert.equal(values(result.rows)["Target maximum tokens"], "128000");
  const target = result.targets[0], detail = values(target.rows);
  assert.equal(detail.Output, "1 image");
  assert.equal(detail.Route, "document-image-manual-v1");
  assert.equal(detail["Safety model"], "omni-moderation-latest");
  assert.equal(detail["Reference pixels"], "Unavailable");
  assert.equal(detail["Maximum image input tokens"], "36096");
  assert.equal(values(target.calls[0].rows).Model, "synthetic-planner");
  assert.equal(values(target.calls[1].rows)["Maximum spend"], "USD 0.90");
  assert.deepEqual(JSON.parse(target.settings), offer.targets[0].settings);
});
test("Slides preserve one exact-five target, distinct model routes and call token ceilings", () => {
  const offer = fixture("slides"), result = outputTerms(offer, options("slides"));
  assert.equal(result.available, true);
  assert.equal(values(result.targets[0].rows)["Slide count"], "Exactly 5");
  assert.equal(values(result.targets[0].calls[1].rows).Model, "synthetic-slides-1");
  assert.equal(values(result.targets[0].calls[0].rows)["Maximum output tokens"], "8000");
  assert.deepEqual(JSON.parse(result.targets[0].settings), offer.targets[0].settings);
});
test("microUSD formatting preserves six digits and rejects unknown numeric values", () => {
  for (const [input, expected] of [[0, "USD 0.00"], [1, "USD 0.000001"], [10001, "USD 0.010001"], [1000000, "USD 1.00"], [Number.MAX_SAFE_INTEGER, "USD 9007199254.740991"]])
    assert.equal(outputTermsMoney(input), expected);
  for (const bad of [null, undefined, "1", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(outputTermsMoney(bad), null);
});
test("unknown or missing reason, transfer, route, provider, model or execution policy is unavailable", () => {
  for (const field of ["reasonCode", "transferCode", "provider", "model", "route"]) {
    for (const bad of [undefined, null, "", "unknown"]) {
      const offer = fixture();
      if (bad === undefined) delete offer.targets[0][field]; else offer.targets[0][field] = bad;
      assert.equal(outputTerms(offer, options()).available, false, `${field}: ${bad}`);
    }
  }
  for (const change of [p => p.maximumMilliseconds = 900000, p => p.maximumRenewals = 4, p => delete p.heartbeatMilliseconds, p => p.extra = true]) {
    const offer = fixture(); change(offer.targets[0].settings.executionPolicy);
    assert.equal(outputTerms(offer, options()).available, false);
  }
});
test("all exposed ceiling positions fail closed on malformed numbers", () => {
  const mutations = [
    (o, value) => o.maximumMicrousd = value, (o, value) => o.maximumCalls = value,
    (o, value) => o.targets[0].maximumMicrousd = value, (o, value) => o.targets[0].maximumCalls = value,
    (o, value) => o.targets[0].maximumTokens = value, (o, value) => o.targets[0].settings.calls[0].maximumMicrousd = value,
    (o, value) => o.targets[0].settings.imageBudget.maximumMicrousd = value,
    (o, value) => o.targets[0].settings.imageBudget.maximumOutputTokens = value,
  ];
  for (const mutate of mutations) for (const value of [-1, 0.5, NaN, Infinity, "2", null, Number.MAX_SAFE_INTEGER + 1]) {
    const offer = fixture(); mutate(offer, value);
    assert.equal(outputTerms(offer, options()).available, false);
  }
});
test("offers have exact single target and no alternate operation", () => {
  for (const change of [o => o.targets = [], o => o.targets.push(structuredClone(o.targets[0])), o => o.targets[0].targetId = "other",
    o => o.targets[0].available = false, o => o.operationAttempts = {}, o => o.operationAttempts["target-original"].previousSlotId = "old-slot",
    o => o.operationAttempts.other = { ordinal: 1, previousSlotId: null }]) {
    const offer = fixture(); change(offer); assert.equal(outputTerms(offer, options()).available, false);
  }
});
test("missing identity and malformed timestamps never authorize", () => {
  for (const key of ["id", "planRevisionId", "termsDigest", "sourceDigest", "requirementsDigest", "createdAt", "expiresAt"]) {
    const offer = fixture(); delete offer[key]; assert.equal(outputTerms(offer, options()).available, false, key);
  }
  for (const value of ["", "tomorrow", "2026-02-30T00:00:00.000Z", "2026-09-12", "2026-09-12T12:00:00.000Z"]) {
    const offer = fixture(); offer.expiresAt = value; assert.equal(outputTerms(offer, options()).available, false, value);
  }
  assert.equal(outputTerms(fixture(), options("image", { now: NaN })).available, false);
});
test("expired offers keep read-only terms and never erase retained grant evidence", () => {
  const offer = fixture(), original = grant(offer);
  const result = outputTerms(offer, options("image", { now: now + 6 * 60 * 1000, grant: original }));
  assert.equal(result.available, false);
  assert.equal(result.reasonCode, "terms_expired");
  assert.equal(result.targets.length, 1);
  assert.equal(result.grantAvailable, true);
  assert.equal(result.grantReasonCode, null);
  assert.equal(values(result.grantRows).Job, "job-original");
});
test("Slides refuse drift in count, kind, call stages and model route", () => {
  for (const change of [s => s.payload.itemCount = 6, s => s.payload.requestedSlideCount = 6, s => delete s.payload.requestedSlideCount,
    s => s.payload.slideCountPolicy.kind = "flexible", s => s.payload.slideCountPolicy.value = 6,
    s => s.kind = "generate", s => s.calls[1].stage = "replacement", s => s.calls[0].presentationRoute = {},
    s => s.calls[0].presentationRoute.model = "other",
    s => s.calls[0].maximumInputTokens = -1]) {
    const offer = fixture("slides"); change(offer.targets[0].settings);
    assert.equal(outputTerms(offer, options("slides")).available, false);
  }
});
test("Image refuses unsupported sizing, reference-pixel, budget and pricing-contract settings", () => {
  for (const change of [s => s.imageBudget = {}, s => s.imageBudget.maximumReferenceImages = 1,
    s => s.imageBudget.allowanceCode = "unknown", s => s.imageBudget.version = "unknown",
    s => s.imageRender.format.dimensions.width = 1025, s => s.imageRender.size = "2048x2048",
    s => s.imageBudget.maximumMicrousd = 900001, s => s.imageBudget.quality = "auto"]) {
    const offer = fixture(); change(offer.targets[0].settings); assert.equal(outputTerms(offer, options()).available, false);
  }
  assert.equal(outputTerms(fixture(), options("image", { expectedImageSize: "1536x1024" })).available, false);
});
test("call limits must agree with the exact offered native route", () => {
  for (const change of [o => o.maximumMicrousd = 1, o => o.maximumCalls = 1,
    o => o.targets[0].settings.calls[0].maximumMicrousd++, o => o.targets[0].maximumCalls = 3,
    o => o.targets[0].settings.calls.reverse(), o => o.targets[0].settings.calls[0].provider = "other"]) {
    const offer = fixture(); change(offer); assert.equal(outputTerms(offer, options()).available, false);
  }
});
test("retained grant exposes actual original actor, payer, slot, job and unresolved amounts", () => {
  const offer = fixture(), result = outputTerms(offer, options("image", { grant: grant(offer) }));
  assert.equal(result.grantAvailable, true);
  const detail = values(result.grantRows);
  assert.equal(detail.Actor, "actor-original"); assert.equal(detail.Payer, "payer-distinct");
  assert.equal(detail.Operation, "slot-original"); assert.equal(detail.Job, "job-original");
  assert.equal(detail["Unresolved exposure"], "USD 0.000456");
});
test("missing or changed original disclosure and extra operations disable grant use", () => {
  for (const change of [g => g.disclosure = null, g => g.disclosure.termsDigest = "other",
    g => g.planRevisionId = "other", g => g.operations.push(structuredClone(g.operations[0])),
    g => g.operations[0].targetId = "other", g => g.maximumMicrousd++, g => g.operations[0].maximumCalls++,
    g => g.actorUserId = "", g => g.payerUserId = "", g => g.operations[0].jobId = ""]) {
    const offer = fixture(), original = grant(offer); change(original);
    assert.equal(outputTerms(offer, options("image", { grant: original })).grantAvailable, false);
  }
});
test("every retained allowance field rejects malformed numeric values", () => {
  for (const key of ["maximumMicrousd", "maximumCalls", "usedMicrousd", "exposedMicrousd", "usedCalls", "pendingCalls"])
    for (const value of [-1, 0.1, NaN, Infinity, "0", null, Number.MAX_SAFE_INTEGER + 1]) for (const slot of [false, true]) {
      const offer = fixture(), original = grant(offer); (slot ? original.operations[0] : original)[key] = value;
      assert.equal(outputTerms(offer, options("image", { grant: original })).grantAvailable, false);
    }
});
test("terminal or expired grants retain evidence without allowing run", () => {
  for (const status of ["active", "completed", "revoked", "exceeded"]) {
    const offer = fixture(), original = grant(offer); original.status = status;
    const result = outputTerms(offer, options("image", { grant: original }));
    assert.equal(result.grantAvailable, false); assert.equal(result.grantReasonCode, "grant_not_authorized");
    assert.equal(values(result.grantRows).Status, status); assert.equal(values(result.grantRows).Job, "job-original");
  }
  const offer = fixture(), original = grant(offer); original.expiresAt = "2026-09-12T12:00:00.000Z";
  const result = outputTerms(offer, options("image", { grant: original }));
  assert.equal(result.grantAvailable, false); assert.equal(result.grantReasonCode, "grant_expired"); assert.ok(result.grantRows.length);
});
test("returned terms are immutable snapshots without getter execution", () => {
  const offer = fixture(), result = outputTerms(offer, options());
  offer.targets[0].model = "changed";
  assert.equal(values(result.targets[0].rows).Model, "gpt-image-2");
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.targets[0].rows[0]), true);
  let called = false;
  const malicious = fixture(); Object.defineProperty(malicious.targets[0], "model", { enumerable: true, get() { called = true; return "gpt-image-2"; } });
  assert.equal(outputTerms(malicious, options()).available, false); assert.equal(called, false);
});
test("nonexistent aggregate token fields do not replace actual target ceilings", () => {
  const offer = fixture(); offer.maximumTokens = 1;
  const result = outputTerms(offer, options());
  assert.equal(result.available, true); assert.equal(values(result.rows)["Target maximum tokens"], "128000");
});
test("recorded resume requires an exact explicit flag for a valid live active grant", () => {
  const offer = fixture(), original = grant(offer);
  original.status = "active";
  original.pendingCalls = 1;
  original.operations[0].pendingCalls = 1;
  for (const flag of [undefined, false, "true", 1]) {
    const result = outputTerms(offer, options("image", { grant: original, allowRecordedResume: flag }));
    assert.equal(result.grantAvailable, false);
    assert.equal(result.grantReasonCode, "grant_not_authorized");
  }
  // Offer expiry cannot erase a live original grant; the host proves exact resume authority separately.
  const resumed = outputTerms(offer, options("image", { grant: original, allowRecordedResume: true, now: now + 6 * 60 * 1000 }));
  assert.equal(resumed.available, false);
  assert.equal(resumed.reasonCode, "terms_expired");
  assert.equal(resumed.grantAvailable, true);
  assert.equal(resumed.grantReasonCode, null);
  const detail = values(resumed.grantRows);
  assert.equal(detail.Status, "active");
  assert.equal(detail.Job, "job-original");
  assert.equal(detail["Pending calls"], "1");
  assert.equal(detail["Unresolved exposure"], "USD 0.000456");
  original.status = "authorized";
  assert.equal(outputTerms(offer, options("image", { grant: original, allowRecordedResume: true })).grantAvailable, true);
});
test("recorded resume never bypasses expiry, original disclosure, limits or terminal status", () => {
  for (const change of [g => g.expiresAt = "2026-09-12T12:00:00.000Z", g => g.disclosure = null,
    g => g.disclosure.termsDigest = "other", g => g.maximumMicrousd = -1,
    g => g.operations[0].pendingCalls = "1", g => g.status = "completed", g => g.status = "revoked",
    g => g.status = "exceeded", g => g.status = "unknown"]) {
    const offer = fixture(), original = grant(offer); original.status = "active"; change(original);
    const result = outputTerms(offer, options("image", { grant: original, allowRecordedResume: true }));
    assert.equal(result.grantAvailable, false);
    assert.notEqual(result.grantReasonCode, null);
  }
});
