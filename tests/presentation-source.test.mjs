import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPresentationSourceContract,
  extractPresentationSourceContract,
  inferPresentationSourceOutline,
  inferPresentationAudienceLocale,
  inferPresentationStyleContract,
  providerFacingPresentationSourceContract,
  resolvePresentationSourceReferences,
  validatePresentationSourceCoverage,
} from "../src/model/presentation-source.ts";

const executive = JSON.parse(await readFile(new URL("./fixtures/presentation-executive-source.json", import.meta.url), "utf8"));
const managed = JSON.parse(await readFile(new URL("./fixtures/presentation-managed-23.json", import.meta.url), "utf8"));

function faithfulSlides(contract, { scorecard = false } = {}) {
  const scores = contract.protectedFacts.filter((fact) => fact.precision === "source");
  return contract.numberedOutline.map((source) => ({
    title: source.title,
    body: source.content,
    notes: `[Sources] ${source.section ?? source.title}\n${source.content}`,
    context_group_ids: source.contextGroupIds,
    slide: {
      section: source.section,
      sourceIds: source.sourceBlockId ? [source.sourceBlockId] : [],
      sourceOrder: source.number,
      visual: scorecard && scores.some((score) => score.slideNumber === source.number)
        ? { kind: "scorecard", label: "All six independent goals", value: "", data: scores.map((score) => ({ label: score.label, value: score.value, weight: Number(score.value) / 100 })) }
        : { kind: "hero-type", label: "Authored evidence", value: source.title, data: [] },
    },
  }));
}

