import assert from "node:assert/strict";
import test from "node:test";
import { PAID_PROVIDER_FINANCIAL_FIELDS } from "../src/model/provider-submission.ts";

import { buildManagedProductionPlan, productionSceneSnapshot } from "../src/model/managed-production.ts";
import { buildPresentationSourceContract, providerFacingPresentationSourceContract } from "../src/model/presentation-source.ts";
import { assessStoredPresentationCandidate, buildDocumentPresentationSourceContract, PRESENTATION_ADAPTER_VERSION } from "../worker/openai-adapter.ts";
import { documentArtifactValidationIssues } from "../src/model/document-artifacts.ts";
import { bindPresentationPageAnchors, combinedSceneSnapshot, generateManagedArtifactDraft } from "../worker/managed-production.ts";

// Paid response and validation completion are snapshots of one immutable charge.
function completedProviderCalls(submissions) {
  const calls = new Map();
  const financial = (receipt) => Object.fromEntries(PAID_PROVIDER_FINANCIAL_FIELDS.filter((key) => Object.hasOwn(receipt, key)).map((key) => [key, receipt[key]]));
  for (const receipt of submissions.filter((entry) => entry.status === "completed")) {
    const previous = calls.get(receipt.clientRequestId);
    if (previous) assert.deepEqual(financial(receipt), financial(previous), "validation progress cannot rewrite an already observed charge");
    calls.set(receipt.clientRequestId, receipt);
  }
  return [...calls.values()];
}

const studies = [
  { key: "orchard", title: "Orchard irrigation", requirement: "Explain orchard irrigation and rainwater reservoirs.", evidence: "Orchard irrigation fills rainwater reservoirs during wet weather so fruit trees can survive dry spells.", emphasis: "Stored rainfall" },
  { key: "archives", title: "Archive retrieval", requirement: "Describe archive retrieval and the catalog index.", evidence: "Archive retrieval uses a catalog index to locate donated manuscripts without disturbing fragile pages.", emphasis: "Protected manuscripts" },
  { key: "harbor", title: "Harbor logistics", requirement: "Explain harbor logistics and dockside cranes.", evidence: "Harbor logistics places dockside cranes beside sheltered berths to transfer cargo safely during strong winds.", emphasis: "Sheltered berths" },
  { key: "polar", title: "Polar migration", requirement: "Describe polar migration and seasonal nesting.", evidence: "Polar migration follows seasonal nesting grounds where seabirds can raise chicks beside abundant coastal food.", emphasis: "Coastal food" },
  { key: "kiln", title: "Kiln ceramics", requirement: "Explain kiln ceramics and controlled cooling.", evidence: "Kiln ceramics require controlled cooling after firing because sudden thermal changes can crack finished pottery.", emphasis: "Finished pottery" },
  { key: "vineyard", title: "Vineyard trellises", requirement: "Describe vineyard trellises and canopy airflow.", evidence: "Vineyard trellises increase canopy airflow around grape clusters and help workers inspect developing fruit.", emphasis: "Developing fruit" },
  { key: "cavern", title: "Cavern acoustics", requirement: "Explain cavern acoustics and reflected echoes.", evidence: "Cavern acoustics produces reflected echoes when sound travels across curved stone walls beneath the surface.", emphasis: "Curved walls" },
  { key: "meadow", title: "Meadow pollinators", requirement: "Describe meadow pollinators and flowering corridors.", evidence: "Meadow pollinators travel along flowering corridors that connect nesting habitat with nectar throughout the growing season.", emphasis: "Nectar pathways" },
  { key: "canyon", title: "Canyon sediment", requirement: "Explain canyon sediment and exposed strata.", evidence: "Canyon sediment forms exposed strata that record successive river deposits along the steep valley walls.", emphasis: "River deposits" },
];

function outlineFixture({ count = 2, sharedBlock = false, unrelated = true } = {}) {
  const selected = studies.slice(0, count);
  const research = sharedBlock
    ? [{ block_id: "PRIVATE_MANAGED_RESEARCH_SHARED", type: "message", properties: { label: "Field research", text: selected.map((study) => study.evidence).join("\n\n") } }]
    : selected.map((study) => ({ block_id: `PRIVATE_MANAGED_RESEARCH_${study.key}`, type: "message", properties: { label: `${study.title} evidence`, text: study.evidence } }));
  return {
    facts: [
      ...research,
      ...(unrelated ? [{ block_id: "PRIVATE_MANAGED_UNRELATED", type: "message", properties: { text: "Comet geology studies rocky fragments and remote orbital debris." } }] : []),
      { block_id: "PRIVATE_MANAGED_OUTLINE", type: "format", properties: { text: [
        "Required supporting output 1: Executive Slides",
        "Use a readable field-notes presentation with no generated media.",
        ...selected.map((study, index) => `Slide ${index + 1}: ${study.title}. ${study.requirement}`),
        "",
        "Required supporting output 2: Scripted Scene",
        "FICTIONAL_SCENE_SENTINEL belongs only to a separate fictional screenplay about a museum visitor.",
      ].join("\n") } },
    ],
  };
}

const resolvedEvidence = (contract, slide) => contract.passages
  .filter((passage) => slide.evidencePassageIds.includes(passage.id))
  .map((passage) => ({ blockId: passage.sourceBlockId, content: passage.content }));

