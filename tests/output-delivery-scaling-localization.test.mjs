import assert from "node:assert/strict";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

const codes = [
  "output_read_model_unavailable",
  "output_read_model_rows_incomplete",
  "output_read_model_private_evidence_incomplete",
  "output_custody_inventory_incomplete",
  "output_custody_inventory_unavailable",
  "output_custody_inventory_changed",
  "output_legacy_custody_recheck_required",
  "output_delivery_package_needs_repreparation",
  "context_source_evidence_capacity_exceeded",
];

test("read and source-capacity guards resolve to distinct explicit messages in all four locales", () => {
  const ids = new Set();
  for (const code of codes) {
    const descriptor = outputDeliveryMessageDescriptor(code);
    assert.equal(descriptor.known, true, code);
    ids.add(descriptor.id);
    const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id];
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.ok(messages[descriptor.id]?.trim(), `${locale}.${code}`);
      assert.doesNotMatch(messages[descriptor.id], /\{[^{}]+\}/u);
      assert.ok(!messages[descriptor.id].includes(code), `${locale} must not render the machine code`);
      if (locale !== "en") assert.notEqual(messages[descriptor.id], english);
    }
  }
  assert.equal(ids.size, codes.length);
});

test("capacity is distinct from missing evidence and does not invent a limit or drop requested sources", () => {
  const capacity = outputDeliveryMessageDescriptor("context_source_evidence_capacity_exceeded", {
    limit: 4,
    sourceText: "Authored source content must never become a message parameter here.",
  });
  const missing = outputDeliveryMessageDescriptor("context_source_evidence_unavailable");
  assert.equal(missing.known, true);
  assert.notEqual(capacity.id, missing.id);
  assert.deepEqual(capacity.values, {});
  const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en[capacity.id];
  assert.match(english, /complete source and all Output requirements are retained/);
  assert.match(english, /each require their applicable route’s source checks/);
  for (const action of ["upload", "file matching", "review", "generation", "export", "download"]) assert.ok(english.toLowerCase().includes(action));
  assert.match(english, /Reconfirming does not raise limits/);
  assert.match(english, /Capacity blocks only actions whose own route limit is exceeded/);
  assert.match(english, /compare the numeric limits shown for each route/);
  assert.doesNotMatch(english, /remain blocked/);
  assert.match(english, /no sources are dropped/);
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.doesNotMatch(messages[capacity.id], /[0-9٠-٩۰-۹]/u);
  }
});

test("uncertain storage is not missing files and package re-preparation preserves the entire assignment", () => {
  const unavailable = outputDeliveryMessageDescriptor("output_custody_inventory_unavailable");
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en[unavailable.id], /does not prove that files are missing/);
  const legacy = outputDeliveryMessageDescriptor("output_legacy_custody_recheck_required");
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en[legacy.id], /earlier records are preserved/);
  const packageMessage = outputDeliveryMessageDescriptor("output_delivery_package_needs_repreparation");
  const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en[packageMessage.id];
  assert.match(english, /older part size/);
  assert.match(english, /Prepare a new package with supported part sizes/);
  assert.match(english, /full assignment and delivery history must remain included/);
});
