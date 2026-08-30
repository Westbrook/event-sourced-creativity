import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

// Stylesheet/source contracts only: no DOM, browser geometry, network, or application execution.
const postcss = createRequire(import.meta.resolve("vite"))("postcss");
const read = relative => readFile(new URL("../" + relative, import.meta.url), "utf8");
const paths = [
  "src/styles.css", "src/design-system.css", "src/responsive-foundation.css",
  "src/components/design-system/slotted-element.ts", "src/components/design-system/layout.ts",
  "src/components/forma-library.ts", "src/components/forma-deliver.ts",
  "src/components/design-system/catalog.ts", "src/components/design-system/component-catalog.ts",
  "docs/components.md", "src/apps/product/actual-replay.ts",
  "src/components/design-system/assistant-panel.css",
];
const texts = Object.fromEntries(await Promise.all(paths.map(async path => [path, await read(path)])));
const base = postcss.parse(texts["src/styles.css"]);
const design = postcss.parse(texts["src/design-system.css"]);
const responsive = postcss.parse(texts["src/responsive-foundation.css"]);
const slotted = texts["src/components/design-system/slotted-element.ts"];
const marker = "const compositionStyles = css" + String.fromCharCode(96);
assert.ok(slotted.includes(marker), "inspect the actual shared adopted stylesheet");
const shadow = postcss.parse(slotted.split(marker)[1].split(String.fromCharCode(96) + ";")[0]);
const rules = sheet => { const found = []; sheet.walkRules(rule => found.push(rule)); return found; };
const declarations = rule => Object.fromEntries((rule?.nodes ?? []).filter(node => node.type === "decl").map(node => [node.prop, node.value]));
const unconditional = (sheet, selector) => {
  const found = rules(sheet).filter(rule => rule.selectors.includes(selector) && rule.parent.type === "root");
  assert.ok(found.length, "missing unconditional rule: " + selector);
  return Object.assign({}, ...found.map(declarations));
};
const inputSelector = ':where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, select)';
const cluster = 'forma-ui-cluster[alignment="stretch"]';
const actionHosts = ":is(forma-ui-button,forma-ui-icon-button,forma-ui-link)";

test("specialist grant identity preserves full long account text and lets the action wrap", () => {
  assert.equal(unconditional(responsive, ".access-grant-list > li")["flex-wrap"], "wrap");
  const copy = unconditional(responsive, ".access-grant-list > li > div");
  assert.equal(copy["min-inline-size"], "0");
  assert.equal(copy["overflow-wrap"], "anywhere");
  for (const rule of rules(responsive).filter(rule => rule.selector.includes("access-grant-list"))) {
    const declared = declarations(rule);
    assert.notEqual(declared["white-space"], "nowrap");
    assert.notEqual(declared["text-overflow"], "ellipsis");
    assert.notEqual(declared.overflow, "hidden");
    assert.equal(declared["line-clamp"], undefined);
    assert.equal(declared["-webkit-line-clamp"], undefined);
  }
});

test("supporting buttons and fields share declared block padding, typography and a border box", () => {
  const button = unconditional(design, ".button"), field = unconditional(design, inputSelector);
  assert.equal(button["padding-block"], "var(--forma-space-2, var(--space-2))");
  assert.ok(field.padding.startsWith(button["padding-block"] + " "));
  assert.equal(button["font-size"], field["font-size"]);
  assert.equal(button["line-height"], field["line-height"]);
  assert.equal(button.border, "1px solid transparent");
  assert.equal(field.border, "1px solid var(--line-strong)");
  assert.equal(unconditional(base, "*")["box-sizing"], "border-box");
  assert.equal(button["min-height"], "2.75rem");
  assert.equal(field["min-height"], "2.75rem");
  assert.equal(unconditional(design, ".button.compact")["min-height"], "2.75rem");
});

