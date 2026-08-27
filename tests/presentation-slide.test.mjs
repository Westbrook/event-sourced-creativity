import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Lit supplies its own server-safe element base, but the locale provider also
// declares a browser-only custom element. A minimal constructor is sufficient
// to exercise real slide TemplateResults without a synthetic browser dependency.
globalThis.HTMLElement ??= class HTMLElement {};

const extensionlessTypeScriptHook = `
  export async function resolve(specifier, context, nextResolve) {
    try {
      return await nextResolve(specifier, context);
    } catch (error) {
      if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".")) {
        return nextResolve(specifier + ".ts", context);
      }
      throw error;
    }
  }
`;

register(`data:text/javascript,${encodeURIComponent(extensionlessTypeScriptHook)}`, import.meta.url);

const { PresentationSlide, presentationSlideRenderKey } = await import("../src/components/presentation-slide.ts");
const { applySlideStylePreset, defaultSlidePresentation, SLIDE_STYLE_PRESETS } = await import("../src/model/document-artifacts.ts");

const SCORES = [
  ["Phone", "39.75"],
  ["Tablet", "53.00"],
  ["Small monitor", "67.25"],
  ["Large monitor", "68.50"],
  ["Adaptive/accessibility", "58.75"],
  ["Governed creative loop", "79.50"],
];

const QUOTE = "The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable, reviewable, and reusable across devices.";

function renderMarkup(value) {
  if (value === null || value === undefined || typeof value === "symbol" || typeof value === "boolean") return "";
  if (Array.isArray(value)) return value.map(renderMarkup).join("");
  if (typeof value === "object" && Array.isArray(value.strings) && Array.isArray(value.values)) {
    return value.strings.reduce((markup, chunk, index) => markup + chunk + renderMarkup(value.values[index]), "");
  }
  return String(value);
}

function renderSlide(slide, overrides = {}) {
  const element = new PresentationSlide();
  element.item = {
    title: "Evidence-backed executive recommendation",
    body: "Every decision remains attributable to authorized authored context.",
    notes: "Keep the complete evidence in presenter notes.",
    image_prompt: "",
    slide,
    ...overrides.item,
  };
  element.presentation = overrides.presentation ?? null;
  element.index = overrides.index ?? 0;
  element.total = overrides.total ?? 12;
  element.compact = overrides.compact ?? false;
  if(overrides.locale)Object.defineProperty(element,"i18n",{value:overrides.locale});
  return renderMarkup(element.render());
}

function scorecard(overrides = {}) {
  return {
    layout: "scorecard",
    kicker: "Responsive product assessment",
    bullets: [],
    visual: {
      kind: "scorecard",
      label: "Six equally weighted product goals",
      value: "Six-goal assessment",
      exactValue: "61.125",
      displayValue: "61.13",
      unit: "/ 100",
      data: SCORES.map(([label, value]) => ({ label, value, displayValue: value, weight: Number(value) / 100 })),
    },
    ...overrides,
  };
}

test("real slide renderer exposes all six scorecard values and distinguishes exact from displayed precision", () => {
  const markup = renderSlide(scorecard());

  assert.match(markup, /<figure class="presentation-visual-bars"/);
  assert.equal((markup.match(/presentation-slide__chart-row/g) ?? []).length, SCORES.length);
  for (const [label, value] of SCORES) {
    assert.ok(markup.includes(label), `Missing visible score label: ${label}`);
    assert.match(markup, new RegExp(`<data value=${value.replace(".", "\\.")}>${value.replace(".", "\\.")}</data>`));
  }
  assert.match(markup, /<dt>Exact<\/dt>\s*<dd><data value=61\.125>61\.125 \/ 100<\/data><\/dd>/);
  assert.match(markup, /<dt>Displayed<\/dt>\s*<dd><data value=61\.13>61\.13 \/ 100<\/data><\/dd>/);
  assert.ok(markup.indexOf("<dt>Exact</dt>") < markup.indexOf("<dt>Displayed</dt>"));
  assert.match(markup, /<i aria-hidden="true">/);
});

test("canonical full and compact slides omit private production evidence without dropping visual data",()=>{
  const citation={label:"Approved source evidence",anchor:"Slide 1",excerpt:"The complete protected source excerpt remains visible."};
  for(const compact of [false,true]){
    const markup=renderSlide(scorecard({citations:[citation]}),{compact});
    assert.match(markup,/data-presentation-artboard="960x540"/);
    assert.match(markup,/data-layout-version=2/);
    assert.match(markup,/presentation-slide--density-compact/);
    assert.ok(!markup.includes(citation.label),"internal source labels never enter the audience slide");
    assert.ok(!markup.includes(citation.excerpt),"complete source excerpts remain in the authorized inspector");
    assert.doesNotMatch(markup,/presentation-slide__footnotes/);
    for(const[label,value]of SCORES)assert.ok(markup.includes(label)&&markup.includes(value));
  }
});

