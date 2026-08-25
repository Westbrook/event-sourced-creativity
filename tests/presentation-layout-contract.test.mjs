import assert from "node:assert/strict";
import test from "node:test";

import { defaultSlidePresentation } from "../src/model/document-artifacts.ts";
import {
  authorizedPresentationCitations,
  planSlideLayout,
  PRESENTATION_CANVAS_HEIGHT,
  PRESENTATION_CANVAS_WIDTH,
  PRESENTATION_LAYOUT_CAPACITIES,
  PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS,
  PRESENTATION_LAYOUT_VERSION,
  PRESENTATION_VISUAL_FIT_SELECTOR,
  presentationRequiresReadingPosture,
} from "../src/model/presentation-layout.ts";

const protectedQuote = "The complete stakeholder quotation and its exact attribution must survive every presentation posture.";
const item = (overrides = {}) => ({
  title: "Grounded executive decision",
  body: "Every source-authored conclusion remains available.",
  notes: "Complete private notes stay on the approved item.",
  image_prompt: "A reusable structured slide, never generated HTML.",
  context_group_ids: ["context_group_1"],
  slide: {
    layout: "scorecard",
    kicker: "Authorized evidence",
    bullets: ["Keep the complete protected claim."],
    sourceIds: ["PRIVATE_AUTHORIZED_SOURCE_42"],
    quote: {
      text: protectedQuote,
      speaker: "Product Owner",
      role: "Executive sponsor",
      sourceId: "PRIVATE_AUTHORIZED_SOURCE_42",
    },
    citations: [{
      sourceId: "PRIVATE_AUTHORIZED_SOURCE_42",
      label: "Approved interview",
      anchor: "Authored slide 2",
      excerpt: "Full citation excerpts must remain in the accessible reading view.",
    }],
    visual: {
      kind: "scorecard",
      label: "Source-grounded scorecard",
      value: "61.13",
      exactValue: "61.125",
      displayValue: "61.13",
      unit: "/ 100",
      data: [
        { label: "Phone", value: "39.75", weight: .3975, sourceIds: ["PRIVATE_AUTHORIZED_SOURCE_42"] },
        { label: "Tablet", value: "53.00", weight: .53, sourceIds: ["PRIVATE_AUTHORIZED_SOURCE_42"] },
      ],
    },
  },
  ...overrides,
});

test("presentation layout plans share one versioned trusted 960 × 540 artboard", () => {
  const plan = planSlideLayout(item(), defaultSlidePresentation("editorial"));

  assert.equal(PRESENTATION_CANVAS_WIDTH, 960);
  assert.equal(PRESENTATION_CANVAS_HEIGHT, 540);
  assert.equal(plan.version, PRESENTATION_LAYOUT_VERSION);
  assert.deepEqual(plan.canvas, { width: 960, height: 540, aspectRatio: "16:9" });
  assert.deepEqual(plan.safeArea, { inline: 48, block: 32 });
  assert.equal(plan.capacities.minimumBodyFontPx, 14);
  assert.equal(plan.capacities.minimumLabelFontPx, 12);
  assert.equal(plan.citationPlacement, "inline");
  assert.match(plan.className, /^presentation-slide--density-(?:comfortable|compact|dense)$/u);
  assert.equal(Object.hasOwn(plan, "html"), false);
  assert.equal(Object.hasOwn(plan, "css"), false);
});

