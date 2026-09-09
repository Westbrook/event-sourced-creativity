import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const [source, artifacts] = await Promise.all([
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/components/document-artifacts.ts", import.meta.url), "utf8"),
]);
const stylesheet = postcss.parse(source, { from: "src/styles.css" });

function matchingRules(selector, container) {
  const matches = [];
  stylesheet.walkRules((rule) => {
    if (!rule.selectors?.includes(selector)) return;

    let query;
    let media;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "container") query = parent;
      if (parent.type === "atrule" && parent.name === "media") media = parent;
    }

    if (media || Boolean(container) !== Boolean(query)) return;
    if (container && !query.params.startsWith(`${container} `)) return;
    matches.push({ rule, query });
  });
  return matches;
}

function declaration(selector, property, container) {
  let value;
  for (const { rule } of matchingRules(selector, container)) {
    rule.walkDecls(property, (item) => { value = item.value; });
  }
  return value;
}

test("output creation responds to its actual document pane, not the desktop viewport", () => {
  assert.equal(declaration(".document-artifacts", "container"), "document-artifacts / inline-size");
  assert.equal(declaration(".document-artifacts", "min-inline-size"), "0");
  assert.equal(declaration(".document-artifacts", "max-inline-size"), "100%");

  const [responsive] = matchingRules(".document-artifacts > header", "document-artifacts");
  assert.ok(responsive, "document artifact controls must have their own named container query");
  assert.match(responsive.query.params, /^document-artifacts \(max-width:\s*32rem\)$/u);
  assert.equal(declaration(".document-artifacts > header", "flex-direction", "document-artifacts"), "column");
  assert.equal(declaration(".document-artifacts > header", "align-items", "document-artifacts"), "stretch");
  assert.equal(declaration(".document-artifacts > header > div", "flex-basis", "document-artifacts"), "auto");
  assert.equal(declaration(".document-artifacts > header > .button", "inline-size", "document-artifacts"), "100%");

  for (const paneWidth of [240, 320, 420, 512]) {
    assert.ok(paneWidth <= 32 * 16, `a ${paneWidth}px document pane wraps even in a 1280px desktop viewport`);
  }
  assert.ok(640 > 32 * 16, "a sufficiently wide document pane retains its horizontal header");
  assert.ok(640 <= 32 * 20, "the rem-based breakpoint grows with 125% text zoom");
});

test("output action remains visible, focusable, and usable with long translated labels", () => {
  const header = ".document-artifacts > header";
  const heading = ".document-artifacts > header > div";
  const action = ".document-artifacts > header > .button";

  assert.equal(declaration(header, "display"), "flex");
  assert.equal(declaration(header, "min-inline-size"), "0");
  assert.equal(declaration(header, "flex-wrap"), "wrap");
  assert.equal(declaration(heading, "min-inline-size"), "0");
  assert.equal(declaration(heading, "overflow-wrap"), "anywhere");
  assert.equal(declaration(action, "min-inline-size"), "0");
  assert.equal(declaration(action, "max-inline-size"), "100%");
  assert.equal(declaration(action, "white-space"), "normal");
  assert.equal(declaration(action, "overflow-wrap"), "anywhere");
  assert.match(declaration(action, "min-block-size") ?? "", /--forma-hit-target/u);

  for (const selector of [header, heading, action]) {
    for (const { rule } of [
      ...matchingRules(selector),
      ...matchingRules(selector, "document-artifacts"),
    ]) {
      rule.walkDecls(/^(?:overflow(?:-[xy])?|visibility|pointer-events)$/u, (item) => {
        assert.doesNotMatch(item.value, /^(?:hidden|clip|none)$/u, `${selector} must not hide a reachable control`);
      });
      rule.walkDecls(/^(?:left|right|margin-(?:left|right)|padding-(?:left|right))$/u, (item) => {
        assert.fail(`${selector} must use logical rather than directional ${item.prop}`);
      });
    }
  }

  assert.match(artifacts, /<header><div>[\s\S]*?<button type="button" class="button secondary compact"[^>]*@click=/u);
  assert.match(artifacts, /this\.querySelector<HTMLElement>\("\.document-artifacts > header > button"\)/u);
  assert.match(source, /:focus-visible\s*\{[^}]*outline:\s*2px/u);
});

test("split Document results keep the normal readable card floor at intermediate widths", () => {
  const selector = '.workspace-page[data-workbench="document"] #document-results-panel .document-artifacts.compact .document-artifact-list';
  assert.equal(declaration(selector, "grid-template-columns"), "repeat(auto-fit,minmax(min(100%,15rem),1fr))");
  assert.equal(declaration(".document-artifacts.compact .document-artifact-list", "grid-template-columns"), "repeat(auto-fit,minmax(min(100%,10rem),1fr))", "other compact consumers retain their existing layout");
  for (const width of [308, 413, 428, 446, 461]) assert.ok(width < 2 * 15 * 16 + 16);
  assert.equal(2 * 15 * 16 + 16, 496, "two cards require their reading floors plus the existing one-rem gap");
});

test("tight rail headers omit only the duplicate workspace identity when the switcher carries it", () => {
  const selector = 'html:not([data-document-focus]) .application-creative[data-nav-posture="rail"] > .topbar:has(> forma-ui-workspace-switcher > .ui-workspace-switcher a[aria-current="page"]) > .application-context > b';
  const rules = [];
  stylesheet.walkRules(rule => { if (rule.selector === selector) rules.push(rule); });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].parent.name, "media");
  assert.equal(rules[0].parent.params, "(max-width: 1050px)");
  assert.deepEqual(rules[0].nodes.map(item => [item.prop, item.value]), [["display", "none"]]);
  assert.doesNotMatch(selector, /top-actions|locale-switcher|avatar/u, "language and actor controls are not hidden");
});

// E residual contracts reuse the existing PostCSS dependency. These inspect
// emitted selectors/declarations, not a browser's cascade or text geometry.
const eResponsiveSource = await readFile(new URL("../src/responsive-foundation.css", import.meta.url), "utf8");
const eResponsiveStyles = postcss.parse(eResponsiveSource, { from: "src/responsive-foundation.css" });
const eViewer = ':is(.document-artifact-view[data-artifact-kind="slides"], .canvas-artifact-viewer[data-artifact-kind="slides"], .shared-presentation-dialog)[data-output-focus]';
const eCard = eViewer + " > :is(.document-artifact-reader, .canvas-artifact-viewer-card, .shared-presentation-card)";
const eHeader = eCard + " > :is(header, .artifact-viewer-header)";
const eActions = eHeader + " > :is(.document-artifact-reader-actions, .shared-presentation-actions)";
const eLandscape = "(max-height: 37.5rem) and (orientation: landscape)";
function eDeclaration(selector, property, media = null) {
  let value;
  eResponsiveStyles.walkRules(rule => {
    if (!rule.selectors?.includes(selector)) return;
    const ancestors = [];
    for (let node = rule.parent; node; node = node.parent)
      if (node.type === "atrule") ancestors.push(node);
    if (ancestors.some(node => node.name === "container")) return;
    const queries = ancestors.filter(node => node.name === "media");
    if (media ? queries.length !== 1 || queries[0].params !== media : queries.length) return;
    rule.walkDecls(property, declaration => { value = declaration.value; });
  });
  return value;
}

test("E layout: Slides landscape headers reserve content height without enlarging the artboard", () => {
  assert.equal(eDeclaration(eCard, "grid-template-rows", eLandscape), "auto minmax(0, 1fr)");
  assert.equal(eDeclaration(eHeader, "position", eLandscape), "relative");
  assert.equal(eDeclaration(eHeader, "inset", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "display", eLandscape), "flex");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "min-block-size", eLandscape), "var(--forma-hit-target)");
  assert.equal(eDeclaration(eHeader, "flex-wrap", eLandscape), "wrap");
  assert.equal(eDeclaration(eHeader, "align-items", eLandscape), "stretch");
  assert.equal(eDeclaration(eHeader, "overflow", eLandscape), "visible");
  assert.equal(eDeclaration(eHeader, "pointer-events", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "min-inline-size", eLandscape), "0");
  assert.equal(eDeclaration(eHeader, "max-inline-size", eLandscape), "100%");
  assert.equal(eDeclaration(eHeader + " > :is(.artifact-viewer-identity, div:first-child, h2)", "min-inline-size", eLandscape), "0");
  assert.equal(eDeclaration(eHeader + " > :is(.artifact-viewer-identity, div:first-child, h2)", "max-inline-size", eLandscape), "100%");
  assert.equal(eDeclaration(eHeader, "block-size"), undefined, "ordinary desktop/portrait viewer policies are not replaced");
});

test("E layout: native landscape action peers share a growing target floor and retain complete text", () => {
  for (const [property, value] of Object.entries({ position: "static", inset: "auto", display: "flex",
    "min-inline-size": "0", "max-inline-size": "100%", "flex-wrap": "wrap", "align-items": "stretch" }))
    assert.equal(eDeclaration(eActions, property, eLandscape), value);
  for (const selector of [eHeader + " > .button", eActions + " > :is(.button, .icon-button)"])
    for (const [property, value] of Object.entries({ "inline-size": "auto", "block-size": "auto",
      "min-inline-size": "var(--forma-hit-target)", "min-block-size": "var(--forma-hit-target)",
      "max-inline-size": "100%", "align-self": "stretch" }))
      assert.equal(eDeclaration(selector, property, eLandscape), value);
  for (const selector of [eHeader + " > .button", eActions + " > .button"])
    for (const [property, value] of Object.entries({ "padding-inline": "var(--forma-control-inset-inline)",
      overflow: "visible", "overflow-wrap": "anywhere", "white-space": "normal" }))
      assert.equal(eDeclaration(selector, property, eLandscape), value);
});

test("E layout: guest chrome and centered reading content use the same logical gutter", () => {
  const inset = "max(var(--page-gutter), calc((100% - 1300px) / 2 + var(--page-gutter)))";
  for (const selector of [".shared-locale-switcher", ".shared-view > header", ".shared-view > .shared-hero"])
    assert.equal(eDeclaration(selector, "padding-inline"), inset);
  assert.equal(eDeclaration(".shared-view > .shared-grid", "box-sizing"), "border-box");
  assert.equal(eDeclaration(".shared-view > .shared-grid", "inline-size"), "100%");
  assert.equal(eDeclaration(".shared-view > .shared-grid", "max-inline-size"), "1300px");
  assert.equal(eDeclaration(".shared-view > .shared-grid", "padding-inline"), "var(--page-gutter)");
  assert.equal(eDeclaration(".shared-view > .shared-grid", "max-inline-size", "(min-width: 90rem)"), "none");
  for (const selector of [".shared-locale-switcher", ".shared-view > header", ".shared-view > .shared-hero"])
    assert.equal(eDeclaration(selector, "padding-inline", "(min-width: 90rem)"), "var(--page-gutter)");
  assert.equal(eDeclaration(".shared-view > :is(header, .shared-hero)", "min-inline-size"), "0");
  assert.equal(eDeclaration(".shared-view > :is(header, .shared-hero)", "overflow-wrap"), "anywhere");
  assert.equal(eDeclaration(".shared-view > .shared-grid > :is(.shared-results, .shared-direction)", "min-inline-size"), "0");
  assert.match(source, /--page-gutter:\s*clamp\(1rem,\s*4vw,\s*4\.5rem\)/u);
  // Arithmetic of the declared box model only, including the intentional
  // 1300px maximum below the current 90rem wide-screen expansion. This is
  // not measured rendered geometry or text zoom.
  for (const rem of [16, 20, 32]) for (const width of [320, 390, 844, 1300, 1360, 1440, 1920]) {
    const gutter = Math.min(4.5 * rem, Math.max(rem, .04 * width));
    const wide = width >= 90 * rem;
    const readingEdge = (wide ? 0 : Math.max(0, (width - 1300) / 2)) + gutter;
    const chromeEdge = wide ? gutter : Math.max(gutter, (width - 1300) / 2 + gutter);
    assert.equal(chromeEdge, readingEdge, `same logical edge at ${width}px and ${rem}px root`);
    assert.ok(width - 2 * chromeEdge > 0, "the declared content width stays positive");
  }
});

