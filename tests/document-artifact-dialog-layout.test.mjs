import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const [styles, component] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8"),
]);
const stylesheet = postcss.parse(styles, { from: "src/styles.css" });

function declarations(selector, property) {
  const results = [];
  stylesheet.walkRules((rule) => {
    if (!rule.selectors?.includes(selector)) return;
    let conditional = false;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule") conditional = true;
    }
    if (conditional) return;
    rule.walkDecls(property, (declaration) => results.push(declaration.value));
  });
  return results;
}

const winning = (selector, property) => declarations(selector, property).at(-1);

test("creation dialog gives every dynamic child its intrinsic row without changing the output reader", () => {
  const form = ".document-artifact-dialog";
  const reader = ".document-artifact-reader";

  assert.equal(winning(form, "display"), "grid");
  assert.deepEqual(declarations(form, "grid-template-rows"), ["auto minmax(0,1fr) auto", "none"]);
  assert.equal(winning(form, "grid-template-rows"), "none");
  assert.equal(winning(form, "grid-auto-rows"), "max-content");
  assert.equal(winning(form, "align-content"), "start");
  assert.equal(winning(form, "overflow"), "auto");
  assert.equal(winning(form, "overscroll-behavior"), "contain");

  assert.equal(winning(reader, "display"), "grid");
  assert.equal(winning(reader, "grid-template-rows"), "auto minmax(0,1fr) auto");
  assert.equal(winning(reader, "grid-auto-rows"), undefined);
  assert.equal(winning(reader, "overflow"), "hidden");
  assert.match(winning(form, "max-height") ?? "", /100dvh/u);

  assert.match(component, /<form class="document-artifact-dialog"[\s\S]*?<header>[\s\S]*?<fieldset class="artifact-kind-picker"[\s\S]*?<section class="artifact-options"/u);
});

test("storyboard and video choices stay visible, operable, and independently scrollable", () => {
  const picker = ".artifact-kind-picker";
  const formPicker = ".document-artifact-dialog > .artifact-kind-picker";
  const label = ".artifact-kind-picker :is(button,label)";

  assert.equal(winning(formPicker, "min-block-size"), "10rem");
  assert.equal(winning(label, "min-height"), "10rem");
  assert.equal(winning(picker, "display"), "grid");
  assert.equal(winning(picker, "overflow"), "auto");
  assert.match(winning(picker, "grid-template-columns") ?? "", /repeat\(6,/u);
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*?\.artifact-kind-picker\s*\{\s*grid-template-columns:\s*repeat\(6,11rem\)/u);

  assert.match(component, /<fieldset class="artifact-kind-picker" aria-label="Artifact type">/u);
  assert.match(component, /<input type="radio" name="artifact-kind" value=\$\{kind\} \.checked=/u);
  assert.match(component, /@change=\$\{\(\)=>\{this\.#retireRequestReview\(\);this\.#selectArtifactKind\(kind\)/u);

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 732, height: 805 },
    { width: 1280, height: 800 },
  ]) {
    assert.ok(viewport.height - 2 * 16 >= 10 * 16, `${viewport.width}×${viewport.height} has room for the selectable format picker`);
  }
});

test("paid confirmation footer stays sticky while the creation form scrolls", () => {
  const footer = ".document-artifact-dialog > footer";

  assert.equal(winning(footer, "position"), "sticky");
  assert.equal(winning(footer, "inset-block-end"), "0");
  assert.equal(winning(footer, "z-index"), "2");
  assert.equal(winning(footer, "display"), "flex");
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*?\.document-artifact-dialog > footer,\.document-artifact-reader > footer\s*\{[^}]*flex-direction:\s*column/u);

  for (const selector of [footer, ".document-artifact-dialog > .artifact-kind-picker"]) {
    assert.notEqual(winning(selector, "visibility"), "hidden");
    assert.notEqual(winning(selector, "pointer-events"), "none");
  }
});

