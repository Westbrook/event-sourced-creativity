import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

const expected = JSON.parse(readFileSync(new URL("./fixtures/output-delivery-governance-copy.json", import.meta.url), "utf8"));
const slots = (text) => [...text.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort();
const english = (key) => FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${key}`];

test("all nine governed-source disclosures match frozen English and four-locale placeholders", () => {
  assert.equal(Object.keys(expected).length, 9);
  assert.deepEqual(Object.keys(FORMA_OUTPUT_DELIVERY_MESSAGES).sort(), ["ar", "en", "fr", "ja"]);
  for (const [id, fallback] of Object.entries(expected)) {
    assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[id], fallback);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.ok(messages[id]?.trim(), `${locale}.${id}`);
      assert.deepEqual(slots(messages[id]), slots(fallback), `${locale}.${id}`);
      assert.doesNotMatch(messages[id], /https?:\/\//u);
      assert.doesNotMatch(messages[id], /[0-9٠-٩۰-۹]/u, "metadata limits must not be invented in static copy");
      if (locale !== "en") assert.notEqual(messages[id], fallback);
    }
  }
});

test("the capture limit is optional database-work metadata, never a package total or depth bound", () => {
  assert.deepEqual(slots(english("governedCaptureLimit")), ["limit"]);
  assert.match(english("governedCaptureLimit"), /database-work limit, not a package count or nesting-depth limit/);
  assert.equal(english("governedCaptureUnknown"), "The database capture-batch limit was not supplied.");
  assert.match(english("governedSourcesUnavailable"), /list is unavailable/);
  assert.match(english("governedSourcesIncomplete"), /partial list of authorized source labels/);
  assert.match(english("governedSourcesIncomplete"), /not the complete governed-source inventory/);
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.notEqual(messages["output.delivery.governedSourcesUnavailable"], messages["output.delivery.governedSourcesIncomplete"]);
    assert.notEqual(messages["output.delivery.governedCaptureUnknown"], messages["output.delivery.governedCaptureLimit"]);
  }
});

test("source checks remain required for owned actions while all work and provenance are retained", () => {
  assert.match(english("governedVerificationActions"), /Matching, content review, exports, and exact-file downloads also require these source checks/);
  assert.match(english("governedVerificationActions"), /Owned uploads do not bypass them/);
  assert.match(english("governedVerificationRetained"), /full assignment, saved plans, previous results, and spending history remain/);
  assert.match(english("governedVerificationRetained"), /Confirming structure does not verify sources or make delivery ready/);
  assert.match(english("governedVerificationRemedy"), /Refresh only rechecks the state; it does not increase capacity/);
  assert.match(english("governedVerificationRemedy"), /Preserve source and origin records/);
  assert.match(english("governedVerificationRemedy"), /flattening or deleting origin records is not a valid workaround/);
});

test("governance capacity has a distinct code-only message without interpolating private labels or a batch count", () => {
  const descriptor = outputDeliveryMessageDescriptor("output_source_governance_capacity_exceeded", {
    captureBatchLimit: 2,
    sources: [{ blockId: "private-id", label: "Private authored source label" }],
    sourcesComplete: false,
  });
  assert.equal(descriptor.known, true);
  assert.deepEqual(descriptor.values, {});
  assert.equal(
    FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id],
    "This route cannot fully verify the governed sources within the pilot’s verification capacity. Inspect this Document’s governed sources and contact a workspace administrator.",
  );
  for (const code of ["output_source_governance_unavailable", "output_source_governance_cycle", "context_source_evidence_capacity_exceeded", "context_source_evidence_unavailable"]) {
    const other = outputDeliveryMessageDescriptor(code);
    assert.equal(other.known, true, code);
    assert.notEqual(other.id, descriptor.id, code);
  }
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages[descriptor.id]?.trim(), locale);
    assert.deepEqual(slots(messages[descriptor.id]), []);
    assert.doesNotMatch(messages[descriptor.id], /[0-9٠-٩۰-۹]|private-id|Private authored source label|https?:\/\//u);
    if (locale !== "en") assert.notEqual(messages[descriptor.id], FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id]);
  }
});