test("E layout: unchanged contain-fit slide artwork and navigation remain scoped healthy controls", async () => {
  const [designSystem, entry, canvas] = await Promise.all([
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /forma-presentation-slide > \.presentation-slide\[data-presentation-artboard\] \{[^}]*width:\s*960px;[^}]*height:\s*540px;/u);
  assert.match(designSystem, /\.shared-presentation-viewport>forma-presentation-slide\{[^}]*width:min\(100cqi,calc\(100cqb \* 1\.7778\)\)[^}]*aspect-ratio:16\/9/u);
  assert.equal(eDeclaration(".shared-presentation-dialog .shared-presentation-stage[data-slide-posture] > nav > button", "inline-size"), "auto");
  assert.equal(eDeclaration(".shared-presentation-dialog .shared-presentation-stage[data-slide-posture] > nav > button", "block-size"), "auto");
  assert.match(entry, /import "\.\/styles\.css";\s*import "\.\/design-system\.css";\s*import "\.\/responsive-foundation\.css";/u);
  assert.match(artifacts, /data-output-focus=\$\{String\(this\.#viewerFocused\)\}/u);
  assert.match(canvas, /class="modal canvas-artifact-viewer" data-output-focus=\$\{String\(this\.#viewerFocused\)\} data-artifact-kind=\$\{artifact\.kind\}/u);
  const appended = eResponsiveSource.slice(eResponsiveSource.indexOf("/* Public share chrome follows"));
  assert.doesNotMatch(appended, /(?:aspect-ratio|scale|width:\s*960px|height:\s*540px|\.presentation-slide(?![\w-])|:root|\.welcome|\.app-shell)/u);
});

test("E5 source policy: the narrow stacked shared Slides identity uses its content height", async () => {
  // Reuse the existing source/PostCSS contract, not a simulated layout or
  // native geometry port. Original E5 six cases must precede this addition.
  const [sharedDesign, sharedView] = await Promise.all([
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shared-view.ts", import.meta.url), "utf8"),
  ]);
  const design = postcss.parse(sharedDesign, { from: "src/design-system.css" });
  const stackedHeaders = [];
  design.walkRules(rule => {
    if (rule.selector !== ".shared-presentation-card>header") return;
    const queries = [];
    for (let node = rule.parent; node; node = node.parent)
      if (node.type === "atrule") queries.push(node);
    if (queries.length !== 1 || queries[0].name !== "media"
      || queries[0].params.replace(/\s/gu, "") !== "(max-width:30rem)") return;
    const declarations = {};
    rule.walkDecls(item => { declarations[item.prop] = item.value; });
    stackedHeaders.push(declarations);
  });
  assert.equal(stackedHeaders.length, 1, "the actual shared viewer has one deliberate narrow stack policy");
  assert.equal(stackedHeaders[0]["flex-direction"], "column");
  assert.equal(stackedHeaders[0]["align-items"], "stretch");
  assert.match(sharedView, /<dialog class="modal shared-presentation-dialog" data-output-focus=\$\{String\(this\.#presentationFocused\)\}/u);
  assert.match(sharedView, /<section class="modal-card shared-presentation-card">\s*<header><div><span>/u);
  assert.match(sharedView, /<h2 id="shared-presentation-heading" dir="auto">\$\{artifact\.title\}<\/h2><\/div><div class="shared-presentation-actions">/u);
  assert.match(sharedView, /class="button secondary compact shared-presentation-reading-toggle"/u);
  assert.match(sharedView, /class="button secondary compact shared-presentation-focus-toggle"/u);
  assert.match(sharedView, /@click=\$\{\(\)=>this\.#closePresentation\(\)\}>\$\{this\.#i18n\.t\("action\.close","Close"\)\}/u);

  const identity = eHeader + " > :is(.artifact-viewer-identity, div:first-child, h2)";
  assert.equal(eDeclaration(eHeader, "display", eLandscape), "flex");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "min-block-size", eLandscape), "var(--forma-hit-target)");
  assert.equal(eDeclaration(identity, "flex", eLandscape), "1 1 16rem",
    "retain original E5's readable inline basis where the header is a row");
  assert.equal(eDeclaration(identity, "min-inline-size", eLandscape), "0");
  assert.equal(eDeclaration(eActions, "flex-wrap", eLandscape), "wrap");
  assert.equal(eDeclaration(eActions + " > .button", "white-space", eLandscape), "normal");
  // Existing Document artifact chrome already resets its basis when stacked.
  assert.equal(declaration(".document-artifacts > header", "flex-direction", "document-artifacts"), "column");
  assert.equal(declaration(".document-artifacts > header > div", "flex-basis", "document-artifacts"), "auto");

  const selector = ".modal.shared-presentation-dialog[data-output-focus] > .modal-card.shared-presentation-card > header > div:first-child";
  const media = "(max-width: 30rem) and (max-height: 37.5rem) and (orientation: landscape)";
  assert.equal(eDeclaration(selector, "flex-basis"), undefined, "no all-viewport replacement");
  assert.equal(eDeclaration(selector, "flex-basis", eLandscape), undefined, "no wider-row replacement");
  assert.equal(eDeclaration(selector, "flex-basis", media), "auto",
    "in the inherited column, the identity must use content height instead of a 16rem block-axis basis");
  const correction = [];
  eResponsiveStyles.walkRules(rule => {
    if (rule.selectors?.includes(selector)) correction.push(rule);
  });
  assert.equal(correction.length, 1);
  assert.deepEqual(correction[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["flex-basis", "auto"]], "no control, font, gutter, overflow or flow-direction changes");
});

test("E5 source policy: Canvas Slides footer reserves its own short-landscape row", async () => {
  // Source/declaration evidence only. The retained isolated Canvas pixels,
  // not this case, establish the footer/read-toggle collision.
  const [canvas, canvasCss, deck] = await Promise.all([
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
  ]);
  const begin = canvas.indexOf("  #artifactViewerDialog(){");
  const end = canvas.indexOf("  #outputViewerDialog(){", begin);
  assert.ok(begin >= 0 && end > begin, "inspect the actual current Canvas viewer owner");
  const viewer = canvas.slice(begin, end);
  assert.ok(viewer.includes('<article class="modal-card canvas-artifact-viewer-card">'));
  assert.ok(viewer.includes('class="artifact-viewer-actions-body"'));
  assert.ok(viewer.includes('class="artifact-viewer-actions-popover"'));
  assert.ok(viewer.includes('<footer data-actions-open='));
  assert.ok(viewer.includes('source-surface="canvas-artifact-viewer"'));
  assert.ok(viewer.includes("const canEditCanvas=this.#canEditCanvas();"));
  assert.ok(viewer.includes('const groupViewerActions=artifact.kind==="slides"&&(1+Number(!project)+Number(canEditCanvas))>1;'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.ok(viewer.includes("this.#closeCanvasArtifact()"));
  assert.match(canvasCss, /\.canvas-artifact-viewer-card\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto;[^}]*overflow:hidden;[^}]*padding:0\}/u);
  assert.match(canvasCss, /\.canvas-artifact-viewer-card>footer\{[^}]*display:flex;[^}]*border-top:1px solid var\(--line\)/u);
  assert.ok(deck.includes('class="button secondary compact presentation-deck-reading-toggle"'));
  const legacyFooter = '.canvas-artifact-viewer[data-artifact-kind="slides"] > .canvas-artifact-viewer-card > footer';
  assert.equal(eDeclaration(legacyFooter, "position", eLandscape), "absolute");
  assert.equal(eDeclaration(legacyFooter, "z-index", eLandscape), "7");
  assert.equal(eDeclaration(legacyFooter, "padding", eLandscape), ".125rem");
  const supporting = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-stage[data-slide-posture] > .presentation-deck-supporting';
  assert.equal(eDeclaration(supporting, "position"), "static");
  assert.equal(eDeclaration(supporting, "grid-row"), "2");
  assert.equal(eDeclaration(supporting, "grid-column"), "2");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader + " > .button", "min-block-size", eLandscape), "var(--forma-hit-target)");

  const card = '.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > .canvas-artifact-viewer-card';
  const footer = card + " > footer";
  assert.equal(eDeclaration(card, "grid-template-rows"), undefined, "no ordinary-viewport replacement");
  assert.equal(eDeclaration(footer, "position"), undefined, "no non-landscape footer replacement");
  assert.equal(eDeclaration(card, "grid-template-rows", eLandscape), "auto minmax(0, 1fr) auto",
    "the actual header, bounded deck and native footer must each own a normal-flow row");
  const expected = [
    ["position", "static"], ["inset", "auto"], ["z-index", "auto"], ["display", "flex"],
    ["max-inline-size", "100%"], ["padding", "var(--forma-focus-clearance)"],
    ["border", "0"], ["border-block-start", "1px solid var(--forma-color-border)"], ["border-radius", "0"],
  ];
  for (const [property, value] of expected)
    assert.equal(eDeclaration(footer, property, eLandscape), value);
  for (const [selector, declarations] of [[card, [["grid-template-rows", "auto minmax(0, 1fr) auto"]]], [footer, expected]]) {
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1, "one Canvas-only current-state policy");
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), declarations,
      "no artwork, native action, font, target-size or copy changes");
  }
});

test("E5 source policy: closed Canvas Slides tools use an intrinsic in-flow footprint", async () => {
  const [canvas, deck] = await Promise.all([
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(canvas.includes('source-surface="canvas-artifact-viewer"'));
  assert.ok(deck.includes('<header class="presentation-deck-toolbar" data-tools-open='));
  assert.match(deck, /<button type="button" class="button ghost compact presentation-deck-tools-toggle"[^>]*aria-expanded=[^>]*aria-controls=[^>]*@click=/u);
  assert.ok(deck.includes('this.i18n.system("Slideshow controls")'));
  assert.ok(deck.includes("this.#compactToolsOpen=!this.#compactToolsOpen;this.requestUpdate();"));
  const currentToolbar = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  const legacyToolbar = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  assert.equal(eDeclaration(currentToolbar, "position", eLandscape), "relative");
  assert.equal(eDeclaration(currentToolbar, "inset", eLandscape), "auto");
  assert.equal(eDeclaration(currentToolbar, "min-block-size", eLandscape), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(legacyToolbar + '[data-tools-open="false"] > div', "display", eLandscape), "none");
  assert.equal(eDeclaration(legacyToolbar + " > .presentation-deck-tools-toggle", "min-inline-size", eLandscape), "var(--forma-hit-target)");
  assert.equal(eDeclaration(legacyToolbar + " > .presentation-deck-tools-toggle", "min-block-size", eLandscape), "var(--forma-hit-target)");
  assert.equal(eDeclaration(".presentation-deck-tools-toggle", "min-inline-size", "(pointer: coarse)"), "var(--forma-hit-target-coarse)");
  assert.equal(eDeclaration(".presentation-deck-tools-toggle", "min-block-size", "(pointer: coarse)"), "var(--forma-hit-target-coarse)");
  assert.match(eResponsiveSource, /\.presentation-deck-toolbar\[data-tools-open="true"\]\s*\{\s*max-block-size:\s*min\(45dvb,18rem\);\s*overflow-x:\s*hidden;\s*overflow-y:\s*auto;/u);
  assert.match(eResponsiveSource, /\.presentation-deck-toolbar\[data-tools-open="true"\] > div\s*\{\s*display:\s*flex;[^}]*flex:\s*1 1 100%;[^}]*flex-wrap:\s*wrap;/u);

  const closed = '.canvas-artifact-viewer[data-artifact-kind="slides"] .presentation-deck-toolbar[data-tools-open="false"]';
  assert.equal(eDeclaration(closed, "inline-size"), undefined, "no all-viewport replacement");
  assert.equal(eDeclaration(closed, "inline-size", eLandscape), "max-content",
    "the single closed native tools trigger must not resemble a blank full-width field");
  const expected = [
    ["inline-size", "max-content"], ["justify-self", "end"], ["padding", "var(--forma-focus-clearance)"],
  ];
  for (const [property, value] of expected)
    assert.equal(eDeclaration(closed, property, eLandscape), value);
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(closed)) rules.push(rule); });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
    "only the closed wrapper footprint changes; native target floors, open wrapping and scrolling remain");
});

test("E5 source policy: Shared native chrome has clearance while content owns clipping", async () => {
  // Declaration/ownership contract only. Real focus, sibling paint, rounded
  // corners and native reading scroll remain the existing browser journey.
  const [sharedView, designSystem] = await Promise.all([
    readFile(new URL("../src/components/forma-shared-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
  ]);
  assert.ok(sharedView.includes('<section class="modal-card shared-presentation-card">'));
  assert.ok(sharedView.includes('class="button secondary compact shared-presentation-reading-toggle"'));
  assert.ok(sharedView.includes('class="button secondary compact shared-presentation-focus-toggle"'));
  assert.ok(sharedView.includes('<div class="shared-presentation-reader shared-presentation-reading" tabindex="0">'));
  assert.ok(sharedView.includes('this.querySelector(".shared-presentation-stage")'));
  assert.ok(sharedView.includes("this.#presentationObserver.observe(stage)"));
  assert.ok(sharedView.includes("this.#navigatePresentation(index-1)"));
  assert.ok(sharedView.includes("this.#navigatePresentation(index+1)"));
  assert.ok(sharedView.includes("if(opener?.isConnected)opener.focus({preventScroll:true})"));
  const readBegin = sharedView.indexOf("  #setPresentationReading(reading:boolean){");
  const readEnd = sharedView.indexOf("  #sharedSlideFit=", readBegin);
  assert.ok(readBegin >= 0 && readEnd > readBegin);
  assert.match(sharedView.slice(readBegin, readEnd),
    /querySelector<HTMLElement>\(reading\?"\.shared-presentation-reading":"\.shared-presentation-reading-toggle"\)\?\.focus\(\{preventScroll:true\}\)/u);
  const design = postcss.parse(designSystem, { from: "src/design-system.css" });
  const current = new Map();
  const owners = [".modal-card", ".shared-presentation-dialog>.shared-presentation-card",
    ".shared-presentation-viewport", ".shared-presentation-stage--reading>.shared-presentation-reading"];
  design.walkRules(rule => {
    if (!owners.includes(rule.selector) || rule.parent?.type !== "root") return;
    const declarations = current.get(rule.selector) ?? {};
    rule.walkDecls(item => { declarations[item.prop] = item.value; });
    current.set(rule.selector, declarations);
  });
  assert.equal(current.get(".modal-card")?.["border-radius"], "14px");
  assert.equal(current.get(".shared-presentation-dialog>.shared-presentation-card")?.["grid-template-rows"], "auto minmax(0,1fr)");
  assert.equal(current.get(".shared-presentation-dialog>.shared-presentation-card")?.height, "calc(100dvb - 1rem)");
  assert.equal(current.get(".shared-presentation-viewport")?.overflow, "hidden");
  const readerPolicy = current.get(".shared-presentation-stage--reading>.shared-presentation-reading");
  assert.equal(readerPolicy?.["overflow-x"], "hidden");
  assert.equal(readerPolicy?.["overflow-y"], "auto");
  assert.equal(readerPolicy?.["min-block-size"], "0");
  assert.equal(readerPolicy?.["overscroll-behavior"], "contain");
  const reader = ".shared-presentation-dialog .shared-presentation-stage.shared-presentation-stage--reading > .shared-presentation-reader.shared-presentation-reading";
  assert.equal(eDeclaration(reader, "position"), "static");
  assert.equal(eDeclaration(reader, "overflow-x"), "hidden");
  assert.equal(eDeclaration(reader, "overflow-y"), "auto");
  assert.equal(eDeclaration(reader, "block-size"), "100%");
  const nav = ".shared-presentation-dialog .shared-presentation-stage[data-slide-posture] > nav";
  assert.equal(eDeclaration(nav, "position"), "static");
  assert.equal(eDeclaration(nav, "grid-row"), "2");
  assert.equal(eDeclaration(nav + " > button", "min-inline-size"), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(nav + " > button", "min-block-size"), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader + " > .button", "min-block-size", eLandscape), "var(--forma-hit-target)");
  assert.match(eResponsiveSource, /--forma-focus-clearance:\s*\.5rem;/u);

  const card = ".modal.shared-presentation-dialog[data-output-focus] > .modal-card.shared-presentation-card";
  const header = card + " > header";
  const stage = card + " > .shared-presentation-stage[data-slide-posture]";
  const policies = [
    [card, [
      ["overflow", "visible"],
      ["padding-block", "max(var(--forma-focus-clearance), env(safe-area-inset-top, 0px)) max(var(--forma-focus-clearance), env(safe-area-inset-bottom, 0px))"],
      ["padding-inline", "max(var(--forma-focus-clearance), var(--forma-safe-inline-start, 0px)) max(var(--forma-focus-clearance), var(--forma-safe-inline-end, 0px))"],
      ["row-gap", "var(--forma-focus-clearance)"],
    ]],
    [header, [["padding-block", "0"]]],
    [stage, [["overflow", "visible"]]],
  ];
  for (const [selector, expected] of policies) {
    assert.equal(eDeclaration(selector, expected[0][0]), undefined, "no all-viewport replacement");
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "native chrome must have paint clearance; only the existing content viewport/reader clips");
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1, "one owned short-landscape rule");
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
      "no outline, color, radius, z-index, typography, dimensions or content-scroll changes");
  }
});

test("E5 source policy: Document Slides footer reserves its own short-landscape row", async () => {
  // Source/declaration evidence only. The actual retained Document screenshot
  // and native observation establish the floating footer/read-control overlap
  // and clipped More ring; this case does not simulate their paint or geometry.
  const begin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const end = artifacts.indexOf("  override render(){", begin);
  assert.ok(begin >= 0 && end > begin, "inspect the actual current Document viewer owner");
  const viewer = artifacts.slice(begin, end);
  assert.ok(viewer.includes('<article class="document-artifact-reader">'));
  assert.ok(viewer.includes('<header class="artifact-viewer-header">'));
  assert.ok(viewer.includes('class="artifact-viewer-actions-body"'));
  assert.ok(viewer.includes('class="artifact-viewer-actions-popover"'));
  assert.ok(viewer.includes('<footer data-actions-open='));
  assert.ok(viewer.includes('const groupViewerActions=!editing&&viewerSecondaryCount>1;'));
  assert.ok(viewer.includes('const canAuthor=!context||context.permissions.includes("project.author");'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.ok(viewer.includes('closedby=${editing?"closerequest":"any"}'));
  assert.ok(viewer.includes('@cancel=${this.#cancelViewer}'));
  assert.ok(viewer.includes('groupViewerActions?viewerMenuAction:undefined'));
  assert.equal(declaration(".document-artifact-reader", "grid-template-rows"), "auto minmax(0,1fr) auto");
  assert.equal(declaration(".document-artifact-reader", "overflow"), "hidden");
  assert.equal(declaration(".document-artifact-reader-content", "overflow"), "auto");
  assert.equal(declaration(".document-artifact-reader-content", "min-height"), "0");
  assert.equal(declaration(".artifact-viewer-actions-popover .ui-popover-trigger", "min-block-size"),
    "var(--forma-control-min-size,2.75rem)");

  const legacy = '.document-artifact-view[data-artifact-kind="slides"] > .document-artifact-reader > footer';
  assert.equal(eDeclaration(legacy, "position", eLandscape), "absolute");
  assert.equal(eDeclaration(legacy, "z-index", eLandscape), "7");
  assert.equal(eDeclaration(legacy, "padding", eLandscape), ".125rem");
  const reader = '.document-artifact-view[data-artifact-kind="slides"] > .document-artifact-reader';
  assert.equal(eDeclaration(reader, "min-block-size"), "0");
  assert.equal(eDeclaration(reader, "overflow"), "hidden");
  const reviewReader = '.document-artifact-view[data-artifact-kind="slides"]:not([data-output-focus="true"]) > .document-artifact-reader:has(> .artifact-review-actions:not([hidden]),> .artifact-review-guidance,> .artifact-revision-history:not([hidden]))';
  assert.equal(eDeclaration(reviewReader, "overflow-y"), "auto");
  assert.equal(eDeclaration(reviewReader, "overscroll-behavior"), "contain");
  const editor = '.document-artifact-view[data-artifact-kind="slides"] .document-artifact-reader-content:has(> .artifact-direct-editor)';
  assert.equal(eDeclaration(editor, "overflow-y"), "auto");
  assert.equal(eDeclaration(editor, "overscroll-behavior"), "contain");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader + " > .button", "min-block-size", eLandscape), "var(--forma-hit-target)");
  assert.match(eResponsiveSource, /--forma-focus-clearance:\s*\.5rem;/u);

  const card = '.document-artifact-view[data-artifact-kind="slides"][data-output-focus] > .document-artifact-reader';
  const footer = card + " > footer";
  const canvasCard = '.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > .canvas-artifact-viewer-card';
  const expected = [
    ["position", "static"], ["inset", "auto"], ["z-index", "auto"], ["display", "flex"],
    ["max-inline-size", "100%"], ["padding", "var(--forma-focus-clearance)"],
    ["border", "0"], ["border-block-start", "1px solid var(--forma-color-border)"], ["border-radius", "0"],
  ];
  assert.equal(eDeclaration(canvasCard, "grid-template-rows", eLandscape), "auto minmax(0, 1fr) auto");
  for (const [property, value] of expected)
    assert.equal(eDeclaration(canvasCard + " > footer", property, eLandscape), value,
      "reuse the already-established Canvas action-row policy");
  assert.equal(eDeclaration(card, "grid-template-rows"), undefined, "no ordinary-viewport replacement");
  assert.equal(eDeclaration(footer, "position"), undefined, "no non-landscape footer replacement");

  assert.equal(eDeclaration(card, "grid-template-rows", eLandscape), "auto minmax(0, 1fr) auto",
    "the actual header, bounded content and native footer must each own a normal-flow row");
  for (const [property, value] of expected)
    assert.equal(eDeclaration(footer, property, eLandscape), value);
  for (const [selector, declarations] of [[card, [["grid-template-rows", "auto minmax(0, 1fr) auto"]]], [footer, expected]]) {
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1, "one Document-only current-state policy");
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), declarations,
      "no artwork, native actions, authority, typography, target sizes, card clipping or content-scroll changes");
  }
});