test("visible slide plans preserve complete citation excerpts and never mutate approved protected evidence", () => {
  const source = item();
  const before = structuredClone(source);
  const plan = planSlideLayout(source);

  assert.deepEqual(source, before, "the approved durable item is never mutated");
  assert.equal(plan.visibleItem.slide.citations[0].excerpt, before.slide.citations[0].excerpt);
  assert.equal(source.slide.citations[0].excerpt, before.slide.citations[0].excerpt);
  assert.equal(plan.visibleItem.slide.citations[0].label, "Approved interview");
  assert.equal(plan.visibleItem.slide.citations[0].anchor, "Authored slide 2");
  assert.equal(plan.visibleItem.slide.citations[0].sourceId, "PRIVATE_AUTHORIZED_SOURCE_42");
  assert.equal(plan.visibleItem.slide.quote.text, protectedQuote);
  assert.deepEqual(plan.visibleItem.slide.visual.data, source.slide.visual.data);
  assert.equal(plan.visibleItem.slide.visual.exactValue, "61.125");
  assert.equal(plan.visibleItem.slide.visual.displayValue, "61.13");
  assert.deepEqual(plan.visibleItem.context_group_ids, ["context_group_1"]);
  assert.equal(plan.overflow.citationExcerpts, 1);
  assert.ok(plan.overflow.reasons.includes("citation-excerpts"));
});

test("real executive slide nine coordinates dense copy and a complete full-width source rail",()=>{
  const excerpt="Make Intelligence and Cost Understandable. At 20,000 input and 4,000 output tokens, estimated model costs are Luna $0.0088, Terra $0.0880, and Sol $0.2200. Proposed Fast, Balanced, and Deep modes apply organization-approved models, spending limits, measured escalation, explicit premium approvals, and visible cost consequences.";
  const source=item({
    title:"Make Intelligence and Cost Understandable",
    body:"At 20,000 input and 4,000 output tokens, estimated model costs are Luna $0.0088, Terra $0.0880, and Sol $0.2200.",
  });
  source.slide.layout="comparison";
  source.slide.bullets=["Proposed Fast, Balanced, and Deep modes apply organization-approved models, spending limits, measured escalation, explicit premium approvals, and visible cost consequences."];
  source.slide.quote=undefined;
  source.slide.citations=[{sourceId:"PRIVATE_AUTHORIZED_SOURCE_42",label:"Approved interview",anchor:"Slide 9",excerpt}];
  source.slide.visual={
    kind:"comparison",
    label:"Estimated cost",
    value:"20,000 input + 4,000 output tokens",
    data:[
      {label:"Luna",value:"$0.0088",weight:.04},
      {label:"Terra",value:"$0.0880",weight:.4},
      {label:"Sol",value:"$0.2200",weight:1},
    ],
  };

  const plan=planSlideLayout(source,defaultSlidePresentation("field-notes"));

  assert.equal(plan.density,"dense","dense typography is adaptation, not an instruction to hide a fitting slide");
  assert.equal(plan.citationPlacement,"full-width","a protected source excerpt owns the whole evidence row");
  assert.ok(plan.overflow.reasons.includes("long-bullet"));
  assert.ok(plan.overflow.reasons.includes("long-citation-excerpt"));
  assert.ok(plan.overflow.narrativeCharacters>300);
  assert.ok(plan.overflow.citationCharacters>300);
  assert.equal(plan.visibleItem.slide.citations[0].excerpt,excerpt,"the complete approved excerpt is never summarized or mutated");
  assert.deepEqual(plan.visibleItem.slide.visual.data.map(({label,value})=>[label,value]),[
    ["Luna","$0.0088"],["Terra","$0.0880"],["Sol","$0.2200"],
  ]);
});

test("trusted layout measurements cover protected evidence and every structured visual kind",()=>{
  for(const selector of [
    ".presentation-slide__footnotes",
    ".presentation-slide__matrix",
    ".presentation-slide__table",
    ".presentation-visual-bars",
    ".presentation-visual-timeline",
    ".presentation-visual-diagram",
    ".presentation-slide__quote-card",
  ])assert.ok(PRESENTATION_VISUAL_FIT_SELECTOR.includes(selector),`${selector} is verified before visual display or PDF release`);
});

