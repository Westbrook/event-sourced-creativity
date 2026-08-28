import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";

const expected = {
  amendmentReasonPrivacy: "This exact reason appears in every downloaded JSON and CSV manifest. Use only text that is safe to share with the recipients.",
  preflightRetired: "This offer no longer matches the current plan, source, or selected work. Check availability and cost again before authorizing work. Nothing new was authorized or started.",
  recordedDisclosureChanged: "This recorded authorization does not match the current plan, source, or target scope. Its history and charges remain, but it cannot start work for the current scope.",
  preflightSelectionLimit: "Availability and cost checks support at most {limit} targets at a time. Checking a smaller selection does not remove any work from the delivery plan.",
  preflightSelectionOverLimit: "{count} targets are selected, exceeding the per-check limit of {limit}. Deselect targets for this check. The full delivery assignment remains unchanged.",
  optionalTargetNeedsPlan: "This optional target is not selected in the confirmed delivery plan. Use Review delivery plan to select it before checking generation.",
  optionalTargetNeedsAuthor: "This optional target is not selected in the confirmed delivery plan. Ask someone with permission to edit this Document to select it before checking generation.",
  amendmentReasonInvalid: "Use at most {limit} characters and remove invisible control or formatting characters from the reason. Tabs and line breaks are allowed. Your text is retained for correction; confirmation is blocked until it is valid.",
};
const slots = (text) => [...text.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort();
const english = (key) => FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${key}`];

test("the eight approved plan and preflight disclosures match English and all four locale interpolation contracts", () => {
  assert.equal(Object.keys(expected).length, 8);
  assert.deepEqual(Object.keys(FORMA_OUTPUT_DELIVERY_MESSAGES).sort(), ["ar", "en", "fr", "ja"]);
  for (const [key, fallback] of Object.entries(expected)) {
    const id = `output.delivery.${key}`;
    assert.equal(english(key), fallback, key);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.ok(messages[id]?.trim(), `${locale}.${key}`);
      assert.deepEqual(slots(messages[id]), slots(fallback), `${locale}.${key}`);
      assert.doesNotMatch(messages[id], /https?:\/\//u);
      if (locale !== "en") assert.notEqual(messages[id], fallback, `${locale}.${key}`);
    }
  }
});

test("the reason privacy warning names both downloaded manifests without interpolating authored text", () => {
  assert.match(english("amendmentReasonPrivacy"), /This exact reason appears in every downloaded JSON and CSV manifest/);
  assert.match(english("amendmentReasonPrivacy"), /safe to share with the recipients/);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    const text = messages["output.delivery.amendmentReasonPrivacy"];
    assert.ok(text.includes("JSON") && text.includes("CSV"), locale);
    assert.deepEqual(slots(text), [], `${locale}: authored reasons are never translation parameters`);
  }
});

test("invalid reason guidance preserves raw text for correction and allows tabs and line breaks", () => {
  const key = "output.delivery.amendmentReasonInvalid";
  assert.match(english("amendmentReasonInvalid"), /remove invisible control or formatting characters/);
  assert.match(english("amendmentReasonInvalid"), /Tabs and line breaks are allowed/);
  assert.match(english("amendmentReasonInvalid"), /text is retained for correction; confirmation is blocked until it is valid/);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.deepEqual(slots(messages[key]), ["limit"], locale);
    assert.doesNotMatch(messages[key], /2000|2,000|٢٠٠٠|٢٬٠٠٠/u, `${locale}: use the policy limit supplied by the controller`);
    assert.notEqual(messages[key], messages["output.delivery.amendmentReasonPrivacy"]);
  }
});

test("stale offers authorize no new work while recorded stale authorizations retain their history and charges", () => {
  assert.match(english("preflightRetired"), /current plan, source, or selected work/);
  assert.match(english("preflightRetired"), /Check availability and cost again before authorizing work/);
  assert.match(english("preflightRetired"), /Nothing new was authorized or started/);
  assert.match(english("recordedDisclosureChanged"), /history and charges remain/);
  assert.match(english("recordedDisclosureChanged"), /cannot start work for the current scope/);
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.notEqual(messages["output.delivery.preflightRetired"], messages["output.delivery.recordedDisclosureChanged"]);
    assert.deepEqual(slots(messages["output.delivery.preflightRetired"]), []);
    assert.deepEqual(slots(messages["output.delivery.recordedDisclosureChanged"]), []);
  }
});

test("per-check selection copy uses supplied localized counts and retains the complete delivery assignment", () => {
  assert.deepEqual(slots(english("preflightSelectionLimit")), ["limit"]);
  assert.deepEqual(slots(english("preflightSelectionOverLimit")), ["count", "limit"]);
  assert.match(english("preflightSelectionLimit"), /Checking a smaller selection does not remove any work from the delivery plan/);
  assert.match(english("preflightSelectionOverLimit"), /Deselect targets for this check/);
  assert.match(english("preflightSelectionOverLimit"), /full delivery assignment remains unchanged/);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    const format = new Intl.NumberFormat(locale);
    const values = { count: format.format(257), limit: format.format(256) };
    for (const key of ["preflightSelectionLimit", "preflightSelectionOverLimit"]) {
      const text = messages[`output.delivery.${key}`];
      assert.doesNotMatch(text, /256|257|1000|٢٥٦|٢٥٧|١٠٠٠/u, `${locale}.${key}: limits must not be hardcoded`);
      const rendered = text.replace(/\{(count|limit)\}/gu, (_, slot) => values[slot]);
      assert.ok(rendered.includes(values.limit), `${locale}.${key}`);
      if (key === "preflightSelectionOverLimit") assert.ok(rendered.includes(values.count), locale);
      assert.deepEqual(slots(rendered), []);
    }
  }
});

test("optional-target guidance names the actual plan control for authors and requests an editor for viewers", () => {
  assert.match(english("optionalTargetNeedsPlan"), /not selected in the confirmed delivery plan/);
  assert.match(english("optionalTargetNeedsAuthor"), /someone with permission to edit this Document/);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    const control = messages["output.delivery.reviewPlan"];
    const author = messages["output.delivery.optionalTargetNeedsPlan"];
    const viewer = messages["output.delivery.optionalTargetNeedsAuthor"];
    assert.ok(author.includes(control), `${locale}: author instruction must match the visible action`);
    assert.ok(!viewer.includes(control), `${locale}: viewer must not be sent to a missing action`);
    assert.notEqual(author, viewer, locale);
    assert.deepEqual(slots(author), []);
    assert.deepEqual(slots(viewer), []);
  }
});