test("E5 source policy: Slides position count participates in its current short-landscape navigation row", async () => {
  // Declaration/specificity contract only. Retained FR Canvas pixels show
  // the count over the reading heading; this does not simulate that paint.
  const deck = await readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8");
  assert.ok(deck.includes('<nav aria-label="Slideshow controls">'));
  assert.ok(deck.includes('<span class="presentation-deck-position" aria-hidden="true">${index+1} / ${total}</span>'));
  assert.ok(deck.includes('?disabled=${index===0}'));
  assert.ok(deck.includes('?disabled=${index===total-1}'));
  assert.ok(deck.includes('class="button secondary compact presentation-deck-reading-toggle"'));
  assert.ok(deck.includes('class="presentation-deck-reading" tabindex="0"'));
  assert.ok(deck.includes('role="status" aria-live="polite" aria-atomic="true"'));

  const legacy = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-stage > nav > .presentation-deck-position';
  assert.equal(eDeclaration(legacy, "position", eLandscape), "absolute");
  assert.equal(eDeclaration(legacy, "inset-block-start", eLandscape), ".375rem");
  assert.equal(eDeclaration(legacy, "inset-inline-start", eLandscape), ".375rem");
  assert.equal(eDeclaration(legacy, "padding", eLandscape), ".25rem .375rem");
  const nav = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-stage[data-slide-posture] > nav';
  assert.equal(eDeclaration(nav, "position"), "static");
  assert.equal(eDeclaration(nav, "grid-row"), "2");
  assert.equal(eDeclaration(nav, "display"), "flex");
  assert.equal(eDeclaration(nav, "overflow"), "hidden");
  for (const property of ["min-inline-size", "min-block-size"])
    assert.equal(eDeclaration(nav + " > button", property), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");

  // The existing narrow intent stays static. Its weaker selector is not
  // changed to absolute merely to agree with the defeated browser cascade.
  const narrow = ".presentation-deck-stage[data-slide-posture] > nav > .presentation-deck-position";
  const expected = [
    ["position", "static"], ["min-inline-size", "3.25rem"], ["padding", "0"], ["background", "transparent"],
  ];
  const narrowRules = [];
  eResponsiveStyles.walkRules(rule => {
    if (rule.selector !== narrow) return;
    const ancestry = [];
    for (let parent = rule.parent; parent; parent = parent.parent)
      if (parent.type === "atrule") ancestry.push([parent.name, parent.params]);
    if (ancestry.length === 1 && ancestry[0][0] === "container"
      && ancestry[0][1] === "presentation-deck-host (max-width: 46rem)") narrowRules.push(rule);
  });
  assert.equal(narrowRules.length, 1, "retain the actual narrow-container count policy");
  assert.deepEqual(narrowRules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected);

  // This exact current-view selector includes the same legacy owner plus
  // data-slide-posture: (0,5,1), versus legacy (0,4,1) and narrow (0,3,1).
  const selector = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-stage[data-slide-posture] > nav > .presentation-deck-position';
  assert.equal(eDeclaration(selector, "position"), undefined, "no all-viewport replacement");
  assert.equal(eDeclaration(selector, "position", eLandscape), "static",
    "the count must join the already-static navigation row instead of covering the reading viewport");
  for (const [property, value] of expected)
    assert.equal(eDeclaration(selector, property, eLandscape), value);
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
  assert.equal(rules.length, 1, "one current Document/Canvas short-landscape count policy");
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
    "reuse the existing static count without new dimensions, controls, copy, scrolling, stacking or reading-mode changes");
});

test("E5 source policy: closed Document Slides tools reuse the intrinsic native toolbar footprint", async () => {
  // Source/declaration evidence only. The actual Document More screenshot
  // retains the blank full-width closed toolbar; native fit remains a replay.
  const deck = await readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8");
  const begin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const end = artifacts.indexOf("  override render(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = artifacts.slice(begin, end);
  assert.ok(viewer.includes('<article class="document-artifact-reader">'));
  assert.ok(viewer.includes('<forma-presentation-deck .items=${deckItems}'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.ok(deck.includes('<header class="presentation-deck-toolbar" data-tools-open='));
  assert.match(deck, /<button type="button" class="button ghost compact presentation-deck-tools-toggle"[^>]*aria-expanded=[^>]*aria-controls=[^>]*@click=/u);
  assert.ok(deck.includes('this.i18n.system("Slideshow controls")'));
  assert.ok(deck.includes("this.#compactToolsOpen=!this.#compactToolsOpen;this.requestUpdate();"));

  const toolbar = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  const legacy = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  assert.equal(eDeclaration(toolbar, "position", eLandscape), "relative");
  assert.equal(eDeclaration(toolbar, "inset", eLandscape), "auto");
  assert.equal(eDeclaration(toolbar, "min-block-size", eLandscape), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(legacy + '[data-tools-open="false"] > div', "display", eLandscape), "none");
  for (const property of ["min-inline-size", "min-block-size"]) {
    assert.equal(eDeclaration(legacy + " > .presentation-deck-tools-toggle", property, eLandscape), "var(--forma-hit-target)");
    assert.equal(eDeclaration(".presentation-deck-tools-toggle", property, "(pointer: coarse)"), "var(--forma-hit-target-coarse)");
  }
  assert.match(eResponsiveSource, /\.presentation-deck-toolbar\[data-tools-open="true"\]\s*\{\s*max-block-size:\s*min\(45dvb,18rem\);\s*overflow-x:\s*hidden;\s*overflow-y:\s*auto;/u);
  assert.match(eResponsiveSource, /\.presentation-deck-toolbar\[data-tools-open="true"\] > div\s*\{\s*display:\s*flex;[^}]*flex:\s*1 1 100%;[^}]*flex-wrap:\s*wrap;/u);
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");

  const expected = [
    ["inline-size", "max-content"], ["justify-self", "end"], ["padding", "var(--forma-focus-clearance)"],
  ];
  const canvas = '.canvas-artifact-viewer[data-artifact-kind="slides"] .presentation-deck-toolbar[data-tools-open="false"]';
  for (const [property, value] of expected)
    assert.equal(eDeclaration(canvas, property, eLandscape), value, "reuse the established Canvas compact toolbar");
  const selector = '.document-artifact-view[data-artifact-kind="slides"] .presentation-deck-toolbar[data-tools-open="false"]';
  assert.equal(eDeclaration(selector, "inline-size"), undefined, "no all-viewport replacement");
  assert.equal(eDeclaration(selector, "inline-size", eLandscape), "max-content",
    "one closed native tools trigger must not resemble a blank full-width field");
  for (const [property, value] of expected)
    assert.equal(eDeclaration(selector, property, eLandscape), value);
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
  assert.equal(rules.length, 1, "one Document-only closed-toolbar policy");
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
    "only the closed wrapper footprint changes; native target floors, open wrapping, scrolling and artboard remain");
});

test("E5 source policy: existing Slides viewer rows reserve shared native focus clearance", async () => {
  // Declaration/ownership contract only. Actual Document Close pixels and
  // the retained native observation establish the next-row ring overlap.
  const [canvas, canvasCss, shared] = await Promise.all([
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/forma-shared-view.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(artifacts.includes('<article class="document-artifact-reader">'));
  assert.ok(artifacts.includes('<header class="artifact-viewer-header">'));
  assert.ok(canvas.includes('<article class="modal-card canvas-artifact-viewer-card">'));
  assert.ok(shared.includes('<section class="modal-card shared-presentation-card">'));
  assert.equal(eDeclaration(eHeader, "position", eLandscape), "relative");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "min-block-size", eLandscape), "var(--forma-hit-target)");
  assert.equal(eDeclaration(eHeader, "overflow", eLandscape), "visible");
  for (const card of [
    '.document-artifact-view[data-artifact-kind="slides"][data-output-focus] > .document-artifact-reader',
    '.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > .canvas-artifact-viewer-card',
  ]) assert.equal(eDeclaration(card, "grid-template-rows", eLandscape), "auto minmax(0, 1fr) auto");
  const sharedCard = ".modal.shared-presentation-dialog[data-output-focus] > .modal-card.shared-presentation-card";
  assert.equal(eDeclaration(sharedCard, "row-gap", eLandscape), "var(--forma-focus-clearance)",
    "reuse the already-established Shared native row clearance");
  assert.equal(eDeclaration(sharedCard, "overflow", eLandscape), "visible");
  assert.equal(declaration(".document-artifact-reader", "overflow"), "hidden");
  assert.equal(declaration(".document-artifact-reader-content", "overflow"), "auto");
  assert.match(canvasCss, /\.canvas-artifact-viewer-card\{[^}]*overflow:hidden;/u);
  assert.match(canvasCss, /\.canvas-artifact-viewer-content\{[^}]*min-height:0;[^}]*overflow:auto;/u);
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");
  assert.match(eResponsiveSource, /--forma-focus-clearance:\s*\.5rem;/u);

  assert.equal(eDeclaration(eCard, "row-gap"), undefined, "no all-viewport gap replacement");
  assert.equal(eDeclaration(eCard, "row-gap", eLandscape), "var(--forma-focus-clearance)",
    "normal-flow native chrome needs real space before the adjacent content/footer rows");
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(eCard)) rules.push(rule); });
  assert.equal(rules.length, 1, "extend the existing three-owner short-landscape card policy");
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), [
    ["grid-template-rows", "auto minmax(0, 1fr)"], ["row-gap", "var(--forma-focus-clearance)"],
  ], "only row clearance is added; card/content clipping, native controls and contain-fit artwork remain");
});

test("E5 source policy: Canvas Slides Close shares native Focus paint priority above the in-flow header", async () => {
  // Source policy only. The retained FR/EN Close observations independently
  // show the current header intercepting all five native body-hit samples.
  const [canvas, canvasCss] = await Promise.all([
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas.css", import.meta.url), "utf8"),
  ]);
  const begin = canvas.indexOf("  #artifactViewerDialog(){");
  const end = canvas.indexOf("  #outputViewerDialog(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = canvas.slice(begin, end);
  assert.ok(viewer.includes('data-output-focus=${String(this.#viewerFocused)}'));
  assert.ok(viewer.includes('<article class="modal-card canvas-artifact-viewer-card"><button type="button" autofocus class="icon-button canvas-viewer-focus-toggle"'));
  assert.ok(viewer.includes('@click=${()=>this.#setViewerFocus(!this.#viewerFocused)}'));
  assert.ok(viewer.includes('class="icon-button modal-close" aria-label="Close document output" @click=${()=>this.#closeCanvasArtifact()}'));
  assert.ok(viewer.includes('<header><span class="canvas-dialog-step">'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.ok(viewer.includes('source-surface="canvas-artifact-viewer"'));
  assert.match(canvasCss, /\.canvas-viewer-focus-toggle\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*2;/u);
  assert.match(canvasCss, /\.canvas-viewer-focus-toggle\s*\{[^}]*min-inline-size:\s*var\(--forma-control-min-size,2\.75rem\);[^}]*min-block-size:\s*var\(--forma-control-min-size,2\.75rem\);/u);
  assert.equal(eDeclaration(eHeader, "position", eLandscape), "relative");
  assert.equal(eDeclaration(eHeader, "inset", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "min-block-size", eLandscape), "var(--forma-hit-target)");
  assert.equal(eDeclaration(eHeader, "overflow", eLandscape), "visible");
  assert.equal(eDeclaration(eHeader, "pointer-events", eLandscape), "auto");
  const legacyFocusedHeader = '.canvas-artifact-viewer[data-output-focus="true"][data-artifact-kind="slides"] > .canvas-artifact-viewer-card > header';
  assert.equal(eDeclaration(legacyFocusedHeader, "z-index", eLandscape), "6",
    "retain evidence of the legacy overlay declaration that the current in-flow rule must supersede");
  const reader = '.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > .canvas-artifact-viewer-card';
  assert.equal(eDeclaration(reader, "grid-template-rows", eLandscape), "auto minmax(0, 1fr) auto");
  assert.match(canvasCss, /\.canvas-artifact-viewer-card\{[^}]*overflow:hidden;/u);
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");

  const close = reader + " > .modal-close";
  assert.equal(eDeclaration(close, "z-index"), undefined, "no all-viewport or other-format Close policy");
  assert.equal(eDeclaration(close, "z-index", eLandscape), "2",
    "the actual direct Close peer must share the existing native Focus priority in both viewer states");
  assert.equal(eDeclaration(eHeader, "z-index"), undefined, "no global header stacking replacement");
  assert.equal(eDeclaration(eHeader, "z-index", eLandscape), "auto",
    "the existing three-owner in-flow header must not retain its former focused overlay level");
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(close)) rules.push(rule); });
  assert.equal(rules.length, 1, "one actual Slides Canvas direct Close peer rule");
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["z-index", "2"]], "no control dimensions, offsets, focus paint, labels, handlers or action ownership change");
});

test("E5 source policy: Document Slides chrome uses its actual parent height and background corners", () => {
  // Source policy only: the retained More observation is rounded-clip
  // UNASSESSED, not proof of clipped pixels. Its parent/child height mismatch
  // and the actual independent content/reader clip owners motivate this rule.
  const begin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const end = artifacts.indexOf("  override render(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = artifacts.slice(begin, end);
  assert.ok(viewer.includes('<dialog class="document-artifact-view"'));
  assert.ok(viewer.includes('data-output-focus='));
  assert.ok(viewer.includes('data-artifact-kind='));
  assert.ok(viewer.includes('<article class="document-artifact-reader">'));
  assert.ok(viewer.includes('<header class="artifact-viewer-header">'));
  assert.ok(viewer.includes('<footer data-actions-open='));
  assert.ok(viewer.includes('class="artifact-viewer-actions-popover"'));
  assert.ok(viewer.includes('class="artifact-review-guidance"'));
  assert.ok(viewer.includes('class="artifact-revision-history"'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.ok(viewer.includes("this.#cancelViewer"));
  assert.equal(declaration("*", "box-sizing"), "border-box");
  assert.equal(declaration(".document-artifact-view", "border"), "1px solid var(--line-strong)");
  assert.equal(declaration(".document-artifact-view", "border-radius"), "14px");
  assert.equal(declaration(".document-artifact-view .document-artifact-reader", "height"),
    "calc(100dvb - (var(--artifact-viewer-edge,1rem) * 2))");
  assert.equal(declaration(".document-artifact-view[data-output-focus=\"true\"]", "block-size"), "100dvb");
  assert.equal(declaration(".document-artifact-view[data-output-focus=\"true\"]", "border"), "0");
  assert.equal(declaration(".document-artifact-view[data-output-focus=\"true\"]", "border-radius"), "0");
  const content = '.document-artifact-view[data-artifact-kind="slides"] .document-artifact-reader-content';
  assert.equal(eDeclaration(content, "overflow"), "hidden");
  assert.equal(eDeclaration(content, "min-block-size"), "0");
  assert.equal(eDeclaration(content, "scrollbar-gutter"), "auto");
  assert.equal(declaration(".presentation-deck-viewport", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-frame", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-viewport > .presentation-deck-frame", "inline-size"),
    "min(100cqi,calc(100cqb * 1.7778),96rem)");
  const review = '.document-artifact-view[data-artifact-kind="slides"]:not([data-output-focus="true"]) > .document-artifact-reader:has(> .artifact-review-actions:not([hidden]),> .artifact-review-guidance,> .artifact-revision-history:not([hidden]))';
  assert.equal(eDeclaration(review, "overflow-y"), "auto");
  assert.equal(eDeclaration(review, "overscroll-behavior"), "contain");
  const editor = '.document-artifact-view[data-artifact-kind="slides"] .document-artifact-reader-content:has(> .artifact-direct-editor)';
  assert.equal(eDeclaration(editor, "overflow-y"), "auto");
  assert.equal(eDeclaration(editor, "overscroll-behavior"), "contain");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");
  assert.equal(eDeclaration(eCard, "row-gap", eLandscape), "var(--forma-focus-clearance)");
  assert.equal(eDeclaration(eHeader, "position", eLandscape), "relative");
  assert.equal(eDeclaration(eHeader, "z-index", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader + " > .button", "min-block-size", eLandscape), "var(--forma-hit-target)");

  const dialog = 'dialog.document-artifact-view[data-artifact-kind="slides"][data-output-focus]';
  const normalDialog = 'dialog.document-artifact-view[data-artifact-kind="slides"][data-output-focus="false"]';
  const card = dialog + " > article.document-artifact-reader";
  const reviewCard = 'dialog.document-artifact-view[data-artifact-kind="slides"]:not([data-output-focus="true"]) > article.document-artifact-reader:has(> .artifact-review-actions:not([hidden]),> .artifact-review-guidance,> .artifact-revision-history:not([hidden]))';
  const policies = [
    [normalDialog, [["block-size", "calc(100dvb - (var(--artifact-viewer-edge,1rem) * 2))"]]],
    [dialog, [["overflow", "visible"]]],
    [card, [["block-size", "100%"], ["max-block-size", "100%"], ["overflow", "visible"], ["border-radius", "inherit"]]],
    [reviewCard, [["overflow-x", "hidden"], ["overflow-y", "auto"]]],
    [card + " > .artifact-viewer-header", [["border-start-start-radius", "inherit"], ["border-start-end-radius", "inherit"]]],
    [card + " > footer", [["border-end-start-radius", "inherit"], ["border-end-end-radius", "inherit"]]],
  ];
  for (const [selector, expected] of policies) {
    assert.equal(eDeclaration(selector, expected[0][0]), undefined, "no other-format or all-viewport replacement");
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "the native frame owns size/background shape; content and exceptional review rows own scrolling");
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1, "one actual owned short-landscape policy");
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
      "no added padding, clip-margin, outline, control size, font, z-index, artboard or action changes");
  }
});

