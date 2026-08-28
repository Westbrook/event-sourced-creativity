import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPresentationSourceContract,
  inferPresentationSourceOutline,
  presentationCitationEvidenceChecks,
  providerFacingPresentationSourceContract,
  scopePresentationSourceSnapshot,
  validatePresentationSourceCoverage,
} from "../src/model/presentation-source.ts";

// Independently authored fixtures; no rejected provider response is copied here.
const orchard = "Orchard yield reached 12.50% with drip irrigation. Frost risk stayed at -3.5°C. The pilot remains proposed.";
const archive = "Archive retrieval now covers 28 catalog records. The archival index retains provenance.";
const scene = 'Required supporting output2: Scripted Scene\nScene-only costume direction. “This fictional speaker belongs only in the companion scene.” — Fictional Reviewer\nFull program: 12–16 weeks. Style: nocturne.\nSlide 1: A prop in the fictional scene.';
function snapshot() {
  return { facts: [
    { block_id: "private-orchard", type: "message", properties: { label: "Orchard measurements", text: `${orchard}\n\nCompost logistics need a separate depot.` } },
    { block_id: "private-archive", type: "message", properties: { label: "Archive study", text: archive } },
    { block_id: "private-unrelated", type: "direction", properties: { text: "Generic proposed research output evidence. Volcanic basalt forms below the ocean." } },
    { block_id: "private-outline", type: "format", properties: { text: [
      "Required supporting output1: Executive Slides",
      "Exactly two slides; readable native text. Each pilot feature must be labeled proposed.",
      "Slide1: Orchard yield. Explain orchard yield and drip irrigation.",
      "Slide2: Archive retrieval. Describe archive retrieval and catalog records.",
      "", scene,
    ].join("\n") } },
    { block_id: "private-negative", type: "exclusion", intent: "avoid", properties: { text: "Never invent measured success or new paid media." } },
  ], relationships: [] };
}
function contract(value = snapshot()) { return buildPresentationSourceContract(value, { requestedSlideCount: 2, fidelity: "faithful" }); }
function items(value = contract()) {
  return value.numberedOutline.map((source, index) => {
    const passage = value.passages.find((entry) => source.evidencePassageIds.includes(entry.id));
    return { title: source.title, body: index ? archive : orchard, notes: "", slide: { sourceIds: [passage.sourceAlias],
      citations: [{ sourceId: passage.sourceAlias, anchor: passage.id, excerpt: index ? archive : orchard }],
      visual: { kind: "hero-type", label: "", value: "", data: [] } } };
  });
}
const issues = (output, source) => validatePresentationSourceCoverage(output, source, { requireEverySlideSource: true, requireAllProtectedContent: true });
const hasCode = (entries, code) => entries.some((entry) => entry.code === code);

test("short output directions receive bounded, distinct supporting research instead of their Format block", () => {
  const source = contract();
  assert.equal(source.schemaVersion, 2);
  assert.deepEqual(source.sourceIssues, []);
  assert.deepEqual(source.numberedOutline.map((slide) => slide.title), ["Orchard yield", "Archive retrieval"]);
  assert.ok(source.numberedOutline.every((slide) => slide.sourceMode === "outline" && slide.evidenceAssignment === "matched"));
  assert.deepEqual(source.numberedOutline.map((slide) => source.passages.filter((passage) => slide.evidencePassageIds.includes(passage.id)).map((passage) => passage.sourceBlockId)), [["private-orchard"], ["private-archive"]]);
  assert.ok(source.numberedOutline.every((slide) => slide.sourceBlockId === "private-outline"), "requirement ownership remains distinct from evidence");
  assert.deepEqual(issues(items(source), source), []);
});

