import assert from "node:assert/strict";
import test from "node:test";

import { buildManagedProductionPlan, productionSceneSnapshot } from "../src/model/managed-production.ts";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { combinedSceneSnapshot, generateManagedArtifactDraft } from "../worker/managed-production.ts";

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
    return Response.json({ id: `mock-outline-page-${requests.length}`, model: "gpt-managed-outline-test", output_text: JSON.stringify({ title: "Field studies", summary: "Independent research observations.", content_markdown: items.map((item) => item.body).join("\n\n"), presentation, items }), usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
  });

  const result = await generateManagedArtifactDraft({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "gpt-managed-outline-test" }, "isolated-test-actor", "slides", { documentTitle: "Isolated managed outline fixture", snapshot, production, requestedSlideCount: 9, presentationStyle: "field-notes", presentationFidelity: "faithful" });
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