test("legacy compact and Library action rules do not undo shared block padding or shrink their text", () => {
  for (const selector of [".button", ".button.compact", ".family-actions .button", ".library-output-actions .button"]) {
    assert.ok(unconditional(base, selector).padding.startsWith("var(--forma-space-2, var(--space-2)) "), selector);
  }
  assert.equal(unconditional(base, ".library-output-actions .button")["font-size"], "var(--forma-font-size-supporting, var(--type-small))");
  for (const selector of [".button", inputSelector]) {
    const rule = unconditional(design, selector);
    assert.equal(rule.height, undefined);
    assert.equal(rule["block-size"], undefined);
    assert.equal(rule["max-height"], undefined);
    assert.equal(rule["white-space"], undefined, "wrapped text is not truncated to fake equal heights");
  }
});

test("Account privacy checkboxes give the whole existing label a target without enlarging the glyph", () => {
  const label = unconditional(base, ".toggle-row");
  assert.equal(label["min-inline-size"], "var(--forma-control-min-size, 2.75rem)");
  assert.equal(label["min-block-size"], label["min-inline-size"]);
  assert.equal(label["align-items"], "center");
  assert.equal(label["font-size"], "var(--forma-font-size-supporting, var(--type-small))");
  const input = unconditional(base, '.toggle-row > input[type="checkbox"]');
  assert.equal(input.flex, "0 0 auto");
  assert.equal(input["min-block-size"], undefined);
  assert.equal(input["block-size"], undefined);
  assert.equal(unconditional(base, ".toggle-row > span")["overflow-wrap"], "anywhere");
});

test("old segmented consumers keep the target floor while Library history reuses the real primitive", () => {
  const old = unconditional(design, ".segmented button");
  assert.equal(old["min-height"], "var(--forma-control-min-size, 2.75rem)");
  assert.equal(old["min-inline-size"], old["min-height"]);
  const library = texts["src/components/forma-library.ts"];
  assert.ok(library.includes('<forma-ui-segmented-control class="compact-segmented"'));
  assert.ok(library.includes(".value=" + String.fromCharCode(36) + "{this.#outputScope}"));
  assert.ok(library.includes('value:"recent"') && library.includes('value:"kept"'));
  assert.ok(library.includes('if(value==="recent"||value==="kept")this.#setOutputScope(value)'));
  assert.ok(library.includes('recentOutputItems.length+allArtifacts.length') && library.includes('keptCount'));
  assert.ok(!library.includes('<div class="segmented compact-segmented"'));
});

test("Library result rows reuse the authored-child Cluster while keeping current anchors and handlers", () => {
  const library = texts["src/components/forma-library.ts"];
  assert.ok(library.includes('import "./design-system/layout";'));
  assert.equal(library.split('<forma-ui-cluster class="library-output-actions" alignment="stretch">').length - 1, 2);
  assert.ok(library.includes('this.#navigate(event,"output",output.id)'));
  assert.ok(library.includes('this.store.addArtifactAsContext(artifact.id,projection.documentId,"library")'));
  assert.ok(library.includes('this.#toggleLibrary(artifact)') && library.includes('this.#toggleLibrary(output)'));
  assert.equal(unconditional(design, ".library-output-actions")["flex-wrap"], "wrap");
  assert.equal(unconditional(base, ".family-actions")["flex-wrap"], "wrap");
});

test("Cluster stretch is explicit; default mixed badge and status rows remain centered", () => {
  assert.equal(unconditional(design, "forma-ui-cluster")["align-items"], "center");
  assert.equal(unconditional(design, "forma-ui-cluster")["flex-wrap"], "wrap");
  assert.equal(unconditional(design, cluster)["align-items"], "stretch");
  const layout = texts["src/components/design-system/layout.ts"];
  assert.ok(layout.includes('alignment: "center" | "stretch" = "center"'));
  for (const rule of rules(design).filter(rule => rule.selector.includes(cluster))) {
    assert.ok(!rule.selector.includes("forma-ui-badge") && !rule.selector.includes("forma-ui-status"), "noninteractive content is not forced into action sizing");
  }
});