test("managed outline slides use resolved research without round-robin assignments or sibling Scene prose", () => {
  const snapshot = outlineFixture();
  const original = structuredClone(snapshot);
  const contract = buildPresentationSourceContract(snapshot);
  const production = buildManagedProductionPlan("slides", snapshot);

  assert.deepEqual(contract.sourceIssues, []);
  assert.deepEqual(contract.numberedOutline.map((slide) => slide.sourceMode), ["outline", "outline"]);
  assert.deepEqual(production.scenes.map((scene) => scene.title), studies.slice(0, 2).map((study) => study.title));
  assert.deepEqual(production.scenes.map((scene) => scene.sourceBlockIds), studies.slice(0, 2).map((study) => ["PRIVATE_MANAGED_OUTLINE", `PRIVATE_MANAGED_RESEARCH_${study.key}`]));
  assert.ok(production.claims.every((claim) => claim.blockId !== "PRIVATE_MANAGED_UNRELATED"));
  assert.doesNotMatch(JSON.stringify(production), /FICTIONAL_SCENE_SENTINEL|Scripted Scene/);
  for (const [index, scene] of production.scenes.entries()) {
    const evidence = resolvedEvidence(contract, contract.numberedOutline[index]);
    const claims = scene.sourceClaimIds.map((id) => production.claims.find((claim) => claim.id === id));
    for (const passage of evidence) assert.ok(claims.some((claim) => claim.blockId === passage.blockId && claim.text === passage.content));
    const scoped = productionSceneSnapshot(snapshot, scene);
    assert.doesNotMatch(JSON.stringify(scoped), /FICTIONAL_SCENE_SENTINEL|Comet geology/);
    assert.match(JSON.stringify(scoped), /Use a readable field-notes presentation with no generated media/);
    assert.ok(scoped.facts.some((fact) => fact.properties.text === studies[index].evidence));
    assert.ok(!JSON.stringify(scoped).includes(studies[1 - index].evidence));
  }
  assert.deepEqual(snapshot, original, "source scoping must not alter the historical source document");
});

test("managed outline evidence preserves explicit isolated chapter targets", () => {
  const membership = (number) => ({ context_set_id: `chapter-${number}`, name: `Chapter ${number}`, target: `Slide ${number}`, role: "slide_chapter", application: "isolate", relativity: 1, member_order: 0 });
  const snapshot = { facts: [1, 2].flatMap((number) => [
    { block_id: `outline-${number}`, type: "format", properties: { presentation_source_mode: "outline", text: `Slide ${number}: Irrigation chapter ${number}. Explain irrigation planning.`, combined_context_memberships: [membership(number)] } },
    { block_id: `research-${number}`, type: "message", properties: { text: number === 1 ? "Irrigation planning fills reservoirs beside the orchard." : "Irrigation planning follows drainage channels near the vineyard.", combined_context_memberships: [membership(number)] } },
  ]) };
  const production = buildManagedProductionPlan("slides", snapshot);
  assert.deepEqual(production.scenes.map((scene) => scene.sourceBlockIds), [["outline-1", "research-1"], ["outline-2", "research-2"]]);
  assert.deepEqual(production.scenes.map((scene) => scene.contextGroupIds), [["chapter-1"], ["chapter-2"]]);
  assert.doesNotMatch(JSON.stringify(productionSceneSnapshot(snapshot, production.scenes[0])), /vineyard|research-2/);
  assert.doesNotMatch(JSON.stringify(productionSceneSnapshot(snapshot, production.scenes[1])), /orchard|research-1/);

  const conflicting = structuredClone(snapshot);
  conflicting.facts[2].properties.combined_context_memberships[0].target = "Slide 1";
  conflicting.facts[3].properties.combined_context_memberships[0].target = "Slide 1";
  assert.throws(() => buildManagedProductionPlan("slides", conflicting), (error) => error.code === "presentation_context_target_conflict");
});

test("managed outline planning does not silently discard or redistribute mandatory unmatched research", () => {
  const snapshot = outlineFixture();
  snapshot.facts.find((fact) => fact.block_id === "PRIVATE_MANAGED_UNRELATED").locked = true;
  assert.throws(() => buildManagedProductionPlan("slides", snapshot), (error) => error.code === "presentation_outline_required_source_unassigned");

  const shared = outlineFixture({ sharedBlock: true, unrelated: false });
  shared.facts[0].locked = true;
  shared.facts[0].properties.text += "\n\nComet geology studies rocky fragments and remote orbital debris.";
  assert.throws(() => buildManagedProductionPlan("slides", shared), (error) => error.code === "presentation_outline_required_source_unassigned");
});

test("managed outlines retain global standing constraints without mislabeling them as research evidence", () => {
  const snapshot = outlineFixture();
  snapshot.standing_constraints = [
    { authority: "authored", axis: "audience", value: "Write for a museum visitor." },
    { authority: "authored", axis: "accessibility", value: "Keep labels readable without relying only on color." },
  ];
  const production = buildManagedProductionPlan("slides", snapshot);
  assert.deepEqual(production.claims.filter((claim) => claim.sourceKind === "standing-constraint").map((claim) => [claim.required, claim.continuity]), [[true, true], [true, true]]);
  assert.ok(production.scenes.every((scene) => scene.sourceBlockIds.every((id) => !id.startsWith("standing:"))));
  assert.deepEqual(productionSceneSnapshot(snapshot, production.scenes[0]).standing_constraints, snapshot.standing_constraints);
});

test("managed outlines reject unresolved coverage and unspecified expansion before any generation", () => {
  const snapshot = outlineFixture();
  assert.throws(() => buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 3 }), (error) => error.code === "presentation_outline_slide_count_conflict");
  const unresolved = structuredClone(snapshot);
  unresolved.facts = unresolved.facts.filter((fact) => fact.block_id !== "PRIVATE_MANAGED_RESEARCH_archives");
  assert.throws(() => buildManagedProductionPlan("slides", unresolved), (error) => error.code === "presentation_source_contract_invalid");
});

