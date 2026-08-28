import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

const reasonCodes = {
  invalid_output_scope_amendment_reason: "amendmentReasonType",
  output_scope_amendment_reason_required: "amendmentReasonRequired",
  output_scope_amendment_reason_too_long: "amendmentReasonTooLong",
  output_scope_amendment_reason_control_characters: "amendmentReasonControls",
  output_scope_history_reason_unverified: "amendmentHistoryReasonUnverified",
};
const english = (code) => FORMA_OUTPUT_DELIVERY_MESSAGES.en[outputDeliveryMessageDescriptor(code).id];

test("reason type, blank withdrawal, length, control characters, and retained history each have a precise classification", () => {
  const ids = new Set();
  for (const [code, suffix] of Object.entries(reasonCodes)) {
    const descriptor = outputDeliveryMessageDescriptor(code, { reason: "Private authored reason\u202e", limit: 2000 });
    assert.equal(descriptor.known, true, code);
    assert.equal(descriptor.id, `output.delivery.message.${suffix}`);
    assert.deepEqual(descriptor.values, {}, `${code}: raw reasons and undisclosed limits are not interpolated`);
    ids.add(descriptor.id);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.ok(messages[descriptor.id]?.trim(), `${locale}.${code}`);
      assert.doesNotMatch(messages[descriptor.id], /\{[^{}]+\}|Private authored reason|2000|٢٠٠٠|https?:\/\//u);
      if (locale !== "en") assert.notEqual(messages[descriptor.id], english(code), `${locale}.${code}`);
    }
  }
  assert.equal(ids.size, 5);
});

test("draft correction keeps the entered text and allowed whitespace without implying a saved amendment", () => {
  assert.equal(english("invalid_output_scope_amendment_reason"), "Enter the amendment reason as text. No scope change was confirmed.");
  assert.match(english("output_scope_amendment_reason_too_long"), /Shorten the amendment reason to the limit shown/);
  const controls = english("output_scope_amendment_reason_control_characters");
  assert.match(controls, /Remove unsupported control or formatting characters/);
  assert.match(controls, /Tabs and line breaks are allowed/);
  for (const code of ["output_scope_amendment_reason_too_long", "output_scope_amendment_reason_control_characters"]) {
    assert.match(english(code), /Your text is retained for correction; no scope change was confirmed/);
  }
  assert.equal(english("output_scope_amendment_reason_required"), "Explain why agreed work is being withdrawn or changed, within the note limit. Earlier obligations, approvals, and costs remain recorded.");
});

test("unverified saved history is not an editable draft, a permission error, or a file-rights failure", () => {
  const code = "output_scope_history_reason_unverified";
  const descriptor = outputDeliveryMessageDescriptor(code);
  const text = english(code);
  assert.match(text, /saved amendment history cannot be verified for export/);
  assert.match(text, /recorded reason does not meet the supported text rules/);
  assert.match(text, /History and files remain unchanged/);
  assert.match(text, /Creating or reconfirming a plan does not repair recorded history/);
  assert.match(text, /Ask a workspace administrator to investigate/);
  assert.doesNotMatch(text, /Your text is retained for correction|Restore.*rights|refresh.*repair|remove.*history/iu);
  for (const other of [
    "invalid_output_scope_amendment_reason",
    "output_scope_amendment_reason_too_long",
    "output_scope_amendment_reason_control_characters",
    "context_source_rights_expired",
    "context_source_rights_required",
    "owned_file_rights_attestation_required",
    "output_execution_authority_revoked",
  ]) {
    const result = outputDeliveryMessageDescriptor(other);
    assert.equal(result.known, true, other);
    assert.notEqual(result.id, descriptor.id, other);
  }
});

test("the recorded runtime inventory includes every shared reason-validation and legacy-history code", () => {
  const codes = JSON.parse(readFileSync(new URL("./fixtures/output-delivery-runtime-codes.json", import.meta.url), "utf8"));
  for (const code of Object.keys(reasonCodes)) assert.ok(codes.includes(code), code);
  assert.equal(new Set(codes).size, codes.length);
});
