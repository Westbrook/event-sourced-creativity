import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";

test("lost plan-author permission preserves local inspection and names the localized Cancel action", () => {
  const id = "output.delivery.planAuthorPermissionLost";
  const expected = "You no longer have permission to edit this delivery plan. Your local choices are retained for inspection; editing and confirmation are disabled. You can close this review with Cancel.";
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[id], expected);
  assert.deepEqual(Object.keys(FORMA_OUTPUT_DELIVERY_MESSAGES).sort(), ["ar", "en", "fr", "ja"]);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages[id]?.trim(), locale);
    assert.doesNotMatch(messages[id], /\{[^{}]+\}/u);
    assert.ok(messages[id].includes(messages["output.delivery.cancel"]), `${locale}: Cancel must match the actual action label`);
    if (locale !== "en") assert.notEqual(messages[id], expected);
  }
});
