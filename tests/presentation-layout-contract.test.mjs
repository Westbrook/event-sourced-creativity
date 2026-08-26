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
  assert.equal(plan.visualPlacement, "side-by-side");
  assert.match(plan.className, /^presentation-slide--density-(?:comfortable|compact|dense)$/u);
  assert.equal(Object.hasOwn(plan, "html"), false);
  assert.equal(Object.hasOwn(plan, "css"), false);
});

test("dense multi-category diagrams receive full visual width without losing any authored row", () => {
  const source = item({ title: "One idea. Dozens of files. Too many places to lose the plot.", body: "Contrast fragmented documents, design assets, audio, video, captions, approvals, and drifting versions." });
  source.slide = { layout: "architecture", kicker: "The friction", bullets: [], sourceIds: ["approved-source"], visual: {
    kind: "architecture", label: "A fragmented creative-work ecosystem", value: "",
    data: Array.from({ length: 8 }, (_, index) => ({ label: `Creative category ${index + 1}`, value: "Complete source-authored file formats, applications, handoffs, and approval evidence.", weight: 1, sourceIds: ["approved-source"] })),
  } };
  const before = structuredClone(source), plan = planSlideLayout(source);
  assert.equal(plan.density, "dense");
  assert.equal(plan.visualPlacement, "full-width");
  assert.deepEqual(source, before);
  assert.deepEqual(plan.visibleItem.slide.visual.data, before.slide.visual.data);
  assert.equal(planSlideLayout({ ...source, body: "A long independent audience argument. ".repeat(20) }).visualPlacement, "side-by-side", "a full-height narrative must not be squeezed above a diagram");
  assert.equal(planSlideLayout({ ...source, slide: { ...source.slide, layout: "cover" } }).visualPlacement, "side-by-side");
});

test("audience plans preserve complete private provenance without budgeting or displaying it", () => {
  const source = item();
  source.slide.citations[0].label = "Narrative brief";
  source.slide.citations[0].anchor = "Slide 2";
  const before = structuredClone(source);
  const plan = planSlideLayout(source);

  assert.deepEqual(source, before, "the approved durable item is never mutated");
  assert.equal(plan.visibleItem.slide.citations[0].excerpt, before.slide.citations[0].excerpt);
  assert.equal(source.slide.citations[0].excerpt, before.slide.citations[0].excerpt);
  assert.equal(plan.visibleItem.slide.citations[0].label, "Narrative brief");
  assert.equal(plan.visibleItem.slide.citations[0].anchor, "Slide 2");
  assert.equal(plan.visibleItem.slide.citations[0].sourceId, "PRIVATE_AUTHORIZED_SOURCE_42");
  assert.equal(plan.visibleItem.slide.quote.text, protectedQuote);
  assert.deepEqual(plan.visibleItem.slide.visual.data, source.slide.visual.data);
  assert.equal(plan.visibleItem.slide.visual.exactValue, "61.125");
  assert.equal(plan.visibleItem.slide.visual.displayValue, "61.13");
  assert.deepEqual(plan.visibleItem.context_group_ids, ["context_group_1"]);
  assert.deepEqual(plan.audienceCitations, [], "internal provenance never occupies the audience artboard");
  assert.equal(plan.overflow.citationExcerpts, 0);
  assert.equal(plan.overflow.citationCharacters, 0);
  assert.ok(!plan.overflow.reasons.includes("citation-excerpts"));
});

test("real executive slide nine preserves complete private evidence without forcing an evidence rail",()=>{
  const excerpt="Make Intelligence and Cost Understandable. At 20,000 input and 4,000 output tokens, estimated model costs are Luna $0.0088, Terra $0.0880, and Sol $0.2200. Proposed Fast, Balanced, and Deep modes apply organization-approved models, spending limits, measured escalation, explicit premium approvals, and visible cost consequences.";
  const source=item({
    title:"Make Intelligence and Cost Understandable",
    body:"At 20,000 input and 4,000 output tokens, estimated model costs are Luna $0.0088, Terra $0.0880, and Sol $0.2200.",
  });
  source.slide.layout="comparison";
  source.slide.bullets=["Proposed Fast, Balanced, and Deep modes apply organization-approved models, spending limits, measured escalation, explicit premium approvals, and visible cost consequences."];
  source.slide.quote=undefined;
  source.slide.citations=[{sourceId:"PRIVATE_AUTHORIZED_SOURCE_42",label:"Narrative brief",anchor:"Slide 9",excerpt}];
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
  assert.equal(plan.citationPlacement,"inline","private evidence never creates a slide-consuming source rail");
  assert.ok(plan.overflow.reasons.includes("long-bullet"));
  assert.ok(!plan.overflow.reasons.includes("long-citation-excerpt"));
  assert.ok(plan.overflow.narrativeCharacters>300);
  assert.equal(plan.overflow.citationCharacters,0);
  assert.deepEqual(plan.audienceCitations,[]);
  assert.equal(plan.visibleItem.slide.citations[0].excerpt,excerpt,"the complete approved excerpt is never summarized or mutated");
  assert.deepEqual(plan.visibleItem.slide.visual.data.map(({label,value})=>[label,value]),[
    ["Luna","$0.0088"],["Terra","$0.0880"],["Sol","$0.2200"],
  ]);
});