test("long private evidence never displaces the complete source-grounded audience visual",()=>{
  const excerpt="Approved model-cost evidence remains complete and attributable. ".repeat(6).trim();
  const citation={label:"Approved source evidence",anchor:"Slide 9",excerpt};
  const markup=renderSlide({
    layout:"comparison",
    kicker:"Overview",
    bullets:["Every authored model-cost consequence, spending limit, and explicit approval remains protected."],
    citations:[citation],
    visual:{
      kind:"comparison",
      label:"Estimated cost",
      value:"20,000 input + 4,000 output tokens",
      data:[
        {label:"Luna",value:"$0.0088",weight:.04},
        {label:"Terra",value:"$0.0880",weight:.4},
        {label:"Sol",value:"$0.2200",weight:1},
      ],
    },
  },{item:{title:"Make Intelligence and Cost Understandable"}});

  assert.doesNotMatch(markup,/presentation-slide--evidence-rail/);
  assert.match(markup,/data-citation-placement=inline/);
  assert.equal(markup.split(excerpt).length-1,0,"complete private evidence remains exclusively in authorized inspection");
  assert.match(markup,/<div class="presentation-slide__matrix">/);
  assert.doesNotMatch(markup,/presentation-slide__footnotes/);
  for(const value of ["$0.0088","$0.0880","$0.2200"])assert.ok(markup.includes(value));
});

test("published research attribution stays visible without exposing source coordinates or licensed excerpts",()=>{
  const citation={
    sourceId:"private-authorized-source-must-never-be-disclosed",
    label:"World Health Organization",
    anchor:"Published guidance § 4",
    excerpt:"The complete licensed passage must remain private to the authorized evidence reviewer.",
  };
  const markup=renderSlide(scorecard({citations:[citation]}));

  assert.match(markup,/presentation-slide__footnotes/);
  assert.ok(markup.includes("World Health Organization"));
  assert.ok(markup.includes("Published guidance § 4"));
  assert.ok(!markup.includes(citation.excerpt));
  assert.ok(!markup.includes(citation.sourceId));
  assert.doesNotMatch(markup,/presentation-slide__citation-excerpt/);
});

test("real pitch citations never print Narrative brief, structural slide metadata, or backstage excerpts",()=>{
  const excerpt="Slide 9 — Close with the exact promise: Your content. One context. Infinite paths to your target.";
  const markup=renderSlide({
    layout:"closing",
    kicker:"THE INVITATION",
    bullets:[],
    citations:[{label:"Narrative brief",anchor:"Slide 9",excerpt}],
    visual:{kind:"hero-type",label:"Start with one context",value:"Build the story once",data:[]},
  },{
    item:{title:"Build the story once",body:"Your content. One context. Infinite paths to your target."},
    index:8,
    total:9,
  });

  assert.ok(markup.includes("THE INVITATION"));
  assert.ok(markup.includes("Your content. One context. Infinite paths to your target."));
  assert.ok(!markup.includes("Narrative brief"));
  assert.ok(!markup.includes(excerpt));
  assert.doesNotMatch(markup,/presentation-slide__footnotes|presentation-slide--evidence-rail/);
  assert.match(markup,/class="presentation-visual-type"/);
});