test("bounded managed pages rebuild the same evidence passages and retain global outline positions", () => {
  const snapshot = outlineFixture({ count: 9, sharedBlock: true });
  const original = structuredClone(snapshot);
  const contract = buildPresentationSourceContract(snapshot);
  const production = buildManagedProductionPlan("slides", snapshot);
  const numbers = contract.numberedOutline.map((slide) => slide.number);
  for (const [start, end] of [[0, 8], [8, 9]]) {
    const scenes = production.scenes.slice(start, end);
    const page = combinedSceneSnapshot(snapshot, scenes);
    const pageContract = buildPresentationSourceContract(page, { authoredSlideNumbers: numbers, requestedSlideCount: 9, itemCount: scenes.length });
    assert.match(JSON.stringify(page), /Use a readable field-notes presentation with no generated media/);
    assert.deepEqual(pageContract.sourceIssues, []);
    assert.equal(pageContract.authoredSlideCount, 9);
    assert.deepEqual(pageContract.numberedOutline.map((slide) => slide.number), numbers.slice(start, end));
    assert.deepEqual(pageContract.numberedOutline.map((slide) => slide.index), numbers.slice(start, end).map((number) => number - 1));
    for (const slide of pageContract.numberedOutline) {
      assert.deepEqual(resolvedEvidence(pageContract, slide), resolvedEvidence(contract, contract.numberedOutline.find((originalSlide) => originalSlide.number === slide.number)));
    }
    for (const [index, study] of studies.entries()) assert.equal(JSON.stringify(page).includes(study.evidence), index >= start && index < end, `page ${start + 1} must include only its exact supporting evidence`);
    assert.doesNotMatch(JSON.stringify(page), /FICTIONAL_SCENE_SENTINEL|Comet geology/);
  }
  assert.deepEqual(snapshot, original);
});

test("bounded managed pages cannot reopen omitted passages through same-block claim or block aliases", () => {
  const snapshot = outlineFixture({ count: 9, sharedBlock: true });
  snapshot.claims = studies.map((study) => ({ id: `claim-${study.key}`, blockId: "PRIVATE_MANAGED_RESEARCH_SHARED", text: study.evidence }));
  snapshot.facts[0].claims = structuredClone(snapshot.claims);
  snapshot.facts[0].properties.claims = structuredClone(snapshot.claims);
  snapshot.blocks = structuredClone(snapshot.facts);
  const original = structuredClone(snapshot);
  const production = buildManagedProductionPlan("slides", snapshot);
  const page = combinedSceneSnapshot(snapshot, production.scenes.slice(8));
  assert.deepEqual(page.claims.map((claim) => claim.id), ["claim-canyon"]);
  assert.deepEqual(page.facts.find((fact) => fact.block_id === "PRIVATE_MANAGED_RESEARCH_SHARED").claims.map((claim) => claim.id), ["claim-canyon"]);
  assert.deepEqual(page.facts.find((fact) => fact.block_id === "PRIVATE_MANAGED_RESEARCH_SHARED").properties.claims.map((claim) => claim.id), ["claim-canyon"]);
  for (const study of studies.slice(0, 8)) assert.ok(!JSON.stringify(page).includes(study.evidence));
  assert.match(JSON.stringify(page), /Canyon sediment/);
  assert.doesNotMatch(JSON.stringify(page), /FICTIONAL_SCENE_SENTINEL|Comet geology/);
  assert.deepEqual(snapshot, original);
});

test("research assignments remain stable when a bounded page omits unrelated source blocks", () => {
  const evidence = [
    "Cobalt lichen develops on damp granite.",
    "Cobalt lichen covers the western cliff.",
    "Cobalt lichen survives beneath heavy snow.",
    "Harbor cranes unload cargo onto docks.",
    "Meadow pollinators follow flowering corridors.",
    "Archive lookup searches catalog entries.",
    "Canyon sediment forms exposed strata.",
  ];
  const snapshot = { facts: [
    ...evidence.map((text, index) => ({ block_id: `stable-research-${index}`, type: "message", properties: { text } })),
    { block_id: "stable-outline", type: "format", properties: { text: "Presentation outline\nSlide 1 — Lichen habitat. Explain cobalt lichen habitats.\nSlide 2 — Cargo handling. Explain harbor cranes." } },
  ] };
  const contract = buildPresentationSourceContract(snapshot);
  const production = buildManagedProductionPlan("slides", snapshot);
  const page = productionSceneSnapshot(snapshot, production.scenes[0]);
  const rebuilt = buildPresentationSourceContract(page, { authoredSlideNumbers: [1, 2], itemCount: 1, requestedSlideCount: 2 });
  assert.equal(resolvedEvidence(contract, contract.numberedOutline[0]).length, 3);
  assert.deepEqual(rebuilt.sourceIssues, []);
  assert.deepEqual(resolvedEvidence(rebuilt, rebuilt.numberedOutline[0]), resolvedEvidence(contract, contract.numberedOutline[0]));
});

test("fully authored managed slides retain their manuscript assignments and supporting source behavior", () => {
  const snapshot = { facts: [
    { block_id: "authored-manuscript", type: "direction", locked: true, properties: { text: `Slide 1 — ${studies[0].title}\n${studies[0].evidence}\n\nSlide 2 — ${studies[1].title}\n${studies[1].evidence}` } },
    { block_id: "authored-support", type: "message", properties: { text: "A preserved editorial source remains available to the authored manuscript." } },
  ] };
  const production = buildManagedProductionPlan("slides", snapshot, { requestedSlideCount: 3 });
  assert.equal(production.authoredSlideCount, 2);
  assert.equal(production.scenes.length, 3);
  assert.deepEqual(production.scenes.slice(0, 2).map((scene) => scene.title), studies.slice(0, 2).map((study) => study.title));
  assert.ok(production.scenes[0].sourceBlockIds.includes("authored-support"));
  assert.deepEqual(production.scenes[1].sourceBlockIds, ["authored-manuscript"]);
  assert.deepEqual(production.scenes[2].sourceBlockIds, ["authored-manuscript"]);
});