test("sibling boundaries precede outline, facts, quotes, roadmap, style, and provider-context extraction", () => {
  const input = snapshot(), before = structuredClone(input), source = contract(input);
  assert.equal(source.numberedOutline.length, 2, "numbered props in a sibling output are not slide headings");
  assert.equal(source.protectedQuotes.length, 0);
  assert.equal(source.roadmaps.length, 0);
  assert.equal(source.style.preset, null);
  for (const value of [source.outline.sourceText, JSON.stringify(providerFacingPresentationSourceContract(source)), JSON.stringify(scopePresentationSourceSnapshot(input, source))]) {
    assert.doesNotMatch(value, /Scene-only|Fictional Reviewer|12–16|nocturne|Scripted Scene/);
  }
  assert.match(JSON.stringify(scopePresentationSourceSnapshot(input, source)), /Never invent measured success/);
  assert.deepEqual(input, before, "projection never edits the frozen source");
});

test("explicit output and Markdown sibling boundaries work without the original brief's wording", () => {
  for (const heading of ["Optional deliverable B: Audio scene", "## Storyboard requirements", "Video brief", "Additional output: Poster"]) {
    const source = buildPresentationSourceContract(`Presentation outline\nSlide 1: Orchard yield. Explain orchard yield.\n\n${heading}\nSIBLING_ONLY_SECRET.`);
    assert.equal(source.authoredSlideCount, 1);
    assert.doesNotMatch(source.outline.sourceText, /SIBLING_ONLY_SECRET/);
    assert.equal(source.numberedOutline[0].title, "Orchard yield");
  }
});

test("instruction titles are split consistently while authored multi-sentence taglines remain intact", () => {
  const inline = inferPresentationSourceOutline("Presentation outline\nSlide 1: Pilot and decision. Scope the pilot and capability gates.\n\nScene requirements\nA separate scene.");
  assert.equal(inline.slides[0].title, "Pilot and decision");
  assert.deepEqual(inline.slides[0].coverageRequirements, ["Scope the pilot and capability gates."]);
  const authored = inferPresentationSourceOutline("Slide 1: One promise. Every community matters.\nThe authorized research follows.");
  assert.equal(authored.slides[0].sourceMode, "authored");
  assert.equal(authored.slides[0].title, "One promise. Every community matters.");
  const manuscript = snapshot();
  manuscript.facts[3].properties.presentation_source_mode = "authored";
  assert.ok(contract(manuscript).numberedOutline.every((slide) => slide.sourceMode === "authored"));
  delete manuscript.facts[3].properties.presentation_source_mode;
  manuscript.facts[3].properties.text = `Presentation manuscript\nSlide 1: Orchard.\n${orchard}\nSlide 2: Archive.\n${archive}`;
  assert.ok(contract(manuscript).numberedOutline.every((slide) => slide.sourceMode === "authored"));
});

test("ordinary authored Video, Scene, and Presentation subheadings cannot truncate a manuscript", () => {
  for (const heading of ["Video", "Scene", "Presentation", "Video requirements"]) {
    const source = buildPresentationSourceContract({ facts: [{ block_id: "authored", type: "direction", properties: {
      text: `Slide 1: Campaign delivery\n## ${heading}\nPreserve camera-footage delivery requirements.\nSlide 2: Decision\nRetain the release milestone.`,
    } }] });
    assert.equal(source.authoredSlideCount, 2, heading);
    assert.match(source.numberedOutline[0].content, /Preserve camera-footage/);
    assert.match(source.numberedOutline[1].content, /Retain the release/);
    assert.deepEqual(source.sourceIssues, []);
  }
});

test("ambiguous output selection, duplicate slide numbers, and unresolved support fail explicitly", () => {
  const multiple = snapshot();
  multiple.facts[3].properties.text += "\nRequired output 3: Alternate Slides\nSlide 1: Another decision. Explain another decision.";
  assert.ok(hasCode(contract(multiple).sourceIssues, "ambiguous_presentation_output"));
  assert.ok(hasCode(buildPresentationSourceContract("Slide 1: One.\nSlide 1: Two.").sourceIssues, "ambiguous_presentation_slide_number"));
  const unresolved = snapshot();
  unresolved.facts = unresolved.facts.slice(2);
  const result = contract(unresolved);
  assert.equal(result.sourceIssues.filter((issue) => issue.code === "unresolved_outline_evidence").length, 2);
  assert.ok(hasCode(issues([], result), "unresolved_outline_evidence"));
});

