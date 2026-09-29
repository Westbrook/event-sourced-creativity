import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FORMA_OUTPUT_DELIVERY_MESSAGES } from "../src/components/design-system/locales/output-delivery-messages.ts";
import { outputDeliveryMessageDescriptor } from "../src/components/design-system/locales/output-delivery-runtime-messages.ts";

const expected = JSON.parse(readFileSync(new URL("./fixtures/output-generation-safety-copy.json", import.meta.url), "utf8"));
const slots = (text) => [...text.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]).sort();
const englishForCode = (code) => FORMA_OUTPUT_DELIVERY_MESSAGES.en[outputDeliveryMessageDescriptor(code).id];

test("the three numeric labels describe generation calls and preserve their interpolation contracts", () => {
  const terms = { en: "generation calls", fr: "appels de génération", ar: "توليد", ja: "生成呼び出し" };
  const requiredSlots = {
    "output.delivery.costCeiling": ["amount", "calls"],
    "output.delivery.targetCostLimit": ["amount", "calls"],
    "output.delivery.retainedCalls": ["maximum", "pending", "used"],
  };
  assert.equal(Object.keys(expected.uiMessages).length, 3);
  for (const [id, fallback] of Object.entries(expected.uiMessages)) {
    assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en[id], fallback, id);
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      assert.deepEqual(slots(messages[id]), requiredSlots[id], `${locale}.${id}`);
      assert.ok(messages[id].toLocaleLowerCase(locale).includes(terms[locale]), `${locale}.${id}`);
      assert.doesNotMatch(messages[id], /provider calls|appels fournisseur|プロバイダー呼び出し/u);
      if (locale !== "en") assert.notEqual(messages[id], fallback);
    }
  }
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.costCeiling"], /including bounded repairs\. Charges may remain even when validation fails/u);
  assert.match(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.retainedCalls"], /unresolved generation calls: \{pending\}/u);
});

test("the native image offer discloses two generation calls plus at most one separate exact-text safety request", () => {
  const text = englishForCode("output_native_image_ready");
  assert.equal(text, expected.runtimeMessages.output_native_image_ready);
  assert.match(text, /^At most two generation calls: one direction call and one image call at the exact size\./u);
  assert.match(text, /After authorization and Start/u);
  assert.match(text, /exact final image prompt as text to OpenAI \(omni-moderation-latest\)/u);
  assert.match(text, /at most one additional automatic safety check before image creation/u);
  assert.match(text, /This check is not counted as a generation call and is currently free under OpenAI’s pricing/u);
  assert.doesNotMatch(text, /no retention|zero retention|free generation|generation is free|no provider transfer|unlimited|retry/iu);
});

test("recorded source transfer discloses image-only safety and rejects required reference pixels without weakening billing caveats", () => {
  const text = englishForCode("output_transfer_document_after_authorization");
  assert.equal(text, expected.runtimeMessages.output_transfer_document_after_authorization);
  assert.match(text, /^After you authorize and start/u);
  assert.match(text, /Native image attempts also send the exact final image prompt as text to OpenAI \(omni-moderation-latest\)/u);
  assert.match(text, /at most one additional automatic safety check before image creation/u);
  assert.match(text, /This check is not counted as a generation call and is currently free under OpenAI’s pricing/u);
  assert.match(text, /If reference pixels are required, native image generation is unavailable/u);
  assert.match(text, /This preflight sends nothing/u);
  assert.match(text, /Account and provider ceilings are separate/u);
  assert.match(text, /not a guarantee of provider billing/u);
  assert.doesNotMatch(text, /Image references, if used|no retention|free generation|no provider transfer/iu);
});

test("the model and additional safety transfer are disclosed in every locale without echoing authored prompts", () => {
  const currentPriceTerms = { en: "currently free", fr: "actuellement gratuit", ar: "مجاني حاليًا", ja: "現在のOpenAIの料金体系では無料" };
  for (const code of Object.keys(expected.runtimeMessages)) {
    const descriptor = outputDeliveryMessageDescriptor(code, { prompt: "Private authored final image prompt", calls: 2 });
    assert.equal(descriptor.known, true, code);
    assert.deepEqual(descriptor.values, {}, "source text is not a translation parameter");
    for (const [locale, messages] of Object.entries(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
      const text = messages[descriptor.id];
      assert.ok(text.includes("OpenAI") && text.includes("omni-moderation-latest"), `${locale}.${code}`);
      assert.ok(text.includes(currentPriceTerms[locale]), `${locale}.${code}: current pricing, not a timeless free promise`);
      assert.deepEqual(slots(text), [], `${locale}.${code}`);
      assert.ok(!text.includes("Private authored final image prompt"));
      if (locale !== "en") assert.notEqual(text, expected.runtimeMessages[code]);
    }
  }
});

test("the image safety disclosure does not add moderation to Slides or change global provider-call restrictions", () => {
  assert.equal(englishForCode("output_native_slides_ready"), "One initial request and at most one repair. The accepted count policy remains unchanged.");
  const slides = outputDeliveryMessageDescriptor("output_native_slides_ready");
  for (const messages of Object.values(FORMA_OUTPUT_DELIVERY_MESSAGES)) {
    assert.ok(!messages[slides.id].includes("omni-moderation-latest"));
  }
  assert.equal(FORMA_OUTPUT_DELIVERY_MESSAGES.en["output.delivery.authorizationExpired"], "This deadline has passed. New provider calls, including repairs, are forbidden. Existing submissions and their costs remain recorded.");
});

test("the scoped moderation-price claim records the verified primary source and check date", () => {
  assert.deepEqual(expected.priceEvidence, {
    source: "https://developers.openai.com/api/docs/models/omni-moderation-latest",
    checkedOn: "2026-08-27",
  });
  for (const text of Object.values(expected.runtimeMessages)) {
    assert.match(text, /This check is not counted as a generation call and is currently free under OpenAI’s pricing/u);
  }
});