test("real managed contract and adapter paths accept two bounded mocked pages with legitimate research citations", async (t) => {
  const snapshot = outlineFixture({ count: 9, sharedBlock: true });
  const production = buildManagedProductionPlan("slides", snapshot);
  const requests = [];
  const presentation = { aspect_ratio: "16:9", theme: "Field studies", footer_label: "Research collection", style_preset: "field-notes", mode: "light", palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" } };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const request = JSON.parse(String(init.body));
    const provider = JSON.parse(request.input);
    requests.push(provider);
    assert.ok(provider.production?.assigned_scenes, "this fixture should need no repair");
    assert.doesNotMatch(JSON.stringify(request), /FICTIONAL_SCENE_SENTINEL|Comet geology|PRIVATE_MANAGED_/);
    const items = provider.production.assigned_scenes.map((scene) => {
      const study = studies[scene.narrative_order - 1];
      const requirement = provider.presentation_source.outline.find((slide) => slide.number === scene.narrative_order);
      const passage = provider.presentation_source.passages.find((candidate) => requirement.evidencePassageIds.includes(candidate.id) && candidate.content === study.evidence);
      assert.ok(passage, `global slide ${scene.narrative_order} needs its original research passage`);
      return { title: study.title, body: study.evidence, notes: study.evidence, image_prompt: "", context_group_ids: [], slide: {
        layout: scene.narrative_order === 1 ? "cover" : scene.narrative_order === 9 ? "closing" : "split",
        kicker: "", bullets: [], source_order: scene.narrative_order, source_ids: [passage.sourceAlias],
        citations: [{ source_id: passage.sourceAlias, label: "Field research", excerpt: passage.content }],
        visual: { kind: "hero-type", label: "", value: study.emphasis, data: [] },
      } };
    });
    return Response.json({ id: `mock-outline-page-${requests.length}`, model: "gpt-5.6-terra", output_text: JSON.stringify({ title: "Field studies", summary: "Independent research observations.", content_markdown: items.map((item) => item.body).join("\n\n"), presentation, items }), usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
  });

  const result = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-5.6-terra" }, "isolated-test-actor", "slides", { documentTitle: "Isolated managed outline fixture", snapshot, production, requestedSlideCount: 9, presentationStyle: "field-notes", presentationFidelity: "faithful" });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((provider) => provider.presentation_source.outline.map((slide) => slide.number)), [[1, 2, 3, 4, 5, 6, 7, 8], [9]]);
  assert.equal(result.output.items.length, 9);
  assert.deepEqual(result.output.items.map((item) => item.slide.sourceOrder), studies.map((_, index) => index + 1));
  assert.ok(result.output.items.every((item) => item.slide.sourceIds.includes("PRIVATE_MANAGED_RESEARCH_SHARED")));
  assert.doesNotMatch(result.output.content_markdown, /FICTIONAL_SCENE_SENTINEL|Explain orchard|Describe archive/);
  assert.equal(result.inputReceipt.provider_request_count, 2);
  assert.equal(result.inputReceipt.whole_work_validation.repaired_pages, 0);
  assert.deepEqual(result.inputReceipt.whole_work_validation.issues, []);
  assert.equal(result.usage.totalTokens, 300);
});

function managedAnchorFixture(t, { alter = () => {}, configure = () => {} } = {}) {
  const snapshot = outlineFixture({ count: 9, sharedBlock: true }); configure(snapshot);
  const production = buildManagedProductionPlan("slides", snapshot);
  const originalSnapshot = structuredClone(snapshot), originalProduction = structuredClone(production);
  const requests = [], rawResponses = [], attempts = [], receipts = [], receiptCopies = [], submissions = [];
  const presentation = { aspect_ratio: "16:9", theme: "Field studies", footer_label: "Research collection", style_preset: "field-notes", mode: "light", palette: { background: "#edf1ef", foreground: "#14211d", accent: "#287260", muted: "#586b64", surface: "#d9e3df" } };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.method, "POST");
    const request = JSON.parse(String(init.body)), provider = JSON.parse(request.input);
    requests.push({ request, provider });
    assert.ok(provider.production?.assigned_scenes);
    assert.doesNotMatch(JSON.stringify(request), /FICTIONAL_SCENE_SENTINEL|Comet geology|PRIVATE_MANAGED_/);
    const items = provider.production.assigned_scenes.map((scene) => {
      const study = studies[scene.narrative_order - 1];
      const requirement = provider.presentation_source.outline.find((slide) => slide.number === scene.narrative_order);
      const passage = provider.presentation_source.passages.find((candidate) => requirement.evidencePassageIds.includes(candidate.id) && candidate.content === study.evidence);
      assert.ok(passage, "every returned anchor is copied from this exact page's disclosed evidence");
      return { title: study.title, body: study.evidence, notes: study.evidence, image_prompt: "", context_group_ids: scene.context_keys ?? [], slide: {
        layout: scene.narrative_order === 1 ? "cover" : scene.narrative_order === 9 ? "closing" : "split",
        kicker: "", bullets: [], source_order: scene.narrative_order, source_ids: [passage.sourceAlias],
        citations: [{ source_id: passage.sourceAlias, label: "Field research", excerpt: passage.content, anchor: passage.id }],
        visual: { kind: "hero-type", label: "", value: study.emphasis, data: [] },
      } };
    });
    const output = { title: "Field studies", summary: "Independent research observations.", content_markdown: items.map((item) => item.body).join("\n\n"), presentation: structuredClone(presentation), items };
    alter({ output, provider, request, call: requests.length });
    const id = "mock-exact-page-" + requests.length, raw = JSON.stringify(output);
    rawResponses.push({ id, raw });
    return Response.json({ id, model: "gpt-5.6-terra", output_text: raw, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
  });
  const sourceOptions = (pageIndex) => {
    const start = pageIndex * 8, scenes = production.scenes.slice(start, start + 8);
    return { itemCount: scenes.length, requestedSlideCount: 9, presentationStyle: "field-notes", presentationFidelity: "faithful",
      productionScenes: scenes, productionPage: { pageIndex, pageCount: 2, globalStartIndex: start, totalItems: 9,
        phase: pageIndex ? "final" : "opening", priorSummary: "", priorEnding: "", priorVisibleCopy: [],
        authoredSlideNumbers: buildPresentationSourceContract(snapshot).numberedOutline.map((slide) => slide.number) } };
  };
  const run = () => generateManagedArtifactDraft({ OPENAI_API_KEY: "isolated-mock-only", OPENAI_MODEL: "gpt-5.6-terra" }, "isolated-test-actor", "slides", {
    documentTitle: "Exact page anchor test", snapshot, production, requestedSlideCount: 9, presentationStyle: "field-notes", presentationFidelity: "faithful",
    plannerAttempt: (attempt) => attempts.push(structuredClone(attempt)),
    plannerResponse: (receipt) => { receipts.push(receipt); receiptCopies.push(structuredClone(receipt)); },
    onProviderSubmission: (submission) => submissions.push(structuredClone(submission)),
  });
  return { snapshot, originalSnapshot, production, originalProduction, requests, rawResponses, attempts, receipts, receiptCopies, submissions, sourceOptions, run };
}