test("extracts the actual executive presentation's twelve inline headings, three ordered chapters, and authorized source blocks", () => {
  const outline = inferPresentationSourceOutline(executive.snapshot);

  assert.equal(outline.authoredSlideCount, 12);
  assert.deepEqual(outline.slides.map((slide) => slide.number), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.deepEqual(outline.slides.map((slide) => slide.title), executive.expectedSlideTitles);
  assert.deepEqual(outline.sections.map((section) => section.title), [
    "EXECUTIVE OPPORTUNITY / OPENING ACT",
    "AUDIENCE AND PRODUCT ARCHITECTURE",
    "INVESTMENT CASE AND DECISION",
  ]);
  assert.deepEqual(outline.sections.map((section) => section.slideNumbers), [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]);
  assert.deepEqual(outline.slides.map((slide) => slide.sourceBlockId), [
    ...Array(4).fill("executive-opening"),
    ...Array(4).fill("executive-architecture"),
    ...Array(4).fill("executive-investment"),
  ]);
  assert.doesNotMatch(outline.slides[0].title, /One creative world/);
});

test("preserves twelve independently authored slide blocks and excludes non-authoritative supporting constraints",()=>{
  const snapshot={facts:[
    ...Array.from({length:12},(_,index)=>({block_id:`authored-slide-${index+1}`,type:"direction",locked:true,properties:{text:`Slide ${index+1} — Independent executive decision ${index+1}\nAuthorized evidence and exact assessment ${index+10}.25%.`,weight:1,authority:"authored"}})),
    ...[["objective","direction","Protect every source decision."],["audience","audience","Executive decision-makers."],["deliverable","format","Faithful Field Notes presentation."],["exclusion","exclusion","Do not invent unsupported evidence."]].map(([label,type,text])=>({block_id:`support-${label}`,type,properties:{label,text,weight:1,authority:"authored"}})),
  ],relationships:[]};
  const contract=buildPresentationSourceContract(snapshot,{requestedSlideCount:12,stylePreset:"field-notes",fidelity:"faithful"});

  assert.equal(contract.authoredSlideCount,12);
  assert.equal(contract.predictedSlideCount,12);
  assert.equal(contract.slideCountMismatch,false);
  assert.equal(contract.style.preset,"field-notes");
  assert.deepEqual(contract.numberedOutline.map((slide)=>slide.sourceBlockId),Array.from({length:12},(_,index)=>`authored-slide-${index+1}`));
  assert.equal(contract.sources.filter((source)=>source.sourceKind==="block").length,15);
  assert.equal(contract.sources.some((source)=>source.sourceId==="support-exclusion"),false);
});

test("preserves all twenty-three authored positions, named chapters, source groups, and an explicit requested count", () => {
  const contract = buildPresentationSourceContract(managed.snapshot, { requestedSlideCount: 23, stylePreset: "field-notes" });

  assert.equal(contract.authoredSlideCount, 23);
  assert.equal(contract.requestedSlideCount, 23);
  assert.equal(contract.predictedSlideCount, 23);
  assert.equal(contract.slideCountMismatch, false);
  assert.deepEqual(contract.outline.sections.map((section) => section.title), ["STRATEGIC CASE", "DEVICE EXPERIENCE", "GOVERNED DELIVERY", "INVESTMENT AND DECISION"]);
  assert.deepEqual(contract.outline.sections.map((section) => section.slideNumbers.length), [6, 6, 6, 5]);
  assert.deepEqual(contract.sources.filter((source) => source.sourceKind === "context-group").map((source) => source.alias), ["grp_001", "grp_002", "grp_003", "grp_004"]);
  assert.equal(contract.style.preset, "field-notes");
  assert.equal(contract.numberedOutline.at(-1).number, 23);

  const intentionallyExpanded = extractPresentationSourceContract(executive.snapshot, { requestedSlideCount: 23 });
  assert.equal(intentionallyExpanded.authoredSlideCount, 12);
  assert.equal(intentionallyExpanded.predictedSlideCount, 23);
  assert.equal(intentionallyExpanded.slideCountMismatch, true);
});

test("recognizes inline, markdown, and sufficiently signaled numbered headings without silently truncating an unsupported outline", () => {
  assert.deepEqual(inferPresentationSourceOutline("Presentation outline\n1. Opening argument\n2. Evidence\n3. Decision").slides.map((slide) => slide.title), ["Opening argument", "Evidence", "Decision"]);
  assert.deepEqual(inferPresentationSourceOutline("## Slide 1 — Opportunity: trustworthy creative production\nEvidence stays authorized.\n## Slide 2: Navigation: Projects / Work / Explore / Activity / Deliver\nExact destinations survive.").slides.map((slide) => slide.title), [
    "Opportunity: trustworthy creative production",
    "Navigation: Projects / Work / Explore / Activity / Deliver",
  ]);
  assert.equal(inferPresentationSourceOutline("Slide 2 — Six-goal assessment scorecard. Phone: 39.75.").slides[0].title, "Six-goal assessment scorecard");
  assert.equal(inferPresentationSourceOutline("SLIDES 1–4. An overview is not an authored numbered slide.").authoredSlideCount, null);

  const unsupported = Array.from({ length: 101 }, (_, index) => `Slide ${index + 1} — Position ${index + 1}.`).join(" ");
  assert.equal(inferPresentationSourceOutline(unsupported).authoredSlideCount, 101);
});

test("protects every original assessment value and distinguishes exact 61.125 from displayed 61.13", () => {
  const contract = buildPresentationSourceContract(executive.snapshot);
  const scores = contract.protectedFacts.filter((fact) => fact.precision === "source");

  assert.deepEqual(scores.map(({ label, value }) => ({ label, value })), executive.scores);
  assert.equal(scores.every((fact) => fact.sourceBlockId === "executive-opening" && fact.sourceAlias === "blk_001" && fact.slideNumber === 2), true);
  assert.deepEqual(contract.protectedFacts.filter((fact) => fact.precision !== "source").map((fact) => ({ precision: fact.precision, value: fact.value, exactValue: fact.exactValue, displayValue: fact.displayValue })), [
    { precision: "exact", value: "61.125", exactValue: "61.125", displayValue: "61.13" },
    { precision: "display", value: "61.13", exactValue: "61.125", displayValue: "61.13" },
  ]);

  const computed = buildPresentationSourceContract("Phone: 39.75\nTablet: 53.00\nSmall monitor: 67.25\nLarge monitor: 68.50\nAdaptive/accessibility: 58.75\nGoverned creative loop: 79.50");
  assert.equal(computed.protectedFacts.find((fact) => fact.precision === "exact")?.value, "61.125");
  assert.equal(computed.protectedFacts.find((fact) => fact.precision === "display")?.value, "61.13");
});

test("infers the authored presentation audience language independently of the application locale", () => {
  const contract = buildPresentationSourceContract(executive.snapshot);
  assert.equal(inferPresentationAudienceLocale(contract.outline.sourceText, "ja-JP"), "en");
  assert.equal(inferPresentationAudienceLocale("このプレゼンテーションは利用者の体験と製品の価値を説明します。", "en-US"), "ja");
  assert.equal(inferPresentationAudienceLocale("تشرح هذه العروض قيمة المنتج وتجربة المستخدم للفريق.", "en-US"), "ar");
  assert.equal(inferPresentationAudienceLocale("Cette présentation explique le projet et les besoins de votre équipe pour les prochaines semaines.", "ja-JP"), "fr");
  assert.equal(inferPresentationAudienceLocale(contract.outline.sourceText, "ja-JP", "fr-FR"), "fr-FR");
  assert.equal(inferPresentationAudienceLocale("", "ja-JP"), "ja-JP");
});

test("retains all four exact, role-attributed quotations without the former 120-character truncation", () => {
  const contract = buildPresentationSourceContract(executive.snapshot);

  assert.deepEqual(contract.protectedQuotes.map((quote) => ({ text: quote.text, speaker: quote.speaker, sourceId: quote.sourceBlockId, slide: quote.slideNumber })), executive.quotes);
  assert.ok(contract.protectedQuotes[0].text.length > 120);
  assert.match(contract.protectedQuotes[0].text, /traceable, editable, reviewable, and reusable across devices\.$/);
  assert.deepEqual(contract.protectedQuotes.filter((quote) => quote.slideNumber === 12).map((quote) => quote.role), ["Product Owner", "Lead Designer"]);

  const headingAttributed = buildPresentationSourceContract("### Product Owner\n> “Every extra inch of screen should reveal a useful relationship, not another column of product chrome.”");
  assert.equal(headingAttributed.protectedQuotes[0]?.speaker, "Product Owner");
});

test("protects navigation vocabulary, authoring families, roadmap ranges, and actual authored palette preference", () => {
  const styledSnapshot = {
    ...executive.snapshot,
    standing_constraints: [{ axis: "palette", value: "dusk-warm", authority: "authored", source_claim_ref: "private-source-claim" }],
  };
  const contract = buildPresentationSourceContract(styledSnapshot);

  assert.deepEqual(contract.protectedTerminology.map((family) => family.terms), [executive.destinations, executive.modes, ["Phone", "Tablet", "Small/snapped monitor", "Large monitor"]]);
  assert.deepEqual(contract.roadmaps.map((roadmap) => roadmap.value), executive.roadmaps);
  assert.deepEqual(contract.roadmaps.map((roadmap) => roadmap.slideNumber), [10, 11]);
  assert.equal(contract.style.direction, "palette: dusk-warm");
  assert.equal(contract.style.authored, true);
  assert.equal(contract.style.preset, null, "an authored warm palette is not evidence that the actual native dark/amber decks violated brand guidance");

  const userSelected = buildPresentationSourceContract(styledSnapshot, { stylePreset: "editorial" });
  assert.equal(userSelected.style.preset, "editorial");
  assert.equal(userSelected.style.direction, "palette: dusk-warm");
  assert.equal(inferPresentationStyleContract("Typography: Helvetica Neue\nVisual direction: spare and evidence-led\nPalette: #112233").typography, "Helvetica Neue");
});

test("publishes only request-local source aliases and resolves guessed durable identifiers only in explicitly trusted application output", () => {
  const contract = buildPresentationSourceContract(managed.snapshot);
  const safe = providerFacingPresentationSourceContract(contract);
  const serialized = JSON.stringify(safe);

  for (const source of contract.sources) {
    assert.doesNotMatch(serialized, new RegExp(source.sourceId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  }
  assert.match(serialized, /"sourceAlias":"blk_001"/);
  assert.match(serialized, /"contextGroupAliases":\["grp_001"\]/);
  assert.doesNotMatch(serialized, /sourceBlockId|sourceId|contextGroupIds|claim:/);

  const accepted = resolvePresentationSourceReferences(["blk_001", "grp_001"], contract);
  assert.equal(accepted.valid, true);
  assert.deepEqual(accepted.blockIds, ["managed-foundation"]);
  assert.deepEqual(accepted.contextGroupIds, ["chapter-strategy"]);

  const guessed = resolvePresentationSourceReferences(["managed-foundation", "chapter-strategy", "blk_999"], contract);
  assert.equal(guessed.valid, false);
  assert.deepEqual(guessed.sourceIds, []);
  assert.deepEqual(guessed.unknownReferences, ["managed-foundation", "chapter-strategy", "blk_999"]);

  const trusted = resolvePresentationSourceReferences(["managed-foundation", "chapter-strategy"], contract, { allowDurableIds: true });
  assert.equal(trusted.valid, true);
  assert.deepEqual(trusted.blockIds, ["managed-foundation"]);
});

test("never counts inactive decisions or accepts injected foreign blocks, groups, claims, or conflicting aliases", () => {
  const authorized = {
    block_id: "authorized-block",
    type: "direction",
    properties: { text: "Slide 1 — Approved customer evidence.", weight: 1, context_group_ids: ["authorized-group"] },
  };
  const snapshot = {
    facts: [
      authorized,
      { block_id: "muted-block", properties: { text: "Slide 2 — MUTED_PRIVATE_CUSTOMER_SECRET.", weight: 0, context_group_ids: ["muted-group"] } },
      { block_id: "removed-block", removed: true, properties: { text: "Slide 3 — REMOVED_PRIVATE_SECRET." } },
      { block_id: "inactive-block", properties: { text: "Slide 4 — INACTIVE_PRIVATE_SECRET.", active: false } },
    ],
    context_groups: [{ id: "foreign-group", name: "FOREIGN_PRIVATE_SECRET" }],
    claims: [
      { id: "claim-authorized", blockId: "authorized-block", label: "Approved evidence" },
      { id: "claim-foreign", blockId: "foreign-block", label: "FOREIGN_PRIVATE_CLAIM" },
    ],
  };
  const contract = buildPresentationSourceContract(snapshot, {
    contextGroups: [{ id: "injected-group", label: "INJECTED_PRIVATE_GROUP" }],
    sourceAliases: [
      { alias: "blk_999", sourceId: "foreign-block", sourceKind: "block", contextGroupIds: [], label: "FOREIGN_PRIVATE_BLOCK" },
      { alias: "grp_999", sourceId: "foreign-group", sourceKind: "context-group", contextGroupIds: [], label: "FOREIGN_PRIVATE_GROUP" },
      { alias: "clm_999", sourceId: "claim-foreign", sourceKind: "claim", blockId: "foreign-block", contextGroupIds: [], label: "FOREIGN_PRIVATE_CLAIM" },
      { alias: "grp_bad", sourceId: "authorized-group", sourceKind: "context-group", contextGroupIds: ["authorized-group"], label: "Malformed alias" },
    ],
  });

  assert.equal(contract.authoredSlideCount, 1);
  assert.deepEqual(contract.sources.map((source) => [source.alias, source.sourceId]), [["blk_001", "authorized-block"], ["grp_001", "authorized-group"], ["clm_001", "claim-authorized"]]);
  assert.doesNotMatch(JSON.stringify(providerFacingPresentationSourceContract(contract)), /MUTED_|REMOVED_|INACTIVE_|FOREIGN_|INJECTED_|PRIVATE_/);
});

test("requiring authorized evidence fails closed for an empty or entirely muted source snapshot", () => {
  const slide = { title: "An invented presentation", body: "No active customer-approved source remains.", slide: { sourceIds: [], visual: { kind: "hero-type", label: "", value: "", data: [] } } };

  for (const snapshot of [
    { facts: [] },
    { facts: [{ block_id: "disabled-private-source", properties: { text: "Slide 1 — PRIVATE DISABLED EVIDENCE.", weight: 0 } }] },
  ]) {
    const contract = buildPresentationSourceContract(snapshot);
    assert.deepEqual(contract.sources, []);
    assert.ok(validatePresentationSourceCoverage([slide], contract, { requireEverySlideSource: true }).some((issue) => issue.code === "missing_slide_source"));
  }
});

test("exclusions remain negative guardrails and can never become positive authored presentation evidence", () => {
  for (const intent of ["avoid", "prohibit", "exclude", "must_not_include", "exclusion", "forbid"]) {
    const snapshot = {
      facts: [
        { block_id: "approved-source", type: "direction", properties: { text: "Slide 1 — APPROVED: Preserve this authorized customer decision.", weight: 1 } },
        { block_id: `negative-${intent}`, type: "direction", intent, properties: { text: "Slide 2 — FORBIDDEN CUSTOMER SECRET: Never disclose the excluded acquisition amount 93.75.", weight: 1 } },
      ],
    };
    const contract = buildPresentationSourceContract(snapshot);
    assert.equal(contract.authoredSlideCount, 1, intent);
    assert.deepEqual(contract.sources.filter((source) => source.sourceKind === "block").map((source) => source.sourceId), ["approved-source"], intent);
    assert.doesNotMatch(JSON.stringify(providerFacingPresentationSourceContract(contract)), /FORBIDDEN CUSTOMER SECRET|93\.75/, intent);
  }
});

test("request-local aliases cannot replace authorized source and chapter labels with caller-injected text", () => {
  const snapshot = {
    facts: [{
      block_id: "approved-source",
      type: "direction",
      handle: "direction/approved-source",
      properties: {
        text: "Slide 1 — APPROVED: Present the authorized customer decision.",
        weight: 1,
        combined_context_memberships: [{ context_set_id: "approved-chapter", name: "Verified chapter" }],
      },
    }],
    claims: [{ id: "approved-claim", blockId: "approved-source", label: "Verified claim" }],
  };
  const contract = buildPresentationSourceContract(snapshot, {
    sourceAliases: [
      { alias: "blk_009", sourceId: "approved-source", sourceKind: "block", blockId: "approved-source", contextGroupIds: ["approved-chapter"], label: "INJECTED BLOCK SECRET" },
      { alias: "grp_009", sourceId: "approved-chapter", sourceKind: "context-group", contextGroupIds: ["approved-chapter"], label: "INJECTED CHAPTER SECRET" },
      { alias: "clm_009", sourceId: "approved-claim", sourceKind: "claim", blockId: "approved-source", contextGroupIds: [], label: "INJECTED CLAIM SECRET" },
    ],
    contextGroups: [{ id: "approved-chapter", name: "INJECTED CONTEXT SECRET" }],
  });
  const providerContent = JSON.stringify(providerFacingPresentationSourceContract(contract));
  assert.doesNotMatch(providerContent, /INJECTED|SECRET/);
  assert.match(providerContent, /Verified chapter/);
  assert.match(providerContent, /Verified claim/);
});

test("accepts fully faithful twelve- and twenty-three-slide presentations, including authorized chapters and sentence-ending exact values", () => {
  for (const fixture of [executive, managed]) {
    const contract = buildPresentationSourceContract(fixture.snapshot);
    const slides = faithfulSlides(contract, { scorecard: true });
    assert.deepEqual(validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true }), []);
  }

  const contract = buildPresentationSourceContract(executive.snapshot, { requestedSlideCount: 23 });
  const slides = faithfulSlides(contract);
  while (slides.length < 23) slides.push({ ...slides.at(-1), title: `Authorized expansion ${slides.length + 1}` });
  assert.equal(validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true }).some((issue) => issue.code === "slide_count_mismatch"), false);
});

