import assert from "node:assert/strict";
import test from "node:test";

import { readSlideCountPolicy, resolvePresentationCountRequest, slideCountAccepted } from "../src/model/presentation-count-policy.ts";
import { isOutputContextBlock } from "../src/model/output-source-policy.ts";
import { promptFactIsActive, providerFacingCreativeContext, providerFacingRenderingContext } from "../src/model/prompt-policy.ts";
import { buildPresentationSourceContract, inferPresentationSourceOutline, providerFacingPresentationSourceContract, scopePresentationSourceSnapshot, validatePresentationSourceCoverage } from "../src/model/presentation-source.ts";
import { authoritativeCreativeContext } from "../worker/context-authority.ts";
import { assessStoredPresentationCandidate, generateDocumentArtifact } from "../worker/openai-adapter.ts";

import { flexible, exact, snapshot, outputFor } from "./output-presentation-fixtures.mjs";

test("explicit policy preserves a range and does not turn aim eight into exact eight", () => {
  assert.deepEqual(readSlideCountPolicy(flexible), flexible);
  assert.equal(slideCountAccepted(9, flexible), true);
  assert.equal(slideCountAccepted(9, exact), false);
  for (const count of [5, 15]) assert.equal(slideCountAccepted(count, flexible), true);
  for (const count of [0, 4, 16, 8.5, NaN]) assert.equal(slideCountAccepted(count, flexible), false);
  assert.deepEqual(resolvePresentationCountRequest({ slideCountPolicy: flexible }), { itemCount: 8, requestedSlideCount: undefined, slideCountPolicy: flexible });
  assert.deepEqual(resolvePresentationCountRequest({ requestedSlideCount: 6 }), { itemCount: 6, requestedSlideCount: 6, slideCountPolicy: undefined });
  assert.equal(resolvePresentationCountRequest({ slideCountPolicy: flexible }, 10).itemCount, 10);
});

test("invalid, conflicting, over-limit, and unsupported policies fail without rewriting authored intent", () => {
  const cases = [
    { slideCountPolicy: { ...flexible, min: "5" } }, { slideCountPolicy: { ...flexible, unit: "presentation" } },
    { slideCountPolicy: { ...flexible, aim: 16 } }, { slideCountPolicy: { ...flexible, max: 16 } },
    { slideCountPolicy: { ...flexible, hiddenExact: 8 } }, { slideCountPolicy: flexible, requestedSlideCount: 8 },
    { slideCountPolicy: flexible, productionMode: "managed" }, { slideCountPolicy: exact, itemCount: 9 },
    { itemCount: 8, requestedSlideCount: 9 }, { requestedSlideCount: 16 }, { itemCount: "8" },
  ];
  for (const input of cases) assert.throws(() => resolvePresentationCountRequest(input), RangeError);
  assert.throws(() => resolvePresentationCountRequest({ slideCountPolicy: flexible }, 16), /required source/);
  assert.equal(resolvePresentationCountRequest({ requestedSlideCount: 15 }).itemCount, 15);
  assert.equal(resolvePresentationCountRequest({ requestedSlideCount: 100, productionMode: "managed" }).itemCount, 100);
});

test("Output variants never become facts, aliases, presentation fallback text, or corpus prompt instructions", () => {
  for (const type of ["output", "Output", "OUtput", " Output "]) {
    assert.equal(isOutputContextBlock({ type }), true);
    assert.equal(promptFactIsActive({ type, properties: { weight: 1, text: "OUTPUT_ONLY" } }), false);
  }
  const authored = snapshot(), before = structuredClone(authored);
  const source = buildPresentationSourceContract(authored, { itemCount: 8, slideCountPolicy: flexible });
  assert.ok(source.sources.every((entry) => entry.sourceId !== "output-mixed"));
  for (const value of [source.outline.sourceText, JSON.stringify(providerFacingPresentationSourceContract(source)), JSON.stringify(scopePresentationSourceSnapshot(authored)), JSON.stringify(providerFacingCreativeContext(authored)), JSON.stringify(providerFacingRenderingContext(authored))]) assert.doesNotMatch(value, /OUTPUT_INSTRUCTION_SENTINEL|SIBLING_VIDEO_SENTINEL/);
  assert.match(JSON.stringify(scopePresentationSourceSnapshot(authored)), /Never invent measured success/);
  assert.deepEqual(authored, before);
  assert.equal(inferPresentationSourceOutline({ facts: [authored.facts.find((entry) => entry.type === "OUtput")] }).sourceText, "");
});

