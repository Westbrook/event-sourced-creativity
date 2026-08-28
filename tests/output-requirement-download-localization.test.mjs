import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES } from "../src/components/design-system/locales/output-requirement-messages.ts";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";

test("card result labels match the exact-file download action in all four locales", () => {
  assert.deepEqual(Object.keys(FORMA_OUTPUT_REQUIREMENT_MESSAGES).sort(), ["ar", "en", "fr", "ja"]);
  assert.equal(FORMA_OUTPUT_REQUIREMENT_MESSAGES.en["output.requirement.inspectResult"], "Download exact file for review");
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_REQUIREMENT_MESSAGES)) {
    assert.equal(messages["output.requirement.inspectResult"], FORMA_OUTPUT_DELIVERY_MESSAGES[locale]["output.delivery.downloadReview"], locale);
    assert.doesNotMatch(messages["output.requirement.inspectResult"], /\{[^{}]+\}/u);
  }
});

test("the actual result-open button uses the localized download label with its existing handler", () => {
  const card = readFileSync(new URL("../src/components/forma-output-requirement-card.ts", import.meta.url), "utf8");
  assert.match(card, /this\.#openResult\(result\)\}>\$\{this\.#t\("inspectResult"\)\}/u);
});