test("E5 source policy: Canvas Slides chrome paints outside its background corners while content keeps clipping", async () => {
  const [canvas, canvasCss, designCss] = await Promise.all([
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas.css", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
  ]);
  const begin = canvas.indexOf("  #artifactViewerDialog(){");
  const end = canvas.indexOf("  #outputViewerDialog(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = canvas.slice(begin, end);
  assert.ok(viewer.includes('<dialog class="modal canvas-artifact-viewer"'));
  assert.ok(viewer.includes('<article class="modal-card canvas-artifact-viewer-card">'));
  assert.ok(viewer.includes('data-output-focus='));
  assert.ok(viewer.includes('data-artifact-kind='));
  assert.ok(viewer.includes('<header><span class="canvas-dialog-step">'));
  assert.ok(viewer.includes('<footer data-actions-open='));
  assert.ok(viewer.includes('class="artifact-viewer-actions-popover"'));
  assert.ok(viewer.includes('const groupViewerActions=artifact.kind==="slides"&&(1+Number(!project)+Number(canEditCanvas))>1;'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.ok(viewer.includes('source-surface="canvas-artifact-viewer"'));
  assert.ok(viewer.includes("this.#closeCanvasArtifact()"));
  assert.match(canvasCss, /\.canvas-artifact-viewer-card\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto;[^}]*overflow:hidden;[^}]*padding:0\}/u);
  assert.match(canvasCss, /\.canvas-artifact-viewer-content\{[^}]*min-height:0;[^}]*overflow:auto;/u);
  assert.match(canvasCss, /:is\(\.canvas-artifact-viewer,\.canvas-output-viewer\)\[data-output-focus="true"\] > \.modal-card\s*\{[^}]*block-size:\s*100dvb;[^}]*border:\s*0;[^}]*border-radius:\s*0;/u);
  assert.match(designCss, /\.modal-card\s*\{[^}]*border-radius:\s*14px;/u);
  const content = '.canvas-artifact-viewer[data-artifact-kind="slides"] .canvas-artifact-viewer-content--slides';
  assert.equal(eDeclaration(content, "overflow"), "hidden");
  assert.equal(eDeclaration(content, "min-block-size"), "0");
  assert.equal(eDeclaration(content, "scrollbar-gutter"), "auto");
  assert.equal(declaration(".presentation-deck-viewport", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-frame", "overflow"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");
  const existingCard = '.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > .canvas-artifact-viewer-card';
  assert.equal(eDeclaration(existingCard, "grid-template-rows", eLandscape), "auto minmax(0, 1fr) auto");
  assert.equal(eDeclaration(existingCard + " > footer", "position", eLandscape), "static");
  assert.equal(eDeclaration(existingCard + " > footer", "padding", eLandscape), "var(--forma-focus-clearance)");
  assert.equal(eDeclaration(existingCard + " > .modal-close", "z-index", eLandscape), "2");
  assert.equal(eDeclaration(eCard, "row-gap", eLandscape), "var(--forma-focus-clearance)");
  assert.equal(eDeclaration(eHeader, "z-index", eLandscape), "auto");
  const sharedCard = ".modal.shared-presentation-dialog[data-output-focus] > .modal-card.shared-presentation-card";
  assert.equal(eDeclaration(sharedCard, "overflow", eLandscape), "visible");
  assert.equal(eDeclaration(sharedCard, "row-gap", eLandscape), "var(--forma-focus-clearance)");

  const card = 'dialog.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > article.modal-card.canvas-artifact-viewer-card';
  const policies = [
    [card, [["overflow", "visible"]]],
    [card + " > header", [["border-start-start-radius", "inherit"], ["border-start-end-radius", "inherit"]]],
    [card + " > footer", [["border-end-start-radius", "inherit"], ["border-end-end-radius", "inherit"]]],
  ];
  for (const [selector, expected] of policies) {
    assert.equal(eDeclaration(selector, expected[0][0]), undefined, "no image/other-format or all-viewport replacement");
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "ordinary chrome does not need the content's clipping boundary");
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1, "one current native Canvas Slides card policy");
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
      "no padding, height, outline, native ownership, scrollbar, artboard or content-scroll policy changes");
  }
});

test("E5 source policy: the native Shared Slideshow opener uses its own surface foreground", async () => {
  // Source binding only. Retained FR keyboard-return pixels expose the pale
  // caption; this is not a computed contrast ratio or all-theme paint proof.
  const [shared, designSource] = await Promise.all([
    readFile(new URL("../src/components/forma-shared-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
  ]);
  assert.ok(shared.includes('<section class="shared-output shared-artifact" data-forma-content="primary">'));
  assert.ok(shared.includes('<button type="button" class="button secondary compact shared-presentation-open" @click=${(event:MouseEvent)=>void this.#openPresentation(event,artifact)}>${this.#i18n.system("Slideshow")}</button>'));
  assert.ok(shared.includes("if(opener?.isConnected)opener.focus({preventScroll:true})"));
  assert.equal(declaration("button", "color"), "inherit");
  assert.equal(declaration(".button.secondary", "background"), "var(--panel)");
  assert.equal(declaration(":root", "--forma-color-surface"), "var(--panel)");
  assert.equal(declaration(":root", "--forma-color-text"), "var(--ink)");
  const design = postcss.parse(designSource, { from: "src/design-system.css" });
  const darkSurfaces = [];
  design.walkRules(rule => {
    if (rule.parent?.type !== "root" || !rule.selector.startsWith(":is(") || !rule.selector.endsWith(")")) return;
    if (!rule.selector.slice(4, -1).split(",").map(item => item.trim()).includes(".shared-output")) return;
    const values = {};
    rule.walkDecls(item => { values[item.prop] = item.value; });
    darkSurfaces.push(values);
  });
  assert.equal(darkSurfaces.length, 1, "the actual output card remains an intentional dark surface");
  assert.equal(darkSurfaces[0].color, "var(--fixed-dark-ink)");
  assert.equal(darkSurfaces[0].background, "var(--fixed-dark)");

  const opener = ".shared-output > .shared-presentation-open";
  assert.equal(eDeclaration(opener, "justify-self"), "start");
  assert.equal(eDeclaration(opener, "margin-inline"), "var(--forma-row-inset-inline)");
  assert.equal(eDeclaration(opener, "background"), undefined, "retain the native secondary button surface");
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(opener)) rules.push(rule); });
  assert.equal(rules.length, 1, "extend the existing direct native opener rule");
  assert.equal(rules[0].parent.type, "root", "rest and keyboard return do not depend on hover or a media condition");

  assert.equal(eDeclaration(opener, "color"), "var(--forma-color-text)",
    "the secondary surface must use its own foreground instead of inheriting the dark card's pale text");
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), [
    ["color", "var(--forma-color-text)"],
    ["justify-self", "start"], ["margin-inline", "var(--forma-row-inset-inline)"],
  ], "only foreground binding changes; native owner, caption, layout, focus paint and dark card stay intact");
});

test("E5 source policy: focused Canvas Slides peers retain logical native clearance and header space", async () => {
  // Conditional source correction: the latest native cases stopped at More,
  // before the focused branch. These declarations are not a browser verdict.
  const [canvas, canvasCss, designCss] = await Promise.all([
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas.css", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
  ]);
  const begin = canvas.indexOf("  #artifactViewerDialog(){");
  const end = canvas.indexOf("  #outputViewerDialog(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = canvas.slice(begin, end);
  assert.ok(viewer.includes('data-output-focus=${String(this.#viewerFocused)}'));
  assert.ok(viewer.includes('<article class="modal-card canvas-artifact-viewer-card"><button type="button" autofocus class="icon-button canvas-viewer-focus-toggle"'));
  assert.ok(viewer.includes('@click=${()=>this.#setViewerFocus(!this.#viewerFocused)}'));
  assert.ok(viewer.includes('class="icon-button modal-close" aria-label="Close document output" @click=${()=>this.#closeCanvasArtifact()}'));
  assert.ok(viewer.includes('<header><span class="canvas-dialog-step">'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.equal(declaration(".modal-card", "position"), "relative");
  assert.equal(declaration(".modal-close", "position"), "absolute");
  assert.equal(eDeclaration(":root", "--forma-hit-target"), "var(--forma-control-min-size, 2.75rem)");
  assert.equal(eDeclaration(":root", "--forma-focus-clearance"), ".5rem");
  assert.match(canvasCss, /\.canvas-viewer-focus-toggle\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*2;[^}]*inset-inline-end:\s*calc\(1rem \+ var\(--forma-control-min-size,2\.75rem\) \+ 1rem\);/u);
  assert.match(canvasCss, /:is\(\.canvas-artifact-viewer,\.canvas-output-viewer\)\[data-output-focus="true"\] > \.modal-card\s*\{[^}]*inline-size:\s*100dvi;[^}]*block-size:\s*100dvb;[^}]*border:\s*0;[^}]*border-radius:\s*0;/u);
  assert.match(canvasCss, /:is\(\.canvas-artifact-viewer,\.canvas-output-viewer\)\[data-output-focus="true"\] :is\(\.canvas-viewer-focus-toggle,\.modal-close\)\s*\{[^}]*inset-block-start:\s*max\(\.5rem,env\(safe-area-inset-top,0px\)\);/u);
  assert.match(designCss, /dialog\.modal\[data-output-focus="true"\]\s*\{[^}]*padding:\s*0;/u);
  const legacy = '.canvas-artifact-viewer[data-output-focus="true"][data-artifact-kind="slides"]';
  assert.equal(eDeclaration(legacy + " .canvas-viewer-focus-toggle", "inset-block-start", eLandscape),
    "calc(var(--forma-hit-target) + .25rem)");
  assert.equal(eDeclaration(legacy + " .canvas-viewer-focus-toggle", "inset-inline-end", eLandscape), ".25rem");
  assert.equal(eDeclaration(legacy + " .modal-close", "inset-inline-end", eLandscape), ".25rem");
  assert.equal(eDeclaration(legacy + " > .canvas-artifact-viewer-card > header", "padding-inline", eLandscape), ".25rem");
  assert.equal(eDeclaration(eHeader, "position", eLandscape), "relative");
  assert.equal(eDeclaration(eHeader, "z-index", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "display", eLandscape), "flex");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "flex-wrap", eLandscape), "wrap");
  assert.equal(eDeclaration(eHeader, "overflow", eLandscape), "visible");
  const currentCard = '.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > .canvas-artifact-viewer-card';
  assert.equal(eDeclaration(currentCard + " > .modal-close", "z-index", eLandscape), "2");
  const ownedCard = 'dialog.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > article.modal-card.canvas-artifact-viewer-card';
  assert.equal(eDeclaration(ownedCard, "overflow", eLandscape), "visible");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");

  const card = 'dialog.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus="true"] > article.modal-card.canvas-artifact-viewer-card';
  const policies = [
    [card + " > :is(button.canvas-viewer-focus-toggle, button.modal-close)", [
      ["inset-block-start", "calc(env(safe-area-inset-top, 0px) + var(--forma-focus-clearance))"],
      ["inset-inline-end", "calc(var(--forma-safe-inline-end, 0px) + var(--forma-focus-clearance))"],
    ]],
    [card + " > button.canvas-viewer-focus-toggle", [
      ["inset-inline-end", "calc(var(--forma-safe-inline-end, 0px) + var(--forma-hit-target) + (var(--forma-focus-clearance) * 2))"],
    ]],
    [card + " > header", [
      ["min-block-size", "calc(var(--forma-hit-target) + (var(--forma-focus-clearance) * 2))"],
      ["padding-inline-start", "var(--forma-focus-clearance)"],
      ["padding-inline-end", "calc((var(--forma-hit-target) * 2) + (var(--forma-focus-clearance) * 3))"],
    ]],
  ];
  for (const [selector, expected] of policies) {
    assert.equal(eDeclaration(selector, expected[0][0]), undefined, "no all-viewport or normal-view replacement");
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "focused native peers need real logical edge/gap clearance and reserved natural-flow header space");
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1, "one exact focused Canvas Slides policy");
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
      "only peer offsets/header reservation change; no control size ceiling, clipping, ring, color, z-index, content or action change");
  }
});

test("E5 source policy: normal Canvas Slides header reserves its absolute native peer height", async () => {
  // The retained EN normal-mode observation has a 44px in-flow header but
  // 44px native peers starting 16px below its top. The next row reaches the
  // focus ring. This source case does not substitute for the actual replay.
  const [canvas, canvasCss, designCss] = await Promise.all([
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas.css", import.meta.url), "utf8"),
    readFile(new URL("../src/design-system.css", import.meta.url), "utf8"),
  ]);
  const begin = canvas.indexOf("  #artifactViewerDialog(){");
  const end = canvas.indexOf("  #outputViewerDialog(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = canvas.slice(begin, end);
  assert.ok(viewer.includes('data-output-focus=${String(this.#viewerFocused)}'));
  assert.ok(viewer.includes('<article class="modal-card canvas-artifact-viewer-card"><button type="button" autofocus class="icon-button canvas-viewer-focus-toggle"'));
  assert.ok(viewer.includes('class="icon-button modal-close" aria-label="Close document output" @click=${()=>this.#closeCanvasArtifact()}'));
  assert.ok(viewer.includes('<header><span class="canvas-dialog-step">'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.equal(declaration(".modal-card", "position"), "relative");
  assert.equal(declaration(".modal-close", "position"), "absolute");
  assert.match(canvasCss, /\.canvas-viewer-focus-toggle\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*2;[^}]*inset-block-start:\s*1rem;[^}]*min-block-size:\s*var\(--forma-control-min-size,2\.75rem\);/u);
  assert.match(designCss, /\.modal-close\s*\{\s*top:\s*1rem;\s*right:\s*1rem;\s*\}/u);
  assert.equal(eDeclaration(":root", "--forma-hit-target"), "var(--forma-control-min-size, 2.75rem)");
  assert.equal(eDeclaration(":root", "--forma-focus-clearance"), ".5rem");
  assert.equal(eDeclaration(eHeader, "position", eLandscape), "relative");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "min-block-size", eLandscape), "var(--forma-hit-target)");
  assert.equal(eDeclaration(eHeader, "display", eLandscape), "flex");
  assert.equal(eDeclaration(eHeader, "flex-wrap", eLandscape), "wrap");
  assert.equal(eDeclaration(eHeader, "overflow", eLandscape), "visible");
  assert.equal(eDeclaration(eCard, "row-gap", eLandscape), "var(--forma-focus-clearance)");
  const card = 'dialog.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > article.modal-card.canvas-artifact-viewer-card';
  assert.equal(eDeclaration(card, "overflow", eLandscape), "visible");
  const toolbar = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  assert.equal(eDeclaration(toolbar, "position", eLandscape), "relative");
  assert.equal(eDeclaration(toolbar, "inset", eLandscape), "auto");
  const focusedHeader = 'dialog.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus="true"] > article.modal-card.canvas-artifact-viewer-card > header';
  const minimum = "calc(var(--forma-hit-target) + (var(--forma-focus-clearance) * 2))";
  assert.equal(eDeclaration(focusedHeader, "min-block-size", eLandscape), minimum,
    "reuse the independently retained focused peer-height policy without changing that state");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");

  const normalHeader = 'dialog.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus="false"] > article.modal-card.canvas-artifact-viewer-card > header';
  assert.equal(eDeclaration(normalHeader, "min-block-size"), undefined, "no all-viewport or other-viewer replacement");
  assert.equal(eDeclaration(normalHeader, "min-block-size", eLandscape), minimum,
    "the actual absolute peer height belongs to the in-flow header before the existing focus-clearance row gap");
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(normalHeader)) rules.push(rule); });
  assert.equal(rules.length, 1, "one exact normal Canvas Slides header policy");
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["min-block-size", minimum]],
    "no target offsets, text hiding, fixed height, z-index, backdrop filter, ring, gutter, scroll or action changes");
});

test("E5 source policy: open Slides tools keep standard native scroll gutters", async () => {
  // Actual Document 07a supplies the clipping evidence. Canvas reuses this
  // exact component/policy; its open-tools native branch is not yet reached.
  const [deck, canvas] = await Promise.all([
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
  ]);
  const begin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const end = artifacts.indexOf("  override render(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = artifacts.slice(begin, end);
  assert.ok(viewer.includes('<article class="document-artifact-reader">'));
  assert.match(viewer, /<forma-presentation-deck \.items=/u);
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.ok(canvas.includes('source-surface="canvas-artifact-viewer"'));
  assert.ok(deck.includes('<header class="presentation-deck-toolbar" data-tools-open='));
  assert.match(deck, /<button type="button" class="button ghost compact presentation-deck-tools-toggle"[^>]*aria-expanded=[^>]*aria-controls=[^>]*@click=/u);
  assert.ok(deck.includes("this.#compactToolsOpen=!this.#compactToolsOpen;this.requestUpdate();"));
  assert.ok(deck.includes('class="presentation-deck-jump presentation-deck-jump--compact"'));
  assert.ok(deck.includes('aria-label="Jump to slide"'));
  assert.ok(deck.includes('aria-label="Slide style"'));
  const current = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  const legacy = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  // Native Download R1 clipped the six-pixel Export ring at both block edges
  // of this ordinary-height scroll owner. Keep its existing inline/scroll policy.
  assert.equal(eDeclaration(legacy, "padding-block"), "var(--forma-focus-clearance)",
    "the scrolling Slides toolbar reserves the standard outer focus clearance at both block edges");
  assert.equal(eDeclaration(legacy, "padding-inline"), "clamp(.375rem, 1vi, .75rem)");
  assert.equal(eDeclaration(legacy, "overflow-x"), "auto");
  assert.equal(eDeclaration(current, "position", eLandscape), "relative");
  assert.equal(eDeclaration(current, "inset", eLandscape), "auto");
  assert.equal(eDeclaration(legacy, "padding", eLandscape), ".125rem");
  assert.equal(eDeclaration(legacy, "border", eLandscape), "1px solid var(--forma-color-border)");
  assert.equal(eDeclaration(legacy, "border-radius", eLandscape), ".5rem");
  assert.match(eResponsiveSource, /\.presentation-deck-toolbar\[data-tools-open="true"\]\s*\{\s*max-block-size:\s*min\(45dvb,18rem\);\s*overflow-x:\s*hidden;\s*overflow-y:\s*auto;/u);
  assert.match(eResponsiveSource, /\.presentation-deck-toolbar\[data-tools-open="true"\] > div\s*\{\s*display:\s*flex;[^}]*flex:\s*1 1 100%;[^}]*flex-wrap:\s*wrap;/u);
  for (const property of ["min-inline-size", "min-block-size"]) {
    assert.equal(eDeclaration(legacy + " > .presentation-deck-tools-toggle", property, eLandscape), "var(--forma-hit-target)");
    assert.equal(eDeclaration(".presentation-deck-tools-toggle", property, "(pointer: coarse)"), "var(--forma-hit-target-coarse)");
  }
  assert.equal(eDeclaration(":root", "--forma-focus-clearance"), ".5rem");
  assert.equal(eDeclaration(":root", "--forma-row-inset-inline"), "max(.75rem, var(--forma-space-3, .75rem))");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  for (const owner of [".document-artifact-view", ".canvas-artifact-viewer"]) {
    const closed = owner + '[data-artifact-kind="slides"] .presentation-deck-toolbar[data-tools-open="false"]';
    assert.equal(eDeclaration(closed, "inline-size", eLandscape), "max-content");
    assert.equal(eDeclaration(closed, "padding", eLandscape), "var(--forma-focus-clearance)");
  }

  const selector = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar[data-tools-open="true"]';
  const expected = [
    ["padding-block", "var(--forma-focus-clearance)"],
    ["padding-inline", "var(--forma-row-inset-inline)"],
  ];
  assert.equal(eDeclaration(selector, "padding-block"), undefined, "no ordinary-height or closed-tools replacement");
  for (const [property, value] of expected)
    assert.equal(eDeclaration(selector, property, eLandscape), value,
      "the existing native scroll owner needs standard logical gutters around its unchanged controls");
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
  assert.equal(rules.length, 1, "one shared actual-modal open-tools gutter policy");
  assert.deepEqual(rules[0].selectors, [selector]);
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
    "no clipping, corner, outline, control sizing, wrapping, scrolling, z-index, export or action changes");
});

