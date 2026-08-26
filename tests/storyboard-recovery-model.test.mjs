import assert from "node:assert/strict";
import test from "node:test";

import { documentJobCanRecoverProviderRender, generationFailureGuidance } from "../src/model/document-jobs.ts";

const failure = (patch = {}) => ({
  code: "fal_result_response_invalid",
  category: "network",
  scope: "provider",
  action: "retry",
  message: "The accepted storyboard frame could not be retrieved.",
  retryable: true,
  retryAfterMs: null,
  requestId: "owned-storyboard-frame-1",
  httpStatus: 502,
  ...patch,
});

const storyboard = (result = {}, errorDetail = failure()) => ({
  kind: "render_document",
  status: "failed",
  stage: "rendering-frames",
  members: [],
  result: {
    artifactKind: "storyboard",
    storyboardProviderSubmission: "confirmed",
    providerJobId: "owned-storyboard-frame-1",
    generationReceipt: {
      provider_request_status: "submitted",
      source_transmission_status: "transmitted",
      reservation_status: "executing",
    },
    ...result,
  },
  errorDetail,
});

test("recovers only a failed storyboard with a confirmed durable accepted-provider identifier", () => {
  assert.equal(documentJobCanRecoverProviderRender(storyboard()), true);

  for (const invalid of [
    { storyboardProviderSubmission: "pending" },
    { storyboardProviderSubmission: undefined },
    { providerJobId: undefined },
    { providerJobId: null },
    { providerJobId: "" },
    { providerJobId: "   " },
    { providerJobId: "submitted" },
    { providerJobId: "pending" },
    { providerJobId: "unknown" },
    { providerJobId: "../someone-elses-request" },
    { providerJobId: "owned-request?foreign=1" },
    { providerJobId: "x".repeat(201) },
    { providerJobId: undefined, recoverableProductionProviderRequest: true },
    {
      providerJobId: undefined,
      productionSceneReceipts: {
        "unrelated-scene": { status: "submitted", providerJobId: "someone-elses-scene" },
      },
    },
  ]) {
    assert.equal(documentJobCanRecoverProviderRender(storyboard(invalid)), false, JSON.stringify(invalid));
  }

  assert.equal(documentJobCanRecoverProviderRender({ ...storyboard(), status: "running" }), false);
  assert.equal(documentJobCanRecoverProviderRender({ ...storyboard(), kind: "generate" }), false);
});

test("resumes an accepted storyboard after an interrupted worker or safe reservation conflict", () => {
  for (const code of ["execution_interrupted", "cost_reservation_invalid_or_expired", "cost_reservation_already_in_use"]) {
    assert.equal(documentJobCanRecoverProviderRender(storyboard({}, failure({ code, category: "server", retryable: false, httpStatus: 409 }))), true, code);
  }

  for (const rejected of [
    failure({ code: "fal_content_policy_violation", category: "safety", retryable: false, httpStatus: 422 }),
    failure({ code: "fal_422", category: "provider", retryable: true, httpStatus: 422 }),
    failure({ code: "fal_400", category: "provider", retryable: true, httpStatus: 400 }),
    failure({ code: "provider_submission_uncertain", retryable: false, httpStatus: null }),
    failure({ code: "fal_provider_returned_no_request_id", category: "provider", retryable: false }),
  ]) {
    assert.equal(documentJobCanRecoverProviderRender(storyboard({}, rejected)), false, rejected.code);
  }
});

test("explains that an accepted interrupted storyboard can resume without another paid submission", () => {
  const interrupted = failure({
    code: "execution_interrupted",
    category: "server",
    action: "contact_support",
    retryable: false,
    httpStatus: null,
  });

  for (const result of [
    {},
    { generationReceipt: {} },
    { generationReceipt: { provider_request_status: "completed" } },
  ]) {
    const job = storyboard(result, interrupted);
    const guidance = generationFailureGuidance(interrupted, "execution_interrupted", job);
    assert.match(guidance.summary, /recover its saved result/i);
    assert.match(guidance.summary, /without starting another paid generation/i);
    assert.equal(guidance.retryAllowed, true);
  }
});

test("never suggests a duplicate storyboard submission while provider acceptance is pending or lacks a genuine identifier", () => {
  for (const result of [
    { storyboardProviderSubmission: "pending", providerJobId: undefined },
    { storyboardProviderSubmission: "pending", providerJobId: "submitted" },
    { storyboardProviderSubmission: "confirmed", providerJobId: undefined },
    { storyboardProviderSubmission: "confirmed", providerJobId: "../foreign-frame" },
  ]) {
    for (const detail of [
      failure({ code: "execution_interrupted", category: "server", retryable: false, httpStatus: null }),
      failure({ code: "provider_submission_uncertain", retryable: false, httpStatus: null }),
      failure({ httpStatus: null }),
    ]) {
      const job = storyboard({
        ...result,
        generationReceipt: {
          provider_request_status: "submission_unknown",
          source_transmission_status: "unknown",
          settled_cost_microusd: null,
        },
      }, detail);
      const guidance = generationFailureGuidance(detail, "", job);
      assert.match(guidance.title, /could not be confirmed/i);
      assert.match(guidance.summary, /duplicate charge/i);
      assert.equal(guidance.retryAllowed, false, JSON.stringify(result));
    }
  }
});

test("preserves existing accepted-video and accepted-audio recovery behavior", () => {
  for (const artifactKind of ["video", "audio"]) {
    const job = storyboard({ artifactKind, storyboardProviderSubmission: undefined });
    assert.equal(documentJobCanRecoverProviderRender(job), true, artifactKind);
    assert.equal(documentJobCanRecoverProviderRender(storyboard({
      artifactKind,
      storyboardProviderSubmission: undefined,
      providerJobId: undefined,
      recoverableProductionProviderRequest: true,
    })), true, artifactKind);
  }
});