test("grounds each citation in its own authored slide while tolerating punctuation and case", () => {
  const contract = buildPresentationSourceContract(executive.snapshot);
  const slides = faithfulSlides(contract);
  const excerpt = "search and Send become harder to access on the smallest screens; async events do not reliably return a person to the exact work.";
  slides[2].slide.citations = [{ sourceId: "executive-opening", label: "User contradiction", anchor: "Slide 3", excerpt }];
  assert.deepEqual(validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true }), []);

  slides[2].slide.citations[0].excerpt = "Independent auditors certify 999.99% unrestricted enterprise readiness.";
  let issues = validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true });
  assert.ok(issues.some((issue) => issue.code === "ungrounded_citation_excerpt" && issue.path === "items.2.slide.citations.0.excerpt"));

  slides[2].slide.citations[0].excerpt = excerpt;
  slides[2].slide.citations[0].sourceId = "executive-architecture";
  issues = validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true });
  assert.ok(issues.some((issue) => issue.code === "incorrect_citation_source" && issue.path === "items.2.slide.citations.0.sourceId"));

  slides[2].slide.citations[0].sourceId = "executive-opening";
  slides[2].slide.citations[0].anchor = "Slide 12";
  assert.ok(validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true }).some((issue) => issue.code === "incorrect_citation_anchor" && issue.path === "items.2.slide.citations.0.anchor"));
  slides[2].slide.citations[0].anchor = "Slide 3";
  slides[2].slide.citations[0].excerpt = "search and Send become harder to access; touch and short-height landscapes remain underserved.";
  assert.ok(validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true }).some((issue) => issue.code === "ungrounded_citation_excerpt"));

  slides[1].slide.citations = [{ sourceId: "executive-opening", label: "Assessment", anchor: "Slide 2", excerpt: "39.75%" }];
  assert.ok(validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true }).some((issue) => issue.code === "ungrounded_citation_excerpt" && issue.path === "items.1.slide.citations.0.excerpt"));
  slides[1].slide.citations[0].excerpt = "39,75";
  assert.ok(validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true }).some((issue) => issue.code === "ungrounded_citation_excerpt" && issue.path === "items.1.slide.citations.0.excerpt"));
});

