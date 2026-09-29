import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import {
  buildPresentationSourceContract, inferPresentationSourceOutline, providerFacingPresentationSourceContract,
  scopePresentationSourceSnapshot, validatePresentationSourceCoverage,
} from "../src/model/presentation-source.ts";
import { combinedContextGroups, validateContextCompositionGraph } from "../src/model/combined-context.ts";
import { foldEvents } from "../src/model/events.ts";
import { buildManagedProductionPlan, productionSceneSnapshot } from "../src/model/managed-production.ts";
import { assessStoredPresentationCandidate } from "../worker/openai-adapter.ts";
import { combinedSceneSnapshot, generateManagedArtifactDraft } from "../worker/managed-production.ts";

// Reuse independently authored existing fixtures and the actual composer-method
// harness. Only test registration is disabled in these three fixture modules;
// application source and real provider validation are not substituted.
const fixtureExports = new Map([
  [new URL("./presentation-outline-provider.test.mjs?source-semantics-fixture", import.meta.url).href, "outlineSnapshot, contractFor, outputFor, options, generate, mockProvider"],
  [new URL("./presentation-composer-preflight.test.mjs?source-semantics-fixture", import.meta.url).href, "planning, permitsSubmission, harness"],
  [new URL("./presentation-outline-managed.test.mjs?source-semantics-fixture", import.meta.url).href, "outlineFixture, studies"],
]);
const fixtureHook = registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    const names = fixtureExports.get(url);
    if (!names) return loaded;
    const original = typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source);
    assert.ok(original.includes('import test from "node:test";'));
    return { ...loaded, source: original.replace('import test from "node:test";', "const test = () => {};") + "\nexport { " + names + " };\n" };
  },
});
const { outlineSnapshot, contractFor, outputFor, options, generate, mockProvider } = await import("./presentation-outline-provider.test.mjs?source-semantics-fixture");
const { planning, permitsSubmission, harness } = await import("./presentation-composer-preflight.test.mjs?source-semantics-fixture");
const { outlineFixture, studies } = await import("./presentation-outline-managed.test.mjs?source-semantics-fixture");
fixtureHook.deregister();

const sourceIssues = (output, contract) => validatePresentationSourceCoverage(output, contract, { requireEverySlideSource: true, requireAllProtectedContent: true });
const hasCode = (issues, code) => issues.some((issue) => issue.code === code);
const formatFact = (snapshot) => snapshot.facts.find((fact) => fact.type === "format");
const appendFirst = (snapshot, requirement) => {
  const fact = formatFact(snapshot);
  fact.properties.text = fact.properties.text.replace("Explain current limits and proposed output requirements.", "Explain current limits and proposed output requirements. " + requirement);
  return snapshot;
};
const refreshMarkdown = (output) => {
  output.content_markdown = output.items.map((item, index) => `## ${index + 1}. ${item.title}\n${item.body}\n${item.slide.visual.value}`).join("\n\n");
  return output;
};
function polarityFixture(wording = "No actual pilot outcomes have been measured.") {
  const snapshot = outlineSnapshot();
  formatFact(snapshot).properties.text = formatFact(snapshot).properties.text.replace("Scope the image pilot, capability gates, and proposed usability measures.", "Scope the image pilot, capability gates, and proposed usability measures. " + wording);
  snapshot.facts.find((fact) => fact.block_id === "PRIVATE_OUTLINE_PILOT").properties.text += " No actual pilot outcomes have been measured.";
  const output = outputFor(snapshot);
  output.items[5].body += " Actual pilot outcomes have been measured.";
  return { snapshot, output: refreshMarkdown(output) };
}