test("included transcripts and soundtrack companions keep their full focus outline inside the reader", () => {
  const supplementalSections = ".document-artifact-reader-content > :is(.forma-included-audio-transcripts,.forma-soundtrack-companions)";
  const inlineGutter = winning(supplementalSections, "margin-inline");
  const endGutter = winning(supplementalSections, "margin-block-end");
  const mainAudioGutter = winning(".artifact-audio-result", "padding");

  assert.ok(inlineGutter, "Both direct supplemental sections need space on both inline edges");
  assert.ok(endGutter, "The final section needs scrollable space below its focus outline");
  assert.equal(inlineGutter, mainAudioGutter, "Supplemental sections align with the main audio content");
  assert.equal(endGutter, mainAudioGutter, "The shared gutter also reserves space at the reader's end");

  // Source-level spacing contract, not a substitute for native focus/paint
  // evidence. The retained failure had a 3px outline plus a 3px offset.
  const focusOutset = 3 + 3;
  const clamp = /^clamp\(([\d.]+)rem,([\d.]+)vw,([\d.]+)rem\)$/u.exec(inlineGutter.replace(/\s+/gu, ""));
  assert.ok(clamp, "The gutter has responsive bounds instead of a fixed-width section");
  const [, minimumRem, viewportPercent, maximumRem] = clamp.map(Number);
  for (const rootPixels of [16, 32]) {
    for (const viewportPixels of [320, 640, 1280]) {
      const gutter = Math.max(minimumRem * rootPixels, Math.min(viewportPercent * viewportPixels / 100, maximumRem * rootPixels));
      assert.ok(gutter >= focusOutset, `${viewportPixels}px viewport/${rootPixels}px rem preserves the complete focus outset`);
    }
  }

  assert.equal(winning(".document-artifact-reader-content", "overflow"), "auto");
  assert.equal(winning(".document-artifact-reader-content", "overscroll-behavior"), "contain");
  assert.equal(winning(".document-artifact-reader-content", "scrollbar-gutter"), "stable");
  assert.equal(winning(".forma-soundtrack-companions", "padding"), "1rem");
  assert.equal(winning(".forma-soundtrack-companions", "margin-block-start"), "1rem");
  for (const property of ["overflow", "overflow-x", "overflow-y", "outline", "outline-width", "outline-offset", "z-index"]) {
    assert.equal(winning(supplementalSections, property), undefined, `Section spacing does not replace ${property}`);
  }
});
test("mobile grouped reader quantity wraps without changing the editing footer fallback", () => {
  const footer = ".document-artifact-reader > footer";
  const quantity = `${footer} > span`;
  const groupedQuantity = `${footer}:has(> forma-ui-popover.artifact-viewer-actions-popover) > span`;
  const mobileRules = (selector) => {
    const results = [];
    stylesheet.walkRules((rule) => {
      if (!rule.selectors?.includes(selector)) return;
      let mobile = false;
      for (let parent = rule.parent; parent; parent = parent.parent) {
        if (parent.type !== "atrule") continue;
        if (parent.name !== "media" || !/^\(max-width:\s*720px\)$/u.test(parent.params)) return;
        mobile = true;
      }
      if (mobile) results.push(rule);
    });
    return results;
  };
  const mobileValue = (selector, property) => {
    const values = [];
    for (const rule of mobileRules(selector)) {
      rule.walkDecls(property, (declaration) => values.push(declaration.value));
    }
    return values.at(-1);
  };

  // The retained 320px failure displayed "1 part" completely, but applied an
  // ellipsis policy. Only grouped More actions get wrapping metadata; editing
  // keeps its existing fallback beside nonshrinking Save/Cancel controls.
  // These source policies do not establish native full-text or control fit.
  assert.match(component, /const groupViewerActions=!editing&&viewerSecondaryCount>1;/u);
  assert.equal(mobileRules(groupedQuantity).length, 1);
  assert.equal(mobileValue(groupedQuantity, "min-inline-size"), "0");
  assert.equal(mobileValue(groupedQuantity, "flex"), "1 1 0");
  assert.equal(mobileValue(groupedQuantity, "white-space"), "normal");
  assert.equal(mobileValue(groupedQuantity, "overflow-wrap"), "anywhere");
  assert.equal(mobileValue(groupedQuantity, "max-inline-size"), "none");
  assert.equal(mobileValue(groupedQuantity, "overflow"), "visible");
  assert.equal(mobileValue(groupedQuantity, "text-overflow"), "clip");
  for (const property of ["overflow-x", "overflow-y", "-webkit-line-clamp"]) {
    assert.equal(mobileValue(groupedQuantity, property), undefined, `Grouped metadata must not truncate through ${property}`);
    assert.equal(winning(quantity, property), undefined, `The base quantity must not reintroduce ${property}`);
  }

  assert.equal(mobileRules(quantity).length, 1);
  assert.equal(mobileValue(quantity, "max-inline-size"), "35%");
  assert.equal(mobileValue(quantity, "overflow"), "hidden");
  assert.equal(mobileValue(quantity, "text-overflow"), "ellipsis");
  assert.equal(mobileValue(quantity, "white-space"), "nowrap");
  assert.equal(mobileValue(quantity, "flex"), undefined);
  assert.equal(mobileValue(quantity, "min-inline-size"), undefined);
  assert.equal(winning(quantity, "flex"), "0 0 auto");

  assert.equal(winning(footer, "position"), "sticky");
  assert.equal(winning(footer, "display"), "flex");
  assert.equal(winning(footer, "gap"), ".75rem");
  assert.equal(mobileValue(footer, "flex-direction"), "row");
  assert.equal(mobileValue(footer, "align-items"), "center");
  assert.equal(mobileValue(`${footer} > div`, "overflow-x"), "auto");
  assert.equal(mobileValue(`${footer} > div`, "flex-wrap"), "nowrap");
  assert.equal(mobileValue(`${footer} .button`, "flex"), "none");
  assert.equal(mobileValue(`${footer} .button`, "white-space"), "nowrap");

  const popover = ".artifact-viewer-actions-popover";
  assert.equal(winning(popover, "display"), "inline-block");
  for (const dimension of ["min-inline-size", "min-block-size"]) {
    assert.equal(winning(`${popover} .ui-popover-trigger`, dimension), "var(--forma-control-min-size,2.75rem)");
  }
  assert.equal(winning(`${popover} .ui-popover-panel`, "inline-size"), "min(24rem,calc(100dvi - 1rem))");
});