test("rejects real authorized source blocks when individual quotations or score rows cite the wrong slide",()=>{
  const contract=buildPresentationSourceContract(executive.snapshot);
  const slides=faithfulSlides(contract,{scorecard:true});
  const quote=executive.quotes.find((candidate)=>candidate.slide===4);
  slides[3].slide.quote={text:quote.text,speaker:quote.speaker,role:quote.speaker,sourceId:"executive-architecture"};
  let issues=validatePresentationSourceCoverage(slides,contract,{requireEverySlideSource:true,requireAllProtectedContent:true});
  assert.ok(issues.some((issue)=>issue.code==="incorrect_quote_source"&&issue.path==="items.3.slide.quote.sourceId"));
  slides[3].slide.quote.sourceId="executive-opening";
  slides[1].slide.visual.data[0].sourceIds=["executive-architecture"];
  issues=validatePresentationSourceCoverage(slides,contract,{requireEverySlideSource:true,requireAllProtectedContent:true});
  assert.ok(issues.some((issue)=>issue.code==="incorrect_visual_source"&&issue.path==="items.1.slide.visual.data.0.sourceIds"));
});

test("rejects swapped protected assessment labels even when every required number remains visible", () => {
  const contract = buildPresentationSourceContract(executive.snapshot);
  const slides = faithfulSlides(contract);
  slides[1].body = slides[1].body
    .replace(/phone 39\.75/iu, "Phone 53.00")
    .replace(/tablet 53\.00/iu, "Tablet 39.75");

  const issues = validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true });
  assert.ok(issues.some((issue) => issue.code === "mislabeled_protected_fact" && issue.message.includes("Phone") && issue.message.includes("39.75")));
  assert.ok(issues.some((issue) => issue.code === "mislabeled_protected_fact" && issue.message.includes("Tablet") && issue.message.includes("53.00")));
});