for (const wording of ["No actual pilot outcomes have been measured.", "Pilot outcomes have not been measured."]) {
  test("source semantics: factual negative remains required coverage: " + wording, () => {
    const { snapshot, output } = polarityFixture(wording);
    const contract = contractFor(snapshot), before = structuredClone(snapshot);
    assert.deepEqual(contract.sourceIssues, []);
    assert.ok(contract.numberedOutline[5].coverageRequirements.includes(wording));
    assert.ok(!contract.numberedOutline[5].productionConstraints.includes(wording));
    const assessment = assessStoredPresentationCandidate(JSON.stringify(output), snapshot, options);
    assert.ok(hasCode(assessment.issues, "incorrect_outline_polarity"));
    assert.deepEqual(snapshot, before);
  });

  test("source semantics: actual adapter rejects the factual opposite and retains both mocked usages: " + wording, async (t) => {
    const { snapshot, output } = polarityFixture(wording), attempts = [], submissions = [];
    const requests = mockProvider(t, [output, output]);
    await assert.rejects(generate(snapshot, { onProviderAttempt: (receipt) => attempts.push(receipt), onProviderSubmission: (receipt) => submissions.push(receipt) }), (error) => {
      assert.equal(error.detail?.code, "source_fidelity_validation_failed");
      assert.ok(error.detail.validationIssues.some((issue) => issue.code === "incorrect_outline_polarity" && issue.stage === "repair"));
      assert.equal(error.providerCallCount, 2);
      assert.deepEqual(error.providerUsage, { inputTokens: 240, outputTokens: 160, totalTokens: 400 });
      return true;
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(attempts.map((receipt) => receipt.usage.totalTokens), [200, 400]);
    assert.deepEqual(submissions.map((receipt) => receipt.status), ["pending", "completed", "pending", "completed"]);
  });
}

test("source semantics: truthful negative output still succeeds in one actual adapter call", async (t) => {
  const { snapshot, output } = polarityFixture();
  output.items[5].body = output.items[5].body.replace("Actual pilot outcomes have been measured.", "No actual pilot outcomes have been measured.");
  refreshMarkdown(output);
  assert.deepEqual(assessStoredPresentationCandidate(JSON.stringify(output), snapshot, options).issues, []);
  const requests = mockProvider(t, [output]), result = await generate(snapshot);
  assert.equal(requests.length, 1);
  assert.equal(result.inputReceipt.validation.repair_attempted, false);
});

for (const constraint of [
  "Use native editable text.",
  "Never invent measured results.",
  "Do not generate images.",
  "No generated images, soundtrack, or paid media.",
  "Do not spend money on new images.",
]) {
  test("source semantics: producer constraint remains transmitted but is not audience copy: " + constraint, async (t) => {
    const snapshot = appendFirst(outlineSnapshot(), constraint), before = structuredClone(snapshot);
    const contract = contractFor(snapshot), slide = contract.numberedOutline[0];
    assert.deepEqual(contract.sourceIssues, []);
    assert.deepEqual(slide.coverageRequirements, ["Explain current limits and proposed output requirements."]);
    assert.deepEqual(slide.productionConstraints, [constraint]);
    assert.ok(slide.content.includes(constraint));
    assert.ok(JSON.stringify(scopePresentationSourceSnapshot(snapshot, contract)).includes(constraint));
    assert.deepEqual(providerFacingPresentationSourceContract(contract).outline[0].productionConstraints, [constraint]);
    for (const mode of ["manual", "managed"]) {
      const state = harness(snapshot, mode, 6);
      assert.equal(planning.call(state).planningError, "");
      assert.equal(permitsSubmission.call(state), true);
    }
    const output = outputFor(snapshot);
    assert.deepEqual(assessStoredPresentationCandidate(JSON.stringify(output), snapshot, options).issues, []);
    const requests = mockProvider(t, [output]), result = await generate(snapshot);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].input.presentation_source.outline[0].productionConstraints, [constraint]);
    assert.doesNotMatch(JSON.stringify(requests[0].request), /PRIVATE_OUTLINE_/u);
    assert.equal(result.inputReceipt.validation.repair_attempted, false);
    assert.ok(!result.output.items[0].body.includes(constraint));
    assert.deepEqual(snapshot, before);
  });
}

for (const requirement of [
  "No spend on save.",
  "No generated images were approved.",
  "No paid media has been published.",
  "No actual pilot outcomes have been measured.",
]) {
  test("source semantics: factual negative prefixes are never treated as production exclusions: " + requirement, () => {
    const parsed = inferPresentationSourceOutline("Presentation outline\nSlide 1: Current facts. " + requirement);
    assert.deepEqual(parsed.sourceIssues, []);
    assert.deepEqual(parsed.slides[0].coverageRequirements, [requirement]);
    assert.deepEqual(parsed.slides[0].productionConstraints, []);
  });
}

