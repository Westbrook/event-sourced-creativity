import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES, outputDeliveryLabelKey } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { FORMA_OUTPUT_DELIVERY_CYCLE_MESSAGES } from "../src/components/design-system/locales/output-delivery-cycle-messages.ts";
import { FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES, OUTPUT_DELIVERY_RUNTIME_CODES, outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

const root = process.env.OUTPUT_DELIVERY_SOURCE_ROOT || fileURLToPath(new URL("../", import.meta.url));
const placeholders = (text) => [...text.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort();
const allCodes = JSON.parse(await readFile(new URL("./fixtures/output-delivery-runtime-codes.json", import.meta.url), "utf8"));

test("all Output runtime and reviewed UI messages are present in the four merged locale catalogs", () => {
  const keys = Object.keys(FORMA_OUTPUT_DELIVERY_MESSAGES.en);
  assert.ok(keys.length >= 390);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.deepEqual(Object.keys(messages), keys, locale);
    for (const key of keys) {
      assert.ok(messages[key]?.trim(), `${locale}.${key}`);
      assert.deepEqual(placeholders(messages[key]), placeholders(FORMA_OUTPUT_DELIVERY_MESSAGES.en[key]), `${locale}.${key}`);
    }
    for (const bundle of [FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES, FORMA_OUTPUT_DELIVERY_CYCLE_MESSAGES]) {
      for (const [key, value] of Object.entries(bundle[locale])) assert.equal(messages[key], value, `${locale} merges ${key}`);
    }
  }
  const overlap = Object.keys(FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES.en).filter((key) => Object.hasOwn(FORMA_OUTPUT_DELIVERY_CYCLE_MESSAGES.en, key));
  assert.deepEqual(overlap, []);
});

test("every literal reviewed controller message has exact authoritative English and unchanged placeholders", async () => {
  const source = await readFile(resolve(root, "src/components/forma-output-requirements.ts"), "utf8");
  const calls = [...source.matchAll(/#t\("([^"\n]+)",\s*("(?:\\.|[^"\\])*")/gu)];
  assert.ok(calls.length >= 160);
  for (const [, suffix, literal] of calls) {
    assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${suffix}`], JSON.parse(literal), suffix);
  }
});

test("all recorded API, domain, preflight, native-result, and inspector codes resolve to localized messages", () => {
  const codes = new Set(OUTPUT_DELIVERY_RUNTIME_CODES);
  assert.equal(codes.size, OUTPUT_DELIVERY_RUNTIME_CODES.length);
  assert.ok(allCodes.length >= 480);
  assert.ok(allCodes.includes("output_source_governance_proof_too_large"), "the governed SQL proof-size code remains in recorded runtime coverage");
  for (const code of allCodes) {
    assert.ok(codes.has(code), `${code} was assigned a message explicitly`);
    const descriptor = outputDeliveryMessageDescriptor(code);
    assert.equal(descriptor.known, true, code);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) assert.ok(messages[descriptor.id]?.trim(), `${locale}.${code}`);
  }
});

test("unknown server values never become prose, template IDs, or accidental approval disclosures", () => {
  const privateText = "Customer authored source {private} <script> and file name";
  for (const code of [privateText, "__proto__", "constructor", "future_provider_route", null, undefined, {}, 7]) {
    const descriptor = outputDeliveryMessageDescriptor(code, { private: privateText });
    assert.equal(descriptor.known, false);
    assert.equal(descriptor.id, "output.delivery.message.unknown");
    assert.deepEqual(descriptor.values, {});
    for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) assert.ok(!messages[descriptor.id].includes(privateText));
  }
  const descriptor = outputDeliveryMessageDescriptor("output_native_slides_ready", { unused: privateText });
  assert.equal(descriptor.known, true);
  assert.deepEqual(descriptor.values, {}, "unused response data and authored text do not leak into messages");
});

test("all native availability reasons and source-transfer disclosures are translated before paid approval", () => {
  const reasons = ["output_native_target_not_selected", "output_native_document_scope_required", "output_native_medium_adoption_only", "output_native_planner_unconfigured", "output_native_planner_price_unknown", "output_native_source_required", "output_native_slide_count_policy_required", "output_native_slide_count_unsupported", "output_native_slide_source_unresolved", "output_native_image_ratio_required", "output_native_image_ratio_unsupported", "output_native_reference_input_unpriced", "output_native_image_adapter_unsupported", "output_native_image_provider_unavailable", "output_native_image_price_unknown", "output_native_slides_ready", "output_native_image_ready"];
  const transfers = ["output_transfer_none_owned_adoption", "output_transfer_document_after_authorization", "output_transfer_none_authorized"];
  for (const code of [...reasons, ...transfers, "output_native_image_allowance_verified"]) {
    const descriptor = outputDeliveryMessageDescriptor(code);
    assert.equal(descriptor.known, true, code);
    for (const locale of ["fr", "ar", "ja"]) assert.notEqual(FORMA_OUTPUT_DELIVERY_MESSAGES[locale][descriptor.id], FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id], `${locale}.${code}`);
  }
  const text = (code) => FORMA_OUTPUT_DELIVERY_MESSAGES.en[outputDeliveryMessageDescriptor(code).id];
  assert.match(text("output_transfer_document_after_authorization"), /After you authorize and start/);
  assert.match(text("output_transfer_document_after_authorization"), /This preflight sends nothing/);
  assert.match(text("output_transfer_document_after_authorization"), /not a guarantee of provider billing/);
  assert.match(text("output_native_reference_input_unpriced"), /No requested reference is omitted/);
  assert.match(text("output_native_image_allowance_verified"), /twice the documented output-token estimate/);
  assert.match(text("output_native_image_allowance_verified"), /no further request is allowed after an overrun or uncertain response/);
});

test("recovery copy preserves retained charges and distinguishes finished jobs from accepted assignments", () => {
  for (const status of ["queued", "running", "committing", "completed", "partial", "failed", "canceled"]) {
    const key = outputDeliveryLabelKey("job", status);
    assert.notEqual(key, "state.unknown", status);
    assert.ok(FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${key}`]);
  }
  assert.equal(outputDeliveryLabelKey("grant", "expired"), "state.expired");
  assert.equal(outputDeliveryLabelKey("operation", "canceled"), "state.cancelled");
  assert.notEqual(outputDeliveryLabelKey("job", "completed"), "state.accepted");
  const english = FORMA_OUTPUT_DELIVERY_MESSAGES.en;
  assert.match(english["output.delivery.authorizationExpired"], /including repairs/);
  assert.match(english["output.delivery.authorizationExpired"], /Existing submissions and their costs remain recorded/);
  assert.match(english["output.delivery.amendedScopeQualification"], /Withdrawn work is not completed work/);
  assert.match(english["output.delivery.reusePriorReviewCaveat"], /does not create a new approval/);
  assert.match(english["output.delivery.packageParts"], /whole assignment/);
  assert.match(english["output.delivery.uploadRestaged"], /No file was uploaded automatically/);
});

test("unsupported formats, invalid bytes, rights failures, and uncertain costs have different corrective messages", () => {
  const groups = ["output_asset_format_unsupported", "png_crc_mismatch", "owned_file_rights_attestation_required", "reconcile_previous_output_cost_before_alternative", "output_scope_amendment_reason_required", "output_active_commitment_requires_cancellation"];
  const ids = groups.map((code) => outputDeliveryMessageDescriptor(code).id);
  assert.equal(new Set(ids).size, groups.length, "different user decisions are not flattened into one error");
  for (const code of ["output_inspection_not_acceptance", "output_png_visual_review_required", "output_jpeg_decode_review_required", "output_wav_listening_review_required", "output_mp3_listening_review_required", "output_mp4_playback_review_required", "output_pptx_content_review_required"]) assert.equal(outputDeliveryMessageDescriptor(code).known, true, code);
});
