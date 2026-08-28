import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";

const expected = JSON.parse(readFileSync(new URL("./fixtures/output-delivery-source-receipt-copy.json", import.meta.url), "utf8"));
const slots = (text) => [...text.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort();
const english = (key) => FORMA_OUTPUT_DELIVERY_MESSAGES.en[`output.delivery.${key}`];

test("all 51 frozen source-readiness and receipt messages preserve four-locale interpolation contracts", () => {
  assert.equal(Object.keys(expected).length, 51);
  assert.deepEqual(Object.keys(FORMA_OUTPUT_DELIVERY_MESSAGES).sort(), ["ar", "en", "fr", "ja"]);
  for (const [id, fallback] of Object.entries(expected)) {
    assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[id], fallback, id);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.ok(messages[id]?.trim(), `${locale}.${id}`);
      assert.deepEqual(slots(messages[id]), slots(fallback), `${locale}.${id}`);
      assert.doesNotMatch(messages[id], /https?:\/\//u, "no invented support URL");
      if (locale !== "en") assert.notEqual(messages[id], fallback, `${locale}.${id}`);
    }
  }
});

test("unknown source totals and incomplete source-name lists have different explanations", () => {
  assert.match(english("sourceDistinctUnknown"), /unknown; it is not assumed to be zero/);
  assert.match(english("sourceNamesIncomplete"), /reference names are not shown/);
  assert.deepEqual(slots(english("sourceNamesIncomplete")), ["count"]);
  assert.deepEqual(slots(english("nativeCapacityExceeded")), ["count", "limit"]);
  assert.deepEqual(slots(english("sourceRouteLimit")), ["count"]);
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.notEqual(messages["output.delivery.sourceDistinctUnknown"], messages["output.delivery.sourceNamesUnknown"]);
    assert.notEqual(messages["output.delivery.sourceOwnedRoute"], messages["output.delivery.sourceNativeRoute"]);
  }
});

test("saved structure never claims source verification or an automatic capacity repair", () => {
  assert.equal(english("savedPlanSourcesUnverified"), "Saved plan; source checks are not verified");
  assert.match(english("sourceChecksMeaning"), /do not fact-check or approve content/);
  assert.match(english("sourceChecksMeaning"), /edit and confirm structure while uploads, file use, generation, and delivery remain blocked/);
  assert.match(english("nativeCapacityExceeded"), /Reconfirming the plan does not change either limit/);
  assert.match(english("uploadFileRetained"), /Changing the revision alone does not resolve capacity, rights, evidence, or inspection failures/);
  assert.match(english("uploadRevisionNotRefreshed"), /no upload or revision change was attempted/);
});

test("receipt actions distinguish persisted reconciliation, uncertainty, and copying without a new provider request", () => {
  assert.equal(english("checkSavedReceipt"), "Check saved receipt · no generation");
  assert.match(english("receiptCheckExplanation"), /only evidence already stored by Forma/);
  assert.match(english("receiptCheckExplanation"), /does not contact a provider, generate work, release an unknown charge, or alter the required output/);
  assert.match(english("operationReceiptStillUnknown"), /^The original receipt check could not establish provider acceptance or cost\./);
  assert.match(english("operationReceiptStillUnknown"), /Review the refreshed operation and accounting for the current state\./);
  assert.match(english("operationReceiptStillUnknown"), /If acceptance or cost remains unknown, do not submit a replacement; copy the technical receipt and ask an authorized operator to investigate\.$/);
  assert.doesNotMatch(english("operationReceiptStillUnknown"), /Its reservation remains held|cost is still unknown/);
  assert.match(english("operationReceiptStillUnknown"), /do not submit a replacement/);
  assert.match(english("operationReceiptKnown"), /No provider request was sent/);
  assert.match(english("operationReceiptNoChange"), /no new work was started/);
  assert.match(english("operationReceiptPrivacy"), /not source text or generation inputs/);
  assert.match(english("operationReceiptCopied"), /It was not sent to anyone/);
  assert.match(english("receiptEscalation"), /no self-service override for an unknown charge/);
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.equal(new Set(["operationReceiptKnown", "operationReceiptStillUnknown", "operationReceiptNoChange"].map((key) => messages[`output.delivery.${key}`])).size, 3);
  }
});

test("source count labels work for zero, one, and many without changing route limits or controller fallbacks", () => {
  const labels = {
    sourceReferenceCount: "Imported-source references: {count}.",
    sourceDistinctCount: "Distinct stored source files: {count}.",
    sourceRouteLimit: "Limit for distinct imported source files: {count}",
    nativeCapacityExceeded: "Distinct imported source files in this Document: {count}. The current native route limit is {limit}. Owned uploads and reads have their own limit. Reconfirming the plan does not change either limit.",
  };
  const controller = readFileSync(new URL("../src/components/forma-output-requirements.ts", import.meta.url), "utf8");
  for (const [key, fallback] of Object.entries(labels)) {
    assert.equal(english(key), fallback);
    assert.ok(controller.includes(`#t(${JSON.stringify(key)}, ${JSON.stringify(fallback)}`), `controller fallback for ${key}`);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      const template = messages[`output.delivery.${key}`];
      assert.match(template, /[:：]\s*\{count\}/u, `${locale}.${key} uses a count-neutral label`);
      assert.deepEqual(slots(template), slots(fallback));
      for (const count of [0, 1, 2]) {
        const rendered = template.replaceAll("{count}", String(count)).replaceAll("{limit}", "4");
        assert.ok(rendered.includes(String(count)));
        assert.deepEqual(slots(rendered), []);
        assert.doesNotMatch(rendered, /\b1 (?:imported-source references|distinct stored source files|distinct imported source files)\b/u);
      }
    }
  }
});
