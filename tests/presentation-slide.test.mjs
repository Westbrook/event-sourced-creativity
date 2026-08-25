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

const { PresentationSlide } = await import("../src/components/presentation-slide.ts");
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

test("canonical full and compact slides retain complete protected citation evidence",()=>{
  const citation={label:"Approved source evidence",anchor:"Slide 1",excerpt:"The complete protected source excerpt remains visible."};
  for(const compact of [false,true]){
    const markup=renderSlide(scorecard({citations:[citation]}),{compact});
    assert.match(markup,/data-presentation-artboard="960x540"/);
    assert.match(markup,/data-layout-version=1/);
    assert.match(markup,/presentation-slide--density-compact/);
    assert.ok(markup.includes(citation.label));
    assert.ok(markup.includes(citation.excerpt));
    for(const[label,value]of SCORES)assert.ok(markup.includes(label)&&markup.includes(value));
  }
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
  assert.ok(quoteMarkup.includes("Authored product strategy"));
  assert.ok(quoteMarkup.includes("Executive stakeholder research"));
  assert.ok(quoteMarkup.includes("Verbatim authored stakeholder evidence."));
  assert.doesNotMatch(quoteMarkup, /private-(?:decision|citation|slide)-uuid/);

  const evidenceMarkup = renderSlide(scorecard({ quote }));
  assert.ok(evidenceMarkup.includes(QUOTE), "A protected quote must remain visible even when the visual is a scorecard.");
  assert.equal((evidenceMarkup.match(/presentation-slide__chart-row/g) ?? []).length, SCORES.length);
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
  assert.ok((markup.match(/Authored source/g) ?? []).length >= opaqueLabels.length);
  for (let index = 0; index < opaqueLabels.length; index += 1) {
    assert.ok(markup.includes(`Authorized source excerpt ${index + 1}`), "Legitimate source excerpts must remain intact.");
  }
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
