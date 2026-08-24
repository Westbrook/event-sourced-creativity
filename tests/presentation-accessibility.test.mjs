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
  assert.match(rule(".presentation-slide-body > aside"), /overflow:\s*auto/);
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