test("page anchors R2: nine valid anchored slides use two real adapter calls and retain truthful page-local raw evidence", async (t) => {
  const f = managedAnchorFixture(t), result = await f.run();
  assert.equal(PRESENTATION_ADAPTER_VERSION, "2026-09-02-durable-calls-source-bookends-v7");
  assert.equal(f.requests.length, 2); assert.equal(result.output.items.length, 9);
  const canonical = buildDocumentPresentationSourceContract(f.snapshot, { itemCount: 9, requestedSlideCount: 9, presentationStyle: "field-notes", presentationFidelity: "faithful" });
  const expected = studies.map((study) => canonical.passages.find((passage) => passage.content === study.evidence).id);
  assert.deepEqual(result.output.items.map((item) => item.slide.citations[0].anchor), expected);
  assert.equal(expected[8], "passage_009");
  assert.deepEqual(f.requests.map(({ provider }) => provider.presentation_source.passages.length), [8, 1]);
  assert.equal(f.requests[1].provider.presentation_source.passages[0].id, "passage_001");
  assert.equal(JSON.parse(f.rawResponses[1].raw).items[0].slide.citations[0].anchor, "passage_001");
  assert.equal(result.inputReceipt.pages[1].providerInput.presentation_source.passages[0].id, "passage_001");
  assert.deepEqual(result.inputReceipt.pages.map((page) => page.providerInput), f.requests.map(({ provider }) => provider));
  assert.deepEqual(documentArtifactValidationIssues("slides", result.output, { itemCount: 9, sourceContract: canonical, requireSourceGrounding: true, requireAllProtectedContent: true }), []);

  for (const pageIndex of [0, 1]) {
    const options = f.sourceOptions(pageIndex), page = combinedSceneSnapshot(f.snapshot, options.productionScenes);
    const assessment = assessStoredPresentationCandidate(f.rawResponses[pageIndex].raw, page, options);
    assert.deepEqual(assessment.issues, [], "retained raw candidates use their original page-local authority, not global IDs");
    assert.deepEqual(providerFacingPresentationSourceContract(assessment.sourceContract).passages, f.requests[pageIndex].provider.presentation_source.passages);
    assert.deepEqual(assessment.output.items.map((item) => item.slide.citations[0].anchor), JSON.parse(f.rawResponses[pageIndex].raw).items.map((item) => item.slide.citations[0].anchor));
  }
  assert.deepEqual(result.usage, { inputTokens: 200, outputTokens: 100, totalTokens: 300 });
  assert.deepEqual(result.responseIds, ["mock-exact-page-1", "mock-exact-page-2"]);
  assert.deepEqual(f.attempts.map((attempt) => attempt.usage.totalTokens), [150, 300]);
  assert.equal(result.inputReceipt.provider_request_count, 2); assert.equal(result.inputReceipt.whole_work_validation.repaired_pages, 0);
  assert.deepEqual(f.receipts, f.receiptCopies); assert.deepEqual(f.receipts.map((receipt) => receipt.candidateRaw), f.rawResponses.map((response) => response.raw));
  assert.deepEqual(f.snapshot, f.originalSnapshot); assert.deepEqual(f.production, f.originalProduction);
  assert.equal(completedProviderCalls(f.submissions).length, 2);
  assert.deepEqual(completedProviderCalls(f.submissions).map((submission) => submission.costMicrousd), [800, 800]);
});