test("rejects swapped stakeholder roles when two complete protected quotations share one slide", () => {
  const contract = buildPresentationSourceContract(executive.snapshot);
  const slides = faithfulSlides(contract);
  const productOwnerQuote = executive.quotes.find((quote) => quote.slide === 12 && quote.speaker === "Product Owner");
  const designerQuote = executive.quotes.find((quote) => quote.slide === 12 && quote.speaker === "Lead Designer");
  assert.ok(productOwnerQuote);
  assert.ok(designerQuote);
  slides[11].body = slides[11].body
    .replace(`“${productOwnerQuote.text}” — Product Owner`, `“${productOwnerQuote.text}” — Lead Designer`)
    .replace(`“${designerQuote.text}” — Lead Designer`, `“${designerQuote.text}” — Product Owner`);

  const issues = validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true });
  assert.equal(issues.filter((issue) => issue.code === "incorrect_quote_attribution").length, 2);
});

test("rejects a changed named quotation speaker even when the original role and complete quotation remain", () => {
  const contract = buildPresentationSourceContract("Slide 1 — Accountable authorship. “A traceable and reviewable deck protects every authored decision.” — Alice Chen, Product Owner");
  const slides = faithfulSlides(contract);
  slides[0].slide.quote = {
    text: contract.protectedQuotes[0].text,
    speaker: "Mallory Reed",
    role: "Product Owner",
  };

  const issues = validatePresentationSourceCoverage(slides, contract, { requireAllProtectedContent: true });
  assert.ok(issues.some((issue) => issue.code === "incorrect_quote_speaker" && issue.message.includes("Alice Chen")));

  slides[0].slide.quote.speaker = "Alice Chen";
  assert.deepEqual(validatePresentationSourceCoverage(slides, contract, { requireAllProtectedContent: true }), []);
});