test("each audience-facing visual label is rendered and announced only once",()=>{
  const cases=[
    {kind:"hero-type",layout:"statement",label:"The invitation",value:"One meaningful audience promise",data:[]},
    {kind:"bars",layout:"bars",label:"Confidence breakdown",value:"",data:[{label:"Confidence",value:"82%",weight:.82},{label:"Clarity",value:"91%",weight:.91}]},
    {kind:"roadmap",layout:"roadmap",label:"Forma output families",value:"Intentional adaptation",data:[{label:"Founder",value:"Investor deck",weight:1},{label:"Educator",value:"Written lesson",weight:1}]},
    {kind:"timeline",layout:"timeline",label:"Connected work, deliberately refreshed",value:"Visible review",data:[{label:"Direction",value:"Approved",weight:1},{label:"Delivery",value:"Scheduled",weight:1}]},
    {kind:"comparison",layout:"comparison",label:"Practices people can inspect",value:"Human review remains present",data:[{label:"Review",value:"Independent",weight:1},{label:"Approval",value:"Explicit",weight:1}]},
    {kind:"architecture",layout:"architecture",label:"A path for the moment",value:"One source",data:[{label:"Founder",value:"Pitch",weight:1},{label:"Educator",value:"Lesson",weight:1}]},
    {kind:"color-field",layout:"columns",label:"One adaptable creative world",value:"",data:[{label:"Narrative",value:"Available",weight:1},{label:"Visual",value:"Ready",weight:1}]},
  ];

  for(const{kind,layout,label,value,data}of cases){
    const markup=renderSlide({layout,kicker:"Distinct authored context",bullets:[],visual:{kind,label,value,data}});
    assert.equal(markup.split(label).length-1,1,`${kind} should not duplicate its visible caption in the footer or accessible names`);
    assert.match(markup,/<aside aria-label=Slide evidence>/,"visuals retain a distinct accessible landmark without repeating their captions");
  }
});

test("the real pitch slide seven remains a dense, complete semantic comparison slide",()=>{
  const rows=[
    ["Founder","investor deck; thoughtful follow-up; product teaser"],
    ["Product team","sales presentation; campaign storyboard; launch video"],
    ["Educator","written lesson; visual explanation; audio-friendly companion"],
  ];
  const label="One source, tailored expressions";
  const markup=renderSlide({
    layout:"comparison",
    kicker:"CONCRETE USE CASES",
    bullets:[],
    citations:[{label:"Project message",anchor:"Slide 7",excerpt:"Private authored use-case instructions remain inspectable backstage."}],
    visual:{kind:"comparison",label,value:"Three adaptable stories",data:rows.map(([rowLabel,rowValue])=>({label:rowLabel,value:rowValue,weight:1}))},
  },{item:{title:"Three moments. One adaptable story.",body:""},index:6,total:9});

  assert.match(markup,/presentation-slide--density-dense/);
  assert.match(markup,/<table class="presentation-slide__table">/);
  assert.equal((markup.match(/<th scope="row"/g)??[]).length,rows.length);
  assert.equal(markup.split(label).length-1,1,"the table caption is not repeated in its slide footer or accessible names");
  for(const[rowLabel,rowValue]of rows)assert.ok(markup.includes(rowLabel)&&markup.includes(rowValue),`the complete ${rowLabel} use case remains visible`);
  assert.ok(!markup.includes("Private authored use-case instructions"));
});

test("missing visual labels do not create blank captions or empty accessible names",()=>{
  const markup=renderSlide({
    layout:"comparison",
    kicker:"Authored evidence",
    bullets:[],
    visual:{kind:"comparison",label:"",value:"",data:[{label:"Founder",value:"Investor deck",weight:1},{label:"Educator",value:"Written lesson",weight:1}]},
  });

  assert.doesNotMatch(markup,/<caption[^>]*>\s*<\/caption>/);
  assert.doesNotMatch(markup,/aria-label=(?:""|\s|undefined)/);
  assert.ok(markup.includes("Founder"));
  assert.ok(markup.includes("Investor deck"));
});

test("feedback matrix preserves all delivery rows and bullets without producer directions",()=>{
  const rows=[
    ["Exact promise","Partially delivered"],
    ["Creator agency","Clearly authored"],
    ["Recipient agency","Clearly authored"],
    ["Legacy formats","Five retained"],
    ["Visible delivery","Not independently verified"],
  ];
  const bullets=[
    "Exact promise preserved: Your content. One context. Infinite paths to your target.",
    "Creator-led and recipient-led delivery remain equally explicit in the reusable story.",
    "File fragmentation remains complete: .doc, .ppt, .mov, .mp3, and .psd.",
    "No delivered slide made the complete promise independently visible outside its citations.",
  ];
  const excerpt="Slide 4 — Message capture: show all five dimensions without exposing adapter instructions.";
  const markup=renderSlide({
    layout:"matrix",
    kicker:"MESSAGE FIDELITY",
    bullets,
    citations:[{label:"Slide 4",anchor:"Message fidelity",excerpt}],
    visual:{kind:"matrix",label:"Five message-fidelity dimensions",value:"3/10",data:rows.map(([label,value])=>({label,value,weight:.5}))},
  },{
    item:{
      title:"Capturing the intended message: 3/10",
      body:"The exact promise appeared in the authored opening and closing, but the initial delivery never placed it in front of its audience.",
    },
    index:3,
    total:6,
  });

  assert.match(markup,/presentation-slide--density-dense/);
  assert.match(markup,/<table class="presentation-slide__table">/);
  assert.equal((markup.match(/<th scope="row"/g)??[]).length,5);
  for(const[label,value]of rows)assert.ok(markup.includes(label)&&markup.includes(value));
  for(const bullet of bullets)assert.ok(markup.includes(bullet));
  assert.ok(!markup.includes(excerpt));
  assert.doesNotMatch(markup,/presentation-slide__footnotes|presentation-slide--evidence-rail/);
});