test("opt-in wrapping hosts propagate cross-axis size to their real native controls", () => {
  const host = unconditional(design, cluster + " > " + actionHosts);
  assert.equal(host.display, "flex");
  assert.equal(host["min-inline-size"], "0");
  const control = unconditional(design, cluster + " > " + actionHosts + " > :is(button,a)");
  assert.equal(control.flex, "1 1 auto");
  assert.equal(control["align-self"], "stretch");
  for (const slot of ["actions", "trailing"]) {
    assert.equal(unconditional(design, actionHosts + '[slot="' + slot + '"]').display, "flex");
    assert.equal(unconditional(design, actionHosts + '[slot="' + slot + '"] > :is(button,a)').flex, "1 1 auto");
  }
});

test("shared slotted body copy inherits script leading rather than hardcoding English spacing", () => {
  assert.equal(unconditional(shadow, ":host")["line-height"], "var(--forma-body-line-height, 1.6)");
  assert.equal(unconditional(shadow, 'slot:not([name])::slotted(p)')["line-height"], "var(--forma-body-line-height, 1.6)");
  assert.equal(unconditional(shadow, ".button")["padding-block"], "var(--forma-space-2, var(--space-2))");
  assert.equal(unconditional(shadow, ".button")["font-weight"], "600");
  assert.ok(texts["src/styles.css"].includes("--forma-body-line-height: 1.7;"));
  assert.ok(texts["src/styles.css"].includes("--forma-body-line-height: 1.8;"));
});

test("slotted lists and headers wrap actions after preserving a useful copy basis", () => {
  assert.equal(unconditional(shadow, ".ui-list-item")["flex-wrap"], "wrap");
  const main = unconditional(shadow, ".ui-list-item-main"), copy = unconditional(shadow, ".ui-list-item-copy");
  assert.equal(main.display, "flex");
  assert.equal(main.flex, "1 1 min(100%, 16rem)", "leading visual and copy own one preferred basis");
  assert.equal(main["min-inline-size"], "0");
  assert.equal(main["align-items"], "center");
  assert.equal(main.gap, "var(--forma-space-3, var(--space-3))");
  for (const selector of ['.ui-list-item-main > slot[name="leading"]::slotted(*)', '.ui-list-item-main > slot[name="leading"] > *']) assert.equal(unconditional(shadow, selector).flex, "none", "meaningful leading content does not shrink");
  assert.equal(copy["white-space"], undefined, "authored pre/code whitespace is not replaced");
  assert.equal(copy.flex, "1", "copy flexes inside its main group instead of wrapping independently");
  assert.equal(copy["min-inline-size"], "0");
  assert.equal(copy["overflow-wrap"], "anywhere");
  assert.equal(main["inline-size"], undefined); assert.equal(copy["inline-size"], undefined);
  assert.equal(main.height, undefined); assert.equal(copy.height, undefined);
  assert.equal(unconditional(shadow, ".ui-page-header")["flex-wrap"], "wrap");
  assert.equal(unconditional(shadow, ".ui-page-header-copy").flex, "1 1 min(100%, 24rem)");
  assert.equal(unconditional(shadow, ".ui-list-item-trailing")["align-items"], "center", "badge/status alignment is not blanket-stretched");
  assert.equal(unconditional(shadow, '.ui-page-header-actions')["flex-wrap"], "wrap");
});

test("notice actions move below their own copy at a container boundary, without an overlay", () => {
  assert.equal(unconditional(shadow, ":host(forma-ui-notice)").container, "forma-notice / inline-size");
  assert.equal(unconditional(shadow, ".ui-notice")["grid-template-columns"], "1.5rem minmax(0, 1fr) auto", "wide notice composition remains intact");
  const compact = rules(shadow).filter(rule => rule.parent.type === "atrule" && rule.parent.name === "container" && rule.parent.params === "forma-notice (max-width: 32rem)");
  assert.equal(compact.length, 2);
  assert.equal(declarations(compact.find(rule => rule.selector === ".ui-notice"))["grid-template-columns"], "1.5rem minmax(0, 1fr)");
  assert.equal(declarations(compact.find(rule => rule.selector === ".ui-notice-actions"))["grid-column"], "2");
  for (const rule of compact) assert.equal(declarations(rule).position, undefined);
});