test("explicit Combined Context assignments restrict inference, including a wrong explicit assignment", () => {
  const input = snapshot();
  for (const index of [0, 3]) input.facts[index].properties.context_group_ids = ["private-chapter"];
  const source = contract(input);
  assert.ok(source.numberedOutline.every((slide) => slide.evidenceAssignment === "explicit"));
  assert.ok(source.numberedOutline.every((slide) => source.passages.filter((passage) => slide.evidencePassageIds.includes(passage.id)).every((passage) => passage.sourceBlockId === "private-orchard")));
  const output = items(source);
  const archival = source.sources.find((entry) => entry.sourceId === "private-archive");
  output[1].slide.sourceIds = [archival.alias];
  output[1].slide.citations = [{ sourceId: archival.alias, anchor: "", excerpt: archive }];
  assert.ok(hasCode(issues(output, source), "incorrect_citation_source"), "relevance cannot override explicit assignment");
  const check = presentationCitationEvidenceChecks(output, source).find((entry) => entry.slideIndex === 1);
  assert.equal(check.sourceStatus, "unassigned");
  assert.equal(check.excerptStatus, "grounded", "wrong mapping is not the same as an invalid quotation");
});

test("citations resolve their named block rather than borrowing another group member's quotation", () => {
  const source = buildPresentationSourceContract({ facts: [
    { block_id: "a", properties: { context_group_ids: ["chapter"], text: "Slide 1: Orchard.\nThe orchard has a carefully measured harvest." } },
    { block_id: "b", properties: { context_group_ids: ["chapter"], text: "Slide 2: Archive.\nThe archive has a provenance index." } },
  ] });
  const output = [{ title: "Orchard", body: "The orchard has a carefully measured harvest.", slide: { sourceIds: ["a"], citations: [{ sourceId: "b", excerpt: "The orchard has a carefully measured harvest.", anchor: "" }] } }];
  const check = presentationCitationEvidenceChecks(output, source)[0];
  assert.equal(check.sourceStatus, "unassigned");
  assert.equal(check.excerptStatus, "ungrounded");
  assert.ok(hasCode(issues(output, source), "incorrect_citation_source"));
  assert.ok(hasCode(issues(output, source), "ungrounded_citation_excerpt"));
  output[0].slide.citations[0].sourceId = "grp_001";
  assert.equal(presentationCitationEvidenceChecks(output, source)[0].excerptStatus, "grounded");
});

test("authorized block aliases do not authorize other paragraphs, invented aliases, or spliced excerpts", () => {
  const source = contract(), output = items(source);
  output[0].slide.citations[0].excerpt = "Compost logistics need a separate depot.";
  assert.ok(hasCode(issues(output, source), "ungrounded_citation_excerpt"));
  output[0].slide.citations[0].excerpt = "Orchard yield reached 12.50% The pilot remains proposed.";
  assert.ok(hasCode(issues(output, source), "ungrounded_citation_excerpt"));
  output[0].slide.citations[0].sourceId = "blk_999";
  assert.ok(hasCode(issues(output, source), "unknown_source_reference"));
  assert.equal(presentationCitationEvidenceChecks(output, source)[0].excerptStatus, "unresolved");
});

test("a claim citation quotes that exact claim, not another sentence in its authorized parent block", () => {
  const input = snapshot();
  input.claims = [{ id: "private-claim", blockId: "private-orchard", text: "Frost risk stayed at -3.5°C.", label: "Frost observation" }];
  const source = contract(input), output = items(source);
  const claim = source.sources.find((entry) => entry.sourceKind === "claim");
  output[0].slide.citations = [{ sourceId: claim.alias, anchor: "", excerpt: "Orchard yield reached 12.50% with drip irrigation." }];
  assert.equal(presentationCitationEvidenceChecks(output, source)[0].sourceStatus, "authorized");
  assert.ok(hasCode(issues(output, source), "ungrounded_citation_excerpt"));
  output[0].slide.citations[0].excerpt = input.claims[0].text;
  assert.equal(hasCode(issues(output, source), "ungrounded_citation_excerpt"), false);
});

