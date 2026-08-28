import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { OUTPUT_DELIVERY_RUNTIME_CODES, outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

test("proof size has its own classification rather than missing private evidence, rights, or governance capture capacity", () => {
  const proof = outputDeliveryMessageDescriptor("output_source_proof_too_large");
  assert.equal(proof.known, true);
  assert.equal(proof.id, "output.delivery.message.genericSourceProofCapacity");
  assert.equal(OUTPUT_DELIVERY_RUNTIME_CODES.filter((code) => code === "output_source_proof_too_large").length, 1);
  const governedProof = outputDeliveryMessageDescriptor("output_source_governance_proof_too_large");
  assert.deepEqual(governedProof, proof, "governed SQL proof size shares the generic size/complexity explanation");
  assert.equal(OUTPUT_DELIVERY_RUNTIME_CODES.filter((code) => code === "output_source_governance_proof_too_large").length, 1);
  const otherCases = {
    context_source_evidence_unavailable: "currentEvidenceRequired",
    output_private_evidence_unavailable: "currentEvidenceRequired",
    // Missing or retention-expired private source payloads use this existing code.
    output_source_private_evidence_unavailable: "currentEvidenceRequired",
    context_source_rights_expired: "sourceRightsExpired",
    context_source_rights_required: "sourceRightsRequired",
    output_source_governance_capacity_exceeded: "sourceGovernanceCapacity",
    context_source_evidence_capacity_exceeded: "sourceEvidenceCapacity",
  };
  for (const [code, name] of Object.entries(otherCases)) {
    const descriptor = outputDeliveryMessageDescriptor(code);
    assert.equal(descriptor.known, true, code);
    assert.equal(descriptor.id, `output.delivery.message.${name}`, code);
    assert.notEqual(descriptor.id, proof.id, code);
  }
});

test("proof-capacity copy retains the assignment and history and explains that refresh cannot increase capacity", () => {
  const proof = outputDeliveryMessageDescriptor("output_source_proof_too_large", { maximumProofBytes: 1024, captureBatchLimit: 2, privateSource: "Untranslated private source" });
  const governedProof = outputDeliveryMessageDescriptor("output_source_governance_proof_too_large", { maximumProofBytes: 1024, captureBatchLimit: 2, privateSource: "Untranslated private source" });
  assert.deepEqual(governedProof, proof, "both proof-size codes ignore optional batch and private-source values");
  assert.deepEqual(proof.values, {});
  const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en[proof.id];
  assert.match(english, /current size or complexity limit/);
  assert.match(english, /full assignment, saved plans, previous results, and spending history are retained/);
  assert.match(english, /Inspect the current Document’s source records and contact a workspace administrator/);
  assert.match(english, /Refresh only rechecks the state; it does not increase verification capacity/);
  assert.doesNotMatch(english, /restore|governed|capture|batch|package|depth|repair/iu);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages[proof.id]?.trim(), locale);
    assert.doesNotMatch(messages[proof.id], /\{[^{}]+\}|[0-9٠-٩۰-۹]|Untranslated private source|https?:\/\//u);
    assert.doesNotMatch(messages[proof.id], /restore|rétabli|استعد|استعادة|復旧/iu);
    if (locale !== "en") assert.notEqual(messages[proof.id], english);
  }
});

test("all remaining current-evidence aliases keep their existing missing-evidence descriptor", () => {
  const remaining = ["output_plan_evidence_mismatch", "output_private_evidence_changed", "output_private_evidence_unavailable", "output_source_private_evidence_unavailable", "context_source_evidence_unavailable"];
  for (const code of remaining) assert.equal(outputDeliveryMessageDescriptor(code).id, "output.delivery.message.currentEvidenceRequired", code);
  assert.equal(
    FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.message.currentEvidenceRequired"],
    "Current source evidence could not be verified. Restore authorized source evidence and refresh; this cannot be resolved by approving unchecked work.",
  );
});