test("protects every authored device posture while accepting small-monitor and snapped-monitor aliases", () => {
  const contract = buildPresentationSourceContract("Slide 1 — Four device postures. Phone; Tablet; Small/snapped monitor; Large monitor.");
  assert.deepEqual(contract.protectedTerminology.find((family) => family.label === "Device postures")?.terms, ["Phone", "Tablet", "Small/snapped monitor", "Large monitor"]);

  const slides = faithfulSlides(contract);
  slides[0].body = "Phone; Tablet; Large monitor.";
  assert.ok(validatePresentationSourceCoverage(slides, contract, { requireAllProtectedContent: true }).some((issue) => issue.code === "missing_protected_terminology" && issue.message.includes("Small/snapped monitor")));

  slides[0].body = "Phone; Tablet; Small monitor; Large monitor.";
  assert.deepEqual(validatePresentationSourceCoverage(slides, contract, { requireAllProtectedContent: true }), []);
  slides[0].body = "Phone; Tablet; snapped monitor; Large monitor.";
  assert.deepEqual(validatePresentationSourceCoverage(slides, contract, { requireAllProtectedContent: true }), []);
});

test("rejects a valid authorized chapter when it belongs to a different authored slide", () => {
  const contract = buildPresentationSourceContract(managed.snapshot);
  const slides = faithfulSlides(contract);
  slides[0].slide.sourceIds = [];
  slides[0].context_group_ids = ["chapter-experience"];

  const issues = validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true });
  assert.ok(issues.some((issue) => issue.code === "incorrect_slide_source" && issue.path === "items.0.slide.sourceIds"));
});

