import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const presentation = styles.slice(
  styles.indexOf("forma-presentation-deck {"),
  styles.indexOf("html[data-document-focus] .document-artifacts"),
);

const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return presentation.match(new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`))?.[1] ?? "";
};

test("essential presentation switches, navigation, and selectors meet the 44px touch target", () => {
  assert.match(styles, /--forma-control-min-size:\s*2\.75rem/);

  const navigation = rule(".presentation-deck-view-switch button");
  assert.match(navigation, /min-height:\s*var\(--forma-control-min-size,2\.75rem\)/);
  assert.match(navigation, /min-width:\s*var\(--forma-control-min-size,2\.75rem\)/);

  const styleSelector = rule(".presentation-deck-style select");
  assert.match(styleSelector, /min-height:\s*var\(--forma-control-min-size,2\.75rem\)/);
  assert.match(presentation, /\.presentation-deck-toolbar :is\(button,select,\.artifact-slide-footer-toggle\)[^{]*\{[^}]*min-block-size:\s*var\(--forma-control-min-size,2\.75rem\)[^}]*min-inline-size:\s*var\(--forma-control-min-size,2\.75rem\)/);
  assert.match(presentation, /\.presentation-deck-list summary/);
  assert.match(presentation, /\.presentation-deck-jump select/);
  assert.match(presentation, /\.presentation-deck-reader > summary/);
});

test("slide-jump selectors keep complete native options on one ellipsized line",()=>{
  assert.match(presentation,/\.presentation-deck-jump \{[^}]*min-width:\s*0;[^}]*max-inline-size:\s*100%;[^}]*flex-wrap:\s*nowrap/,"the slide label and selector stay on one responsive line");
  assert.match(presentation,/\.presentation-deck-jump select \{[^}]*min-inline-size:\s*var\(--forma-control-min-size,2\.75rem\)[^}]*max-inline-size:\s*min\(18rem,70vi\)[^}]*flex:\s*1 1 auto[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/,"long slide titles truncate visually without modifying their complete option labels");
});

test("presentation text and complete structured visual labels never shrink below twelve pixels", () => {
  const minimums = [...presentation.matchAll(/font-size:\s*clamp\((\.?\d+(?:\.\d+)?)rem/g)]
    .map(([, minimum]) => Number(minimum));

  assert.ok(minimums.length >= 16, "every presentation label and structured visual is covered");
  assert.ok(minimums.every((minimum) => minimum >= .75), `presentation text minimums: ${minimums.join(", ")}`);

  for (const selector of [
    ".presentation-visual-bars > div",
    ".presentation-visual-timeline small",
    ".presentation-visual-diagram span",
    ".presentation-visual-fields span",
    ".presentation-slide__citation",
  ]) assert.match(rule(selector), /font-size:\s*clamp\(\.(?:75|8125|875)rem/);
});

test("architecture diagrams reserve stable readable geometry across embedded and fullscreen slide sizes",()=>{
  assert.match(presentation,/(?:^|\n)forma-presentation-slide \{[^}]*container:\s*presentation-slide-host\s*\/\s*size/,"the canonical slide host provides both contain-fit dimensions");
  assert.match(presentation,/forma-presentation-slide > \.presentation-slide\[data-presentation-artboard\] \{[^}]*width:\s*960px[^}]*height:\s*540px[^}]*scale:\s*var\(--presentation-slide-scale,1\)/,"each slide has one invariant 960-by-540 composition");
  assert.match(presentation,/forma-presentation-slide > \.presentation-slide\[data-presentation-artboard\] \{[^}]*margin:\s*0;[^}]*border:\s*0;[^}]*color:\s*var\(--slide-ink\);[^}]*background:\s*var\(--slide-bg\)/,"shared-page article chrome cannot offset or recolor protected slide artwork");
  assert.doesNotMatch(styles,/\.shared-grid\s+article(?:\s+(?:h3|p|small))?\s*\{/u,"shared-page card typography cannot overwrite protected slide typography");
  assert.match(presentation,/@supports \(scale:\s*calc\(100cqi\s*\/\s*960px\)\)/,"modern browsers progressively enhance to native two-axis scaling");
  assert.match(presentation,/(?:^|\n)\.presentation-slide \{[^}]*container:\s*presentation-slide\s*\/\s*inline-size/,"existing presentation-slide container queries remain intact");

  const satellite=rule(".presentation-visual-diagram span");
  assert.match(satellite,/width:\s*28%/,"circular satellites receive an explicit usable column rather than shrink-to-fit crumbs");
  assert.match(satellite,/\)\s*\*\s*35%/,"the bounded orbit leaves space for every satellite");
  assert.doesNotMatch(satellite,/overflow-wrap:\s*anywhere/,"ordinary labels such as Grounding must not split into arbitrary letter fragments");

  const radius=.35,satelliteWidth=.28,hubWidth=.42;
  assert.ok(.5-radius-satelliteWidth/2>=0,"the first circular label remains inside its visual");
  assert.ok(.5+radius+satelliteWidth/2<=1,"the final circular label remains inside its visual");
  assert.ok(.5-radius+satelliteWidth/2<=.5-hubWidth/2,"the circular labels never collide with the central hub");

  const structured=rule(".presentation-visual-diagram.presentation-slide__diagram--structured");
  assert.match(structured,/grid-template-columns:\s*repeat\(auto-fit,minmax\(min\(100%,8\.5rem\),1fr\)\)/,"long authored evidence occupies responsive nonoverlapping cards");
  assert.match(rule(".presentation-slide__diagram--structured > strong"),/grid-column:\s*1\s*\/\s*-1[^}]*aspect-ratio:\s*auto/,"long central claims expand naturally instead of overflowing a forced circular box");
  assert.match(rule(".presentation-slide__diagram--structured > strong:empty"),/display:\s*none/,"category-only architecture diagrams never show an empty statement card");
  assert.match(rule(".presentation-slide__diagram--structured > span"),/position:\s*static[^}]*max-width:\s*none[^}]*translate:\s*none/,"structured evidence remains in normal flow across display sizes");
  assert.match(rule(".presentation-slide__diagram--structured > .presentation-slide__caption"),/position:\s*static[^}]*grid-column:\s*1\s*\/\s*-1/,"the visual caption receives its own nonoverlapping row");
});

test("all chart points, compact bullets, visual labels, and verbatim stakeholder quotations remain available", () => {
  assert.doesNotMatch(presentation, /\.presentation-visual-fields\s+i:nth-child\(n\+\d+\)[^{]*\{[^}]*display:\s*none/);
  assert.doesNotMatch(presentation, /\.presentation-slide\.compact[^{}]*li:nth-child\(n\+\d+\)[^{]*\{[^}]*display:\s*none/);
  assert.doesNotMatch(rule(".presentation-visual-bars span"), /text-overflow:\s*ellipsis|white-space:\s*nowrap/);
  assert.doesNotMatch(rule(".presentation-visual-timeline small"), /text-overflow:\s*ellipsis|white-space:\s*nowrap/);
  assert.doesNotMatch(rule(".presentation-visual-type strong"), /-webkit-line-clamp:\s*\d+|max-height:\s*\d/);

  const quotation = rule(".presentation-slide .presentation-slide__quote-text");
  assert.match(quotation, /overflow:\s*visible/);
  assert.match(quotation, /overflow-wrap:\s*anywhere/);
  assert.match(quotation, /-webkit-line-clamp:\s*unset/);
  for(const selector of [".presentation-slide-body > aside",".presentation-visual-fields",".presentation-slide__footnotes"]){
    assert.match(rule(selector),/overflow:\s*clip/,`${selector} never creates a nested visual-slide scrollbar`);
  }
  assert.match(rule(".presentation-slide small"), /font-size:\s*max\(\.75rem,1em\)/);
  assert.match(rule(".presentation-visual-type strong"), /color:\s*var\(--slide-accent-ink,var\(--slide-ink\)\)/);
  assert.match(rule(".presentation-visual-diagram strong"), /color:\s*var\(--slide-on-accent,var\(--slide-bg\)\)/);
  assert.match(presentation, /@container presentation-slide \(max-width: 30rem\)/);
});

test("speaker notes, readable evidence, current-slide state, fullscreen, and forced colors have dedicated styles", () => {
  for (const selector of [
    ".presentation-deck-notes",
    ".presentation-deck-reader-content",
    ".presentation-deck-evidence",
    ".presentation-deck-source-chip",
    ".presentation-deck-list > li[aria-current=\"true\"]",
    "forma-presentation-deck:fullscreen",
    ".presentation-slide__table",
    ".presentation-slide__matrix",
    ".presentation-slide__footnotes",
  ]) assert.ok(presentation.includes(selector), `${selector} has a dedicated presentation style`);

  assert.match(presentation, /@media \(forced-colors: active\)/);
  assert.match(presentation, /@media \(max-height: 32rem\) and \(orientation: landscape\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*scroll-behavior:\s*auto[^}]*transition-duration:/);
  assert.match(rule(".presentation-deck:focus-visible"), /var\(--forma-focus-ring-color,var\(--accent\)\)/);
  assert.match(rule(".presentation-deck-stage > .presentation-deck-frame"), /touch-action:\s*pan-y/);
  assert.match(presentation, /\.presentation-deck-reader-content dl \{[^}]*grid-template-columns:\s*minmax\(0,1fr\) auto/);
});
