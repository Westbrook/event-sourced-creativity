import test from "node:test";
import assert from "node:assert/strict";
import { generationFailureGuidance } from "../src/model/document-jobs.ts";

const failure = (patch = {}) => ({
  code: "provider_connection_failed",
  category: "network",
  scope: "network",
  action: "retry",
  message: "The provider connection was interrupted.",
  retryable: true,
  retryAfterMs: null,
  requestId: null,
  httpStatus: null,
  ...patch,
});

test("identifies local persistence failures without implying a provider outage or exposing private diagnostics", () => {
  const privateDiagnostic = "D1_ERROR: private source text and actor-only receipt";
  const guidance = generationFailureGuidance(failure({
    code: "local_persistence_failed",
    category: "server",
    scope: "unknown",
    action: "contact_support",
    message: privateDiagnostic,
    retryable: false,
  }));

  assert.match(guidance.title, /Forma could not save/i);
  assert.match(guidance.summary, /local event or database write failed/i);
  assert.match(guidance.summary, /No provider outage was reported/i);
  assert.match(guidance.summary, /Contact support/i);
  assert.doesNotMatch(guidance.summary, /D1_ERROR|private source text|actor-only receipt|reasonable to retry/i);
  assert.equal(guidance.retryAllowed, false);
  assert.equal(guidance.actionUrl, null);
});

test("identifies source-fidelity validation failures without exposing source content or offering a retry", () => {
  const guidance = generationFailureGuidance(failure({
    code: "source_fidelity_validation_failed",
    category: "provider",
    scope: "request",
    action: "edit_request",
    message: "Expected private source phrase: secret acquisition target",
    retryable: false,
  }));

  assert.match(guidance.title, /presentation did not preserve its source/i);
  assert.match(guidance.summary, /failed source-fidelity validation/i);
  assert.match(guidance.summary, /Review the source document/i);
  assert.doesNotMatch(guidance.summary, /secret acquisition target|retry/i);
  assert.equal(guidance.retryAllowed, false);
});

test("preserves transient provider guidance while honoring non-retryable network and server receipts", () => {
  const transient = generationFailureGuidance(failure());
  assert.equal(transient.title, "The provider connection was interrupted");
  assert.equal(transient.summary, "No terminal account or request block was reported. It is reasonable to retry.");
  assert.equal(transient.retryAllowed, true);

  for (const category of ["network", "server"]) {
    const terminal = generationFailureGuidance(failure({ category, retryable: false, action: "contact_support" }));
    assert.equal(terminal.retryAllowed, false);
    assert.match(terminal.summary, /Review the saved technical receipt/i);
    assert.doesNotMatch(terminal.summary, /reasonable to retry/i);
  }
});