for (const requirement of ["Use a full-slide bitmap.", "Make this magical.", "Never reinterpret the results."]) {
  test("source semantics: unsupported producer instruction stops in the free composer and before provider admission: " + requirement, async (t) => {
    const snapshot = appendFirst(outlineSnapshot(), requirement), contract = contractFor(snapshot);
    const issue = contract.sourceIssues.find((entry) => entry.code === "ambiguous_presentation_requirement");
    assert.deepEqual(issue?.parameters, { slideNumber: 1 });
    assert.ok(contract.numberedOutline[0].coverageRequirements.includes(requirement), "ambiguity must not silently remove a requirement");
    assert.ok(contract.numberedOutline[0].content.includes(requirement));
    for (const mode of ["manual", "managed"]) {
      const state = harness(snapshot, mode, 6);
      assert.ok(planning.call(state).planningError);
      assert.equal(permitsSubmission.call(state), undefined);
      assert.equal(state.messages.length, 1);
    }
    const requests = mockProvider(t, []);
    let preflights = 0, submissions = 0;
    await assert.rejects(generate(snapshot, { onBeforeProviderAttempt: () => { preflights += 1; }, onProviderSubmission: () => { submissions += 1; } }), (error) => error.detail?.code === "presentation_source_contract_invalid" && error.detail?.httpStatus === 422);
    assert.equal(requests.length, 0); assert.equal(preflights, 0); assert.equal(submissions, 0);
    assert.throws(() => buildManagedProductionPlan("slides", snapshot), (error) => error.code === "presentation_source_contract_invalid");
  });
}

test("source semantics: explicit protected producer-looking audience copy is not demoted, and authored/v1 stays authored", () => {
  const snapshot = appendFirst(outlineSnapshot(), "Use native editable text.");
  formatFact(snapshot).properties.protected_phrase = "Use native editable text.";
  const contract = contractFor(snapshot);
  assert.ok(contract.numberedOutline[0].coverageRequirements.includes("Use native editable text."));
  assert.deepEqual(contract.numberedOutline[0].productionConstraints, []);
  assert.ok(hasCode(assessStoredPresentationCandidate(JSON.stringify(outputFor(snapshot)), snapshot, options).issues, "missing_outline_coverage"));
  const authored = buildPresentationSourceContract("Presentation manuscript\nSlide 1: Production standards\nUse native editable text.\nSlide 2: Measured status\nNo actual pilot outcomes have been measured.");
  assert.ok(authored.numberedOutline.every((slide) => slide.sourceMode === "authored" && slide.productionConstraints === undefined));
  const legacy = structuredClone(authored);
  legacy.schemaVersion = 1; delete legacy.passages; delete legacy.sourceIssues;
  for (const slide of legacy.numberedOutline) { delete slide.sourceMode; delete slide.evidencePassageIds; delete slide.coverageRequirements; }
  assert.ok(sourceIssues([{ title: "Production standards", body: "Unrelated text." }], legacy).length);
});