test("E5 source policy: open Slides tools yield track space to the native navigation row", async () => {
  // This checks the source allocation, not a simulated grid or pixel pass.
  // The retained Document open-tools stage is only 35.18px for 44px peers.
  // Its 68px successor restored that row but left the actual reader at zero.
  // The explicit successor gives Tools and a full-height stage sequential space.
  const deck = await readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8");
  assert.ok(deck.includes('<header class="presentation-deck-toolbar" data-tools-open='));
  assert.ok(deck.includes('class="presentation-deck-stage" data-slide-posture='));
  assert.ok(deck.includes('tabindex="-1" @pointerdown='));
  assert.ok(deck.includes('this.querySelector<HTMLElement>(".presentation-deck-stage")?.focus()'),
    "the existing List-to-Present action really focuses this same stage; it is not only a passive artwork box");
  assert.ok(deck.includes('<nav aria-label="Slideshow controls"><button type="button"'));
  assert.ok(deck.includes('class="button secondary compact presentation-deck-reading-toggle"'));
  assert.ok(deck.includes('class="presentation-deck-reading" tabindex="0"'));
  assert.ok(deck.includes('this.#exportProgress?" presentation-deck--export-status":""'));
  assert.ok(deck.includes("this.#renderExportProgress()"));
  const current = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  const stage = current + " .presentation-deck--slideshow .presentation-deck-stage[data-slide-posture]";
  assert.equal(eDeclaration(current + " .presentation-deck--slideshow", "grid-template-rows", eLandscape), "auto minmax(0,1fr)");
  assert.equal(eDeclaration(stage, "grid-template-rows"), "minmax(0,1fr) auto");
  assert.equal(eDeclaration(stage, "min-block-size"), "0");
  assert.equal(eDeclaration(stage, "block-size"), "100%");
  assert.equal(eDeclaration(stage, "overflow"), "hidden");
  assert.equal(eDeclaration(stage, "gap"), ".4rem .5rem");
  assert.equal(eDeclaration(stage, "padding"), ".4rem clamp(.25rem,.8vi,.625rem)");
  assert.equal(eDeclaration(stage, "padding-inline-end", eLandscape), "calc(var(--forma-hit-target,2.75rem) + .875rem)");
  for (const property of ["min-inline-size", "min-block-size"])
    assert.equal(eDeclaration(current + " .presentation-deck-stage[data-slide-posture] > nav > button", property), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(".presentation-deck-reading-toggle", "min-block-size"), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(".presentation-deck-reading-toggle", "white-space"), "nowrap");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");
  assert.match(source, /forma-presentation-slide > \.presentation-slide\[data-presentation-artboard\]\s*\{[^}]*width:\s*960px;[^}]*height:\s*540px;/u);
  assert.match(source, /scale:\s*min\(calc\(100cqi \/ 960px\),calc\(100cqb \/ 540px\)\);/u);
  assert.match(eResponsiveSource, /\.presentation-deck-toolbar\[data-tools-open="true"\]\s*\{\s*max-block-size:\s*min\(45dvb,18rem\);\s*overflow-x:\s*hidden;\s*overflow-y:\s*auto;/u);

  const open = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck--slideshow:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="true"])';
  const policies = [
    [open, [
      ["grid-template-rows", "max-content 100%"],
      ["overflow-x", "hidden"],
      ["overflow-y", "auto"],
      ["overscroll-behavior", "contain"],
      ["scroll-padding-block", "var(--forma-focus-clearance)"],
    ]],
    [open + " > .presentation-deck-stage[data-slide-posture]", [
      ["block-size", "auto"],
      ["margin", "var(--forma-focus-clearance)"],
      ["padding-block", "var(--forma-focus-clearance)"],
      ["padding-inline", "var(--forma-focus-clearance)"],
      ["row-gap", "var(--forma-focus-clearance)"],
    ]],
  ];
  for (const [selector, expected] of policies) {
    assert.equal(eDeclaration(selector, expected[0][0]), undefined,
      "no all-viewport, closed-tools, List or export-status grid replacement");
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "native scrolling gives Tools their natural height and keeps a full existing-deck-height stage, not an arbitrary reader or artboard minimum");
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1, "one current owned open-tools track/stage policy");
    assert.deepEqual(rules[0].selectors, [selector]);
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
      "no hidden controls, row reordering, reader-clipping removal, artboard magnification or native action changes");
  }
});

test("E5 source policy: closed Slides tools do not clip their sole native trigger", async () => {
  // Actual EN Canvas 07a has no toolbar scroll range; only the conservative
  // rounded client proof is unresolved. This is not a claim of cut pixels.
  const [deck, canvas] = await Promise.all([
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
  ]);
  const begin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const end = artifacts.indexOf("  override render(){", begin);
  assert.ok(begin >= 0 && end > begin);
  assert.match(artifacts.slice(begin, end), /<forma-presentation-deck \.items=/u);
  assert.ok(canvas.includes('source-surface="canvas-artifact-viewer"'));
  assert.ok(deck.includes('<header class="presentation-deck-toolbar" data-tools-open='));
  assert.match(deck, /<button type="button" class="button ghost compact presentation-deck-tools-toggle"[^>]*aria-expanded=[^>]*aria-controls=[^>]*@click=/u);
  assert.ok(deck.includes("this.#compactToolsOpen=!this.#compactToolsOpen;this.requestUpdate();"));

  const legacy = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  const flow = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  assert.equal(eDeclaration(legacy, "overflow-x"), "auto", "the legacy toolbar supplies the unnecessary closed scroll container");
  assert.equal(eDeclaration(flow, "position", eLandscape), "relative");
  assert.equal(eDeclaration(flow, "inset", eLandscape), "auto");
  assert.equal(eDeclaration(legacy, "border-radius", eLandscape), ".5rem");
  assert.equal(eDeclaration(legacy, "border", eLandscape), "1px solid var(--forma-color-border)");
  assert.equal(eDeclaration(legacy + '[data-tools-open="false"] > div', "display", eLandscape), "none",
    "closed controls groups are absent from layout; the native trigger is the only remaining toolbar peer");
  for (const owner of [".document-artifact-view", ".canvas-artifact-viewer"]) {
    const closed = owner + '[data-artifact-kind="slides"] .presentation-deck-toolbar[data-tools-open="false"]';
    assert.equal(eDeclaration(closed, "inline-size", eLandscape), "max-content");
    assert.equal(eDeclaration(closed, "justify-self", eLandscape), "end");
    assert.equal(eDeclaration(closed, "padding", eLandscape), "var(--forma-focus-clearance)");
  }
  for (const property of ["min-inline-size", "min-block-size"]) {
    assert.equal(eDeclaration(legacy + " > .presentation-deck-tools-toggle", property, eLandscape), "var(--forma-hit-target)");
    assert.equal(eDeclaration(".presentation-deck-tools-toggle", property, "(pointer: coarse)"), "var(--forma-hit-target-coarse)");
  }
  assert.equal(eDeclaration(":root", "--forma-focus-clearance"), ".5rem");
  assert.match(eResponsiveSource, /@container presentation-deck-host \(max-width: 46rem\)\s*\{[\s\S]*?\.presentation-deck-toolbar\s*\{[^}]*overflow:\s*visible;/u);
  assert.match(eResponsiveSource, /\.presentation-deck-toolbar\[data-tools-open="true"\]\s*\{\s*max-block-size:\s*min\(45dvb,18rem\);\s*overflow-x:\s*hidden;\s*overflow-y:\s*auto;/u);
  assert.equal(declaration(".presentation-deck--slideshow", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-viewport", "overflow"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");

  const selector = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar[data-tools-open="false"]';
  assert.equal(eDeclaration(selector, "overflow"), undefined, "no ordinary-height toolbar replacement");
  assert.equal(eDeclaration(selector, "overflow", eLandscape), "visible",
    "the sole intrinsic closed trigger needs no scroll container; open-tools scrolling and inner content clipping remain owned");
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
  assert.equal(rules.length, 1, "one exact shared current-dialog closed-state clipping policy");
  assert.deepEqual(rules[0].selectors, [selector]);
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), [["overflow", "visible"]],
    "no target, radius, ring, padding, z-index, backdrop, viewport, open-state, reader, source or action changes");
});

test("E5 source policy: open Slides tools reveal native controls through the existing deck scrollport", async () => {
  // Actual Document Jump and Canvas Style retain their native owners but
  // clip at the capped toolbar. This is source policy, not a browser replay.
  const [deck, canvas] = await Promise.all([
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
  ]);
  const begin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const end = artifacts.indexOf("  override render(){", begin);
  assert.ok(begin >= 0 && end > begin);
  assert.match(artifacts.slice(begin, end), /<forma-presentation-deck \.items=/u);
  assert.ok(canvas.includes('source-surface="canvas-artifact-viewer"'));
  assert.ok(deck.includes('<header class="presentation-deck-toolbar" data-tools-open='));
  assert.ok(deck.includes("this.#compactToolsOpen=!this.#compactToolsOpen;this.requestUpdate();"));
  assert.ok(deck.includes('class="presentation-deck-jump presentation-deck-jump--compact"'));
  assert.ok(deck.includes('aria-label="Jump to slide"'));
  assert.ok(deck.includes('aria-label="Slide style"'));
  assert.ok(deck.includes('class="presentation-deck-export-menu" popover="auto"'));
  assert.ok(deck.includes('class="presentation-deck-stage" data-slide-posture='));
  assert.ok(deck.includes('class="presentation-deck-supporting"'));
  assert.ok(deck.includes('this.#exportProgress?" presentation-deck--export-status":""'));
  assert.ok(deck.includes("this.#renderExportProgress()"));
  assert.ok(deck.includes('if(target?.closest(".presentation-deck-reading")&&["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(event.key))return;'),
    "native reader scrolling remains distinct from outer-deck slide-navigation keys");
  const current = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  const legacy = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-toolbar';
  assert.equal(eDeclaration(current + " .presentation-deck-toolbar", "position", eLandscape), "relative");
  assert.equal(eDeclaration(current + " .presentation-deck-toolbar", "inset", eLandscape), "auto");
  assert.equal(eDeclaration(legacy, "border-radius", eLandscape), ".5rem");
  assert.equal(eDeclaration(legacy, "border", eLandscape), "1px solid var(--forma-color-border)");
  assert.match(eResponsiveSource, /\.presentation-deck-toolbar\[data-tools-open="true"\]\s*\{\s*max-block-size:\s*min\(45dvb,18rem\);\s*overflow-x:\s*hidden;\s*overflow-y:\s*auto;/u,
    "the ordinary/container policy remains available outside this short nonexport slideshow");
  assert.equal(declaration(".presentation-deck--slideshow", "height"), "100%");
  assert.equal(eDeclaration(':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck--slideshow', "block-size"), "100%");
  assert.equal(declaration(".presentation-deck-viewport", "overflow"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");
  assert.equal(eDeclaration(":root", "--forma-focus-clearance"), ".5rem");
  const modal = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  const open = modal + ' .presentation-deck--slideshow:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="true"])';
  const gutter = modal + ' .presentation-deck-toolbar[data-tools-open="true"]';
  assert.equal(eDeclaration(gutter, "padding-block", eLandscape), "var(--forma-focus-clearance)");
  assert.equal(eDeclaration(gutter, "padding-inline", eLandscape), "var(--forma-row-inset-inline)");
  for (const property of ["min-inline-size", "min-block-size"]) {
    assert.equal(eDeclaration(legacy + " > .presentation-deck-tools-toggle", property, eLandscape), "var(--forma-hit-target)");
    assert.equal(eDeclaration(".presentation-deck-tools-toggle", property, "(pointer: coarse)"), "var(--forma-hit-target-coarse)");
  }

  const policies = [
    [open + ' > .presentation-deck-toolbar[data-tools-open="true"]', [
      ["max-block-size", "none"],
      ["overflow", "visible"],
      ["flex-wrap", "wrap"],
    ]],
    [open + " > .presentation-deck-toolbar > div", [
      ["max-inline-size", "100%"],
      ["flex-wrap", "wrap"],
    ]],
  ];
  for (const [selector, expected] of policies) {
    assert.equal(eDeclaration(selector, expected[0][0]), undefined, "no all-height replacement");
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "the existing deck, not a capped rounded toolbar, owns native focus reveal");
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].selectors, [selector]);
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
      "keep native dimensions, logical gutters, actions, tool order, paint and artboard scaling");
  }
  for (const selector of [
    open + " > .presentation-deck-toolbar :is(button, select, input):not([popover] *)",
    open + " > .presentation-deck-stage[data-slide-posture] > :is(nav, .presentation-deck-supporting) > button",
  ]) {
    assert.equal(eDeclaration(selector, "scroll-margin-block"), undefined);
    assert.equal(eDeclaration(selector, "scroll-margin-block", eLandscape), "var(--forma-focus-clearance)",
      "native Tab reveal reserves the existing focus clearance; no programmatic scrolling or focus repair");
  }
});

test("E5 source policy: the actual reading viewport reserves native reader and summary focus paint", async () => {
  // Reading exists independently of the Tools state. The visual artboard
  // retains its own exact viewport/contain-fit rules and gets no padding.
  // The actual EN End reaches its native scroll limit while the ARTICLE
  // border box extends 0.546875px below the reader. Real end padding,
  // not scroll-padding or an oracle tolerance, gives that endpoint room.
  const deck = await readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8");
  assert.ok(deck.includes('class="presentation-deck-stage" data-slide-posture='));
  assert.ok(deck.includes('<div class="presentation-deck-viewport"'));
  assert.ok(deck.includes('if(standalone)return html'));
  assert.ok(deck.includes('class="presentation-deck-reading" tabindex="0"'));
  assert.ok(deck.includes('class="presentation-deck-reader-content" aria-label='));
  assert.ok(deck.includes('<details class="presentation-deck-evidence presentation-deck-reader"><summary>'));
  assert.ok(deck.includes('<details class="presentation-deck-notes"><summary>Speaker notes</summary>'));
  assert.ok(deck.includes('reading?".presentation-deck-reading":".presentation-deck-reading-toggle"'));
  assert.ok(deck.includes('if(target?.closest(".presentation-deck-reading")&&["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(event.key))return;'));
  assert.equal(declaration(".presentation-deck-viewport", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-viewport", "container"), "presentation-deck-viewport / size");
  assert.equal(eDeclaration(".presentation-deck-reading", "box-sizing"), "border-box");
  for (const property of ["inline-size", "block-size"])
    assert.equal(eDeclaration(".presentation-deck-reading", property), "100%");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-x"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");
  assert.equal(eDeclaration(".presentation-deck-reading > .presentation-deck-reader-content", "padding"), "clamp(.875rem,3cqi,2rem)");
  assert.equal(eDeclaration(".presentation-deck-reading > .presentation-deck-reader-content", "line-height"), "1.65");
  assert.match(source, /forma-presentation-slide > \.presentation-slide\[data-presentation-artboard\]\s*\{[^}]*width:\s*960px;[^}]*height:\s*540px;/u);
  assert.match(source, /scale:\s*min\(calc\(100cqi \/ 960px\),calc\(100cqb \/ 540px\)\);/u);
  assert.equal(eDeclaration(":root", "--forma-focus-clearance"), ".5rem");

  const viewport = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-stage[data-slide-posture="reading"] > .presentation-deck-viewport';
  const reading = viewport + " > .presentation-deck-reading";
  for (const [selector, expected] of [
    [viewport, [["box-sizing", "border-box"], ["padding", "var(--forma-focus-clearance)"]]],
    [reading, [["scroll-padding-block", "var(--forma-focus-clearance)"], ["scroll-margin-block", "var(--forma-focus-clearance)"], ["padding-block-end", "var(--forma-focus-clearance)"]]],
  ]) {
    assert.equal(eDeclaration(selector, expected[0][0]), undefined, "no ordinary-height or visual viewport replacement");
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "real reading content keeps its scroll owner with room for the native outward ring");
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].selectors, [selector]);
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
      "no text shortening, type/control changes, outline inset, clipping removal, key or source changes");
  }
  for (const selector of [reading, reading + " > .presentation-deck-reader-content > details > summary"]) {
    assert.equal(eDeclaration(selector, "scroll-margin-block"), undefined);
    assert.equal(eDeclaration(selector, "scroll-margin-block", eLandscape), "var(--forma-focus-clearance)",
      "the existing reader and its actual evidence/notes targets receive native scroll clearance");
  }
});

