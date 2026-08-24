import test from "node:test";
import assert from "node:assert/strict";
import { authorizedGenerationFailureRemediation, generationFailureGuidance } from "../src/model/document-jobs.ts";

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

test("never projects raw provider diagnostics or private source content into creator-facing guidance", () => {
  const privateDiagnostic = Array.from({ length: 500 }, (_, index) =>
    `issue_${index}: PRIVATE_SOURCE_EXCERPT secret-acquisition-target D1_ERROR sk-proj-secret-key provider transcript`,
  ).join(" | ");

  const missingReceipt = generationFailureGuidance(null, privateDiagnostic);
  assert.equal(missingReceipt.summary, "The provider could not complete this request. Review the saved inputs and technical receipt before trying again.");
  assert.equal(missingReceipt.retryAllowed, true);

  const incomplete = generationFailureGuidance(failure({
    code: "provider_returned_incomplete_document_artifact",
    category: "provider",
    scope: "request",
    message: privateDiagnostic,
  }), privateDiagnostic);
  assert.equal(incomplete.title, "The output plan was incomplete");
  assert.equal(incomplete.summary, "The provider returned structurally incomplete output data. The technical receipt identifies the exact fields that still need correction.");
  assert.equal(incomplete.retryAllowed, true);

  const unknown = generationFailureGuidance(failure({
    code: "unexpected_provider_failure",
    category: "provider",
    scope: "unknown",
    action: "contact_support",
    message: privateDiagnostic,
    retryable: false,
  }), privateDiagnostic);
  assert.equal(unknown.summary, "Review the technical receipt, adjust the request if needed, and try again.");
  assert.equal(unknown.retryAllowed, false);

  for (const guidance of [missingReceipt, incomplete, unknown]) {
    assert.ok(guidance.summary.length < 160, "even thousands of provider issues produce a bounded product explanation");
    assert.doesNotMatch(guidance.summary, /PRIVATE_SOURCE_EXCERPT|secret-acquisition-target|D1_ERROR|sk-proj-secret-key|provider transcript/);
  }
});

test("preserves deliberately authored prompt-fan guidance while rejecting arbitrary human-readable fallback text", () => {
  for (const fallback of [
    "Change this request or its reference before trying again.",
    "This prompt structure did not produce an image.",
  ]) assert.equal(generationFailureGuidance(null, fallback).summary, fallback);

  const untrusted = generationFailureGuidance(null, "Please inspect PRIVATE_SOURCE_EXCERPT from the provider response.");
  assert.doesNotMatch(untrusted.summary, /PRIVATE_SOURCE_EXCERPT|provider response/);
});

test("reveals provider credentials, billing, and operational remediation only to their exact authorized principal", () => {
  const providerPrincipal = { capabilities: ["platform.provider.configure"] };
  const policyPrincipal = { capabilities: ["platform.policy.manage"] };
  const ordinaryPrincipal = { capabilities: ["project.output.request", "workspace.budget.manage"] };
  const credential = generationFailureGuidance(failure({
    code: "fal_authentication_failed",
    category: "authentication",
    action: "check_credentials",
    retryable: false,
  }));
  assert.deepEqual(authorizedGenerationFailureRemediation(credential, providerPrincipal), {
    href: "https://fal.ai/dashboard/keys",
    label: "Review Fal keys",
    external: true,
  });
  assert.equal(authorizedGenerationFailureRemediation(credential, policyPrincipal), null, "a policy grant never implies provider credential authority");
  assert.equal(authorizedGenerationFailureRemediation(credential, ordinaryPrincipal), null);
  assert.equal(authorizedGenerationFailureRemediation(credential, { ...providerPrincipal, projectContext: { organizationId: "another-organization" } }), null, "shared-project sessions never inherit flattened cross-organization authority");
  assert.equal(authorizedGenerationFailureRemediation(credential, { ...providerPrincipal, impersonation: { active: true } }), null, "fictional-user impersonation never exposes actor provider settings");
  assert.equal(authorizedGenerationFailureRemediation(credential, null), null);

  const billing = generationFailureGuidance(failure({
    code: "fal_account_quota_exhausted",
    category: "quota",
    scope: "account",
    action: "add_credits",
    retryable: false,
  }));
  assert.deepEqual(authorizedGenerationFailureRemediation(billing, policyPrincipal), {
    href: "https://fal.ai/dashboard/billing",
    label: "Review Fal billing",
    external: true,
  });
  assert.equal(authorizedGenerationFailureRemediation(billing, providerPrincipal), null, "provider configuration does not silently grant billing-policy authority");

  const operations = generationFailureGuidance(failure({
    code: "budget_hard_cap_reached",
    category: "quota",
    scope: "workspace",
    action: "review_budget",
    retryable: false,
  }));
  assert.deepEqual(authorizedGenerationFailureRemediation(operations, policyPrincipal), {
    href: "/operations",
    label: "Review operational limits",
    external: false,
  });
  assert.equal(authorizedGenerationFailureRemediation(operations, providerPrincipal), null);

  for (const unsafe of [
    "https://fal.ai/dashboard/keys?source=untrusted",
    "https://fal.ai/dashboard/keys#unexpected",
    "https://fal.ai.evil.example/dashboard/keys",
    "https://platform.openai.com@evil.example/api-keys",
    "javascript:alert(1)",
    "https://developers.openai.com/api/docs/guides/safety-best-practices",
  ]) assert.equal(authorizedGenerationFailureRemediation({ ...credential, actionUrl: unsafe }, providerPrincipal), null, `${unsafe} is not an exact trusted provider destination`);

  assert.equal(authorizedGenerationFailureRemediation({ ...credential, retryAllowed: true }, providerPrincipal), null, "recoverable work never loses priority to platform settings");
});
