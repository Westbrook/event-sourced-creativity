import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_REQUIREMENT_MESSAGES } from "../src/components/design-system/locales/output-requirement-messages.ts";
import { FORMA_OUTPUT_DELIVERY_MESSAGES, outputDeliveryLabelKey } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

const slots = (text) => [...text.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort();

test("label-limit help, errors, and preserved-name warning have matching four-locale placeholders", () => {
  const expected = {
    labelLimitHelp: "Names can contain up to {max} characters. Original wording is preserved separately.",
    "error.labelLimit": "Use a name of at most {max} characters without control or formatting characters.",
    invalidLabelsPreserved: "Some saved names exceed the supported label limits. All wording and decisions are preserved; edit the marked names before confirming.",
  };
  for (const [key, english] of Object.entries(expected)) {
    const id = `output.requirement.${key}`;
    assert.equal(FORMA_OUTPUT_REQUIREMENT_MESSAGES.en[id], english);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_REQUIREMENT_MESSAGES)) {
      assert.ok(messages[id]?.trim(), `${locale}.${key}`);
      assert.deepEqual(slots(messages[id]), slots(english), `${locale}.${key}`);
      if (locale !== "en") assert.notEqual(messages[id], english);
    }
  }
  for (const messages of Object.values(FORMA_OUTPUT_REQUIREMENT_MESSAGES)) {
    assert.match(messages["output.requirement.labelLimitHelp"].replace("{max}", "240"), /240/u);
    assert.match(messages["output.requirement.error.labelLimit"].replace("{max}", "240"), /240/u);
  }
});

test("all 28 conflict and content-count messages exist in each locale without English fallback", () => {
  const keys = ["planLoadedLatest", "planReviewUpdated", "planIncluded", "planNotIncluded", "planRetained", "planProposalChanged", "planComparisonHelp", "planSourceChanged", "planSpecChanged", "planPreviouslyReviewed", "planLatest", "planLocal", "planRawDraft", "planAcknowledge", "planDiscard", "planReapply", "planMode", "planModeUnresolved", "planModeExact", "planModeFlexible", "planExactCount", "planMinimum", "planMaximum", "planInvalidCount", "planNumericHelp", "planResolvedRules", "planAimNone", "planPreviewInvalid"];
  assert.equal(keys.length, 28);
  for (const key of keys) {
    const id = `output.delivery.${key}`;
    const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en[id];
    assert.ok(english);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.ok(messages[id]?.trim(), `${locale}.${key}`);
      assert.deepEqual(slots(messages[id]), slots(english), `${locale}.${key}`);
      if (locale !== "en") assert.notEqual(messages[id], english);
    }
  }
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.planComparisonHelp"], /Confirmation is blocked/);
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.planComparisonHelp"], /No work starts/);
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.planRetained"], /confirm separately/);
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.planInvalidCount"], /Blank exact counts are not zero/);
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.planNumericHelp"], /blank aim means no attempt aim, not zero/);
});

test("new domain and portable scope-history errors have explicit localized corrective messages", () => {
  const codes = ["plan_inventory_limit_exceeded", "label_too_long", "label_control_characters", "label_required", "invalid_label_type", "duplicate_plan_identity", "invalid_output_delivery_scope_history_flag", "invalid_output_delivery_scope_amendments", "invalid_output_delivery_scope_amendment", "output_delivery_scope_history_conflict", "invalid_output_delivery_scope_amendment_date", "invalid_output_delivery_scope_amendment_reason", "invalid_output_delivery_scope_amendment_actor_role", "output_delivery_empty_scope_amendment", "output_delivery_scope_history_too_large", "invalid_output_delivery_id", "invalid_output_delivery_part_file_limit"];
  for (const code of codes) {
    const descriptor = outputDeliveryMessageDescriptor(code);
    assert.equal(descriptor.known, true, code);
    for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) assert.ok(messages[descriptor.id]?.trim(), code);
  }
  const inventory = outputDeliveryMessageDescriptor("plan_inventory_limit_exceeded");
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[inventory.id], "The complete assignment exceeds the current planning inventory limit. All requested work is preserved; review its organization before confirming.");
  const history = outputDeliveryMessageDescriptor("output_delivery_scope_history_conflict");
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en[history.id], /withdrawn work must not be reported as completed/);
});

test("completion for amended scope is visibly distinct from complete and partial delivery", () => {
  const complete = outputDeliveryLabelKey("delivery", "complete");
  const amended = outputDeliveryLabelKey("delivery", "complete_for_amended_scope");
  const partial = outputDeliveryLabelKey("delivery", "partial");
  assert.equal(new Set([complete, amended, partial]).size, 3);
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${amended}`], "Complete for the amended scope");
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.notEqual(messages[`output.delivery.${complete}`], messages[`output.delivery.${amended}`]);
    assert.notEqual(messages[`output.delivery.${partial}`], messages[`output.delivery.${amended}`]);
    assert.doesNotMatch(messages[`output.delivery.${amended}`], /complete_for_amended_scope/u);
  }
  assert.equal(outputDeliveryLabelKey("delivery", "future_status"), "state.unknown");
});

test("remaining-action count and older-file custody notice are localized without hiding unresolved work", () => {
  const id = "output.delivery.remainingActions";
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[id], "Show {count} remaining actions, including unresolved groups");
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.deepEqual(slots(messages[id]), ["count"], locale);
    if (locale !== "en") assert.notEqual(messages[id], FORMA_OUTPUT_DELIVERY_MESSAGES.en[id]);
  }
  const legacy = outputDeliveryMessageDescriptor("output_legacy_custody_recheck_required");
  assert.equal(legacy.known, true);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages[legacy.id]?.trim(), locale);
    if (locale !== "en") assert.notEqual(messages[legacy.id], FORMA_OUTPUT_DELIVERY_MESSAGES.en[legacy.id]);
  }
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en[legacy.id], /earlier records are preserved/);
});