test("rejects roadmap phases moved to the wrong authored slide even when both protected week ranges remain visible",()=>{
  const contract=buildPresentationSourceContract(executive.snapshot);
  const slides=faithfulSlides(contract);
  for(const [slide,previous,next] of [[slides[9],"4–6 WEEKS","12–16 WEEKS"],[slides[10],"12–16 WEEKS","4–6 WEEKS"]]){
    slide.title=slide.title.replace(previous,next);
    slide.body=slide.body.replace(previous,next);
    slide.slide.visual.value=slide.slide.visual.value.replace(previous,next);
  }

  const issues=validatePresentationSourceCoverage(slides,contract,{requireEverySlideSource:true,requireAllProtectedContent:true});
  assert.equal(issues.filter((issue)=>issue.code==="misplaced_roadmap_milestone").length,2);
});

test("keeps overall-score precision separate from authored roadmap durations and individual visual metrics", () => {
  const contract = buildPresentationSourceContract(executive.snapshot);
  const slides = faithfulSlides(contract, { scorecard: true });
  slides[1].slide.visual.exactValue = "61.125";
  slides[1].slide.visual.displayValue = "61.13";

  for (const [index, duration] of [[9, "4–6 weeks"], [10, "12–16 weeks"]]) {
    slides[index].slide.visual = {
      kind: "roadmap",
      label: index === 9 ? "First release" : "Full program",
      value: duration,
      exactValue: duration,
      displayValue: duration,
      unit: "weeks",
      data: [],
    };
  }
  slides[5].slide.visual = {
    kind: "metric",
    label: "Phone assessment",
    value: "39.75",
    exactValue: "39.75",
    displayValue: "39.75",
    unit: "/100",
    data: [],
  };

  assert.deepEqual(validatePresentationSourceCoverage(slides, contract, {
    requireEverySlideSource: true,
    requireAllProtectedContent: true,
  }), []);

  slides[1].slide.visual.exactValue = "61.13";
  slides[1].slide.visual.displayValue = "61.125";
  const issues = validatePresentationSourceCoverage(slides, contract, {
    requireEverySlideSource: true,
    requireAllProtectedContent: true,
  });
  assert.equal(issues.some((issue) => issue.code === "incorrect_exact_value" && issue.path === "items.1.slide.visual.exactValue"), true);
  assert.equal(issues.some((issue) => issue.code === "incorrect_display_value" && issue.path === "items.1.slide.visual.displayValue"), true);
  assert.equal(issues.some((issue) => issue.path.startsWith("items.9.") || issue.path.startsWith("items.10.")), false);
});