test("source semantics: every preflight code exposes only factual structured numeric parameters", () => {
  const cases = [];
  const multiple = outlineSnapshot();
  formatFact(multiple).properties.text += "\nRequired output 3: Alternate Slides\nSlide 1: Another decision. Explain another decision.";
  cases.push([contractFor(multiple), "ambiguous_presentation_output", undefined]);
  const mixed = { facts: [{ block_id: "mixed", type: "format", properties: { text: "Presentation outline\nSlide 1: Research manuscript\n" + "A fully authored narrative paragraph preserves its own argument. ".repeat(20) } }] };
  cases.push([buildPresentationSourceContract(mixed), "ambiguous_presentation_source_mode", undefined]);
  cases.push([buildPresentationSourceContract("Slide 9: First.\nSlide 9: Second."), "ambiguous_presentation_slide_number", { slideNumber: 9 }]);
  cases.push([buildPresentationSourceContract("Presentation outline\nSlide 9: Unresolved evidence. Explain orbital mirrors."), "unresolved_outline_evidence", { slideNumber: 9 }]);
  const required = outlineSnapshot();
  required.facts.find((fact) => fact.block_id === "PRIVATE_OUTLINE_UNRELATED").locked = true;
  cases.push([contractFor(required), "unassigned_required_presentation_source", undefined]);
  cases.push([buildPresentationSourceContract(outlineSnapshot(), { requestedSlideCount: 7 }), "outline_slide_count_conflict", { requestedSlideCount: 7, authoredSlideCount: 6 }]);
  cases.push([contractFor(appendFirst(outlineSnapshot(), "Use a bitmap.")), "ambiguous_presentation_requirement", { slideNumber: 1 }]);
  for (const [contract, code, expected] of cases) {
    const issue = contract.sourceIssues.find((entry) => entry.code === code);
    assert.ok(issue, code); assert.deepEqual(issue.parameters, expected, code);
    if (expected === undefined) assert.ok(!Object.hasOwn(issue, "parameters"), code);
    else assert.ok(Object.values(issue.parameters).every((value) => Number.isSafeInteger(value) && value >= 0), code);
    assert.doesNotMatch(JSON.stringify(issue), /PRIVATE_OUTLINE_|mixed|orbital mirrors/u, "issue chrome must not expose source prose");
  }
});