test("quotation normalization allows case and punctuation but preserves numeric signs, decimals, ratios, units, and money", () => {
  const source = contract(), output = items(source);
  output[0].slide.citations[0].excerpt = "ORCHARD YIELD reached 12.50% with drip irrigation!";
  assert.equal(hasCode(issues(output, source), "ungrounded_citation_excerpt"), false);
  for (const excerpt of ["Orchard yield reached 12.50 with drip irrigation.", "Orchard yield reached 12,50% with drip irrigation.", "Frost risk stayed at 3.5°C.", "Frost risk stayed at +3.5°C.", "Orchard yield reached 13.50% with drip irrigation.", "!!!"]) {
    output[0].slide.citations[0].excerpt = excerpt;
    assert.ok(hasCode(issues(output, source), "ungrounded_citation_excerpt"), excerpt);
  }
  const authored = buildPresentationSourceContract({ facts: [{ block_id: "numeric", properties: { text: "Slide 1: Values. Geometry 1:1. Duration 4–6 weeks. Budget $20." } }] });
  for (const excerpt of ["Geometry 1/1.", "Duration 4/6 weeks.", "Budget €20."]) {
    assert.equal(presentationCitationEvidenceChecks([{ slide: { citations: [{ sourceId: "numeric", excerpt }] } }], authored)[0].excerptStatus, "ungrounded");
  }
});

test("visible numerical claims and every coverage clause remain independent of citation validity", () => {
  const source = contract(), output = items(source);
  output[0].body = orchard.replace("12.50%", "19.50%");
  assert.ok(hasCode(issues(output, source), "unsupported_outline_number"));
  assert.equal(presentationCitationEvidenceChecks(output, source)[0].excerptStatus, "grounded");
  output[0].notes = orchard;
  output[0].body = "A generic conclusion.";
  assert.ok(hasCode(issues(output, source), "missing_outline_coverage"));
  output[0].title = `${source.numberedOutline[0].title}. Explain orchard yield and drip irrigation.`;
  assert.ok(hasCode(issues(output, source), "incorrect_outline_title"));
});

test("existing numbers cannot be relabeled, have their units changed, or lose required status and polarity", () => {
  const source = contract(), output = items(source);
  output[0].body = "Orchard yield reached -3.5°C with drip irrigation. Frost risk stayed at 12.50%. The pilot remains proposed.";
  assert.ok(hasCode(issues(output, source), "incorrect_outline_numeric_context"));
  output[0].body = orchard.replace("°C", "°F");
  assert.ok(hasCode(issues(output, source), "unsupported_outline_number"));
  source.numberedOutline[0].coverageRequirements.push("Label the pilot proposed.", "No spend on save.");
  output[0].body = `${orchard.replace("proposed", "available")} Spend on save.`;
  assert.ok(hasCode(issues(output, source), "missing_outline_qualifier"));
  assert.ok(hasCode(issues(output, source), "incorrect_outline_polarity"));
});

test("cardinal count wording may render as digits without changing exact quotation rules", () => {
  const source = buildPresentationSourceContract({ facts: [
    { block_id: "ratios", type: "message", properties: { text: "The proposal includes five image ratios and three video ratios." } },
    { block_id: "outline", type: "format", properties: { text: "Presentation outline\nSlide 1: Ratio matrix. Show five image ratios and three video ratios." } },
  ] });
  assert.deepEqual(source.sourceIssues, []);
  const passage = source.passages.find((candidate) => candidate.sourceBlockId === "ratios");
  const output = [{ title: "Ratio matrix", body: "The proposal includes 5 image ratios and 3 video ratios.", slide: { sourceIds: [passage.sourceAlias], citations: [{ sourceId: passage.sourceAlias, excerpt: passage.content }] } }];
  assert.deepEqual(issues(output, source), []);
  output[0].slide.citations[0].excerpt = output[0].body;
  assert.ok(hasCode(issues(output, source), "ungrounded_citation_excerpt"), "a numeric paraphrase is still not a quotation");
});