test("preserves separate roadmap phase labels when both protected ranges share one authored slide", () => {
  const contract = buildPresentationSourceContract("Slide 1 — Delivery roadmap. First release: 4–6 weeks. Full program: 12–16 weeks.");
  assert.deepEqual(contract.roadmaps.map(({ label, value }) => ({ label, value })), [
    { label: "First release", value: "4–6 weeks" },
    { label: "Full program", value: "12–16 weeks" },
  ]);

  const slides = faithfulSlides(contract);
  slides[0].body = "First release: 12–16 weeks. Full program: 4–6 weeks.";
  const issues = validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true });
  assert.equal(issues.filter((issue) => issue.code === "incorrect_roadmap_phase").length, 2);
});

test("flags reversed exact/display semantics, missing sixth chart point, truncated quote, and unauthorized sources with repair-targeted paths", () => {
  const contract = buildPresentationSourceContract(executive.snapshot);
  const slides = faithfulSlides(contract, { scorecard: true });
  const scorecard = slides[1];
  scorecard.body = scorecard.body.replace("61.125/100 (display 61.13)", "exact 61.13; display 61.125");
  scorecard.slide.visual.data.pop();
  scorecard.slide.visual.exactValue = "61.13";
  scorecard.slide.visual.displayValue = "61.125";
  slides[3].body = slides[3].body.replace(executive.quotes[0].text, executive.quotes[0].text.slice(0, 110));
  slides[5].slide.sourceIds = ["invented-secret-source-id"];

  const issues = validatePresentationSourceCoverage(slides, contract, { requireEverySlideSource: true, requireAllProtectedContent: true });
  const codes = new Set(issues.map((issue) => issue.code));

  for (const expected of ["reversed_numeric_precision", "incorrect_exact_value", "incorrect_display_value", "missing_scorecard_datum", "missing_protected_quote", "unknown_source_reference", "missing_slide_source"]) {
    assert.ok(codes.has(expected), `expected validation issue ${expected}`);
  }
  assert.ok(issues.some((issue) => issue.code === "missing_scorecard_datum" && issue.message.includes("Governed creative loop") && issue.path === "items.1.slide.visual.data"));
  assert.ok(issues.some((issue) => issue.code === "missing_protected_quote" && issue.path === "items.3.slide.quote.text"));
  assert.doesNotMatch(JSON.stringify(issues), /invented-secret-source-id/, "diagnostics must not echo guessed durable identifiers");
});

test("validates a late provider page against its global authored slide numbers without imposing whole-deck coverage", () => {
  const snapshot = { facts: [executive.snapshot.facts[2]] };
  const contract = buildPresentationSourceContract(snapshot);
  const page = faithfulSlides(contract);

  assert.deepEqual(contract.numberedOutline.map((slide) => slide.number), [9, 10, 11, 12]);
  assert.deepEqual(validatePresentationSourceCoverage(page, contract, { pageStart: 8, pageSize: 4, requireEverySlideSource: true, requireAllProtectedContent: false }), []);
  assert.deepEqual(validatePresentationSourceCoverage(page.slice(0, 2), contract, { pageStart: 8, pageSize: 2, requireEverySlideSource: true, requireAllProtectedContent: false }), []);
});