// Supported document graph mutations, not forged duplicate membership objects.
function graphFixture({ shared = false, range = false, named = false, outsideOnly = false, secondTarget = "Slide 2" } = {}) {
  const original = outlineSnapshot();
  const outline = formatFact(original);
  outline.properties.text = outline.properties.text.split("\nRequired supporting output 2:")[0].trim();
  const sharedId = "PRIVATE_OUTLINE_CURRENT";
  if (shared || range) {
    original.facts.find((fact) => fact.block_id === sharedId).properties.text += "\n\n" + original.facts.find((fact) => fact.block_id === "PRIVATE_OUTLINE_RESPONSIBILITIES").properties.text;
    original.facts = original.facts.filter((fact) => fact.block_id !== "PRIVATE_OUTLINE_RESPONSIBILITIES");
  }
  if (outsideOnly) {
    outline.properties.text = outline.properties.text.replace("Linked responsibilities. Cover context, output requirements, confirmed plan, variants, attempts, verification, and delivery.", "Current limits. Explain current limits and proposed output requirements.");
    original.facts = original.facts.filter((fact) => fact.block_id !== "PRIVATE_OUTLINE_RESPONSIBILITIES");
  }
  const raw = [
    ["ProjectCreated", { name: "Source semantics" }],
    ["DocumentCreated", { title: "Research reuse" }],
    ...original.facts.map((fact) => ["BlockCreated", { block_id: fact.block_id, type: fact.type, properties: { ...fact.properties, intent: fact.intent ?? "include" } }]),
    ["BlockCreated", { block_id: "group-one", type: "format", properties: { text: "First research chapter", context_group: { name: "First research chapter", target: named ? "Research background" : range ? "Slides 1–2" : "Slide 1", role: named ? "message" : "slide_chapter", application: named ? "recur" : "isolate", relativity: 1 } } }],
    ...(!named ? [["BlockRelationAdded", { relation_id: "one-outline", from_block_id: "group-one", to_block_id: outline.block_id, kind: "context_contains", properties: { member_order: 0 } }]] : []),
    ["BlockRelationAdded", { relation_id: "one-research", from_block_id: "group-one", to_block_id: sharedId, kind: "context_contains", properties: { member_order: 1 } }],
  ];
  if (shared) raw.push(
    ["BlockCreated", { block_id: "group-two", type: "format", properties: { text: "Second research chapter", context_group: { name: "Second research chapter", target: secondTarget, role: "slide_chapter", application: "isolate", relativity: 1 } } }],
    ["BlockRelationAdded", { relation_id: "two-research", from_block_id: "group-two", to_block_id: sharedId, kind: "context_contains", properties: { member_order: 0 } }],
  );
  const events = raw.map(([type, payload], index) => ({
    eventId: "semantic-event-" + index, sequence: index + 1, streamId: "creative:semantic-owner", actor: "user", clientId: "web:semantic-test",
    occurredAt: "2026-08-27T12:00:00.000Z", recordedAt: "2026-08-27T12:00:00.000Z", correlationId: "semantic-group", schemaVersion: 1, causationId: null, compensatesEventId: null,
    type, payload: { project_id: "semantic-project", document_id: "semantic-document", ...payload },
  }));
  assert.equal(validateContextCompositionGraph({ blocks: [], relations: [], events }), null, "the shared graph must be a valid actual authoring event batch");
  const projection = foldEvents(events, Infinity, "semantic-document", "semantic-project");
  const snapshot = {
    document: { id: "semantic-document", title: "Research reuse" },
    facts: projection.blocks.map((block) => ({ block_id: block.id, type: block.type, locked: block.locked, active: true, intent: block.properties.intent ?? "include", properties: block.properties })),
    relationships: projection.blockRelations.map((edge) => ({ relation_id: edge.id, from_block_id: edge.fromBlockId, to_block_id: edge.toBlockId, kind: edge.kind, properties: edge.properties })),
  };
  return { snapshot, events, sharedId, shared: shared || range };
}
function graphOutput(fixture) {
  const { snapshot, sharedId, shared } = fixture;
  const contract = contractFor(snapshot), output = outputFor(snapshot), groups = combinedContextGroups(snapshot);
  for (const [index, item] of output.items.entries()) {
    if (shared && index < 2) {
      const alias = contract.sources.find((source) => source.sourceId === sharedId).alias;
      item.slide.source_ids = [alias]; item.slide.citations[0].source_id = alias;
    }
    item.context_group_ids = contract.numberedOutline[index].contextGroupIds.map((id) => "context_group_" + (groups.findIndex((group) => group.id === id) + 1));
  }
  return output;
}
for (const variation of [{ name: "one inherited target", input: {} }, { name: "one intentionally reused research block", input: { shared: true } }, { name: "one contiguous chapter range", input: { range: true } }, { name: "named recurring evidence without outline membership", input: { named: true } }]) {
  test("source semantics: valid graph supports manual and managed " + variation.name, async (t) => {
    const fixture = graphFixture(variation.input), { snapshot, sharedId } = fixture, before = structuredClone(snapshot);
    const contract = contractFor(snapshot), plan = buildManagedProductionPlan("slides", snapshot);
    assert.deepEqual(contract.sourceIssues, []);
    assert.equal(plan.scenes.length, 6);
    if (variation.input.named) {
      assert.equal(contract.numberedOutline[0].evidenceAssignment, "matched", "derived group metadata does not manufacture an explicit assignment");
      assert.deepEqual(contract.numberedOutline[0].contextGroupIds, ["group-one"]);
      assert.deepEqual(contract.numberedOutline[0].evidencePassageIds, ["passage_001"]);
    }
    if (fixture.shared) {
      assert.equal(snapshot.facts.filter((fact) => fact.block_id === sharedId).length, 1, "reuse never duplicates research");
      assert.ok(contract.numberedOutline[0].evidencePassageIds.some((id) => contract.numberedOutline[1].evidencePassageIds.includes(id)));
      assert.ok(plan.scenes.slice(0, 2).every((scene) => scene.sourceBlockIds.includes(sharedId)));
    } else {
      assert.deepEqual(contract.numberedOutline[1].contextGroupIds, []);
      assert.equal(contract.numberedOutline[1].evidenceAssignment, "matched");
      assert.ok(plan.scenes[1].sourceBlockIds.includes("PRIVATE_OUTLINE_RESPONSIBILITIES"));
    }
    for (const mode of ["manual", "managed"]) {
      const state = harness(snapshot, mode, 6);
      assert.equal(planning.call(state).planningError, ""); assert.equal(permitsSubmission.call(state), true);
    }
    for (const index of [0, 1]) {
      const page = productionSceneSnapshot(snapshot, plan.scenes[index]);
      const scoped = buildPresentationSourceContract(page, { authoredSlideNumbers: [1, 2, 3, 4, 5, 6], requestedSlideCount: 6, itemCount: 1 });
      assert.deepEqual(scoped.sourceIssues, []);
      assert.deepEqual(scoped.numberedOutline.map((slide) => slide.number), [index + 1]);
      assert.deepEqual(scoped.numberedOutline[0].contextGroupIds, contract.numberedOutline[index].contextGroupIds);
      assert.ok(page.facts.some((fact) => fact.block_id === "PRIVATE_OUTLINE_FORMAT"), "exact owner remains present even when its inherited target differs");
      const expected = contract.passages.filter((passage) => contract.numberedOutline[index].evidencePassageIds.includes(passage.id)).map((passage) => [passage.sourceBlockId, passage.content]);
      const actual = scoped.passages.filter((passage) => scoped.numberedOutline[0].evidencePassageIds.includes(passage.id)).map((passage) => [passage.sourceBlockId, passage.content]);
      assert.deepEqual(actual, expected);
      if (variation.input.shared) assert.deepEqual(scoped.passages.filter((passage) => passage.sourceBlockId === sharedId).map((passage) => passage.contextGroupIds), expected.map(() => [index ? "group-two" : "group-one"]));
    }
    const output = graphOutput(fixture);
    assert.deepEqual(assessStoredPresentationCandidate(JSON.stringify(output), snapshot, options).issues, []);
    const requests = mockProvider(t, [output]), generated = await generate(snapshot);
    assert.equal(requests.length, 1); assert.equal(generated.inputReceipt.validation.repair_attempted, false);
    assert.deepEqual(generated.output.items.map((item) => item.context_group_ids), contract.numberedOutline.map((slide) => slide.contextGroupIds), "only the exact effective group membership is inferred");
    assert.doesNotMatch(JSON.stringify(requests[0].request), /PRIVATE_OUTLINE_|semantic-document|group-one|group-two/u);
    assert.deepEqual(snapshot, before);
  });
}

