import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";

test("unavailable exact-result review eligibility has an explicit localized refresh instruction", () => {
  const id = "output.delivery.reviewEligibilityUnknown";
  const english = "Review eligibility for this exact result is unavailable. Refresh outputs before reviewing it.";
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[id], english);
  assert.deepEqual(Object.keys(FORMA_OUTPUT_DELIVERY_MESSAGES).sort(), ["ar", "en", "fr", "ja"]);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages[id]?.trim(), locale);
    assert.doesNotMatch(messages[id], /\{[^{}]+\}/u, locale);
    assert.doesNotMatch(messages[id], /reviewAllowed|canReview|reviewEligibilityUnknown/u, locale);
    if (locale !== "en") assert.notEqual(messages[id], english, locale);
  }
});
