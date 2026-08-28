import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";

const expected = {
  owedTargetNeedsPlan: "This target is still owed, but it is excluded from this plan’s generation selection. Use Review delivery plan to include it before checking generation.",
  owedTargetNeedsAuthor: "This target is still owed, but it is excluded from this plan’s generation selection. Ask someone with permission to edit this Document to include it before checking generation.",
  planIncludeCommittedTargets: "Include all required and already selected optional targets in this plan",
  planTargetFilterHelp: "An explicit target selection is active. Required work and already selected optional work remain owed. The action below removes this filter only in the local preview; optional work that is not owed stays off. Review the preview and confirm separately.",
  planTargetFilterStaged: "The local preview now includes all required and already selected optional targets for generation checks. The work owed is unchanged. Review it and confirm separately; no work was authorized or started.",
  planGenerationSelectionPreview: "Targets included for generation checks in this preview: {selected} of {total}.",
  planTargetIncludedForChecks: "Included for generation checks.",
  planTargetExcludedFromChecks: "Excluded from generation checks; any agreed work is still owed.",
  optionalTargetFilterLocked: "Optional controls show the work already owed under this target filter. Remove the filter using the action below before changing optional choices.",
};
const slots = (text) => [...text.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort();
const english = (key) => FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${key}`];

test("all nine owed-target and local filter disclosures match approved English and four-locale placeholders", () => {
  assert.equal(Object.keys(expected).length, 9);
  assert.deepEqual(Object.keys(FORMA_OUTPUT_DELIVERY_MESSAGES).sort(), ["ar", "en", "fr", "ja"]);
  for (const [key, fallback] of Object.entries(expected)) {
    assert.equal(english(key), fallback, key);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      const text = messages[`output.delivery.${key}`];
      assert.ok(text?.trim(), `${locale}.${key}`);
      assert.deepEqual(slots(text), slots(fallback), `${locale}.${key}`);
      assert.doesNotMatch(text, /https?:\/\/|[0-9٠-٩۰-۹]/u, `${locale}.${key}: no invented route limit or destination`);
      if (locale !== "en") assert.notEqual(text, fallback, `${locale}.${key}`);
    }
  }
});

test("owed-target guidance covers required and already-owed optional work without sending viewers to an absent action", () => {
  for (const key of ["owedTargetNeedsPlan", "owedTargetNeedsAuthor"]) {
    assert.match(english(key), /^This target is still owed, but it is excluded from this plan’s generation selection\./u);
    assert.doesNotMatch(english(key), /This optional target|This required target/u);
  }
  assert.match(english("owedTargetNeedsAuthor"), /someone with permission to edit this Document/u);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    const review = messages["output.delivery.reviewPlan"];
    assert.ok(messages["output.delivery.owedTargetNeedsPlan"].includes(review), `${locale}: actual author action label`);
    assert.ok(!messages["output.delivery.owedTargetNeedsAuthor"].includes(review), `${locale}: no fictional viewer navigation`);
    assert.notEqual(messages["output.delivery.owedTargetNeedsPlan"], messages["output.delivery.optionalTargetNeedsPlan"]);
    assert.notEqual(messages["output.delivery.owedTargetNeedsAuthor"], messages["output.delivery.optionalTargetNeedsAuthor"]);
  }
});

test("removing the target filter is explicitly a local preview and preserves which work is owed", () => {
  assert.equal(english("planIncludeCommittedTargets"), "Include all required and already selected optional targets in this plan");
  const help = english("planTargetFilterHelp");
  assert.match(help, /Required work and already selected optional work remain owed/u);
  assert.match(help, /removes this filter only in the local preview/u);
  assert.match(help, /optional work that is not owed stays off/u);
  assert.match(help, /Review the preview and confirm separately/u);
  const staged = english("planTargetFilterStaged");
  assert.match(staged, /local preview now includes all required and already selected optional targets for generation checks/u);
  assert.match(staged, /The work owed is unchanged/u);
  assert.match(staged, /Review it and confirm separately; no work was authorized or started/u);
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.notEqual(messages["output.delivery.planTargetFilterStaged"], messages["output.delivery.confirmed"]);
    assert.deepEqual(slots(messages["output.delivery.planTargetFilterHelp"]), []);
    assert.deepEqual(slots(messages["output.delivery.planTargetFilterStaged"]), []);
  }
});

test("generation-selection preview counts use supplied localized values and never impose an execution limit", () => {
  assert.deepEqual(slots(english("planGenerationSelectionPreview")), ["selected", "total"]);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    const format = new Intl.NumberFormat(locale);
    for (const [selected, total] of [[0, 1], [1, 3], [3, 3]]) {
      const values = { selected: format.format(selected), total: format.format(total) };
      const rendered = messages["output.delivery.planGenerationSelectionPreview"].replace(/\{(selected|total)\}/gu, (_, slot) => values[slot]);
      assert.ok(rendered.includes(values.selected), `${locale}: supplied selected count`);
      assert.ok(rendered.includes(values.total), `${locale}: supplied total count`);
      assert.deepEqual(slots(rendered), []);
    }
  }
});

test("generation-check markers and locked optional controls do not withdraw agreed work", () => {
  assert.equal(english("planTargetIncludedForChecks"), "Included for generation checks.");
  assert.equal(english("planTargetExcludedFromChecks"), "Excluded from generation checks; any agreed work is still owed.");
  assert.match(english("optionalTargetFilterLocked"), /work already owed under this target filter/u);
  assert.match(english("optionalTargetFilterLocked"), /Remove the filter using the action below before changing optional choices/u);
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.notEqual(messages["output.delivery.planTargetIncludedForChecks"], messages["output.delivery.planTargetExcludedFromChecks"]);
  }
  assert.equal(english("optionalTargetNeedsPlan"), "This optional target is not selected in the confirmed delivery plan. Use Review delivery plan to select it before checking generation.");
  assert.equal(english("optionalTargetNeedsAuthor"), "This optional target is not selected in the confirmed delivery plan. Ask someone with permission to edit this Document to select it before checking generation.");
});