test("authoritative provider snapshots exclude Output while preserving full revision authority and mandatory exclusions", () => {
  const event = (sequence, type, payload) => ({ eventId: `event-${sequence}`, streamId: "creative:policy-owner", sequence, occurredAt: "2026-08-27T12:00:00Z", recordedAt: "2026-08-27T12:00:00Z", actor: "user", clientId: "test", correlationId: "count-policy", causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload });
  const events = [event(1, "ProjectCreated", { project_id: "project-policy", name: "Policy fixture" }), event(2, "DocumentCreated", { project_id: "project-policy", document_id: "document-policy", title: "Policy fixture" }),
    ...snapshot(1).facts.map((fact, index) => event(index + 3, "BlockCreated", { project_id: "project-policy", document_id: "document-policy", block_id: fact.block_id, type: fact.type, handle: fact.block_id, position: `a${index}`, properties: { ...fact.properties, ...(fact.intent ? { intent: fact.intent } : {}) } })),
  ];
  const trusted = authoritativeCreativeContext(events, { documentId: "document-policy", projectId: "project-policy" });
  assert.equal(trusted.projection.blocks.length, 3, "storage and editable projection retain authored requirements");
  assert.deepEqual(trusted.snapshot.facts.map((fact) => fact.block_id), ["source-0", "negative"]);
  assert.deepEqual(trusted.sourceBlockVersions.map((version) => version.block_id), ["source-0", "output-mixed", "negative"]);
  assert.doesNotMatch(JSON.stringify(trusted.snapshot), /OUTPUT_INSTRUCTION_SENTINEL|SIBLING_VIDEO_SENTINEL/);
});

test("stored nine-slide candidate meets flexible policy but does not meet historical exact eight", () => {
  const source = snapshot(), raw = JSON.stringify(outputFor());
  const flexibleAssessment = assessStoredPresentationCandidate(raw, source, { itemCount: 8, slideCountPolicy: flexible, presentationStyle: "field-notes" });
  assert.deepEqual(flexibleAssessment.issues, []);
  const exactAssessment = assessStoredPresentationCandidate(raw, source, { itemCount: 8, requestedSlideCount: 8, presentationStyle: "field-notes" });
  assert.ok(exactAssessment.issues.some((issue) => issue.code === "wrong_item_count"));
});

test("provider schema, first response, retained validation, and receipt share a flexible policy before dispatch", async (context) => {
  const requests = [], guards = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const request = JSON.parse(init.body); requests.push(request);
    return Response.json({ id: "policy-nine", model: "gpt-5.6-terra", output_text: JSON.stringify(outputFor()), usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
  });
  const result = await generateDocumentArtifact({ OPENAI_API_KEY: "transport-test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "policy-owner", "slides", { documentTitle: "Community stewardship", snapshot: snapshot(), options: { itemCount: 8, slideCountPolicy: flexible, presentationStyle: "field-notes", outputTargetInstructions: "SELECTED_DECK_INSTRUCTION: explain the community document as one slideshow.", onBeforeProviderAttempt: (attempt) => { guards.push(attempt); } } });
  assert.equal(result.output.items.length, 9);
  assert.equal(requests.length, 1, "a valid ninth slide never causes an unnecessary repair");
  const input = JSON.parse(requests[0].input);
  assert.deepEqual(input.presentation_source.slideCountPolicy, flexible);
  assert.deepEqual([requests[0].text.format.schema.properties.items.minItems, requests[0].text.format.schema.properties.items.maxItems], [5, 15]);
  assert.match(requests[0].instructions, /Aim for 8 slides, but that aim is not an exact count/);
  assert.equal(requests[0].max_output_tokens, 13500);
  assert.equal(guards[0].maximumOutputTokens, 13500);
  assert.match(input.output_requirements.instructions, /SELECTED_DECK_INSTRUCTION/);
  assert.equal(input.output_requirements.source_evidence, false);
  assert.doesNotMatch(JSON.stringify(input.creative_context), /SELECTED_DECK_INSTRUCTION|OUTPUT_INSTRUCTION_SENTINEL|SIBLING_VIDEO_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(input.presentation_source), /SELECTED_DECK_INSTRUCTION|OUTPUT_INSTRUCTION_SENTINEL|SIBLING_VIDEO_SENTINEL/);
  assert.deepEqual(result.inputReceipt.providerInput.presentation_source.slideCountPolicy, flexible);
});

test("manual fifteen slides validate without clamping to twelve", async (context) => {
  const source = snapshot(15), output = outputFor(15, source), calls = [];
  context.mock.method(globalThis, "fetch", async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ id: "policy-fifteen", model: "gpt-5.6-terra", output_text: JSON.stringify(output), usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 } }); });
  const result = await generateDocumentArtifact({ OPENAI_API_KEY: "transport-test-only" }, "policy-owner", "slides", { documentTitle: "Community stewardship", snapshot: source, options: { itemCount: 8, slideCountPolicy: flexible, presentationStyle: "field-notes" } });
  assert.equal(result.output.items.length, 15);
  assert.equal(calls.length, 1);
  assert.deepEqual(assessStoredPresentationCandidate(JSON.stringify(output), source, { itemCount: 8, slideCountPolicy: flexible, presentationStyle: "field-notes" }).issues, []);
});