test("E5 source policy: compact Slides navigation keeps native focus paint and wrapping access", async () => {
  // Actual three Next observations have a 44px hidden/hidden nav, no X
  // scroll range, and a 56px ring. This is source policy, not pixel proof.
  const [deck, canvas] = await Promise.all([
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
  ]);
  const begin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const end = artifacts.indexOf("  override render(){", begin);
  assert.ok(begin >= 0 && end > begin);
  assert.match(artifacts.slice(begin, end), /<forma-presentation-deck \.items=/u);
  assert.ok(canvas.includes('source-surface="canvas-artifact-viewer"'));
  const navBegin = deck.indexOf('<nav aria-label="Slideshow controls">');
  const navEnd = deck.indexOf("</nav>", navBegin);
  assert.ok(navBegin >= 0 && navEnd > navBegin);
  const nativeNav = deck.slice(navBegin, navEnd);
  assert.equal([...nativeNav.matchAll(/<button\b/gu)].length, 2);
  assert.ok(nativeNav.includes('this.i18n.system("Previous")'));
  assert.ok(nativeNav.includes('this.i18n.system("Next")'));
  assert.ok(nativeNav.includes("this.#setIndex(index-1,total)"));
  assert.ok(nativeNav.includes("this.#setIndex(index+1,total)"));
  assert.ok(nativeNav.includes('class="presentation-deck-jump"'));
  assert.ok(nativeNav.includes('class="presentation-deck-position" aria-hidden="true"'));
  assert.ok(deck.includes('class="presentation-deck-supporting"'));
  assert.ok(deck.includes('class="button secondary compact presentation-deck-reading-toggle"'));
  assert.ok(deck.includes('this.#view==="slideshow"&&current'));
  const current = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  const nav = current + " .presentation-deck-stage[data-slide-posture] > nav";
  assert.equal(eDeclaration(nav, "position"), "static");
  assert.equal(eDeclaration(nav, "grid-column"), "1");
  assert.equal(eDeclaration(nav, "grid-row"), "2");
  assert.equal(eDeclaration(nav, "min-inline-size"), "0");
  assert.equal(eDeclaration(nav, "overflow"), "hidden",
    "the current posture rule, not the weaker legacy X-auto rule, supplies the redundant clip");
  assert.equal(eDeclaration(nav, "flex-wrap"), "nowrap");
  assert.equal(eDeclaration(".presentation-deck-stage[data-slide-posture] > nav > .presentation-deck-jump", "display", eLandscape), "none");
  assert.equal(eDeclaration(".presentation-deck-stage[data-slide-posture] .presentation-deck-navigation-label", "display", eLandscape), "none",
    "existing compact chrome retains native Previous/Next names and the static count");
  for (const property of ["min-inline-size", "min-block-size"])
    assert.equal(eDeclaration(nav + " > button", property), "var(--forma-control-min-size,2.75rem)");
  const count = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-stage[data-slide-posture] > nav > .presentation-deck-position';
  assert.equal(eDeclaration(count, "position", eLandscape), "static");
  assert.equal(eDeclaration(count, "min-inline-size", eLandscape), "3.25rem");
  const supporting = current + " .presentation-deck-stage[data-slide-posture] > .presentation-deck-supporting";
  assert.equal(eDeclaration(supporting, "position"), "static");
  assert.equal(eDeclaration(supporting, "display"), "flex");
  assert.equal(eDeclaration(supporting, "grid-column"), "2");
  assert.equal(eDeclaration(supporting, "overflow"), "visible",
    "the actual read-toggle sibling already owns visible overflow, so it needs no duplicate clipping fix");
  assert.equal(eDeclaration(".presentation-deck-reading-toggle", "min-block-size"), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(".presentation-deck-reading-toggle", "white-space"), "nowrap");
  assert.equal(eDeclaration(current + " .presentation-deck--slideshow .presentation-deck-stage[data-slide-posture]", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-viewport", "overflow"), "hidden");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");
  // The measured portrait return toggle had only 4px to its stage clip for a
  // 6px outward ring. Keep that clipped owner and give both native peers room.
  const portraitStage = 'dialog.document-artifact-view[data-artifact-kind="slides"][data-output-focus="false"] .presentation-deck--slideshow > .presentation-deck-stage[data-slide-posture]';
  assert.equal(eDeclaration(portraitStage, "padding-inline", "(max-width: 720px) and (orientation: portrait)"), "var(--forma-focus-clearance)");
  assert.equal(eDeclaration(portraitStage, "padding-inline"), undefined,
    "the normal portrait correction does not replace desktop or focused-stage sizing");
  assert.equal(eDeclaration(":root", "--forma-focus-clearance"), ".5rem");
  assert.ok(deck.includes('!reading&&this.#visualOverflow?html`<p class="presentation-slide-fit-warning" role="status">'),
    "returning to visual mode can add the real complete-content warning beside the same reading toggle");
  const portrait = "(max-width: 720px) and (orientation: portrait)";
  assert.equal(eDeclaration(portraitStage, "grid-template-columns", portrait), "minmax(0,1fr)",
    "the supporting warning cannot consume a competing auto-width column and collapse navigation");
  assert.equal(eDeclaration(portraitStage, "grid-template-rows", portrait), "minmax(0,1fr) auto auto");
  const portraitSupporting = portraitStage + " > .presentation-deck-supporting";
  for (const [property, value] of [["grid-column", "1"], ["grid-row", "3"], ["display", "grid"],
    ["grid-template-columns", "minmax(0,1fr) auto"], ["justify-self", "stretch"],
    ["align-items", "center"], ["gap", "var(--forma-focus-clearance)"]])
    assert.equal(eDeclaration(portraitSupporting, property, portrait), value,
      "supporting copy and the existing native toggle share their own bounded row");
  assert.equal(eDeclaration(portraitSupporting + " > .presentation-deck-reading-toggle", "grid-column", portrait), "2",
    "the same intrinsic toggle keeps its own track with or without the warning");
  assert.equal(eDeclaration(portraitSupporting + " > .presentation-slide-fit-warning", "min-inline-size", portrait), "0",
    "the full warning wraps within its track instead of overflowing onto sibling navigation");
  assert.equal(eDeclaration(portraitSupporting + " > .presentation-slide-fit-warning", "overflow-wrap", portrait), "anywhere");
  const coarseControls = portraitStage + " > :is(nav, .presentation-deck-supporting) > button";
  for (const property of ["min-inline-size", "min-block-size"])
    assert.equal(eDeclaration(coarseControls, property, "(pointer: coarse)"), "var(--forma-hit-target-coarse)",
      "both navigation and the reading toggle honor the existing 48px coarse floor");
  assert.equal(eDeclaration(":root", "--forma-hit-target-coarse"), "3rem");
  assert.equal(eDeclaration(coarseControls, "min-block-size"), undefined,
    "fine pointers retain the existing 44px minimum");
  const open = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck--slideshow:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="true"])';
  assert.equal(eDeclaration(open, "overflow-y", eLandscape), "auto");
  assert.equal(eDeclaration(open + " > .presentation-deck-stage[data-slide-posture]", "margin", eLandscape), "var(--forma-focus-clearance)");
  assert.equal(eDeclaration(open + " > .presentation-deck-stage[data-slide-posture]", "padding-block", eLandscape), "var(--forma-focus-clearance)");

  const selector = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"] .presentation-deck-stage[data-slide-posture] > nav';
  const expected = [["overflow", "visible"], ["flex-wrap", "wrap"]];
  assert.equal(eDeclaration(selector, "overflow"), undefined, "no ordinary-height navigation replacement");
  for (const [property, value] of expected)
    assert.equal(eDeclaration(selector, property, eLandscape), value,
      "the same native peers can paint into existing stage gutters and wrap rather than escape their available column");
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
  assert.equal(rules.length, 1, "one actual two-owner compact navigation policy");
  assert.deepEqual(rules[0].selectors, [selector]);
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
    "no new padding, type/control sizing, label hiding, ordering, ring, reader allocation, artboard or native action changes");
});

test("E5 source policy: open Slides List retains native reading and Present focus room", async () => {
  // The actual FR List clients were 56.5px and 48px high for a 56px ring.
  // Reuse the current sequential deck owner, not a nominal control-row floor.
  const [deck, canvas] = await Promise.all([
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
  ]);
  const viewerBegin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const viewerEnd = artifacts.indexOf("  override render(){", viewerBegin);
  assert.ok(viewerBegin >= 0 && viewerEnd > viewerBegin);
  assert.match(artifacts.slice(viewerBegin, viewerEnd), /<forma-presentation-deck \.items=/u);
  assert.ok(canvas.includes('source-surface="canvas-artifact-viewer"'));
  const listBegin = deck.indexOf('this.#view==="list"?html`<ol class="presentation-deck-list">');
  const listEnd = deck.indexOf(':html`<div class="presentation-deck-stage"', listBegin);
  assert.ok(listBegin >= 0 && listEnd > listBegin);
  const listBody = deck.slice(listBegin, listEnd);
  assert.ok(listBody.includes('class="presentation-deck-list-header"'));
  assert.ok(listBody.includes('<button type="button" class="button secondary compact"'));
  assert.ok(listBody.includes('this.#setIndex(itemIndex,total);this.#setView("slideshow");'));
  assert.ok(listBody.includes('this.querySelector<HTMLElement>(".presentation-deck-stage")?.focus()'));
  assert.ok(listBody.includes('Present slide ${itemIndex+1}'));
  assert.ok(listBody.includes('<details class="presentation-deck-notes"><summary>'));
  assert.ok(listBody.includes('${this.#reader(item,itemIndex)}'));
  assert.ok(deck.includes('if(this.#view!=="slideshow"||!total||event.defaultPrevented'),
    "List keeps its existing native key semantics; no new scroll controller is introduced");
  const viewBegin = deck.indexOf("  #setView(view:DeckView){");
  const viewEnd = deck.indexOf("  #setIndex(", viewBegin);
  assert.ok(viewBegin >= 0 && viewEnd > viewBegin);
  assert.ok(!deck.slice(viewBegin, viewEnd).includes("#compactToolsOpen"),
    "real List-to-Present keeps the current Tools disclosure rather than synthesizing a smaller posture");
  assert.ok(deck.includes('this.#exportProgress?" presentation-deck--export-status":""'));
  assert.ok(deck.includes("this.#renderExportProgress()"));

  const current = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  const baseList = current + " .presentation-deck--list";
  assert.equal(eDeclaration(baseList, "display"), "grid");
  assert.equal(eDeclaration(baseList, "block-size"), "100%");
  assert.equal(eDeclaration(baseList, "min-block-size"), "0");
  assert.equal(eDeclaration(baseList, "grid-template-rows"), "auto minmax(0,1fr)");
  assert.equal(eDeclaration(baseList, "overflow"), "hidden");
  const baseBody = baseList + " > .presentation-deck-list";
  assert.equal(eDeclaration(baseBody, "box-sizing"), "border-box");
  assert.equal(eDeclaration(baseBody, "min-block-size"), "0");
  assert.equal(eDeclaration(baseBody, "overflow-x"), "hidden");
  assert.equal(eDeclaration(baseBody, "overflow-y"), "auto");
  assert.equal(eDeclaration(baseBody, "overscroll-behavior"), "contain");
  assert.equal(declaration(".presentation-deck-list", "display"), "grid");
  assert.equal(declaration(".presentation-deck-list", "width"), "min(100%,64rem)");
  assert.equal(declaration(".presentation-deck-list", "margin"), "0 auto");
  assert.equal(declaration(".presentation-deck-list", "padding"), "clamp(1.5rem,4vw,3rem) var(--page-gutter)");
  assert.equal(declaration(".presentation-deck-list-header", "flex-wrap"), "wrap");
  assert.equal(declaration(".presentation-deck-list-header > button", "min-height"), "var(--forma-control-min-size,2.75rem)");
  assert.equal(declaration(".presentation-deck-list summary", "min-block-size"), "var(--forma-control-min-size,2.75rem)");
  assert.equal(declaration(".presentation-deck-frame", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-frame", "aspect-ratio"), "16/9");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  const owners = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  const slideshow = owners + ' .presentation-deck--slideshow:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="true"])';
  const list = owners + ' .presentation-deck--list:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="true"])';
  const grid = [
    ["grid-template-rows", "max-content 100%"],
    ["overflow-x", "hidden"], ["overflow-y", "auto"],
    ["overscroll-behavior", "contain"], ["scroll-padding-block", "var(--forma-focus-clearance)"],
  ];
  const toolbar = [["max-block-size", "none"], ["overflow", "visible"], ["flex-wrap", "wrap"]];
  const groups = [["max-inline-size", "100%"], ["flex-wrap", "wrap"]];
  const toolbarTargets = " > .presentation-deck-toolbar :is(button, select, input):not([popover] *)";
  assert.equal(eDeclaration(slideshow + toolbarTargets, "scroll-margin-block", eLandscape), "var(--forma-focus-clearance)",
    "List retains the existing native Tools reveal policy when the same deck changes view");
  for (const [selector, expected] of [
    [slideshow, grid],
    [slideshow + ' > .presentation-deck-toolbar[data-tools-open="true"]', toolbar],
    [slideshow + " > .presentation-deck-toolbar > div", groups],
  ]) for (const [property, value] of expected)
    assert.equal(eDeclaration(selector, property, eLandscape), value,
      "the current slideshow already supplies this same definite-height sequential fit mechanism");
  for (const [property, value] of [["padding-block", "var(--forma-focus-clearance)"], ["padding-inline", "var(--forma-row-inset-inline)"]])
    assert.equal(eDeclaration(owners + ' .presentation-deck-toolbar[data-tools-open="true"]', property, eLandscape), value);

  const policies = [
    [list, grid],
    [list + ' > .presentation-deck-toolbar[data-tools-open="true"]', toolbar],
    [list + " > .presentation-deck-toolbar > div", groups],
    [list + toolbarTargets, [["scroll-margin-block", "var(--forma-focus-clearance)"]]],
    [list + " > .presentation-deck-list", [["scroll-padding-block", "var(--forma-focus-clearance)"]]],
    [list + " > .presentation-deck-list :is(button, summary, a[href])", [["scroll-margin-block", "var(--forma-focus-clearance)"]]],
  ];
  for (const [selector, expected] of policies) {
    assert.equal(eDeclaration(selector, expected[0][0]), undefined,
      "no ordinary-height, closed Tools, slideshow or export-status replacement");
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "native List controls keep real scroll room and the existing focus-clearance token");
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1, "one bounded policy for each current List owner");
    assert.deepEqual(rules[0].selectors, [selector]);
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
      "no new wrapper, List padding, control/type sizing, target hiding, outline, artboard, source or action changes");
  }
});