for (const variation of [{ shared: true }, { named: true }]) test("source semantics: whole managed output preserves " + (variation.named ? "named recurring evidence" : "the shared graph") + " without duplicate evidence or extra requests", async (t) => {
  const fixture = graphFixture(variation), { snapshot } = fixture, production = buildManagedProductionPlan("slides", snapshot);
  const template = graphOutput(fixture), requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
    assert.equal(requests.length, 0, "this valid graph needs one initial request and no repair");
    const provider = JSON.parse(JSON.parse(String(init.body)).input); requests.push(provider);
    // A scoped page has its own request-local aliases. Return only the aliases
    // actually disclosed for the exact selected passage and planned scene.
    const output = structuredClone(template);
    for (const [index, item] of output.items.entries()) {
      const row = provider.presentation_source.outline.find((slide) => slide.number === index + 1);
      const passage = provider.presentation_source.passages.find((entry) => row.evidencePassageIds.includes(entry.id) && entry.content.includes(item.slide.citations[0].excerpt));
      assert.ok(passage);
      item.slide.source_ids = [passage.sourceAlias]; item.slide.citations[0].source_id = passage.sourceAlias;
      item.context_group_ids = provider.production.assigned_scenes[index].context_keys;
    }
    return Response.json({ id: "shared-graph-page", model: "gpt-5.6-terra", output_text: JSON.stringify(output), usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  });
  const generated = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "test-actor", "slides", { documentTitle: "Research reuse", snapshot, production, requestedSlideCount: 6, presentationStyle: "field-notes", presentationFidelity: "faithful" });
  assert.equal(requests.length, 1);
  assert.equal(generated.output.items.length, 6);
  assert.deepEqual(generated.inputReceipt.whole_work_validation.issues, []);
  assert.deepEqual(generated.output.items.map((item) => item.context_group_ids), production.scenes.map((scene) => scene.contextGroupIds));
});

