import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const read = relative => readFile(new URL(relative, import.meta.url), "utf8");
const controls = postcss.parse(await read("../src/components/context-controls.css"));
const base = postcss.parse(await read("../src/styles.css"));
const responsive = postcss.parse(await read("../src/responsive-foundation.css"));
const value = (rule, property) => rule.nodes.find(node => node.type === "decl" && node.prop === property)?.value;
const rules = root => { const found = []; root.walkRules(rule => found.push(rule)); return found; };

// These are stylesheet-boundary tests, not browser layout or AT certification.
test("closed decision summaries do not inherit the expanded editor's broad column rule", () => {
  const broad = rules(controls).filter(rule => rule.parent.type === "atrule"
    && rule.parent.name === "container" && rule.parent.params === "(max-width:42rem)"
    && /\.block-heading$/u.test(rule.selector) && value(rule, "flex-direction") === "column");
  assert.equal(broad.length, 1);
  assert.equal(broad[0].selector, '.context-decision[data-controls-open="true"] .block-heading');
  assert.equal(value(broad[0], "align-items"), "stretch");
  assert.equal(rules(controls).some(rule => /\.block-heading$/u.test(rule.selector)
    && value(rule, "flex-direction") === "row"), false, "no forced row may override the inherited narrow fallback");
});

test("closed summaries retain the real narrow-container fallback and wrapping header groups", () => {
  const narrow = rules(base).find(rule => rule.selector === ".block-heading"
    && rule.parent.type === "atrule" && rule.parent.name === "container"
    && rule.parent.params === "(max-width: 370px)");
  assert.ok(narrow); assert.equal(value(narrow, "flex-direction"), "column");
  assert.equal(value(narrow, "align-items"), "stretch");
  assert.equal(value(rules(responsive).find(rule => rule.selector === ".context-block .block-heading"), "flex-wrap"), "wrap");
  assert.equal(value(rules(controls).find(rule => rule.selector === ".context-decision .block-heading-state"), "flex-wrap"), "wrap");
  assert.equal(value(rules(controls).find(rule => rule.selector === ".context-decision .handle"), "overflow-wrap"), "anywhere");
});

test("closed-card compactness preserves selection targets, spacing, and complete authored copy", () => {
  const selection = rules(controls).find(rule => rule.selector === ".context-decision-select");
  assert.equal(value(selection, "min-inline-size"), "44px");
  assert.equal(value(selection, "min-block-size"), "44px");
  const card = rules(controls).find(rule => rule.selector === ".context-decision");
  assert.equal(value(card, "padding"), "1rem"); assert.equal(value(card, "gap"), ".75rem");
  const copy = rules(controls).find(rule => rule.selector.includes(".context-protected-copy p"));
  assert.equal(value(copy, "max-block-size"), "none"); assert.equal(value(copy, "overflow"), "visible");
  assert.equal(value(copy, "white-space"), "pre-wrap");
});
