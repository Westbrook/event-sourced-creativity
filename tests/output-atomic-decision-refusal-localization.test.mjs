import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { OUTPUT_DELIVERY_RUNTIME_CODES, outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

test("an atomic refusal can concern requirements, access, or execution budget without asserting a revision changed", () => {
  const code = "output_revision_or_authority_changed";
  const descriptor = outputDeliveryMessageDescriptor(code, { remainingBudget: 0, targetCount: 256, private: "Private authored text" });
  assert.equal(descriptor.known, true);
  assert.equal(descriptor.id, "output.delivery.message.atomicDecisionRefused");
  assert.deepEqual(descriptor.values, {}, "this code does not disclose a measured budget or interpolate authored data");
  const expected = "This action could not be approved under the current requirements, access, or available execution budget. Keep your draft and recorded work. Refresh the current state; for generation, review the selected work and budget before another explicit attempt.";
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[descriptor.id], expected);
  assert.match(expected, /Keep your draft and recorded work/);
  assert.match(expected, /Refresh the current state; for generation, review the selected work and budget before another explicit attempt/);
  assert.doesNotMatch(expected, /Document or your access changed|before saving|no charges|nothing was charged|nothing was committed|no changes were made|refresh will fix|Your draft and recorded work are retained|Refresh availability and cost checks/iu);
  for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(messages[descriptor.id]?.trim(), locale);
    assert.doesNotMatch(messages[descriptor.id], /\{[^{}]+\}|Private authored text|256|٢٥٦/u);
    if (locale !== "en") assert.notEqual(messages[descriptor.id], expected, locale);
  }
});

test("other revision-change codes retain their existing descriptor and all four translations", () => {
  const expected = {
    en: "The Document or your access changed. Keep your draft, refresh, and compare the latest requirements before saving again.",
    fr: "Le document ou votre accès a changé. Conservez votre brouillon, actualisez et comparez les dernières exigences avant d’enregistrer à nouveau.",
    ar: "تغيّر المستند أو صلاحياتك. احتفظ بمسودتك وحدّث البيانات وقارن أحدث المتطلبات قبل الحفظ مجددًا.",
    ja: "ドキュメントまたはアクセス権が変更されました。下書きを保持して更新し、最新の要件と比較してから再度保存してください。",
  };
  for (const code of ["output_revision_conflict", "output_execution_context_changed", "output_source_changed_during_read", "output_private_write_guard_failed"]) {
    const descriptor = outputDeliveryMessageDescriptor(code);
    assert.equal(descriptor.known, true, code);
    assert.equal(descriptor.id, "output.delivery.message.revisionChanged", code);
    for (const [locale, text] of Object.entries(expected)) assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES[locale][descriptor.id], text, `${locale}.${code}`);
  }
});

test("the atomic refusal reuses the existing error code without adding a runtime inventory entry", () => {
  const code = "output_revision_or_authority_changed";
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/output-delivery-runtime-codes.json", import.meta.url), "utf8"));
  assert.equal(fixture.filter((value) => value === code).length, 1);
  assert.equal(OUTPUT_DELIVERY_RUNTIME_CODES.filter((value) => value === code).length, 1);
  assert.ok(!fixture.includes("output_atomic_decision_refused"), "the descriptor name is not a new server contract");
});
