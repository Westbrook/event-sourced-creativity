import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

const slots = (text) => [...text.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort();

test("the complete attempt deadline renders only the supplied numeric duration in every locale", () => {
  for (const maximumExecutionSeconds of [240, 60, 37.5]) {
    const descriptor = outputDeliveryMessageDescriptor("output_native_execution_window", { maximumExecutionSeconds, sourceText: "Never interpolate this authored source." });
    assert.equal(descriptor.known, true);
    assert.deepEqual(descriptor.values, { maximumExecutionSeconds });
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      const text = messages[descriptor.id];
      assert.ok(text?.trim(), locale);
      assert.deepEqual(slots(text), ["maximumExecutionSeconds"], locale);
      assert.doesNotMatch(text, /[0-9٠-٩۰-۹]/u, "duration must come from the DTO, not fixed copy");
      assert.ok(text.replace("{maximumExecutionSeconds}", String(maximumExecutionSeconds)).includes(String(maximumExecutionSeconds)));
    }
  }
  const term = outputDeliveryMessageDescriptor("output_native_execution_window", { maximumExecutionSeconds: 240 });
  const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en[term.id];
  assert.match(english, /initial work and any repair, or planning and image rendering/);
  assert.match(english, /does not prove provider cancellation or a refund/);
  assert.match(english, /Reservations for unknown outcomes or costs remain held/);
  assert.match(english, /no automatic retry starts/);
});

test("missing, inherited, nonnumeric, zero, negative, and nonfinite durations do not become valid disclosures", () => {
  for (const value of [undefined, null, "", "240", false, 0, -1, NaN, Infinity, -Infinity, {}, []]) {
    const descriptor = outputDeliveryMessageDescriptor("output_native_execution_window", { maximumExecutionSeconds: value });
    assert.equal(descriptor.known, false);
    assert.equal(descriptor.id, "output.delivery.message.incomplete");
    assert.deepEqual(descriptor.values, {});
  }
  assert.equal(outputDeliveryMessageDescriptor("output_native_execution_window").known, false);
  assert.equal(outputDeliveryMessageDescriptor("output_native_execution_window", Object.create({ maximumExecutionSeconds: 240 })).known, false);
});

test("an unavailable complete-attempt duration has its own translated explanation without inventing zero", () => {
  const descriptor = outputDeliveryMessageDescriptor("output_native_execution_window_unknown");
  assert.equal(descriptor.known, true, "known means recognized translation, not verified execution authority");
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id], "The time limit for the complete attempt is unavailable.");
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages[descriptor.id]?.trim(), locale);
    assert.deepEqual(slots(messages[descriptor.id]), []);
    assert.doesNotMatch(messages[descriptor.id], /[0-9٠-٩۰-۹]/u);
    if (locale !== "en") assert.notEqual(messages[descriptor.id], FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id]);
  }
});

test("receipt and timeout error codes have explicit localized guidance and reuse approved UI copy exactly", () => {
  const reused = {
    output_execution_time_limit: "operationTimeLimit",
    output_receipt_scope_changed: "operationReceiptAccessChanged",
    output_receipt_check_failed: "operationReceiptCheckFailed",
    output_operation_still_running: "receiptStillActive",
  };
  const codes = [...Object.keys(reused), "output_receipt_response_mismatch", "output_native_operation_required", "output_provider_usage_invalid", "output_provider_usage_mismatch", "job_not_found"];
  for (const code of codes) {
    const descriptor = outputDeliveryMessageDescriptor(code);
    assert.equal(descriptor.known, true, code);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.ok(messages[descriptor.id]?.trim(), `${locale}.${code}`);
      assert.deepEqual(slots(messages[descriptor.id]), []);
      assert.ok(!messages[descriptor.id].includes(code));
      assert.doesNotMatch(messages[descriptor.id], /https?:\/\//u);
      if (locale !== "en") assert.notEqual(messages[descriptor.id], FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id]);
      if (reused[code]) assert.equal(messages[descriptor.id], messages[`output.delivery.${reused[code]}`]);
    }
  }
});

test("invalid accounting remains unresolved and never invites a provider retry as a repair", () => {
  const invalid = outputDeliveryMessageDescriptor("output_provider_usage_invalid");
  const mismatch = outputDeliveryMessageDescriptor("output_provider_usage_mismatch");
  assert.equal(invalid.id, mismatch.id);
  const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en[invalid.id];
  assert.match(english, /Unresolved reservations remain held/);
  assert.match(english, /ask an authorized operator to investigate/);
  assert.match(english, /do not retry generation to repair accounting/);
});

test("capacity, missing evidence, expired rights, missing rights, and revoked authority remain distinct", () => {
  const codes = ["context_source_evidence_capacity_exceeded", "context_source_evidence_unavailable", "context_source_rights_expired", "context_source_rights_required", "output_execution_authority_revoked"];
  const descriptors = codes.map((code) => outputDeliveryMessageDescriptor(code));
  assert.ok(descriptors.every((descriptor) => descriptor.known));
  assert.equal(new Set(descriptors.map((descriptor) => descriptor.id)).size, codes.length);
  const capacity = FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptors[0].id];
  assert.match(capacity, /complete source and all Output requirements are retained/);
  assert.match(capacity, /each require their applicable route’s source checks/);
  assert.match(capacity, /Upload, file matching, review, generation, export, and download/);
  assert.match(capacity, /Capacity blocks only actions whose own route limit is exceeded/);
  assert.match(capacity, /compare the numeric limits shown for each route/);
  assert.match(capacity, /Reconfirming does not raise limits/);
  assert.doesNotMatch(capacity, /remain blocked/);
  assert.match(capacity, /no sources are dropped/);
});
