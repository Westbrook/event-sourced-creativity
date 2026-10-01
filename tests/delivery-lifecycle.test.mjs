import assert from "node:assert/strict";
import test from "node:test";
import {
  DELIVERY_DECISION_STATUSES,
  canonicalDeliveryStatus,
  deliveryTransitionAllowed,
  deliveryNeedsEvidence,
  deliveryNeedsCompleteDependencies,
  deliveryNeedsReleaseAuthority,
} from "../src/platform/delivery-lifecycle.ts";

const canonical = ["planned", "running", "failed", "passed", "approval_required", "approved", "revoked", "superseded"];
const aliases = { active: "running", blocked: "failed", ready: "approval_required", completed: "passed" };
const allowed = {
  planned: ["planned", "running", "failed", "superseded"],
  running: ["running", "failed", "passed", "superseded"],
  failed: ["failed", "running", "superseded"],
  passed: ["passed", "running", "approval_required", "superseded"],
  approval_required: ["approval_required", "failed", "approved", "superseded"],
  approved: ["approved", "revoked", "superseded"],
  revoked: ["revoked", "running", "superseded"],
  superseded: ["superseded"],
};

test("Delivery lifecycle preserves all canonical statuses and exact historical aliases", () => {
  assert.deepEqual(DELIVERY_DECISION_STATUSES, canonical);
  for (const status of canonical) assert.equal(canonicalDeliveryStatus(status), status);
  for (const [alias, status] of Object.entries(aliases)) assert.equal(canonicalDeliveryStatus(alias), status);
});

test("Delivery lifecycle rejects inherited aliases and invalid values without coercion or transition errors", () => {
  const invalid = [
    ...["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf", "toLocaleString",
      "propertyIsEnumerable", "__defineGetter__", "__lookupGetter__", "unknown", "", "APPROVED", " approved", "approved "]
      .map(value => [value, value]),
    ["undefined", undefined], ["null", null], ["true", true], ["false", false], ["zero", 0], ["number", 1],
    ["NaN", NaN], ["Infinity", Infinity], ["empty array", []], ["status array", ["approved"]],
    ["object", {}], ["null prototype", Object.create(null)], ["boxed string", new String("approved")],
    ["symbol", Symbol("approved")], ["function", () => "approved"],
    ["throwing conversion", { toString() { throw new Error("Status values must not be coerced"); } }],
  ];
  for (const [label, value] of invalid) {
    assert.equal(canonicalDeliveryStatus(value), null, label);
    for (const status of canonical) {
      assert.equal(deliveryTransitionAllowed(value, status), false, `${label} as previous status`);
      assert.equal(deliveryTransitionAllowed(status, value), false, `${label} as next status`);
    }
  }
});

for (const previous of canonical) {
  test(`Delivery lifecycle preserves every transition from ${previous}`, () => {
    for (const next of canonical) {
      assert.equal(deliveryTransitionAllowed(previous, next), allowed[previous].includes(next), `${previous} to ${next}`);
    }
  });
}

test("Delivery lifecycle preserves historical previous-state transition behavior", () => {
  for (const [alias, previous] of Object.entries(aliases)) {
    for (const next of canonical) assert.equal(deliveryTransitionAllowed(alias, next), allowed[previous].includes(next), `${alias} to ${next}`);
  }
});

test("Delivery lifecycle preserves evidence, dependency and release-authority requirements", () => {
  for (const status of canonical) {
    assert.equal(deliveryNeedsEvidence(status), ["passed", "approval_required", "approved", "revoked"].includes(status), status);
    assert.equal(deliveryNeedsCompleteDependencies(status), ["passed", "approval_required", "approved"].includes(status), status);
    assert.equal(deliveryNeedsReleaseAuthority(status), ["approved", "revoked"].includes(status), status);
  }
});