for (const repair of ["adapter", "whole-work"]) test("page anchors R2: " + repair + " repair reuses exact page identities without changing paid history", async (t) => {
  const f = managedAnchorFixture(t, { alter: ({ output, provider, request }) => {
    if (provider.production.page.page_index !== 1) return;
    if (repair === "adapter" && request.text.format.name !== "document_slides_repair") output.items[0].body = "";
    if (repair === "whole-work" && !provider.production.page.repair_issues?.length) output.presentation.theme = "Different authored movement";
  } });
  const result = await f.run();
  assert.equal(f.requests.length, 3); assert.equal(result.output.items.length, 9);
  const lastPages = f.requests.slice(1).map(({ provider }) => provider.presentation_source);
  assert.deepEqual(lastPages[0], lastPages[1], "both paid attempts disclose exactly the same bounded page source");
  assert.deepEqual(f.rawResponses.slice(1).map(({ raw }) => JSON.parse(raw).items[0].slide.citations[0].anchor), ["passage_001", "passage_001"]);
  assert.equal(result.output.items[8].slide.citations[0].anchor, "passage_009");
  assert.equal(result.inputReceipt.whole_work_validation.repaired_pages, repair === "whole-work" ? 1 : 0);
  assert.equal(f.requests[2].request.text.format.name, repair === "adapter" ? "document_slides_repair" : "document_slides");
  assert.equal(result.inputReceipt.provider_request_count, 3);
  assert.deepEqual(result.usage, { inputTokens: 300, outputTokens: 150, totalTokens: 450 });
  assert.deepEqual(result.responseIds, ["mock-exact-page-1", "mock-exact-page-2", "mock-exact-page-3"]);
  assert.deepEqual(f.attempts.map((attempt) => attempt.usage.totalTokens), [150, 300, 450]);
  assert.deepEqual(f.receipts, f.receiptCopies); assert.deepEqual(f.receipts.map((receipt) => receipt.candidateRaw), f.rawResponses.map((response) => response.raw));
  assert.deepEqual(f.snapshot, f.originalSnapshot); assert.deepEqual(f.production, f.originalProduction);
  assert.equal(completedProviderCalls(f.submissions).length, 3);
});

for (const anchor of ["passage_002", "passage_009", "passage_999", "passage_bogus", "PASSAGE_001", "legacy_passage_bad"]) {
  test("page anchors R2: an undisclosed or malformed second-page anchor remains rejected: " + anchor, async (t) => {
    const f = managedAnchorFixture(t, { alter: ({ output, provider }) => {
      if (provider.production.page.page_index === 1) output.items[0].slide.citations[0].anchor = anchor;
    } });
    await assert.rejects(f.run(), (error) => error.detail?.code === "source_fidelity_validation_failed"
      && error.detail.validationIssues.some((issue) => issue.code === "incorrect_citation_anchor"));
    assert.equal(f.requests.length, 3, "one correct first page plus one bounded repair of the rejected second page");
    assert.equal(f.requests[2].request.text.format.name, "document_slides_repair");
    assert.deepEqual(f.requests[1].provider.presentation_source, f.requests[2].provider.presentation_source);
    assert.deepEqual(f.attempts.map((attempt) => attempt.usage.totalTokens), [150, 300, 450]);
    assert.deepEqual(f.receipts, f.receiptCopies); assert.deepEqual(f.receipts.map((receipt) => receipt.candidateRaw), f.rawResponses.map((response) => response.raw));
    assert.equal(completedProviderCalls(f.submissions).length, 3);
    const options = f.sourceOptions(1), assessment = assessStoredPresentationCandidate(f.rawResponses[1].raw, combinedSceneSnapshot(f.snapshot, options.productionScenes), options);
    assert.ok(assessment.issues.some((issue) => issue.code === "incorrect_citation_anchor"), "private raw assessment retains the original anchor failure");
  });
}

test("page anchors R2: wrong assigned passage cannot be repaired by ordinal or matching citation text", async (t) => {
  const f = managedAnchorFixture(t, { alter: ({ output, provider }) => {
    if (provider.production.page.page_index === 0) output.items[0].slide.citations[0].anchor = "passage_002";
  } });
  await assert.rejects(f.run(), (error) => error.detail?.code === "source_fidelity_validation_failed");
  assert.equal(f.requests.length, 2, "the invalid first page never admits the second page");
  assert.ok(f.requests.every(({ provider }) => provider.production.page.page_index === 0));
  assert.deepEqual(f.attempts.map((attempt) => attempt.usage.totalTokens), [150, 300]);
});

test("page anchors R2: ambiguous duplicate passage identity fails before any provider submission", async (t) => {
  const f = managedAnchorFixture(t, { configure: (snapshot) => { snapshot.facts[0].properties.text += "\n\n" + studies[8].evidence; } });
  await assert.rejects(f.run(), (error) => error.detail?.code === "presentation_source_contract_invalid");
  assert.equal(f.requests.length, 0); assert.equal(f.submissions.length, 0); assert.equal(f.receipts.length, 0);
  assert.deepEqual(f.snapshot, f.originalSnapshot); assert.deepEqual(f.production, f.originalProduction);
});

function isolatedPageAnchorContracts() {
  const membership = (number) => ({ context_set_id: "anchor-chapter-" + number, name: "Chapter " + number,
    target: "Slide " + number, role: "slide_chapter", application: "isolate", relativity: 1, member_order: 0 });
  const snapshot = { facts: [1, 2].flatMap((number) => [
    { block_id: "anchor-outline-" + number, type: "format", properties: { presentation_source_mode: "outline",
      text: "Slide " + number + ": " + (number === 1 ? "Reservoir protection" : "Dry weather continuity") + ". Explain orchard irrigation.",
      combined_context_memberships: [membership(number)] } },
    { block_id: "anchor-research-" + number, type: "message", locked: true, properties: {
      text: studies[0].evidence, combined_context_memberships: [membership(number)] } },
  ]) };
  const production = buildManagedProductionPlan("slides", snapshot);
  const canonical = buildDocumentPresentationSourceContract(snapshot, { itemCount: 2, requestedSlideCount: 2 });
  const page = buildDocumentPresentationSourceContract(combinedSceneSnapshot(snapshot, production.scenes.slice(1)), {
    itemCount: 1, requestedSlideCount: 2, productionPage: {
      pageIndex: 1, pageCount: 2, globalStartIndex: 1, totalItems: 2, phase: "final",
      priorSummary: "", priorEnding: "", priorVisibleCopy: [], authoredSlideNumbers: [1, 2],
    },
  });
  return { canonical, page };
}