test("source semantics: out-of-target-only evidence and conflicting isolated chapters still fail freely", async (t) => {
  const fixture = graphFixture({ outsideOnly: true });
  const contract = contractFor(fixture.snapshot);
  assert.ok(contract.sourceIssues.some((issue) => issue.code === "unresolved_outline_evidence" && issue.parameters.slideNumber === 2));
  assert.throws(() => buildManagedProductionPlan("slides", fixture.snapshot), (error) => error.code === "presentation_source_contract_invalid");
  const requests = mockProvider(t, []);
  await assert.rejects(generate(fixture.snapshot), (error) => error.detail?.code === "presentation_source_contract_invalid");
  const priorPlan = buildManagedProductionPlan("slides", graphFixture().snapshot);
  await assert.rejects(generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "test-actor", "slides", { documentTitle: "Research reuse", snapshot: fixture.snapshot, production: priorPlan, requestedSlideCount: 6, presentationStyle: "field-notes", presentationFidelity: "faithful" }), (error) => ["presentation_source_contract_invalid", "presentation_page_source_scope_invalid"].includes(error.detail?.code ?? error.code));
  assert.equal(requests.length, 0, "even a prior managed plan cannot spend against unresolved current source");
  const conflicting = graphFixture({ shared: true, secondTarget: "Slide 1" });
  assert.throws(() => buildManagedProductionPlan("slides", conflicting.snapshot), (error) => error.code === "presentation_context_target_conflict");
});

function mockManagedStudies(t, { polarity = false } = {}) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
    assert.ok(requests.length < 3, "managed output may not exceed its fixture's explicit bounded mock calls");
    const request = JSON.parse(String(init.body)), provider = JSON.parse(request.input); requests.push(provider);
    const items = provider.presentation_source.outline.map((row) => {
      const study = studies[row.number - 1], passage = provider.presentation_source.passages.find((entry) => row.evidencePassageIds.includes(entry.id) && entry.content.includes(study.evidence));
      assert.ok(passage);
      return { title: study.title, body: study.evidence + (polarity && row.number === 9 ? " Actual canyon outcomes have been measured." : ""), notes: study.evidence, image_prompt: "", context_group_ids: [], slide: {
        layout: row.number === 1 ? "cover" : row.number === 9 ? "closing" : "split", kicker: "", bullets: [], source_order: row.number, source_ids: [passage.sourceAlias],
        citations: [{ source_id: passage.sourceAlias, label: "Field research", excerpt: study.evidence }],
        visual: { kind: "hero-type", label: "", value: study.emphasis, data: [] },
      } };
    });
    return Response.json({ id: "source-semantics-managed-" + requests.length, model: "gpt-5.6-terra", output_text: JSON.stringify({
      title: "Field studies", summary: "Independent research observations.", content_markdown: items.map((item) => item.body).join("\n\n"),
      presentation: { aspect_ratio: "16:9", theme: "Field studies", footer_label: "Research collection", style_preset: "field-notes", mode: "light", palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" } }, items,
    }), usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
  });
  return requests;
}
test("source semantics: bounded managed pages retain producer directions without forcing them into audience copy", async (t) => {
  const snapshot = outlineFixture({ count: 9, sharedBlock: true });
  formatFact(snapshot).properties.text = formatFact(snapshot).properties.text.replace(studies[0].requirement, studies[0].requirement + " Use native editable text. Never invent measured results.");
  const before = structuredClone(snapshot), production = buildManagedProductionPlan("slides", snapshot), full = buildPresentationSourceContract(snapshot);
  for (const [start, end] of [[0, 8], [8, 9]]) {
    const page = combinedSceneSnapshot(snapshot, production.scenes.slice(start, end)), scoped = buildPresentationSourceContract(page, { authoredSlideNumbers: full.numberedOutline.map((slide) => slide.number), requestedSlideCount: 9, itemCount: end - start });
    assert.deepEqual(scoped.sourceIssues, []);
    assert.deepEqual(scoped.numberedOutline[0].productionConstraints, start ? [] : ["Use native editable text.", "Never invent measured results."]);
  }
  const requests = mockManagedStudies(t);
  const result = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "test-actor", "slides", { documentTitle: "Field studies", snapshot, production, requestedSlideCount: 9, presentationStyle: "field-notes", presentationFidelity: "faithful" });
  assert.equal(requests.length, 2); assert.equal(result.inputReceipt.whole_work_validation.repaired_pages, 0); assert.equal(result.usage.totalTokens, 300);
  assert.doesNotMatch(JSON.stringify(result.output.items.map((item) => [item.title, item.body, item.slide?.visual])), /Use native editable text|Never invent measured results/u);
  assert.deepEqual(snapshot, before);
});

