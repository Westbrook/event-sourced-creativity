import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";

test("preconfirmation copy distinguishes proposed rules and retained parsed counts in all locales", () => {
  const expected = {
    notConfirmedShort: "Delivery plan not yet confirmed.",
    planResolvedRules: "Proposed acceptance rules and separate attempt aims",
    planPreviewInvalid: "The preview retains your last parsed count choices. Correct values that are invalid for the current requirements before confirming.",
  };
  for (const [key, english] of Object.entries(expected)) {
    const id = `output.delivery.${key}`;
    assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[id], english);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.ok(messages[id]?.trim(), `${locale}.${key}`);
      assert.doesNotMatch(messages[id], /\{[^{}]+\}/u);
      if (locale !== "en") assert.notEqual(messages[id], english);
    }
  }
  assert.doesNotMatch(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.planResolvedRules"], /^Resolved/u);
  assert.doesNotMatch(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.planPreviewInvalid"], /last valid/u);
});

test("the unconfirmed headline keeps the existing non-generation guidance as separate detail", () => {
  assert.equal(
    FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.notConfirmed"],
    "Review and confirm requirements to establish the delivery scope. This does not generate files.",
  );
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages["output.delivery.notConfirmed"]?.trim());
    assert.notEqual(messages["output.delivery.notConfirmedShort"], messages["output.delivery.notConfirmed"]);
  }
});
