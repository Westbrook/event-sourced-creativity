import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES, outputDeliveryLabelKey, outputDeliveryProblemKey } from "../src/components/design-system/locales/output-delivery-messages.ts";

const sourceRoot = process.env.OUTPUT_DELIVERY_SOURCE_ROOT || fileURLToPath(new URL("../", import.meta.url));
const placeholders = (text) => [...text.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort();

test("Output delivery catalogs provide identical keys and unchanged interpolation placeholders", () => {
  const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en;
  assert.ok(Object.keys(english).length >= 125);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.deepEqual(Object.keys(messages), Object.keys(english), locale);
    assert.ok(Object.isFrozen(messages), `${locale} catalog is immutable`);
    for (const [key, source] of Object.entries(english)) {
      assert.ok(messages[key].trim(), `${locale}.${key} has translated text`);
      assert.deepEqual(placeholders(messages[key]), placeholders(source), `${locale}.${key}`);
      assert.doesNotMatch(messages[key], /&(?:amp|lt|gt|quot);|&#\d+;/u, `${locale}.${key} is not HTML-escaped`);
    }
  }
  for (const locale of ["fr", "ar", "ja"]) {
    for (const key of ["confirm", "authorize", "costCeiling", "reviewCoverage", "partialExplicit", "state.uncertain"]) {
      assert.notEqual(FORMA_OUTPUT_DELIVERY_MESSAGES[locale][`output.delivery.${key}`], english[`output.delivery.${key}`], `${locale}.${key} does not fall back to English`);
    }
  }
});

test("every literal Output controller message agrees with the authoritative English catalog", async () => {
  const source = await readFile(resolve(sourceRoot, "src/components/forma-output-requirements.ts"), "utf8");
  const calls = [...source.matchAll(/#t\("([^"\n]+)",\s*("(?:\\.|[^"\\])*")/gu)];
  assert.ok(calls.length >= 73, "the controller's literal calls were inspected");
  for (const [, suffix, literal] of calls) {
    const key = `output.delivery.${suffix}`;
    assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[key], JSON.parse(literal), key);
  }
});

test("all target state dimensions, grants, operations, and quantity units have plain-language labels", () => {
  const states = {
    execution: ["not_started", "queued", "running", "succeeded", "failed", "cancelled", "uncertain"],
    checks: ["not_checked", "running", "passed", "failed", "unknown", "unavailable"],
    review: ["not_reviewed", "pending", "accepted", "approved", "rejected", "changes_requested", "unknown"],
    freshness: ["current", "stale", "unknown"],
    availability: ["available", "missing", "inaccessible", "unknown"],
    capability: ["supported", "unsupported", "unknown"],
    grant: ["authorized", "active", "completed", "revoked", "exceeded"],
    operation: ["authorized", "queued", "running", "succeeded", "failed", "cancelled", "unavailable", "uncertain"],
    unit: ["presentation", "slide", "episode", "video", "image", "second", "document", "member"],
  };
  for (const [category, values] of Object.entries(states)) {
    for (const value of values) {
      const key = outputDeliveryLabelKey(category, value);
      if (value !== "unknown") assert.notEqual(key, "state.unknown", `${category}.${value}`);
      assert.notEqual(key, "unit.unknown", `${category}.${value}`);
      for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
        assert.ok(messages[`output.delivery.${key}`], `${locale}.${category}.${value}`);
      }
    }
  }
  for (const value of ["future_state", "__proto__", "constructor", null, undefined, {}, 0]) {
    assert.equal(outputDeliveryLabelKey("execution", value), "state.unknown");
    assert.equal(outputDeliveryLabelKey("unit", value), "unit.unknown");
  }
});

test("Output vocabulary and both component descriptions exist in all four locales", () => {
  const keys = [
    "context.output.label", "context.output.description", "context.output.prompt",
    "context.output.subtype.socialMediaImage", "context.output.subtype.socialMediaVideo",
    "context.output.subtype.executiveSummary", "context.output.subtype.customDeliverables",
    "component.forma-output-requirements.title", "component.forma-output-requirements.summary", "component.forma-output-requirements.usage",
    "component.forma-output-requirement-card.title", "component.forma-output-requirement-card.summary", "component.forma-output-requirement-card.usage",
  ];
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    for (const key of keys) assert.ok(messages[key]?.trim(), `${locale}.${key}`);
  }
});

test("an operations completion label never claims the whole assignment is accepted", () => {
  const completed = outputDeliveryLabelKey("grant", "completed");
  assert.equal(completed, "state.completed");
  assert.notEqual(completed, "complete");
  assert.notEqual(completed, "state.accepted");
  const source = FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${completed}`];
  assert.equal(source, "Operations finished");
});

test("stable file-check codes have translated explanations without rewriting unknown authored prose", () => {
  for (const code of ["asset_structure_unverified", "target_media_kind_mismatch", "required_aspect_ratio_unmeasured", "required_aspect_ratio_mismatch", "required_content_quantity_unmeasured", "required_content_quantity_mismatch", "required_coverage_unresolved"]) {
    const key = outputDeliveryProblemKey(code);
    assert.equal(key, `issue.${code}`);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) assert.ok(messages[`output.delivery.${key}`], `${locale}.${code}`);
  }
  for (const value of ["Customer {private} authored explanation", "__proto__", "constructor", null, {}]) assert.equal(outputDeliveryProblemKey(value), null);
});
