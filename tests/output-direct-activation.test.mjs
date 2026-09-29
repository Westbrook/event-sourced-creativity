import assert from "node:assert/strict";
import test from "node:test";
import { OutputDirectActivationLatch, outputPaidDecisionKey } from "../src/components/output-direct-activation.ts";

// Synthetic event records exercise only the pure latch's state machine.
// Genuine isTrusted/keyboard/default-submit behavior still needs an actual browser.
function fixture(action = "authorize") {
  const form = {};
  const button = { type: "submit", disabled: false, form };
  const decision = { authorizationScopeKey: "actor:project:permission-1", documentId: "doc-a", viewEpoch: 1,
    planRevisionId: "plan-1", executionScopeKey: "source-requirements-targets-and-terms-1", ...(action === "authorize" ? { action, preflightId: "preflight-1", termsDigest: "terms-1" } : { action, grantId: "grant-1" }) };
  const click = { type: "click", isTrusted: true, currentTarget: button, defaultPrevented: false };
  const submit = { isTrusted: true, submitter: button, currentTarget: form };
  return { latch: new OutputDirectActivationLatch(), form, button, decision, click, submit };
}

for (const action of ["authorize", "run"]) {
  test(`${action}: exact trusted button activation is consumed once`, () => {
    const value = fixture(action);
    assert.equal(typeof value.latch.arm(value.click, value.button, value.decision, true), "number");
    assert.equal(value.latch.consume(value.submit, value.decision, true), true);
    assert.equal(value.latch.consume(value.submit, value.decision, true), false);
  });
}

test("native keyboard activation can use its trusted click; keydown alone does not arm", () => {
  const value = fixture();
  assert.equal(value.latch.arm({ ...value.click, type: "keydown" }, value.button, value.decision, true), null);
  assert.equal(typeof value.latch.arm({ ...value.click, detail: 0 }, value.button, value.decision, true), "number");
  assert.equal(value.latch.consume(value.submit, value.decision, true), true);
});

for (const [name, change] of [
  ["untrusted click", (value) => ({ ...value.click, isTrusted: false })],
  ["different event target", (value) => ({ ...value.click, currentTarget: {} })],
  ["cancelled click", (value) => ({ ...value.click, defaultPrevented: true })],
]) test(`${name} cannot arm a paid submission`, () => {
  const value = fixture();
  assert.equal(value.latch.arm(change(value), value.button, value.decision, true), null);
  assert.equal(value.latch.consume(value.submit, value.decision, true), false);
});

test("requestSubmit without an armed paid-button click fails even with a trusted submit and active gesture", () => {
  const value = fixture();
  assert.equal(value.latch.consume(value.submit, value.decision, true), false);
});

for (const [name, patch] of [
  ["authorization scope", { authorizationScopeKey: "other-actor" }],
  ["Document", { documentId: "doc-b" }],
  ["view epoch", { viewEpoch: 2 }],
  ["plan revision", { planRevisionId: "plan-2" }],
  ["reviewed execution scope", { executionScopeKey: "source-requirements-targets-and-terms-2" }],
  ["preflight", { preflightId: "preflight-2" }],
  ["terms", { termsDigest: "terms-2" }],
]) test(`changed ${name} invalidates and consumes the previous activation`, () => {
  const value = fixture();
  value.latch.arm(value.click, value.button, value.decision, true);
  assert.equal(value.latch.consume(value.submit, { ...value.decision, ...patch }, true), false);
  assert.equal(value.latch.consume(value.submit, value.decision, true), false);
});

test("a different grant cannot borrow an earlier grant activation", () => {
  const value = fixture("run");
  value.latch.arm(value.click, value.button, value.decision, true);
  assert.equal(value.latch.consume(value.submit, { ...value.decision, grantId: "grant-2" }, true), false);
});

for (const [name, change] of [
  ["untrusted submit", (value) => ({ ...value.submit, isTrusted: false })],
  ["different submitter", (value) => ({ ...value.submit, submitter: { ...value.button } })],
  ["different form", (value) => ({ ...value.submit, currentTarget: {} })],
]) test(`${name} fails and cannot leave reusable activation behind`, () => {
  const value = fixture();
  value.latch.arm(value.click, value.button, value.decision, true);
  assert.equal(value.latch.consume(change(value), value.decision, true), false);
  assert.equal(value.latch.consume(value.submit, value.decision, true), false);
});

test("button disabled or reassociated after click cannot authorize", () => {
  for (const change of [(button) => { button.disabled = true; }, (button) => { button.form = {}; }, (button) => { button.type = "button"; }]) {
    const value = fixture();
    value.latch.arm(value.click, value.button, value.decision, true);
    change(value.button);
    assert.equal(value.latch.consume(value.submit, value.decision, true), false);
  }
});

test("user activation is required at both click and submit", () => {
  const value = fixture();
  assert.equal(value.latch.arm(value.click, value.button, value.decision, false), null);
  value.latch.arm(value.click, value.button, value.decision, true);
  assert.equal(value.latch.consume(value.submit, value.decision, false), false);
  assert.equal(value.latch.consume(value.submit, value.decision, true), false);
});

test("expiry and explicit clear retire an unused click", () => {
  const value = fixture();
  const token = value.latch.arm(value.click, value.button, value.decision, true);
  value.latch.expire(token);
  assert.equal(value.latch.consume(value.submit, value.decision, true), false);
  value.latch.arm(value.click, value.button, value.decision, true);
  value.latch.clear();
  assert.equal(value.latch.consume(value.submit, value.decision, true), false);
});

test("an older next-task expiry cannot clear a newer direct activation", () => {
  const value = fixture();
  const old = value.latch.arm(value.click, value.button, value.decision, true);
  value.latch.arm(value.click, value.button, value.decision, true);
  value.latch.expire(old);
  assert.equal(value.latch.consume(value.submit, value.decision, true), true);
});

test("incomplete decision identities never arm", () => {
  const value = fixture();
  for (const patch of [{ documentId: "" }, { authorizationScopeKey: "" }, { planRevisionId: "" }, { executionScopeKey: "" }, { executionScopeKey: undefined }, { preflightId: "" }, { termsDigest: "" }, { viewEpoch: -1 }, { viewEpoch: 0.5 }, { action: "unknown" }]) {
    const decision = { ...value.decision, ...patch };
    assert.equal(outputPaidDecisionKey(decision), null);
    assert.equal(value.latch.arm(value.click, value.button, decision, true), null);
  }
});