test("the real pitch comparison composes long authored use cases as a dense visual slide",()=>{
  const rows=[
    ["Founder","investor deck; thoughtful follow-up; product teaser"],
    ["Product team","sales presentation; campaign storyboard; launch video"],
    ["Educator","written lesson; visual explanation; audio-friendly companion"],
  ];
  const source=item({title:"Three moments. One adaptable story.",body:""});
  source.slide.layout="comparison";
  source.slide.kicker="CONCRETE USE CASES";
  source.slide.bullets=[];
  source.slide.quote=undefined;
  source.slide.citations=[{
    sourceId:"PRIVATE_AUTHORIZED_SOURCE_42",
    label:"Project message",
    anchor:"Slide 7",
    excerpt:"Founder, product team, and educator source material remains private and complete.",
  }];
  source.slide.visual={
    kind:"comparison",
    label:"One source, tailored expressions",
    value:"Three adaptable stories",
    data:rows.map(([label,value])=>({label,value,weight:1})),
  };

  const plan=planSlideLayout(source);

  assert.deepEqual(plan.overflow.reasons,["long-data-value"]);
  assert.equal(plan.overflow.narrativeCharacters,35);
  assert.equal(plan.overflow.visualCharacters,246);
  assert.equal(plan.density,"dense","long qualitative row values need dense typography before any reading fallback");
  assert.equal(plan.className,"presentation-slide--density-dense");
  assert.deepEqual(plan.visibleItem.slide.visual.data.map(({label,value})=>[label,value]),rows,"layout adaptation never truncates protected authored use cases");
  assert.deepEqual(plan.audienceCitations,[],"private production provenance does not consume visual space");
});

test("published external attributions remain compact while complete licensed evidence stays private",()=>{
  const source=item();
  source.slide.citations=[{
    sourceId:"PRIVATE_AUTHORIZED_SOURCE_42",
    label:"World Health Organization",
    anchor:"Published guidance § 4",
    excerpt:"The complete licensed excerpt stays available only to an authorized evidence reviewer.",
  }];
  const before=structuredClone(source);
  const plan=planSlideLayout(source);

  assert.deepEqual(source,before,"projection never modifies the approved evidence");
  assert.equal(plan.audienceCitations.length,1,"meaningful public attribution remains available");
  assert.equal(plan.audienceCitations[0].label,"World Health Organization");
  assert.equal(plan.audienceCitations[0].anchor,"Published guidance § 4");
  assert.equal(plan.audienceCitations[0].excerpt,"","licensed evidence is never copied onto the audience artboard");
  assert.equal(plan.audienceCitations[0].sourceId,undefined,"private source identifiers never enter the audience projection");
  assert.equal(plan.overflow.citationExcerpts,0);
  assert.equal(plan.overflow.citationCharacters,"World Health Organization".length+"Published guidance § 4".length);
  assert.equal(plan.visibleItem.slide.citations[0].excerpt,before.slide.citations[0].excerpt);
});

test("feedback slide four adapts dense audience copy while retaining all five matrix rows",()=>{
  const source=item({
    title:"Capturing the intended message: 3/10",
    body:"The exact promise appeared in the authored opening and closing, but the initial delivery never placed it in front of its audience.",
  });
  source.slide.layout="matrix";
  source.slide.quote=undefined;
  source.slide.bullets=[
    "Exact promise preserved: Your content. One context. Infinite paths to your target.",
    "Creator-led and recipient-led delivery remain equally explicit in the reusable story.",
    "File fragmentation remains complete: .doc, .ppt, .mov, .mp3, and .psd.",
    "No delivered slide made the complete promise independently visible outside its citations.",
  ];
  source.slide.citations=[{
    sourceId:"PRIVATE_AUTHORIZED_SOURCE_42",
    label:"Slide 4",
    anchor:"Message fidelity",
    excerpt:"Slide 4 — Message capture: show all five dimensions without exposing adapter instructions.",
  }];
  source.slide.visual={
    kind:"matrix",
    label:"Five message-fidelity dimensions",
    value:"3/10",
    data:[
      {label:"Exact promise",value:"Partially delivered",weight:.3},
      {label:"Creator agency",value:"Clearly authored",weight:.8},
      {label:"Recipient agency",value:"Clearly authored",weight:.8},
      {label:"Legacy formats",value:"Five retained",weight:1},
      {label:"Visible delivery",value:"Not independently verified",weight:.2},
    ],
  };

  const plan=planSlideLayout(source,defaultSlidePresentation("field-notes"));

  assert.ok(plan.overflow.narrativeCharacters>PRESENTATION_LAYOUT_CAPACITIES.narrativeCharacters);
  assert.equal(plan.density,"dense","dense audience copy receives the smaller protected slide composition");
  assert.deepEqual(plan.audienceCitations,[],"structural slide coordinates remain backstage");
  assert.equal(plan.overflow.citationCharacters,0);
  assert.equal(plan.visibleItem.slide.bullets.length,4);
  assert.equal(plan.visibleItem.slide.visual.data.length,5);
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
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /Budget only audience-facing title, body, bullets, chart labels and values/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /comparison-row values within 48 characters/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /otherwise preserve the complete value and choose a dense, readable visual layout/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /complete authorized citation excerpts in structured source provenance/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /never place full source excerpts, internal source labels, slide-number anchors, or adapter instructions on the audience artboard/u);
  assert.match(PRESENTATION_LAYOUT_PROVIDER_INSTRUCTIONS, /licensing, published research, quotations, or compliance/u);
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