test("E5 source policy: closed Slides Tools retain a complete native reading stage", async () => {
  // Actual closed FR readers became 23.7109375px and 8px high after the
  // 62px Tools row and wrapped navigation consumed the old flexible track.
  const [deck, canvas] = await Promise.all([
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
  ]);
  const viewerBegin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const viewerEnd = artifacts.indexOf("  override render(){", viewerBegin);
  assert.ok(viewerBegin >= 0 && viewerEnd > viewerBegin);
  assert.match(artifacts.slice(viewerBegin, viewerEnd), /<forma-presentation-deck \.items=/u);
  assert.ok(canvas.includes('source-surface="canvas-artifact-viewer"'));
  assert.ok(deck.includes('<header class="presentation-deck-toolbar" data-tools-open=${String(this.#compactToolsOpen)}>'));
  assert.ok(deck.includes('this.#compactToolsOpen=!this.#compactToolsOpen;this.requestUpdate();'));
  assert.ok(deck.includes('class="presentation-deck-stage" data-slide-posture='));
  assert.ok(deck.includes('tabindex="-1" @pointerdown='));
  assert.ok(deck.includes('this.querySelector<HTMLElement>(".presentation-deck-stage")?.focus()'));
  assert.ok(deck.includes('class="presentation-deck-reading" tabindex="0"'));
  assert.ok(deck.includes('reading?".presentation-deck-reading":".presentation-deck-reading-toggle")?.focus({preventScroll:true})'));
  assert.ok(deck.includes('if(target?.closest(".presentation-deck-reading")&&["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(event.key))return;'));
  assert.ok(deck.includes('this.#exportProgress?" presentation-deck--export-status":""'));
  assert.ok(deck.includes("this.#renderExportProgress()"));

  const current = ':is(.document-artifact-view,.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  const legacy = ':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"]';
  const baseStage = current + " .presentation-deck--slideshow .presentation-deck-stage[data-slide-posture]";
  assert.equal(eDeclaration(current + " .presentation-deck--slideshow", "grid-template-rows", eLandscape), "auto minmax(0,1fr)");
  assert.equal(eDeclaration(baseStage, "grid-template-rows"), "minmax(0,1fr) auto");
  assert.equal(eDeclaration(baseStage, "grid-template-columns"), "minmax(0,1fr) auto");
  assert.equal(eDeclaration(baseStage, "block-size"), "100%");
  assert.equal(eDeclaration(baseStage, "min-block-size"), "0");
  assert.equal(eDeclaration(baseStage, "overflow"), "hidden");
  assert.equal(eDeclaration(baseStage, "padding"), ".4rem clamp(.25rem,.8vi,.625rem)");
  assert.equal(eDeclaration(baseStage, "padding-inline-end", eLandscape), "calc(var(--forma-hit-target,2.75rem) + .875rem)",
    "the retained base reserve is a lower-priority prerequisite, not proof of effective closed-state fit");
  assert.equal(eDeclaration(current + " .presentation-deck-toolbar", "position", eLandscape), "relative");
  assert.equal(eDeclaration(legacy + ' .presentation-deck-toolbar[data-tools-open="false"] > div', "display", eLandscape), "none");
  for (const owner of [".document-artifact-view", ".canvas-artifact-viewer"]) {
    const toolbar = owner + '[data-artifact-kind="slides"] .presentation-deck-toolbar[data-tools-open="false"]';
    assert.equal(eDeclaration(toolbar, "inline-size", eLandscape), "max-content");
    assert.equal(eDeclaration(toolbar, "justify-self", eLandscape), "end");
    assert.equal(eDeclaration(toolbar, "padding", eLandscape), "var(--forma-focus-clearance)");
  }
  const owners = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  assert.equal(eDeclaration(owners + ' .presentation-deck-toolbar[data-tools-open="false"]', "overflow", eLandscape), "visible");
  assert.equal(eDeclaration(owners + " .presentation-deck-stage[data-slide-posture] > nav", "overflow", eLandscape), "visible");
  assert.equal(eDeclaration(owners + " .presentation-deck-stage[data-slide-posture] > nav", "flex-wrap", eLandscape), "wrap");
  for (const property of ["min-inline-size", "min-block-size"])
    assert.equal(eDeclaration(current + " .presentation-deck-stage[data-slide-posture] > nav > button", property), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(current + " .presentation-deck-stage[data-slide-posture] > .presentation-deck-supporting", "overflow"), "visible");
  assert.equal(eDeclaration(".presentation-deck-reading-toggle", "min-block-size"), "var(--forma-control-min-size,2.75rem)");
  assert.equal(eDeclaration(".presentation-deck-reading", "box-sizing"), "border-box");
  assert.equal(eDeclaration(".presentation-deck-reading", "block-size"), "100%");
  assert.equal(eDeclaration(".presentation-deck-reading", "min-block-size"), "0");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  // R8 mixed-direction bullets retained readable words while the Arabic
  // outside marker escaped the one-sided list gutter. Keep hanging list
  // semantics and reserve the same space on either marker side.
  assert.ok(deck.includes('<ul>${slide.bullets.map((bullet)=>html`<li dir="auto">${bullet}</li>`)}</ul>'));
  const audienceList = ".presentation-deck-reader-content > ul";
  const markerGutter = declaration(".presentation-deck-reader-content :is(ul,ol)", "padding-inline-start");
  assert.equal(markerGutter, "1.35rem");
  assert.equal(declaration(audienceList, "padding-inline-end"), markerGutter,
    "mixed LTR/RTL list items retain equal outside-marker gutters and hanging wrapped text");
  const audienceRules = matchingRules(audienceList);
  assert.equal(audienceRules.length, 1);
  assert.deepEqual(audienceRules[0].rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["padding-inline-end", markerGutter]],
    "only the direct audience list gains its missing gutter; list position, markers and typography stay native");
  const viewport = owners + ' .presentation-deck-stage[data-slide-posture="reading"] > .presentation-deck-viewport';
  assert.equal(eDeclaration(viewport, "padding", eLandscape), "var(--forma-focus-clearance)");
  assert.equal(eDeclaration(viewport + " > .presentation-deck-reading", "padding-block-end", eLandscape), "var(--forma-focus-clearance)");
  assert.equal(declaration(".presentation-deck-viewport", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-frame", "aspect-ratio"), "16/9");
  assert.match(source, /forma-presentation-slide > \.presentation-slide\[data-presentation-artboard\]\s*\{[^}]*width:\s*960px;[^}]*height:\s*540px;/u);

  const open = owners + ' .presentation-deck--slideshow:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="true"])';
  const closed = owners + ' .presentation-deck--slideshow:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="false"])';
  const stage = " > .presentation-deck-stage[data-slide-posture]";
  const grid = [["grid-template-rows", "max-content 100%"], ["overflow-x", "hidden"], ["overflow-y", "auto"],
    ["overscroll-behavior", "contain"], ["scroll-padding-block", "var(--forma-focus-clearance)"]];
  const stagePolicy = [["block-size", "auto"], ["margin", "var(--forma-focus-clearance)"],
    ["padding-block", "var(--forma-focus-clearance)"], ["padding-inline", "var(--forma-focus-clearance)"],
    ["row-gap", "var(--forma-focus-clearance)"]];
  const targets = [" > .presentation-deck-toolbar :is(button, select, input):not([popover] *)",
    stage + " > :is(nav, .presentation-deck-supporting) > button"];
  for (const [selector, expected] of [[open, grid], [open + stage, stagePolicy]])
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "reuse the current open stage's complete-height native fit and all-axis halo");
  for (const target of targets)
    assert.equal(eDeclaration(open + target, "scroll-margin-block", eLandscape), "var(--forma-focus-clearance)");
  const list = owners + ' .presentation-deck--list:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="true"])';
  assert.equal(eDeclaration(list, "grid-template-rows", eLandscape), "max-content 100%");
  assert.equal(eDeclaration(list + targets[0], "scroll-margin-block", eLandscape), "var(--forma-focus-clearance)");

  for (const [selector, expected] of [[closed, grid], [closed + stage, stagePolicy]]) {
    assert.equal(eDeclaration(selector, expected[0][0]), undefined,
      "no ordinary-height, open Tools, List or export-status policy replacement");
    for (const [property, value] of expected)
      assert.equal(eDeclaration(selector, property, eLandscape), value,
        "closing Tools must not squeeze the same current reading stage into a nominal target-height strip");
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) rules.push(rule); });
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].selectors, [selector]);
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected);
  }
  const selectors = targets.map(target => closed + target);
  for (const selector of selectors) {
    assert.equal(eDeclaration(selector, "scroll-margin-block"), undefined);
    assert.equal(eDeclaration(selector, "scroll-margin-block", eLandscape), "var(--forma-focus-clearance)");
  }
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selectors[0])) rules.push(rule); });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, selectors);
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["scroll-margin-block", "var(--forma-focus-clearance)"]],
    "same native controls and popover exclusion; no reader floor, outline, key handler or focus injection");
});

test("E5 source policy: normal Slides identity, source status and evidence label use natural text flow", () => {
  // The actual FR header truncates these three distinct meanings. Neither
  // a wider outer identity nor the reader repair removes the inner clamps.
  const begin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const end = artifacts.indexOf("  override render(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = artifacts.slice(begin, end);
  assert.ok(viewer.includes('<article class="document-artifact-reader">'));
  assert.ok(viewer.includes('<header class="artifact-viewer-header"><div class="artifact-viewer-identity">'));
  assert.ok(viewer.includes('<div class="artifact-viewer-kicker"><span>'));
  assert.ok(viewer.includes("this.#reviewLabel(review)"));
  assert.ok(viewer.includes('<h2 dir="auto">${artifact.title}</h2>'));
  assert.ok(viewer.includes('class="artifact-viewer-details"><summary>${this.i18n.t("production.evidence","Review production evidence")}'));
  assert.ok(viewer.includes('editing?html`<section class="artifact-direct-editor"'));
  assert.ok(viewer.includes('<forma-presentation-deck .items=${deckItems}'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.ok(viewer.includes("this.#cancelViewer"));

  const legacy = '.document-artifact-view[data-artifact-kind="slides"]';
  assert.equal(eDeclaration(legacy + " .artifact-viewer-identity", "display", eLandscape), "flex");
  for (const selector of [legacy + " .artifact-viewer-kicker", legacy + " .artifact-viewer-identity > h2"])
    for (const [property, value] of [["max-inline-size", "18vi"], ["overflow", "hidden"], ["text-overflow", "ellipsis"], ["white-space", "nowrap"]])
      assert.equal(eDeclaration(selector, property, eLandscape), value);
  assert.equal(eDeclaration(legacy + " .artifact-viewer-details > summary", "max-inline-size", eLandscape), "min(18vi, 9rem)");
  assert.equal(eDeclaration(legacy + " .artifact-viewer-details > summary", "white-space", eLandscape), "nowrap");
  const clampedTitles = [];
  stylesheet.walkRules(rule => {
    if (!rule.selectors?.includes(".document-artifact-reader > .artifact-viewer-header h2")) return;
    if (rule.parent?.type !== "atrule" || rule.parent.name !== "media" || rule.parent.params !== "(max-width: 720px)") return;
    clampedTitles.push(Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])));
  });
  assert.equal(clampedTitles.length, 1);
  assert.equal(clampedTitles[0].display, "-webkit-box");
  assert.equal(clampedTitles[0]["-webkit-line-clamp"], "2");
  assert.equal(declaration(".artifact-viewer-kicker", "flex-wrap"), "wrap");
  assert.equal(declaration(".artifact-viewer-kicker .artifact-review-status", "overflow-wrap"), "anywhere");
  assert.equal(declaration(".artifact-viewer-details > summary", "min-block-size"), "var(--forma-control-min-size,2.75rem)");
  assert.equal(declaration(".artifact-viewer-details > div", "display"), "grid", "expanded evidence already lives in normal flow");
  // The normal reader shares this title/disclosure structure across kinds
  // and keeps it when direct Edit swaps only the content below the header.
  const spacedEvidence = 'dialog.document-artifact-view[data-output-focus="false"] > .document-artifact-reader > .artifact-viewer-header > .artifact-viewer-identity > h2 + .artifact-viewer-details';
  const evidenceSpacing = matchingRules(spacedEvidence);
  assert.equal(evidenceSpacing.length, 1);
  assert.deepEqual(evidenceSpacing[0].rule.selectors, [spacedEvidence]);
  assert.deepEqual(evidenceSpacing[0].rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["margin-block-start", "calc(var(--forma-focus-clearance) + .25rem)"]],
    "reserve title font overhang beyond the line box as well as the outside-ring clearance");
  const bodySelector = spacedEvidence + "[open] > div";
  const evidenceBodySpacing = matchingRules(bodySelector);
  assert.equal(evidenceBodySpacing.length, 1);
  assert.deepEqual(evidenceBodySpacing[0].rule.selectors, [bodySelector]);
  assert.deepEqual(evidenceBodySpacing[0].rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["padding-block-start", "var(--forma-focus-clearance)"]],
    "the lower ring also needs clearance from the first opened evidence paragraph");
  assert.equal(declaration(".artifact-viewer-details > div", "padding-block-end"), ".7rem");
  assert.equal(eDeclaration(":root", "--forma-focus-clearance"), ".5rem");
  assert.equal(declaration('.document-artifact-view[data-output-focus="true"] .artifact-viewer-details', "display"), "none");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "flex-wrap", eLandscape), "wrap");
  assert.equal(eDeclaration(eHeader, "align-items", eLandscape), "stretch");
  assert.equal(eDeclaration(eActions, "align-items", eLandscape), "stretch");
  assert.equal(eDeclaration(eActions + " > :is(.button, .icon-button)", "min-block-size", eLandscape), "var(--forma-hit-target)");
  assert.equal(eDeclaration(eActions + " > :is(.button, .icon-button)", "align-self", eLandscape), "stretch");

  const card = 'dialog.document-artifact-view[data-artifact-kind="slides"][data-output-focus="false"] > article.document-artifact-reader:has(> .document-artifact-reader-content > forma-presentation-deck)';
  const identity = card + " > .artifact-viewer-header > .artifact-viewer-identity";
  const copy = [identity + " > :is(.artifact-viewer-kicker, h2)", identity + " > .artifact-viewer-details > summary"];
  const copyPolicy = [["max-inline-size", "100%"], ["overflow", "visible"], ["text-overflow", "clip"],
    ["white-space", "normal"], ["overflow-wrap", "anywhere"]];
  const policies = [
    [[identity], [["display", "block"]]],
    [copy, copyPolicy],
    [[identity + " > .artifact-viewer-kicker > span"], [["max-inline-size", "100%"]]],
    [[identity + " > h2"], [["display", "block"], ["-webkit-line-clamp", "unset"]]],
    [[card + " > .artifact-viewer-header > .document-artifact-reader-actions"], [["align-self", "flex-start"]]],
  ];
  for (const [selectors, expected] of policies) {
    for (const selector of selectors) {
      assert.equal(eDeclaration(selector, expected[0][0]), undefined,
        "no focused, direct-editor, other-format or ordinary-height policy replacement");
      for (const [property, value] of expected)
        assert.equal(eDeclaration(selector, property, eLandscape), value,
          "full title, source-status meaning and the existing evidence action use their available width");
    }
    const rules = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selectors[0])) rules.push(rule); });
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].selectors, selectors);
    assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
      "reuse ordinary identity flow; no wording, font, control size, disclosure, order or authorization changes");
  }
});