test("RoleDashboard full-bleed chrome and its body share the same inline gutter owner", () => {
  const hero = unconditional(design, ".role-dashboard > .page-header--hero");
  assert.equal(hero["padding-inline"], "var(--page-gutter)");
  assert.equal(hero.padding, undefined, "a competing shorthand must not reset the inline gutter");
  assert.ok(unconditional(design, ".page-pad").padding.includes("var(--page-gutter)"));
  assert.ok(unconditional(design, ".page-header--hero").margin.includes("calc(-1 * var(--page-gutter))"));
  for (const rule of rules(responsive).filter(rule => rule.selectors.includes(".role-dashboard > .page-header--hero"))) {
    assert.equal(declarations(rule).padding, undefined);
    assert.equal(declarations(rule)["padding-inline"], undefined, "responsive refinements only change block rhythm");
  }
});

test("Deliver owns one body inset around unchanged keyed Outputs, results and the final caveat", () => {
  const deliver = texts["src/components/forma-deliver.ts"];
  const body = deliver.indexOf('<div class="forma-deliver-body">');
  const keyed = deliver.indexOf('repeat(activity.documents, document => document.id');
  const resultSection = deliver.indexOf('<section aria-label=', keyed);
  const caveat = deliver.indexOf('this.i18n.t("artifact.delivery.notDelivered"');
  assert.ok(body > 0 && body < keyed && keyed < resultSection && resultSection < caveat);
  assert.equal(unconditional(responsive, ".forma-deliver-body")["padding-inline"], "var(--page-gutter)");
  for (const selector of [".forma-deliver-section", ".forma-deliver-summary"]) {
    const rule = unconditional(responsive, selector);
    assert.equal(rule["margin-inline"], undefined);
    assert.equal(rule["padding-inline"], undefined, "route inset is not paid twice");
  }
  assert.equal(unconditional(responsive, ".forma-activity-sections")["margin-inline"], "var(--page-gutter)", "unrelated Activity ownership is preserved");
});

test("configuration grids target in-flow paid replay forms, not the persona modal", () => {
  const selector = ".actual-replay > section > form";
  assert.equal(unconditional(design, selector).display, "grid");
  assert.equal(unconditional(design, selector)["grid-template-columns"], "repeat(auto-fit, minmax(min(15rem, 100%), 1fr))");
  assert.ok(!rules(design).some(rule => rule.selectors.includes(".actual-replay form")));
  assert.ok(!rules(design).some(rule => rule.selectors.includes(".actual-replay form label")));
  const actual = texts["src/apps/product/actual-replay.ts"];
  assert.ok(actual.includes('class="modal actual-persona-confirmation"'));
  assert.ok(actual.includes('<form class="modal-card"'));
  assert.ok(actual.includes('name="personaAcknowledged"') && actual.includes("this.#confirmPersona(event)"));
});

test("the safe catalog teaches both native and wrapped actions without stretching its badge example", () => {
  const catalog = texts["src/components/design-system/component-catalog.ts"];
  const example = catalog.split("\n").find(line => line.includes('case "forma-ui-cluster":'));
  assert.ok(example.includes('<forma-ui-cluster gap="small"><forma-ui-badge'));
  assert.ok(example.includes('<forma-ui-cluster alignment="stretch" gap="small">'));
  assert.ok(example.includes('<button type="button" class="button secondary"'));
  assert.ok(example.includes("<forma-ui-button ") && example.includes("<forma-ui-link "));
  assert.ok(example.includes('href="#forma-ui-cluster"'));
  assert.ok(!example.includes("this.store") && !example.includes("fetch("));
  const docs = texts["docs/components.md"];
  assert.ok(docs.includes("Shared control metrics and wrapping composition"));
  assert.ok(docs.includes("neither\nsuite certifies rendered heights"));
  assert.ok(docs.includes("regenerate both Custom Elements Manifests"));
});