test("page anchors R2: identical source text in different owners keeps distinct canonical passage identity", () => {
  const { canonical, page } = isolatedPageAnchorContracts(), original = structuredClone({ canonical, page });
  assert.equal(canonical.passages.length, 2);
  assert.equal(canonical.passages[0].content, canonical.passages[1].content);
  assert.notEqual(canonical.passages[0].sourceBlockId, canonical.passages[1].sourceBlockId);
  const mapping = bindPresentationPageAnchors(page, canonical);
  assert.deepEqual([...mapping], [["passage_001", "passage_002"]], "a page-local ordinal never chooses another evidence owner");
  assert.deepEqual({ canonical, page }, original);
});

for (const change of ["added membership", "different owner", "out-of-target extra evidence", "changed slide scope", "weakened required evidence"]) {
  test("page anchors R2: the pre-dispatch identity proof refuses " + change, () => {
    const { canonical, page } = isolatedPageAnchorContracts(), original = structuredClone(canonical);
    if (change === "added membership") page.passages[0].contextGroupIds.push("forged-unassigned-group");
    if (change === "different owner") {
      page.passages[0].sourceBlockId = canonical.passages[0].sourceBlockId;
      page.passages[0].contextGroupIds = [...canonical.passages[0].contextGroupIds];
    }
    if (change === "out-of-target extra evidence") page.passages.push({ ...structuredClone(canonical.passages[0]), id: "passage_002" });
    if (change === "changed slide scope") page.numberedOutline[0].contextGroupIds = [...canonical.numberedOutline[0].contextGroupIds];
    if (change === "weakened required evidence") page.passages[0].required = false;
    assert.throws(() => bindPresentationPageAnchors(page, canonical), (error) => error.detail?.code === "presentation_source_contract_invalid");
    assert.deepEqual(canonical, original, "the original source contract is never repaired or recertified in place");
  });
}

const sharedAnchorGroups = ["PRIVATE_SHARED_ANCHOR_GROUP_ONE", "PRIVATE_SHARED_ANCHOR_GROUP_NINE"];
function configureSharedAnchorGraph(snapshot, sharedNumber) {
  const [groupOne, groupLater] = sharedAnchorGroups;
  snapshot.facts[0].properties.text = [studies[0].evidence, studies[sharedNumber - 1].evidence].join("\n\n");
  snapshot.facts.find((fact) => fact.block_id === "PRIVATE_MANAGED_OUTLINE").properties.text =
    "Presentation outline\n" + studies.map((study, index) => "Slide " + (index + 1) + ": " + study.title + ". " + study.requirement).join("\n");
  snapshot.facts.push(...studies.filter((_, index) => index !== 0 && index !== sharedNumber - 1).map((study) => ({ block_id: "PRIVATE_MANAGED_RESEARCH_" + study.key, type: "message", properties: { label: study.title + " evidence", text: study.evidence } })),
    { block_id: groupOne, type: "format", properties: { context_group: { name: "Opening research chapter", target: "Slide 1", role: "slide_chapter", application: "isolate", relativity: 1 } } },
    { block_id: groupLater, type: "format", properties: { context_group: { name: "Reused research chapter", target: "Slide " + sharedNumber, role: "slide_chapter", application: "isolate", relativity: 1 } } });
  snapshot.relationships = [
    { relation_id: "group-one-outline", from_block_id: groupOne, to_block_id: "PRIVATE_MANAGED_OUTLINE", kind: "context_contains", properties: { member_order: 0 } },
    { relation_id: "group-one-research", from_block_id: groupOne, to_block_id: "PRIVATE_MANAGED_RESEARCH_SHARED", kind: "context_contains", properties: { member_order: 1 } },
    { relation_id: "group-later-research", from_block_id: groupLater, to_block_id: "PRIVATE_MANAGED_RESEARCH_SHARED", kind: "context_contains", properties: { member_order: 0 } },
  ];
}

test("page anchors R2: relationship-scoped shared research keeps canonical identity across two narrowed provider pages", async (t) => {
  const groupOne = "PRIVATE_SHARED_ANCHOR_GROUP_ONE", groupNine = "PRIVATE_SHARED_ANCHOR_GROUP_NINE";
  const f = managedAnchorFixture(t, { configure: (snapshot) => configureSharedAnchorGraph(snapshot, 9) });
  const canonical = buildDocumentPresentationSourceContract(f.snapshot, { itemCount: 9, requestedSlideCount: 9 });
  const canonicalShared = canonical.passages.filter((passage) => passage.sourceBlockId === "PRIVATE_MANAGED_RESEARCH_SHARED");
  assert.equal(canonicalShared.length, 2);
  assert.ok(canonicalShared.every((passage) => JSON.stringify([...passage.contextGroupIds].sort()) === JSON.stringify([groupOne, groupNine].sort())));
  for (const pageIndex of [0, 1]) {
    const options = f.sourceOptions(pageIndex), snapshot = combinedSceneSnapshot(f.snapshot, options.productionScenes);
    const page = buildDocumentPresentationSourceContract(snapshot, options);
    const shared = page.passages.filter((passage) => passage.sourceBlockId === "PRIVATE_MANAGED_RESEARCH_SHARED");
    assert.equal(shared.length, 2);
    assert.ok(shared.every((passage) => JSON.stringify(passage.contextGroupIds) === JSON.stringify([pageIndex ? groupNine : groupOne])));
    const mapping = bindPresentationPageAnchors(page, canonical);
    for (const passage of shared) assert.equal(mapping.get(passage.id), canonicalShared.find((original) => original.content === passage.content).id);
  }
  const result = await f.run();
  assert.equal(f.requests.length, 2); assert.equal(result.output.items.length, 9);
  assert.deepEqual(result.output.items[0].context_group_ids, [groupOne]);
  assert.deepEqual(result.output.items[8].context_group_ids, [groupNine]);
  for (const index of [0, 8]) assert.equal(result.output.items[index].slide.citations[0].anchor, canonicalShared.find((passage) => passage.content === studies[index].evidence).id);
  assert.deepEqual(result.inputReceipt.whole_work_validation.issues, []);
  assert.equal(result.usage.totalTokens, 300); assert.deepEqual(f.receipts, f.receiptCopies);
  assert.deepEqual(f.snapshot, f.originalSnapshot); assert.deepEqual(f.production, f.originalProduction);
  assert.ok(f.requests.every(({ request }) => !/PRIVATE_SHARED_ANCHOR_GROUP_/u.test(JSON.stringify(request))));
});