test("an explicitly exact eight policy never relaxes to accept a paid ninth slide", async (context) => {
  const requests = [];
  context.mock.method(globalThis, "fetch", async (_url, init) => { requests.push(JSON.parse(init.body)); assert.ok(requests.length <= 2); return Response.json({ id: `exact-policy-${requests.length}`, model: "gpt-5.6-terra", output_text: JSON.stringify(outputFor()), usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } }); });
  await assert.rejects(generateDocumentArtifact({ OPENAI_API_KEY: "transport-test-only" }, "policy-owner", "slides", { documentTitle: "Community stewardship", snapshot: snapshot(), options: { itemCount: 8, slideCountPolicy: exact, presentationStyle: "field-notes" } }), (error) => error.detail.code === "source_fidelity_validation_failed");
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.deepEqual(JSON.parse(request.input).presentation_source.slideCountPolicy, exact);
    assert.deepEqual([request.text.format.schema.properties.items.minItems, request.text.format.schema.properties.items.maxItems], [8, 8]);
  }
});

test("repair keeps the originally accepted range and selected instructions instead of relaxing exactness", async (context) => {
  const bad = outputFor(9); bad.items.pop(); bad.items.pop(); bad.items.pop(); bad.items.pop(); bad.items.pop();
  const responses = [bad, outputFor(9)], requests = [];
  context.mock.method(globalThis, "fetch", async (_url, init) => { const request = JSON.parse(init.body); requests.push(request); assert.ok(requests.length <= 2); return Response.json({ id: `policy-repair-${requests.length}`, model: "gpt-5.6-terra", output_text: JSON.stringify(responses[requests.length - 1]), usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } }); });
  const result = await generateDocumentArtifact({ OPENAI_API_KEY: "transport-test-only" }, "policy-owner", "slides", { documentTitle: "Community stewardship", snapshot: snapshot(), options: { itemCount: 8, slideCountPolicy: flexible, presentationStyle: "field-notes", outputTargetInstructions: "SELECTED_DECK_INSTRUCTION" } });
  assert.equal(result.output.items.length, 9);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const input = JSON.parse(request.input);
    assert.deepEqual(input.presentation_source.slideCountPolicy, flexible);
    assert.deepEqual([request.text.format.schema.properties.items.minItems, request.text.format.schema.properties.items.maxItems], [5, 15]);
    assert.equal(input.output_requirements.instructions, "SELECTED_DECK_INSTRUCTION");
  }
});

test("unoutlined exact closing wording follows the final slide under an accepted flexible range", () => {
  const source = { facts: [{ block_id: "closing-source", type: "message", properties: { text: "Close with these exact words: Together we care for the places we share." } }] };
  const contract = buildPresentationSourceContract(source, { itemCount: 8, slideCountPolicy: flexible });
  const items = Array.from({ length: 9 }, (_unused, index) => ({ title: `Topic ${index + 1}`, body: index === 8 ? "Together we care for the places we share." : "", slide: { sourceIds: [] } }));
  const issues = validatePresentationSourceCoverage(items, contract, { requireEverySlideSource: false, requireAllProtectedContent: true });
  assert.equal(issues.some((issue) => /protected_message|slide_count/.test(issue.code)), false);
  assert.equal(providerFacingPresentationSourceContract(contract).protectedMessages[0].position, "last_slide");
});