test("valid citations cannot authenticate fabricated stakeholder quotations or speakers", () => {
  const source = contract(), output = items(source), sourceId = output[0].slide.sourceIds[0];
  output[0].slide.quote = { text: "This orchard has never had a failed harvest.", sourceId, speaker: "Invented Person", role: "Director" };
  assert.ok(hasCode(issues(output, source), "ungrounded_quote_text"));
  output[0].slide.quote.text = orchard;
  assert.ok(hasCode(issues(output, source), "unverified_quote_attribution"));
});

test("a protected manuscript quotation can retain its original slide anchor on a neighboring card in the same block", () => {
  const quote = "Every orchard measurement must retain its traceable provenance.";
  const source = buildPresentationSourceContract({ facts: [{ block_id: "chapter", properties: { text: `Slide 1: Introduction. The chapter introduces the evidence.\nSlide 2: Decision. “${quote}” — Alice Chen, Research Director` } }] });
  const output = [
    { title: "Introduction", body: "The chapter introduces the evidence.", slide: { sourceIds: ["chapter"], quote: { text: quote, speaker: "Alice Chen", role: "Research Director", sourceId: "chapter", citation: "Authored slide 2" } } },
    { title: "Decision", body: "Retain accountable research.", slide: { sourceIds: ["chapter"] } },
  ];
  assert.deepEqual(issues(output, source), []);
  output[0].slide.quote.citation = "Authored slide 1";
  assert.ok(hasCode(issues(output, source), "ungrounded_quote_text"));
});

test("mandatory unmatched research is a preflight issue, not silently discarded evidence", () => {
  const input = snapshot();
  input.facts[2].locked = true;
  assert.ok(hasCode(contract(input).sourceIssues, "unassigned_required_presentation_source"));
  input.facts[2].locked = false;
  input.facts[0].properties.required = true;
  assert.ok(hasCode(contract(input).sourceIssues, "unassigned_required_presentation_source"), "matching one paragraph does not cover another mandatory paragraph");
  for (const index of [0, 3]) input.facts[index].properties.context_group_ids = ["mandatory-group"];
  const assigned = contract(input);
  assert.deepEqual(assigned.sourceIssues, []);
  assert.ok(hasCode(issues(items(assigned), assigned), "missing_required_presentation_evidence"), "explicit assignment alone does not deliver every required passage");
});

test("private checks retain diagnostic detail but shared validation messages and provider aliases contain no private evidence", () => {
  const source = contract(), output = items(source);
  output[0].slide.citations[0].excerpt = "PRIVATE_REJECTED_EXCERPT_SENTINEL";
  const check = presentationCitationEvidenceChecks(output, source)[0];
  assert.equal(check.sourceStatus, "authorized");
  assert.equal(check.excerptStatus, "ungrounded");
  assert.equal(check.excerpt, "PRIVATE_REJECTED_EXCERPT_SENTINEL");
  assert.match(check.passages[0].content, /Orchard yield/);
  assert.doesNotMatch(JSON.stringify(issues(output, source)), /PRIVATE_REJECTED_EXCERPT_SENTINEL|Orchard yield reached|private-orchard/);
  assert.doesNotMatch(JSON.stringify(providerFacingPresentationSourceContract(source)), /private-orchard|private-archive|private-outline|sourceBlockId|contextGroupIds/);
});

test("retained v1 contracts still enforce their original authored passage boundaries", () => {
  const source = buildPresentationSourceContract({ facts: [{ block_id: "legacy", properties: { text: "Slide 1: One. An independently authored first passage.\nSlide 2: Two. A different second passage." } }] });
  delete source.passages;
  delete source.sourceIssues;
  source.schemaVersion = 1;
  for (const slide of source.numberedOutline) { delete slide.evidencePassageIds; delete slide.sourceMode; delete slide.coverageRequirements; }
  const output = [{ title: "One", body: "An independently authored first passage.", slide: { sourceIds: ["legacy"], citations: [{ sourceId: "legacy", anchor: "Slide 1", excerpt: "A different second passage." }] } }];
  assert.ok(hasCode(issues(output, source), "ungrounded_citation_excerpt"));
});