test("dense protected quotations, score rows, and bullets are classified rather than dropped", () => {
  const source = item({
    title: "T".repeat(PRESENTATION_LAYOUT_CAPACITIES.titleCharacters + 1),
    body: "B".repeat(PRESENTATION_LAYOUT_CAPACITIES.bodyCharacters + 1),
  });
  source.slide.quote.text = "Q".repeat(PRESENTATION_LAYOUT_CAPACITIES.quoteCharacters + 80);
  source.slide.bullets = Array.from({ length: 9 }, (_, index) => `Protected decision ${index + 1}`);
  source.slide.visual.data = Array.from({ length: 12 }, (_, index) => ({
    label: `Protected source category ${index + 1}`,
    value: `${index + 1}.25`,
    weight: (index + 1) / 20,
    sourceIds: ["PRIVATE_AUTHORIZED_SOURCE_42"],
  }));

  const plan = planSlideLayout(source);

  assert.equal(plan.density, "dense");
  assert.equal(plan.className, "presentation-slide--density-dense");
  assert.equal(plan.overflow.readingModeRecommended, true);
  assert.equal(plan.visibleItem.title, source.title);
  assert.equal(plan.visibleItem.body, source.body);
  assert.equal(plan.visibleItem.slide.quote.text, source.slide.quote.text);
  assert.equal(plan.visibleItem.slide.bullets.length, 9);
  assert.equal(plan.visibleItem.slide.visual.data.length, 12);
  for (const reason of ["long-title", "long-body", "long-quotation", "many-bullets", "many-data-points"]) {
    assert.ok(plan.overflow.reasons.includes(reason), `${reason} remains visible to trusted layout policy`);
  }
});

test("provider layout guidance protects exact authored evidence and forbids executable layout", () => {
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /960 × 540px 16:9 artboard/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /never permission to truncate or omit a protected quotation/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /chart row, authored slide, or source citation/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /Budget the title, body, bullets, chart labels and values, and every complete source excerpt together/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /full-width evidence rail/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /never emit HTML, CSS, JavaScript, iframes/u);
});

test("reading posture preserves useful laptop slides and activates for narrow or short surfaces", () => {
  assert.equal(presentationRequiresReadingPosture(320, 568), true);
  assert.equal(presentationRequiresReadingPosture(390, 844), true);
  assert.equal(presentationRequiresReadingPosture(844, 250), true);
  assert.equal(presentationRequiresReadingPosture(591, 333), false);
  assert.equal(presentationRequiresReadingPosture(744, 419), false);
  assert.equal(presentationRequiresReadingPosture(1280, 720), false);
  assert.equal(presentationRequiresReadingPosture(0, 540), false);
});

test("complete readers retain every citation for an authorized source without admitting foreign evidence",()=>{
  const citations=[
    {sourceId:"authorized-source",label:"Approved interview",anchor:"Slide 1",excerpt:"The first complete approved quotation."},
    {sourceId:"authorized-source",label:"Approved interview",anchor:"Slide 2",excerpt:"The second distinct approved quotation."},
    {sourceId:"foreign-source",label:"Approved interview",anchor:"Slide 3",excerpt:"Foreign project evidence must never appear."},
  ];
  const resolved=authorizedPresentationCitations(citations,"authorized-source","Approved interview");
  assert.deepEqual(resolved.map((citation)=>citation.excerpt),[
    "The first complete approved quotation.",
    "The second distinct approved quotation.",
  ]);
  assert.ok(resolved.every((citation)=>citation.sourceId==="authorized-source"));
  assert.equal(authorizedPresentationCitations([
    {label:"Approved interview",anchor:"Slide 4",excerpt:"Approved unlabeled provenance."},
    {label:"Another source",anchor:"Slide 5",excerpt:"Not approved for this reference."},
  ],"authorized-source","Approved interview").length,1);
  const oneSource=authorizedPresentationCitations([
    {sourceId:"authorized-source",label:"Approved interview",anchor:"Slide 1",excerpt:"Approved protected excerpt."},
    {label:"Foreign private project",anchor:"Slide 2",excerpt:"FOREIGN_SECRET_EXCERPT"},
  ],"authorized-source","Approved interview");
  assert.deepEqual(oneSource.map((citation)=>citation.excerpt),["Approved protected excerpt."],"one authorized reference never legitimizes unbound foreign-project evidence");
});