test("source semantics: a negative factual requirement on the last managed page rejects the opposite and retains observed usage", async (t) => {
  const snapshot = outlineFixture({ count: 9, sharedBlock: true });
  formatFact(snapshot).properties.text = formatFact(snapshot).properties.text.replace(studies[8].requirement, studies[8].requirement + " No actual canyon outcomes have been measured.");
  snapshot.facts[0].properties.text += " No actual canyon outcomes have been measured.";
  const production = buildManagedProductionPlan("slides", snapshot), requests = mockManagedStudies(t, { polarity: true }), attempts = [];
  await assert.rejects(generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "test-actor", "slides", { documentTitle: "Field studies", snapshot, production, requestedSlideCount: 9, presentationStyle: "field-notes", presentationFidelity: "faithful", plannerAttempt: (receipt) => attempts.push(receipt) }), (error) => {
    assert.equal(error.detail?.code, "source_fidelity_validation_failed");
    assert.ok(error.detail.validationIssues.some((issue) => issue.code === "incorrect_outline_polarity"));
    assert.equal(error.providerCallCount, 2, "the thrown adapter receipt covers its failing page");
    assert.equal(error.providerUsage.totalTokens, 300);
    // The managed planner separately checkpoints all pages, including this
    // failing page, before rejection; those aggregate receipts remain 450.
    return true;
  });
  assert.equal(requests.length, 3);
  assert.equal(attempts.at(-1).usage.totalTokens, 450);
});

test("source semantics: repaired assignments do not weaken source identity, exact passages, quotes, numeric precision, or inactive-source denial", () => {
  const fixture = graphFixture({ shared: true }), good = graphOutput(fixture), { snapshot } = fixture;
  for (const [name, mutate, code] of [
    ["foreign source", (output) => { output.items[0].slide.source_ids = ["blk_999"]; }, "unknown_source_reference"],
    ["wrong paragraph", (output) => { output.items[0].slide.citations[0].excerpt = "Seasonal pruning keeps the north orchard healthy."; }, "ungrounded_citation_excerpt"],
    ["invented attributed quote", (output) => { output.items[0].slide.quote = { text: "Every author finished immediately.", speaker: "Independent Reviewer", role: "Research", source_id: output.items[0].slide.source_ids[0], citation: "" }; }, "ungrounded_quote_text"],
    ["altered ratio", (output) => { output.items[2].slide.citations[0].excerpt = output.items[2].slide.citations[0].excerpt.replace("1:1", "2:1"); }, "ungrounded_citation_excerpt"],
  ]) {
    const output = structuredClone(good); mutate(output);
    assert.ok(hasCode(assessStoredPresentationCandidate(JSON.stringify(output), snapshot, options).issues, code), name);
  }
  const muted = structuredClone(snapshot); muted.facts.find((fact) => fact.block_id === fixture.sharedId).active = false;
  const contract = contractFor(muted);
  assert.ok(!contract.passages.some((passage) => passage.sourceBlockId === fixture.sharedId));
  assert.ok(contract.sourceIssues.some((issue) => issue.code === "unresolved_outline_evidence"));
});

test("source semantics: an explicit wrong provider group is not hidden by inferred-membership repair", () => {
  const fixture = graphFixture({ shared: true }), output = graphOutput(fixture), production = buildManagedProductionPlan("slides", fixture.snapshot);
  output.items[0].context_group_ids = ["context_group_2"];
  for (const productionScenes of [undefined, production.scenes]) {
    const assessment = assessStoredPresentationCandidate(JSON.stringify(output), fixture.snapshot, { ...options, productionScenes });
    assert.ok(hasCode(assessment.issues, "incorrect_context_group_assignment"));
  }
});
