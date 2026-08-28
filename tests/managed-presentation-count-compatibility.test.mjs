import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { MAX_MANAGED_PRESENTATION_SLIDES, buildManagedProductionPlan } from "../src/model/managed-production.ts";
import { MAX_MANUAL_PRESENTATION_SLIDES, PresentationCountPolicyError } from "../src/model/presentation-count-policy.ts";
import { generateManagedArtifactDraft } from "../worker/managed-production.ts";
import { buildDocumentPresentationSourceContract, generateDocumentArtifact } from "../worker/openai-adapter.ts";

const emptySource = { facts: [] };
const exact = (value) => ({ kind: "exact", unit: "slide", value });
const flexible = { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 };
const countError = (code) => (error) => error instanceof PresentationCountPolicyError && error.code === code;

for (const productionMode of [undefined, "manual"]) test("count compatibility: " + (productionMode ?? "default") + " remains a manual 1–15 contract", () => {
  const mode = productionMode === undefined ? {} : { productionMode };
  for (const count of [1, MAX_MANUAL_PRESENTATION_SLIDES]) {
    for (const terms of [{ itemCount: count, requestedSlideCount: count }, { slideCountPolicy: exact(count) }]) {
      const contract = buildDocumentPresentationSourceContract(emptySource, { ...mode, ...terms });
      assert.equal(contract.requestedSlideCount, count);
      assert.equal(contract.predictedSlideCount, count);
    }
  }
  for (const count of [16, 23, MAX_MANAGED_PRESENTATION_SLIDES]) {
    for (const terms of [{ itemCount: count }, { requestedSlideCount: count }, { slideCountPolicy: exact(count) }]) {
      assert.throws(() => buildDocumentPresentationSourceContract(emptySource, { ...mode, ...terms }), countError("presentation_slide_count_invalid"));
    }
  }
});

for (const count of [16, 23, MAX_MANAGED_PRESENTATION_SLIDES]) test("count compatibility: explicit managed source contract preserves exact and legacy count " + count, () => {
  for (const terms of [
    { itemCount: count, requestedSlideCount: count },
    { requestedSlideCount: count },
    { slideCountPolicy: exact(count) },
    { itemCount: count, requestedSlideCount: count, slideCountPolicy: exact(count) },
  ]) {
    const options = { productionMode: "managed", ...terms };
    const before = structuredClone(options);
    const contract = buildDocumentPresentationSourceContract(emptySource, options);
    assert.equal(contract.requestedSlideCount, count);
    assert.equal(contract.predictedSlideCount, count);
    assert.deepEqual(contract.slideCountPolicy, terms.slideCountPolicy);
    assert.deepEqual(contract.sourceIssues, []);
    assert.deepEqual(options, before, "the source contract must not rewrite accepted count terms");
  }
});

test("count compatibility: managed source contract still rejects counts above the existing maximum", () => {
  const count = MAX_MANAGED_PRESENTATION_SLIDES + 1;
  for (const terms of [{ itemCount: count }, { requestedSlideCount: count }, { slideCountPolicy: exact(count) }]) {
    assert.throws(() => buildDocumentPresentationSourceContract(emptySource, { productionMode: "managed", ...terms }), countError("presentation_slide_count_invalid"));
  }
});

test("count compatibility: a large count or unrecognized mode never selects managed production", () => {
  for (const productionMode of [undefined, null, "Managed", "automatic"]) {
    assert.throws(() => buildDocumentPresentationSourceContract(emptySource, { productionMode, itemCount: 23, requestedSlideCount: 23 }), countError("presentation_slide_count_invalid"));
  }
});

test("count compatibility: exact and legacy conflicting commitments remain rejected in either route", () => {
  for (const productionMode of ["manual", "managed"]) {
    for (const terms of [
      { itemCount: 8, requestedSlideCount: 9 },
      { itemCount: 9, slideCountPolicy: exact(8) },
      { requestedSlideCount: 9, slideCountPolicy: exact(8) },
    ]) {
      assert.throws(() => buildDocumentPresentationSourceContract(emptySource, { productionMode, ...terms }), countError("presentation_slide_count_conflict"));
    }
  }
});

test("count compatibility: manual flexible range remains a range, not an exact aim", () => {
  for (const productionMode of [undefined, "manual"]) {
    const options = { productionMode, itemCount: 8, slideCountPolicy: flexible };
    const before = structuredClone(options);
    const contract = buildDocumentPresentationSourceContract(emptySource, options);
    assert.equal(contract.requestedSlideCount, null);
    assert.equal(contract.predictedSlideCount, 8);
    assert.deepEqual(contract.slideCountPolicy, flexible);
    assert.deepEqual(options, before);
  }
});

test("count compatibility: managed flexible count remains unsupported", () => {
  assert.throws(() => buildDocumentPresentationSourceContract(emptySource, { productionMode: "managed", itemCount: 8, slideCountPolicy: flexible }), countError("presentation_count_policy_unsupported"));
});

for (const productionMode of [undefined, "manual"]) test("count compatibility: " + (productionMode ?? "default") + " sixteen-slide adapter request stops before any dispatch hook or transport", async (t) => {
  let calls = 0, guards = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("No provider request is permitted by this count contract."); });
  await assert.rejects(generateDocumentArtifact({ OPENAI_API_KEY: "in-memory-count-fixture" }, "count-fixture-owner", "slides", {
    documentTitle: "Explicit count boundary",
    snapshot: emptySource,
    options: { productionMode, itemCount: 16, requestedSlideCount: 16, onBeforeProviderAttempt: () => { guards++; }, onBeforeProviderDispatch: () => { guards++; } },
  }), countError("presentation_slide_count_invalid"));
  assert.equal(guards, 0);
  assert.equal(calls, 0);
});

test("count compatibility: a retained 23-slide managed plan rechecks the full current source before any page dispatch", async (t) => {
  const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/presentation-managed-23.json", import.meta.url), "utf8"));
  const production = buildManagedProductionPlan("slides", fixture.snapshot, { requestedSlideCount: 23 });
  const snapshot = structuredClone(fixture.snapshot);
  snapshot.facts.push({ block_id: "CURRENT_CONFLICTING_FINAL_SLIDE", type: "format", properties: {
    presentation_source_mode: "outline",
    text: "Slide 23: Ocean phosphorescence. Explain plankton metabolism from the missing expedition research.",
  } });
  const before = structuredClone(snapshot);
  let calls = 0, guards = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("The unresolved full-deck source must not dispatch an early page."); });
  await assert.rejects(generateManagedArtifactDraft({ OPENAI_API_KEY: "in-memory-count-fixture" }, "count-fixture-owner", "slides", {
    documentTitle: "Retained managed source",
    snapshot, production, requestedSlideCount: 23,
    plannerPreflight: () => { guards++; }, plannerDispatchGuard: () => { guards++; },
  }), (error) => error.detail?.code === "presentation_source_contract_invalid" && error.detail.httpStatus === 422);
  assert.deepEqual(snapshot, before, "preflight must preserve private authored source unchanged");
  assert.equal(production.scenes.length, 23);
  assert.equal(guards, 0);
  assert.equal(calls, 0);
});
