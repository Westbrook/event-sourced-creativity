import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";

test("missing target contract metadata has explicit four-locale guidance before availability checks or work authorization", () => {
  const id = "output.delivery.targetContractsUnavailable";
  const expected = "The current target contracts are unavailable. Refresh outputs to check them before requesting availability or authorizing work.";
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[id], expected);
  assert.doesNotMatch(expected, /capacity|limit|rights|governance|permission changed|free|automatically/iu);
  assert.deepEqual(Object.keys(FORMA_OUTPUT_DELIVERY_MESSAGES).sort(), ["ar", "en", "fr", "ja"]);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages[id]?.trim(), locale);
    assert.doesNotMatch(messages[id], /\{[^{}]+\}|https?:\/\//u);
    assert.notEqual(messages[id], messages["output.delivery.sourceChecksUnavailable"]);
    assert.notEqual(messages[id], messages["output.delivery.governedVerificationRemedy"]);
    if (locale !== "en") assert.notEqual(messages[id], expected, locale);
  }
});

test("clearing a check selection has separate localized action and feedback without changing the delivery plan", () => {
  const expected = {
    "output.delivery.clearRunSelection": "Clear selection for this check",
    "output.delivery.runSelectionCleared": "Selection cleared for this check; the delivery plan is unchanged.",
  };
  for (const [id, english] of Object.entries(expected)) {
    assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[id], english);
    assert.doesNotMatch(english, /first|256|1,000|1000|authorize|start|withdraw/u);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.ok(messages[id]?.trim(), `${locale}.${id}`);
      assert.doesNotMatch(messages[id], /\{[^{}]+\}/u);
      if (locale !== "en") assert.notEqual(messages[id], english);
    }
  }
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.notEqual(messages["output.delivery.clearRunSelection"], messages["output.delivery.runSelectionCleared"]);
  }
});