test("page anchors R2: same-page shared research infers only each granted chapter in managed and retained manual output", async (t) => {
  const f = managedAnchorFixture(t, { configure: (snapshot) => configureSharedAnchorGraph(snapshot, 8) });
  const result = await f.run();
  assert.equal(f.requests.length, 2);
  for (const [index, group] of [[0, sharedAnchorGroups[0]], [7, sharedAnchorGroups[1]]]) {
    assert.deepEqual(result.output.items[index].context_group_ids, [group]);
  }
  const { productionScenes, ...manualOptions } = f.sourceOptions(0);
  const page = combinedSceneSnapshot(f.snapshot, productionScenes);
  const assessment = assessStoredPresentationCandidate(f.rawResponses[0].raw, page, manualOptions);
  assert.deepEqual(assessment.issues, []);
  assert.deepEqual(assessment.output.items[0].context_group_ids, [sharedAnchorGroups[0]]);
  assert.deepEqual(assessment.output.items[7].context_group_ids, [sharedAnchorGroups[1]]);
  const foreign = f.requests[0].provider.production.assigned_scenes.find((scene) => scene.narrative_order === 8).context_keys[0];
  const altered = JSON.parse(f.rawResponses[0].raw);
  altered.items[0].context_group_ids = [foreign];
  const invalid = assessStoredPresentationCandidate(JSON.stringify(altered), page, manualOptions);
  assert.ok(invalid.issues.some((issue) => issue.code === "incorrect_context_group_assignment"), "explicit foreign groups remain invalid without managed scenes too");
  assert.ok(invalid.output.items[0].context_group_ids.includes(sharedAnchorGroups[1]), "validation does not silently erase the provider's invalid claim");
  assert.deepEqual(f.receipts, f.receiptCopies);
  assert.equal(result.usage.totalTokens, 300);
});

test("page anchors R2: a provider's explicit foreign chapter is never filtered into an accepted shared-source slide", async (t) => {
  const f = managedAnchorFixture(t, {
    configure: (snapshot) => configureSharedAnchorGraph(snapshot, 8),
    alter: ({ output, provider }) => {
      if (provider.production.page.page_index !== 0) return;
      const foreign = provider.production.assigned_scenes.find((scene) => scene.narrative_order === 8).context_keys[0];
      output.items[0].context_group_ids = [foreign];
    },
  });
  await assert.rejects(f.run(), (error) => error.detail?.code === "source_fidelity_validation_failed"
    && error.detail.validationIssues.some((issue) => issue.code === "incorrect_context_group_assignment"));
  assert.equal(f.requests.length, 2, "one invalid page and its bounded repair; no later page is purchased");
  assert.deepEqual(f.attempts.map((attempt) => attempt.usage.totalTokens), [150, 300]);
  assert.deepEqual(f.receipts, f.receiptCopies);
  assert.ok(f.rawResponses.every(({ raw }) => JSON.parse(raw).items[0].context_group_ids.length === 1));
});

for (const currentIssue of ["late-page ambiguous requirement", "new mandatory unmatched research"]) {
  test("page anchors R2: a retained plan never dispatches before the complete current source preflight: " + currentIssue, async (t) => {
    const f = managedAnchorFixture(t);
    if (currentIssue === "late-page ambiguous requirement") {
      const outline = f.snapshot.facts.find((fact) => fact.block_id === "PRIVATE_MANAGED_OUTLINE");
      outline.properties.text = outline.properties.text.replace(studies[8].requirement, studies[8].requirement + " Make this magical.");
    } else {
      f.snapshot.facts.find((fact) => fact.block_id === "PRIVATE_MANAGED_UNRELATED").locked = true;
    }
    const currentSnapshot = structuredClone(f.snapshot);
    const current = buildDocumentPresentationSourceContract(f.snapshot, { itemCount: 9, requestedSlideCount: 9 });
    assert.ok(current.sourceIssues.length);
    if (currentIssue === "late-page ambiguous requirement") {
      assert.ok(current.sourceIssues.some((issue) => issue.code === "ambiguous_presentation_requirement" && issue.parameters?.slideNumber === 9));
      const page = combinedSceneSnapshot(f.snapshot, f.production.scenes.slice(0, 8));
      assert.deepEqual(buildDocumentPresentationSourceContract(page, f.sourceOptions(0)).sourceIssues, [], "the first page alone cannot detect the later current-source problem");
    } else assert.ok(current.sourceIssues.some((issue) => issue.code === "unassigned_required_presentation_source"));
    await assert.rejects(f.run(), (error) => error.detail?.code === "presentation_source_contract_invalid");
    assert.equal(f.requests.length, 0, "all canonical source issues are resolved before any paid page is dispatched");
    assert.equal(f.submissions.length, 0); assert.equal(f.receipts.length, 0); assert.equal(f.attempts.length, 0);
    assert.deepEqual(f.snapshot, currentSnapshot); assert.deepEqual(f.production, f.originalProduction);
  });
}