test("feedback recommendations remain delivered without repeating their adapter or slide instructions",()=>{
  const recommendation="P0: Move generation to durable server-owned execution; add deterministic receipt reconciliation and safe nonduplicative recovery.";
  const privateExcerpt=`Slide 6 — ${recommendation}`;
  const markup=renderSlide({
    layout:"statement",
    kicker:"WHAT TO FIX FIRST",
    bullets:[],
    citations:[{label:"Slide 6",anchor:"Priority plan",excerpt:privateExcerpt}],
    visual:{kind:"hero-type",label:"Next step",value:"Fix the trust gap",data:[]},
  },{
    item:{title:"Fix the friction",body:recommendation},
    index:5,
    total:6,
  });

  assert.ok(markup.includes(recommendation),"the actual P0 recommendation remains useful delivery content");
  assert.ok(!markup.includes(privateExcerpt),"adapter scaffolding never duplicates the audience recommendation");
  assert.ok(!markup.includes("Priority plan"),"the private citation anchor is not delivery content");
  assert.doesNotMatch(markup,/presentation-slide__footnotes/);
});

test("audience-facing slide labels stay English when authored content is English and the application uses Japanese",()=>{
  const japanese={locale:"ja-JP",t:(_key,fallback)=>`日本語${fallback}`,system:(source)=>`日本語${source}`,number:(value,options)=>new Intl.NumberFormat("ja-JP",options).format(value)};
  const slide=scorecard({citations:[{label:"Approved source evidence",anchor:"Slide 1",excerpt:"The authored source remains accurate."}]});
  const markup=renderSlide(slide,{locale:japanese});
  assert.match(markup,/<dt>Exact<\/dt>/u);
  assert.match(markup,/<dt>Displayed<\/dt>/u);
  assert.match(markup,/Slide 1/u);
  assert.doesNotMatch(markup,/日本語|[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
});

test("roadmaps retain their authored duration even when no separate summary was generated",()=>{
  const markup=renderSlide({layout:"roadmap",kicker:"Delivery",bullets:[],visual:{kind:"roadmap",label:"Program",value:"",exactValue:"12–16",displayValue:"12–16 weeks",unit:"weeks",data:[{label:"1",value:"Secure Activity",weight:.5},{label:"2",value:"Phone Work/Chat",weight:1}]}});
  assert.match(markup,/<p class="presentation-slide__timeline-summary" dir="auto">12–16 weeks<\/p>/u);
  assert.doesNotMatch(markup,/12–16 weeks weeks|<dt>Exact<\/dt>|<dt>Displayed<\/dt>/u);
});

test("full attributed stakeholder quotations remain visible on quote and evidence slides without leaking source identifiers", () => {
  const quote = {
    text: QUOTE,
    speaker: "Amina Shah",
    role: "Product Owner",
    sourceId: "private-decision-uuid-must-never-be-disclosed",
    citation: "Authored product strategy",
  };
  const citations = [{
    sourceId: "private-citation-uuid-must-never-be-disclosed",
    label: "Executive stakeholder research",
    anchor: "[1]",
    excerpt: "Verbatim authored stakeholder evidence.",
  }];

  const quoteMarkup = renderSlide({
    layout: "quote",
    kicker: "Stakeholder perspective",
    bullets: [],
    quote,
    citations,
    sourceIds: ["private-slide-uuid-must-never-be-disclosed"],
    visual: { kind: "quote", label: "Product Owner", value: "", data: [] },
  });

  assert.ok(QUOTE.length > 120, "Fixture must reproduce the former quote-truncation boundary.");
  assert.match(quoteMarkup, /<figure class="presentation-slide__quote-card"/);
  assert.match(quoteMarkup, /<blockquote><p class="presentation-slide__quote-text"/);
  assert.ok(quoteMarkup.includes(QUOTE));
  assert.match(quoteMarkup, /<cite dir="auto">Amina Shah<\/cite>/);
  assert.ok(quoteMarkup.includes("Product Owner"));
  assert.ok(!quoteMarkup.includes("Authored product strategy"), "generic producer provenance is not public quote attribution");
  assert.ok(quoteMarkup.includes("Executive stakeholder research"));
  assert.ok(!quoteMarkup.includes("Verbatim authored stakeholder evidence."), "complete interview evidence remains private");
  assert.doesNotMatch(quoteMarkup, /private-(?:decision|citation|slide)-uuid/);

  const evidenceMarkup = renderSlide(scorecard({ quote }));
  assert.ok(evidenceMarkup.includes(QUOTE), "A protected quote must remain visible even when the visual is a scorecard.");
  assert.equal((evidenceMarkup.match(/presentation-slide__chart-row/g) ?? []).length, SCORES.length);
});

test("licensed public quotation attribution remains visible without exposing its backstage excerpt",()=>{
  const attribution="© Licensed Acme Research";
  const markup=renderSlide({
    layout:"quote",
    kicker:"Customer perspective",
    bullets:[],
    quote:{text:QUOTE,speaker:"Amina Shah",role:"Product Owner",citation:attribution},
    citations:[{
      label:"Customer interview notes",
      anchor:"Slide 2",
      excerpt:"A private unredacted customer interview passage remains available only to an authorized reviewer.",
    }],
    visual:{kind:"quote",label:"Customer perspective",value:QUOTE,data:[]},
  });

  assert.ok(markup.includes(QUOTE));
  assert.ok(markup.includes("Amina Shah"));
  assert.ok(markup.includes("Product Owner"));
  assert.ok(markup.includes(attribution),"license-required quotation attribution remains audience-facing");
  assert.ok(!markup.includes("A private unredacted customer interview passage"));
});

test("comparison, personas, roadmap, architecture, and overflow visuals expose complete semantic evidence", () => {
  const comparisonRows = [
    ["Phone portrait", "Focused source and next action"],
    ["Phone landscape", "Source and selected output"],
    ["Tablet portrait", "Touch-first workspace"],
    ["Tablet landscape", "Canvas and source context"],
    ["Small monitor", "Focused production and review"],
    ["Large monitor", "Source, work, output, and review"],
  ].map(([label, value]) => ({ label, value, weight: .7 }));

  for (const kind of ["comparison", "matrix", "personas", "color-field"]) {
    const markup = renderSlide({
      layout: kind === "color-field" ? "columns" : kind,
      kicker: "Device posture comparison",
      bullets: [],
      visual: { kind, label: "Device and orientation evidence", value: "Every posture remains complete", data: comparisonRows },
    });

    assert.match(markup, /<table class="presentation-slide__table">/);
    assert.match(markup, /<caption class="presentation-slide__caption"/);
    assert.equal((markup.match(/<th scope="row"/g) ?? []).length, comparisonRows.length);
    for (const { label, value } of comparisonRows) {
      assert.ok(markup.includes(label), `${kind} omitted label ${label}`);
      assert.ok(markup.includes(value), `${kind} omitted value ${value}`);
    }
  }

  const roadmap = renderSlide({
    layout: "roadmap",
    kicker: "Delivery dependencies",
    bullets: [],
    visual: {
      kind: "roadmap",
      label: "Dependency-aware implementation timeline",
      value: "Accountable staged delivery",
      data: [
        { label: "First useful release", value: "4–6 weeks", weight: .3 },
        { label: "Coordinated comprehensive program", value: "12–16 weeks", weight: .9 },
      ],
    },
  });
  assert.match(roadmap, /<ol class="presentation-visual-timeline"/);
  assert.ok(roadmap.includes("4–6 weeks"));
  assert.ok(roadmap.includes("12–16 weeks"));

  const architecture = renderSlide({
    layout: "architecture",
    kicker: "Stable information architecture",
    bullets: [],
    visual: {
      kind: "architecture",
      label: "All authorized destinations",
      value: "Creative project",
      data: ["Projects", "Work", "Explore", "Activity", "Deliver", "Review"].map((label, index) => ({
        label,
        value: `Relationship ${index + 1}`,
        weight: .8,
      })),
    },
  });
  assert.ok(architecture.includes("--slide-node-count:6"));
  assert.equal((architecture.match(/presentation-slide__diagram-node/g) ?? []).length, 6);
  for (const destination of ["Projects", "Work", "Explore", "Activity", "Deliver", "Review"]) {
    assert.ok(architecture.includes(destination), `Diagram omitted ${destination}`);
  }
  assert.ok(architecture.includes("Relationship 6"), "Diagram must preserve node values and labels.");
});

test("long assistant foundations remain complete in a responsive structured architecture diagram",()=>{
  const centralClaim="A consistent experience connects work context with responsive coordination.";
  const interaction="page-specific intent and proposal-first actions";
  const grounding="event-derived work";
  const architecture=renderSlide({
    layout:"architecture",
    kicker:"Architecture overview",
    bullets:[],
    visual:{kind:"architecture",label:"Assistant foundations",value:centralClaim,data:[
      {label:"Interaction",value:interaction,weight:.9},
      {label:"Grounding",value:grounding,weight:.85},
    ]},
  });

  assert.match(architecture,/class=presentation-visual-diagram presentation-slide__diagram presentation-slide__diagram--structured/);
  assert.match(architecture,/--slide-node-count:2/);
  assert.match(architecture,/<strong dir="auto">A consistent experience connects work context with responsive coordination\.<\/strong>/);
  assert.equal((architecture.match(/presentation-slide__diagram-node/g)??[]).length,2);
  for(const copy of ["Assistant foundations","Interaction",interaction,"Grounding",grounding]){
    assert.ok(architecture.includes(copy),`Architecture diagram must preserve the complete authored text: ${copy}`);
  }
  assert.doesNotMatch(architecture,/coordination\.\.\.|Ground\s+ing|aria-hidden="true"/);

  const concise=renderSlide({layout:"architecture",kicker:"Assistant foundations",bullets:[],visual:{kind:"architecture",label:"Connected work",value:"One workflow",data:[{label:"Intent",value:"Clear",weight:1},{label:"Context",value:"Grounded",weight:1}]}});
  assert.doesNotMatch(concise,/presentation-slide__diagram--structured/,"brief architecture labels retain their bounded circular composition");
});

test("hero visuals retain supplemental source facts instead of silently dropping visual data", () => {
  const markup = renderSlide({
    layout: "statement",
    kicker: "Protected research finding",
    bullets: [],
    visual: {
      kind: "hero-type",
      label: "Supporting evidence",
      value: "A traceable creative system",
      data: [
        { label: "Governed creative loop", value: "79.50", weight: .795 },
        { label: "Delivery horizon", value: "12–16 weeks", weight: .7 },
      ],
    },
  });

  assert.match(markup, /<dl class="presentation-slide__data-list"/);
  assert.ok(markup.includes("Governed creative loop"));
  assert.ok(markup.includes("79.50"));
  assert.ok(markup.includes("Delivery horizon"));
  assert.ok(markup.includes("12–16 weeks"));
});

test("the actual existing split stakeholder quote is reconstructed as one complete attributed slide quotation", () => {
  const prefix = "“The differentiator is not that one brief can make five artifacts; it is that every artifact remains traceable, editable";
  const continuation = "reviewable, and reusable across devices.”";
  const markup = renderSlide({
    layout: "statement",
    kicker: "Stakeholder recommendation",
    bullets: [],
    visual: {
      kind: "hero-type",
      label: "Product Owner",
      value: prefix,
      data: [{ label: "Continuation", value: continuation, weight: 1 }],
    },
  });

  assert.match(markup, /<blockquote><p class="presentation-slide__quote-text"/);
  assert.ok(markup.includes(QUOTE), "Existing artifacts must recover the exact complete authored statement.");
  assert.match(markup, /<cite dir="auto">Product Owner<\/cite>/);
  assert.doesNotMatch(markup, /<dt[^>]*>Continuation<\/dt>/);
  assert.match(markup, /visual-quote/);
});

test("opaque internal source aliases and UUIDs never appear in visible citations or quote attribution", () => {
  const opaqueLabels = [
    "blk_001",
    "grp_002",
    "clm_003",
    "source_004",
    "passage_007",
    "decision_5",
    "context_group_6",
    "01a03126-27c6-77d5-a77c-0a7d5218e24e",
  ];
  const citations = opaqueLabels.map((label, index) => ({
    sourceId: `private-source-${index}`,
    label,
    anchor: opaqueLabels[(index + 1) % opaqueLabels.length],
    excerpt: `Authorized source excerpt ${index + 1}`,
  }));
  const markup = renderSlide(scorecard({
    citations,
    quote: { text: QUOTE, speaker: "Product Owner", role: "Product Owner", citation: "source_991" },
  }));

  for (const opaque of [...opaqueLabels, "source_991"]) {
    assert.ok(!markup.includes(opaque), `Opaque private identifier leaked into the rendered slide: ${opaque}`);
  }
  assert.ok(markup.includes(QUOTE));
  assert.ok(markup.includes("Product Owner"));
  assert.doesNotMatch(markup,/presentation-slide__footnotes/);
  for (let index = 0; index < opaqueLabels.length; index += 1) {
    assert.ok(!markup.includes(`Authorized source excerpt ${index + 1}`), "Complete private evidence remains available only in authorized inspection.");
  }
});

test("public research attribution survives real slide rendering without leaking private passage anchors", () => {
  const citations = [{ sourceId: "private-research", label: "Published research passage_001", anchor: "Appendix B passage_002", excerpt: "PRIVATE_PASSAGE_EXCERPT" }];
  const original = structuredClone(citations);
  const markup = renderSlide(scorecard({ citations }));
  assert.match(markup, /Published research/u);
  assert.match(markup, /Appendix B/u);
  assert.doesNotMatch(markup, /passage_\d+|PRIVATE_PASSAGE_EXCERPT/u);
  assert.deepEqual(citations, original, "rendering does not mutate the canonical anchor or excerpt");
});

test("every supported presentation preset supplies 4.5:1 body, muted, accent, and inverted accent contrast", () => {
  const linear = (channel) => {
    const normalized = channel / 255;
    return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => .2126 * linear(Number.parseInt(hex.slice(1, 3), 16))
    + .7152 * linear(Number.parseInt(hex.slice(3, 5), 16))
    + .0722 * linear(Number.parseInt(hex.slice(5, 7), 16));
  const contrast = (left, right) => {
    const [light, dark] = [luminance(left), luminance(right)].sort((first, second) => second - first);
    return (light + .05) / (dark + .05);
  };

  for (const preset of SLIDE_STYLE_PRESETS) {
    const presentation = applySlideStylePreset(defaultSlidePresentation(), preset.id);
    const markup = renderSlide(scorecard(), { presentation });
    const colors = Object.fromEntries([...markup.matchAll(/--slide-([a-z-]+):(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]));

    assert.ok(contrast(colors.bg, colors.ink) >= 4.5, `${preset.id} body contrast is insufficient`);
    assert.ok(contrast(colors.bg, colors.muted) >= 4.5, `${preset.id} muted contrast is insufficient`);
    assert.ok(contrast(colors.bg, colors["accent-ink"]) >= 4.5, `${preset.id} accent text contrast is insufficient`);
    assert.ok(contrast(colors.accent, colors["on-accent"]) >= 4.5, `${preset.id} inverted accent contrast is insufficient`);
  }
});

test("native slide rendering preserves a safe authored brand typeface",()=>{
  const markup=renderSlide(scorecard(),{presentation:{...defaultSlidePresentation("editorial"),fontFamily:"Helvetica Neue"}});
  assert.match(markup,/--slide-font:(?:&quot;|")Helvetica Neue(?:&quot;|"),sans-serif/);
});

function fitHarness(context) {
  const descriptors = Object.fromEntries(["document", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map(), events = [], fonts = new EventTarget();
  fonts.status = "loaded";
  fonts.ready = Promise.resolve();
  let frameId = 0, connected = true, hasArtboard = true;
  Object.assign(globalThis, {
    document: { fonts },
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  context.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const element = new PresentationSlide();
  element.item = { title: "A durable creative beginning", body: "", notes: "", image_prompt: "", slide: {
    layout: "cover", kicker: "", bullets: [], visual: { kind: "hero-type", label: "", value: "Give the audience a useful path", data: [] },
  } };
  const artboard = { clientWidth: 960, clientHeight: 540, scrollWidth: 960, scrollHeight: 540, dataset: { layoutDensity: "comfortable" } };
  const section = { clientWidth: 432, clientHeight: 240, scrollWidth: 432, scrollHeight: 240 };
  Object.defineProperties(element, {
    dataset: { value: {} },
    isConnected: { get: () => connected },
    clientWidth: { value: 960 },
    clientHeight: { value: 540 },
  });
  element.querySelector = () => hasArtboard ? artboard : null;
  element.querySelectorAll = () => hasArtboard ? [artboard, section] : [];
  element.dispatchEvent = (event) => { events.push(event.detail); return true; };
  element.requestUpdate = () => {};
  const render = () => {
    const markup = renderMarkup(element.render());
    artboard.dataset.layoutDensity = markup.match(/data-layout-density=(\w+)/)[1];
    element.updated();
  };
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); };
  return { element, artboard, section, events, fonts, frames, render, flush,
    connect: (value) => { connected = value; }, show: (value) => { hasArtboard = value; } };
}

test("fit receipts distinguish revisions and rendering inputs even when the boolean result stays true", (context) => {
  const fit = fitHarness(context);
  fit.render(); fit.flush();
  const firstKey = fit.events[0].renderKey;
  fit.element.item = structuredClone(fit.element.item);
  fit.render(); fit.flush();
  assert.equal(fit.events[1].renderKey, firstKey, "fresh normalized objects are not new content");
  fit.element.item = { ...fit.element.item, title: "A revised creative beginning" };
  fit.render(); fit.flush();
  assert.equal(fit.events.length, 3);
  assert.ok(fit.events.every((event) => event.contentFits));
  assert.notEqual(fit.events[2].renderKey, firstKey);
  const item = fit.element.item, presentation = defaultSlidePresentation();
  const key = presentationSlideRenderKey(item, presentation, 0, 9);
  for (const changed of [
    presentationSlideRenderKey(item, { ...presentation, fontFamily: "Helvetica Neue" }, 0, 9),
    presentationSlideRenderKey(item, presentation, 1, 9),
    presentationSlideRenderKey(item, presentation, 0, 10),
    presentationSlideRenderKey(item, presentation, 0, 9, false),
    presentationSlideRenderKey(item, presentation, 0, 9, true, true),
    presentationSlideRenderKey(item, presentation, 0, 9, true, false, "ar"),
  ]) assert.notEqual(changed, key);
});

test("an obsolete font wait cannot publish a receipt for a replaced revision or disconnected slide", async (context) => {
  const fit = fitHarness(context);
  let finishFonts;
  fit.fonts.status = "loading";
  fit.fonts.ready = new Promise((resolve) => { finishFonts = resolve; });
  fit.render();
  assert.equal(fit.frames.size, 0);
  fit.element.item = { ...fit.element.item, title: "The revised fitting slide" };
  fit.fonts.status = "loaded";
  fit.render(); fit.flush();
  const currentKey = fit.events[0].renderKey;
  finishFonts(); await Promise.resolve(); fit.flush();
  assert.equal(fit.events.length, 1);
  assert.equal(fit.events[0].renderKey, currentKey);

  fit.fonts.status = "loading";
  fit.fonts.ready = new Promise((resolve) => { finishFonts = resolve; });
  fit.render(); fit.connect(false);
  finishFonts(); await Promise.resolve(); fit.flush();
  assert.equal(fit.events.length, 1);
  fit.connect(true); fit.fonts.status = "loaded";
  fit.render(); fit.flush();
  assert.equal(fit.events.length, 2);
});

test("real overflow receives at most two semantic reflows and a new revision resets density", (context) => {
  const fit = fitHarness(context);
  fit.section.scrollHeight = 600;
  fit.render(); fit.flush();
  assert.equal(fit.events.length, 0);
  fit.render(); fit.flush();
  assert.equal(fit.artboard.dataset.layoutDensity, "compact");
  assert.equal(fit.events.length, 0);
  fit.render(); fit.flush();
  assert.deepEqual(fit.events.map(({ contentFits, density }) => ({ contentFits, density })), [{ contentFits: false, density: "dense" }]);
  assert.equal(fit.element.dataset.presentationFitState, "overflow");
  fit.element.item = { ...fit.element.item, title: "Corrected layout" };
  fit.section.scrollHeight = 240;
  fit.render(); fit.flush();
  assert.equal(fit.artboard.dataset.layoutDensity, "comfortable");
  assert.equal(fit.events.at(-1).contentFits, true);
});

test("empty and hidden artboards remain pending but collapsed visible content is an overflow failure", (context) => {
  const fit = fitHarness(context);
  fit.show(false); fit.render(); fit.flush();
  assert.equal(fit.events.length, 0);
  assert.equal(fit.element.dataset.presentationFitState, "pending");
  assert.equal(fit.element.dataset.presentationContentFits, undefined);
  fit.show(true); fit.artboard.clientHeight = 0;
  fit.render(); fit.flush();
  assert.equal(fit.events.length, 0);
  fit.artboard.clientHeight = 540; fit.section.clientHeight = 0;
  for (let attempt = 0; attempt < 3; attempt++) { fit.render(); fit.flush(); }
  assert.equal(fit.events.length, 1);
  assert.equal(fit.events[0].contentFits, false);
  assert.equal(fit.events[0].density, "dense");
});