test("actual header, family, failure and specialist action rows share peer-only cross-axis sizing", () => {
  const rows = ":is(.page-header-actions,.family-actions,.generation-failure-actions,.forma-activity-header-actions)";
  const controls = ":is(.button,.icon-button,forma-ui-button,forma-ui-icon-button,forma-ui-link)";
  assert.equal(unconditional(design, rows + " > " + controls)["align-self"], "stretch");
  assert.equal(unconditional(design, rows + " > " + actionHosts).display, "flex");
  assert.equal(unconditional(design, rows + " > " + actionHosts + " > :is(button,a)")["align-self"], "stretch");
  assert.equal(unconditional(base, ".page-header-actions")["align-items"], "center", "metadata keeps its centered posture");
  assert.equal(unconditional(base, ".generation-failure-actions")["align-items"], "center", "receipt/status children are not forced into action dimensions");
  assert.equal(unconditional(responsive, ".document-artifact-failures article > div.document-artifact-failure-actions")["align-items"], "stretch");
  const assistant = postcss.parse(texts["src/components/design-system/assistant-panel.css"]);
  assert.equal(unconditional(assistant, ".forma-assistant-specialist footer")["align-items"], "stretch");
  assert.equal(unconditional(assistant, ".forma-assistant-specialist footer")["flex-wrap"], "wrap");
  assert.equal(unconditional(assistant, ".forma-assistant-specialist footer button")["overflow-wrap"], "anywhere");
  const select = unconditional(assistant, ".forma-assistant-model select");
  assert.equal(select["font-size"], "var(--forma-font-size-supporting, .875rem)");
  assert.equal(select["line-height"], "var(--forma-body-line-height, 1.6)");
  assert.equal(select.padding, "var(--forma-space-2, .5rem) var(--forma-control-inset-inline, .75rem)");
  const intentional = '.application-creative[data-nav-posture="compact"][data-layout-intent="workbench"] .page-header--document .page-header-actions';
  assert.equal(unconditional(responsive, intentional)["flex-wrap"], "nowrap");
  assert.equal(unconditional(responsive, intentional)["overflow-x"], "auto");
});

test("slotted native, wrapped and built-in actions all stretch while trailing badges remain centered", () => {
  for (const slot of ["actions", "trailing"]) for (const tag of ["button", "a", "forma-ui-button", "forma-ui-icon-button", "forma-ui-link"]) {
    assert.equal(unconditional(shadow, "::slotted(" + tag + '[slot="' + slot + '"])')["align-self"], "stretch");
  }
  for (const owner of [" > ", " > slot > "]) assert.equal(unconditional(shadow, ":is(.ui-card-actions,.ui-page-header-actions,.ui-notice-actions,.ui-list-item-trailing)" + owner + ":is(.button,.icon-button)")["align-self"], "stretch", "both direct dismiss and fallback slot-native actions share the peer row");
  for (const rule of rules(shadow).filter(rule => declarations(rule)["align-self"] === "stretch")) {
    assert.ok(!rule.selector.includes("badge") && !rule.selector.includes("status"));
  }
  const peers = "forma-ui-cluster > :is(button,a,forma-ui-button,forma-ui-icon-button,forma-ui-link)";
  assert.equal(unconditional(design, peers).flex, "0 1 auto", "intrinsic action width determines wrapping, not narrow token columns");
  assert.equal(unconditional(design, peers)["max-inline-size"], "100%");
  assert.equal(unconditional(design, "forma-ui-cluster > :is(button,a)")["white-space"], "normal");
  assert.equal(unconditional(design, "forma-ui-cluster > :is(button,a)")["overflow-wrap"], "anywhere");
});