test("E5 source policy: a growing normal Slides header cannot consume its whole reading allocation", () => {
  const begin = artifacts.indexOf("  #viewer(artifact:DocumentArtifact|null){");
  const end = artifacts.indexOf("  override render(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = artifacts.slice(begin, end);
  assert.ok(viewer.includes('<article class="document-artifact-reader">'));
  assert.ok(viewer.includes('editing?html`<section class="artifact-direct-editor"'));
  assert.ok(viewer.includes('<forma-presentation-deck .items=${deckItems}'));
  assert.ok(viewer.includes('class="artifact-review-guidance"'));
  assert.ok(viewer.includes('class="artifact-review-actions"'));
  assert.ok(viewer.includes('class="artifact-revision-history"'));
  assert.ok(viewer.includes('<footer data-actions-open='));
  assert.ok(viewer.includes('class="artifact-viewer-actions-popover"'));
  assert.equal(declaration("*", "box-sizing"), "border-box");
  const dialog = 'dialog.document-artifact-view[data-artifact-kind="slides"][data-output-focus]';
  const baseCard = dialog + " > article.document-artifact-reader";
  assert.equal(eDeclaration(dialog, "overflow", eLandscape), "visible");
  assert.equal(eDeclaration(baseCard, "block-size", eLandscape), "100%");
  assert.equal(eDeclaration(baseCard, "max-block-size", eLandscape), "100%");
  assert.equal(eDeclaration(baseCard, "overflow", eLandscape), "visible",
    "retain the chrome-only fallback; the new normal current-deck exception has a genuine scrolling purpose");
  assert.equal(eDeclaration(baseCard, "border-radius", eLandscape), "inherit");
  assert.equal(eDeclaration('dialog.document-artifact-view[data-artifact-kind="slides"][data-output-focus="false"]', "block-size", eLandscape),
    "calc(100dvb - (var(--artifact-viewer-edge,1rem) * 2))");
  assert.equal(eDeclaration(".document-artifact-reader", "grid-auto-rows"), "auto");
  assert.equal(eDeclaration(".document-artifact-reader", "overflow-y"), "auto");
  assert.equal(eDeclaration(".document-artifact-reader", "overscroll-behavior"), "contain");
  const review = 'dialog.document-artifact-view[data-artifact-kind="slides"]:not([data-output-focus="true"]) > article.document-artifact-reader:has(> .artifact-review-actions:not([hidden]),> .artifact-review-guidance,> .artifact-revision-history:not([hidden]))';
  assert.equal(eDeclaration(review, "overflow-x", eLandscape), "hidden");
  assert.equal(eDeclaration(review, "overflow-y", eLandscape), "auto");
  const editor = '.document-artifact-view[data-artifact-kind="slides"] .document-artifact-reader-content:has(> .artifact-direct-editor)';
  assert.equal(eDeclaration(editor, "overflow-y"), "auto");
  assert.equal(eDeclaration(editor, "overscroll-behavior"), "contain");
  assert.equal(declaration(".artifact-revision-history", "max-height"), "min(22rem,42dvh)");
  assert.equal(declaration(".artifact-revision-history", "overflow"), "auto");
  const content = '.document-artifact-view[data-artifact-kind="slides"] .document-artifact-reader-content';
  assert.equal(eDeclaration(content, "overflow"), "hidden");
  assert.equal(eDeclaration(content, "min-block-size"), "0");
  assert.equal(eDeclaration(':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] forma-presentation-deck', "block-size"), "100%");
  assert.equal(declaration(".presentation-deck-viewport", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-frame", "aspect-ratio"), "16/9");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  const footer = '.document-artifact-view[data-artifact-kind="slides"][data-output-focus] > .document-artifact-reader > footer';
  assert.equal(eDeclaration(footer, "position", eLandscape), "static");
  assert.equal(eDeclaration(footer, "padding", eLandscape), "var(--forma-focus-clearance)");
  const owners = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  const closed = owners + ' .presentation-deck--slideshow:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="false"])';
  assert.equal(eDeclaration(closed, "grid-template-rows", eLandscape), "max-content 100%");
  assert.equal(eDeclaration(closed + " > .presentation-deck-stage[data-slide-posture]", "margin", eLandscape), "var(--forma-focus-clearance)");
  const reader = owners + ' .presentation-deck-stage[data-slide-posture="reading"] > .presentation-deck-viewport > .presentation-deck-reading';
  assert.equal(eDeclaration(reader, "padding-block-end", eLandscape), "var(--forma-focus-clearance)");

  const card = 'dialog.document-artifact-view[data-artifact-kind="slides"][data-output-focus="false"] > article.document-artifact-reader:has(> .document-artifact-reader-content > forma-presentation-deck)';
  const expected = [["grid-template-rows", "max-content 100% auto"], ["overflow-x", "hidden"], ["overflow-y", "auto"],
    ["padding", "var(--forma-focus-clearance)"], ["scroll-padding-block", "var(--forma-focus-clearance)"]];
  assert.equal(eDeclaration(card, "grid-template-rows"), undefined, "only the actual normal short-landscape deck owner changes");
  for (const [property, value] of expected)
    assert.equal(eDeclaration(card, property, eLandscape), value,
      "native scrolling joins natural header/evidence height to an independent complete-height content track");
  const cardRules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(card)) cardRules.push(rule); });
  assert.equal(cardRules.length, 1);
  assert.deepEqual(cardRules[0].selectors, [card]);
  assert.deepEqual(cardRules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
    "no viewport subtraction, nominal reader floor, new wrapper, fixed header, editor or focused allocation change");
  const targets = [card + " > .artifact-viewer-header :is(button, summary):not([popover] *)",
    card + " > footer :is(button, a[href]):not([popover] *)"];
  for (const selector of targets) {
    assert.equal(eDeclaration(selector, "scroll-margin-block"), undefined);
    assert.equal(eDeclaration(selector, "scroll-margin-block", eLandscape), "var(--forma-focus-clearance)");
  }
  const targetRules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(targets[0])) targetRules.push(rule); });
  assert.equal(targetRules.length, 1);
  assert.deepEqual(targetRules[0].selectors, targets);
  assert.deepEqual(targetRules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["scroll-margin-block", "var(--forma-focus-clearance)"]],
    "same native controls and popover exclusion; complete physical rings remain a real browser gate");

  // The saved 320x800 native handoff exposed the same competition for inline
  // room in portrait: keep identity above the existing action row.
  const portrait = "(max-width: 720px) and (orientation: portrait)";
  // Edit swaps only the direct content child; the same header and open
  // evidence disclosure must retain their portrait layout until Cancel.
  const portraitCard = 'dialog.document-artifact-view[data-artifact-kind="slides"][data-output-focus="false"] > article.document-artifact-reader:has(> .document-artifact-reader-content > forma-presentation-deck, > .document-artifact-reader-content > section.artifact-direct-editor)';
  const header = portraitCard + " > .artifact-viewer-header";
  const actions = header + " > .document-artifact-reader-actions";
  const portraitRules = [
    [header, [["flex-direction", "column"], ["align-items", "stretch"]]],
    [actions, [["flex-wrap", "wrap"]]],
    [actions + " > .button", [["max-inline-size", "100%"], ["white-space", "normal"], ["overflow-wrap", "anywhere"]]],
  ];
  for (const [selector, declarations] of portraitRules) {
    const matches = [];
    eResponsiveStyles.walkRules(rule => {
      if (rule.selectors?.includes(selector) && rule.parent.type === "atrule" && rule.parent.name === "media" && rule.parent.params === portrait) matches.push(rule);
    });
    assert.equal(matches.length, 1, selector);
    assert.deepEqual(matches[0].selectors, [selector]);
    assert.deepEqual(matches[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), declarations);
    for (const [property, value] of declarations) assert.equal(eDeclaration(selector, property, portrait), value);
  }
  for (const owner of [card, portraitCard])
    assert.equal(eDeclaration(owner, "grid-template-rows", portrait), undefined,
      "portrait stacks only existing chrome in read and edit; no new content sizing, artboard or scrolling policy");
  assert.equal(eDeclaration(header, "flex-direction", eLandscape), undefined,
    "the accepted short-landscape header policy is unchanged");
  assert.equal(declaration(".document-artifact-reader-actions > .icon-button", "min-inline-size"), "var(--forma-hit-target,var(--forma-control-min-size,2.75rem))");
  assert.equal(declaration(".document-artifact-reader-actions > .icon-button", "min-block-size"), "var(--forma-hit-target,var(--forma-control-min-size,2.75rem))");
  // Edit replaces the deck with a long form. Its natural-height row and static
  // wrapping actions must scroll together, preserving each native field's size.
  const editorPolicies = [
    [
      "dialog.document-artifact-view[data-artifact-kind=\"slides\"][data-output-focus=\"false\"] > article.document-artifact-reader:has(> .document-artifact-reader-content > section.artifact-direct-editor)",
      [
        [
          "grid-template-rows",
          "auto max-content"
        ],
        [
          "overflow-y",
          "auto"
        ],
        [
          "scroll-padding-block",
          "var(--forma-focus-clearance)"
        ]
      ]
    ],
    [
      "dialog.document-artifact-view[data-artifact-kind=\"slides\"][data-output-focus=\"false\"] > article.document-artifact-reader:has(> .document-artifact-reader-content > section.artifact-direct-editor) > footer",
      [
        [
          "position",
          "static"
        ],
        [
          "flex-direction",
          "column"
        ],
        [
          "align-items",
          "stretch"
        ],
        [
          "padding-block-end",
          "calc(.65rem + var(--forma-focus-clearance))"
        ]
      ]
    ],
    [
      "dialog.document-artifact-view[data-artifact-kind=\"slides\"][data-output-focus=\"false\"] > article.document-artifact-reader:has(> .document-artifact-reader-content > section.artifact-direct-editor) > footer > .artifact-viewer-actions-body",
      [
        [
          "flex-wrap",
          "wrap"
        ],
        [
          "padding",
          "var(--forma-focus-clearance)"
        ]
      ]
    ],
    [
      "dialog.document-artifact-view[data-artifact-kind=\"slides\"][data-output-focus=\"false\"] > article.document-artifact-reader:has(> .document-artifact-reader-content > section.artifact-direct-editor) > footer > .artifact-viewer-actions-body > button.button",
      [
        [
          "flex",
          "1 1 auto"
        ],
        [
          "max-inline-size",
          "100%"
        ],
        [
          "white-space",
          "normal"
        ],
        [
          "overflow-wrap",
          "anywhere"
        ],
        [
          "scroll-margin-block",
          "var(--forma-focus-clearance)"
        ]
      ]
    ],
    [
      "dialog.document-artifact-view[data-artifact-kind=\"slides\"][data-output-focus=\"false\"] > article.document-artifact-reader:has(> .document-artifact-reader-content > section.artifact-direct-editor) > .document-artifact-reader-content > .artifact-direct-editor :is(input,textarea)",
      [
        [
          "scroll-margin-block",
          "var(--forma-focus-clearance)"
        ]
      ]
    ]
  ];
  for (const [selector, declarations] of editorPolicies) {
    const matches = [];
    eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(selector)) matches.push(rule); });
    assert.equal(matches.length, 1, selector);
    assert.deepEqual(matches[0].selectors, [selector]);
    assert.equal(matches[0].parent.type, "atrule");
    assert.equal(matches[0].parent.name, "media");
    assert.equal(matches[0].parent.params, portrait);
    assert.deepEqual(matches[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), declarations);
    for (const [property, value] of declarations) assert.equal(eDeclaration(selector, property, portrait), value);
  }
  assert.equal(declaration(".artifact-direct-editor textarea", "min-height"), "6rem");
  assert.equal(declaration(".artifact-direct-editor textarea", "resize"), "vertical");
  assert.ok(viewer.includes('Finished output<textarea rows="12"'));
  assert.ok(viewer.includes('class="artifact-direct-editor-items"'));

});

test("E5 source policy: normal Canvas Slides keep readable context beyond their complete header", async () => {
  // Native55 passed its existing focus/End/Home checks, but the retained
  // French normal reader shows a heading and a cut first paragraph line.
  // This source contract preserves that receipt and reuses the current
  // Document card allocation; it is not a replacement native fit oracle.
  const [canvas, canvasCss, deck] = await Promise.all([
    readFile(new URL("../src/canvas/canvas-application.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/canvas/canvas.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/presentation-deck.ts", import.meta.url), "utf8"),
  ]);
  const begin = canvas.indexOf("  #artifactViewerDialog(){");
  const end = canvas.indexOf("  #outputViewerDialog(){", begin);
  assert.ok(begin >= 0 && end > begin);
  const viewer = canvas.slice(begin, end);
  const articleAt = viewer.indexOf('<article class="modal-card canvas-artifact-viewer-card">');
  const headerAt = viewer.indexOf("<header>", articleAt);
  const contentAt = viewer.indexOf("canvas-artifact-viewer-content canvas-artifact-viewer-content--", headerAt);
  const footerAt = viewer.indexOf("<footer data-actions-open=", contentAt);
  assert.ok(articleAt >= 0 && headerAt > articleAt && contentAt > headerAt && footerAt > contentAt,
    "absolute native peers precede the actual header, content and footer grid items");
  const peers = viewer.slice(articleAt, headerAt);
  assert.ok(peers.includes('class="icon-button canvas-viewer-focus-toggle"'));
  assert.ok(peers.includes('class="icon-button modal-close"'));
  assert.ok(peers.includes("this.#setViewerFocus(!this.#viewerFocused)"));
  assert.ok(peers.includes("this.#closeCanvasArtifact()"));
  assert.ok(viewer.includes('<span class="canvas-dialog-step">'));
  assert.ok(viewer.includes('<h2 id="canvas-artifact-viewer-title">'));
  assert.ok(viewer.includes("artifact-review-status artifact-review-"));
  assert.ok(viewer.includes("artifact.summary"));
  assert.ok(viewer.includes("this.#openArtifactDelivery(artifact)"));
  assert.match(viewer, /artifact\.kind==="slides"\?html\x60<forma-presentation-deck/u);
  assert.ok(viewer.includes('source-surface="canvas-artifact-viewer"'));
  assert.ok(viewer.includes('class="artifact-viewer-actions-popover"'));
  assert.ok(viewer.includes("this.store.authorizationScopeActive(viewerMenuAuthorization)"));
  assert.ok(viewer.includes('const groupViewerActions=artifact.kind==="slides"&&(1+Number(!project)+Number(canEditCanvas))>1;'));
  assert.ok(viewer.includes("this.#reuseArtifact(artifact)"));
  assert.ok(deck.includes('class="presentation-deck-reading"'));
  assert.ok(deck.includes('tabindex="0"'));
  assert.equal(declaration("*", "box-sizing"), "border-box");
  assert.equal(declaration(".modal-card", "position"), "relative");
  assert.equal(declaration(".modal-close", "position"), "absolute");
  assert.match(canvasCss, /\.canvas-artifact-viewer-card\{display:grid;box-sizing:border-box;/u);
  assert.match(canvasCss, /:is\(\.canvas-artifact-viewer,\.canvas-output-viewer\) > \.modal-card\s*\{[^}]*block-size:\s*calc\(100dvb - 1rem\);[^}]*max-block-size:\s*calc\(100dvb - 1rem\);/u);
  assert.match(canvasCss, /\.canvas-viewer-focus-toggle\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*2;[^}]*inset-block-start:\s*1rem;/u);
  assert.match(canvasCss, /\.canvas-artifact-viewer-card > header\s*\{[^}]*padding-inline-end:\s*calc\(\(var\(--forma-control-min-size,2\.75rem\) \* 2\) \+ 3rem\);/u);
  assert.match(canvasCss, /:is\(\.canvas-artifact-viewer,\.canvas-output-viewer\)\[data-output-focus="true"\] > \.modal-card\s*\{[^}]*block-size:\s*100dvb;[^}]*border:\s*0;[^}]*border-radius:\s*0;/u);

  const base = '.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > .canvas-artifact-viewer-card';
  const nativeCard = 'dialog.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus] > article.modal-card.canvas-artifact-viewer-card';
  assert.equal(eDeclaration(base, "grid-template-rows", eLandscape), "auto minmax(0, 1fr) auto",
    "the retained generic track remains a lower-priority fallback, not proof of normal reader quality");
  assert.equal(eDeclaration(nativeCard, "overflow", eLandscape), "visible");
  assert.equal(eDeclaration(base + " > .modal-close", "z-index", eLandscape), "2");
  assert.equal(eDeclaration(base + " > footer", "position", eLandscape), "static");
  assert.equal(eDeclaration(base + " > footer", "padding", eLandscape), "var(--forma-focus-clearance)");
  assert.equal(eDeclaration(eCard, "row-gap", eLandscape), "var(--forma-focus-clearance)");
  assert.equal(eDeclaration(eHeader, "position", eLandscape), "relative");
  assert.equal(eDeclaration(eHeader, "z-index", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "block-size", eLandscape), "auto");
  assert.equal(eDeclaration(eHeader, "flex-wrap", eLandscape), "wrap");
  const normal = 'dialog.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus="false"] > article.modal-card.canvas-artifact-viewer-card';
  const focused = 'dialog.canvas-artifact-viewer[data-artifact-kind="slides"][data-output-focus="true"] > article.modal-card.canvas-artifact-viewer-card';
  const minimum = "calc(var(--forma-hit-target) + (var(--forma-focus-clearance) * 2))";
  assert.equal(eDeclaration(normal + " > header", "min-block-size", eLandscape), minimum);
  assert.equal(eDeclaration(focused + " > header", "min-block-size", eLandscape), minimum);
  assert.equal(eDeclaration(focused + " > header", "padding-inline-end", eLandscape),
    "calc((var(--forma-hit-target) * 2) + (var(--forma-focus-clearance) * 3))");
  assert.equal(eDeclaration(focused + " > :is(button.canvas-viewer-focus-toggle, button.modal-close)", "inset-block-start", eLandscape),
    "calc(env(safe-area-inset-top, 0px) + var(--forma-focus-clearance))");

  const content = '.canvas-artifact-viewer[data-artifact-kind="slides"] .canvas-artifact-viewer-content--slides';
  assert.equal(eDeclaration(content, "overflow"), "hidden");
  assert.equal(eDeclaration(content, "min-block-size"), "0");
  assert.equal(eDeclaration(content, "scrollbar-gutter"), "auto");
  assert.equal(eDeclaration(':is(.document-artifact-view, .canvas-artifact-viewer)[data-artifact-kind="slides"] forma-presentation-deck', "block-size"), "100%");
  assert.equal(declaration(".presentation-deck-viewport", "overflow"), "hidden");
  assert.equal(declaration(".presentation-deck-frame", "aspect-ratio"), "16/9");
  assert.match(source, /forma-presentation-slide > \.presentation-slide\[data-presentation-artboard\]\s*\{[^}]*width:\s*960px;[^}]*height:\s*540px;/u);
  assert.equal(eDeclaration(".presentation-deck-reading", "block-size"), "100%");
  assert.equal(eDeclaration(".presentation-deck-reading", "overflow-y"), "auto");
  assert.equal(eDeclaration(".presentation-deck-reading", "overscroll-behavior"), "contain");
  const owners = ':is(dialog.document-artifact-view, dialog.canvas-artifact-viewer)[data-artifact-kind="slides"]';
  for (const state of ["true", "false"]) {
    const slideshow = owners + ' .presentation-deck--slideshow:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="' + state + '"])';
    assert.equal(eDeclaration(slideshow, "grid-template-rows", eLandscape), "max-content 100%");
    assert.equal(eDeclaration(slideshow + " > .presentation-deck-stage[data-slide-posture]", "margin", eLandscape), "var(--forma-focus-clearance)");
  }
  assert.equal(eDeclaration(owners + ' .presentation-deck--list:not(.presentation-deck--export-status):has(> .presentation-deck-toolbar[data-tools-open="true"])',
    "grid-template-rows", eLandscape), "max-content 100%");
  const reader = owners + ' .presentation-deck-stage[data-slide-posture="reading"] > .presentation-deck-viewport > .presentation-deck-reading';
  assert.equal(eDeclaration(reader, "padding-block-end", eLandscape), "var(--forma-focus-clearance)");

  const expected = [["grid-template-rows", "max-content 100% auto"], ["overflow-x", "hidden"], ["overflow-y", "auto"],
    ["padding", "var(--forma-focus-clearance)"], ["scroll-padding-block", "var(--forma-focus-clearance)"]];
  const documentCard = 'dialog.document-artifact-view[data-artifact-kind="slides"][data-output-focus="false"] > article.document-artifact-reader:has(> .document-artifact-reader-content > forma-presentation-deck)';
  for (const [property, value] of expected)
    assert.equal(eDeclaration(documentCard, property, eLandscape), value,
      "reuse the installed Document allocation without broadening or replacing its exact scope");
  assert.equal(eDeclaration(documentCard + " > .artifact-viewer-header :is(button, summary):not([popover] *)",
    "scroll-margin-block", eLandscape), "var(--forma-focus-clearance)");

  const card = normal + ":has(> .canvas-artifact-viewer-content--slides > forma-presentation-deck)";
  assert.equal(eDeclaration(card, "grid-template-rows"), undefined,
    "no focused, other-format, missing-deck or ordinary-height allocation replacement");
  for (const [property, value] of expected)
    assert.equal(eDeclaration(card, property, eLandscape), value,
      "normal reading context uses an independent content track beyond the complete current header");
  const rules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(card)) rules.push(rule); });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, [card]);
  assert.deepEqual(rules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]), expected,
    "same card, full header and native owners; no nominal reader floor, font shrink, artboard resize or new controls");
  const targets = [card + " > :is(button.canvas-viewer-focus-toggle, button.modal-close)",
    card + " > header :is(button, summary):not([popover] *)",
    card + " > footer :is(button, a[href]):not([popover] *)"];
  for (const selector of targets) {
    assert.equal(eDeclaration(selector, "scroll-margin-block"), undefined);
    assert.equal(eDeclaration(selector, "scroll-margin-block", eLandscape), "var(--forma-focus-clearance)");
  }
  const targetRules = [];
  eResponsiveStyles.walkRules(rule => { if (rule.selectors?.includes(targets[0])) targetRules.push(rule); });
  assert.equal(targetRules.length, 1);
  assert.deepEqual(targetRules[0].selectors, targets);
  assert.deepEqual(targetRules[0].nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]),
    [["scroll-margin-block", "var(--forma-focus-clearance)"]],
    "native focus reveal retains the absolute peers and existing popover exclusion without script rescue");
});
