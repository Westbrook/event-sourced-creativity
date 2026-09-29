import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

test("the preflight selection rejection explains its per-check limit without rejecting the full assignment", () => {
  const descriptor = outputDeliveryMessageDescriptor("finite_target_selection_required", { limit: 256, count: 257, private: "Authored text" });
  assert.equal(descriptor.known, true);
  assert.equal(descriptor.id, "output.delivery.message.finitePreflightSelection");
  assert.deepEqual(descriptor.values, {}, "the code-only API response needs no invented count or authored text");
  const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id];
  assert.equal(english, "Choose one or more distinct targets that are selected in the confirmed plan, within the per-check limit shown. Checking a smaller selection does not remove any work from the delivery plan.");
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages[descriptor.id]?.trim(), locale);
    assert.doesNotMatch(messages[descriptor.id], /\{[^{}]+\}|256|257|1000|٢٥٦|٢٥٧|١٠٠٠|Authored text/u, locale);
    if (locale !== "en") assert.notEqual(messages[descriptor.id], english, locale);
  }
});

test("invalid plan selections keep their existing separate descriptor and copy", () => {
  const descriptor = outputDeliveryMessageDescriptor("invalid_output_plan_selection");
  assert.equal(descriptor.known, true);
  assert.equal(descriptor.id, "output.delivery.message.finiteSelection");
  assert.notEqual(descriptor.id, outputDeliveryMessageDescriptor("finite_target_selection_required").id);
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id], "Choose a finite, nonempty set of distinct targets from the confirmed plan for this run.");
});
